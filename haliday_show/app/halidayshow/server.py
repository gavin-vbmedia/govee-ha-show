"""HTTP API and editor for the Home Assistant ingress panel.

All URLs the editor uses are relative, because ingress serves the panel from
/api/hassio_ingress/<token>/.
"""
import asyncio
import contextlib
import ipaddress
import json
import logging
import math
import os
import re
import time
from pathlib import Path

from aiohttp import web

from . import __version__, ai, commands, discovery, migrate, scenes, wled
from .baked import BakedError, decode
from .ha import HAError, HomeAssistant
from .lab import (KINDS as LAB_KINDS, MAX_REPEAT as LAB_MAX_REPEAT, MAX_STEPS as LAB_MAX_STEPS, Lab, LabError,
                  Step as LabStep, build as lab_build, pixel_speed_steps)
from .listen import Listener
from .mqtt import MqttBridge
from .output import PROBE_MAX, LivePreview, Output, run_hold, run_probe, run_test_pattern
from .player import Player
from .protocol import LONG_PROTOCOLS, PROTOCOLS
from .runner import Runner, RunnerError
from .storage import Storage, slugify, valid_id

log = logging.getLogger(__name__)

STATIC = Path(__file__).parent / "static"
INGRESS_PEER = "172.30.32.2"  # the Supervisor's ingress proxy
MAX_UPLOAD = 200 * 1024 * 1024
MAX_BULBS = 2000  # bulbs on one light
MAX_SEGMENTS = 1000  # per light; the Christmas String Lights 2 have 300 bulbs

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
# {"listener": the latest Listener or None, "options": Listener options (tests use spare ports)}
LISTENING = web.AppKey("listening", dict)
LAB = web.AppKey("lab", Lab)


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
            raise web.HTTPForbidden(text="Open HA-liday Show from the Home Assistant sidebar.")
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


# diagnostics -------------------------------------------------------------
async def start_listening(request):
    """Record other Govee traffic for a while, e.g. a Scene Stage sync centre driving lights."""
    body = await request.json()
    try:
        seconds = float(body.get("seconds", 60))
    except (TypeError, ValueError, AttributeError):
        raise web.HTTPBadRequest(text="seconds must be a number")
    if not 1 <= seconds <= 180:
        raise web.HTTPBadRequest(text="seconds must be 1-180")
    app = request.app
    listening = app[LISTENING]
    if (old := listening["listener"]) and old.running:
        old.stop()
    await app[RUNNER].stop()  # so the add-on's own frames aren't in the recording
    lights = {d["ip"]: d["name"] for d in app[STORAGE].load_devices() if d.get("ip")}
    listener = listening["listener"] = Listener(lights, **listening["options"])
    listener.start(seconds)
    return web.json_response({"ok": True, "seconds": seconds})


async def listening_status(request):
    listener = request.app[LISTENING]["listener"]
    if listener is None:
        return web.json_response({"running": False, "count": 0, "summary": []})
    if request.query.get("download"):
        body = json.dumps({"raw": listener.raw, "lights": listener.lights, "packets": listener.records}, indent=1)
        return web.Response(text=body, content_type="application/json",
                            headers={"Content-Disposition": 'attachment; filename="govee-traffic.json"'})
    left = max(0.0, listener.until - time.monotonic()) if listener.running else 0.0
    return web.json_response({"running": listener.running, "left": round(left), "raw": listener.raw,
                              "count": len(listener.records), "summary": listener.summary()[:30]})


