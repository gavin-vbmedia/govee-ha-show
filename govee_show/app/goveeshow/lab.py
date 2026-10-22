"""Packet lab: send hand-made messages to one light and watch what comes back, to try out commands
the add-on doesn't know yet (Setup → Settings → Packet lab). Only lights on the Devices tab can be
sent to, and only for a limited time.
"""
import asyncio
import json
import socket
import time

from .listen import describe
from .output import PIXELS_GAP_S, PIXELS_PER_MESSAGE
from .protocol import pixel_packets
from .protocol import CMD_PORT, REPLY_PORT, _ble_packet, frame, razer_enable, razer_msg, ptreal_msg

KINDS = ("json", "razer", "ptreal")
MAX_REPEAT = 1200
MAX_LOG = 200
MAX_STEPS = 20
STEP_GAP_S = 1.5  # realtime off between sweep steps, so each starts from the light's own scene


class LabError(ValueError):
    pass


def _hex(text: str) -> bytes:
    try:
        return bytes.fromhex(" ".join(text.replace(",", " ").split()))
    except ValueError:
        raise LabError("not valid hex") from None


def build(kind: str, text: str, length: int | None = None) -> bytes:
    """The UDP payload for one send.

    json    a whole LAN message, e.g. {"msg":{"cmd":"devStatus","data":{}}}
    razer   the command byte and its data in hex (e.g. "b0 01 02 ff0000 00ff00"); the BB header,
            length and checksum are added. `length` overrides the length field, as the Razer
            variant does.
    ptreal  one or more lines of hex, each a 20-byte packet; shorter lines are padded and given
            their checksum.
    """
    if kind == "json":
        try:
            msg = json.loads(text)
        except ValueError as e:
            raise LabError(f"not valid JSON: {e}") from None
        if not isinstance(msg, dict):
            raise LabError("JSON must be an object")
        return json.dumps(msg, separators=(",", ":")).encode()
    if kind == "razer":
        body = _hex(text)
        if not body:
            raise LabError("razer needs at least the command byte")
        pkt = frame(body[0], body[1:])
        if length is not None:
            pkt = bytearray(pkt[:-1])
            pkt[1:3] = length.to_bytes(2, "big")
            cs = 0
            for b in pkt:
                cs ^= b
            pkt = bytes(pkt) + bytes([cs])
        return razer_msg(pkt)
    if kind == "ptreal":
        packets = []
        for line in text.splitlines():
            if not line.strip():
                continue
            raw = _hex(line)
            if len(raw) > 20:
                raise LabError("each ptReal line is at most 20 bytes")
            packets.append(raw if len(raw) == 20 else _ble_packet(raw[:19]))
        if not packets:
            raise LabError("ptReal needs at least one line of hex")
        return ptreal_msg(packets)
    raise LabError(f"type must be one of {', '.join(KINDS)}")


class Step:
    """`more`: further messages sent after the payload, PIXELS_GAP_S apart (a per-bulb picture too big
    for one). `every`: start the next step this long after this one started, without switching
    realtime off in between (the per-bulb speed test)."""

    def __init__(self, payload: bytes, repeat: int = 1, interval: float = 0.1, realtime_on: bool = False,
                 label: str = "", more: list[bytes] | None = None, every: float | None = None):
        self.payload, self.repeat, self.interval = payload, repeat, interval
        self.realtime_on, self.label = realtime_on, label
        self.more, self.every = more or [], every


def pixel_speed_steps(bulbs: int, small: bool, per_second: float, seconds: float = 6) -> list[Step]:
    """Two per-bulb pictures in turn, red then blue, `per_second` pictures a second: just the first
    10 bulbs, or every bulb. Whether the light keeps up shows how fast it takes pictures, and whether
    the size of a picture matters."""
    lit = min(bulbs, 10) if small else bulbs
    steps = []
    for k in range(max(1, round(per_second * seconds))):
        colour = b"\xff\x00\x00" if k % 2 == 0 else b"\x00\x00\xff"
        frame = colour * lit + bytes(3 * (bulbs - lit))
        packets = pixel_packets(frame)
        msgs = [ptreal_msg(packets[i: i + PIXELS_PER_MESSAGE]) for i in range(0, len(packets), PIXELS_PER_MESSAGE)]
        steps.append(Step(msgs[0], more=msgs[1:], every=1 / per_second,
                          label=f"{'red' if k % 2 == 0 else 'blue'}, {len(packets)} packets"))
    return steps


