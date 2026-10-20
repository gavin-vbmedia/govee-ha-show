"""Stream per-segment colours to Govee devices over the razer protocol.

Each device is rate limited (latest frame wins), kept in razer mode with a
periodic keepalive, and re-enabled every minute in case it rebooted.
"""
import asyncio
import colorsys
import logging
import socket
import time

from .protocol import CMD_PORT, average, colorwc_msg, razer_colors, razer_enable, razer_msg, wrap

log = logging.getLogger(__name__)

# Some lights drop out of realtime mode within a second or two of the last colour packet, so an
# unchanged frame is re-sent this often. It is a small packet, so this costs next to nothing.
KEEPALIVE_S = 0.5
REENABLE_S = 60
# A light that was off is still starting up when the first razer-on arrives and can ignore it,
# so repeat it often for the first few seconds before settling to once a minute.
STARTUP_S = 5
STARTUP_REENABLE_S = 0.5
MAX_FPS = 40
WHOLE_FPS = 10  # colorwc fades each change, so faster than this just blurs


class OutputDevice:
    def __init__(self, ip: str, segments: int, sock: socket.socket, *,
                 reverse: bool = False, gradient: bool = False, protocol: str = "standard",
                 max_fps: int = MAX_FPS):
        self.ip = ip
        self.protocol = protocol
        self.realtime = protocol != "whole"
        if not self.realtime:
            max_fps = min(max_fps, WHOLE_FPS)
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
        if self.enabled and self.realtime:
            self._send(razer_msg(razer_enable(False)))
        self.enabled = False
        self.pending = self.last_frame = None

    def update(self, rgb: bytes):
        n = self.segments * 3
        seg = bytes(rgb[:n]).ljust(n, b"\0")
        if self.reverse:
            seg = b"".join(seg[i: i + 3] for i in range(n - 3, -1, -3))
        self.pending = seg

    def packet(self, frame: bytes) -> bytes:
        if not self.realtime:
            return colorwc_msg(*average(frame))
        return razer_msg(razer_colors(frame, self.gradient, self.protocol))

    def tick(self, now: float):
        if not self.enabled:
            return
        starting = now - self.enabled_at < STARTUP_S
        if self.realtime and now - self.last_enable > (STARTUP_REENABLE_S if starting else REENABLE_S):
            self._send(razer_msg(razer_enable(True)))
            self.last_enable = now
            self.last_sent = 0.0  # repaint straight after, in case realtime-on reset the light
        frame = self.pending if self.pending is not None else self.last_frame
        if frame is None or now - self.last_sent < self.min_interval:
            return  # rate limited; latest pending frame wins
        if frame != self.last_frame or now - self.last_sent > KEEPALIVE_S:
            self._send(self.packet(frame))
            self.last_frame, self.last_sent = frame, now
        self.pending = None


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
              protocol="standard") -> OutputDevice:
        dev = self.devices.get(ip)
        if dev and dev.segments != segments and (dev.reverse, dev.gradient, dev.protocol) == (reverse, gradient, protocol):
            # Only the length changed: keep realtime mode on rather than switching off and on again.
            dev.segments, dev.pending, dev.last_frame = segments, None, None
        if dev is None or (dev.segments, dev.reverse, dev.gradient, dev.protocol) != (segments, reverse, gradient, protocol):
            if dev:
                dev.disable()
            dev = OutputDevice(ip, segments, self.sock, reverse=reverse, gradient=gradient, protocol=protocol)
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
                           *, reverse=False, gradient=False, protocol="standard", fps: int = 30):
    dev = output.claim(ip, segments, reverse=reverse, gradient=gradient, protocol=protocol)
    # Logged so a light that ignores the pattern can be compared against other tools.
    first = test_frame(segments, 0)
    packet = (razer_colors(first, gradient, protocol).hex(" ") if dev.realtime
              else colorwc_msg(*average(first)).decode())
    log.info("Test pattern on %s (%s): %d segments, first colour packet %s", ip, protocol, segments, packet)
    t0 = time.monotonic()
    try:
        while (t := time.monotonic() - t0) < seconds:
            dev.update(test_frame(segments, t))
            await asyncio.sleep(1 / fps)
    finally:
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
