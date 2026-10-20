# Changelog

## 0.2.21

- The Selection panel can be hidden too. Only the timeline always stays.

## 0.2.20

- Fix: the Brightness slider's handle stopped short of the end at 100%. Sliders no longer pick up
  the padding and border meant for text boxes.
- Editor layout has five zones: top and bottom across the full width, and left, middle and right
  between them. The timeline is a panel too and can go in any of them. Panels other than the
  timeline and Selection can be hidden, and brought back from Settings → Layout.

## 0.2.19

- The Effects bar is gone. Select a stretch of a light and the Selection panel shows a button for
  each effect: one click adds it.
- Selecting a clip loops it on its own above its settings, so edits show straight away. Tick
  **Show on the light** to loop it on the real light too while the show is stopped.

## 0.2.18

- Experimental **Govee scenes**: switch on in Settings → Experimental to add a Govee scene effect.
  Its clip hands the light to one of the Govee app's built-in scenes, picked from Govee's scene
  list for the light's model, then the show takes the light back. Unofficial, so it may not work
  on every light.

## 0.2.17

- Fix: while playing from the editor, long effects like rainbow skipped every second or so. The
  lights jumped to match the browser whenever they were more than 40 ms apart, which network
  delay alone could cause. Small differences are now eased out, the browser allows for the
  delay, and only a real seek makes the lights jump.

## 0.2.16

- Fix: lights blinked about once a minute during long effects. The "realtime on" command was
  repeated every minute and some lights blink when they hear it. It's now only sent while a
  light starts up, and the constant stream of colours keeps the light in realtime mode.

## 0.2.15

- The clip settings below the timeline are grouped into Clip, Colours, Effect settings and
  Brightness, and the brightness slider shows its value.
- Fix: after updating the add-on, browsers could keep running the previous version's editor, so
  new settings like Brightness didn't appear until a hard refresh. The editor's files are now
  checked for updates on every load.

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
