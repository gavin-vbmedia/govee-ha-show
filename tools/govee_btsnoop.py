"""Decrypt the Govee app's Bluetooth traffic from an Android btsnoop_hci.log.

Newer Govee lights encrypt Bluetooth: AES-128-ECB on bytes 0-15 of each 20-byte packet and RC4 on
bytes 16-19, first with the pre-shared key "MakingLifeSmarte", then with a session key the light sends
in bytes 2-17 of its e7 01 reply. See docs/govee-protocols.md for how to capture the log.

  pip install cryptography
  python tools/govee_btsnoop.py btsnoop_hci.log            # every packet, decrypted
  python tools/govee_btsnoop.py btsnoop_hci.log --quiet    # without the aa 01 keep-alives
"""
import argparse
import struct
import sys

from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

PRE_SHARED = b"MakingLifeSmarte"
ATT_WRITE_COMMAND, ATT_WRITE_REQUEST, ATT_NOTIFY = 0x52, 0x12, 0x1B


def rc4(key: bytes, data: bytes) -> bytes:
    s = list(range(256))
    j = 0
    for i in range(256):
        j = (j + s[i] + key[i % len(key)]) % 256
        s[i], s[j] = s[j], s[i]
    i = j = 0
    out = bytearray()
    for c in data:
        i = (i + 1) % 256
        j = (j + s[i]) % 256
        s[i], s[j] = s[j], s[i]
        out.append(c ^ s[(s[i] + s[j]) % 256])
    return bytes(out)


def decrypt(key: bytes, packet: bytes) -> bytes:
    head = Cipher(algorithms.AES(key), modes.ECB()).decryptor().update(packet[:16])
    return head + rc4(key, packet[16:])


def att_values(path: str):
    """(seconds, "tx"/"rx", connection handle, value) for each ATT write or notification."""
    data = open(path, "rb").read()
    if data[:8] != b"btsnoop\0":
        sys.exit(f"{path} isn't a btsnoop log")
    off, t0 = 16, None
    while off + 24 <= len(data):
        _, length, flags, _, stamp = struct.unpack(">IIIIq", data[off: off + 24])
        pkt = data[off + 24: off + 24 + length]
        off += 24 + length
        t0 = t0 if t0 is not None else stamp
        if not pkt or pkt[0] != 2:  # HCI ACL data
            continue
        hdr, acl_len = struct.unpack("<HH", pkt[1:5])
        body = pkt[5: 5 + acl_len]
        if (hdr >> 12) & 3 == 1 or len(body) < 7:  # continuation fragments don't carry a whole write
            continue
        l2_len, cid = struct.unpack("<HH", body[:4])
        att = body[4: 4 + l2_len]
        if cid != 4 or att[0] not in (ATT_WRITE_COMMAND, ATT_WRITE_REQUEST, ATT_NOTIFY):
            continue
        yield (stamp - t0) / 1e6, "rx" if flags & 1 else "tx", hdr & 0x0FFF, att[3:]


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("log")
    ap.add_argument("--quiet", action="store_true", help="leave out the aa 01 keep-alives")
    args = ap.parse_args()
    keys: dict[int, bytes] = {}
    for t, direction, conn, value in att_values(args.log):
        if len(value) != 20:
            print(f"{t:9.3f} {direction} conn {conn:#x} ({len(value)} bytes) {value.hex(' ')}")
            continue
        plain = decrypt(PRE_SHARED, value)
        if plain[:2] in (b"\xe7\x01", b"\xe7\x02"):
            if direction == "rx" and plain[:2] == b"\xe7\x01":
                keys[conn] = plain[2:18]
            label = "handshake"
        else:
            key = keys.get(conn)
            plain = decrypt(key, value) if key else value
            label = "" if key else "(no session key yet)"
        check = 0
        for b in plain[:19]:
            check ^= b
        if args.quiet and plain[:2] == b"\xaa\x01":
            continue
        ok = "ok" if check == plain[19] else "BAD CHECKSUM"
        print(f"{t:9.3f} {direction} conn {conn:#x} {plain.hex(' ')} {ok} {label}".rstrip())


if __name__ == "__main__":
    main()
