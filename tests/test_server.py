import asyncio
import json

import pytest

from goveeshow import baked, server


@pytest.fixture
async def client(aiohttp_client, tmp_path):
    media = tmp_path / "media"
    (media / "songs").mkdir(parents=True)
    (media / "songs" / "tune.mp3").write_bytes(b"ID3fake")
    (media / "notes.txt").write_text("not audio")
    app = server.make_app(tmp_path / "config", media, allow_all=True)
    return await aiohttp_client(app)


async def test_index_uses_relative_urls(client):
    resp = await client.get("/")
    html = await resp.text()
    assert resp.status == 200
    assert 'href="static/' in html and 'src="static/' in html
    assert 'href="/' not in html and 'src="/' not in html


@pytest.mark.parametrize("peer,allowed", [("172.30.32.2", True), ("127.0.0.1", True),
                                          ("192.168.1.20", False)])
async def test_only_ingress_proxy_may_connect(tmp_path, peer, allowed):
    from unittest import mock

    from aiohttp import web
    from aiohttp.test_utils import make_mocked_request

    app = server.make_app(tmp_path / "c", tmp_path / "m")
    transport = mock.Mock()
    transport.get_extra_info.side_effect = lambda k, d=None: (peer, 5000) if k == "peername" else d
    req = make_mocked_request("GET", "/api/info", app=app, transport=transport)

    async def handler(request):
        return web.Response(text="ok")

    if allowed:
        assert (await server.ingress_only(req, handler)).text == "ok"
    else:
        with pytest.raises(web.HTTPForbidden):
            await server.ingress_only(req, handler)


async def test_devices_round_trip_and_validation(client):
    resp = await client.put("/api/devices", json=[{"ip": "192.168.1.50", "name": "Porch", "segments": 12}])
    assert resp.status == 200
    devices = await (await client.get("/api/devices")).json()
    assert devices == [{"id": "192.168.1.50", "name": "Porch", "ip": "192.168.1.50", "sku": "",
                        "segments": 12, "reverse": False, "gradient": False,
                        "protocol": "standard", "brightness": 100}]
    assert (await client.put("/api/devices", json=[{"ip": "1.2.3.4", "brightness": 0}])).status == 400
    assert (await client.put("/api/devices", json=[{"ip": "1.2.3.4", "protocol": "dmx"}])).status == 400
    assert (await client.put("/api/devices", json=[{"ip": "nope"}])).status == 400
    assert (await client.put("/api/devices", json=[{"ip": "1.2.3.4", "segments": 0}])).status == 400


async def test_show_lifecycle(client):
    show_id = (await (await client.post("/api/shows", json={"name": "Halloween 2026!"})).json())["id"]
    assert show_id == "halloween-2026"
    show = {"name": "Halloween 2026!", "fps": 40, "duration": 1, "beats": [0.5],
            "tracks": [{"device": "a", "clips": []}]}
    assert (await client.put(f"/api/shows/{show_id}", json=show)).status == 200
    assert await (await client.get(f"/api/shows/{show_id}")).json() == show
    # A second show with the same name gets its own id.
    assert (await (await client.post("/api/shows", json={"name": "Halloween 2026!"})).json())["id"] == \
        "halloween-2026-2"

    blob = baked.encode(40, [{"device": "a", "segments": 1}], [b"\x01\x02\x03"] * 40)
    assert (await client.put(f"/api/shows/{show_id}/baked", data=blob)).status == 200
    assert (await client.put(f"/api/shows/{show_id}/baked", data=b"junk")).status == 400
    listed = await (await client.get("/api/shows")).json()
    assert listed[0]["id"] == show_id and listed[0]["baked"] is True

    # Saving the show again invalidates the bake.
    await client.put(f"/api/shows/{show_id}", json=show)
    assert (await (await client.get("/api/shows")).json())[0]["baked"] is False

    assert (await client.delete(f"/api/shows/{show_id}")).status == 200
    assert (await client.get(f"/api/shows/{show_id}")).status == 404
    assert (await client.get("/api/shows/..%2Fdevices")).status in (400, 404)


