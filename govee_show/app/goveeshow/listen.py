"""Listen for other Govee traffic on the network, so a format we don't know yet can be worked out.

The case in mind is Govee's Scene Stage, where one light (the sync centre) drives the others with
more detail than the realtime mode gives us. Nothing is sent while listening. Govee's ports are
listened on, with the multicast group joined so a switch forwards it. If the add-on is allowed raw
sockets, every UDP packet to, from or between known lights that reaches this machine is caught too.
Unicast between two other devices never reaches it, so hearing nothing is a possible answer.
"""
import asyncio
import base64
import json
import logging
import socket
import struct
import time

from .protocol import CMD_PORT, GOVEE_MCAST, REPLY_PORT, SCAN_PORT

log = logging.getLogger(__name__)

PORTS = (SCAN_PORT, REPLY_PORT, CMD_PORT)
MAX_RECORDS = 5000
MAX_BYTES = 1500
ETH_P_ALL = 0x0003
PACKET_OUTGOING = 4


def describe(payload: bytes) -> dict:
    """The packet as JSON if it is, with base64 commands (razer, ptReal) also shown as hex."""
    payload = payload[:MAX_BYTES]
    try:
        msg = json.loads(payload)
    except ValueError:
        return {"hex": payload.hex(" ")}
    out = {"json": msg}
    data = msg.get("msg", {}).get("data") if isinstance(msg, dict) and isinstance(msg.get("msg"), dict) else None
    if isinstance(data, dict):
        packets = [data["pt"]] if isinstance(data.get("pt"), str) else data.get("command")
        if isinstance(packets, list) and all(isinstance(p, str) for p in packets):
            try:
                out["decoded"] = [base64.b64decode(p).hex(" ") for p in packets]
            except ValueError:
                pass
    return out


def parse_frame(frame: bytes):
    """(src ip, src port, dst ip, dst port, payload) for an IPv4 UDP Ethernet frame, else None."""
    if len(frame) < 42 or frame[12:14] != b"\x08\x00":
        return None
    ip = frame[14:]
    ihl = (ip[0] & 0x0F) * 4
    if ip[9] != 17 or len(ip) < ihl + 8:
        return None
    total = struct.unpack("!H", ip[2:4])[0]
    sport, dport = struct.unpack("!HH", ip[ihl: ihl + 4])
    return socket.inet_ntoa(ip[12:16]), sport, socket.inet_ntoa(ip[16:20]), dport, bytes(ip[ihl + 8: total])


class Listener:
    def __init__(self, lights: dict[str, str], ports=PORTS, allow_raw: bool = True):
        self.lights = lights  # ip -> name, so the records say which light is which
        self.ports, self.allow_raw = ports, allow_raw
        self.records: list[dict] = []
        self.raw = False
        self.started = self.until = 0.0
        self.task: asyncio.Task | None = None

    @property
    def running(self) -> bool:
        return self.task is not None and not self.task.done()

    def start(self, seconds: float):
        self.records, self.started = [], time.monotonic()
        self.until = self.started + seconds
        self.task = asyncio.create_task(self._run(seconds))

    def stop(self):
        if self.task:
            self.task.cancel()

    def _add(self, via, src, sport, dst, dport, payload):
        if len(self.records) >= MAX_RECORDS:
            return
        self.records.append({"t": round(time.monotonic() - self.started, 3), "via": via,
                             "from": f"{src}:{sport}", "from_light": self.lights.get(src),
                             "to": f"{dst}:{dport}", "to_light": self.lights.get(dst),
                             "bytes": len(payload), **describe(payload)})

    def _wanted(self, src, sport, dst, dport, payload) -> bool:
        return (src in self.lights or dst in self.lights or sport in PORTS or dport in PORTS
                or b'"msg"' in payload[:64])

    async def _run(self, seconds: float):
        loop = asyncio.get_running_loop()
        socks = []
        try:
            raw = self._raw_socket() if self.allow_raw else None
            if raw:
                self.raw = True
                socks.append(raw)
                loop.add_reader(raw, self._read_raw, raw)
            for port in self.ports:
                s = self._udp_socket(port)
                if s:
                    socks.append(s)
                    loop.add_reader(s, self._read_udp, s, port)
            await asyncio.sleep(seconds)
        finally:
            for s in socks:
                loop.remove_reader(s)
                s.close()
            log.info("Listened for Govee traffic: %d packets (raw sockets %s)",
                     len(self.records), "on" if self.raw else "off")

    def _raw_socket(self):
        try:
            s = socket.socket(socket.AF_PACKET, socket.SOCK_RAW, socket.htons(ETH_P_ALL))
        except (OSError, AttributeError) as e:
            log.info("raw sockets not available (%s); listening on Govee's ports only", e)
            return None
        s.setblocking(False)
        return s

    def _udp_socket(self, port):
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            if hasattr(socket, "SO_REUSEPORT"):
                s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEPORT, 1)
            s.bind(("", port))
            mreq = struct.pack("4s4s", socket.inet_aton(GOVEE_MCAST), socket.inet_aton("0.0.0.0"))
            try:
                s.setsockopt(socket.IPPROTO_IP, socket.IP_ADD_MEMBERSHIP, mreq)
            except OSError:
                pass  # no multicast route; unicast and broadcast still arrive
        except OSError as e:
            log.warning("can't listen on UDP %d: %s", port, e)
            s.close()
            return None
        s.setblocking(False)
        return s

    def _read_udp(self, s, port):
        try:
            payload, (src, sport) = s.recvfrom(65535)
        except OSError:
            return
        if not self.raw:  # raw sockets see the same packets, with their destination
            self._add("udp", src, sport, "this machine", port, payload)

    def _read_raw(self, s):
        try:
            frame, addr = s.recvfrom(65535)
        except OSError:
            return
        if addr[2] == PACKET_OUTGOING:
            return
        udp = parse_frame(frame)
        if udp and self._wanted(*udp):
            self._add("raw", *udp)

    def summary(self) -> list[dict]:
        counts: dict[tuple, int] = {}
        for r in self.records:
            msg = r.get("json", {}).get("msg") if isinstance(r.get("json"), dict) else None
            cmd = msg.get("cmd") if isinstance(msg, dict) else None
            key = (r["from_light"] or r["from"].rsplit(":", 1)[0], r["to_light"] or r["to"], cmd or "other")
            counts[key] = counts.get(key, 0) + 1
        return [{"from": f, "to": t, "cmd": c, "count": n}
                for (f, t, c), n in sorted(counts.items(), key=lambda kv: -kv[1])]
