# Govee HA Show

A Govee light-show sequencer packaged as a Home Assistant add-on. Think of it as a
simple alternative to xLights built specifically for Govee lights.

Create, preview, save and play music-synchronised light shows from a browser-based
editor inside Home Assistant, with no external sequencing software or separate hosting.

## Features

- Discover Govee devices on the local network and check each one's segments with a test pattern
- Plan shows before your lights arrive: add planned lights by name and segment count, then link
  them to the real devices later
- Timeline editor with the song's waveform, one track per device, beat markers and snapping
- Select a stretch of time on one or more lights, then add effects there or clear it
- Play just a region of the show, and loop it while you design
- Arrange the editor your way: dock any panel to the top, left, right or bottom
- Effects (solid, two and three colours, pulse, gradient, colour cycle, fade, chase, rainbow, comet,
  scanner, flicker, lightning, strobe, twinkle, wipe) with a live,
  segment-level preview
- Colour palettes: presets for holidays and moods, plus your own, to recolour an effect, a light
  or the whole show in one click
- Copy and paste effects between lights (Ctrl+C / Ctrl+V), or copy a whole light's effects to
  one or every other light
- Save and load shows, with auto save; each show is baked into precomputed frames for reliable playback
- Play the song on any Home Assistant media player (with a per-speaker delay), or in the browser
- Schedule or trigger shows from automations: MQTT entities (show select, play/stop buttons,
  status), or the `hassio.addon_stdin` action

See [the add-on docs](govee_show/DOCS.md) for how to use it.

## Installation

1. In Home Assistant, go to **Settings → Add-ons → Add-on Store**.
2. Open the ⋮ menu, choose **Repositories** and add
   `https://github.com/gavin-vbmedia/govee-ha-show`.
3. Install **Govee Light Show**, turn on **Show in sidebar**, and start it.
4. Open **Light Shows** from the sidebar.

Home Assistant builds the add-on on your machine the first time, which takes a few minutes.
Requires Home Assistant OS or Supervised. For show entities in automations, also set up the
Mosquitto broker add-on and the MQTT integration (optional).

## How it works

One Python service (aiohttp) serves the editor through Home Assistant ingress and plays shows.
Effects are written once, in JavaScript: the editor uses them for the live preview and, on save,
renders every frame of the show into a compact baked file. The player only streams those frames to
each device over Govee's undocumented per-segment "razer" LAN protocol, with rate limiting,
keepalive and periodic re-enable. It follows either the browser's audio position or, for a Home
Assistant speaker, starts the lights when the speaker reports it is playing (plus that speaker's
delay) and corrects large drift from its reported position.

## Repository layout

```
repository.yaml                         Home Assistant add-on repository metadata
govee_show/                             The add-on (config, Dockerfile, app code)
  app/goveeshow/protocol.py             Govee LAN and razer packet encoding
  app/goveeshow/discovery.py            Multicast device scan
  app/goveeshow/output.py               Per-device streaming, keepalive, test pattern
  app/goveeshow/baked.py                Baked show file format
  app/goveeshow/player.py               Plays baked frames against a movable clock
  app/goveeshow/runner.py               Starts shows on a speaker or for the browser
  app/goveeshow/ha.py                   Home Assistant API (media players, MQTT details)
  app/goveeshow/commands.py             Automation commands over add-on stdin
  app/goveeshow/mqtt.py                 MQTT discovery entities
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
# Optional: HA_URL=http://homeassistant.local:8123 HA_TOKEN=<long-lived token> to use real speakers
```

To try it in Home Assistant, copy the `govee_show` folder into `/addons` (Samba or SSH add-on), then
reload the Add-on Store; it appears under Local add-ons and builds on your machine.

When releasing, bump the version in `pyproject.toml`, `govee_show/config.yaml` and
`govee_show/app/goveeshow/__init__.py` together (CI checks they match).

## Licence

MIT, see [LICENSE](LICENSE).