def _lab_step(body: dict) -> LabStep:
    if not isinstance(body, dict):
        raise web.HTTPBadRequest(text="each step must be an object")
    kind = body.get("kind")
    if kind not in LAB_KINDS:
        raise web.HTTPBadRequest(text=f"kind must be one of {', '.join(LAB_KINDS)}")
    try:
        repeat = int(body.get("repeat", 1))
        interval = float(body.get("interval_ms", 100)) / 1000
        length = None if body.get("length") in (None, "") else int(body["length"])
    except (TypeError, ValueError):
        raise web.HTTPBadRequest(text="repeat, interval and length must be numbers")
    if not 1 <= repeat <= LAB_MAX_REPEAT:
        raise web.HTTPBadRequest(text=f"repeat must be 1-{LAB_MAX_REPEAT}")
    if not 0.02 <= interval <= 5:
        raise web.HTTPBadRequest(text="interval must be 20-5000 ms")
    if length is not None and not 0 <= length <= 0xFFFF:
        raise web.HTTPBadRequest(text="length must be 0-65535")
    extra = {}
    for key in ("before", "after"):
        msgs = body.get(key, [])
        if not isinstance(msgs, list) or len(msgs) > 4 or not all(
                isinstance(b, dict) and b.get("kind") in LAB_KINDS for b in msgs):
            raise web.HTTPBadRequest(text=f"{key} must be a list of up to 4 messages, each with a kind and text")
        extra[key] = msgs
    try:
        payload = lab_build(kind, str(body.get("text", "")), length)
        setup = [lab_build(b["kind"], str(b.get("text", ""))) for b in extra["before"]]
        after = [lab_build(b["kind"], str(b.get("text", ""))) for b in extra["after"]]
    except LabError as e:
        raise web.HTTPBadRequest(text=str(e))
    return LabStep(payload, repeat, interval, bool(body.get("realtime_on")), str(body.get("label", ""))[:120],
                   before=setup, after=after)


async def lab_send(request):
    """Packet lab: send a hand-made message to one of your lights, or a sweep of several in turn."""
    body = await request.json()
    if not isinstance(body, dict):
        raise web.HTTPBadRequest(text="expected an object")
    app = request.app
    ip = str(body.get("ip", ""))
    if not ip or ip not in {d["ip"] for d in app[STORAGE].load_devices()}:
        raise web.HTTPBadRequest(text="pick one of your lights")
    raw_steps = body["steps"] if "steps" in body else [body]
    if not isinstance(raw_steps, list) or not 1 <= len(raw_steps) <= LAB_MAX_STEPS:
        raise web.HTTPBadRequest(text=f"steps must be a list of 1-{LAB_MAX_STEPS}")
    steps = [_lab_step(s) for s in raw_steps]
    # Nothing else may talk to the light meanwhile, or the results mean nothing.
    await app[RUNNER].stop()
    if (old := app[TESTS].pop(ip, None)):
        old.cancel()
    app[OUTPUT].release(ip)
    app[LAB].start(ip, steps)
    return web.json_response({"ok": True, "steps": len(steps)})


async def lab_speed(request):
    """Per-bulb speed test: red and blue pictures in turn on one of your lights, at a set rate."""
    body = await request.json()
    if not isinstance(body, dict):
        raise web.HTTPBadRequest(text="expected an object")
    app = request.app
    ip = str(body.get("ip", ""))
    if not ip or ip not in {d["ip"] for d in app[STORAGE].load_devices()}:
        raise web.HTTPBadRequest(text="pick one of your lights")
    try:
        bulbs, per_second = int(body.get("bulbs", 300)), float(body.get("per_second", 2))
    except (TypeError, ValueError):
        raise web.HTTPBadRequest(text="bulbs and per_second must be numbers")
    if not 1 <= bulbs <= MAX_SEGMENTS or not 0.5 <= per_second <= 20:
        raise web.HTTPBadRequest(text=f"bulbs must be 1-{MAX_SEGMENTS} and per_second 0.5-20")
    await app[RUNNER].stop()
    if (old := app[TESTS].pop(ip, None)):
        old.cancel()
    app[OUTPUT].release(ip)
    app[LAB].start(ip, pixel_speed_steps(bulbs, bool(body.get("small")), per_second))
    return web.json_response({"ok": True})


async def lab_stop(request):
    request.app[LAB].stop()
    return web.json_response({"ok": True})


async def lab_status(request):
    return web.json_response(request.app[LAB].status())


# devices -----------------------------------------------------------------
async def get_devices(request):
    return web.json_response(request.app[STORAGE].load_devices())


_PART_ID = re.compile(r"^[A-Za-z0-9_-]{1,32}$")
MAX_PARTS = 32


