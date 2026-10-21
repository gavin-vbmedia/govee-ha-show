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


def test_scene_packets_match_govee2mqtt():
    # Govee's "Forest" scene, as encoded by govee2mqtt's own test.
    param = ("AyYAAQAKAgH/GQG0CgoCyBQF//8AAP//////AP//lP8AFAGWAAAAACMAAg8FAgH/FAH7AAAB+goEBP8AtP8AR///4/8AAAAA"
             "AAAAABoAAAABAgH/BQHIFBQC7hQBAP8AAAAAAAAAAA==")
    expected = """
a3 00 01 07 02 03 26 00 01 00 0a 02 01 ff 19 01 b4 0a 0a d9
a3 01 02 c8 14 05 ff ff 00 00 ff ff ff ff ff 00 ff ff 94 12
a3 02 ff 00 14 01 96 00 00 00 00 23 00 02 0f 05 02 01 ff 0a
a3 03 14 01 fb 00 00 01 fa 0a 04 04 ff 00 b4 ff 00 47 ff b3
a3 04 ff e3 ff 00 00 00 00 00 00 00 00 1a 00 00 00 01 02 5d
a3 05 01 ff 05 01 c8 14 14 02 ee 14 01 00 ff 00 00 00 00 92
a3 ff 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 5c
33 05 04 d4 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 e6
"""
    assert [p.hex(" ") for p in protocol.scene_packets(212, param)] == expected.strip().splitlines()
    msg = json.loads(protocol.ptreal_msg(protocol.scene_packets(212, param)))["msg"]
    assert msg["cmd"] == "ptReal" and len(msg["data"]["command"]) == 8


def test_segment_colour_packets_match_known_command():
    # Segment 4 blue, as sent to an H8057 in govee-homeassistant (PR #248).
    rgb = bytes(9) + b"\x00\x00\xff" + bytes(18)
    [blue, black] = sorted(protocol.segment_colour_packets(rgb), key=lambda p: p[6] == 0)
    assert blue.hex(" ").startswith("33 05 15 01 00 00 ff 00 00 00 00 00 08 00 00")
    assert black[12:14] == (0b1111110111).to_bytes(2, "little")  # every other segment
    assert all(len(p) == 20 and p[-1] == protocol._ble_packet(p[:19])[-1] for p in (blue, black))


def test_segment_colour_packets_skip_unchanged_segments():
    before = b"\xff\x00\x00" * 3
    after = b"\xff\x00\x00\x00\xff\x00\xff\x00\x00"
    [only] = protocol.segment_colour_packets(after, before)
    assert only[4:7] == b"\x00\xff\x00" and only[12] == 0b010
    assert protocol.segment_colour_packets(after, after) == []
    assert len(protocol.segment_colour_packets(after, before[:3])) == 2  # a resized frame is sent whole
