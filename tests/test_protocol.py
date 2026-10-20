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


def test_razer_variant_uses_fixed_header():
    pkt = protocol.razer_colors(bytes([1, 2, 3, 4, 5, 6]), variant="razer")
    assert pkt[:6] == bytes([0xBB, 0x00, 0x0E, 0xB0, 0x01, 0x02])
    assert pkt[6:12] == bytes([1, 2, 3, 4, 5, 6])
    cs = 0
    for b in pkt[:-1]:
        cs ^= b
    assert pkt[-1] == cs


def test_v2_variant_adds_zone_bytes():
    rgb = bytes(range(40 * 3))
    pkt = protocol.razer_colors(rgb, variant="v2")
    assert pkt[:6] == bytes([0xBB, 0x00, 2 + 4 * 40, 0xB4, 0x01, 40])
    assert pkt[6:10] == bytes([0, 1, 2, 1])
    assert pkt[6 + 36 * 4: 6 + 37 * 4] == bytes([108, 109, 110, 2])


def test_colorwc_uses_average_colour():
    msg = json.loads(protocol.colorwc_msg(*protocol.average(bytes([255, 0, 0, 0, 0, 255]))))
    assert msg["msg"]["cmd"] == "colorwc"
    assert msg["msg"]["data"]["color"] == {"r": 127, "g": 0, "b": 127}
