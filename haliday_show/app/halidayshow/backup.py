"""Export, import and start afresh: everything the add-on saves, as one .zip.

The zip holds the config folder's own files (lights, shows and their bakes, settings with palettes,
presets and the house lines, the house photo, and what Detect found in each song). Songs stay in the
media folder and aren't included. Hidden files (the old-name import markers) are never exported,
cleared or replaced. Before an import or a fresh start, what's there is kept as an automatic copy
in backups/, so either can be undone.
"""
import io
import json
import re
import shutil
import tempfile
import time
import zipfile
from pathlib import Path

from .storage import PHOTO_EXT, valid_id

MANIFEST = "haliday-show-backup.json"
APP = "HA-liday Show"
COPIES = "backups"
KEEP_COPIES = 5
MAX_ENTRIES = 5000
MAX_UNPACKED = 1024 * 1024 * 1024  # a show's bake can be tens of MB; this stops a zip bomb

_COPY_NAME = re.compile(r"^before-(import|fresh-start)-(\d{8}-\d{6})(?:-(\d+))?\.zip$")
_SONG_INFO = re.compile(r"^[0-9a-f]{20}\.json$")


class BackupError(Exception):
    pass


def _allowed(name: str) -> bool:
    """Whether `name` (a path inside the zip, or under the config folder) is one of the add-on's files."""
    parts = name.split("/")
    if len(parts) == 1:
        p = Path(name)
        return name in ("devices.json", "settings.json") or (p.stem == "house" and p.suffix in PHOTO_EXT)
    if len(parts) == 2 and parts[0] == "shows":
        p = Path(parts[1])
        return p.suffix in (".json", ".gshow") and valid_id(p.stem)
    if len(parts) == 2 and parts[0] == "songs":
        return bool(_SONG_INFO.match(parts[1]))
    return False


def _files(config_dir: Path) -> list[str]:
    out = []
    for p in sorted(config_dir.rglob("*")):
        if p.is_file():
            rel = p.relative_to(config_dir).as_posix()
            if _allowed(rel):
                out.append(rel)
    return out


def has_data(config_dir: Path) -> bool:
    return bool(_files(config_dir))


def export(config_dir: Path, version: str) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr(MANIFEST, json.dumps({"app": APP, "version": version,
                                         "made": time.strftime("%Y-%m-%dT%H:%M:%S%z")}, indent=1))
        for rel in _files(config_dir):
            z.write(config_dir / rel, rel)
    return buf.getvalue()


def check(data: bytes) -> tuple[zipfile.ZipFile, list[zipfile.ZipInfo]]:
    """The zip and its entries to restore, or BackupError saying what's wrong with it."""
    try:
        z = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile:
        raise BackupError("that isn't an HA-liday Show export (it isn't a .zip file)")
    names = z.namelist()
    if MANIFEST not in names:
        raise BackupError("that .zip isn't an HA-liday Show export")
    try:
        manifest = json.loads(z.read(MANIFEST))
    except ValueError:
        raise BackupError("that export is damaged")
    if not isinstance(manifest, dict) or manifest.get("app") != APP:
        raise BackupError("that .zip isn't an HA-liday Show export")
    entries = [i for i in z.infolist() if not i.is_dir() and i.filename != MANIFEST]
    if len(entries) > MAX_ENTRIES:
        raise BackupError("that export has too many files")
    if sum(i.file_size for i in entries) > MAX_UNPACKED:
        raise BackupError("that export is too big")
    bad = [i.filename for i in entries if not _allowed(i.filename)]
    if bad:
        raise BackupError(f"that export holds a file HA-liday Show doesn't use ({bad[0]})")
    for i in entries:
        if i.filename.endswith(".json"):
            try:
                json.loads(z.read(i))
            except (ValueError, zipfile.BadZipFile):
                raise BackupError(f"that export is damaged ({i.filename})")
    return z, entries


def clear(config_dir: Path):
    for rel in _files(config_dir):
        (config_dir / rel).unlink(missing_ok=True)


def keep_copy(config_dir: Path, version: str, reason: str) -> str | None:
    """Saves what's there now under backups/, keeping the newest few. None when there's nothing."""
    if not has_data(config_dir):
        return None
    folder = config_dir / COPIES
    folder.mkdir(parents=True, exist_ok=True)
    stem = f"before-{reason}-{time.strftime('%Y%m%d-%H%M%S')}"
    # Several in the same second are numbered on from the highest, so the newest sorts first.
    taken = [c["seq"] for c in copies(config_dir) if c["name"].startswith(stem)]
    name = f"{stem}-{max(taken) + 1}.zip" if taken else f"{stem}.zip"
    tmp = folder / f".{name}.tmp"
    tmp.write_bytes(export(config_dir, version))
    tmp.replace(folder / name)
    for old in copies(config_dir)[KEEP_COPIES:]:
        (folder / old["name"]).unlink(missing_ok=True)
    return name


def copies(config_dir: Path) -> list[dict]:
    """The automatic copies, newest first: {name, reason, made (seconds), size}."""
    folder = config_dir / COPIES
    out = []
    if folder.is_dir():
        for p in folder.iterdir():
            m = _COPY_NAME.match(p.name)
            if m and p.is_file():
                st = p.stat()
                out.append({"name": p.name, "reason": m.group(1), "made": int(st.st_mtime), "size": st.st_size,
                            "seq": int(m.group(3) or 1), "_when": m.group(2)})
    out.sort(key=lambda c: (c["_when"], c["seq"]), reverse=True)
    for c in out:
        del c["_when"]
    return out


def copy_path(config_dir: Path, name: str) -> Path | None:
    p = config_dir / COPIES / name
    return p if _COPY_NAME.match(name) and p.is_file() else None


def restore(config_dir: Path, data: bytes) -> int:
    """Replaces the add-on's files with the export's. Returns how many files were restored."""
    z, entries = check(data)
    # Unpack beside the config folder first, so a failure part way leaves what was there.
    with tempfile.TemporaryDirectory(dir=config_dir, prefix=".restore-") as tmp:
        root = Path(tmp)
        for i in entries:
            dest = root / i.filename
            dest.parent.mkdir(parents=True, exist_ok=True)
            with z.open(i) as src, dest.open("wb") as out:
                shutil.copyfileobj(src, out)
        clear(config_dir)
        for i in entries:
            dest = config_dir / i.filename
            dest.parent.mkdir(parents=True, exist_ok=True)
            (root / i.filename).replace(dest)
    return len(entries)
