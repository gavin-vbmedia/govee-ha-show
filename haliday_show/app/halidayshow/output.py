"""Stream per-segment colours to Govee devices over the razer protocol.

Each device is rate limited (latest frame wins) and kept in razer mode by streaming
frames continuously. Razer-on is only sent while a light starts up: repeating it later
makes some lights blink.
"""
import asyncio
import colorsys
import contextlib
import logging
import socket
import time

from .protocol import (CMD_PORT, average, colorwc_msg, ptreal_msg, razer_colors, razer_enable, razer_msg,
                       pixel_packets, scene_packets, segment_changes, segment_colour_packet, segment_colour_packets,
                       wrap)
from . import e131
from .wled import DDP_PORT, ddp_packets

log = logging.getLogger(__name__)

# Some lights (the H70C5 string lights) slip back to their own scene within a fraction of a second
# of the last colour packet, so an unchanged frame is streamed 10 times a second, as SignalRGB
# does. It is a small packet, so this costs next to nothing.
KEEPALIVE_S = 0.1
# A light that was off is still starting up when the first razer-on arrives and can ignore it,
# so repeat it for the first few seconds. After that it isn't repeated: the H70C5 blinks each
# time it hears razer-on, and the constant stream of frames already keeps it in realtime mode.
# A light that loses power mid-show picks realtime up again when the next show starts.
STARTUP_S = 5
STARTUP_REENABLE_S = 0.5
MAX_FPS = 40
WHOLE_FPS = 10  # colorwc fades each change, so faster than this just blurs
# The app's segment command isn't made for streaming. A light sent more than it can take queues them
# up and falls behind (the H70C5 lagged at ~100 a second), so each send carries at most a few
# commands, biggest change first, and changes too small to see wait until they add up. The rest
# follow on the next sends. Once the picture settles, it is repeated in case a packet was lost.
SEGMENTS_FPS = 10
SEGMENTS_PER_SEND = 3
SEGMENTS_CLOSE = 12  # out of 255, per channel
SEGMENTS_RESEND_S = 1.0
# Per-bulb pictures (Finger sketch) run to a few dozen packets. Lights drop a ptReal message with
# too many in it (govee-lan-bridge found 24 dropped, 18 fine), so a picture goes as several
# messages a little apart. The H70C5 needs about 0.12 s per picture plus 0.018 s per packet (speed
# tests: 3-packet pictures kept up at 2 a second but not 8, 23-packet ones at 2 but not 4); send
# faster and it drops pictures, so each picture waits that long, with a little to spare.
PIXELS_FPS = 6
PIXELS_PICTURE_S = 0.13
PIXELS_PACKET_S = 0.02
PIXELS_PER_MESSAGE = 12
PIXELS_GAP_S = 0.04
PIXELS_RESEND_S = 5.0


