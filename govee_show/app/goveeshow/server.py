"""HTTP API and editor for the Home Assistant ingress panel.

All URLs the editor uses are relative, because ingress serves the panel from
/api/hassio_ingress/<token>/.
"""
import asyncio
import contextlib
import ipaddress
import logging
import os
import re
from pathlib import Path

from aiohttp import web

from . import __version__, commands, discovery, scenes
from .baked import BakedError, decode
from .ha import HAError, HomeAssistant
from .mqtt import MqttBridge
from .output import PROBE_MAX, LivePreview, Output, run_probe, run_test_pattern
from .player import Player
from .protocol import PROTOCOLS
from .runner import Runner, RunnerError
from .storage import Storage, slugify, valid_id

log = logging.getLogger(__name__)

STATIC = Path(__file__).parent / "static"
INGRESS_PEER = "172.30.32.2"  # the Supervisor's ingress proxy
MAX_UPLOAD = 200 * 1024 * 1024

OUTPUT = web.AppKey("output", Output)
PLAYER = web.AppKey("player", Player)
STORAGE = web.AppKey("storage", Storage)
TESTS = web.AppKey("tests", dict)
PREVIEWS = web.AppKey("previews", dict)
HA = web.AppKey("ha", HomeAssistant)
RUNNER = web.AppKey("runner", Runner)
MQTT = web.AppKey("mqtt", MqttBridge)
BACKGROUND = web.AppKey("background", list)
ALLOW_ALL = web.AppKey("allow_all", bool)


@web.middleware
async def ingress_only(request: web.Request, handler):
    """host_network exposes our port on the LAN; only answer the ingress proxy."""
    if not request.app[ALLOW_ALL]:
        peer = request.remote or ""
        try:
            ok = peer == INGRESS_PEER or ipaddress.ip_address(peer).is_loopback
        except ValueError:
            ok = False
        if not ok:
            raise web.HTTPForbidden(text="Open Govee Light Show from the Home Assistant sidebar.")
    return await handler(request)


def _show_id(request) -> str:
    show_id = request.match_info["id"]
    if not valid_id(show_id):
        raise web.HTTPBadRequest(text="bad show id")
    return show_id


# pages -------------------------------------------------------------------
async def index(request):
    resp = web.FileResponse(STATIC / "index.html")
    resp.headers["Cache-Control"] = "no-cache"
    return resp


async def no_cache_static(request, response):
    """Make browsers check for a newer app.js and effects.js after each update.

    Without this they may keep running the previous version's scripts for days. Unchanged files
    still come back as a quick 304.
    """
    if request.path.startswith("/static/"):
        response.headers["Cache-Control"] = "no-cache"


async def info(request):
    return web.json_response({"version": __version__, "ha": request.app[HA].available,
                              "mqtt": request.app[MQTT].client is not None})


# devices -----------------------------------------------------------------
async def get_devices(request):
    return web.json_response(request.app[STORAGE].load_devices())


def _clean_device(d: dict) -> dict:
    """A device with no IP is planned: it has tracks in shows but nothing to send to yet."""
    ip = str(d.get("ip") or "").strip()
    try:
        if ip:
            ipaddress.IPv4Address(ip)
        segments = int(d.get("segments", 15))
    except (TypeError, ValueError) as e:
        raise web.HTTPBadRequest(text=f"bad device: {e}")
    if not 1 <= segments <= 255:
        raise web.HTTPBadRequest(text="segments must be 1-255")
    try:
        brightness = int(d.get("brightness", 100))
    except (TypeError, ValueError):
        raise web.HTTPBadRequest(text="brightness must be a number")
    if not 1 <= brightness <= 100:
        raise web.HTTPBadRequest(text="brightness must be 1-100")
    protocol = str(d.get("protocol") or "standard")
    if protocol not in PROTOCOLS:
        raise web.HTTPBadRequest(text=f"protocol must be one of {', '.join(PROTOCOLS)}")
    dev_id = str(d.get("id") or ip)
    if not dev_id:
        raise web.HTTPBadRequest(text="a planned device needs an id")
    return {"id": dev_id, "name": str(d.get("name") or ip or dev_id)[:64],
            "ip": ip, "sku": str(d.get("sku", "")), "segments": segments,
            "reverse": bool(d.get("reverse")), "gradient": bool(d.get("gradient")),
            "protocol": protocol, "brightness": brightness}


