"""Devices, shows and settings live in the add-on config folder; songs in /media.

/config is the add-on's own folder (addon_config:rw), so it is included in Home
Assistant backups. Uploaded songs go to /media/govee_show so Home Assistant media
players can play them through the media source.
"""
import io
import json
import math
import os
import re
import struct
import wave
from pathlib import Path

PHOTO_EXT = {".jpg", ".jpeg", ".png", ".webp"}
SPEAKER_TEST = "govee-show-speaker-test.wav"  # the chime that tests a speaker; not listed as a song
AUDIO_EXT = {".mp3", ".m4a", ".aac", ".ogg", ".oga", ".opus", ".wav", ".flac", ".webm"}
_SLUG = re.compile(r"[^a-z0-9]+")
_UNSAFE_NAME = re.compile(r"[^\w .()-]+")


def slugify(name: str) -> str:
    return _SLUG.sub("-", name.lower()).strip("-")[:64] or "show"


def valid_id(show_id: str) -> bool:
    return bool(show_id) and slugify(show_id) == show_id


def _write_atomic(path: Path, data: bytes):
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_bytes(data)
    os.replace(tmp, path)


def _chime(seconds: float = 2.0, rate: int = 22050) -> bytes:
    """A soft two-note chime as a mono 16-bit WAV."""
    frames = bytearray()
    n = int(seconds * rate)
    for i in range(n):
        t = i / rate
        f = 660 if t < seconds / 2 else 880
        env = min(1, t * 50) * max(0, 1 - (t % (seconds / 2)) / (seconds / 2)) ** 2
        frames += struct.pack("<h", int(9000 * env * math.sin(2 * math.pi * f * t)))
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(bytes(frames))
    return buf.getvalue()


def safe_join(root: Path, rel: str) -> Path | None:
    """Resolve rel inside root, or None if it escapes."""
    p = (root / rel).resolve()
    try:
        p.relative_to(root.resolve())
    except ValueError:
        return None
    return p


class Storage:
    def __init__(self, config_dir: Path, media_dir: Path):
        self.config_dir = config_dir
        self.media_dir = media_dir
        self.shows_dir = config_dir / "shows"
        self.upload_dir = media_dir / "govee_show"
        self.devices_file = config_dir / "devices.json"
        self.settings_file = config_dir / "settings.json"
        self.shows_dir.mkdir(parents=True, exist_ok=True)

    # devices -------------------------------------------------------------
    def load_devices(self) -> list[dict]:
        try:
            return json.loads(self.devices_file.read_text())
        except (FileNotFoundError, ValueError):
            return []

    def save_devices(self, devices: list[dict]):
        _write_atomic(self.devices_file, json.dumps(devices, indent=2).encode())

    def devices_by_id(self) -> dict[str, dict]:
        return {d["id"]: d for d in self.load_devices()}

    # settings ------------------------------------------------------------
    def load_settings(self) -> dict:
        try:
            settings = json.loads(self.settings_file.read_text())
        except (FileNotFoundError, ValueError):
            settings = {}
        settings.setdefault("speaker_delays", {})  # media_player entity -> ms
        return settings

    def save_settings(self, settings: dict):
        _write_atomic(self.settings_file, json.dumps(settings, indent=2).encode())

    # house photo ---------------------------------------------------------
    # One photo of the house for the editor's House view; where each light runs on it is a
    # setting. Kept in the config folder so it is backed up with everything else.
    def house_photo(self) -> Path | None:
        for ext in PHOTO_EXT:
            p = self.config_dir / f"house{ext}"
            if p.exists():
                return p
        return None

    def save_house_photo(self, data: bytes, ext: str):
        self.delete_house_photo()
        _write_atomic(self.config_dir / f"house{ext}", data)

    def delete_house_photo(self):
        while (p := self.house_photo()):
            p.unlink()

    # shows ---------------------------------------------------------------
    def list_shows(self) -> list[dict]:
        out = []
        for p in sorted(self.shows_dir.glob("*.json")):
            try:
                show = json.loads(p.read_text())
            except ValueError:
                continue
            out.append({"id": p.stem, "name": show.get("name", p.stem),
                        "duration": show.get("duration", 0),
                        "baked": (self.shows_dir / f"{p.stem}.gshow").exists(),
                        "modified": int(p.stat().st_mtime)})
        return out

    def load_show(self, show_id: str) -> dict | None:
        try:
            return json.loads((self.shows_dir / f"{show_id}.json").read_text())
        except (FileNotFoundError, ValueError):
            return None

    def save_show(self, show_id: str, show: dict):
        _write_atomic(self.shows_dir / f"{show_id}.json", json.dumps(show, indent=1).encode())
        # The bake is stale until the editor uploads a new one.
        (self.shows_dir / f"{show_id}.gshow").unlink(missing_ok=True)

    def save_baked(self, show_id: str, blob: bytes):
        _write_atomic(self.shows_dir / f"{show_id}.gshow", blob)

    def load_baked(self, show_id: str) -> bytes | None:
        try:
            return (self.shows_dir / f"{show_id}.gshow").read_bytes()
        except FileNotFoundError:
            return None

    def delete_show(self, show_id: str):
        for ext in ("json", "gshow"):
            (self.shows_dir / f"{show_id}.{ext}").unlink(missing_ok=True)

    # audio ---------------------------------------------------------------
    def audio_roots(self) -> dict[str, Path]:
        return {"media": self.media_dir}

    def list_audio(self, limit: int = 2000) -> list[dict]:
        out = []
        for source, root in self.audio_roots().items():
            if not root.is_dir():
                continue
            for dirpath, dirnames, filenames in os.walk(root):
                dirnames[:] = sorted(d for d in dirnames if not d.startswith("."))
                for f in sorted(filenames):
                    if Path(f).suffix.lower() in AUDIO_EXT and f != SPEAKER_TEST:
                        rel = os.path.relpath(os.path.join(dirpath, f), root)
                        out.append({"source": source, "path": rel})
                        if len(out) >= limit:
                            return out
        return out

    def speaker_test_path(self) -> str:
        """Writes the test chime into the uploads folder if needed; returns its path under /media."""
        dest = self.upload_dir / SPEAKER_TEST
        if not dest.exists():
            self.upload_dir.mkdir(parents=True, exist_ok=True)
            _write_atomic(dest, _chime())
        return str(dest.relative_to(self.media_dir))

    def audio_path(self, source: str, rel: str) -> Path | None:
        root = self.audio_roots().get(source)
        if root is None or Path(rel).suffix.lower() not in AUDIO_EXT:
            return None
        p = safe_join(root, rel)
        return p if p and p.is_file() else None

    def upload_path(self, filename: str) -> Path | None:
        name = _UNSAFE_NAME.sub("_", Path(filename).name).strip(" .")
        if not name or Path(name).suffix.lower() not in AUDIO_EXT:
            return None
        self.upload_dir.mkdir(parents=True, exist_ok=True)
        return self.upload_dir / name
