import asyncio
import base64
import json
import time

from goveeshow import output


class FakeSock:
    def __init__(self):
        self.sent = []

    def sendto(self, payload, addr):
        self.sent.append((json.loads(payload)["msg"], addr))


def razer_packets(sock):
    return [base64.b64decode(m["data"]["pt"]) for m, _ in sock.sent if m["cmd"] == "razer"]


def test_reverse_flips_segment_order():
    dev = output.OutputDevice("10.0.0.5", 3, FakeSock(), reverse=True)
    dev.update(bytes([1, 1, 1, 2, 2, 2, 3, 3, 3]))
    assert dev.pending == bytes([3, 3, 3, 2, 2, 2, 1, 1, 1])


def test_rate_limit_and_keepalive():
    sock = FakeSock()
    dev = output.OutputDevice("10.0.0.5", 1, sock, max_fps=10)
    dev.enable()
    t = dev.last_enable
    dev.update(b"\xff\x00\x00")
    dev.tick(t + 0.01)
    dev.update(b"\x00\xff\x00")
    dev.tick(t + 0.05)  # within 100 ms: held back
    colours = [p for p in razer_packets(sock) if p[3] == 0xB0]
    assert len(colours) == 1
    dev.tick(t + 0.2)  # pending frame goes out once the interval has passed
    dev.tick(t + 0.25)  # unchanged frame within the keepalive: no resend
    colours = [p for p in razer_packets(sock) if p[3] == 0xB0]
    assert [p[6:9] for p in colours] == [b"\xff\x00\x00", b"\x00\xff\x00"]
    dev.tick(t + 0.2 + output.KEEPALIVE_S + 1)  # keepalive resends the last frame
    assert len([p for p in razer_packets(sock) if p[3] == 0xB0]) == 3


def test_test_frame_has_one_white_dot():
    frame = output.test_frame(10, 0.6)
    whites = [i for i in range(10) if frame[i * 3: i * 3 + 3] == b"\xff\xff\xff"]
    assert whites == [2]


def test_idle_light_is_kept_in_realtime_mode():
    # A light left dark for minutes of a show still gets the same black frame every frame;
    # the device must keep hearing from us well inside Govee's ~60 s fallback.
    sock = FakeSock()
    dev = output.OutputDevice("10.0.0.5", 3, sock)
    dev.enable()
    t0 = dev.last_enable
    sent_at = []
    for i in range(int(300 / 0.025)):  # five minutes at 40 fps
        now = t0 + i * 0.025
        dev.update(bytes(9))
        before = len(sock.sent)
        dev.tick(now)
        if len(sock.sent) > before:
            sent_at.append(now)
    gaps = [b - a for a, b in zip([t0] + sent_at, sent_at + [t0 + 300])]
    assert max(gaps) < 30
    # Razer-on only during start-up: repeating it later makes some lights blink.
    enables = [p for p in razer_packets(sock) if p[3] == 0xB1]
    assert len(enables) <= output.STARTUP_S / output.STARTUP_REENABLE_S + 2


def test_razer_on_is_repeated_while_the_light_starts_up():
    # Turning a light on and enabling realtime mode in the same instant can lose the enable.
    sock = FakeSock()
    dev = output.OutputDevice("10.0.0.5", 1, sock)
    dev.enable()
    t0 = dev.enabled_at
    for i in range(1, 200):  # ten seconds of ticks
        dev.tick(t0 + i * 0.05)
    times_enabled = len([p for p in razer_packets(sock) if p[3] == 0xB1])
    assert 8 <= times_enabled <= 12  # about twice a second for 5 s, then quiet


def test_whole_light_protocol_sends_colorwc_without_realtime_mode():
    sock = FakeSock()
    dev = output.OutputDevice("10.0.0.5", 2, sock, protocol="whole")
    dev.enable()
    t = dev.last_enable
    dev.update(bytes([200, 0, 0, 0, 0, 100]))
    dev.tick(t + 1)
    dev.tick(t + 2)
    dev.disable()
    cmds = [m["cmd"] for m, _ in sock.sent]
    assert "razer" not in cmds
    colours = [m["data"]["color"] for m, _ in sock.sent if m["cmd"] == "colorwc"]
    assert colours and all(c == {"r": 100, "g": 0, "b": 50} for c in colours)
    assert dev.min_interval >= 1 / output.WHOLE_FPS


