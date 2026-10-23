"""E1.31 (streaming ACN, sACN): what most Falcon and Kulp controllers and xLights set-ups speak.

A light is a run of channels starting at a universe and a channel in it. Universes are 510 channels
(170 RGB pixels), as xLights sets them up by default, and channels run on from one universe into the
next. Packets go straight to the controller's IP (unicast) rather than to E1.31's multicast groups,
which many home networks don't pass reliably.

Several lights can share a controller, and even a universe, so the universes for each controller are
kept in one place (`Universes`): each light writes its channels there and a universe's packet carries
every light's channels in it, so one light never blanks another. See docs/e131.md.
"""
import uuid

PORT = 5568
UNIVERSE_SIZE = 510
MAX_UNIVERSE = 63999
SOURCE_NAME = b"HA-liday Show"
PRIORITY = 100
# One fixed source id: receivers use it to tell senders apart, and there's only ever one of us.
CID = uuid.uuid5(uuid.NAMESPACE_URL, "https://github.com/gavin-vbmedia/ha-liday-show").bytes
TERMINATED = 0x40  # options bit: this source is stopping, let go of the universe now


def packet(universe: int, data: bytes, sequence: int, terminated: bool = False) -> bytes:
    """One E1.31 data packet: root, framing and DMP layers, then the start code and channels."""
    n = len(data)
    total = 126 + n

    def flags_length(start: int) -> bytes:
        return (0x7000 | (total - start)).to_bytes(2, "big")

    root = (b"\x00\x10\x00\x00" + b"ASC-E1.17\x00\x00\x00" + flags_length(16)
            + (4).to_bytes(4, "big") + CID)
    framing = (flags_length(38) + (2).to_bytes(4, "big") + SOURCE_NAME.ljust(64, b"\0")
               + bytes([PRIORITY]) + b"\x00\x00" + bytes([sequence & 0xFF, TERMINATED if terminated else 0])
               + universe.to_bytes(2, "big"))
    dmp = (flags_length(115) + b"\x02\xa1\x00\x00\x00\x01" + (n + 1).to_bytes(2, "big") + b"\x00" + data)
    return root + framing + dmp


def channel_of(universe: int, channel: int) -> int:
    """A universe and channel (both 1-based) as a channel count from the start of universe 1 (0-based)."""
    return (universe - 1) * UNIVERSE_SIZE + channel - 1


def spans(start: int, length: int):
    """The (universe, offset in it, offset in the frame, length) runs that channels start..start+length cover."""
    done = 0
    while done < length:
        absolute = start + done
        universe, offset = absolute // UNIVERSE_SIZE + 1, absolute % UNIVERSE_SIZE
        n = min(UNIVERSE_SIZE - offset, length - done)
        yield universe, offset, done, n
        done += n


class Universes:
    """The channels of every universe sent to one controller, shared by the lights on it."""

    def __init__(self):
        self.data: dict[int, bytearray] = {}
        self.sequence: dict[int, int] = {}
        self.users = 0  # lights on this controller still playing

    def write(self, start: int, frame: bytes) -> list[int]:
        """Put a light's frame in place; returns the universes it touched."""
        touched = []
        for universe, offset, at, n in spans(start, len(frame)):
            buf = self.data.setdefault(universe, bytearray())
            if len(buf) < offset + n:
                buf.extend(bytes(offset + n - len(buf)))
            buf[offset: offset + n] = frame[at: at + n]
            touched.append(universe)
        return touched

    def packet(self, universe: int, terminated: bool = False) -> bytes:
        seq = self.sequence[universe] = (self.sequence.get(universe, 0) + 1) % 256
        return packet(universe, bytes(self.data.get(universe, b"")), seq, terminated)