def _clean_parts(parts, segments: int) -> list:
    """A light split into parts: each a named run of its segments (1-based, inclusive). Parts can't
    overlap; segments outside every part stay off in shows."""
    if not parts:
        return []
    if not isinstance(parts, list) or len(parts) > MAX_PARTS:
        raise web.HTTPBadRequest(text=f"parts must be a list of up to {MAX_PARTS}")
    clean, used = [], set()
    for p in parts:
        try:
            pid, start, end = str(p["id"]), int(p["from"]), int(p["to"])
        except (KeyError, TypeError, ValueError):
            raise web.HTTPBadRequest(text="each part needs an id, from and to")
        if not _PART_ID.match(pid) or any(c["id"] == pid for c in clean):
            raise web.HTTPBadRequest(text="part ids must be short and unique")
        if not 1 <= start <= end <= segments:
            raise web.HTTPBadRequest(text=f"a part must run within segments 1-{segments}")
        span = set(range(start, end + 1))
        if span & used:
            raise web.HTTPBadRequest(text="parts can't overlap")
        used |= span
        clean.append({"id": pid, "name": str(p.get("name") or f"Part {len(clean) + 1}")[:64], "from": start, "to": end})
    return sorted(clean, key=lambda c: c["from"])


def _clean_device(d: dict) -> dict:
    """A device with no IP is planned: it has tracks in shows but nothing to send to yet."""
    ip = str(d.get("ip") or "").strip()
    try:
        if ip:
            ipaddress.IPv4Address(ip)
        segments = int(d.get("segments", 15))
    except (TypeError, ValueError) as e:
        raise web.HTTPBadRequest(text=f"bad device: {e}")
    # Saved before WLED existed (say, restored from an old backup), a device has no kind: it's a Govee
    # light. Start-up fills these in (migrate.fill_device_kinds).
    kind = "wled" if d.get("kind") == "wled" else "govee"
    protocol = "ddp" if kind == "wled" else str(d.get("protocol") or "standard")
    if kind == "govee" and protocol not in PROTOCOLS:
        raise web.HTTPBadRequest(text=f"protocol must be one of {', '.join(PROTOCOLS)}")
    # Realtime messages hold the segment count in one byte; the other protocols can go further.
    most = MAX_SEGMENTS if protocol in LONG_PROTOCOLS or kind == "wled" else 255
    if not 1 <= segments <= most:
        raise web.HTTPBadRequest(text=f"segments must be 1-{most} with this protocol")
    try:
        brightness = int(d.get("brightness", 100))
    except (TypeError, ValueError):
        raise web.HTTPBadRequest(text="brightness must be a number")
    if not 1 <= brightness <= 100:
        raise web.HTTPBadRequest(text="brightness must be 1-100")
    try:
        bulbs = int(d["bulbs"]) if d.get("bulbs") else None
    except (TypeError, ValueError):
        raise web.HTTPBadRequest(text="bulbs must be a number")
    if bulbs is not None and not 1 <= bulbs <= MAX_BULBS:
        raise web.HTTPBadRequest(text=f"bulbs must be 1-{MAX_BULBS}")
    dev_id = str(d.get("id") or ip)
    if not dev_id:
        raise web.HTTPBadRequest(text="a planned device needs an id")
    return {"id": dev_id, "name": str(d.get("name") or ip or dev_id)[:64], "kind": kind,
            "ip": ip, "sku": "" if kind == "wled" else str(d.get("sku", "")), "segments": segments,
            "reverse": bool(d.get("reverse")), "gradient": kind == "govee" and bool(d.get("gradient")),
            "protocol": protocol, "brightness": brightness, "bulbs": bulbs,
            "parts": _clean_parts(d.get("parts"), segments),
            # A split light's own track plays across all its parts unless this is off.
            "whole": d.get("whole", True) is not False}


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


async def wled_info(request):
    """Ask a WLED light for its name, LED count and segments, to fill in a new light or its parts."""
    body = await request.json()
    ip = str(body.get("ip") or "").strip() if isinstance(body, dict) else ""
    try:
        ipaddress.IPv4Address(ip)
    except ValueError:
        raise web.HTTPBadRequest(text="ip must be an IP address")
    try:
        found = await wled.fetch(ip)
    except wled.WledError as e:
        raise web.HTTPBadGateway(text=str(e))
    return web.json_response({**found, "max": MAX_SEGMENTS})