async def put_devices(request):
    body = await request.json()
    if not isinstance(body, list):
        raise web.HTTPBadRequest(text="expected a list")
    devices = [_clean_device(d) for d in body]
    if len({d["id"] for d in devices}) != len(devices):
        raise web.HTTPBadRequest(text="duplicate device id")
    request.app[STORAGE].save_devices(devices)
    return web.json_response(devices)


async def scan_devices(request):
    found = await discovery.scan()
    return web.json_response([{"id": d.get("device") or d["ip"], "ip": d["ip"],
                               "sku": d.get("sku", "")} for d in found])


async def test_device(request):
    body = await request.json()
    d = _clean_device(body)
    if not d["ip"]:
        raise web.HTTPBadRequest(text="link this device to a real light before testing it")
    seconds = min(max(float(body.get("seconds", 15)), 1), 60)
    app = request.app
    await app[RUNNER].stop()
    tests = app[TESTS]
    if (old := tests.pop(d["ip"], None)):
        old.cancel()
    tests[d["ip"]] = asyncio.create_task(run_test_pattern(
        app[OUTPUT], d["ip"], d["segments"], seconds, reverse=d["reverse"], gradient=d["gradient"],
        protocol=d["protocol"], brightness=d["brightness"]))
    return web.json_response({"ok": True, "seconds": seconds})


async def probe_device(request):
    """Find segments: light one segment so the user can say whether it exists. Segment 0 stops."""
    body = await request.json()
    d = _clean_device(body)
    if not d["ip"]:
        raise web.HTTPBadRequest(text="link this device to a real light first")
    try:
        segment = int(body.get("segment", 0))
    except (TypeError, ValueError):
        raise web.HTTPBadRequest(text="segment must be a number")
    if not 0 <= segment <= PROBE_MAX:
        raise web.HTTPBadRequest(text=f"segment must be 0-{PROBE_MAX}")
    app = request.app
    tests = app[TESTS]
    if (old := tests.pop(d["ip"], None)):
        old.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await old
    if segment == 0:
        app[OUTPUT].release(d["ip"])
        return web.json_response({"ok": True})
    await app[RUNNER].stop()
    tests[d["ip"]] = asyncio.create_task(run_probe(
        app[OUTPUT], d["ip"], segment, gradient=d["gradient"], protocol=d["protocol"]))
    return web.json_response({"ok": True, "max": PROBE_MAX})


async def preview_device(request):
    """One frame of the clip being edited, shown on the light until frames stop or `stop` is sent."""
    body = await request.json()
    d = _clean_device(body)
    if not d["ip"]:
        raise web.HTTPBadRequest(text="link this device to a real light first")
    app = request.app
    previews, tests = app[PREVIEWS], app[TESTS]
    live = previews.get(d["ip"])
    if body.get("stop"):
        if live and not live.task.done():
            live.stop()
        return web.json_response({"ok": True})
    try:
        rgb = bytes.fromhex(str(body.get("rgb", "")))
    except ValueError:
        raise web.HTTPBadRequest(text="rgb must be hex")
    if len(rgb) != d["segments"] * 3:
        raise web.HTTPBadRequest(text="rgb must have 3 bytes per segment")
    if live is None or live.task.done():
        # Previewing takes the light over from a running show or a test, like Test does.
        await app[RUNNER].stop()
        if (old := tests.pop(d["ip"], None)):
            old.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await old
        live = previews[d["ip"]] = LivePreview(app[OUTPUT], d["ip"])
        tests[d["ip"]] = live.task
    live.show(rgb, d["segments"], reverse=d["reverse"], gradient=d["gradient"], protocol=d["protocol"],
              brightness=d["brightness"])
    return web.json_response({"ok": True})


async def get_scenes(request):
    """Experimental: Govee's built-in scenes for a model, for scene clips."""
    try:
        found = await scenes.scenes_for(request.query.get("sku", ""),
                                        request.app[STORAGE].config_dir / "scenes")
    except scenes.SceneError as e:
        raise web.HTTPBadGateway(text=str(e))
    return web.json_response(found)


