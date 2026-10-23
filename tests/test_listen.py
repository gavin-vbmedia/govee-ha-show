import socket
import struct

from halidayshow import listen


def udp_frame(src, sport, dst, dport, payload):
    udp = struct.pack("!HHHH", sport, dport, 8 + len(payload), 0) + payload
    ip = bytes([0x45, 0]) + struct.pack("!H", 20 + len(udp)) + bytes(5) + bytes([17]) + bytes(2) \
        + socket.inet_aton(src) + socket.inet_aton(dst)
    return bytes(12) + b"\x08\x00" + ip + udp + bytes(4)  # Ethernet padding past the IP length


def test_parse_frame_reads_udp_and_ignores_the_rest():
    frame = udp_frame("192.168.1.20", 4003, "192.168.1.30", 4003, b'{"msg":{}}')
    assert listen.parse_frame(frame) == ("192.168.1.20", 4003, "192.168.1.30", 4003, b'{"msg":{}}')
    assert listen.parse_frame(frame[:12] + b"\x86\xdd" + frame[14:]) is None  # IPv6
    assert listen.parse_frame(b"short") is None


def test_wanted_keeps_lights_and_govee_ports():
    lis = listen.Listener({"192.168.1.30": "Tree"}, allow_raw=False)
    assert lis._wanted("192.168.1.20", 5000, "192.168.1.30", 6000, b"")
    assert lis._wanted("192.168.1.20", 5000, "192.168.1.99", 4003, b"")
    assert not lis._wanted("192.168.1.20", 5000, "192.168.1.99", 6000, b"hello")
