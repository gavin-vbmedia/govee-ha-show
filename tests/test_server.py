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
                        "segments": 12, "reverse": False, "gradient": False}]
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
