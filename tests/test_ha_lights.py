import asyncio
import time

from halidayshow import output


class FakeHA:
    available = True

    def __init__(self, modes=("rgb",)):
        self.calls = []
        self.modes = list(modes)

    async def state(self, entity):
        self.calls.append(("state", entity))
        return {"entity_id": entity, "attributes": {"supported_color_modes": self.modes}}

    async def call(self, domain, service, data):
        await asyncio.sleep(0)
        self.calls.append((f"{domain}.{service}", data))


def fake_output(ha):
    out = output.Output.__new__(output.Output)
    out.sock, out.devices, out.universes, out._task = None, {}, {}, None
    out.ha, out.calls = ha, set()
    return out


async def settle(out):
    while out.calls:
        await asyncio.wait(set(out.calls))


async def test_light_gets_the_show_colour_then_is_put_back():
    ha = FakeHA()
    out = fake_output(ha)
    d = {"kind": "ha", "entity": "light.porch"}
    assert output.address(d) == "ha:light.porch" and output.linked(d)
    dev = out.claim(output.address(d), 1, protocol="ha_light", brightness=50)
    now = time.monotonic()
    dev.update(b"\xff\x80\x00")
    dev.tick(now)  # the snapshot is still being taken: the colour waits for it
    await settle(out)
    dev.tick(now)
    await settle(out)
    assert ha.calls[:2] == [("state", "light.porch"),
                            ("scene.create", {"scene_id": "haliday_show_light_porch", "snapshot_entities": ["light.porch"]})]
    # At half brightness (the light's cap), in full colour.
    assert ha.calls[2] == ("light.turn_on", {"entity_id": "light.porch", "brightness": 127, "transition": 0,
                                             "rgb_color": [255, 128, 0]})
    dev.update(b"\x00\x00\x00")
    dev.tick(now + 0.1)  # within 0.25 s of the last change: waits
    dev.update(b"\xff\x82\x00")  # back near the colour already shown: too small a change to send
    dev.tick(now + 1)
    await settle(out)
    assert len(ha.calls) == 3
    dev.update(b"\x00\x00\x00")
    dev.tick(now + 2)
    await settle(out)
    assert ha.calls[3] == ("light.turn_off", {"entity_id": "light.porch"})
    out.release(output.address(d))
    await settle(out)
    assert ha.calls[-1] == ("scene.turn_on", {"entity_id": "scene.haliday_show_light_porch"})


async def test_white_only_light_gets_brightness_alone():
    ha = FakeHA(modes=["brightness"])
    out = fake_output(ha)
    dev = out.claim("ha:light.hall", 1, protocol="ha_light")
    await settle(out)
    dev.update(b"\x40\x40\x40")
    dev.tick(time.monotonic())
    await settle(out)
    assert ha.calls[-1] == ("light.turn_on", {"entity_id": "light.hall", "brightness": 64, "transition": 0})


async def test_switch_follows_brightness_at_most_once_a_second():
    ha = FakeHA()
    out = fake_output(ha)
    dev = out.claim("ha:switch.inflatable", 1, protocol="ha_switch")
    await settle(out)
    now = time.monotonic()
    for k, colour in enumerate([b"\xff\xff\xff", b"\x00\x00\x00", b"\xff\x00\x00", b"\x10\x10\x10"]):
        dev.update(colour)
        dev.tick(now + k * 0.4)
        await settle(out)
    switched = [c for c, _ in ha.calls if c.startswith("switch.")]
    # On at 0 s; off at 0.4 s and on at 0.8 s are too soon; off at 1.2 s goes.
    assert switched == ["switch.turn_on", "switch.turn_off"]


async def test_a_failing_call_doesnt_stop_the_show():
    class Down(FakeHA):
        async def call(self, domain, service, data):
            raise RuntimeError("unreachable")
    out = fake_output(Down())
    dev = out.claim("ha:light.porch", 1, protocol="ha_light")
    await settle(out)
    dev.update(b"\xff\x00\x00")
    dev.tick(time.monotonic())
    await settle(out)
    out.release("ha:light.porch")
    await settle(out)


def test_one_segment_test_pattern_goes_round_the_colours():
    assert output.test_frame(1, 0) != output.test_frame(1, 1.5)
    assert len(output.test_frame(1, 0)) == 3
