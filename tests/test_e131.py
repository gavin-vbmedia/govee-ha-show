import time

from halidayshow import e131, output


class FakeSock:
    def __init__(self):
        self.sent = []

    def sendto(self, payload, addr):
        self.sent.append((payload, addr))


def fake_output():
    out = output.Output.__new__(output.Output)
    out.sock, out.devices, out.universes, out._task = FakeSock(), {}, {}, None
    return out


def parse(p):
    """The fields a receiver reads, checked against the E1.31 layout."""
    assert p[4:16] == b"ASC-E1.17\x00\x00\x00"
    assert int.from_bytes(p[16:18], "big") == 0x7000 | (len(p) - 16)
    assert int.from_bytes(p[38:40], "big") == 0x7000 | (len(p) - 38)
    assert int.from_bytes(p[115:117], "big") == 0x7000 | (len(p) - 115)
    assert p[117:119] == b"\x02\xa1" and p[125] == 0
    count = int.from_bytes(p[123:125], "big")
    assert count == len(p) - 125
    return {"universe": int.from_bytes(p[113:115], "big"), "sequence": p[111], "options": p[112],
            "priority": p[108], "data": p[126:]}


def test_packet_layout():
    f = parse(e131.packet(7, b"\x01\x02\x03", 9))
    assert f == {"universe": 7, "sequence": 9, "options": 0, "priority": 100, "data": b"\x01\x02\x03"}
    assert parse(e131.packet(1, b"", 1, terminated=True))["options"] == e131.TERMINATED


def test_channels_run_on_into_the_next_universe():
    start = e131.channel_of(1, 451)  # 450 channels in
    assert list(e131.spans(start, 300)) == [(1, 450, 0, 60), (2, 0, 60, 240)]
    assert e131.channel_of(3, 1) == 1020


def test_two_lights_sharing_a_universe_dont_blank_each_other():
    out = fake_output()
    a = {"kind": "e131", "ip": "10.0.0.7", "universe": 1, "channel": 1}
    b = {"kind": "e131", "ip": "10.0.0.7", "universe": 1, "channel": 301}
    assert output.address(a) == "10.0.0.7" and output.address(b) == "10.0.0.7#u1c301"
    da = out.claim(output.address(a), 100, protocol="e131")
    db = out.claim(output.address(b), 100, protocol="e131")  # channels 301-600: universe 1, then 2
    now = time.monotonic()
    da.update(b"\xff\x00\x00" * 100)
    da.tick(now)
    db.update(b"\x00\x00\xff" * 100)
    db.tick(now)
    packets = [(parse(p), addr) for p, addr in out.sock.sent]
    assert all(addr == ("10.0.0.7", e131.PORT) for _, addr in packets)
    last_u1 = [f for f, _ in packets if f["universe"] == 1][-1]
    assert last_u1["data"] == b"\xff\x00\x00" * 100 + b"\x00\x00\xff" * 70  # both lights' channels
    u2 = [f for f, _ in packets if f["universe"] == 2][-1]
    assert u2["data"] == b"\x00\x00\xff" * 30
    # One light stops: its channels go dark, the other's stay.
    out.sock.sent.clear()
    out.release(output.address(b))
    after = {parse(p)["universe"]: parse(p) for p, _ in out.sock.sent}
    assert after[1]["data"] == b"\xff\x00\x00" * 100 + bytes(210) and after[1]["options"] == 0
    # The last one stops: every universe is told the stream has ended, three times.
    out.sock.sent.clear()
    out.release(output.address(a))
    ended = [parse(p) for p, _ in out.sock.sent]
    assert len(ended) == 6 and all(f["options"] == e131.TERMINATED for f in ended)


def test_still_frames_are_repeated_inside_the_receivers_timeout():
    out = fake_output()
    dev = out.claim("10.0.0.8", 2, protocol="e131")
    dev.update(b"\x01\x02\x03\x04\x05\x06")
    now = time.monotonic()
    dev.tick(now)
    dev.tick(now + 0.5)
    assert len(out.sock.sent) == 1
    dev.tick(now + output.E131_RESEND_S + 0.1)
    assert len(out.sock.sent) == 2
    assert parse(out.sock.sent[1][0])["sequence"] == 2
