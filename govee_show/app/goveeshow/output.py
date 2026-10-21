"""Stream per-segment colours to Govee devices over the razer protocol.

Each device is rate limited (latest frame wins) and kept in razer mode by streaming
frames continuously. Razer-on is only sent while a light starts up: repeating it later
makes some lights blink.
"""
import asyncio
import colorsys
import logging
import socket
import time

from .protocol import (CMD_PORT, average, colorwc_msg, ptreal_msg, razer_colors, razer_enable, razer_msg,
                       scene_packets, segment_changes, segment_colour_packet, segment_colour_packets, wrap)

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


class OutputDevice:
    def __init__(self, ip: str, segments: int, sock: socket.socket, *,
                 reverse: bool = False, gradient: bool = False, protocol: str = "standard",
                 brightness: int = 100, max_fps: int = MAX_FPS):
        self.ip = ip
        self.brightness = brightness  # per-light cap, 1-100, applied to every frame
        self.protocol = protocol
        self.realtime = protocol not in ("whole", "segments")
        if not self.realtime:
            max_fps = min(max_fps, SEGMENTS_FPS if protocol == "segments" else WHOLE_FPS)
        self.keepalive = SEGMENTS_RESEND_S if protocol == "segments" else KEEPALIVE_S
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
        if not self.realtime:
            return colorwc_msg(*average(frame))
        return razer_msg(razer_colors(frame, self.gradient, self.protocol))

    def tick(self, now: float):
        if not self.enabled or self.scene is not None:
            return
        if self.protocol == "segments":
            return self._tick_segments(now)
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


class Output:
    """Owns the UDP socket and ticks every claimed device."""

    def __init__(self):
        self.sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self.sock.setblocking(False)
        self.devices: dict[str, OutputDevice] = {}
        self._task: asyncio.Task | None = None

    def start(self):
        self._task = asyncio.create_task(self._loop())

    async def close(self):
        self.release_all()
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
            dev = OutputDevice(ip, segments, self.sock, reverse=reverse, gradient=gradient, protocol=protocol,
                               brightness=brightness)
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
    """Rainbow with a moving white dot that shows segment order and direction."""
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
    packet = razer_colors(first, gradient, protocol).hex(" ") if dev.realtime else dev.packet(first).decode()
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
