import pytest

from goveeshow import baked


def test_round_trip():
    tracks = [{"device": "a", "segments": 2}, {"device": "b", "segments": 1}]
    frames = [bytes(range(9)), bytes(range(10, 19))]
    b = baked.decode(baked.encode(40, tracks, frames))
    assert (b.fps, b.frames, b.stride) == (40, 2, 9)
    assert b.track_frame(b.tracks[0], 1) == bytes(range(10, 16))
    assert b.track_frame(b.tracks[1], 0) == bytes([6, 7, 8])
    assert b.duration == 0.05


@pytest.mark.parametrize("blob", [b"", b"NOPE\x01\x00\x00\x00\x02{}"])
def test_rejects_garbage(blob):
    with pytest.raises(baked.BakedError):
        baked.decode(blob)


def test_rejects_wrong_length():
    blob = baked.encode(40, [{"device": "a", "segments": 2}], [bytes(6)])
    with pytest.raises(baked.BakedError):
        baked.decode(blob[:-1])
