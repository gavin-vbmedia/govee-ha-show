"""Play a baked show, following the browser's audio clock.

The browser plays the song and posts its position; the player keeps a monotonic
start time and nudges it when the reported position drifts too far.
"""
import asyncio
import logging
import time

from .baked import Baked
from .output import Output

log = logging.getLogger(__name__)

RESYNC_S = 0.04  # re-anchor when the browser and player disagree by more than this


class Player:
    def __init__(self, output: Output):
        self.output = output
        self.baked: Baked | None = None
        self.show_id: str | None = None
        self.devices: dict = {}
        self.start = 0.0  # monotonic time of position 0
        self.offset = 0.0  # seconds to shift lights against audio (+ = lights later)
        self._task: asyncio.Task | None = None

    @property
    def playing(self) -> bool:
        return self._task is not None and not self._task.done()

    def position(self) -> float:
        return time.monotonic() - self.start if self.playing else 0.0

    def status(self) -> dict:
        return {"playing": self.playing, "show": self.show_id,
                "position": round(self.position(), 3),
                "duration": self.baked.duration if self.baked else 0}

    async def play(self, show_id: str, baked: Baked, devices: dict, position: float = 0.0,
                   offset: float = 0.0):
        """devices maps a track's device id to its stored config (ip, reverse, gradient)."""
        await self.stop(release=False)
        self.baked, self.show_id, self.devices, self.offset = baked, show_id, devices, offset
        claimed = set()
        for t in baked.tracks:
            d = devices.get(t.device)
            if d:
                self.output.claim(d["ip"], t.segments, reverse=d.get("reverse", False),
                                  gradient=d.get("gradient", False))
                claimed.add(d["ip"])
        for ip in set(self.output.devices) - claimed:
            self.output.release(ip)
        self.start = time.monotonic() - position
        self._task = asyncio.create_task(self._run())

    def sync(self, position: float) -> float:
        """Return the drift seen (player minus browser), re-anchoring if needed."""
        if not self.playing:
            return 0.0
        drift = self.position() - position
        if abs(drift) > RESYNC_S:
            self.start = time.monotonic() - position
        return drift

    async def stop(self, release: bool = True):
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None
        if release:
            self.output.release_all()

    async def _run(self):
        b = self.baked
        frame_s = 1.0 / b.fps
        last = -1
        while True:
            idx = int((time.monotonic() - self.start - self.offset) * b.fps)
            if idx >= b.frames:
                break
            if idx >= 0 and idx != last:
                for t in b.tracks:
                    d = self.devices.get(t.device)
                    if d:
                        dev = self.output.devices.get(d["ip"])
                        if dev:
                            dev.update(b.track_frame(t, idx))
                last = idx
            await asyncio.sleep(frame_s / 4)
        log.info("show %s finished", self.show_id)
        self.output.release_all()
