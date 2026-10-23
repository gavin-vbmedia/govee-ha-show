import time

from halidayshow import player


class FakeOutput:
    devices = {}


class Running:
    def done(self):
        return False


def playing_player(position):
    p = player.Player(FakeOutput())
    p.start = time.monotonic() - position
    p._task = Running()
    return p


def test_small_drift_is_eased_not_jumped():
    p = playing_player(10.0)
    before = p.position()
    p.sync(before - 0.1)  # browser 100 ms behind, as network jitter can make it look
    assert before - 0.1 < p.position() < before - 0.01  # moved part of the way, no jump


def test_tiny_drift_is_ignored_and_a_seek_jumps():
    p = playing_player(10.0)
    start = p.start
    p.sync(p.position() - 0.01)
    assert p.start == start
    p.sync(30.0)
    assert abs(p.position() - 30.0) < 0.01


class RecordingDevice:
    def __init__(self):
        self.calls = []

    def play_scene(self, code, param):
        self.calls.append(("scene", code))

    def end_scene(self):
        self.calls.append(("end",))

    def update(self, rgb):
        pass


async def test_player_hands_a_light_to_a_scene_for_its_frames():
    from halidayshow import baked
    blob = baked.encode(40, [{"device": "a", "segments": 1}], [b"\0\0\0"] * 4,
                        scenes=[{"track": 0, "start": 1, "end": 3, "code": 7, "param": ""}])
    dev = RecordingDevice()
    out = FakeOutput()
    out.devices = {"1.2.3.4": dev}
    out.release_all = lambda: None
    p = player.Player(out)
    p.baked, p.devices, p.offset = baked.decode(blob), {"a": {"ip": "1.2.3.4"}}, 0.0
    p.start = time.monotonic()
    await p._run()
    assert ("scene", 7) in dev.calls
    assert dev.calls.index(("scene", 7)) < max(i for i, c in enumerate(dev.calls) if c == ("end",))
