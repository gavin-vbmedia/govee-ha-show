# Govee HA Show

A Govee light-show sequencer packaged as a Home Assistant add-on. Think of it as a
simple alternative to xLights built specifically for Govee lights.

Create, preview, save and play music-synchronised light shows from a browser-based
editor inside Home Assistant, with no external sequencing software or separate hosting.

## Features

**Lights**

- Discover Govee devices on the local network, check each one's segments with a test pattern,
  and set its segments, bulb count, brightness, direction and blending
- Plan shows before your lights arrive: add planned lights by name and segment count, then link
  them to the real devices later

**Your house**

- See the show on a photo of your house: trace where each light runs and the editor plays it there,
  bulb by bulb
- Mark stretches that run out of view (round a corner, or an extension lead) so the bulb count
  still lines up; those bulbs still play in the real show
- Draw icicle lights as hanging drops and spotlights (such as the H7093) as beams aimed at the wall
- A sidebar lists every light so houses with many lights stay manageable

**Building a show**

- Detect the song's tempo, beats, bars and sections (intro, verse, chorus…) automatically, in the
  browser
- Timeline editor with the song's waveform, one track per device, beat markers and snapping, and
  smooth zoom (+/−, Ctrl+wheel or pinch) and scroll
- Select a stretch of time on one or more lights, then add effects there or clear it, with a live
  preview of every effect in the picker
- Effects on each light (solid, two and three colours, pulse, gradient, colour cycle, fade, chase,
  rainbow, comet, scanner, flicker, lightning, strobe, twinkle, wipe) with a live, segment-level
  preview, previewed presets for each (still blocks, marquees, slow drift, candle, storm…), and
  your own presets saved from any clip
- A **House** lane for effects that run across all your lights by where they are on the house
  photo, like xLights' model effects: sweeps, wipes and rainbow waves left to right, up, down or
  out from the centre
- Colour palettes: presets for holidays and moods, plus your own, to recolour an effect, a light
  or the whole show in one click
- Copy and paste effects between lights (Ctrl+C / Ctrl+V), or copy a whole light's effects to
  one or every other light
- Play just a region of the show, and loop it while you design; undo and redo
- Arrange the editor your way: pick a page layout (classic, side columns or a right column), then
  drag any panel to the top, left, middle, right or bottom, or hide it
- Experimental: hand a light to one of Govee's built-in scenes for part of the show

**Playing it**

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
govee_show/                             The add-on (config, Dockerfile, docs, changelog)
  DOCS.md                               User guide (shown on the add-on's Documentation tab)
  CHANGELOG.md                          What changed in each version
  app/goveeshow/__main__.py             Entry point and environment settings
  app/goveeshow/protocol.py             Govee LAN and razer packet encoding
  app/goveeshow/discovery.py            Multicast device scan
  app/goveeshow/output.py               Per-device streaming, keepalive, test pattern
  app/goveeshow/baked.py                Baked show file format
  app/goveeshow/player.py               Plays baked frames against a movable clock
  app/goveeshow/runner.py               Starts shows on a speaker or for the browser
  app/goveeshow/scenes.py               Govee scene library lookup (experimental scenes)
  app/goveeshow/storage.py              Shows, settings, songs and the house photo on disk
  app/goveeshow/ha.py                   Home Assistant API (media players, MQTT details)
  app/goveeshow/commands.py             Automation commands over add-on stdin
  app/goveeshow/mqtt.py                 MQTT discovery entities
  app/goveeshow/server.py               HTTP API for the editor
  app/goveeshow/static/                 The editor (plain ES modules, no build step)
    index.html, style.css               Page and styles
    js/app.js                           Editor state, panels, inspector and playback
    js/effects.js                       Effect definitions, House lane effects and the baker
    js/timeline.js                      Timeline canvas: waveform, clips, selection, zoom
    js/house.js                         House photo: tracing, bulb layout, icicles, spots
    js/layout.js                        Movable panel layout
    js/palettes.js                      Colour palette presets
    js/analysis.js                      Song analysis: tempo, beats, bars and sections
    js/analysis-worker.js               Runs the analysis off the main thread
    models.json                         Govee model names and segment counts
tools/build_models.py                   Regenerates models.json
tests/                                  pytest and node tests (tests/js)
```

## Development

```
pip install -r govee_show/requirements.txt pytest pytest-aiohttp
python -m pytest
node --test tests/js/*.mjs

# Run the service locally (requests from this machine are allowed without ingress)
cd govee_show/app
GOVEE_SHOW_CONFIG=/tmp/gs/config GOVEE_SHOW_MEDIA=/tmp/gs/media python -m goveeshow
# then open http://localhost:8099/ (GOVEE_SHOW_PORT changes the port)
# Optional: HA_URL=http://homeassistant.local:8123 HA_TOKEN=<long-lived token> to use real speakers
```

To try it in Home Assistant, copy the `govee_show` folder into `/addons` (Samba or SSH add-on), then
reload the Add-on Store; it appears under Local add-ons and builds on your machine.

When releasing, bump the version in `pyproject.toml`, `govee_show/config.yaml` and
`govee_show/app/goveeshow/__init__.py` together (CI checks they match).

## Licence

MIT, see [LICENSE](LICENSE).
