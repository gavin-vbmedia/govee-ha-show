import json
import os

from halidayshow import migrate
from halidayshow.storage import Storage


def _old_addon(tmp_path):
    root = tmp_path / "addon_configs"
    old = root / "a1b2c3d4_govee_show"
    (old / "shows").mkdir(parents=True)
    (old / "songs").mkdir()
    (old / "devices.json").write_text(json.dumps([{"id": "pillars", "name": "Pillars"}]))
    (old / "settings.json").write_text(json.dumps({"speaker_delays": {"media_player.kitchen": 120}}))
    show = {"name": "Party", "audio": {"source": "media", "path": "govee_show/song.mp3"}}
    (old / "shows" / "party.json").write_text(json.dumps(show))
    (old / "shows" / "party.gshow").write_bytes(b"baked")
    (old / "house.jpg").write_bytes(b"jpg")
    os.utime(old / "shows" / "party.json", (1_700_000_000, 1_700_000_000))
    media = tmp_path / "media"
    (media / "govee_show").mkdir(parents=True)
    (media / "govee_show" / "song.mp3").write_bytes(b"mp3")
    return root, old, media


async def test_imports_everything_once(tmp_path):
    root, old, media = _old_addon(tmp_path)
    old_store = Storage(old, media)
    assert old_store.save_song_info("media", "govee_show/song.mp3", {"tempo": 120})
    cfg = tmp_path / "config"

    done = migrate.import_old(cfg, media, root)
    assert done["files"] == 6 and done["songs"] == 1

    store = Storage(cfg, media)
    assert store.load_devices()[0]["name"] == "Pillars"
    assert store.load_settings()["speaker_delays"] == {"media_player.kitchen": 120}
    show = store.load_show("party")
    assert show["audio"]["path"] == "haliday_show/song.mp3"
    assert (media / "haliday_show" / "song.mp3").read_bytes() == b"mp3"
    assert store.list_shows()[0]["modified"] == 1_700_000_000  # "last changed" survives
    assert store.house_photo() is not None
    assert store.load_song_info("media", "haliday_show/song.mp3") == {"tempo": 120}
    # The old add-on is left exactly as it was.
    assert json.loads((old / "shows" / "party.json").read_text())["audio"]["path"] == "govee_show/song.mp3"
    assert (media / "govee_show" / "song.mp3").exists()

    (cfg / "devices.json").write_text("[]")
    assert migrate.import_old(cfg, media, root) is None  # only ever once
    assert Storage(cfg, media).load_devices() == []


def test_leaves_an_already_set_up_addon_alone(tmp_path):
    root, _, media = _old_addon(tmp_path)
    cfg = tmp_path / "config"
    cfg.mkdir()
    (cfg / "devices.json").write_text("[]")
    assert migrate.import_old(cfg, media, root) is None
    assert not (cfg / "shows").exists()


def test_nothing_to_import(tmp_path):
    assert migrate.import_old(tmp_path / "config", tmp_path / "media", tmp_path / "missing") is None
    assert not (tmp_path / "config" / migrate.MARKER).exists()
