import asyncio
import base64
import json

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
    enables = [p for p in razer_packets(sock) if p[3] == 0xB1]
    assert len(enables) >= 300 // output.REENABLE_S


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
