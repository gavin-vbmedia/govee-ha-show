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
        assert m["name"] and set(m) <= {"sku", "name", "status", "protocol", "segments", "bulbs", "reach", "note"}
        assert m.get("status", "works") in {"works", "limited"}
        assert m.get("protocol", "standard") in PROTOCOLS
        assert m.get("segments", 1) <= (1000 if m.get("protocol") in {"whole", "segments", "pixels"} else 255)
    by_sku = {m["sku"]: m for m in models}
    assert "status" not in by_sku["H7093"]  # Govee's list says realtime; untested here
    assert by_sku["H706A"]["status"] == "works"  # Govee's list says otherwise
    h70c5 = by_sku["H70C5"]
    assert (h70c5["protocol"], h70c5["segments"], h70c5["reach"]) == ("pixels", 300, 44)
    assert not any("Thermo" in m["name"] or "Purifier" in m["name"] for m in models)