def test_claim_rebuilds_the_device_when_the_protocol_changes():
    out = output.Output.__new__(output.Output)
    out.sock, out.devices = FakeSock(), {}
    first = out.claim("10.0.0.5", 3)
    second = out.claim("10.0.0.5", 3, protocol="v2")
    assert first is not second and second.protocol == "v2"


def test_probe_frame_lights_only_the_last_segment():
    assert output.probe_frame(3) == bytes([0, 0, 0, 0, 0, 0, 255, 255, 255])


def test_claim_resizes_in_place_without_leaving_realtime_mode():
    sock = FakeSock()
    out = output.Output.__new__(output.Output)
    out.sock, out.devices = sock, {}
    first = out.claim("10.0.0.5", 64)
    sent = len(sock.sent)
    second = out.claim("10.0.0.5", 32)
    assert first is second and second.segments == 32
    assert len(sock.sent) == sent  # no razer off/on between steps


async def test_probe_keeps_the_light_between_questions():
    sock = FakeSock()
    out = output.Output.__new__(output.Output)
    out.sock, out.devices = sock, {}
    task = asyncio.create_task(output.run_probe(out, "10.0.0.5", 64))
    await asyncio.sleep(0)
    task.cancel()
    await asyncio.gather(task, return_exceptions=True)
    assert "10.0.0.5" in out.devices  # still in realtime mode for the next question
    assert razer_packets(sock)[-1] == output.razer_enable(True)


def test_unchanged_frame_is_resent_often_enough_to_stay_in_realtime_mode():
    sock = FakeSock()
    dev = output.OutputDevice("10.0.0.5", 1, sock)
    dev.enable()
    t = dev.enabled_at + output.STARTUP_S + 1
    dev.last_enable = t  # past start-up, no re-enables in this window
    dev.update(b"\xff\x00\x00")
    for i in range(120):
        dev.tick(t + i * 0.025)
    colours = [p for p in razer_packets(sock) if p[3] == 0xB0]
    assert len(colours) >= 20  # roughly 10 a second over 3 s (tick spacing rounds it down a little)


def test_brightness_caps_every_frame_and_can_change_live():
    out = output.Output.__new__(output.Output)
    out.sock, out.devices = FakeSock(), {}
    dev = out.claim("10.0.0.5", 1, brightness=50)
    dev.update(b"\xff\x80\x00")
    assert dev.pending == bytes([127, 64, 0])
    assert out.claim("10.0.0.5", 1, brightness=100) is dev
    dev.update(b"\xff\x80\x00")
    assert dev.pending == b"\xff\x80\x00"


def test_scene_pauses_realtime_then_hands_back():
    sock = FakeSock()
    dev = output.OutputDevice("10.0.0.5", 1, sock)
    dev.enable()
    t = dev.enabled_at + output.STARTUP_S + 1
    dev.update(b"\xff\x00\x00")
    dev.tick(t)
    dev.play_scene(212, "")
    dev.play_scene(212, "")  # the same scene again is not re-sent
    cmds = [m["cmd"] for m, _ in sock.sent]
    assert cmds.count("ptReal") == 1
    assert razer_packets(sock)[-1] == output.razer_enable(False)
    sent = len(sock.sent)
    dev.update(b"\x00\xff\x00")
    dev.tick(t + 1)
    assert len(sock.sent) == sent  # nothing streamed over the scene
    dev.end_scene()
    assert razer_packets(sock)[-1] == output.razer_enable(True)
    dev.update(b"\x00\xff\x00")
    dev.tick(time.monotonic() + 0.01)
    assert razer_packets(sock)[-1][3] == 0xB0


