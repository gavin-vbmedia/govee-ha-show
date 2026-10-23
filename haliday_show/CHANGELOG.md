# Changelog

## 0.2.88

- **WLED strips** now work alongside your Govee lights. Under **Setup → Devices**, pick **WLED** next to
  **Add by IP** and type the strip's IP: its name and number of LEDs are filled in for you, and each
  LED is its own segment. Shows, tests, live previews and the House view all work as they do for Govee.
- A WLED strip can be split into **parts** like any other light. If you've already set up segments in
  WLED, they become its parts when you add it, with their names. Press **Use WLED segments** under the
  strip to bring them in again after changing them in WLED; clips on a part stay with it.
- You can plan a WLED strip before it arrives: type **WLED** as the model next to **Add planned light**
  and set **Segments** to its number of LEDs.

## 0.2.87

- The add-on is now called **HA-liday Show**, ready for lights other than Govee. Home Assistant sees
  it as a new add-on, so install **HA-liday Show** and start it: it copies your shows, lights,
  palettes, presets, settings, house photo and songs across from **Govee Light Show** the first time.
  The **Documentation** tab's **Moving from Govee Light Show** section has the steps, including the
  few things to set again (your Claude API key, **Show in sidebar**, and MQTT automations).
- The sidebar entry is now **HA-liday Show**.

## 0.2.86

- The model list under **Setup → Devices** now comes from Govee's own list of lights with LAN Control,
  so it has over 100 newer lights, such as the Permanent Outdoor Lights 2 Pro and Prism, the Curtain
  Lights Pro and the Christmas Sparkle String Lights. Point at a model's **? untested** badge to see
  whether Govee lists it as having LAN Control, which the add-on needs.

## 0.2.85

- The four sweeps in **Setup → Settings → Packet lab** now work over the right number of bulbs on their
  own for lights whose realtime window is known (44 on the Christmas String Lights 2), even when
  **Segments** shows the whole light. Before, picking such a light set **Segments** to 300 and the sweeps
  lit nothing.

## 0.2.84

- Two more experiments in **Setup → Settings → Packet lab** for lights whose realtime colours stop short,
  like the Christmas String Lights 2 at bulb 44: **Try other flags** and **Try app modes first**. Each
  step lights the light in its own colour; the list under the buttons says which is which.

## 0.2.83

- Lights on **Per bulb** now go off between clips, and show a whole-light colour properly. Before, when
  the whole light was meant to be one colour (or off), it could fade out or keep showing the last colour
  instead.

## 0.2.82

- The model list under **Setup → Devices** is now our own, based on what real lights showed rather than
  Govee's out-of-date product list. Each model's badge says **✓ works**, **⚠ limited** or **? untested**
  (not tried with the add-on yet), and points at what we know. Sensors, plugs and other things that
  aren't lights are gone from it.
- A tested model starts with the settings that suit it when you plan it or add it from **Scan
  network**: the 30 m Christmas String Lights 2 (H70C5) starts on **Per bulb** with 300 segments and
  300 bulbs. Lights you've already added keep their settings.

## 0.2.81

- The editor now knows which effects each light can show. In the effect chooser, effects that won't
  work on that light are greyed out: a chase or two-colour blocks on a light set to **Whole light only**
  (it shows one colour at a time), or a chase wider than a short light. Click one to see why, or tick
  **Allow effects that won't work** to use it anyway. Effects that work but not quite as meant, such as
  ones too fast for a slow light, get a **⚠**.
- Your existing shows open and play as before. Clips that won't work on their light are hatched on the
  timeline with a **⚠**, the **Selection** panel says why, and a message when you open the show says
  how many there are.
- **Copy to all lights**, paste and adding an effect to several lights at once leave out the lights it
  won't work on and say so. **Generate** and **Describe it** only use effects that work on each light.
- A Christmas String Lights 2 (H70C5) set to a realtime protocol now shows **⚠ first 44 bulbs only**
  under its name on the timeline.
- Previews now look like the real light. On **Per bulb**, **App segments** and **Whole light only**,
  the timeline, **Preview**, house photo, **Selection** strip and effect chooser step at the light's own
  pace instead of moving smoothly, and a **Whole light only** light shows the one colour it really will.

