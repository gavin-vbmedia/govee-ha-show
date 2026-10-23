import io
import json
import zipfile

import pytest

from halidayshow import backup


def _fill(config):
    (config / "shows").mkdir(parents=True)
    (config / "songs").mkdir()
    (config / "devices.json").write_text(json.dumps([{"id": "roof", "name": "Roof"}]))
    (config / "settings.json").write_text(json.dumps({"palettes": [{"name": "Mine"}]}))
    (config / "house.jpg").write_bytes(b"\xff\xd8photo")
    (config / "shows" / "carol.json").write_text(json.dumps({"name": "Carol"}))
    (config / "shows" / "carol.gshow").write_bytes(b"baked")
    (config / "songs" / ("a" * 20 + ".json")).write_text("{}")
    (config / ".imported.json").write_text("{}")  # the old-name import marker


def _zip(files: dict, manifest=True) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        if manifest:
            z.writestr(backup.MANIFEST, json.dumps({"app": backup.APP}))
        for k, v in files.items():
            z.writestr(k, v)
    return buf.getvalue()


def test_export_then_restore_gives_everything_back(tmp_path):
    config = tmp_path / "config"
    _fill(config)
    data = backup.export(config, "1.0")
    names = set(zipfile.ZipFile(io.BytesIO(data)).namelist())
    assert names == {backup.MANIFEST, "devices.json", "settings.json", "house.jpg", "shows/carol.json",
                     "shows/carol.gshow", f"songs/{'a' * 20}.json"}
    backup.clear(config)
    assert not backup.has_data(config)
    assert (config / ".imported.json").exists(), "the import marker must survive a fresh start"
    assert backup.restore(config, data) == 6
    assert json.loads((config / "devices.json").read_text())[0]["name"] == "Roof"
    assert (config / "shows" / "carol.gshow").read_bytes() == b"baked"
    assert (config / "house.jpg").read_bytes() == b"\xff\xd8photo"


def test_restore_replaces_rather_than_merges(tmp_path):
    config = tmp_path / "config"
    _fill(config)
    backup.restore(config, _zip({"devices.json": "[]"}))
    assert not (config / "shows" / "carol.json").exists()
    assert not (config / "house.jpg").exists()
    assert (config / "devices.json").read_text() == "[]"


@pytest.mark.parametrize("data,why", [
    (b"not a zip", "isn't a .zip"),
    (_zip({"devices.json": "[]"}, manifest=False), "isn't an HA-liday Show export"),
    (_zip({"../escape.json": "{}"}), "doesn't use"),
    (_zip({"shows/../../x.json": "{}"}), "doesn't use"),
    (_zip({"options.json": "{}"}), "doesn't use"),
    (_zip({"devices.json": "{broken"}), "damaged"),
])
def test_bad_exports_are_refused_and_nothing_changes(tmp_path, data, why):
    config = tmp_path / "config"
    _fill(config)
    with pytest.raises(backup.BackupError, match=why):
        backup.restore(config, data)
    assert (config / "shows" / "carol.json").exists()


def test_automatic_copies_keep_the_newest_few(tmp_path):
    config = tmp_path / "config"
    _fill(config)
    names = [backup.keep_copy(config, "1.0", "import") for _ in range(backup.KEEP_COPIES + 2)]
    left = backup.copies(config)
    assert len(left) == backup.KEEP_COPIES
    assert names[-1] in [c["name"] for c in left]
    assert backup.copy_path(config, names[-1]) is not None
    assert backup.copy_path(config, "../devices.json") is None
    # The copies aren't part of an export.
    names_in = zipfile.ZipFile(io.BytesIO(backup.export(config, "1.0"))).namelist()
    assert not any(n.startswith("backups/") for n in names_in)
    backup.clear(config)
    assert backup.keep_copy(config, "1.0", "fresh-start") is None
