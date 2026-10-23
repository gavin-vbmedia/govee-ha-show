<div align="center">

<img src="docs/brand/banner.svg" alt="HA-liday Show" width="600">

**Music-synchronised light shows for the lights you already have, made for Home Assistant.**

A simple alternative to xLights for Govee lights, WLED strips, pixel controllers, Twinkly and any Home
Assistant light: design a show in your browser, watch it play on a photo of your house, then run it from
an automation. Install it as a Home Assistant add-on, or run it on
its own with Docker or Python.

<sub>A hobby project, written almost entirely by AI. See [How this is made](#-how-this-is-made).</sub>

[![CI](https://github.com/gavin-vbmedia/ha-liday-show/actions/workflows/ci.yml/badge.svg)](https://github.com/gavin-vbmedia/ha-liday-show/actions/workflows/ci.yml)
[![Version](https://img.shields.io/badge/dynamic/yaml?url=https%3A%2F%2Fraw.githubusercontent.com%2Fgavin-vbmedia%2Fha-liday-show%2Fmain%2Fhaliday_show%2Fconfig.yaml&query=%24.version&label=version&color=blue)](haliday_show/CHANGELOG.md)
![Architectures](https://img.shields.io/badge/arch-amd64%20%7C%20aarch64-informational)
[![Licence: MIT](https://img.shields.io/badge/licence-MIT-green)](LICENSE)
[![Coded with Claude](https://img.shields.io/badge/coded%20with-Claude-d97757)](#-how-this-is-made)

[![Add this repository to your Home Assistant](https://my.home-assistant.io/badges/supervisor_add_addon_repository.svg)](https://my.home-assistant.io/redirect/supervisor_add_addon_repository/?repository_url=https%3A%2F%2Fgithub.com%2Fgavin-vbmedia%2Fha-liday-show)

[Install](#-installation) · [Features](#-features) · [User guide](haliday_show/DOCS.md) ·
[Changelog](haliday_show/CHANGELOG.md) · [Development](#-development)

![The editor: a generated show on five lights, playing on the house preview](docs/images/editor.webp)

</div>

## ✨ Highlights

- 🎵 **Hears the song for you.** Tempo, beats, bars and sections (intro, verse, chorus…) are detected
  in your browser, and every effect snaps to them.
- 🪄 **A first draft in one click.** **Generate** fills every light with effects that follow the
  music, in the palette and style you pick, ready for you to tweak.
- 💬 **Or just describe it.** "Red and green chase on the roof in every chorus" and an AI adds it,
  using Claude or any AI you've set up in Home Assistant, local models included.
- 🏠 **See it on your house.** Trace your lights on a photo and the editor plays the show there,
  bulb by bulb, so you can design without standing in the garden.
- 🔌 **Works with the lights you have.** Govee, WLED, pixel controllers over DDP or E1.31, Twinkly, and
  any Home Assistant light or smart plug, all in one show.
- 📦 **Plan before you buy.** Add lights that haven't arrived yet and link them to the real ones later.
- ⏯️ **Runs itself.** Shows play on any Home Assistant speaker and start from automations through MQTT
  entities or the `hassio.addon_stdin` action.
- 🐳 **Runs where you want.** A Home Assistant add-on, or on its own with Docker or Python.

## 📸 A closer look

<table>
  <tr>
    <td width="50%"><img src="docs/images/chooser.webp" alt="The effect chooser, with suggestions for the selected part of the song and a live preview of every effect"></td>
    <td width="50%"><img src="docs/images/house.webp" alt="Lights traced on a photo of a house: a roof line, icicles, windows, a tree and four spotlights"></td>
  </tr>
  <tr>
    <td><b>Pick an effect.</b> Suggestions fit the part of the song you selected, and every button
    previews the effect on that light.</td>
    <td><b>Trace your house.</b> Lines, icicles and spotlights, each drawn bulb by bulb from the plug
    end.</td>
  </tr>
</table>

## 🚀 Installation

**Lights**, in any mix, on the same network as wherever HA-liday Show runs:

| Kind | What you need |
| --- | --- |
| Govee | **LAN Control** turned on in the Govee Home app, and a model with Govee's per-segment realtime mode |
| WLED | Any WLED strip |
| Pixel controllers | DDP (Falcon Player, ESPixelStick, ESPHome, Tasmota, ESP32) or E1.31/sACN (Falcon, Kulp, xLights set-ups) |
| Home Assistant | Any light or switch, such as Zigbee or Hue bulbs, or a smart plug for a prop |
| Twinkly | Experimental: not tried on a real Twinkly yet |

### As a Home Assistant add-on (recommended)

Needs Home Assistant OS or Supervised (anything with **Settings → Add-ons**).

1. Press **Add repository** above. It opens your Home Assistant and offers to add this add-on
   repository.
   <details><summary>Adding it by hand</summary>

   Go to **Settings → Add-ons → Add-on Store**, open the ⋮ menu, choose **Repositories** and add
   `https://github.com/gavin-vbmedia/ha-liday-show`.
   </details>
2. Install **HA-liday Show**, turn on **Show in sidebar**, and start it.
3. Open **HA-liday Show** from the sidebar and follow the
   [quick start](haliday_show/DOCS.md#quick-start).

Home Assistant builds the add-on on your machine the first time, which takes a few minutes. For show
entities in automations, also set up the Mosquitto broker add-on and the MQTT integration (optional).

### Without Home Assistant add-ons

If your Home Assistant can't install add-ons (a "Container" or "Core" install), or you don't use Home
Assistant at all, run it on any always-on machine on your network instead:

- **[With Docker](haliday_show/DOCS.md#with-docker)** on a NAS, Raspberry Pi or Linux PC, with the
  ready-made [`docker-compose.yml`](standalone/docker-compose.yml).
- **[With Python](haliday_show/DOCS.md#with-python)** on a Mac, Linux or a Raspberry Pi:
  `pipx install git+https://github.com/gavin-vbmedia/ha-liday-show`

It's the same app with the same saved files, so shows copy across. You open it in a browser with a
password, and it can still use your Home Assistant speakers, AI and MQTT if you point it at them. See
[Running without Home Assistant](haliday_show/DOCS.md#running-without-home-assistant).

## 🧰 Features

<details open>
<summary><b>💡 Lights</b></summary>

- One **Add a light** window for every kind: pick what you're adding and fill in only what it needs
- **Govee** lights, found on the network, with a test pattern and a few yes or no questions to set
  their segments
- **WLED** strips, found on the network or added by IP, with their LED count and WLED segments filled
  in for you
- **Pixel controllers** over DDP (Falcon Player, ESPixelStick, ESPHome, Tasmota, ESP32) or E1.31/sACN
  (Falcon, Kulp, xLights set-ups), with several lights on one controller
- Any **Home Assistant** light or switch (Zigbee, Hue, LIFX bulbs, smart plugs for inflatables), put
  back as it was after the show
- **Twinkly** lights (experimental), through Twinkly's local realtime mode
- Set each light's segments, bulb count, brightness and direction, and **Test** it on the real light
- Plan shows before your lights arrive: add planned lights by name and segment count, then link
  them to the real lights later
- Put your lights in any order (drag them on the Devices tab) and every show's timeline follows
- Split a light into parts (say, the front, side and back of a roof line) that each get their own
  track, while the light's own track still plays across all of them as one; segments in no part
  stay off during the show. **Test** a part to see exactly where it starts and ends on the real light
- For Govee lights whose realtime mode only reaches part of them, such as the Christmas String Lights 2
  and icicle lights: per-bulb colour (experimental), using the Govee app's own Finger sketch pictures

</details>

<details open>
<summary><b>🏠 Your house</b></summary>

- See the show on a photo of your house: trace where each light runs and the editor plays it there,
  bulb by bulb
- Draw icicle lights as hanging drops and spotlights as beams aimed at the wall
- Mark stretches that run out of view (round a corner, or an extension lead) so the bulb count
  still lines up; those bulbs still play in the real show
- Pin segments to where they really are when the photo is taken at an angle
- A sidebar lists every light so houses with many lights stay manageable

</details>

<details open>
<summary><b>🎬 Building a show</b></summary>

- Detect the song's tempo, beats, bars and sections automatically, in the browser
- Generate a first draft of a whole show from the song in one click, in a palette and style you pick
- Describe effects in words and an AI adds them, using Claude with your API key or any AI set up in
  Home Assistant, including local ones
- Effect suggestions for the selected part of the song, timed to its tempo
- Timeline editor with the song's waveform, one track per light, beat markers and snapping, and
  smooth zoom (+/−, Ctrl+wheel or pinch) and scroll
- 15 effects on each light (solid, two and three colours, pulse, gradient, colour cycle, fade, chase,
  rainbow, comet, scanner, flicker, lightning, strobe, twinkle, wipe) with live, segment-level
  previews, built-in presets for each, and your own presets saved from any clip
- A **House** lane for effects that run across all your lights by where they are on the photo, like
  xLights' model effects: sweeps, wipes and rainbow waves in any direction
- Colour palettes for holidays and moods, plus your own, to recolour an effect, a light or the
  whole show in one click
- Copy and paste effects between lights, play and loop just a region, undo and redo
- Knows what each light can show: effects that won't work on a light (a chase on a light that shows one
  colour at a time) are greyed out in the chooser, such clips in older shows are marked on the timeline,
  and previews step at a slow light's own pace so they look like the real thing
- Cut, trim and splice songs on the **Music** tab, with crossfades
- Arrange the editor your way: pick a page layout, then drag, collapse or hide any panel
- Experimental: hand a Govee light to one of Govee's built-in scenes for part of the show

</details>

<details open>
<summary><b>▶️ Playing it</b></summary>

- Save and load shows, with auto save; each show is baked into precomputed frames for reliable playback
- Play the song on any Home Assistant media player (with a per-speaker delay), or in the browser
- Schedule or trigger shows from automations: MQTT entities (show select, play/stop buttons,
  status), or the `hassio.addon_stdin` action

</details>

The full walkthrough is in the **[user guide](haliday_show/DOCS.md)**, which is also on the add-on's
Documentation tab in Home Assistant.

## ⚙️ How it works

```mermaid
flowchart LR
    subgraph Browser["Editor (browser)"]
        A[Song analysis<br/>tempo · beats · sections] --> B[Timeline &amp; effects]
        B --> C[Baker<br/>renders every frame]
    end
    subgraph Addon["Service (Python, aiohttp): HA add-on, Docker or pipx"]
        D[(Baked show)] --> E[Player]
    end
    C -- save --> D
    E -- "razer packets over LAN UDP" --> F[💡 Govee lights]
    E -- "DDP over LAN UDP" --> W[💡 WLED strips · pixel controllers]
    E -- "E1.31 unicast" --> X[💡 E1.31 controllers]
    E -- "light and switch actions" --> Y[💡 HA lights and plugs]
    E -- "realtime over LAN UDP" --> Z[💡 Twinkly, experimental]
    E -- "start song" --> G[🔊 HA media player]
    H[Automations<br/>MQTT · addon_stdin] --> E
```

One Python service (aiohttp) serves the editor and plays shows. As an add-on it is reached only through
Home Assistant ingress; run on its own (Docker or pipx) it answers its own port, and other devices need
the password set in `HALIDAY_SHOW_PASSWORD`.
Effects are written once, in JavaScript: the editor uses them for the live preview and, on save,
renders every frame of the show into a compact baked file. The player only streams those frames, each
light in its own protocol and at the pace it can take: Govee lights over Govee's undocumented
per-segment "razer" LAN protocol (or its slower app commands, for lights whose realtime mode falls
short), WLED and DDP controllers over DDP, E1.31 controllers over unicast E1.31, Home Assistant lights
and switches through Home Assistant's actions, and Twinkly over its realtime mode. Each kind gets its
own rate limiting and keepalive, and lights set up over HTTP are put back as they were afterwards. It
follows either the browser's audio position or, for a Home
Assistant speaker, starts the lights when the speaker reports it is playing (plus that speaker's
delay) and corrects large drift from its reported position.

## 🛠️ Development

```sh
pip install -r haliday_show/requirements.txt pytest pytest-aiohttp
python -m pytest
node --test tests/js/*.mjs
```

Run the service locally (requests from this machine are allowed without ingress):

```sh
cd haliday_show/app
HALIDAY_SHOW_CONFIG=/tmp/gs/config HALIDAY_SHOW_MEDIA=/tmp/gs/media python -m halidayshow
# then open http://localhost:8099/ (HALIDAY_SHOW_PORT changes the port)
# Optional: HA_URL=http://homeassistant.local:8123 HA_TOKEN=<long-lived token> to use real speakers
```

To try it the way people run it without Home Assistant: `pipx install .` then
`HALIDAY_SHOW_PASSWORD=pw haliday-show` (data goes in `~/haliday-show/`), or build the add-on image
and run it with `--network host`, as [`standalone/docker-compose.yml`](standalone/docker-compose.yml) does.

No lights to hand? Add planned lights on **Setup → Devices** and everything except the real output
works. To try it in Home Assistant, copy the `haliday_show` folder into `/addons` (Samba or SSH add-on),
then reload the Add-on Store; it appears under **Local add-ons** and builds on your machine.

**Releasing:** bump the version in `pyproject.toml`, `haliday_show/config.yaml` and
`haliday_show/app/halidayshow/__init__.py` together (CI checks they match), and add an entry to
[`CHANGELOG.md`](haliday_show/CHANGELOG.md). Merging to `main` also publishes the Docker image to
`ghcr.io/gavin-vbmedia/ha-liday-show` (`latest` and the version) for standalone installs.

<details>
<summary><b>Repository layout</b></summary>

```
repository.yaml                         Home Assistant add-on repository metadata
pyproject.toml                          Version, test settings, and the pipx install (haliday-show command)
standalone/docker-compose.yml           Running without Home Assistant, with Docker
.github/workflows/ci.yml                Tests, versions, add-on image, standalone and pipx checks
.github/workflows/publish.yml           Publishes the image to ghcr.io for Docker installs
docs/images/                            Screenshots for the README
docs/brand/                             Logo, icon and favicon (SVG originals; the add-on's PNGs are made from them)
haliday_show/                             The add-on (config, Dockerfile, docs, changelog)
  README.md                             Intro shown on the add-on's Info tab
  DOCS.md                               User guide (shown on the add-on's Documentation tab)
  CHANGELOG.md                          What changed in each version
  icon.png, logo.png                    Pictures shown in the Add-on Store (from docs/brand)
  app/halidayshow/__main__.py             Entry points (add-on and haliday-show) and environment settings
  app/halidayshow/protocol.py             Govee LAN and razer packet encoding
  app/halidayshow/wled.py                 WLED and DDP: packets, the light's name, LEDs and segments, and the scan
  app/halidayshow/e131.py                 E1.31 (sACN) packets and each controller's shared universes
  app/halidayshow/twinkly.py              Twinkly (experimental): HTTP login and modes, realtime packets
  app/halidayshow/discovery.py            Govee multicast scan (WLED's scan is in wled.py)
  app/halidayshow/listen.py               Records other Govee traffic (Labs → Listen)
  app/halidayshow/lab.py                  Packet lab: hand-made messages to one Govee light
  app/halidayshow/output.py               Streaming to each kind of light: pace, keepalive, putting back, test pattern
  app/halidayshow/baked.py                Baked show file format
  app/halidayshow/player.py               Plays baked frames against a movable clock
  app/halidayshow/runner.py               Starts shows on a speaker or for the browser
  app/halidayshow/scenes.py               Govee scene library lookup (experimental scenes)
  app/halidayshow/storage.py              Shows, settings, songs and the house photo on disk
  app/halidayshow/ha.py                   Home Assistant API (media players, lights and switches, MQTT details)
  app/halidayshow/commands.py             Automation commands over add-on stdin
  app/halidayshow/mqtt.py                 MQTT discovery entities
  app/halidayshow/server.py               HTTP API for the editor; who may connect (ingress or password)
  app/halidayshow/ai.py                   Describe it and AI presets: asks Claude or HA's AI Task
  app/halidayshow/static/                 The editor (plain ES modules, no build step)
    index.html, style.css               Page and styles
    js/app.js                           Editor state, panels, inspector and playback
    js/effects.js                       Effect definitions, House lane effects and the baker
    js/timeline.js                      Timeline canvas: waveform, clips, selection, zoom
    js/house.js                         House photo: tracing, bulb layout, icicles, spots
    js/devicetest.js                    Frames for testing a light's parts on the Devices tab
    js/labtemplates.js                  Packet lab starting points
    js/layout.js                        Movable panel layout
    js/palettes.js                      Colour palette presets
    js/music.js                         Music tab: cutting, trimming and splicing songs
    js/analysis.js                      Song analysis: tempo, beats, bars and sections
    js/analysis-worker.js               Runs the analysis off the main thread
    js/autogen.js                       Generates a draft show from the analysis
    js/lightspeed.js                    How fast each protocol can change a light, and previews at that pace
    js/compat.js                        Whether a clip's effect can show on its light, for marking and blocking
    js/controllers.js                   Pixel controllers (DDP, E1.31): where a new light starts, overlaps
    js/aiclips.js                       Describe it: context for the AI, checking its clips and presets
    models.json                         Our list of Govee lights: tested status and default settings
tools/build_models.py                   Adds new lights from Govee's LAN Control list to models.json
tools/govee_btsnoop.py                  Decrypts the Govee app's Bluetooth traffic from an Android log
docs/README.md                          Index of the notes below, one per kind of light
docs/govee-protocols.md                 How Govee lights are driven: findings, measurements, open questions
docs/capture-help.md                    Capturing the Govee app's traffic, for working out new commands
docs/wled.md                            How WLED strips are driven: DDP, and how WLED segments become parts
docs/ddp.md                             Pixel controllers over DDP: several lights on one controller
docs/e131.md                            E1.31 (sACN) controllers: universes, shared universes, stopping
docs/ha-lights.md                       Home Assistant lights and switches: pace, switching, putting back
docs/twinkly.md                         Twinkly (experimental): login, realtime packets, putting back
tests/                                  pytest and node tests (tests/js)
```

</details>

## 🤖 How this is made

HA-liday Show is a hobby project, and almost all of its code is written by AI (Anthropic's Claude), with
a person deciding what to build and trying it on real lights. Every change runs through automated tests
and a test build before it's released. Govee models with a **✓ works** or **⚠ limited** badge in the
add-on's model list have been tried on real lights; ones marked **? untested** are best effort. WLED,
pixel controllers, Home Assistant lights and Twinkly have so far only been tested against pretend
devices on the wire, so reports from real ones are especially welcome. If something doesn't work on yours, please
[open an issue](https://github.com/gavin-vbmedia/ha-liday-show/issues).

## 📄 Licence

MIT, see [LICENSE](LICENSE). Not affiliated with Govee, WLED, Twinkly or Home Assistant.