## 0.2.80

- New in **Setup → Settings → Packet lab**: **Try ways to switch on**. A TV sync box gets colour onto the
  whole of the Christmas String Lights 2, while the add-on's realtime colours only reach the first 44 bulbs.
  This tries seven guesses at how the sync box switches the light over, each followed by a rainbow. If the
  rainbow spreads further along your light during one of them, tell us its number.

## 0.2.79

- On lights using **Per bulb**, **App segments** or **Whole light only**, the **Selection** panel now warns
  **⚠ Too fast for this light** when a clip's effect changes faster than the light can follow (a quick
  chase, sparkle or strobe), as it would look steppy on the real light.

## 0.2.78

- **Generate**, **Describe it** and the effect ideas in the **Selection** panel now pick looks that suit
  lights on **Per bulb**, **App segments** or **Whole light only**, which can only change a few times a
  second: colour changes, fades, pulses and still blocks rather than fast chases and sparkles.

## 0.2.77

- **Per bulb (experimental)** no longer drops pictures. Each picture now waits as long as the light
  needs to take it in, and the colour covering most of the light is sent as the background, so looks
  where most of the string is one colour (fades, flashes, a few bulbs moving) change up to about 6 times
  a second. Busy looks like a full rainbow still change only once or twice a second.

## 0.2.76

- **Packet lab** has a **Per bulb speed test**: it flips a light between red and blue pictures at a rate
  you pick, with a small picture or the whole light, to find how fast **Per bulb (experimental)** can go.

## 0.2.75

- New, experimental **Protocol** on **Setup → Devices**: **Per bulb (experimental)**, for lights whose
  Govee app has **Finger sketch**, such as the Christmas String Lights 2 and the icicle lights. It gives
  every bulb its own colour, the whole length of the string, where realtime mode stops after a few dozen
  bulbs. Set **Segments** to the number of bulbs (300 on the 30 m Christmas String Lights 2) and press
  **Test**. It changes up to about 4 times a second, so slower looks suit it best.
- Lights using **Per bulb**, **App segments** or **Whole light only** can have up to 1,000 segments.

## 0.2.74

- **Packet lab** has a **Run sweep** button for lights whose realtime mode only reaches their first few
  dozen bulbs, like the Christmas String Lights 2 and the icicle lights. It tries nine ways of reaching
  the rest, each in its own colour, so a short video of the light shows whether any of them works.

## 0.2.73

- **Setup → Settings → Packet lab**: send one of your lights a message you choose and see what it sends
  back. For trying out new ways of driving lights; ready-made starting points cover the realtime forms,
  Govee app commands and status requests.
- The model badge on **Setup → Devices** now says **? untested** instead of **⚠ unverified** for models
  Govee's list doesn't mark for realtime. That list is out of date for newer lights, many of which work.
  The Permanent Outdoor Lights Pro now shows **✓ realtime**.

## 0.2.72

- **Setup → Settings → Listen for Govee traffic** records, for a minute, the messages your Govee lights
  send each other that Home Assistant can hear. For example, run **Scene Stage** in the Govee Home app,
  press **Listen**, then **Download** the recording and attach it to a GitHub issue. It helps work out
  how Govee drives lights like the Christmas String Lights 2 in more detail than the add-on can yet.
  Nothing is sent to your lights.

## 0.2.71

- **App segments (experimental)** lags less. It now sends only a few segment changes at a time, the
  biggest first, and skips changes too small to see. Before, it could send more than a light like the
  H70C5 could keep up with, so the light fell further and further behind.

## 0.2.70

- New, experimental **Protocol** on **Setup → Devices**: **App segments (experimental)**. It colours a
  light the way the Govee Home app does, in the app's own segments, for lights like the 30 m Christmas
  String Lights 2 (H70C5) whose realtime mode only reaches some of the bulbs. Set **Segments** to the
  number the Govee app shows (10 for the H70C5) and press **Test**. It changes up to 10 times a second,
  so slower looks suit it best.

