"""Packet lab: send hand-made messages to one light and watch what comes back, to try out commands
the add-on doesn't know yet (Setup → Settings → Packet lab). Only lights on the Devices tab can be
sent to, and only for a limited time.
"""
import asyncio
import json
import socket
import time

from .listen import describe
from .protocol import CMD_PORT, REPLY_PORT, _ble_packet, frame, razer_enable, razer_msg, ptreal_msg

KINDS = ("json", "razer", "ptreal")
MAX_REPEAT = 1200
MAX_LOG = 200


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


class Lab:
    """One send run at a time: the message `repeat` times, `interval` seconds apart, with replies
    from the light logged as they arrive (and for a couple of seconds after)."""

    def __init__(self):
        self.log: list[dict] = []
        self.sent = 0
        self.task: asyncio.Task | None = None
        self.ip = ""

    @property
    def running(self) -> bool:
        return self.task is not None and not self.task.done()

    def stop(self):
        if self.task:
            self.task.cancel()

    def start(self, ip: str, payload: bytes, repeat: int, interval: float, realtime_on: bool):
        self.stop()
        self.log, self.sent, self.ip, self.t0 = [], 0, ip, time.monotonic()
        self.task = asyncio.create_task(self._run(payload, repeat, interval, realtime_on))

    def _note(self, direction: str, data: bytes):
        if len(self.log) >= MAX_LOG:
            self.log.pop(1)  # keep the first send for reference
        d = describe(data)
        if "decoded" in d:  # razer and ptReal: show the packets, not their base64
            text = f'{d["json"]["msg"]["cmd"]}: ' + " | ".join(d["decoded"])
        else:
            text = json.dumps(d["json"]) if "json" in d else d["hex"]
        self.log.append({"t": round(time.monotonic() - self.t0, 3), "dir": direction, "text": text[:2000]})

    async def _run(self, payload: bytes, repeat: int, interval: float, realtime_on: bool):
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
            if realtime_on:
                on = razer_msg(razer_enable(True))
                tx.sendto(on, (self.ip, CMD_PORT))
                self._note("sent", on)
                await asyncio.sleep(0.1)
            for i in range(repeat):
                tx.sendto(payload, (self.ip, CMD_PORT))
                self.sent += 1
                if i < 3 or i == repeat - 1:
                    self._note("sent", payload)
                if i < repeat - 1:
                    await asyncio.sleep(interval)
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
        return {"running": self.running, "ip": self.ip, "sent": self.sent, "log": self.log}