class OutputDevice:
    def __init__(self, ip: str, segments: int, sock: socket.socket, *,
                 reverse: bool = False, gradient: bool = False, protocol: str = "standard",
                 brightness: int = 100, max_fps: int = MAX_FPS):
        self.ip = ip
        self.brightness = brightness  # per-light cap, 1-100, applied to every frame
        self.protocol = protocol
        self.realtime = protocol not in ("whole", "segments", "pixels")
        if not self.realtime:
            max_fps = min(max_fps, {"segments": SEGMENTS_FPS, "pixels": PIXELS_FPS}.get(protocol, WHOLE_FPS))
        self.keepalive = {"segments": SEGMENTS_RESEND_S, "pixels": PIXELS_RESEND_S}.get(protocol, KEEPALIVE_S)
        self.queue: list[bytes] = []  # per-bulb pictures: the messages still to send, PIXELS_GAP_S apart
        self.picture_at = self.picture_s = 0.0  # when the last picture started, and how long it needs
        self.shown: bytearray | None = None  # app segments: what the light should be showing now
        self.segments = segments
        self.reverse = reverse
        self.gradient = gradient
        self.sock = sock
        self.min_interval = 1.0 / max_fps
        self.pending: bytes | None = None
        self.last_frame: bytes | None = None
        self.last_sent = 0.0
        self.last_enable = 0.0
        self.enabled_at = 0.0
        self.enabled = False
        self.scene: tuple[int, str] | None = None  # (code, param) while a Govee scene is running

    def _send(self, payload: bytes):
        try:
            self.sock.sendto(payload, (self.ip, CMD_PORT))
        except OSError as e:
            log.debug("[%s] send failed: %s", self.ip, e)

    def enable(self):
        self._send(wrap("turn", {"value": 1}))
        self._send(wrap("brightness", {"value": 100}))  # let the show own brightness
        if self.realtime:
            self._send(razer_msg(razer_enable(True)))
        self.last_enable = self.enabled_at = time.monotonic()
        self.enabled = True

    def disable(self):
        if self.enabled and self.realtime and self.scene is None:
            self._send(razer_msg(razer_enable(False)))
        self.enabled = False
        self.scene = None
        self.pending = self.last_frame = self.shown = None
        self.queue = []

    def play_scene(self, code: int, param: str):
        """Experimental: hand the light to one of Govee's built-in scenes until end_scene()."""
        if self.scene == (code, param):
            return
        if self.realtime:
            self._send(razer_msg(razer_enable(False)))
        self._send(ptreal_msg(scene_packets(code, param)))
        self.scene = (code, param)
        self.pending = self.last_frame = None

    def end_scene(self):
        if self.scene is None:
            return
        self.scene = None
        if self.realtime:
            self._send(razer_msg(razer_enable(True)))
        self.last_enable = self.enabled_at = time.monotonic()  # repeat razer-on as at start-up
        self.last_sent = 0.0

    def update(self, rgb: bytes):
        n = self.segments * 3
        seg = bytes(rgb[:n]).ljust(n, b"\0")
        if self.reverse:
            seg = b"".join(seg[i: i + 3] for i in range(n - 3, -1, -3))
        if self.brightness < 100:
            seg = bytes(v * self.brightness // 100 for v in seg)
        self.pending = seg

    def packet(self, frame: bytes, previous: bytes | None = None) -> bytes:
        if self.protocol == "segments":
            return ptreal_msg(segment_colour_packets(frame, previous))
        if self.protocol == "pixels":  # only logged; _tick_pixels sends the whole picture
            return ptreal_msg(pixel_packets(frame)[:PIXELS_PER_MESSAGE])
        if not self.realtime:
            return colorwc_msg(*average(frame))
        return razer_msg(razer_colors(frame, self.gradient, self.protocol))

    def tick(self, now: float):
        if not self.enabled or self.scene is not None:
            return
        if self.protocol == "segments":
            return self._tick_segments(now)
        if self.protocol == "pixels":
            return self._tick_pixels(now)
        starting = now - self.enabled_at < STARTUP_S
        if self.realtime and starting and now - self.last_enable > STARTUP_REENABLE_S:
            self._send(razer_msg(razer_enable(True)))
            self.last_enable = now
            self.last_sent = 0.0  # repaint straight after, in case realtime-on reset the light
        frame = self.pending if self.pending is not None else self.last_frame
        if frame is None or now - self.last_sent < self.min_interval:
            return  # rate limited; latest pending frame wins
        if frame != self.last_frame or now - self.last_sent > self.keepalive:
            self._send(self.packet(frame, self.last_frame if frame != self.last_frame else None))
            self.last_frame, self.last_sent = frame, now
        self.pending = None

    def _tick_pixels(self, now: float):
        if self.queue:
            if now - self.last_sent >= PIXELS_GAP_S:
                self._send(self.queue.pop(0))
                self.last_sent = now
            return
        frame = self.pending if self.pending is not None else self.last_frame
        since = now - self.picture_at
        if frame is None or since < max(self.min_interval, self.picture_s):
            return  # the light is still taking in the last picture; the latest frame waits
        if frame != self.last_frame or since > self.keepalive:
            packets = pixel_packets(frame)
            self.queue = [ptreal_msg(packets[i: i + PIXELS_PER_MESSAGE])
                          for i in range(0, len(packets), PIXELS_PER_MESSAGE)]
            self._send(self.queue.pop(0))
            self.last_frame, self.last_sent, self.picture_at = frame, now, now
            self.picture_s = PIXELS_PICTURE_S + PIXELS_PACKET_S * len(packets)
        self.pending = None

    def _tick_segments(self, now: float):
        if self.pending is not None:
            self.last_frame, self.pending = self.pending, None
        frame = self.last_frame
        if frame is None or now - self.last_sent < self.min_interval:
            return
        settled = self.shown is not None and now - self.last_sent > self.keepalive
        if self.shown is None or len(self.shown) != len(frame) or settled:
            # Not known, or settled and due a repeat in case a packet was lost: count every segment
            # as far from its colour, so all of them get sent over the next few sends.
            self.shown = bytearray(255 - v for v in frame)
        changes = segment_changes(frame, self.shown, SEGMENTS_CLOSE)
        if not changes:
            return
        changes = changes[:SEGMENTS_PER_SEND]
        self._send(ptreal_msg([segment_colour_packet(c, segs) for c, segs in changes]))
        for c, segs in changes:
            for i in segs:
                self.shown[i * 3: i * 3 + 3] = c
        self.last_sent = now


# WLED drops back to its own effect when it hears nothing for a while (2.5 s by default), so a
# still frame is repeated well inside that. Other DDP receivers time out similarly or not at all.
WLED_RESEND_S = 1.0


def linked(d: dict) -> bool:
    """Whether a saved light has somewhere to send to: an IP, or a Home Assistant entity."""
    return bool(d.get("ip") or d.get("entity"))


def address(d: dict) -> str:
    """Where a saved light's frames go, and the key it's claimed under. A pixel controller can drive
    several lights from one IP, each from its own first LED, so those get `ip#first`."""
    if d.get("kind") == "ha":
        return f"ha:{d['entity']}"
    if d.get("kind") == "e131":
        universe, channel = int(d.get("universe") or 1), int(d.get("channel") or 1)
        return d["ip"] if (universe, channel) == (1, 1) else f"{d['ip']}#u{universe}c{channel}"
    first = int(d.get("first") or 1)
    return f"{d['ip']}#{first}" if d.get("kind") == "ddp" and first > 1 else d["ip"]


class DdpDevice(OutputDevice):
    """A light sent each frame over DDP: WLED, or a pixel controller (FPP, ESPixelStick, ESPHome...).
    There's no mode to switch on or off: the receiver shows frames as they arrive and goes back to
    what it was doing a little after they stop."""

    def __init__(self, ip: str, *args, **kwargs):
        ip, _, first = ip.partition("#")
        super().__init__(ip, *args, **kwargs)
        self.start = (int(first or 1) - 1) * 3  # byte offset of the light's first LED
        self.realtime = False
        self.keepalive = WLED_RESEND_S
        self.sequence = 0

    def _send(self, payload: bytes):
        try:
            self.sock.sendto(payload, (self.ip, DDP_PORT))
        except OSError as e:
            log.debug("[%s] send failed: %s", self.ip, e)

    def enable(self):
        self.enabled_at = time.monotonic()
        self.enabled = True

    def disable(self):
        self.enabled = False
        self.pending = self.last_frame = None

    def play_scene(self, code: int, param: str):
        pass  # Govee scenes don't exist here; the light keeps playing the track's frames

    def end_scene(self):
        pass

    def packet(self, frame: bytes, previous: bytes | None = None) -> bytes:
        return ddp_packets(frame, self.sequence % 15 + 1, self.start)[0]

    def tick(self, now: float):
        if not self.enabled:
            return
        frame = self.pending if self.pending is not None else self.last_frame
        if frame is None or now - self.last_sent < self.min_interval:
            return  # rate limited; latest pending frame wins
        if frame != self.last_frame or now - self.last_sent > self.keepalive:
            self.sequence = self.sequence % 15 + 1
            for p in ddp_packets(frame, self.sequence, self.start):
                self._send(p)
            self.last_frame, self.last_sent = frame, now
        self.pending = None


WledDevice = DdpDevice

# E1.31 receivers let go of a universe they haven't heard for 2.5 s, so a still frame is repeated.
E131_RESEND_S = 1.0


class E131Device(DdpDevice):
    """A light on an E1.31 controller. Its frames go into the controller's shared universes
    (e131.Universes), and each universe it touches is sent whole, with the other lights' channels in it."""

    def __init__(self, ip: str, segments: int, sock: socket.socket, *, universes: e131.Universes, **kwargs):
        ip, _, where = ip.partition("#")
        universe, channel = (int(x) for x in where[1:].split("c")) if where else (1, 1)
        super().__init__(ip, segments, sock, **kwargs)
        self.channel = e131.channel_of(universe, channel)
        self.universes = universes
        self.used: set[int] = set()
        self.keepalive = E131_RESEND_S

    def _send(self, payload: bytes):
        try:
            self.sock.sendto(payload, (self.ip, e131.PORT))
        except OSError as e:
            log.debug("[%s] send failed: %s", self.ip, e)

    def enable(self):
        if not self.enabled:
            self.universes.users += 1
        super().enable()

    def disable(self):
        if self.enabled:
            self.universes.users -= 1
            if self.universes.users <= 0:
                # The last light on the controller is stopping: tell it so, as the standard asks,
                # three times in case one is lost, so it lets go straight away.
                for universe in sorted(self.universes.data):
                    for _ in range(3):
                        self._send(self.universes.packet(universe, terminated=True))
                self.universes.data.clear()
            elif self.last_frame is not None:
                # Other lights on the controller play on: switch just this one's channels off.
                for universe in self.universes.write(self.channel, bytes(len(self.last_frame))):
                    self._send(self.universes.packet(universe))
        super().disable()

    def packet(self, frame: bytes, previous: bytes | None = None) -> bytes:
        universe = next(e131.spans(self.channel, len(frame)))[0]
        return e131.packet(universe, frame[:e131.UNIVERSE_SIZE], 0)

    def tick(self, now: float):
        if not self.enabled:
            return
        frame = self.pending if self.pending is not None else self.last_frame
        if frame is None or now - self.last_sent < self.min_interval:
            return  # rate limited; latest pending frame wins
        if frame != self.last_frame or now - self.last_sent > self.keepalive:
            touched = self.universes.write(self.channel, frame)
            self.used.update(touched)
            for universe in touched:
                self._send(self.universes.packet(universe))
            self.last_frame, self.last_sent = frame, now
        self.pending = None


# Home Assistant lights and switches go through HA's API, so they're slow. Lights get the show's colour
# up to 4 times a second; a switch (often a smart plug's relay, maybe an inflatable) changes at most
# once a second. Each light is put back as it was when it's let go, from a scene snapshot taken first.
HA_LIGHT_INTERVAL_S = 0.25
HA_SWITCH_INTERVAL_S = 1.0
HA_CLOSE = 6  # out of 255: smaller colour changes wait until they add up
HA_SWITCH_ON = 128  # a switch is on while the show is at least half bright there
HA_COLOUR_MODES = {"hs", "xy", "rgb", "rgbw", "rgbww"}


class HaDevice(OutputDevice):
    """A Home Assistant light or switch, one segment. Calls are made one at a time, in order: the
    snapshot, then each change (only the latest waits while one is going), then putting it back."""

    def __init__(self, address: str, segments: int, sock: socket.socket, *, ha=None, tasks=None, **kwargs):
        entity = address.partition(":")[2]
        super().__init__(entity, segments, sock, **kwargs)
        self.entity, self.domain = entity, entity.partition(".")[0]
        self.ha = ha
        self.tasks = tasks if tasks is not None else set()
        self.realtime = False
        self.min_interval = HA_SWITCH_INTERVAL_S if self.domain == "switch" else HA_LIGHT_INTERVAL_S
        self.colour = True
        self.saved = False
        self.shown: tuple | None = None
        self.task: asyncio.Task | None = None

    @property
    def scene_id(self) -> str:
        return "haliday_show_" + self.entity.replace(".", "_")

    def _run(self, make):
        """Queue a call after the ones already going."""
        before = self.task

        async def go():
            if before:
                with contextlib.suppress(Exception, asyncio.CancelledError):
                    await before
            try:
                await make()
            except Exception as e:  # HA unreachable or the entity gone: the show plays on without it
                log.warning("[%s] Home Assistant call failed: %s", self.entity, e)

        self.task = asyncio.get_event_loop().create_task(go())
        self.tasks.add(self.task)
        self.task.add_done_callback(self.tasks.discard)

    def enable(self):
        self.enabled_at = time.monotonic()
        if not self.enabled and self.ha is not None:
            self._run(self._snapshot)
        self.enabled = True

    async def _snapshot(self):
        state = await self.ha.state(self.entity)
        modes = set((state.get("attributes") or {}).get("supported_color_modes") or [])
        self.colour = self.domain == "light" and bool(modes & HA_COLOUR_MODES)
        await self.ha.call("scene", "create", {"scene_id": self.scene_id, "snapshot_entities": [self.entity]})
        self.saved = True

    def disable(self):
        if self.enabled and self.ha is not None:
            self._run(self._restore)
        self.enabled = False
        self.pending = self.last_frame = self.shown = None

    async def _restore(self):
        if self.saved:
            await self.ha.call("scene", "turn_on", {"entity_id": f"scene.{self.scene_id}"})

    def play_scene(self, code: int, param: str):
        pass

    def end_scene(self):
        pass

    def state_for(self, frame: bytes) -> tuple:
        r, g, b = average(frame)
        level = max(r, g, b)
        if self.domain == "switch":
            return ("on",) if level >= HA_SWITCH_ON else ("off",)
        if level < 3:
            return ("off",)
        return ("on", r, g, b)

    def _changed(self, state: tuple) -> bool:
        if self.shown is None or state[0] != self.shown[0] or len(state) != len(self.shown):
            return True
        return any(abs(a - b) > HA_CLOSE for a, b in zip(state[1:], self.shown[1:]))

    def packet(self, frame: bytes, previous: bytes | None = None) -> bytes:
        return repr(self.state_for(frame)).encode()

    async def _send_state(self, state: tuple):
        domain = "switch" if self.domain == "switch" else "light"
        if state[0] == "off":
            await self.ha.call(domain, "turn_off", {"entity_id": self.entity})
            return
        data = {"entity_id": self.entity}
        if domain == "light":
            r, g, b = state[1:]
            level = max(r, g, b)
            data.update(brightness=level, transition=0)
            if self.colour:
                data["rgb_color"] = [v * 255 // level for v in (r, g, b)]
        await self.ha.call(domain, "turn_on", data)

    def tick(self, now: float):
        if not self.enabled or self.ha is None:
            return
        if self.task is not None and not self.task.done():
            return  # a call is still going; the latest frame waits for it
        frame = self.pending if self.pending is not None else self.last_frame
        if frame is None or now - self.last_sent < self.min_interval:
            return
        state = self.state_for(frame)
        if self._changed(state):
            self._run(lambda: self._send_state(state))
            self.shown, self.last_sent = state, now
        self.last_frame, self.pending = frame, None


def make_device(ip: str, segments: int, sock: socket.socket, *, universes=None, ha=None, tasks=None,
                **kwargs) -> OutputDevice:
    if kwargs.get("protocol") in ("ha_light", "ha_switch"):
        return HaDevice(ip, segments, sock, ha=ha, tasks=tasks, **kwargs)
    if kwargs.get("protocol") == "e131":
        return E131Device(ip, segments, sock, universes=universes, **kwargs)
    cls = DdpDevice if kwargs.get("protocol") == "ddp" else OutputDevice
    return cls(ip, segments, sock, **kwargs)


class Output:
    """Owns the UDP socket and ticks every claimed device."""

    def __init__(self):
        self.sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self.sock.setblocking(False)
        self.devices: dict[str, OutputDevice] = {}
        self.universes: dict[str, e131.Universes] = {}  # E1.31 controller IP -> its universes
        self.ha = None  # the Home Assistant client, for HA lights and switches
        self.ha_tasks: set[asyncio.Task] = set()  # their calls still going, finished before closing
        self._task: asyncio.Task | None = None

    def start(self):
        self._task = asyncio.create_task(self._loop())

    async def close(self):
        self.release_all()
        if self.ha_tasks:  # let HA lights be put back as they were before the client closes
            await asyncio.wait(set(self.ha_tasks), timeout=5)
        if self._task:
            self._task.cancel()
        self.sock.close()

    def claim(self, ip: str, segments: int, *, reverse=False, gradient=False,
              protocol="standard", brightness=100) -> OutputDevice:
        dev = self.devices.get(ip)
        if dev:
            dev.brightness = brightness  # takes effect from the next frame, no need to restart
        if dev and dev.segments != segments and (dev.reverse, dev.gradient, dev.protocol) == (reverse, gradient, protocol):
            # Only the length changed: keep realtime mode on rather than switching off and on again.
            dev.segments, dev.pending, dev.last_frame = segments, None, None
        if dev is None or (dev.segments, dev.reverse, dev.gradient, dev.protocol) != (segments, reverse, gradient, protocol):
            if dev:
                dev.disable()
            universes = self.universes.setdefault(ip.partition("#")[0], e131.Universes()) if protocol == "e131" else None
            dev = make_device(ip, segments, self.sock, reverse=reverse, gradient=gradient, protocol=protocol,
                              brightness=brightness, universes=universes,
                              **(dict(ha=self.ha, tasks=self.ha_tasks) if protocol.startswith("ha_") else {}))
            self.devices[ip] = dev
        if not dev.enabled:
            dev.enable()
        return dev

    def release(self, ip: str):
        dev = self.devices.pop(ip, None)
        if dev:
            dev.disable()

    def release_all(self):
        for ip in list(self.devices):
            self.release(ip)

    async def _loop(self):
        while True:
            now = time.monotonic()
            for dev in list(self.devices.values()):
                dev.tick(now)
            await asyncio.sleep(0.004)


def test_frame(segments: int, t: float) -> bytes:
    """Rainbow with a moving white dot that shows segment order and direction.

    A light with one segment (a Home Assistant light) has nowhere for the dot, so it just goes round
    the colours."""
    if segments == 1:
        r, g, b = colorsys.hsv_to_rgb((t * 0.2) % 1, 1, 1)
        return bytes([int(r * 255), int(g * 255), int(b * 255)])
    buf = bytearray()
    dot = int(t * 4) % segments
    for i in range(segments):
        if i == dot:
            buf += b"\xff\xff\xff"
        else:
            r, g, b = colorsys.hsv_to_rgb((i / segments + t * 0.2) % 1, 1, 1)
            buf += bytes([int(r * 255), int(g * 255), int(b * 255)])
    return bytes(buf)


async def run_test_pattern(output: Output, ip: str, segments: int, seconds: float = 15,
                           *, reverse=False, gradient=False, protocol="standard", brightness=100,
                           fps: int = 30):
    dev = output.claim(ip, segments, reverse=reverse, gradient=gradient, protocol=protocol,
                       brightness=brightness)
    # Logged so a light that ignores the pattern can be compared against other tools.
    first = test_frame(segments, 0)
    if dev.realtime:
        packet = razer_colors(first, gradient, protocol).hex(" ")
    elif isinstance(dev, HaDevice):
        packet = dev.packet(first).decode()
    elif isinstance(dev, E131Device):
        packet = dev.packet(first)[:16].hex(" ") + " …"
    elif isinstance(dev, DdpDevice):
        packet = dev.packet(first)[:10].hex(" ") + " …"
    else:
        packet = dev.packet(first).decode()
    log.info("Test pattern on %s (%s): %d segments, first colour packet %s", ip, protocol, segments, packet)
    t0 = time.monotonic()
    try:
        while (t := time.monotonic() - t0) < seconds:
            dev.update(test_frame(segments, t))
            await asyncio.sleep(1 / fps)
    finally:
        output.release(ip)


async def run_hold(output: Output, ip: str, rgb: bytes, segments: int, seconds: float = 60, **settings):
    """Show one still frame (a light's parts, from the Devices tab) until it times out or is replaced."""
    output.claim(ip, segments, **settings).update(rgb)
    await asyncio.sleep(seconds)
    output.release(ip)


PROBE_MAX = 128  # the most segments Find segments will look for


def probe_frame(segment: int) -> bytes:
    """Every segment up to and including `segment` (1-based) off except that one, lit white."""
    return b"\0\0\0" * (segment - 1) + b"\xff\xff\xff"


async def run_probe(output: Output, ip: str, segment: int, seconds: float = 300,
                    *, gradient=False, protocol="standard"):
    """Light only segment `segment` and hold it, so someone can say whether the light has that many.

    The frame is exactly `segment` long: a light with fewer segments has nowhere to show the white one.
    """
    dev = output.claim(ip, segment, gradient=gradient, protocol=protocol)
    dev.update(probe_frame(segment))
    # Cancelled means the next question has started: keep the light in realtime mode for it rather
    # than switching it off in between. It is only released when Find stops or times out.
    await asyncio.sleep(seconds)
    output.release(ip)


class LivePreview:
    """Frames pushed from the editor while a clip is being edited, so it can be seen on the real light.

    The editor sends a frame every so often while the preview is on; once they stop for IDLE_S the
    light is let go and goes back to whatever it was doing.
    """

    IDLE_S = 1.5

    def __init__(self, output: Output, ip: str):
        self.output, self.ip = output, ip
        self.last = time.monotonic()
        self.task = asyncio.create_task(self._watch())

    def show(self, rgb: bytes, segments: int, **settings):
        self.output.claim(self.ip, segments, **settings).update(rgb)
        self.last = time.monotonic()

    def stop(self):
        self.task.cancel()
        self.output.release(self.ip)

    async def _watch(self):
        while time.monotonic() - self.last < self.IDLE_S:
            await asyncio.sleep(0.1)
        self.output.release(self.ip)
