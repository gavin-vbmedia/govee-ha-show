"""HTTP API and editor for the Home Assistant ingress panel.

All URLs the editor uses are relative, because ingress serves the panel from
/api/hassio_ingress/<token>/.
"""
import asyncio
import ipaddress
import logging
import os
from pathlib import Path

from aiohttp import web

from . import __version__, discovery
from .baked import BakedError, decode
from .output import Output, run_test_pattern
from .player import Player
from .storage import Storage, slugify, valid_id

log = logging.getLogger(__name__)

STATIC = Path(__file__).parent / "static"
INGRESS_PEER = "172.30.32.2"  # the Supervisor's ingress proxy
MAX_UPLOAD = 200 * 1024 * 1024

OUTPUT = web.AppKey("output", Output)
PLAYER = web.AppKey("player", Player)
STORAGE = web.AppKey("storage", Storage)
TESTS = web.AppKey("tests", dict)
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


async def info(request):
    return web.json_response({"version": __version__})


# devices -----------------------------------------------------------------
async def get_devices(request):
    return web.json_response(request.app[STORAGE].load_devices())


def _clean_device(d: dict) -> dict:
    try:
        ipaddress.IPv4Address(str(d["ip"]))
        segments = int(d.get("segments", 15))
    except (KeyError, ValueError) as e:
        raise web.HTTPBadRequest(text=f"bad device: {e}")
    if not 1 <= segments <= 255:
        raise web.HTTPBadRequest(text="segments must be 1-255")
    return {"id": str(d.get("id") or d["ip"]), "name": str(d.get("name") or d["ip"])[:64],
            "ip": str(d["ip"]), "sku": str(d.get("sku", "")), "segments": segments,
            "reverse": bool(d.get("reverse")), "gradient": bool(d.get("gradient"))}


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
    seconds = min(max(float(body.get("seconds", 15)), 1), 60)
    app = request.app
    await app[PLAYER].stop()
    tests = app[TESTS]
    if (old := tests.pop(d["ip"], None)):
        old.cancel()
    tests[d["ip"]] = asyncio.create_task(run_test_pattern(
        app[OUTPUT], d["ip"], d["segments"], seconds, reverse=d["reverse"], gradient=d["gradient"]))
    return web.json_response({"ok": True, "seconds": seconds})


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
    return web.json_response({"ok": True, "bytes": len(blob)})


async def delete_show(request):
    request.app[STORAGE].delete_show(_show_id(request))
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
    return web.json_response({"source": "upload", "path": dest.name})


# player ------------------------------------------------------------------
async def player_status(request):
    return web.json_response(request.app[PLAYER].status())


async def player_play(request):
    body = await request.json()
    show_id = str(body.get("show", ""))
    if not valid_id(show_id):
        raise web.HTTPBadRequest(text="bad show id")
    storage = request.app[STORAGE]
    blob = storage.load_baked(show_id)
    if blob is None:
        raise web.HTTPConflict(text="show has not been baked; save it first")
    await stop_tests(request.app)
    baked = decode(blob)
    await request.app[PLAYER].play(show_id, baked, storage.devices_by_id(),
                                   position=float(body.get("position", 0)),
                                   offset=float(body.get("offset", 0)))
    return web.json_response(request.app[PLAYER].status())


async def player_sync(request):
    body = await request.json()
    drift = request.app[PLAYER].sync(float(body.get("position", 0)))
    return web.json_response({**request.app[PLAYER].status(), "drift": round(drift, 4)})


async def player_stop(request):
    await request.app[PLAYER].stop()
    return web.json_response(request.app[PLAYER].status())


# app ---------------------------------------------------------------------
def make_app(config_dir: Path, media_dir: Path, *, allow_all: bool = False) -> web.Application:
    app = web.Application(middlewares=[ingress_only], client_max_size=MAX_UPLOAD)
    app[ALLOW_ALL] = allow_all
    app[STORAGE] = Storage(config_dir, media_dir)
    app[TESTS] = {}

    async def lifecycle(app):
        app[OUTPUT] = Output()
        app[OUTPUT].start()
        app[PLAYER] = Player(app[OUTPUT])
        yield
        await stop_tests(app)
        await app[PLAYER].stop()
        await app[OUTPUT].close()

    app.cleanup_ctx.append(lifecycle)
    r = app.router
    r.add_get("/", index)
    r.add_static("/static/", STATIC)
    r.add_get("/api/info", info)
    r.add_get("/api/devices", get_devices)
    r.add_put("/api/devices", put_devices)
    r.add_post("/api/devices/scan", scan_devices)
    r.add_post("/api/devices/test", test_device)
    r.add_get("/api/shows", list_shows)
    r.add_post("/api/shows", create_show)
    r.add_get("/api/shows/{id}", get_show)
    r.add_put("/api/shows/{id}", put_show)
    r.add_delete("/api/shows/{id}", delete_show)
    r.add_put("/api/shows/{id}/baked", put_baked)
    r.add_get("/api/audio", list_audio)
    r.add_post("/api/audio", upload_audio)
    r.add_get("/api/audio/file", get_audio)
    r.add_get("/api/player", player_status)
    r.add_post("/api/player/play", player_play)
    r.add_post("/api/player/sync", player_sync)
    r.add_post("/api/player/stop", player_stop)
    return app
