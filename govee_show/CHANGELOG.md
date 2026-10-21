# Changelog

## 0.2.44

- **Describe it** now shows it's working: the button spins with a seconds counter while the AI
  makes your effects, and the result (or what went wrong) stays in the panel afterwards.

## 0.2.43

- **Suggestions**: once the song has been analysed, **＋ Add effect…** on a selection starts with looks
  suggested for that part of the song (quiet, steady or loud), timed to the tempo and in your palette's
  colours.
- **Generate** starts on the palette for the time of year (Halloween, Bonfire Night, Christmas and more)
  when one is in season.

## 0.2.42

- **Describe it**: a new editor panel where you type what you'd like ("red and green chase on the roof
  in the chorus") and an AI adds those effects, lined up with the beats and sections. It uses Claude if
  you add a Claude API key on the add-on's Configuration tab, otherwise Home Assistant's AI Task with
  whichever AI integration you've set up there (including local ones). Clips are checked before they're
  placed, and Ctrl+Z undoes them. The Settings tab shows which AI is in use.

## 0.2.41

- **✨ Generate** in the Show panel makes a first draft of the whole show from the song, in the palette
  and style (Calm, Balanced or Lively) you pick. Quiet sections get slow, soft looks and loud ones fast
  looks that move on the beat, every light moves together in the chorus, repeated sections get the same
  looks, quiet starts and ends fade, and it can sweep across the house as the music lifts. It detects
  the beats first if needed, Ctrl+Z undoes it, and pressing it again gives a different take.

## 0.2.40

- **Detect** on the Beats panel listens to the song and finds its tempo, beats, bars and sections.
  Bar starts are drawn as stronger beat markers, and sections (Intro, Verse, Chorus, Bridge, Outro)
  as tinted, named bands behind the waveform. It runs in the browser, in a background worker, so
  nothing leaves your network. **Clear** now removes sections too.

## 0.2.39

- A **Music** tab for editing songs before you build a show. Select part of the waveform to **Cut** it or
  **Keep only** that part, splice in another song with **Insert at playhead** or **Add to end**, and set a
  crossfade for the joins plus a fade in and out. Undo, zoom and play the result, then **Save as new
  file** to write a WAV to `/media/govee_show/`, ready to pick under **Song**. The original is untouched.

## 0.2.38

