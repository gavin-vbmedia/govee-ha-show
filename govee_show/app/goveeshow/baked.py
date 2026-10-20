"""Baked show file: every frame precomputed by the editor.

Layout (big endian):
  b"GVSF"  magic
  u8       format version (1)
  u32      header length
  bytes    header JSON: {"fps": 40, "frames": N, "tracks": [{"device": id, "segments": n}, ...]}
  N frames, each the tracks' r g b bytes concatenated in track order (segments * 3 per track)
"""
import json
import struct
from dataclasses import dataclass

MAGIC = b"GVSF"
VERSION = 1
MAX_FPS = 60


class BakedError(ValueError):
    pass


@dataclass
class Track:
    device: str
    segments: int
    offset: int  # byte offset inside a frame

    @property
    def size(self) -> int:
        return self.segments * 3


@dataclass
class Baked:
    fps: int
    frames: int
    tracks: list[Track]
    data: bytes
    stride: int

    @property
    def duration(self) -> float:
        return self.frames / self.fps

    def track_frame(self, track: Track, index: int) -> bytes:
        start = index * self.stride + track.offset
        return self.data[start: start + track.size]


def encode(fps: int, tracks: list[dict], frames: list[bytes]) -> bytes:
    """Used by tests and tooling; the editor writes the same layout in JS."""
    header = json.dumps({"fps": fps, "frames": len(frames), "tracks": tracks}).encode()
    return MAGIC + struct.pack(">BI", VERSION, len(header)) + header + b"".join(frames)


def decode(blob: bytes) -> Baked:
    if len(blob) < 9 or blob[:4] != MAGIC:
        raise BakedError("not a baked show file")
    version, hlen = struct.unpack(">BI", blob[4:9])
    if version != VERSION:
        raise BakedError(f"unsupported baked format version {version}")
    try:
        header = json.loads(blob[9: 9 + hlen])
        fps, frames = int(header["fps"]), int(header["frames"])
        raw_tracks = header["tracks"]
    except (ValueError, KeyError, TypeError) as e:
        raise BakedError(f"bad header: {e}") from e
    if not 1 <= fps <= MAX_FPS or frames < 0:
        raise BakedError("bad fps or frame count")
    tracks, offset = [], 0
    for t in raw_tracks:
        segments = int(t["segments"])
        if not 1 <= segments <= 255:
            raise BakedError("segment count must be 1-255")
        tracks.append(Track(str(t["device"]), segments, offset))
        offset += segments * 3
    data = blob[9 + hlen:]
    if len(data) != frames * offset:
        raise BakedError(f"expected {frames * offset} bytes of frames, got {len(data)}")
    return Baked(fps, frames, tracks, data, offset)
