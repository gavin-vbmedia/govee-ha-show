import json
from pathlib import Path

MODELS = Path(__file__).parent.parent / "govee_show/app/goveeshow/static/models.json"
PROTOCOLS = {"standard", "razer", "v2", "whole", "segments", "pixels"}


def test_model_list_is_well_formed():
    models = json.loads(MODELS.read_text())["models"]
    assert len(models) > 100
    skus = [m["sku"] for m in models]
    assert len(skus) == len(set(skus))
    for m in models:
        assert m["name"] and set(m) <= {"sku", "name", "status", "protocol", "segments", "bulbs", "reach", "note", "lan"}
        assert m.get("lan", True) is True  # only ever marks models on Govee's list
        assert m.get("status", "works") in {"works", "limited"}
        assert m.get("protocol", "standard") in PROTOCOLS
        assert m.get("segments", 1) <= (1000 if m.get("protocol") in {"whole", "segments", "pixels"} else 255)
    by_sku = {m["sku"]: m for m in models}
    assert "status" not in by_sku["H7093"]  # Govee's list says realtime; untested here
    assert by_sku["H706A"]["status"] == "works"  # Govee's list says otherwise
    h70c5 = by_sku["H70C5"]
    assert (h70c5["protocol"], h70c5["segments"], h70c5["reach"]) == ("pixels", 300, 44)
    assert not any("Thermo" in m["name"] or "Purifier" in m["name"] for m in models)
    # Every model tested on real lights is on Govee's list of lights with LAN control, and so are newer
    # ones the first list lacked (R models included).
    assert all(m.get("lan") for m in models if m.get("status"))
    assert by_sku["H3A51"]["lan"] and by_sku["R1310"]["lan"] and "status" not in by_sku["H80C5"]


def test_build_models_only_adds_and_marks_models_govee_lists():
    import importlib.util
    spec = importlib.util.spec_from_file_location("build_models", Path(__file__).parent.parent / "tools/build_models.py")
    build = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(build)
    doc = {"models": [{"sku": "H70C5", "name": "Ours", "status": "limited", "segments": 300},
                      {"sku": "H6199", "name": "DreamView T1"}]}
    added = build.update(doc, {"H70C5": "Govee's name", "H3A51": "Permanent Outdoor Lights 2 Pro"})
    assert added == ["H3A51"]
    by = {m["sku"]: m for m in doc["models"]}
    assert by["H70C5"] == {"sku": "H70C5", "name": "Ours", "status": "limited", "segments": 300, "lan": True}
    assert by["H6199"] == {"sku": "H6199", "name": "DreamView T1"}  # not listed: left as it is
    assert by["H3A51"] == {"sku": "H3A51", "name": "Permanent Outdoor Lights 2 Pro", "lan": True}
