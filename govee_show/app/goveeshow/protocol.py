"""Govee LAN protocol: JSON over UDP, plus the undocumented "razer" realtime mode.

The official LAN API (scan/turn/brightness/colorwc) only sets whole-device colour
and fades every change. The razer command, used by Razer Chroma and Govee Desktop,
gives per-segment realtime control and is what the player streams.

Razer packet: BB <len hi> <len lo> <cmd> <data...> <xor checksum of all preceding bytes>
  0xB1 enable  data = 01 (on) / 00 (off)
  0xB0 colours data = <gradient off flag> <segment count> <r g b ...>
       The flag is 1 for crisp segments (what OpenRGB and SignalRGB send) and 0 to let
       the device blend between segments.
  0xB4 colours, "DreamView v2" used by some newer lights:
       data = <flag> <segment count> <r g b zone ...>, zone 1 for the first 36 segments, then 2

Lights differ in which form they accept, so each device picks a protocol:
  standard  B0 with its true length (OpenRGB)
  razer     B0 with the fixed Razer Chroma header length 0x0E (SignalRGB "Razer")
  v2        B4 with zone bytes (SignalRGB "DreamView V2")
  whole     no realtime mode, the official colorwc command with the average colour
  segments  no realtime mode: the Govee app's own segment colour command (experimental, see
            segment_colour_packets), for lights whose realtime mode doesn't reach every bulb
  pixels    no realtime mode: the Govee app's Finger sketch picture, one colour per bulb
            (experimental, see pixel_packets)
"""
import base64
import json
import struct

GOVEE_MCAST = "239.255.255.250"
SCAN_PORT, REPLY_PORT, CMD_PORT = 4001, 4002, 4003

CMD_COLORS = 0xB0
CMD_ENABLE = 0xB1
CMD_COLORS_V2 = 0xB4

PROTOCOLS = ("standard", "razer", "v2", "whole", "segments", "pixels")
# Protocols that don't pack the segment count into one byte, so a light can have more segments.
LONG_PROTOCOLS = ("whole", "segments", "pixels")


def frame(cmd: int, data: bytes) -> bytes:
    body = bytes([0xBB]) + struct.pack(">H", len(data)) + bytes([cmd]) + data
    cs = 0
    for b in body:
        cs ^= b
    return body + bytes([cs])


def razer_enable(on: bool = True) -> bytes:
    return frame(CMD_ENABLE, bytes([1 if on else 0]))  # on = BB 00 01 B1 01 0A


def razer_colors(rgb: bytes, gradient: bool = False, variant: str = "standard") -> bytes:
    n = len(rgb) // 3
    flag = 0 if gradient else 1
    rgb = bytes(rgb[: n * 3])
    if variant == "v2":
        data = b"".join(rgb[i * 3: i * 3 + 3] + bytes([1 if i < 36 else 2]) for i in range(n))
        return frame(CMD_COLORS_V2, bytes([flag, n]) + data)
    if variant == "razer":
        body = bytes([0xBB, 0x00, 0x0E, CMD_COLORS, flag, n]) + rgb
        cs = 0
        for b in body:
            cs ^= b
        return body + bytes([cs])
    return frame(CMD_COLORS, bytes([flag, n]) + rgb)


def wrap(cmd: str, data: dict) -> bytes:
    return json.dumps({"msg": {"cmd": cmd, "data": data}}, separators=(",", ":")).encode()


def razer_msg(pkt: bytes) -> bytes:
    return wrap("razer", {"pt": base64.b64encode(pkt).decode()})


def colorwc_msg(r: int, g: int, b: int) -> bytes:
    return wrap("colorwc", {"color": {"r": r, "g": g, "b": b}, "colorTemInKelvin": 0})