- A proper preset editor on the **Presets** tab: your presets listed by effect on the left, and the
  picked one edited on the right with a large live preview (on any light's segments), the same
  grouped Colours, Effect settings and Brightness as a clip, palettes, and Include colours. Changes
  show and save as you make them. **New preset** starts one from any effect or built-in preset, and
  the effect of a preset can be changed.

## 0.2.37

- Your own effect presets. **Save as preset…** on a clip saves its settings under a name, with its
  colours included unless you untick **Include colours**. They show in the effect chooser after the
  built-in presets with a ★, and **★ My presets only** shows just yours. A new **Presets** tab lists
  them by effect with previews, to rename, change settings, duplicate or delete. Stored in the
  add-on, so they're the same in every browser.

## 0.2.36

- One **effect chooser** for adding an effect and for changing a clip's: a window with a previewing
  button for every effect. Open it with **＋ Add effect…** on a selection (plus an **Add … again**
  button for the last one you added) or the **Effect** button on a clip.
- **Show presets** in the chooser turns each effect into its own boxed group, Default first then its
  presets, all previewed. It remembers whether presets were showing. The separate Preset button is
  gone; the Effect button now names the preset a clip matches (for example Three colours · Wide
  marquee).
- Changing a clip's effect keeps its colours and brightness and resets its other settings.

## 0.2.35

- Calmer clip settings: presets moved behind a **Preset** button next to **Effect**, which names the
  preset the clip matches (or Custom). Their previews only play when you open it, and only one
  drawer of previews (effects or presets) is open at a time. The preset drawer stays open while you
  try presets.

## 0.2.34

- Changing an existing clip's effect now shows previews too: the **Effect** dropdown is a button
  that opens the same previewing effect buttons used to add one, on that light's segments and for
  the clip's length, with the current effect outlined.
- Effect presets: a selected clip shows presets for its effect (for example **Three colours
  presets**: Still blocks, Alternating, Wide stripes, Slow, Fast and Wide marquee), each previewed
  in the clip's own colours. Picking one sets the effect's settings and keeps your colours. Every
  effect except Solid and Govee scene has some, including the House lane's.

## 0.2.33

- Page layouts: choose how the editor's top, left, middle, right and bottom areas fit together.
  **Classic** is the layout so far; **Side columns** runs left and right the full height of the
  page; **Right column** runs just the right side full height. Pick one at the bottom of any
  panel's ⋯ menu or under Settings → Layout. Empty areas take no space.
- A panel's ⋯ menu now shows a small picture of the page: click the area to move the panel there.

## 0.2.32

- Documentation refresh. The add-on guide is rewritten to cover everything up to now, in the order
  you'd use it: devices, speakers, tracing your house (out-of-view stretches, icicles and spots),
  building a show, the full effect list including the House lane, playing, automations and
  troubleshooting. The README's feature list and repository layout are brought up to date, and
  the in-app hints now point to the Speakers tab for the default show speaker.

## 0.2.31

- New **House** lane at the top of the timeline, for effects that run across all your lights by
  where they are on the house photo: **Sweep** (a band of colour crossing the house left to right,
  right to left, up, down, or out from or in to the centre), **House wipe** (fills the house with a
  colour in that direction) and **Rainbow wave**. They sit on top of each light's own effects; set
  **Elsewhere** to let those show through outside the sweep or wipe. Lights need tracing on the
  House tab first, and bulbs out of view or off the photo are left alone.

## 0.2.30

- Every effect button in the Selection panel now has a small strip playing that effect, so you can
  see what each one looks like before adding it. It uses the effect's default settings and runs
  on the selected light's segments, for as long as the selection (up to 6 seconds before it loops).

## 0.2.29

- House view: spotlights, such as the H7093. Set a light's **Style** to **Spots**, press Trace and
  click where each spotlight sits. Each one shines a soft wash of colour onto the photo; drag its
  round handle to aim it, and set **Beam** for how wide the beams are. Each spot shows its share
  of the light's segments.

## 0.2.28

- The House tab lists your lights in a sidebar beside the photo instead of a row above it, so it
  stays tidy with lots of lights. Click a light (in the list or on the photo) to highlight it and
  show its settings: Trace, Clear, Style, and the stretch you clicked. The tracing help is folded
  away under **How to trace your lights**. On a phone the photo comes first, with the list below.

## 0.2.27

- House view: icicle lights. Set a light to **Icicle** on the House tab and say how many drops it
  has and how far the longest hangs. It's drawn as staggered drops hanging from the traced line,
  each drop in its segment's colour, sharing out the light's **Bulbs**.

## 0.2.26

- House view: parts of a light that can't be seen from the photo, such as eaves running round the
  back of the house or an extension lead, can be marked **Out of view**. Click the stretch on the
  House tab, choose Out of view and say how many bulbs are on it (0 for a lead). Those bulbs keep
  their place in the light's segments but aren't drawn, so the bulbs in view show the right part
  of each effect.
- Fixed the timeline's zoom and scrolling. Once zoomed in, the timeline could scroll its own
  drawing out of sight, leaving a blank strip. The mouse wheel also only worked over part of it
  and Ctrl+wheel jumped in big steps. Now the wheel scrolls anywhere on the timeline, Ctrl+wheel or
  a trackpad pinch zooms smoothly round the pointer, the + and − buttons and keys zoom round the
  playhead when it's in view, and the zoom level is remembered however you change it.

## 0.2.25

- New **Bulbs** column on the Devices tab. The House view draws exactly that many bulbs along the
  light, shared evenly across its segments, so it matches the real string. Blank keeps the guess
  of 4 bulbs per segment.

## 0.2.24

- New **Speakers** tab. Test a Home Assistant media player there (it plays a short chime the way a
  show starts) and only speakers that pass are offered in the editor. Media players that can't be
  sent a song are marked, and a failed test shows Home Assistant's reason. Speaker delays and the
  default show speaker are set there too. Add your speakers again after updating.

## 0.2.23

- Separate speakers for editing and for the real show. The speaker in the Playback panel is now
  only where the editor plays, kept per browser. Automations and the MQTT Play button use the
  **Show speaker** in the Song panel, or the new **Default show speaker** on the Settings tab.
  Shows that already had a speaker keep it as their show speaker. Pick your editing speaker
  again in Playback after updating.

## 0.2.22

- New **House** view. Upload a photo of your house on the House tab and trace where each light
  runs on it. The editor's House panel then plays the show on the photo, with each segment drawn
  as a few glowing bulbs.

## 0.2.21

- The Selection panel can be hidden too. Only the timeline always stays.
- Drag a panel by its title to move it or change its order within a zone. The ⋯ menu also has
  **Earlier** and **Later**.
- Zoom is no longer its own panel: its − and + buttons are in the Timeline's title bar.

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
