"""Add newly released Govee lights' names to the editor's model list.

static/models.json is our own list: what we've found on real lights (status, the default protocol,
segments, bulbs, reach, note), edited by hand. This only adds models it doesn't have yet, by name,
untested, from the SignalRGB Govee plugin's copy of Govee's product list (MIT,
github.com/fu-raz/signalrgb-govee-direct-connect). That list's realtime flag proved out of date
(docs/govee-protocols.md), so it isn't used. Sensors, plugs and other things that aren't lights are left out.

  python tools/build_models.py
"""
import json
import re
import urllib.request
from pathlib import Path

SOURCE = ("https://raw.githubusercontent.com/fu-raz/signalrgb-govee-direct-connect/"
          "main/govee-products.test.js")
MODELS = Path(__file__).parent.parent / "govee_show/app/goveeshow/static/models.json"
NOT_LIGHTS = re.compile(r"Thermo|Hygrometer|Plug|Air Quality|Fan\b|Purifier|Heater|Humidifier|Ice Maker|Sync Box", re.I)


def main():
    doc = json.loads(MODELS.read_text())
    known = {m["sku"] for m in doc["models"]}
    text = urllib.request.urlopen(SOURCE, timeout=60).read().decode()
    added = []
    for block in re.finditer(r'"(H[0-9A-Z]{4,5})":\s*\{(.*?)\n  \}', text, re.S):
        name = re.search(r'"productName":\s*"([^"]*)"', block.group(2))
        sku = block.group(1)
        if name and sku not in known and not NOT_LIGHTS.search(name.group(1)):
            added.append({"sku": sku, "name": name.group(1).strip()})
            known.add(sku)
    doc["models"] = sorted(doc["models"] + added, key=lambda m: m["sku"])
    MODELS.write_text(json.dumps(doc, indent=0, ensure_ascii=False) + "\n")
    print(f"added {len(added)}: {', '.join(m['sku'] for m in added) or 'none'}")


if __name__ == "__main__":
    main()
