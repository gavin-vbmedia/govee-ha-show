import time

from halidayshow import output, wled


class FakeSock:
    def __init__(self):
        self.sent = []

    def sendto(self, payload, addr):
        self.sent.append((payload, addr))


def test_ddp_splits_a_frame_and_pushes_on_the_last_packet():
    rgb = bytes(range(256)) * 6  # 512 LEDs: one full packet and a bit
    packets = wled.ddp_packets(rgb[:1536], 3)
    assert len(packets) == 2
    first, last = packets
    assert first[:4] == bytes([0x40, 3, 0x0B, 0x01])
    assert int.from_bytes(first[4:8], "big") == 0 and int.from_bytes(first[8:10], "big") == 1440
    assert last[0] == 0x41  # push: show the frame now
    assert int.from_bytes(last[4:8], "big") == 1440 and int.from_bytes(last[8:10], "big") == 96
    assert first[10:] + last[10:] == rgb[:1536]


def test_one_wled_segment_over_the_whole_strip_is_no_split():
    assert wled.parts_from_segments([{"id": 0, "start": 0, "stop": 60}], 60) == []
    # Off the end of the strip, empty or overlapping segments are dropped.
    parts = wled.parts_from_segments([{"id": 0, "start": 0, "stop": 30}, {"id": 1, "start": 20, "stop": 40},
                                      {"id": 2, "start": 50, "stop": 50}, {"id": 3, "start": 40, "stop": 99}], 60)
    assert [(p["id"], p["from"], p["to"]) for p in parts] == [("w0", 1, 30), ("w3", 41, 60)]


def test_wled_light_streams_frames_over_ddp_and_ignores_govee_scenes():
    sock = FakeSock()
    out = output.Output.__new__(output.Output)
    out.sock, out.devices, out._task = sock, {}, None
    dev = out.claim("10.0.0.9", 2, protocol="ddp", reverse=True, brightness=50)
    assert isinstance(dev, output.WledDevice)
    assert sock.sent == []  # nothing to switch on: WLED takes frames as they come
    dev.update(b"\xff\x00\x00\x00\xff\x00")
    now = time.monotonic()
    dev.tick(now)
    (payload, addr), = sock.sent
    assert addr == ("10.0.0.9", wled.DDP_PORT)
    assert payload[10:] == b"\x00\x7f\x00\x7f\x00\x00"  # reversed and at half brightness
    dev.play_scene(5, "")
    dev.tick(now + 0.1)
    assert len(sock.sent) == 1  # unchanged frame, and a Govee scene changes nothing
    dev.tick(now + output.WLED_RESEND_S + 0.1)
    assert len(sock.sent) == 2  # repeated so WLED doesn't fall back to its own effect
    out.release("10.0.0.9")
    assert len(sock.sent) == 2


def test_ddp_frames_can_start_part_way_along_a_controller():
    first, = wled.ddp_packets(b"\x01\x02\x03", 1, start=300)
    assert int.from_bytes(first[4:8], "big") == 300


def test_two_lights_on_one_controller_are_claimed_separately():
    sock = FakeSock()
    out = output.Output.__new__(output.Output)
    out.sock, out.devices, out._task = sock, {}, None
    a = {"kind": "ddp", "ip": "10.0.0.5", "first": 1}
    b = {"kind": "ddp", "ip": "10.0.0.5", "first": 101}
    assert output.address(a) == "10.0.0.5" and output.address(b) == "10.0.0.5#101"
    assert output.address({"kind": "govee", "ip": "10.0.0.5", "first": 101}) == "10.0.0.5"
    da = out.claim(output.address(a), 100, protocol="ddp")
    db = out.claim(output.address(b), 50, protocol="ddp")
    assert da is not db and db.ip == "10.0.0.5"
    now = time.monotonic()
    da.update(b"\xff\x00\x00" * 100)
    db.update(b"\x00\x00\xff" * 50)
    da.tick(now)
    db.tick(now)
    offsets = sorted((int.from_bytes(p[4:8], "big"), addr) for p, addr in sock.sent)
    assert offsets == [(0, ("10.0.0.5", wled.DDP_PORT)), (300, ("10.0.0.5", wled.DDP_PORT))]