async def test_audio_listing_upload_and_path_safety(client):
    listed = await (await client.get("/api/audio")).json()
    assert listed == [{"source": "media", "path": "songs/tune.mp3"}]
    resp = await client.get("/api/audio/file", params={"source": "media", "path": "songs/tune.mp3"})
    assert resp.status == 200 and await resp.read() == b"ID3fake"
    for path in ("../config/devices.json", "notes.txt", "/etc/passwd"):
        resp = await client.get("/api/audio/file", params={"source": "media", "path": path})
        assert resp.status == 404

    import aiohttp
    form = aiohttp.FormData()
    form.add_field("file", b"OggS", filename="../evil/song.ogg")
    ref = await (await client.post("/api/audio", data=form)).json()
    # Uploads land in /media/govee_show so HA media players can reach them.
    assert ref["source"] == "media" and ref["path"].startswith("govee_show/")
    assert ref["path"].endswith("song.ogg") and ".." not in ref["path"]
    listed = await (await client.get("/api/audio")).json()
    assert {"source": "media", "path": ref["path"]} in listed
    form = aiohttp.FormData()
    form.add_field("file", b"x", filename="script.sh")
    assert (await client.post("/api/audio", data=form)).status == 400


async def test_play_requires_bake_then_streams(client):
    await client.put("/api/devices", json=[{"id": "a", "ip": "127.0.0.1", "segments": 1}])
    await client.put("/api/shows/s", json={"name": "s", "tracks": []})
    resp = await client.post("/api/player/play", json={"show": "s"})
    assert resp.status == 409
    blob = baked.encode(40, [{"device": "a", "segments": 1}], [b"\xff\x00\x00"] * 400)
    await client.put("/api/shows/s/baked", data=blob)
    status = await (await client.post("/api/player/play", json={"show": "s", "position": 2})).json()
    assert status["playing"] is True and status["position"] >= 2
    sync = await (await client.post("/api/player/sync", json={"position": 5})).json()
    assert abs(sync["drift"]) > 2  # re-anchored to the browser's position
    assert (await (await client.get("/api/player")).json())["position"] >= 5
    status = await (await client.post("/api/player/stop")).json()
    assert status["playing"] is False


async def test_speakers_without_home_assistant(client, monkeypatch):
    body = await (await client.get("/api/speakers")).json()
    assert body["speakers"] == []
    resp = await client.put("/api/speakers/delay", json={"entity_id": "media_player.garden", "delay_ms": 250})
    assert (await resp.json())["delay_ms"] == 250
    assert (await client.put("/api/speakers/delay", json={"entity_id": "light.x"})).status == 400


async def test_command_endpoint(client):
    await client.put("/api/devices", json=[{"id": "a", "ip": "127.0.0.1", "segments": 1}])
    await client.put("/api/shows/xmas", json={"name": "Christmas Eve", "tracks": []})
    blob = baked.encode(40, [{"device": "a", "segments": 1}], [b"\x00\x00\xff"] * 400)
    await client.put("/api/shows/xmas/baked", data=blob)
    body = await (await client.post("/api/command", data='{"action": "play", "show": "christmas eve"}')).json()
    assert body["playing"] and body["show"] == "xmas" and body["name"] == "Christmas Eve"
    body = await (await client.post("/api/command", data="stop")).json()
    assert body["playing"] is False
    assert (await client.post("/api/command", data='{"action": "play", "show": "nope"}')).status == 400


async def test_planned_devices_save_but_dont_play(client):
    planned = {"id": "planned-porch", "name": "Porch", "ip": "", "segments": 12}
    devices = await (await client.put("/api/devices", json=[planned])).json()
    assert devices[0]["ip"] == "" and devices[0]["id"] == "planned-porch"
    assert (await client.put("/api/devices", json=[{"ip": "", "segments": 5}])).status == 400  # needs an id
    resp = await client.post("/api/devices/test", json=planned)
    assert resp.status == 400 and "link" in await resp.text()

    await client.put("/api/shows/s", json={"name": "s", "tracks": []})
    blob = baked.encode(40, [{"device": "planned-porch", "segments": 12}], [bytes(36)] * 40)
    await client.put("/api/shows/s/baked", data=blob)
    status = await (await client.post("/api/player/play", json={"show": "s"})).json()
    assert status["playing"]  # the timeline still runs; there is just nothing to send to
    await client.post("/api/player/stop")

    # Linking keeps the id, so shows built for the planned light carry over.
    linked = await (await client.put("/api/devices", json=[{**planned, "ip": "192.168.1.60"}])).json()
    assert linked[0]["id"] == "planned-porch" and linked[0]["ip"] == "192.168.1.60"


