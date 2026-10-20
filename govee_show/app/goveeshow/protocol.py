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
"""
import base64
import json
import struct

GOVEE_MCAST = "239.255.255.250"
SCAN_PORT, REPLY_PORT, CMD_PORT = 4001, 4002, 4003

CMD_COLORS = 0xB0
CMD_ENABLE = 0xB1
CMD_COLORS_V2 = 0xB4

PROTOCOLS = ("standard", "razer", "v2", "whole")


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
