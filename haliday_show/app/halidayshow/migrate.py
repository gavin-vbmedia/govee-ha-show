"""One-time import from the add-on's old name (Govee Light Show, slug govee_show).

A new slug is a new add-on to Home Assistant, with its own empty config folder. On first
start we copy the old add-on's saved data across (read-only map all_addon_configs), copy its
uploaded songs to the new media folder, and point shows at the copied songs. Nothing old is
changed or deleted, so the old add-on still works until the owner removes it.
"""
import hashlib
import json
import logging
import os
import shutil
from pathlib import Path

log = logging.getLogger(__name__)

OLD_SLUG = "govee_show"
NEW_SLUG = "haliday_show"
MARKER = ".imported.json"
OLD_MQTT_CLEARED = ".old-mqtt-cleared"
ADDON_CONFIGS = Path(os.environ.get("HALIDAY_SHOW_ADDON_CONFIGS", "/addon_configs"))


def _has_data(config_dir: Path) -> bool:
    return (config_dir / "devices.json").exists() or any((config_dir / "shows").glob("*.json"))


def _find_old(root: Path) -> Path | None:
    try:
        found = sorted(p for p in root.glob(f"*_{OLD_SLUG}") if p.is_dir())
    except OSError:
        return None
    # The folder with the most recently changed shows wins if there are several.
    def newest(p: Path) -> float:
        return max((f.stat().st_mtime for f in p.rglob("*") if f.is_file()), default=0)
    return max(found, key=newest) if found else None


def _copy_missing(src: Path, dst: Path) -> int:
    n = 0
    for f in src.rglob("*"):
        rel = f.relative_to(src)
        target = dst / rel
        if f.is_dir():
            target.mkdir(parents=True, exist_ok=True)
        elif f.is_file() and not target.exists():
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(f, target)  # keeps times: shows' "modified" and song-info stamps rely on them
            n += 1
    return n


def _repoint(text: str) -> str:
    return text.replace(f'"{OLD_SLUG}/', f'"{NEW_SLUG}/')


def _song_key(source: str, rel: str) -> str:
    return hashlib.sha1(f"{source}:{rel}".encode()).hexdigest()[:20]  # matches Storage


def _repoint_json(config_dir: Path):
    songs = config_dir / "songs"
    for f in config_dir.rglob("*.json"):
        if f.parent == songs or f.name == MARKER:
            continue
        text = f.read_text()
        new = _repoint(text)
        if new != text:
            st = f.stat()
            f.write_text(new)
            os.utime(f, ns=(st.st_atime_ns, st.st_mtime_ns))
    # Song info is filed under a hash of the song's path, so it moves to the new path's name.
    for f in list(songs.glob("*.json")) if songs.is_dir() else []:
        try:
            body = json.loads(f.read_text())
        except ValueError:
            continue
        path = body.get("path", "")
        if body.get("source") == "media" and path.startswith(f"{OLD_SLUG}/"):
            body["path"] = NEW_SLUG + path[len(OLD_SLUG):]
            dest = songs / f"{_song_key('media', body['path'])}.json"
            if not dest.exists():
                dest.write_text(json.dumps(body))
            f.unlink()


def import_old(config_dir: Path, media_dir: Path, configs_root: Path = ADDON_CONFIGS) -> dict | None:
    """Copy the old add-on's data in once. Returns what was done, or None if nothing to do."""
    marker = config_dir / MARKER
    if marker.exists():
        return None
    old = _find_old(configs_root)
    if old is None:
        return None
    config_dir.mkdir(parents=True, exist_ok=True)
    if _has_data(config_dir):
        # Already set up under the new name; don't mix in older data.
        marker.write_text(json.dumps({"from": str(old), "skipped": "already set up"}))
        return None
    files = _copy_missing(old, config_dir)
    songs = 0
    old_media, new_media = media_dir / OLD_SLUG, media_dir / NEW_SLUG
    if old_media.is_dir():
        songs = _copy_missing(old_media, new_media)
    _repoint_json(config_dir)
    done = {"from": str(old), "files": files, "songs": songs}
    marker.write_text(json.dumps(done))
    log.info("imported %d files and %d songs from %s", files, songs, old)
    return done


def imported(config_dir: Path) -> dict | None:
    try:
        return json.loads((config_dir / MARKER).read_text())
    except (OSError, ValueError):
        return None


def fill_device_kinds(storage) -> int:
    """Saved lights from before WLED support have no kind. Mark them Govee, which they are, so every
    saved light says what it is. Only the missing field is added; nothing else in the file changes."""
    devices = storage.load_devices()
    missing = [d for d in devices if isinstance(d, dict) and not d.get("kind")]
    for d in missing:
        d["kind"] = "govee"
    if missing:
        storage.save_devices(devices)
        log.info("marked %d saved light(s) as Govee", len(missing))
    return len(missing)
