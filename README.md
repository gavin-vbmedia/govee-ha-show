# Govee HA Show

A Govee light-show sequencer packaged as a Home Assistant add-on. Think of it as a
simple alternative to xLights built specifically for Govee lights.

Create, preview, save and play music-synchronised light shows from a browser-based
editor inside Home Assistant, with no external sequencing software or separate hosting.

## Features

- Discover Govee devices on the local network and check each one's segments with a test pattern
- Timeline editor with the song's waveform, one track per device, beat markers and snapping
- Draggable effects (solid, fade, chase, rainbow, strobe, twinkle, wipe) with a live,
  segment-level preview
- Save and load shows; each show is baked into precomputed frames for reliable playback
- Play from the browser: the song plays there and the add-on streams the lights in sync

See [the add-on docs](govee_show/DOCS.md) for how to use it.

**Planned**

- Audio playback through Home Assistant media players
- Shows exposed to Home Assistant automations for scheduled or triggered playback

## Installation

1. In Home Assistant, go to **Settings → Add-ons → Add-on Store**.
2. Open the ⋮ menu, choose **Repositories** and add
   `https://github.com/gavin-vbmedia/govee-ha-show`.
3. Install **Govee Light Show** and start it.

While this repository is private, Home Assistant can't fetch it; install it as a
local add-on instead by copying the `govee_show` folder into `/addons` on your
Home Assistant host.

## How it works

One Python service (aiohttp) serves the editor through Home Assistant ingress and plays shows.
Effects are written once, in JavaScript: the editor uses them for the live preview and, on save,
renders every frame of the show into a compact baked file. The player only streams those frames to
each device over Govee's undocumented per-segment "razer" LAN protocol, with rate limiting,
keepalive and periodic re-enable, following the browser's audio position.

## Repository layout

```
repository.yaml                         Home Assistant add-on repository metadata
govee_show/                             The add-on (config, Dockerfile, app code)
  app/goveeshow/protocol.py             Govee LAN and razer packet encoding
  app/goveeshow/discovery.py            Multicast device scan
  app/goveeshow/output.py               Per-device streaming, keepalive, test pattern
  app/goveeshow/baked.py                Baked show file format
  app/goveeshow/player.py               Plays baked frames in sync with the browser
  app/goveeshow/server.py               HTTP API for the editor
  app/goveeshow/static/                 The editor (no build step)
tests/                                  pytest and node tests
```

## Development

```
pip install -r govee_show/requirements.txt pytest pytest-aiohttp
python -m pytest
node --test tests/js/*.mjs

# Run the service locally (requests from this machine are allowed without ingress)
cd govee_show/app
GOVEE_SHOW_CONFIG=/tmp/gs/config GOVEE_SHOW_MEDIA=/tmp/gs/media python -m goveeshow
# then open http://localhost:8099/
```

To try it in Home Assistant, copy the `govee_show` folder into `/addons` (Samba or SSH add-on), then
reload the Add-on Store; it appears under Local add-ons and builds on your machine.

When releasing, bump the version in `pyproject.toml`, `govee_show/config.yaml` and
`govee_show/app/goveeshow/__init__.py` together (CI checks they match).

## Licence

MIT, see [LICENSE](LICENSE).
