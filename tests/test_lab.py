import base64
import json

import pytest

from goveeshow import lab, protocol


def decoded(msg: bytes):
    m = json.loads(msg)["msg"]
    return m["cmd"], m["data"]


def test_razer_gets_header_length_and_checksum():
    cmd, data = decoded(lab.build("razer", "b1 01"))
    assert cmd == "razer" and base64.b64decode(data["pt"]) == protocol.razer_enable(True)
    _, data = decoded(lab.build("razer", "b0 01 01 ff0000", length=0x0E))
    pkt = base64.b64decode(data["pt"])
    assert pkt[:3] == b"\xbb\x00\x0e" and pkt[3:-1] == bytes.fromhex("b00101ff0000")
    assert pkt[-1] == protocol.frame(0xB0, bytes.fromhex("0101ff0000"))[-1] ^ 0x05 ^ 0x0E  # length changed


def test_ptreal_lines_are_padded_and_checksummed():
    cmd, data = decoded(lab.build("ptreal", "33 05 15 01 ff 00 00\n\n33 05 04 d4"))
    packets = [base64.b64decode(p) for p in data["command"]]
    assert cmd == "ptReal" and [len(p) for p in packets] == [20, 20]
    assert packets[1] == protocol._ble_packet(bytes.fromhex("330504d4"))


def test_json_is_passed_through_compactly():
    assert lab.build("json", '{ "msg": {"cmd": "devStatus", "data": {}} }') == b'{"msg":{"cmd":"devStatus","data":{}}}'


@pytest.mark.parametrize("kind,text", [("json", "[1]"), ("json", "{"), ("razer", ""), ("razer", "zz"),
                                        ("ptreal", ""), ("ptreal", "00" * 21), ("dmx", "00")])
def test_bad_input_is_refused(kind, text):
    with pytest.raises(lab.LabError):
        lab.build(kind, text)