async def test_device(request):
    body = await request.json()
    d = _clean_device(body)
    if not d["ip"]:
        raise web.HTTPBadRequest(text="link this device to a real light before testing it")
    seconds = min(max(float(body.get("seconds", 15)), 1), 60)
    rgb = None
    if body.get("rgb") is not None:
        # A still frame instead of the rainbow, e.g. the light's parts in their colours.
        try:
            rgb = bytes.fromhex(str(body["rgb"]))
        except ValueError:
            raise web.HTTPBadRequest(text="rgb must be hex")
        if len(rgb) != d["segments"] * 3:
            raise web.HTTPBadRequest(text="rgb must have 3 bytes per segment")
    app = request.app
    tests = app[TESTS]
    if (old := tests.pop(d["ip"], None)):
        old.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await old
    if body.get("stop"):
        app[OUTPUT].release(d["ip"])
        return web.json_response({"ok": True})
    if app[RUNNER].player.playing:  # stopping lets go of every light, which makes a lit test blink
        await app[RUNNER].stop()
    settings = dict(reverse=d["reverse"], gradient=d["gradient"], protocol=d["protocol"], brightness=d["brightness"])
    if rgb is None:
        task = run_test_pattern(app[OUTPUT], d["ip"], d["segments"], seconds, **settings)
    else:
        task = run_hold(app[OUTPUT], d["ip"], rgb, d["segments"], seconds, **settings)
    tests[d["ip"]] = asyncio.create_task(task)
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


MAX_MARKS = 50000
MAX_SECTIONS = 500
MAX_NOTES = 300  # a section's notes, for the AI


def _times(v) -> list[float] | None:
    if not isinstance(v, list) or len(v) > MAX_MARKS:
        return None
    out = []
    for t in v:
        if isinstance(t, bool) or not isinstance(t, (int, float)) or not math.isfinite(t) or t < 0:
            return None
        out.append(round(float(t), 4))
    return out


def _clean_song_info(body) -> dict | None:
    """Detect's results for a song: {tempo, beats, bars, sections: [{start, end, label, energy}]}."""
    if not isinstance(body, dict):
        return None
    tempo = body.get("tempo")
    if tempo is not None and (isinstance(tempo, bool) or not isinstance(tempo, (int, float))
                              or not math.isfinite(tempo) or not 0 < tempo < 1000):
        return None
    beats, bars = _times(body.get("beats", [])), _times(body.get("bars", []))
    sections = body.get("sections", [])
    if beats is None or bars is None or not isinstance(sections, list) or len(sections) > MAX_SECTIONS:
        return None
    clean = []
    for sec in sections:
        if not isinstance(sec, dict):
            return None
        span = _times([sec.get("start"), sec.get("end")])
        energy = sec.get("energy", 0)
        if span is None or isinstance(energy, bool) or not isinstance(energy, (int, float)) or not math.isfinite(energy):
            return None
        item = {"start": span[0], "end": span[1], "label": str(sec.get("label", ""))[:40],
                "energy": round(float(energy), 4)}
        notes = sec.get("notes")
        if notes is not None:
            if not isinstance(notes, str):
                return None
            if notes.strip():
                item["notes"] = notes.strip()[:MAX_NOTES]
        color = sec.get("color")
        if color is not None:
            if not isinstance(color, str) or not _HEX.match(color):
                return None
            item["color"] = color.lower()
        clean.append(item)
    return {"tempo": tempo, "beats": beats, "bars": bars, "sections": clean}


async def get_song_info(request):
    q = request.query
    return web.json_response(request.app[STORAGE].load_song_info(q.get("source", ""), q.get("path", "")))


async def put_song_info(request):
    info = _clean_song_info(await request.json())
    if info is None:
        raise web.HTTPBadRequest(text="expected {tempo, beats, bars, sections}")
    q = request.query
    if not request.app[STORAGE].save_song_info(q.get("source", ""), q.get("path", ""), info):
        raise web.HTTPNotFound()
    return web.json_response({"ok": True})


# speakers ----------------------------------------------------------------
PLAY_MEDIA = 512  # MediaPlayerEntityFeature.PLAY_MEDIA in a media player's supported_features


def _media_player(entity) -> str:
    entity = str(entity or "")
    if not entity.startswith("media_player."):
        raise web.HTTPBadRequest(text="expected a media_player entity")
    return entity