def average(rgb: bytes) -> tuple[int, int, int]:
    n = len(rgb) // 3
    if not n:
        return 0, 0, 0
    return tuple(sum(rgb[c::3][:n]) // n for c in range(3))


def scan_msg() -> bytes:
    return wrap("scan", {"account_topic": "reserve"})


# Experimental: Govee's built-in scenes over the LAN. The light is sent the same 20-byte packets the
# Govee app sends over Bluetooth, wrapped in the "ptReal" command. A scene is its parameter data
# (from Govee's public scene library, base64) split into "a3" lines, then "33 05 04 <code>" to
# start it. Matches govee2mqtt and https://github.com/AlgoClaw/Govee/blob/main/decoded/explanation
def _ble_packet(data: bytes) -> bytes:
    cs = 0
    for b in data:
        cs ^= b
    return bytes(data).ljust(19, b"\0") + bytes([cs])


def multi_packets(raw: bytes, kind: int) -> list[bytes]:
    """A payload too big for one packet, split into "a3" lines: a3 00 01 <lines> <kind> ..., then
    a3 01, a3 02 ... with the last one numbered ff."""
    data = bytearray([0xA3, 0x00, 0x01, 0x00, kind])
    lines, last_marker = 0, 1
    for b in raw:
        if len(data) % 19 == 0:
            lines += 1
            data.append(0xA3)
            last_marker = len(data)
            data.append(lines)
        data.append(b)
    data[last_marker] = 0xFF  # the last line is marked ff instead of its number
    data[3] = lines + 1
    return [_ble_packet(data[i: i + 19]) for i in range(0, len(data), 19)]


def scene_packets(code: int, param: str) -> list[bytes]:
    packets = multi_packets(base64.b64decode(param) if param else b"", 0x02)
    packets.append(_ble_packet(bytes([0x33, 0x05, 0x04, code & 0xFF, (code >> 8) & 0xFF])))
    return packets


def ptreal_msg(packets: list[bytes]) -> bytes:
    return wrap("ptReal", {"command": [base64.b64encode(p).decode() for p in packets]})


# The command the Govee app sends to colour some of a light's own segments, as seen in govee2mqtt and
# govee-homeassistant: 33 05 15 01 <r g b> 00 00 00 00 00 <segment bitmask, little-endian, bit 0 is
# segment 1>, sent over the LAN with ptReal. The mask has room for 56 segments.
SEGMENT_MASK_MAX = 56


def segment_changes(rgb: bytes, previous: bytes | None = None, close: int = 0) -> list[tuple[bytes, list[int]]]:
    """Segments to recolour, grouped by colour, biggest change first: [(rgb, [segment index, ...])].

    With `previous` (what the light shows now, the same length), segments that differ from it by no
    more than `close` in every channel are left out."""
    n = min(len(rgb) // 3, SEGMENT_MASK_MAX)
    if previous is not None and len(previous) != len(rgb):
        previous = None
    groups: dict[bytes, list[int]] = {}
    weight: dict[bytes, int] = {}
    for i in range(n):
        c = bytes(rgb[i * 3: i * 3 + 3])
        d = 255 if previous is None else max(abs(a - b) for a, b in zip(c, previous[i * 3: i * 3 + 3]))
        if previous is not None and d <= close:
            continue
        groups.setdefault(c, []).append(i)
        weight[c] = weight.get(c, 0) + d
    return sorted(groups.items(), key=lambda g: -weight[g[0]])


def segment_colour_packet(rgb: bytes, segments: list[int]) -> bytes:
    mask = sum(1 << i for i in segments)
    return _ble_packet(bytes([0x33, 0x05, 0x15, 0x01, *rgb, 0, 0, 0, 0, 0]) +
                       mask.to_bytes((max(segments) + 8) // 8, "little"))


def segment_colour_packets(rgb: bytes, previous: bytes | None = None) -> list[bytes]:
    """One packet per colour in the frame, covering every segment that colour. With `previous`
    (the last frame sent, the same length), segments that haven't changed are left out."""
    return [segment_colour_packet(c, segs) for c, segs in segment_changes(rgb, previous)]


# The Govee app's Finger sketch (Christmas String Lights 2, icicles and similar): a picture with a
# colour for any bulb, worked out from a Bluetooth capture of the app (issue #74). It goes as "a3"
# lines of kind 03, then 33 05 0a 20 03 to show it. The picture is
#   <effect> <speed> <brightness> <background r g b> <groups, 2 bytes LE>
#   per group: <bulbs, 2 LE> <r g b> <bulbs from 256 up, 2 LE> <the bulbs below 256, a byte each>
#              <the rest, 2 bytes LE each>
# Effect 0f is the app's Gradient, which with speed 0 holds the picture still (13 twinkles, 14
# breathes). Bulbs not in a group show the background, here black. Bulbs count from 0 at the plug.
PIXEL_EFFECT_STILL = 0x0F
PIXEL_SHOW = bytes([0x33, 0x05, 0x0A, 0x20, 0x03])
PIXEL_MAX_COLOURS = 24  # more colours mean more packets per picture; nearby colours are merged


def _palette(colours: list[bytes], limit: int) -> dict[bytes, bytes]:
    """Map each colour to one of at most `limit` colours: exact if there are few enough, otherwise
    the most used colours (rounded) with the rest moved to the nearest of them."""
    distinct = set(colours)
    if len(distinct) <= limit:
        return {c: c for c in distinct}
    rounded = {c: bytes(v & 0xF0 | 0x08 if v > 8 else 0 for v in c) for c in distinct}
    counts: dict[bytes, int] = {}
    for c in colours:
        counts[rounded[c]] = counts.get(rounded[c], 0) + 1
    keep = sorted(counts, key=lambda k: -counts[k])[:limit]
    def nearest(c):
        return min(keep, key=lambda k: sum((a - b) ** 2 for a, b in zip(c, k)))
    return {c: (rounded[c] if rounded[c] in keep else nearest(rounded[c])) for c in distinct}


def pixel_picture(rgb: bytes, max_colours: int = PIXEL_MAX_COLOURS) -> bytes:
    n = len(rgb) // 3
    colours = [bytes(rgb[i * 3: i * 3 + 3]) for i in range(n)]
    palette = _palette([c for c in colours if any(c)], max_colours)
    groups: dict[bytes, list[int]] = {}
    for i, c in enumerate(colours):
        if any(c) and any(palette[c]):
            groups.setdefault(palette[c], []).append(i)
    out = bytearray([PIXEL_EFFECT_STILL, 0, 100, 0, 0, 0]) + len(groups).to_bytes(2, "little")
    for colour, bulbs in groups.items():
        high = [b for b in bulbs if b > 255]
        out += len(bulbs).to_bytes(2, "little") + colour + len(high).to_bytes(2, "little")
        out += bytes(b for b in bulbs if b <= 255) + b"".join(b.to_bytes(2, "little") for b in high)
    return bytes(out)


def pixel_packets(rgb: bytes, max_colours: int = PIXEL_MAX_COLOURS) -> list[bytes]:
    return multi_packets(pixel_picture(rgb, max_colours), 0x03) + [_ble_packet(PIXEL_SHOW)]
