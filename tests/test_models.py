import json
from pathlib import Path

MODELS = Path(__file__).parent.parent / "govee_show/app/goveeshow/static/models.json"


def test_model_list_is_well_formed():
    models = json.loads(MODELS.read_text())["models"]
    assert len(models) > 100
    skus = [m["sku"] for m in models]
    assert len(skus) == len(set(skus))
    by_sku = {m["sku"]: m for m in models}
    assert by_sku["H7093"]["realtime"] is True  # Outdoor Spotlights 2
    assert all(isinstance(m["realtime"], bool) and m["name"] for m in models)
    assert by_sku["H706A"]["realtime"] is True  # confirmed though Govee's list says otherwise
    assert by_sku["H70C5"]["segments"] == 44 and "Whole light only" in by_sku["H70C5"]["note"]