async def list_speakers(request):
    """`speakers` are the ones added on the Speakers tab (each passed a test there); the editor
    only offers those. `candidates` are all of Home Assistant's media players."""
    ha = request.app[HA]
    settings = request.app[STORAGE].load_settings()
    delays, added = settings["speaker_delays"], settings.get("speakers", [])
    body = {"available": ha.available, "show_speaker": settings.get("show_speaker"), "candidates": []}
    states = {}
    if ha.available:
        try:
            states = {s["entity_id"]: s for s in await ha.states("media_player")}
        except HAError as e:
            body.update(available=False, error=str(e))
    name = lambda e: states.get(e, {}).get("attributes", {}).get("friendly_name") or e  # noqa: E731
    body["speakers"] = [{"entity_id": e, "name": name(e), "state": states.get(e, {}).get("state", "unavailable"),
                         "delay_ms": delays.get(e, 0)} for e in added]
    body["candidates"] = sorted(({
        "entity_id": e, "name": name(e), "state": st["state"], "added": e in added,
        "can_play": bool(int(st.get("attributes", {}).get("supported_features") or 0) & PLAY_MEDIA),
    } for e, st in states.items()), key=lambda s: s["name"].lower())
    return web.json_response(body)


async def test_speaker(request):
    """Play a chime on a speaker the way a show would; if it works, add it to the editor's list."""
    entity = _media_player((await request.json()).get("entity_id"))
    ha = request.app[HA]
    if not ha.available:
        raise web.HTTPServiceUnavailable(text="Home Assistant isn't reachable from the add-on")
    try:
        st = await ha.state(entity)
    except HAError as e:
        return web.json_response({"ok": False, "error": f"couldn't read {entity}: {e}"})
    features = int(st.get("attributes", {}).get("supported_features") or 0)
    if not features & PLAY_MEDIA:
        return web.json_response({"ok": False, "error": "this media player can't be sent a song to play"})
    try:
        took = await request.app[RUNNER].test_speaker(entity)
    except RunnerError as e:
        return web.json_response({"ok": False, "error": str(e)})
    storage = request.app[STORAGE]
    settings = storage.load_settings()
    added = settings.setdefault("speakers", [])
    if entity not in added:
        added.append(entity)
    storage.save_settings(settings)
    return web.json_response({"ok": True, "start_s": round(took, 2)})


async def remove_speaker(request):
    entity = _media_player((await request.json()).get("entity_id"))
    storage = request.app[STORAGE]
    settings = storage.load_settings()
    settings["speakers"] = [e for e in settings.get("speakers", []) if e != entity]
    storage.save_settings(settings)
    return web.json_response({"ok": True})


async def put_show_speaker(request):
    """The speaker shows play on when started from an automation and the show doesn't pick one."""
    body = await request.json()
    entity = body.get("entity_id") or None
    if entity is not None:
        entity = _media_player(entity)
    storage = request.app[STORAGE]
    settings = storage.load_settings()
    settings["show_speaker"] = entity
    storage.save_settings(settings)
    return web.json_response({"show_speaker": entity})


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


# effect presets -------------------------------------------------------------
# Built-in presets ship in effects.js; only the user's own are stored here. Each is a named set of
# settings for one effect, so values are short strings, numbers or booleans.
_EFFECT_KEY = re.compile(r"^[a-z0-9_]{1,32}$")
MAX_PRESETS = 200


def _clean_preset(p):
    if not isinstance(p, dict):
        return None
    name = str(p.get("name", "")).strip()[:60]
    effect = p.get("effect")
    params = p.get("params")
    if not name or not isinstance(effect, str) or not _EFFECT_KEY.match(effect) \
            or not isinstance(params, dict) or len(params) > 40:
        return None
    clean = {}
    for k, v in params.items():
        if not isinstance(k, str) or not _EFFECT_KEY.match(k):
            return None
        if isinstance(v, str):
            v = v[:200]
        elif not isinstance(v, (bool, int, float)) or (isinstance(v, float) and not math.isfinite(v)):
            return None
        clean[k] = v
    return {"name": name, "effect": effect, "params": clean}


async def get_presets(request):
    return web.json_response(request.app[STORAGE].load_settings().get("presets", []))


async def put_presets(request):
    body = await request.json()
    if not isinstance(body, list) or len(body) > MAX_PRESETS:
        raise web.HTTPBadRequest(text=f"expected a list of up to {MAX_PRESETS} presets")
    presets = [_clean_preset(p) for p in body]
    if not all(presets):
        raise web.HTTPBadRequest(text="each preset needs a name, an effect and its settings")
    storage = request.app[STORAGE]
    settings = storage.load_settings()
    settings["presets"] = presets
    storage.save_settings(settings)
    return web.json_response(presets)


