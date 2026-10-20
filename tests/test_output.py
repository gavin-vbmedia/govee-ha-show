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
    dev.tick(t + 0.3)  # unchanged frame: no resend
    colours = [p for p in razer_packets(sock) if p[3] == 0xB0]
    assert [p[6:9] for p in colours] == [b"\xff\x00\x00", b"\x00\xff\x00"]
    dev.tick(t + 0.2 + output.KEEPALIVE_S + 1)  # keepalive resends the last frame
    assert len([p for p in razer_packets(sock) if p[3] == 0xB0]) == 3


def test_test_frame_has_one_white_dot():
    frame = output.test_frame(10, 0.6)
    whites = [i for i in range(10) if frame[i * 3: i * 3 + 3] == b"\xff\xff\xff"]
    assert whites == [2]