async def stop_tests(app):
    for task in app[TESTS].values():
        task.cancel()
    app[TESTS].clear()


# shows -------------------------------------------------------------------
async def list_shows(request):
    return web.json_response(request.app[STORAGE].list_shows())


async def get_show(request):
    show = request.app[STORAGE].load_show(_show_id(request))
    if show is None:
        raise web.HTTPNotFound()
    return web.json_response(show)


async def create_show(request):
    body = await request.json()
    storage = request.app[STORAGE]
    base = slugify(str(body.get("name", "show")))
    show_id, n = base, 2
    while storage.load_show(show_id) is not None:
        show_id, n = f"{base}-{n}", n + 1
    return web.json_response({"id": show_id})


async def put_show(request):
    show = await request.json()
    if not isinstance(show, dict) or not isinstance(show.get("tracks", []), list):
        raise web.HTTPBadRequest(text="bad show")
    request.app[STORAGE].save_show(_show_id(request), show)
    return web.json_response({"ok": True})


async def put_baked(request):
    show_id = _show_id(request)
    blob = await request.read()
    try:
        decode(blob)
    except BakedError as e:
        raise web.HTTPBadRequest(text=str(e))
    request.app[STORAGE].save_baked(show_id, blob)
    request.app[MQTT].refresh()
    return web.json_response({"ok": True, "bytes": len(blob)})


async def delete_show(request):
    request.app[STORAGE].delete_show(_show_id(request))
    request.app[MQTT].refresh()
    return web.json_response({"ok": True})


# audio -------------------------------------------------------------------
async def list_audio(request):
    return web.json_response(request.app[STORAGE].list_audio())


async def get_audio(request):
    p = request.app[STORAGE].audio_path(request.query.get("source", ""),
                                        request.query.get("path", ""))
    if p is None:
        raise web.HTTPNotFound()
    return web.FileResponse(p)


async def upload_audio(request):
    reader = await request.multipart()
    field = await reader.next()
    if field is None or not field.filename:
        raise web.HTTPBadRequest(text="no file")
    dest = request.app[STORAGE].upload_path(field.filename)
    if dest is None:
        raise web.HTTPBadRequest(text="not an audio file")
    tmp = dest.with_name(dest.name + ".part")
    size = 0
    with tmp.open("wb") as f:
        while chunk := await field.read_chunk(1 << 16):
            size += len(chunk)
            if size > MAX_UPLOAD:
                f.close()
                tmp.unlink()
                raise web.HTTPRequestEntityTooLarge(max_size=MAX_UPLOAD, actual_size=size)
            f.write(chunk)
    os.replace(tmp, dest)
    storage = request.app[STORAGE]
    return web.json_response({"source": "media", "path": str(dest.relative_to(storage.media_dir))})


# speakers ----------------------------------------------------------------
async def list_speakers(request):
    ha = request.app[HA]
    delays = request.app[STORAGE].load_settings()["speaker_delays"]
    if not ha.available:
        return web.json_response({"available": False, "speakers": []})
    try:
        states = await ha.states("media_player")
    except HAError as e:
        return web.json_response({"available": False, "error": str(e), "speakers": []})
    speakers = [{"entity_id": s["entity_id"], "state": s["state"],
                 "name": s.get("attributes", {}).get("friendly_name") or s["entity_id"],
                 "delay_ms": delays.get(s["entity_id"], 0)} for s in states]
    return web.json_response({"available": True,
                              "speakers": sorted(speakers, key=lambda s: s["name"].lower())})


async def put_speaker_delay(request):
    body = await request.json()
    entity = str(body.get("entity_id", ""))
    if not entity.startswith("media_player."):
        raise web.HTTPBadRequest(text="expected a media_player entity")
    try:
        delay = max(-5000, min(5000, int(body.get("delay_ms", 0))))
    except (TypeError, ValueError):
        raise web.HTTPBadRequest(text="delay_ms must be a number")
    storage = request.app[STORAGE]
    settings = storage.load_settings()
    settings["speaker_delays"][entity] = delay
    storage.save_settings(settings)
    return web.json_response({"entity_id": entity, "delay_ms": delay})


# colour palettes ------------------------------------------------------------
# The presets ship in palettes.js; only the user's own palettes are stored here.
_HEX = re.compile(r"^#[0-9a-fA-F]{6}$")


