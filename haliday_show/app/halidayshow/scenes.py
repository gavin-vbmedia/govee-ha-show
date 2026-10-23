"""Experimental: the built-in scenes for a Govee model, from Govee's public scene library.

This is the list the Govee app shows under Scenes. It is not an official API, so it can change
or disappear; results are cached for a week so a show keeps working offline.
"""
import json
import logging
import re
import time
from pathlib import Path

import aiohttp

log = logging.getLogger(__name__)

LIBRARY_URL = "https://app2.govee.com/appsku/v1/light-effect-libraries?sku={sku}"
# The library only answers requests that look like the Govee app (as govee2mqtt does).
HEADERS = {"AppVersion": "6.5.02",
           "User-Agent": "GoveeHome/6.5.02 (com.ihoment.GoVeeSensor; build:2; iOS 16.5.0) Alamofire/5.6.4"}
CACHE_S = 7 * 86400
SKU_RE = re.compile(r"^[A-Z0-9]{3,12}$")


class SceneError(Exception):
    pass


def parse(library: dict) -> list[dict]:
    """Flatten Govee's categories -> scenes -> light effects into one list."""
    out = []
    for cat in (library.get("data") or {}).get("categories") or []:
        for scene in cat.get("scenes") or []:
            effects = [e for e in scene.get("lightEffects") or [] if e.get("sceneCode")]
            for e in effects:
                name = scene.get("sceneName", "")
                if len(effects) > 1 and e.get("scenceName"):
                    name = f"{name} ({e['scenceName']})"
                out.append({"category": cat.get("categoryName", ""), "name": name,
                            "code": int(e["sceneCode"]), "param": e.get("scenceParam") or ""})
    return out


async def scenes_for(sku: str, cache_dir: Path) -> list[dict]:
    sku = sku.strip().upper()
    if not SKU_RE.match(sku):
        raise SceneError("unknown model")
    cache = cache_dir / f"{sku}.json"
    if cache.exists() and time.time() - cache.stat().st_mtime < CACHE_S:
        return json.loads(cache.read_text())
    try:
        async with aiohttp.ClientSession(headers=HEADERS, timeout=aiohttp.ClientTimeout(total=10)) as s:
            async with s.get(LIBRARY_URL.format(sku=sku)) as resp:
                resp.raise_for_status()
                scenes = parse(await resp.json(content_type=None))
    except (aiohttp.ClientError, TimeoutError, ValueError) as e:
        if cache.exists():  # stale beats nothing
            return json.loads(cache.read_text())
        raise SceneError(f"couldn't reach Govee's scene library: {e}") from e
    cache_dir.mkdir(parents=True, exist_ok=True)
    cache.write_text(json.dumps(scenes))
    log.info("Loaded %d Govee scenes for %s", len(scenes), sku)
    return scenes