async def test_custom_palettes_round_trip_and_validation(client):
    assert await (await client.get("/api/palettes")).json() == []
    mine = [{"name": "Porch party", "colors": ["#FF0000", "#00ff00"]}]
    resp = await client.put("/api/palettes", json=mine)
    assert resp.status == 200
    assert await (await client.get("/api/palettes")).json() == [{"name": "Porch party", "colors": ["#ff0000", "#00ff00"]}]
    for bad in ({"name": "x"}, [{"name": "", "colors": ["#ff0000"]}], [{"name": "x", "colors": []}],
                [{"name": "x", "colors": ["red"]}], [{"name": "x", "colors": ["#000000"] * 13}]):
        assert (await client.put("/api/palettes", json=bad)).status == 400


async def test_probe_lights_one_segment_then_stops(client):
    dev = {"ip": "192.0.2.10", "segments": 15}
    resp = await client.post("/api/devices/probe", json={**dev, "segment": 64})
    assert resp.status == 200
    out = client.app[server.OUTPUT]
    await asyncio.sleep(0.01)
    assert out.devices["192.0.2.10"].segments == 64
    assert (await client.post("/api/devices/probe", json={**dev, "segment": 32})).status == 200
    await asyncio.sleep(0.01)
    assert out.devices["192.0.2.10"].segments == 32
    assert (await client.post("/api/devices/probe", json={**dev, "segment": 0})).status == 200
    assert "192.0.2.10" not in out.devices
    assert (await client.post("/api/devices/probe", json={**dev, "segment": 999})).status == 400


async def test_static_files_are_revalidated(client):
    resp = await client.get("/static/js/effects.js")
    assert resp.status == 200
    assert resp.headers["Cache-Control"] == "no-cache"


async def test_live_preview_shows_frames_then_lets_go(client, monkeypatch):
    monkeypatch.setattr(server.LivePreview, "IDLE_S", 0.3)
    dev = {"ip": "192.0.2.11", "segments": 2, "brightness": 50}
    out = client.app[server.OUTPUT]
    resp = await client.post("/api/devices/preview", json={**dev, "rgb": "ff0000" + "00ff00"})
    assert resp.status == 200
    assert out.devices["192.0.2.11"].brightness == 50
    assert out.devices["192.0.2.11"].pending is not None or out.devices["192.0.2.11"].last_frame
    assert (await client.post("/api/devices/preview", json={**dev, "rgb": "ff00"})).status == 400
    assert (await client.post("/api/devices/preview", json={**dev, "rgb": "zz" * 6})).status == 400
    await asyncio.sleep(0.6)  # frames stopped: the light goes back to what it was doing
    assert "192.0.2.11" not in out.devices
    await client.post("/api/devices/preview", json={**dev, "rgb": "000000" * 2})
    assert "192.0.2.11" in out.devices
    assert (await client.post("/api/devices/preview", json={**dev, "stop": True})).status == 200
    assert "192.0.2.11" not in out.devices


async def test_house_photo_and_paths(client):
    assert (await (await client.get("/api/house")).json()) == {"paths": {}, "dim": 0.5, "photo": False}
    assert (await client.get("/api/house/photo")).status == 404
    resp = await client.put("/api/house/photo", data=b"\xff\xd8fakejpeg", headers={"Content-Type": "image/jpeg"})
    assert resp.status == 200
    resp = await client.get("/api/house/photo")
    assert resp.status == 200 and await resp.read() == b"\xff\xd8fakejpeg"
    # A new photo replaces the old one, even in another format.
    await client.put("/api/house/photo", data=b"\x89PNGfake", headers={"Content-Type": "image/png"})
    assert await (await client.get("/api/house/photo")).read() == b"\x89PNGfake"
    assert (await client.put("/api/house/photo", data=b"x", headers={"Content-Type": "text/plain"})).status == 415

    paths = {"porch": [[0.1, 0.2], [0.5, 0.25]], "empty": []}
    resp = await client.put("/api/house", json={"paths": paths, "dim": 0.7})
    assert (await resp.json()) == {"paths": {"porch": [[0.1, 0.2], [0.5, 0.25]]}, "dim": 0.7}
    assert (await (await client.get("/api/house")).json())["photo"] is True
    assert (await client.put("/api/house", json={"paths": {"a": [[2, 0]]}})).status == 400
    assert (await client.put("/api/house", json={"paths": {"a": [["x"]]}})).status == 400

    assert (await client.delete("/api/house/photo")).status == 200
    assert (await client.get("/api/house/photo")).status == 404
