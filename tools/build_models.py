"""Keep the editor's model list up to date with Govee's own list of lights that support LAN control.

static/models.json is our own list: what we've found on real lights (status, the default protocol,
segments, bulbs, reach, note), edited by hand. This only adds models it doesn't have yet, by name and
untested, and marks every model Govee lists with "lan": true. The list is the one behind Govee's LAN
guide (app-h5.govee.com/user-manual/wlan-guide). It isn't complete (some lights that work over LAN,
such as the DreamView T1, aren't on it), so a model missing from it is left as it is, never marked
unsupported.

  python tools/build_models.py
"""
import json
import re
import urllib.request
from pathlib import Path

SOURCE = "https://app2.govee.com/bff-app/v1/user/guide/device/info?market=US"
MODELS = Path(__file__).parent.parent / "govee_show/app/goveeshow/static/models.json"


def govee_models() -> dict[str, str]:
    reply = json.loads(urllib.request.urlopen(SOURCE, timeout=60).read())
    listed = {}
    for category in reply.get("data") or []:
        for node in category.get("categoryList") or []:
            sku, name = str(node.get("nodeSku", "")).strip().upper(), str(node.get("nodeName", "")).strip()
            if re.fullmatch(r"[HR][0-9A-Z]{4,5}", sku) and name:
                listed.setdefault(sku, name)
    return listed


def update(doc: dict, listed: dict[str, str]) -> list[str]:
    """Adds the listed models `doc` lacks and marks the listed ones; returns the SKUs added."""
    have = {m["sku"]: m for m in doc["models"]}
    added = []
    for sku, name in listed.items():
        if sku not in have:
            have[sku] = {"sku": sku, "name": name}
            added.append(sku)
        have[sku]["lan"] = True
    doc["models"] = sorted(have.values(), key=lambda m: m["sku"])
    return sorted(added)


def main():
    listed = govee_models()
    if len(listed) < 100:
        raise SystemExit(f"only {len(listed)} models in Govee's list; its format may have changed")
    doc = json.loads(MODELS.read_text())
    added = update(doc, listed)
    MODELS.write_text(json.dumps(doc, indent=0, ensure_ascii=False) + "\n")
    print(f"{len(listed)} listed by Govee; added {len(added)}: {', '.join(added) or 'none'}")


if __name__ == "__main__":
    main()
