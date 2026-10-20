import base64
import json

from goveeshow import protocol


def test_enable_packet_matches_known_bytes():
    assert protocol.razer_enable(True) == bytes.fromhex("BB0001B1010A")
    assert base64.b64encode(protocol.razer_enable(True)).decode() == "uwABsQEK"


def test_checksum_is_xor_of_preceding_bytes():
    pkt = protocol.razer_colors(bytes([255, 0, 0, 0, 255, 0]))
    cs = 0
    for b in pkt[:-1]:
        cs ^= b
    assert pkt[-1] == cs
    assert pkt[:4] == bytes([0xBB, 0x00, 2 + 6, 0xB0])
    assert pkt[4:6] == bytes([1, 2])  # gradient off, two segments (matches OpenRGB)
    assert protocol.razer_colors(bytes(3), gradient=True)[4] == 0


def test_colors_truncate_partial_segment():
    pkt = protocol.razer_colors(bytes(7))
    assert pkt[5] == 2 and len(pkt) == 4 + 2 + 6 + 1


def test_razer_msg_wraps_base64_payload():
    msg = json.loads(protocol.razer_msg(b"\x01\x02"))
    assert msg == {"msg": {"cmd": "razer", "data": {"pt": "AQI="}}}
