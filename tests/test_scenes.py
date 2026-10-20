import json

import pytest

from goveeshow import scenes

LIBRARY = {"data": {"categories": [{"categoryName": "Festival", "scenes": [
    {"sceneName": "Christmas", "lightEffects": [{"sceneCode": 1234, "scenceParam": "AQID", "scenceName": "A"},
                                                {"sceneCode": 1235, "scenceParam": "", "scenceName": "B"}]},
    {"sceneName": "Empty", "lightEffects": [{"sceneCode": 0}]},
]}]}}


def test_parse_flattens_variants_and_skips_unusable():
    assert scenes.parse(LIBRARY) == [
        {"category": "Festival", "name": "Christmas (A)", "code": 1234, "param": "AQID"},
        {"category": "Festival", "name": "Christmas (B)", "code": 1235, "param": ""},
    ]


async def test_cached_list_is_used_without_the_network(tmp_path):
    (tmp_path / "H70C5.json").write_text(json.dumps([{"name": "x", "code": 1, "param": "", "category": ""}]))
    assert (await scenes.scenes_for("h70c5", tmp_path))[0]["name"] == "x"


async def test_bad_model_is_rejected(tmp_path):
    with pytest.raises(scenes.SceneError):
        await scenes.scenes_for("../etc", tmp_path)