def test_app_segments_send_a_few_commands_at_a_time_biggest_change_first():
    sock = FakeSock()
    dev = output.OutputDevice("10.0.0.6", 5, sock, protocol="segments")
    dev.enable()
    t = dev.last_enable
    sends = lambda: [[base64.b64decode(p) for p in m["data"]["command"]] for m, _ in sock.sent if m["cmd"] == "ptReal"]
    # Five different colours, black included: all are sent, a few at a time.
    dev.update(bytes([0, 0, 0, 50, 0, 0, 100, 0, 0, 150, 0, 0, 200, 0, 0]))
    for k in range(3):
        dev.tick(t + 1 + k * 0.1)
    assert [len(s) for s in sends()] == [3, 2]
    assert sorted(p[4] for s in sends() for p in s) == [0, 50, 100, 150, 200]
    # A small change waits; a big one goes first.
    sock.sent.clear()
    dev.update(bytes([5, 0, 0, 50, 0, 0, 100, 0, 0, 150, 0, 0, 0, 255, 0]))
    dev.tick(t + 2)
    dev.tick(t + 2.1)
    [[only]] = sends()
    assert only[4:7] == b"\x00\xff\x00" and only[12] == 0b10000
    # Settled: after a second the whole picture is repeated, still a few at a time.
    dev.tick(t + 3.2)
    dev.tick(t + 3.35)
    assert [len(s) for s in sends()] == [1, 3, 2]
    assert "razer" not in [m["cmd"] for m, _ in sock.sent]
    assert dev.min_interval >= 1 / output.SEGMENTS_FPS


def test_per_bulb_pictures_go_as_several_messages_a_little_apart():
    sock = FakeSock()
    dev = output.OutputDevice("10.0.0.7", 300, sock, protocol="pixels")
    dev.enable()
    t = dev.last_enable
    # 300 bulbs in 20 colours: well over one message's worth of packets.
    dev.update(bytes(v for i in range(300) for v in (255 * (i % 20 < 10), (i % 20) * 12, 255 - (i % 20) * 12)))
    dev.tick(t + 1)
    dev.tick(t + 1.01)  # too soon for the next message
    dev.tick(t + 1 + 1.5 * output.PIXELS_GAP_S)
    dev.tick(t + 1 + 3 * output.PIXELS_GAP_S)
    sent = [[base64.b64decode(p) for p in m["data"]["command"]] for m, _ in sock.sent if m["cmd"] == "ptReal"]
    assert "razer" not in [m["cmd"] for m, _ in sock.sent]
    assert len(sent) >= 3 and all(len(s) <= output.PIXELS_PER_MESSAGE for s in sent)
    packets = [p for s in sent for p in s]
    assert packets[0][:2] == b"\xa3\x00" and packets[-1][:5] == bytes.fromhex("33050a2003")
    assert packets[0][3] == len(packets) - 1  # the picture's own line count, then the show command
    assert dev.min_interval >= 1 / output.PIXELS_FPS


def test_per_bulb_lights_can_have_more_than_255_segments():
    dev = output.OutputDevice("10.0.0.7", 300, FakeSock(), protocol="pixels")
    dev.update(b"\xff\x00\x00" * 300)
    assert len(dev.pending) == 900


def test_per_bulb_pictures_wait_as_long_as_the_light_needs_for_them():
    sock = FakeSock()
    dev = output.OutputDevice("10.0.0.7", 300, sock, protocol="pixels")
    dev.enable()
    t = dev.last_enable
    pictures = lambda: sum(any(base64.b64decode(p)[:5] == bytes.fromhex("33050a2003") for p in m["data"]["command"])
                           for m, _ in sock.sent if m["cmd"] == "ptReal")
    dev.update(b"\xff\x00\x00" * 300)  # one colour: a 2-packet picture
    dev.tick(t + 1)
    dev.update(b"\x00\x00\xff" * 300)
    dev.tick(t + 1.1)  # too soon even for a small picture
    assert pictures() == 1
    dev.tick(t + 1 + output.PIXELS_PICTURE_S + 2 * output.PIXELS_PACKET_S + 0.005)
    assert pictures() == 2
    # A busy picture (every bulb different) holds the next one back for much longer.
    dev.update(bytes(v for i in range(300) for v in (i % 256, (i * 5) % 256, (i * 9) % 256)))
    start = t + 2
    for k in range(40):
        dev.tick(start + k * 0.01)
    dev.update(b"\x00\xff\x00" * 300)
    dev.tick(start + 0.5)
    assert pictures() == 3
    dev.tick(start + 1.0)
    assert pictures() == 4