## 0.2.69

- **Setup → Devices**: the 30 m Christmas String Lights 2 (H70C5) is now marked **⚠ limited**. In
  realtime mode it only lights its first 44 bulbs, so the badge suggests **Whole light only** if you
  want the whole string lit. A new line in the user guide's troubleshooting table covers this.

## 0.2.68

- **Setup → Devices**: each part of a split light has a **Test** button that lights just that part on
  the real light, in its colour with its first segment white, so you can see where it starts and
  ends. **Test parts** lights them all, and **Stop** lets the light go.
- While a test is lit, changing the light's **Segments**, **Reverse**, **Protocol** or a part's
  segments shows on the light straight away, without pressing **Test** again.

## 0.2.67

- The add-on has its own icon and logo, a string of coloured lights, in the **Add-on Store** and on
  the add-on's page, instead of the blank placeholder. Nothing in the add-on itself has changed.

## 0.2.66

- Docs: a refreshed README with screenshots, a proper intro on the add-on's **Info** tab, and a
  reorganised user guide with a heading for every topic, so it's easier to scan and find things.
  Nothing in the add-on itself has changed.

## 0.2.65

- Editor: every panel except the Timeline can be collapsed to its title with the ▾ arrow before its
  name, and opened again with ▸. Which panels are collapsed is saved in your browser with the rest of
  the layout.

## 0.2.64

- Editor: the **Show** panel is one line, with the show, **Save**, **⚙ Settings…** and **Generate**.
  **Settings…** opens the show's settings: its name, its show speaker (moved from the Song panel),
  auto save, and **Delete show…**, which is now well away from Save.
- Editor: the **Song** panel shows the song's name, length, tempo and sections, with **Change…** to
  pick another, upload one, or choose no song and set the show's length.
- Toolbar panels along the top or bottom of the editor are slim one-row bars that stretch to fill
  the row. They can still be dragged by their title or moved with ⋯.

## 0.2.63

- Four tabs instead of eight: **Editor**, **Music**, **Library** (Palettes and Presets) and **Setup**
  (Devices, Speakers, House and Settings). Library and Setup list their pages down the side, or along
  the top on a phone, and each remembers the page you last had open.
- **Setup → Speakers** now holds everything about where the song plays and when: your speakers, the
  default show speaker, **Light offset** and the automation input, which used to be on Settings. The
  long note about speakers that can't play shows is tucked into a **Why can't some speakers play
  shows?** link.
- **Library → Palettes**: built-in palettes are shown as a compact grid of cards, under **Built in**
  rather than "Presets", so they don't get mixed up with effect presets.
- The Devices table scrolls sideways in its own box when the page is narrow.

## 0.2.62

- Editor: a new default layout puts the timeline first. Show and Playback run across the top, Song,
  Preview, House and Beats sit down the left, and Selection and Describe it down the right, so the
  timeline and the selected clip fit on screen together. A layout you arranged yourself is kept;
  **Reset layout** switches to the new one.
- Editor: the top area stays in view while you scroll, as long as it's short enough not to crowd out
  the timeline.
- Selection: **＋ Add effect…** comes first and stands out; **Delete effects here** moves to the end.
- A slightly darker blue for buttons and tabs, so their white text is easier to read.

## 0.2.61

- **House** tab: pin segments where they really are. Drag a picked light's segment number along its line
  and the bulbs between pins are spread evenly, so a photo taken at an angle lines up with the real
  bulbs. **Light it** lights just that segment on the real light to find it. Right-click or **Unpin**
  removes a pin.

## 0.2.60

- **House** tab: a light split into parts is listed as its parts, and each part is traced on its own, so
  parts that aren't joined up on the photo can each go where they really are. A light traced whole before
  it was split has **Split trace into parts**, which cuts its line at each part's ends.
- Editor: a track for a light that's no longer on the Devices tab can be taken out of the show with
  **Remove from show** (or **Remove all unplayed tracks**).

## 0.2.59

- **House** tab: a split light shows each part in its colour, with unused segments as faint unlit bulbs. The
  picked light has segment numbers along it and its parts named, and hovering a bulb shows its light, segment
  and part.