# house view --------------------------------------------------------------
MAX_PHOTO = 20 * 1024 * 1024
MAX_POINTS = 200


async def get_house(request):
    return web.json_response({**_house(request.app[STORAGE].load_settings()),
                              "photo": request.app[STORAGE].house_photo() is not None})


def _house(settings: dict) -> dict:
    house = settings.get("house", {})
    return {"paths": house.get("paths", {}), "styles": house.get("styles", {}), "pins": house.get("pins", {}),
            "dim": house.get("dim", 0.5)}


def _clean_style(style) -> dict | None:
    """How a light looks on the house photo. {"style": "icicle", "drops": n, "length": l} draws n
    drops hanging from its line, the longest l of the photo's height. {"style": "spots", "beam": b,
    "aims": [[dx, dy], ...]} draws each point as a spotlight shining dx across and dy down the
    photo, its beam b wide for its length. Plain lines need nothing."""
    if not isinstance(style, dict):
        return None
    try:
        if style.get("style") == "icicle":
            drops = min(max(int(style.get("drops", 40)), 1), MAX_BULBS)
            length = round(min(max(float(style.get("length", 0.06)), 0.01), 0.5), 4)
            return {"style": "icicle", "drops": drops, "length": length}
        if style.get("style") == "spots":
            beam = round(min(max(float(style.get("beam", 0.5)), 0.1), 1.5), 3)
            aims = style.get("aims") or []
            if not isinstance(aims, list) or len(aims) > MAX_POINTS:
                raise ValueError
            aims = [[round(min(max(float(a[0]), -1), 1), 4), round(min(max(float(a[1]), -1), 1), 4)]
                    for a in aims]
            return {"style": "spots", "beam": beam, "aims": aims}
    except (TypeError, ValueError, IndexError):
        raise web.HTTPBadRequest(text="a light's style settings must be numbers")
    return None


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
        pts = []
        for i, point in enumerate(points):
            # [x, y], or [x, y, n] when the stretch from the previous point is out of view
            # (round the back of the house, or an extension lead) and holds n bulbs.
            try:
                if not isinstance(point, list) or len(point) not in (2, 3):
                    raise ValueError
                x, y = round(float(point[0]), 5), round(float(point[1]), 5)
                hidden = int(point[2]) if len(point) == 3 and i else None
            except (TypeError, ValueError):
                raise web.HTTPBadRequest(text="points are [x, y] or [x, y, hidden bulbs]")
            if not (0 <= x <= 1 and 0 <= y <= 1):
                raise web.HTTPBadRequest(text="points must be between 0 and 1")
            if hidden is not None and not 0 <= hidden <= MAX_BULBS:
                raise web.HTTPBadRequest(text=f"a hidden stretch has 0 to {MAX_BULBS} bulbs")
            pts.append([x, y] if hidden is None else [x, y, hidden])
        if pts:
            clean[str(dev_id)[:64]] = pts
    styles = body.get("styles") or {}
    if not isinstance(styles, dict) or len(styles) > 100:
        raise web.HTTPBadRequest(text="expected styles for up to 100 lights")
    styles = {str(k)[:64]: v for k, v in ((k, _clean_style(v)) for k, v in styles.items()) if v}
    # Pins: {light: {segment: how far along its path, 0 to 1}}, where a photo taken at an angle needs
    # a segment's bulbs somewhere other than evenly spread.
    pins = body.get("pins") or {}
    if not isinstance(pins, dict) or len(pins) > 100:
        raise web.HTTPBadRequest(text="expected pins for up to 100 lights")
    clean_pins = {}
    for dev_id, marks in pins.items():
        if not isinstance(marks, dict) or len(marks) > MAX_POINTS:
            raise web.HTTPBadRequest(text=f"a light has up to {MAX_POINTS} pins")
        try:
            got = {str(int(s)): round(min(max(float(t), 0), 1), 5) for s, t in marks.items()}
        except (TypeError, ValueError):
            raise web.HTTPBadRequest(text="pins are a segment and a number from 0 to 1")
        if any(int(s) < 0 for s in got):
            raise web.HTTPBadRequest(text="pins are a segment and a number from 0 to 1")
        if got and str(dev_id)[:64] in clean:
            clean_pins[str(dev_id)[:64]] = got
    try:
        dim = min(max(float(body.get("dim", 0.5)), 0), 0.9)
    except (TypeError, ValueError):
        raise web.HTTPBadRequest(text="dim must be a number")
    storage = request.app[STORAGE]
    settings = storage.load_settings()
    settings["house"] = {"paths": clean, "styles": styles, "pins": clean_pins, "dim": dim}
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
# AI ---------------------------------------------------------------------------
async def ai_status(request):
    return web.json_response(await ai.status(request.app[HA]))


