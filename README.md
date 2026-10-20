# Govee HA Show

A Govee light-show sequencer packaged as a Home Assistant add-on. Think of it as a
simple alternative to xLights built specifically for Govee lights.

Create, preview, save and play music-synchronised light shows from a browser-based
editor inside Home Assistant, with no external sequencing software or separate hosting.

## Planned features

**Initial release**

- Discover compatible Govee devices on the local network and verify segment control
- Timeline editor with an audio waveform, one track per device and beat markers
- Draggable core lighting effects with a live, segment-level preview
- Save and load shows
- Shows precomputed into frames for reliable playback over the LAN
- Browser-controlled playback

**Later**

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

## Repository layout

```
repository.yaml       Home Assistant add-on repository metadata
govee_show/           The add-on (config, Dockerfile, app code)
```

## Licence

MIT, see [LICENSE](LICENSE).