async def get_palettes(request):
    return web.json_response(request.app[STORAGE].load_settings().get("palettes", []))


async def put_palettes(request):
    body = await request.json()
    if not isinstance(body, list) or len(body) > 100:
        raise web.HTTPBadRequest(text="expected a list of up to 100 palettes")
    palettes = []
    for p in body:
        name = str(p.get("name", "")).strip()[:60] if isinstance(p, dict) else ""
        colors = p.get("colors") if isinstance(p, dict) else None
        if not name or not isinstance(colors, list) or not 1 <= len(colors) <= 12 \
                or not all(isinstance(c, str) and _HEX.match(c) for c in colors):
            raise web.HTTPBadRequest(text="each palette needs a name and 1 to 12 #rrggbb colours")
        palettes.append({"name": name, "colors": [c.lower() for c in colors]})
    storage = request.app[STORAGE]
    settings = storage.load_settings()
    settings["palettes"] = palettes
    storage.save_settings(settings)
    return web.json_response(palettes)


# house view --------------------------------------------------------------
MAX_PHOTO = 20 * 1024 * 1024
MAX_POINTS = 200


async def get_house(request):
    return web.json_response({**_house(request.app[STORAGE].load_settings()),
                              "photo": request.app[STORAGE].house_photo() is not None})


def _house(settings: dict) -> dict:
    house = settings.get("house", {})
    return {"paths": house.get("paths", {}), "dim": house.get("dim", 0.5)}


async def put_house(request):
    """Where each light runs on the house photo (points from 0 to 1 across and down the photo,
    starting at the plug) and how much to darken the photo."""
    body = await request.json()
    paths = body.get("paths") if isinstance(body, dict) else None
    if not isinstance(paths, dict) or len(paths) > 100:
        raise web.HTTPBadRequest(text="expected paths for up to 100 lights")
    clean = {}
    for dev_id, points in paths.items():
        if not isinstance(points, list) or len(points) > MAX_POINTS:
            raise web.HTTPBadRequest(text=f"a path has up to {MAX_POINTS} points")
        try:
            pts = [[round(float(x), 5), round(float(y), 5)] for x, y in points]
        except (TypeError, ValueError):
            raise web.HTTPBadRequest(text="points are [x, y] pairs")
        if not all(0 <= v <= 1 for p in pts for v in p):
            raise web.HTTPBadRequest(text="points must be between 0 and 1")
        if pts:
            clean[str(dev_id)[:64]] = pts
    try:
        dim = min(max(float(body.get("dim", 0.5)), 0), 0.9)
    except (TypeError, ValueError):
        raise web.HTTPBadRequest(text="dim must be a number")
    storage = request.app[STORAGE]
    settings = storage.load_settings()
    settings["house"] = {"paths": clean, "dim": dim}
    storage.save_settings(settings)
    return web.json_response(_house(settings))


async def get_house_photo(request):
    p = request.app[STORAGE].house_photo()
    if p is None:
        raise web.HTTPNotFound()
    return web.FileResponse(p)


async def put_house_photo(request):
    ext = PHOTO_TYPES.get(request.content_type)
    if ext is None:
        raise web.HTTPUnsupportedMediaType(text="send a JPEG, PNG or WebP photo")
    data = bytearray()
    while chunk := await request.content.read(1 << 16):
        data += chunk
        if len(data) > MAX_PHOTO:
            raise web.HTTPRequestEntityTooLarge(max_size=MAX_PHOTO, actual_size=len(data))
    if not data:
        raise web.HTTPBadRequest(text="no photo")
    request.app[STORAGE].save_house_photo(bytes(data), ext)
    return web.json_response({"ok": True})


async def delete_house_photo(request):
    request.app[STORAGE].delete_house_photo()
    return web.json_response({"ok": True})


PHOTO_TYPES = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}


# player ------------------------------------------------------------------
async def player_status(request):
    return web.json_response(request.app[RUNNER].status())


async def player_play(request):
    body = await request.json()
    show_id = str(body.get("show", ""))
    if not valid_id(show_id):
        raise web.HTTPBadRequest(text="bad show id")
    await stop_tests(request.app)
    runner = request.app[RUNNER]
    try:
        await runner.play(show_id, media_player=body.get("media_player") or None,
                          position=float(body.get("position", 0)),
                          offset=float(body.get("offset", 0)))
    except RunnerError as e:
        raise web.HTTPConflict(text=str(e))
    return web.json_response(runner.status())


