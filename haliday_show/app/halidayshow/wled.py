"""WLED lights: frames go out over DDP, and the light's name, LED count and segments come from its JSON API.

DDP rather than WLED's own UDP realtime protocol: it has no per-packet LED limit (a frame is simply
split across packets), WLED hears it on its own port without any setup, and WLED goes back to its
own effect by itself a few seconds after the frames stop. See docs/wled.md.
"""
import asyncio
import logging
import socket
import struct

import aiohttp

log = logging.getLogger(__name__)

DDP_PORT = 4048
HTTP_PORT = 80  # tests point this at a fake WLED
DDP_FLAGS = 0x40  # protocol version 1
DDP_PUSH = 0x01  # set on a frame's last packet: show what's arrived
DDP_RGB = 0x0B  # 8-bit RGB
DDP_OUTPUT = 0x01  # the light's default output
DDP_MAX_DATA = 480 * 3  # 480 LEDs a packet keeps each one well inside a normal network packet
MAX_PARTS = 32  # matches server.MAX_PARTS


def ddp_packets(rgb: bytes, sequence: int, start: int = 0) -> list[bytes]:
    """One frame as DDP packets. `sequence` is 1-15; receivers use it to drop stale packets. `start` is
    the byte the frame begins at on the receiver, for a controller with several strings on one IP."""
    packets = []
    for offset in range(0, max(len(rgb), 1), DDP_MAX_DATA):
        data = rgb[offset: offset + DDP_MAX_DATA]
        last = offset + DDP_MAX_DATA >= len(rgb)
        header = bytes([DDP_FLAGS | (DDP_PUSH if last else 0), sequence & 0x0F, DDP_RGB, DDP_OUTPUT])
        packets.append(header + (start + offset).to_bytes(4, "big") + len(data).to_bytes(2, "big") + data)
    return packets


def parts_from_segments(segments: list, leds: int) -> list[dict]:
    """WLED's own segments as parts (1-based, inclusive). One segment covering the strip isn't a split."""
    parts = []
    for i, s in enumerate(segments or []):
        try:
            start, stop = int(s.get("start", 0)), int(s.get("stop", 0))
        except (AttributeError, TypeError, ValueError):
            continue
        start, stop = max(start, 0), min(stop, leds)
        if stop <= start or any(p["from"] <= stop and start + 1 <= p["to"] for p in parts):
            continue
        name = str(s.get("n") or f"Segment {i + 1}")[:64]
        parts.append({"id": f"w{s.get('id', i)}", "name": name, "from": start + 1, "to": stop})
    parts.sort(key=lambda p: p["from"])
    if len(parts) == 1 and parts[0]["from"] == 1 and parts[0]["to"] == leds:
        return []
    return parts[:MAX_PARTS]


class WledError(Exception):
    pass


async def fetch(ip: str, timeout: float = 4.0) -> dict:
    """The light's name, LED count and segments (as parts)."""
    url = f"http://{ip}:{HTTP_PORT}/json"
    try:
        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=timeout)) as s:
            async with s.get(url) as r:
                if r.status != 200:
                    raise WledError(f"{ip} answered {r.status}; is it a WLED light?")
                body = await r.json(content_type=None)
    except (aiohttp.ClientError, asyncio.TimeoutError, ValueError) as e:
        raise WledError(f"no WLED light answered at {ip}") from e
    try:
        info, state = body["info"], body.get("state") or {}
        leds = int(info["leds"]["count"])
    except (KeyError, TypeError, ValueError):
        raise WledError(f"{ip} didn't answer like a WLED light")
    return {"name": str(info.get("name") or "WLED")[:64], "leds": leds,
            "version": str(info.get("ver") or ""),
            "parts": parts_from_segments(state.get("seg"), leds)}


# Finding WLED lights: they announce themselves over mDNS as _wled._tcp, which is how the WLED app
# finds them. One question to the mDNS group asks every WLED to answer, straight back to us (the "QU"
# bit), and any answer that mentions _wled comes from a WLED, so its sender is the light's IP. Each one
# is then asked for its name and LEDs, which also weeds out anything that isn't really a WLED.
MDNS = ("224.0.0.251", 5353)
SERVICE = b"_wled"


def mdns_query() -> bytes:
    name = b"".join(bytes([len(p)]) + p for p in (b"_wled", b"_tcp", b"local")) + b"\0"
    return struct.pack(">6H", 0, 0, 1, 0, 0, 0) + name + struct.pack(">2H", 12, 0x8001)  # PTR, QU


class _Answers(asyncio.DatagramProtocol):
    def __init__(self):
        self.ips: set[str] = set()

    def datagram_received(self, data, addr):
        # A response (QR bit set) that names the WLED service.
        if len(data) > 12 and data[2] & 0x80 and SERVICE in data.lower():
            self.ips.add(addr[0])


async def scan(timeout: float = 2.5, to=MDNS) -> list[dict]:
    """WLED lights on the network: [{ip, name, leds, parts, version}], in IP order."""
    loop = asyncio.get_running_loop()
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.setsockopt(socket.IPPROTO_IP, socket.IP_MULTICAST_TTL, 255)
    sock.bind(("", 0))
    sock.setblocking(False)
    transport, answers = await loop.create_datagram_endpoint(_Answers, sock=sock)
    try:
        for _ in range(2):  # twice: busy Wi-Fi drops the odd multicast packet
            transport.sendto(mdns_query(), to)
            await asyncio.sleep(timeout / 2)
    except OSError as e:
        log.warning("WLED scan failed: %s", e)
    finally:
        transport.close()
    found = await asyncio.gather(*(fetch(ip) for ip in answers.ips), return_exceptions=True)
    lights = [{"ip": ip, **f} for ip, f in zip(answers.ips, found) if isinstance(f, dict)]
    return sorted(lights, key=lambda d: socket.inet_aton(d["ip"]))
