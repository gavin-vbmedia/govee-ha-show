"""Baked show file: every frame precomputed by the editor.

Layout (big endian):
  b"GVSF"  magic
  u8       format version (1)
  u32      header length
  bytes    header JSON: {"fps": 40, "frames": N, "tracks": [{"device": id, "segments": n}, ...]}
  N frames, each the tracks' r g b bytes concatenated in track order (segments * 3 per track)

The header may also list experimental Govee scenes, which take a track's light over between two
frames: "scenes": [{"track": index, "start": frame, "end": frame, "code": n, "param": base64}].
"""
import json
import struct
from dataclasses import dataclass, field

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
class Scene:
    track: int
    start: int  # first frame
    end: int  # frame after the last
    code: int
    param: str


@dataclass
class Baked:
    fps: int
    frames: int
    tracks: list[Track]
    data: bytes
    stride: int
    scenes: list[Scene] = field(default_factory=list)

    @property
    def duration(self) -> float:
        return self.frames / self.fps

    def track_frame(self, track: Track, index: int) -> bytes:
        start = index * self.stride + track.offset
        return self.data[start: start + track.size]


def encode(fps: int, tracks: list[dict], frames: list[bytes], scenes: list[dict] | None = None) -> bytes:
    """Used by tests and tooling; the editor writes the same layout in JS."""
    head = {"fps": fps, "frames": len(frames), "tracks": tracks}
    if scenes:
        head["scenes"] = scenes
    header = json.dumps(head).encode()
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
    scenes = []
    try:
        for s in header.get("scenes") or []:
            scene = Scene(int(s["track"]), int(s["start"]), int(s["end"]), int(s["code"]), str(s.get("param", "")))
            if not (0 <= scene.track < len(tracks) and 0 <= scene.start < scene.end and 0 <= scene.code <= 0xFFFF):
                raise ValueError("scene out of range")
            scenes.append(scene)
    except (ValueError, KeyError, TypeError) as e:
        raise BakedError(f"bad scene: {e}") from e
    return Baked(fps, frames, tracks, data, offset, scenes)
