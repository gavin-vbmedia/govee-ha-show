import asyncio
import base64
import time

from aiohttp import web

from halidayshow import output, twinkly

TOKEN = base64.b64encode(b"\x01\x02\x03\x04\x05\x06\x07\x08").decode()


def fake_twinkly(leds=300, profile="RGB", firmware="2.8.18"):
    seen = {"mode": "movie", "calls": []}

    def authed(request):
        if request.headers.get("X-Auth-Token") != TOKEN:
            raise web.HTTPUnauthorized()

    async def gestalt(request):
        return web.json_response({"device_name": "Tree", "number_of_led": leds, "led_profile": profile, "code": 1000})

    async def version(request):
        return web.json_response({"version": firmware, "code": 1000})

    async def login(request):
        body = await request.json()
        assert len(base64.b64decode(body["challenge"])) == 32
        seen["calls"].append("login")
        return web.json_response({"authentication_token": TOKEN, "challenge-response": "abc", "code": 1000})

    async def verify(request):
        authed(request)
        assert (await request.json()) == {"challenge-response": "abc"}
        return web.json_response({"code": 1000})

    async def mode(request):
        authed(request)
        if request.method == "POST":
            seen["mode"] = (await request.json())["mode"]
            seen["calls"].append(f"mode {seen['mode']}")
        return web.json_response({"mode": seen["mode"], "code": 1000})

    app = web.Application()
    app.router.add_get("/xled/v1/gestalt", gestalt)
    app.router.add_get("/xled/v1/fw/version", version)
    app.router.add_post("/xled/v1/login", login)
    app.router.add_post("/xled/v1/verify", verify)
    app.router.add_route("*", "/xled/v1/led/mode", mode)
    return app, seen


class FakeSock:
    def __init__(self):
        self.sent = []

    def sendto(self, payload, addr):
        self.sent.append((payload, addr))


def test_realtime_packets():
    token = bytes(range(8))
    v3 = twinkly.rt_packets(token, bytes(range(256)) * 5, v3=True)  # 1280 bytes: two fragments
    assert [p[:12] for p in v3] == [b"\x03" + token + b"\x00\x00\x00", b"\x03" + token + b"\x00\x00\x01"]
    assert len(v3[0]) == 12 + 900 and b"".join(p[12:] for p in v3) == bytes(range(256)) * 5
    assert twinkly.rt_packets(token, b"\x01\x02\x03", v3=False) == [b"\x02" + token + b"\x00\x01\x02\x03"]
    assert twinkly.rt_packets(token, b"\x01\x02\x03", rgbw=True)[0][12:] == b"\x00\x01\x02\x03"
    assert twinkly.is_v3("2.8.18") and twinkly.is_v3("2.4.30") and not twinkly.is_v3("2.3.8")


async def test_light_is_switched_to_realtime_and_put_back(aiohttp_server, monkeypatch):
    app, seen = fake_twinkly(leds=2, profile="RGBW")
    server = await aiohttp_server(app, host="127.0.0.1")
    monkeypatch.setattr(twinkly, "HTTP_PORT", server.port)
    out = output.Output.__new__(output.Output)
    out.sock, out.devices, out.universes, out._task, out.ha, out.calls = FakeSock(), {}, {}, None, None, set()
    dev = out.claim("127.0.0.1", 2, protocol="twinkly")
    assert isinstance(dev, output.TwinklyDevice)
    dev.update(b"\xff\x00\x00\x00\x00\xff")
    dev.tick(time.monotonic())
    assert out.sock.sent == []  # not logged in yet
    await asyncio.wait(set(out.calls))
    assert seen["calls"] == ["login", "mode rt"]
    dev.tick(time.monotonic())
    (payload, addr), = out.sock.sent
    assert addr == ("127.0.0.1", twinkly.RT_PORT)
    assert payload == b"\x03" + base64.b64decode(TOKEN) + b"\x00\x00\x00" + b"\x00\xff\x00\x00\x00\x00\x00\xff"
    out.release("127.0.0.1")
    await asyncio.wait(set(out.calls))
    assert seen["calls"][-1] == "mode movie"  # back to what it was playing


async def test_info_endpoint(aiohttp_client, aiohttp_server, tmp_path, monkeypatch):
    from halidayshow import server as srv
    app, _ = fake_twinkly(leds=250)
    fake = await aiohttp_server(app, host="127.0.0.1")
    monkeypatch.setattr(twinkly, "HTTP_PORT", fake.port)
    client = await aiohttp_client(srv.make_app(tmp_path / "config", tmp_path / "media", allow_all=True))
    info = await (await client.post("/api/twinkly/info", json={"ip": "127.0.0.1"})).json()
    assert (info["name"], info["leds"], info["rgbw"], info["max"]) == ("Tree", 250, False, 1000)
    resp = await client.put("/api/devices", json=[{"kind": "twinkly", "ip": "127.0.0.1", "segments": 250,
                                                   "protocol": "standard", "gradient": True}])
    d, = await resp.json()
    assert (d["kind"], d["protocol"], d["gradient"]) == ("twinkly", "twinkly", False)
    await fake.close()
    assert (await client.post("/api/twinkly/info", json={"ip": "127.0.0.1"})).status == 502
    assert (await client.post("/api/twinkly/info", json={"ip": "x"})).status == 400