class Lab:
    """One run at a time: each step's message `repeat` times, `interval` seconds apart, with replies
    from the light logged as they arrive (and for a couple of seconds after). Several steps make a
    sweep: variations tried in turn, with realtime switched off between them."""

    def __init__(self):
        self.log: list[dict] = []
        self.sent = 0
        self.task: asyncio.Task | None = None
        self.ip = ""
        self.steps: list[Step] = []
        self.step = 0

    @property
    def running(self) -> bool:
        return self.task is not None and not self.task.done()

    def stop(self):
        if self.task:
            self.task.cancel()

    def start(self, ip: str, steps: list[Step]):
        self.stop()
        self.log, self.sent, self.ip, self.t0 = [], 0, ip, time.monotonic()
        self.steps, self.step = steps, 0
        self.task = asyncio.create_task(self._run())

    def _note(self, direction: str, data: bytes | str):
        if len(self.log) >= MAX_LOG:
            self.log.pop(1)  # keep the first send for reference
        if isinstance(data, str):
            self.log.append({"t": round(time.monotonic() - self.t0, 3), "dir": "step", "text": data})
            return
        d = describe(data)
        if "decoded" in d:  # razer and ptReal: show the packets, not their base64
            text = f'{d["json"]["msg"]["cmd"]}: ' + " | ".join(d["decoded"])
        else:
            text = json.dumps(d["json"]) if "json" in d else d["hex"]
        self.log.append({"t": round(time.monotonic() - self.t0, 3), "dir": direction, "text": text[:2000]})

    async def _run(self):
        loop = asyncio.get_running_loop()
        tx = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        rx = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        tx.setblocking(False)
        rx.setblocking(False)
        try:
            # Lights answer status and scan messages on the reply port, but some answer the sender.
            rx.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            if hasattr(socket, "SO_REUSEPORT"):
                rx.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEPORT, 1)
            rx.bind(("", REPLY_PORT))
            loop.add_reader(rx, self._receive, rx)
        except OSError:
            rx.close()
            rx = None
        loop.add_reader(tx, self._receive, tx)
        try:
            for k, step in enumerate(self.steps):
                self.step = k
                started = time.monotonic()
                if len(self.steps) > 1 and step.every is None:
                    self._note("step", f"{k + 1} of {len(self.steps)}: {step.label}")
                if step.realtime_on:
                    on = razer_msg(razer_enable(True))
                    tx.sendto(on, (self.ip, CMD_PORT))
                    self._note("sent", on)
                    await asyncio.sleep(0.1)
                for i in range(step.repeat):
                    tx.sendto(step.payload, (self.ip, CMD_PORT))
                    self.sent += 1
                    if (i < 2 or i == step.repeat - 1) and (step.every is None or k < 2):
                        self._note("sent", step.payload)
                    if i < step.repeat - 1:
                        await asyncio.sleep(step.interval)
                for msg in step.more:
                    await asyncio.sleep(PIXELS_GAP_S)
                    tx.sendto(msg, (self.ip, CMD_PORT))
                    self.sent += 1
                if step.every is not None:
                    await asyncio.sleep(max(0.0, step.every - (time.monotonic() - started)))
                elif k < len(self.steps) - 1:
                    tx.sendto(razer_msg(razer_enable(False)), (self.ip, CMD_PORT))
                    await asyncio.sleep(STEP_GAP_S)
            await asyncio.sleep(2)  # replies can lag
        finally:
            for s in (tx, rx):
                if s:
                    loop.remove_reader(s)
                    s.close()

    def _receive(self, s):
        try:
            data, (src, _) = s.recvfrom(65535)
        except OSError:
            return
        if src == self.ip:
            self._note("received", data)

    def status(self) -> dict:
        label = self.steps[self.step].label if self.steps else ""
        return {"running": self.running, "ip": self.ip, "sent": self.sent, "log": self.log,
                "step": self.step + 1, "steps": len(self.steps), "label": label}
