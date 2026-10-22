"""Regenerate the editor's Govee model list from the SignalRGB Govee plugin's product data.

That file (MIT, github.com/fu-raz/signalrgb-govee-direct-connect) is a snapshot of
Govee's product list, including whether each model supports the realtime ("razer")
protocol this add-on uses. Govee doesn't publish realtime segment counts, so
"segments" is only filled in where we know it.

  python tools/build_models.py > govee_show/app/goveeshow/static/models.json
"""
import json
import re
import sys
import urllib.request

SOURCE = ("https://raw.githubusercontent.com/fu-raz/signalrgb-govee-direct-connect/"
          "main/govee-products.test.js")

# Realtime segment counts confirmed by other projects.
KNOWN_SEGMENTS = {
    "H618A": 15,  # DMXCore Govee plugin
    "H70C5": 44,  # tested on a real light (issue #74)
}

# Realtime confirmed on real lights where Govee's product list says otherwise.
KNOWN_REALTIME = {
    "H706A", "H706B", "H706C",  # Permanent Outdoor Lights Pro: the owner's, and signalrgb-govee
}

# What testing on real lights found that the product list doesn't say, shown on the Devices tab.
KNOWN_NOTES = {
    "H70C5": "In realtime mode it only lights its first 44 bulbs. For every bulb, set Protocol to Per bulb "
             "(experimental) with 300 segments; App segments (10 segments) and Whole light only also light "
             "the whole string.",
}


def main():
    text = urllib.request.urlopen(SOURCE, timeout=60).read().decode()
    models = {}
    for block in re.finditer(r'"(H[0-9A-Z]{4,5})":\s*\{(.*?)\n  \}', text, re.S):
        body = block.group(2)
        name = re.search(r'"productName":\s*"([^"]*)"', body)
        razer = re.search(r'"supportRazer":\s*(\d)', body)
        if not name or not razer:
            continue
        sku = block.group(1)
        entry = {"sku": sku, "name": name.group(1).strip(), "realtime": razer.group(1) == "1" or sku in KNOWN_REALTIME}
        if sku in KNOWN_SEGMENTS:
            entry["segments"] = KNOWN_SEGMENTS[sku]
        if sku in KNOWN_NOTES:
            entry["note"] = KNOWN_NOTES[sku]
        models[sku] = entry
    if len(models) < 100:
        sys.exit(f"only parsed {len(models)} models; the source format may have changed")
    out = {"source": "github.com/fu-raz/signalrgb-govee-direct-connect (MIT)",
           "models": sorted(models.values(), key=lambda m: m["sku"])}
    json.dump(out, sys.stdout, indent=0, ensure_ascii=False)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