## 0.2.58

- Parts on the **Devices** tab are listed one per line, each with a colour and its segment count, under a
  bar that maps the light's segments (parts in their colours, unused ones grey).
- A split light with only one track on the timeline is drawn like any other light, without the group bar.

## 0.2.57

- A split light's tracks are grouped on the timeline: a coloured bar, a tint, the parts indented under the
  light, and heavier lines around the group.
- **Also play as one** under a light's parts: untick it for a light you only use in parts, and its own
  track goes away.
- The tabs are in a more natural order: Editor, Music, Presets, Palettes, then Devices, House, Speakers,
  then Settings. On a phone they sit on their own row and scroll sideways, and wide tables scroll inside
  the page instead of widening it.

## 0.2.56

- A light split into parts can still be played as one: its own track (marked *All parts*) runs effects
  across all the parts joined end to end, skipping unused segments. A clip on a part's own track takes
  over on that part while it plays, so you can run one effect up, across and down your pillars and still
  give one pillar its own moment.
- **House** tab: hide a light on the photo with 👁 to get at a light traced underneath it. It only hides it
  there, not in the House panel or the show.

## 0.2.55

- Reorder lights on the **Devices** tab: drag a light by its ⠿ handle or use ↑ and ↓. Every show's
  timeline, the preview and the House tab follow the new order, with a split light's parts kept under it.

## 0.2.54

- Split a light into parts on the **Devices** tab, like an xLights submodel: **Split into parts…**, then
  set each part's first and last segment (for example *Front roof* 3–23, *Side* 24–40). Each part gets
  its own track, preview row and House view stretch, and segments in no part stay off during a show.

## 0.2.53

- The selection on the **Music** tab is much easier to see: the selected waveform turns green, everything
  outside it is dimmed, and its edges are solid lines with grips across the ruler.

## 0.2.52

- Easier shortening on the **Music** tab. Once a song is detected, selection edges snap to bars (or beats);
  hold Shift to place them freely. Click a section in the lane to select exactly its stretch of song, and
  Shift-click to add more, then **Cut selection**. **Preview cut** plays the few seconds either side of the
  join before you commit.
- Beats, bars and sections now follow your cuts and splices instead of disappearing, so you can keep
  snapping, and saving keeps them (with your section names, colours and notes) rather than detecting again.

## 0.2.51

- **Generate** can be made by the AI: pick **AI** under **Made by** and it makes the whole show in your
  colours and style, following the notes on the song's sections from the Music tab.

## 0.2.50

- Section **Notes** on the Music tab: a line about what happens in that part of the music, or how you'd
  like it lit ("bells only, very gentle", "big drop, everything flashes"). Saved with the song, carried into
  shows with its sections, and passed to the AI by **Describe it**, which is told to follow them.

## 0.2.49

- Edit a song's sections on the **Music** tab. A new lane above the waveform shows each section in its
  colour; click one to rename it, pick its colour (every section with that name changes), split it at the
  playhead, merge it with the next or delete it, and drag the line between two sections to move it.
  Changes save with the song, and the editor's timeline uses the colours you pick.

## 0.2.48

- On the **Music** tab the beat lane is now above the waveform, and each beat's orange line runs down
  through it (stronger at the start of a bar), as in the editor.

## 0.2.47

- The **Music** tab's waveform now looks like the editor's: sections as the same coloured, named bands
  (easy to see in dark mode too) and beats in a lane underneath, with each bar's first beat stronger.

## 0.2.46

- **✨ Make presets** on the Presets tab: describe a look ("slow icy shimmer", "warm fire flicker")
  and the AI suggests up to three presets with live previews. **Keep** the ones you like.

## 0.2.45

- **Detect** on the **Music** tab: finds a song's tempo, beats, bars and sections, draws them over the
  waveform and keeps them with the song file. Saving an edit detects the new file straight away.
- Picking a song in the editor brings in its saved beats and sections (asking first if the show already
  has some), and **From song** in the Beats panel re-imports them. Detect in the editor saves to the song
  too. Results are dropped if the file is replaced.

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
