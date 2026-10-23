"""WLED lights: frames go out over DDP, and the light's name, LED count and segments come from its JSON API.

DDP rather than WLED's own UDP realtime protocol: it has no per-packet LED limit (a frame is simply
split across packets), WLED hears it on its own port without any setup, and WLED goes back to its
own effect by itself a few seconds after the frames stop. See docs/wled.md.
"""
import asyncio
import logging

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


def ddp_packets(rgb: bytes, sequence: int) -> list[bytes]:
    """One frame as DDP packets. `sequence` is 1-15; WLED uses it to drop stale packets."""
    packets = []
    for offset in range(0, max(len(rgb), 1), DDP_MAX_DATA):
        data = rgb[offset: offset + DDP_MAX_DATA]
        last = offset + DDP_MAX_DATA >= len(rgb)
        header = bytes([DDP_FLAGS | (DDP_PUSH if last else 0), sequence & 0x0F, DDP_RGB, DDP_OUTPUT])
        packets.append(header + offset.to_bytes(4, "big") + len(data).to_bytes(2, "big") + data)
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
