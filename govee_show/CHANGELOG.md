# Changelog

## 0.2.14

- Every effect now has a **Brightness %** slider. Rainbow's own brightness setting moves into it,
  and existing rainbow clips keep their level.
- New **Brightness %** per light on the Devices tab, which caps that light in every show and in
  the preview. It applies straight away, without re-saving shows.

## 0.2.13

- Fix: lights that hold one colour, including Find segments, could still flicker back to their own
  scene. Unchanged colours are now streamed 10 times a second instead of twice.

## 0.2.12

- Fix: Find segments only flashed the segment. Between questions it switched realtime mode off and
  on, and an unchanged colour was only re-sent every 20 seconds. The light now stays in realtime
  mode until Find stops, and colours are re-sent every half second, which also keeps lights that
  hold one colour during a show from slipping back to their own scene.

## 0.2.11

- **Find segments**: press **Find** next to a light's segment count and answer "can you see any
  light?" a few times. It lights one segment at a time and narrows down the count, so a light can
  stay on its reel.

## 0.2.10

- New per-light **Protocol** option on the Devices tab, for lights that turn on but ignore the
  Test pattern: Realtime (the default), Realtime (Razer), Realtime v2, or Whole light only, which
  uses the official colour command for lights with no realtime mode.

## 0.2.9

- Fix: a light that was switched off could miss the "realtime on" command while it powered up and
  stay on its last scene. The command is now repeated twice a second for the first 5 seconds.

## 0.2.8

- Fix: realtime colour packets set the "gradient off" flag the way OpenRGB and SignalRGB do (it
  was inverted), which some lights need before they show colours. Blend still turns blending on.
- The add-on log shows the first colour packet when you press Test, to help diagnose lights that
  don't respond.

## 0.2.7

- Arrange the editor: move any panel to the top, left, right or bottom of the timeline with its ⋯
  button, or from Settings → Layout. Saved per browser.
- New Settings tab with the light offset / speaker delay, the automation instructions and the
  layout, replacing the "Playback and automation" dropdown.

## 0.2.6

- Play region: drag along the time ruler (or press "Play this part" on a selection) to play just
  that part of the show. Tick Loop to repeat the region, or the whole show, while you design.
- Auto save: shows save themselves a couple of seconds after each change (switch it off next to
  Save). A note shows whether everything is saved.

## 0.2.5

- Colour palettes: 18 presets (Christmas, Halloween, Bonfire Night, Pride, Ocean, Fire and more)
  plus your own on the new Palettes tab. Click a palette colour to use it in an effect, apply a
  palette to an effect, or recolour every effect on a light or the whole show.
- New effects: Pulse, Gradient, Colour cycle, Comet, Scanner, Flicker and Lightning.
- Two colours and Three colours can move along the light like theatre marquee lights.
- Dragging on the timeline now selects a stretch of time (on one or several lights) instead of
  adding an effect straight away. Click an effect to add it there, or delete to clear it.
- Tidier top bar, grouped into Show, Song, Playback, Beats and Zoom.

## 0.2.4

- Copy and paste effects: Ctrl+C / Ctrl+V for a clip or a whole light (click its name), and
  "Copy all effects to" another light or every light, optionally replacing theirs.
- New Two colours and Three colours effects: split a light into halves or thirds, or alternate the
  colours along it.

## 0.2.3

- Model picker for planned lights (about 290 Govee models): fills in the name and shows whether
  Govee lists the model as supporting realtime segment control. Devices and scan results show
  the same marker.

## 0.2.2

- Fix install: use a Home Assistant base image tag that exists (Python 3.13, Alpine 3.22) and
  move build settings into the Dockerfile (build.yaml is deprecated).

## 0.2.1

- Planned lights: add a light you don't have yet (name and segment count) and build shows with it.
  When it arrives, link it from a scan or by typing its IP; its shows carry over.

## 0.2.0

- Timeline editor with song waveform, one track per device, draggable and resizable effect clips,
  beat markers (tap, BPM fill, click to add or remove) with snapping, zoom and undo.
- Seven effects: solid, fade, chase, rainbow, strobe, twinkle and wipe, each previewed live per segment.
- Device discovery over the Govee LAN API, manual add by IP, and a test pattern for checking segment
  count and direction.
- Shows saved to the add-on config folder and baked into precomputed frames on save.
- Playback from the browser: the song plays in the browser and the add-on streams frames to the
  lights over Govee's realtime (razer) protocol, kept in sync with the audio.
- Songs from the Home Assistant media folder or uploaded through the editor (saved to
  `/media/govee_show`).
- Play the song on a Home Assistant media player, with the lights following it and a delay
  setting per speaker.
- Automations: MQTT discovery entities (show select, play and stop buttons, status sensor) when a
  broker is set up, and play/stop commands through the `hassio.addon_stdin` action.

## 0.1.0

- Initial add-on skeleton with a placeholder ingress page.
