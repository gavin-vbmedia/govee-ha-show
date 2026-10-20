"""Stream per-segment colours to Govee devices over the razer protocol.

Each device is rate limited (latest frame wins), kept in razer mode with a
periodic keepalive, and re-enabled every minute in case it rebooted.
"""
import asyncio
import colorsys
import logging
import socket
import time

from .protocol import CMD_PORT, razer_colors, razer_enable, razer_msg, wrap

log = logging.getLogger(__name__)

KEEPALIVE_S = 20  # device drops out of razer mode after ~60s of silence
REENABLE_S = 60
MAX_FPS = 40


class OutputDevice:
    def __init__(self, ip: str, segments: int, sock: socket.socket, *,
                 reverse: bool = False, gradient: bool = False, max_fps: int = MAX_FPS):
        self.ip = ip
        self.segments = segments
        self.reverse = reverse
        self.gradient = gradient
        self.sock = sock
        self.min_interval = 1.0 / max_fps
        self.pending: bytes | None = None
        self.last_frame: bytes | None = None
        self.last_sent = 0.0
        self.last_enable = 0.0
        self.enabled = False

    def _send(self, payload: bytes):
        try:
            self.sock.sendto(payload, (self.ip, CMD_PORT))
        except OSError as e:
            log.debug("[%s] send failed: %s", self.ip, e)

    def enable(self):
        self._send(wrap("turn", {"value": 1}))
        self._send(wrap("brightness", {"value": 100}))  # let the show own brightness
        self._send(razer_msg(razer_enable(True)))
        self.last_enable = time.monotonic()
        self.enabled = True

    def disable(self):
        if self.enabled:
            self._send(razer_msg(razer_enable(False)))
        self.enabled = False
        self.pending = self.last_frame = None

    def update(self, rgb: bytes):
        n = self.segments * 3
        seg = bytes(rgb[:n]).ljust(n, b"\0")
        if self.reverse:
            seg = b"".join(seg[i: i + 3] for i in range(n - 3, -1, -3))
        self.pending = seg

    def tick(self, now: float):
        if not self.enabled:
            return
        if now - self.last_enable > REENABLE_S:
            self._send(razer_msg(razer_enable(True)))
            self.last_enable = now
        frame = self.pending if self.pending is not None else self.last_frame
        if frame is None or now - self.last_sent < self.min_interval:
            return  # rate limited; latest pending frame wins
        if frame != self.last_frame or now - self.last_sent > KEEPALIVE_S:
            self._send(razer_msg(razer_colors(frame, self.gradient)))
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

    def claim(self, ip: str, segments: int, *, reverse=False, gradient=False) -> OutputDevice:
        dev = self.devices.get(ip)
        if dev is None or dev.segments != segments or dev.reverse != reverse or dev.gradient != gradient:
            if dev:
                dev.disable()
            dev = OutputDevice(ip, segments, self.sock, reverse=reverse, gradient=gradient)
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
                           *, reverse=False, gradient=False, fps: int = 30):
    dev = output.claim(ip, segments, reverse=reverse, gradient=gradient)
    # Logged so a light that ignores the pattern can be compared against other tools.
    log.info("Test pattern on %s: %d segments, first colour packet %s", ip, segments,
             razer_colors(test_frame(segments, 0), gradient).hex(" "))
    t0 = time.monotonic()
    try:
        while (t := time.monotonic() - t0) < seconds:
            dev.update(test_frame(segments, t))
            await asyncio.sleep(1 / fps)
    finally:
        output.release(ip)