async def player_sync(request):
    body = await request.json()
    runner = request.app[RUNNER]
    drift = 0.0
    if not runner.media_player:  # a speaker sets its own pace
        drift = request.app[PLAYER].sync(float(body.get("position", 0)))
    return web.json_response({**runner.status(), "drift": round(drift, 4)})


async def player_stop(request):
    await request.app[RUNNER].stop()
    return web.json_response(request.app[RUNNER].status())


async def run_command(request):
    """The same commands automations send, for trying them from the editor or curl."""
    try:
        result = await commands.handle(request.app[RUNNER], await request.text())
    except (ValueError, RunnerError) as e:
        raise web.HTTPBadRequest(text=str(e))
    return web.json_response({"result": result, **request.app[RUNNER].status()})


# app ---------------------------------------------------------------------
def make_app(config_dir: Path, media_dir: Path, *, allow_all: bool = False,
             read_stdin: bool = False) -> web.Application:
    app = web.Application(middlewares=[ingress_only], client_max_size=MAX_UPLOAD)
    app.on_response_prepare.append(no_cache_static)
    app[ALLOW_ALL] = allow_all
    app[STORAGE] = Storage(config_dir, media_dir)
    app[TESTS] = {}
    app[PREVIEWS] = {}

    async def lifecycle(app):
        app[OUTPUT] = Output()
        app[OUTPUT].start()
        app[PLAYER] = Player(app[OUTPUT])
        app[HA] = HomeAssistant()
        app[RUNNER] = Runner(app[STORAGE], app[PLAYER], app[HA])
        app[MQTT] = MqttBridge(app[RUNNER])
        app[BACKGROUND] = []
        if read_stdin:
            app[BACKGROUND].append(asyncio.create_task(commands.read_stdin(app[RUNNER])))
        if (broker := await app[HA].mqtt_service()):
            app[BACKGROUND].append(asyncio.create_task(app[MQTT].run(broker)))
        else:
            log.info("no MQTT broker found; show entities are off (automations can use add-on stdin)")
        yield
        for task in app[BACKGROUND]:
            task.cancel()
        await stop_tests(app)
        await app[RUNNER].stop()
        await app[OUTPUT].close()
        await app[HA].close()

    app.cleanup_ctx.append(lifecycle)
    r = app.router
    r.add_get("/", index)
    r.add_static("/static/", STATIC)
    r.add_get("/api/info", info)
    r.add_get("/api/devices", get_devices)
    r.add_put("/api/devices", put_devices)
    r.add_post("/api/devices/scan", scan_devices)
    r.add_post("/api/devices/test", test_device)
    r.add_post("/api/devices/probe", probe_device)
    r.add_post("/api/devices/preview", preview_device)
    r.add_get("/api/shows", list_shows)
    r.add_post("/api/shows", create_show)
    r.add_get("/api/shows/{id}", get_show)
    r.add_put("/api/shows/{id}", put_show)
    r.add_delete("/api/shows/{id}", delete_show)
    r.add_put("/api/shows/{id}/baked", put_baked)
    r.add_get("/api/audio", list_audio)
    r.add_post("/api/audio", upload_audio)
    r.add_get("/api/audio/file", get_audio)
    r.add_get("/api/speakers", list_speakers)
    r.add_put("/api/speakers/delay", put_speaker_delay)
    r.add_get("/api/palettes", get_palettes)
    r.add_get("/api/scenes", get_scenes)
    r.add_put("/api/palettes", put_palettes)
    r.add_get("/api/house", get_house)
    r.add_put("/api/house", put_house)
    r.add_get("/api/house/photo", get_house_photo)
    r.add_put("/api/house/photo", put_house_photo)
    r.add_delete("/api/house/photo", delete_house_photo)
    r.add_post("/api/command", run_command)
    r.add_get("/api/player", player_status)
    r.add_post("/api/player/play", player_play)
    r.add_post("/api/player/sync", player_sync)
    r.add_post("/api/player/stop", player_stop)
    return app