async def ai_clips(request):
    """Clips for a request in words. The editor sends the show's context and checks the result."""
    return await _ai_request(request, ai.create_clips)


async def ai_presets(request):
    """Effect presets for a description in words. The editor sends the effects and checks the result."""
    return await _ai_request(request, ai.create_presets)


async def _ai_request(request, create):
    try:
        body = await request.json()
    except ValueError:
        raise web.HTTPBadRequest(text="expected JSON")
    if not isinstance(body, dict) or not isinstance(body.get("context"), dict):
        raise web.HTTPBadRequest(text="expected a request and its context")
    try:
        return web.json_response(await create(request.app[HA], str(body.get("request", "")), body["context"]))
    except ai.AIError as e:
        raise web.HTTPBadRequest(text=str(e)[:1].upper() + str(e)[1:])


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
    try:
        migrate.import_old(config_dir, media_dir)
    except OSError as e:
        logging.getLogger(__name__).error("couldn't import from the old add-on: %s", e)
    app[STORAGE] = Storage(config_dir, media_dir)
    try:
        migrate.fill_device_kinds(app[STORAGE])
    except OSError as e:
        logging.getLogger(__name__).error("couldn't mark saved lights as Govee: %s", e)
    app[TESTS] = {}
    app[PREVIEWS] = {}
    app[LISTENING] = {"listener": None, "options": {}}
    app[LAB] = Lab()

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
    r.add_post("/api/wled/info", wled_info)
    r.add_post("/api/devices/test", test_device)
    r.add_post("/api/devices/probe", probe_device)
    r.add_post("/api/devices/preview", preview_device)
    r.add_post("/api/diagnostics/listen", start_listening)
    r.add_get("/api/diagnostics/listen", listening_status)
    r.add_post("/api/lab/send", lab_send)
    r.add_post("/api/lab/stop", lab_stop)
    r.add_post("/api/lab/speed", lab_speed)
    r.add_get("/api/lab", lab_status)
    r.add_get("/api/shows", list_shows)
    r.add_post("/api/shows", create_show)
    r.add_get("/api/shows/{id}", get_show)
    r.add_put("/api/shows/{id}", put_show)
    r.add_delete("/api/shows/{id}", delete_show)
    r.add_put("/api/shows/{id}/baked", put_baked)
    r.add_get("/api/audio", list_audio)
    r.add_post("/api/audio", upload_audio)
    r.add_get("/api/audio/file", get_audio)
    r.add_get("/api/audio/info", get_song_info)
    r.add_put("/api/audio/info", put_song_info)
    r.add_get("/api/speakers", list_speakers)
    r.add_put("/api/speakers/delay", put_speaker_delay)
    r.add_put("/api/speakers/show", put_show_speaker)
    r.add_post("/api/speakers/test", test_speaker)
    r.add_post("/api/speakers/remove", remove_speaker)
    r.add_get("/api/palettes", get_palettes)
    r.add_get("/api/scenes", get_scenes)
    r.add_put("/api/palettes", put_palettes)
    r.add_get("/api/presets", get_presets)
    r.add_put("/api/presets", put_presets)
    r.add_get("/api/house", get_house)
    r.add_put("/api/house", put_house)
    r.add_get("/api/house/photo", get_house_photo)
    r.add_put("/api/house/photo", put_house_photo)
    r.add_delete("/api/house/photo", delete_house_photo)
    r.add_post("/api/command", run_command)
    r.add_get("/api/ai", ai_status)
    r.add_post("/api/ai/clips", ai_clips)
    r.add_post("/api/ai/presets", ai_presets)
    r.add_get("/api/player", player_status)
    r.add_post("/api/player/play", player_play)
    r.add_post("/api/player/sync", player_sync)
    r.add_post("/api/player/stop", player_stop)
    return app
