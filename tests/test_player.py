import time

from goveeshow import player


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
