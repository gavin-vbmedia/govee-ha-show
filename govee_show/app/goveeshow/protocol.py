"""Govee LAN protocol: JSON over UDP, plus the undocumented "razer" realtime mode.

The official LAN API (scan/turn/brightness/colorwc) only sets whole-device colour
and fades every change. The razer command, used by Razer Chroma and Govee Desktop,
gives per-segment realtime control and is what the player streams.

Razer packet: BB <len hi> <len lo> <cmd> <data...> <xor checksum of all preceding bytes>
  0xB1 enable  data = 01 (on) / 00 (off)
  0xB0 colours data = <gradient flag> <segment count> <r g b ...>
"""
import base64
import json
import struct

GOVEE_MCAST = "239.255.255.250"
SCAN_PORT, REPLY_PORT, CMD_PORT = 4001, 4002, 4003

CMD_COLORS = 0xB0
CMD_ENABLE = 0xB1


def frame(cmd: int, data: bytes) -> bytes:
    body = bytes([0xBB]) + struct.pack(">H", len(data)) + bytes([cmd]) + data
    cs = 0
    for b in body:
        cs ^= b
    return body + bytes([cs])


def razer_enable(on: bool = True) -> bytes:
    return frame(CMD_ENABLE, bytes([1 if on else 0]))  # on = BB 00 01 B1 01 0A


def razer_colors(rgb: bytes, gradient: bool = False) -> bytes:
    # VERIFY against OpenRGB's Govee controller if colours look wrong.
    n = len(rgb) // 3
    return frame(CMD_COLORS, bytes([1 if gradient else 0, n]) + bytes(rgb[: n * 3]))


def wrap(cmd: str, data: dict) -> bytes:
    return json.dumps({"msg": {"cmd": cmd, "data": data}}, separators=(",", ":")).encode()


def razer_msg(pkt: bytes) -> bytes:
    return wrap("razer", {"pt": base64.b64encode(pkt).decode()})


def scan_msg() -> bytes:
    return wrap("scan", {"account_topic": "reserve"})
