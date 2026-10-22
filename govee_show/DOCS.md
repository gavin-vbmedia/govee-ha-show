# 🎄 Govee Light Show

Build music-synchronised light shows for Govee lights, preview them on a photo of your house, and
play them from Home Assistant. Open **Light Shows** from the Home Assistant sidebar.

**Getting started:** [Finding your way](#finding-your-way) · [Requirements](#requirements) ·
[Quick start](#quick-start)

**Setting up:** [1. Devices](#1-devices) · [2. Speakers](#2-speakers) · [3. Your house](#3-your-house)

**Making shows:** [4. Build a show](#4-build-a-show) · [Effects](#effects) · [5. Play it](#5-play-it) ·
[6. Automations](#6-automations)

**Reference:** [Arrange the editor](#arrange-the-editor) · [Settings](#settings) ·
[Setting up the AI](#setting-up-the-ai) · [Govee scenes](#experimental-govee-scenes) ·
[Troubleshooting](#troubleshooting) · [Where things are stored](#where-things-are-stored)

## Finding your way

Four tabs run along the top:

| Tab | What's there |
| --- | --- |
| **Editor** | Where shows are made: the timeline, previews and effect settings. |
| **Music** | Where songs are cut, joined and detected. |
| **Library** | **Palettes** and **Presets**, the colours and effect settings you reuse across shows. |
| **Setup** | **Devices**, **Speakers**, **House** and **Settings**, the things you set up once. |

Library and Setup list their pages down the side (along the top on a phone), and each remembers the
page you last had open. Below, "the House tab" and so on mean that page.

## Requirements

- Home Assistant OS or Supervised (anything with **Settings → Add-ons**).
- Govee lights with **LAN Control** switched on in the Govee Home app, on the same network as
  Home Assistant, with multicast allowed. The model needs Govee's per-segment realtime mode (the
  Devices tab tells you whether a model is known to have it).
- Optional: a Home Assistant media player for the music. Without one, songs play in your browser
  while you edit, and shows started from automations play the lights only.
- Optional: the Mosquitto broker add-on and MQTT integration, for show entities in automations.

## Quick start

1. **Setup → Devices**: **Scan network**, **Add** each light, then press **Find** or **Test** to set
   its segment count.
2. **Setup → Speakers** (optional): **Test and add** your speaker and pick it as the default show
   speaker.
3. **Setup → House** (optional): upload a photo of your house and trace each light on it.
4. **Editor** tab: pick or upload a song, drag across a light's track, press **＋ Add effect…** and pick one. Press
   Space to play.
5. Run it from an automation with the MQTT **Play** button or the `hassio.addon_stdin` action.

> **Tip:** lights not here yet? Add them as [planned lights](#lights-not-delivered-yet) and start
> designing now. Once a song is picked, **✨ Generate** in the Show panel makes a whole first draft
> to build on.

## 1. Devices

On the **Devices** tab press **Scan network**, then **Add** each light it finds. If a light doesn't
show up, type its IP address and add it by hand. Each light has a row of settings:

| Setting | What it does |
| --- | --- |
| Name | How the light is labelled in the editor and on the House tab. |
| Segments | How many separately controllable sections it has. Govee doesn't report this, so set it with **Find** or **Test** (below). Most strips and outdoor lights have 10 to 15. |
| Bulbs | The real number of bulbs, so the House view draws each one. Leave blank to draw 4 per segment. |
| Brightness % | Caps the light in every show, handy when one string is much brighter than the rest. It applies straight away, to previews too, without re-saving shows. |
| Reverse | Tick it if effects run from the wrong end. |
| Blend | Asks the light to blend smoothly between neighbouring segments. |
| Protocol | How colours are sent (see below). |

### Putting lights in order

Drag a light by its ⠿ handle, or use its ↑ and ↓ buttons. Every
show's timeline, the editor's preview and the House tab list lights in this order, with a split
light's parts kept together under it.

### Setting the segment count

Press **Test**: a rainbow runs along the light with a white dot
stepping from segment to segment. Set **Segments** so the dot visits every segment once per lap,
and tick **Reverse** if it runs the wrong way. If the light is still on its reel, press **Find**
next to **Segments** instead: it lights one segment and asks whether anything is lit. Each answer
halves the possible range, so after about 7 answers the count is filled in. Set **Reverse** later,
once the light is hung up.

While the test is running you can change **Segments**, **Reverse** or **Protocol** and the light
picks up the change straight away, so you don't need to press **Test** again after each one.

### Test only turns the light on?

Lights accept different forms of the realtime command. Change
**Protocol** and press **Test** again:

| Protocol | When to use it |
| --- | --- |
| Realtime | The default, the same packets OpenRGB sends. Works for most strips and outdoor lights. |
| Realtime (Razer) | The fixed-size packet Razer Chroma sends. Try it next. |
| Realtime v2 | The newer DreamView form some recent lights use. |
| Whole light only | For lights with no realtime mode. The whole light shows the average colour of its segments, at up to 10 changes a second, and each change fades a little. |
| Per bulb (experimental) | For lights whose app has **Finger sketch**, such as the Christmas String Lights 2 and the icicle lights, when their realtime mode doesn't reach every bulb. Sends a picture with a colour for every bulb, as Finger sketch does, so set **Segments** to the number of bulbs (300 on the 30 m Christmas String Lights 2). How fast it changes depends on the picture: about 6 times a second when most of the light is one colour (fades, flashes, a few bulbs moving over a background), down to about once or twice a second when every bulb is different (a rainbow). Similar colours are merged when a picture has a lot of them. **Find** doesn't work with it. |
| App segments (experimental) | For lights whose realtime mode doesn't reach every bulb. Colours the light the way the Govee Home app does, in the app's own segments, so set **Segments** to the number the app shows. It sends a few segments at a time, the biggest changes first, so the light keeps up rather than lagging behind; slow looks suit it better than fast chases. **Find** doesn't work with it. |

### Lights not delivered yet?

Pick the model (for example `H7093`), give it a name and press **Add
planned light**, then build shows with it straight away. The model list comes from Govee's product
data: **✓ realtime** means the model is known to support per-segment realtime control, which this
add-on needs, and **? untested** means it isn't known yet. Govee's list is out of date for its newer
lights, many of which work anyway (the Permanent Outdoor Lights Pro does), so test one before buying
more. **⚠ limited** marks a model that has been tested and only partly works; point
at the badge to see what it can do. Segment counts aren't published, so 15 is a guess until you test the real
light. Planned lights appear in the previews but nothing is sent to them. When the light arrives,
press **Scan network** and choose **Link to** next to it, or type its IP into the planned light's
row. Its shows carry over, and if the real segment count differs, just change it: effects scale
to any number of segments.

### Splitting a light into parts

A long light can run where you only want part of it in the show,
or you may want different effects on different stretches, like a roof line that goes round the
whole house. Press **Split into parts…** under the light's row. The first part covers every
segment; set its first and last segment, then press **+ Add part** for the next stretch (it starts
just after the last part). For example, a 60-segment Permanent Outdoor Pro could be **Front roof**
3–23, **Side** 24–40 and **Back** 41–60. Segments are counted the way effects run, so with
**Reverse** ticked segment 1 is the far end. Parts are listed one per line, each with its colour,
and the bar above them maps the light's segments: each part in its colour, unused ones grey.

To check where a part really is, press **Test** on its line: the real light shows just that part,
in its colour, with its first segment white, for a minute. Change its first or last segment while
it's lit and the light follows, so you can nudge it until it starts and ends in the right place.
**Test parts** lights every part the same way, with unused segments off, and **Stop** lets the light
go.

Each part gets its own track in the editor (named like *Roof · Front roof*), its own preview row,
and works with Copy and Recolour like any other light. **Segments in no part stay off during a
show**: the row lists them as *Unused, off in shows*. Parts can't overlap, and making the light
shorter trims them. Remove a part with ✕; its effects stay in your shows.

### The whole light as one

Unless you untick **Also play as one** under the parts, the light
keeps its own track too, marked *All parts*. Effects on it
run across all its parts joined end to end, as if the unused segments weren't there. A 30 m string
that goes up the left pillar, across the top and down the right pillar could be split into *Left*,
*Top* and *Right*: a chase on the light's own track then runs up, across and down in one go. While
a clip is playing on a part's own track, that part shows its clip instead, so you can run one
effect over the whole string and drop a different one on just the left pillar. **Generate** puts
effects on the parts and leaves the light's own track for you. Untick **Also play as one** for a
light you only ever use in parts, like a roof line where only the front 30 segments are seen: its
own track goes away (or, if it has effects on it, is marked *Not played: parts only*).

On the timeline a split light's tracks (when there's more than one) are grouped: a coloured bar runs down the left of the light
and its parts, the parts are indented under it, and a heavier line marks where the group starts and
ends.

## 2. Speakers

The song can play on any Home Assistant media player that can play files from the media folder.
Speakers are added on the **Speakers** tab first, and only those are offered in the editor.

- Press **Test and add** next to a media player. The add-on plays a short chime on it the same way
  a show starts and only adds it if that works. Media players that can't be sent a song are listed
  but can't be added, and a failed test shows Home Assistant's reason. Echo devices through Alexa
  Media Player and Emby clients, for example, often can't play files from the media folder.
- **Delay ms** is how late the speaker really starts after it reports playing. Raise it if the
  lights run ahead of the music (often 100 to 500 ms for Wi-Fi speakers).
- **Default show speaker** is where shows play when started from an automation, unless a show picks
  its own (see [Play it](#5-play-it)).

## 3. Your house

The **House** tab puts your lights on a photo of your house. The editor's **House** panel then plays
the show on it, so you can design without standing outside, and the **House** lane uses it for
effects that sweep across the whole house.

### Tracing a light

1. Take a photo from where people will watch, ideally at dusk, and press **Upload photo**. It's
   scaled to 2000 pixels across and kept in the add-on's config folder. **Darken** dims it so the
   lights stand out.
2. Pick a light in the list beside the photo, press **Trace** and click along where it runs,
   **starting at the end with the plug**. Click once at each corner or bend. The light's bulbs
   (its **Bulbs** count, or 4 per segment) are spread evenly along the line.
3. Press **Done** (or Enter). Drag a point to move it, right-click a point to remove it, and press
   Backspace while tracing to undo the last point. **Retrace** starts again and **Clear** removes
   the light from the photo.

While a light is picked, it's drawn in a rainbow from red at the plug to the far end, so you can
check it runs the same way as the real light. If it's backwards, retrace it from the other end, or
tick **Reverse** on the Devices tab if the effects themselves run the wrong way. Each light's
**Brightness %** applies here as well. Click a light in the list, or its line on the photo, to pick
it; Esc lets go.

A light split into parts is drawn with each part in its colour (the same colours as on the Devices
tab) and its unused segments as faint, unlit bulbs. The picked light shows segment numbers along it
(1, every 5th, and where each part starts and ends) and each part's name. Hover over any bulb to see
which light, segment and part it belongs to.

### Light styles

Each light has a **Style**:

| Style | For | How to set it up |
| --- | --- | --- |
| Line | Strips, string lights, eaves lights | Trace along it, as above. |
| Icicle | Icicle lights | Trace the line the icicles hang from, then set **Drops** to how many drops it has and **Length** to how far the longest one hangs on the photo. The drops are staggered, each in its segment's colour, with the light's **Bulbs** shared between them. |
| Spots | Spotlights such as the H7093 | Press **Trace** and click where each spotlight sits, starting nearest the plug. Each one shines a soft wash of colour; drag its round handle to aim it, and use **Beam** for how wide the beams are. A spot covering several segments shows them blended. |

### Photo taken at an angle

Bulbs are spread evenly along the line, but on a photo taken from the
side the far end of a light looks squashed, so the bulbs don't sit on the real ones. Pick the light,
then drag one of its segment numbers along the line to where that segment really is: it's pinned
there (amber), and the bulbs between pins and the ends are spread evenly between them. Pin a few
along a long light. Not sure where a segment is? Click its number and press **Light it** to light
just that segment white on the real light (**Stop** lets it go). Right-click a pinned number, or
press **Unpin**, to let it go; **Unpin all** clears a light's pins. Pins are used by the House panel
and the House lane too, and **Retrace** or **Clear** removes them.

### Lights on top of each other

When two traced lights overlap, press 👁 on the one in front to
hide it on the photo, so you can click and drag the one underneath. It stays hidden (🙈) on this
browser until you press it again. Hiding only affects the House tab's photo: the light still shows
in the editor's House panel and plays in shows.

### Parts you can't see

If eaves carry on round the back of the house, or an extension lead runs
from the plug to the first bulb, trace past that part anyway (a short line is fine). Then click
that stretch of the line, choose **Out of view** and enter how many bulbs are on it (0 for an
extension lead). It's drawn dashed on the House tab and left out of the House panel. Its bulbs still
take their share of the segments, so the bulbs you can see show the right part of each effect, and
the real light plays the whole show as usual.

### Lights split into parts

A light split into parts (see **Devices**) is listed as its parts, each
under the light's name with its colour, and you trace each part on its own, starting at the end of
the part nearest the light's plug. That suits a light whose parts aren't joined up on the photo,
like a string that runs up one pillar, across and down the other. A light you traced whole before
splitting it keeps its one line and has a **Split trace into parts** button: it cuts the line where
each part starts and ends, so you can then move each part's points on their own.

## 4. Build a show

A show is a song plus effects on each light's track. The usual path is: pick a song, **Detect** its
beats and sections, then **Generate** a draft or **Describe it**, and fine-tune clips on the
timeline.

- **The song:** [Shows](#shows) · [Songs](#songs) · [Editing a song](#editing-a-song) ·
  [Detecting](#detecting-on-the-music-tab) · [Sections](#editing-sections) · [Beats](#beats)
- **Let it help:** [Suggestions](#suggestions) · [Describe it](#describe-it) · [Generate](#generate)
- **By hand:** [The timeline](#the-timeline) · [Adding effects](#adding-effects) ·
  [Editing a clip](#editing-a-clip) · [Presets](#presets) · [Your own presets](#your-own-presets) ·
  [Copying](#copying) · [Colour palettes](#colour-palettes)
- **Odds and ends:** [Lights that are gone](#lights-that-are-gone) · [Working on one part](#working-on-one-part) ·
  [Undo](#undo) · [Shortcuts](#shortcuts)

### Shows

Pick a show in the Show panel, or **＋ New show** to start one. **⚙ Settings…** beside it
opens the show's settings: its **Name**, its **Show speaker** (below), **Auto save**, and **Delete
show…** to remove it.

### Songs

The Song panel shows the show's song with its length, tempo and sections. Press
**Change…** to pick another from your Home Assistant **media** folder, or **Upload a song…** (MP3,
M4A, AAC, OGG, Opus, WAV, FLAC or WebM). Uploads go to `/media/govee_show/` so media players can play
them. For a lights-only show, choose **No song** and set its **Length**.

### Editing a song

The **Music** tab cuts, shortens and splices songs before you build a show. Pick a
song (or **Upload** one), drag across the waveform to select, then **Cut selection** to remove it or
**Keep only selection** to shorten the song to it. **Insert at playhead** and **Add to end** splice in
another song, which is then selected so you can trim it. Joins blend over the **Crossfade at joins**
time (a few hundredths of a second hides the click, a few seconds blends one song into the next), and
**Fade in** and **Fade out** soften the ends. Zoom with the wheel, or type the selection's times for
precision. **Save as new file** writes a WAV to `/media/govee_show/` and leaves the original alone, so
pick the new file under **Song** in the editor. Once the song is detected, selection edges snap to bars
(hold Shift to place them freely), clicking a section in the lane selects exactly its stretch (Shift-click
adds the next), and **Preview cut** plays the join before you cut. Beats and sections follow your edits
and are kept when you save. Edit the song before placing clips, because cutting it
afterwards won't move them.

### Detecting on the Music tab

**Detect on the Music tab** finds a song's beats, bars and sections and keeps them with the song file,
drawn over its waveform; a saved edit is detected straight after saving. When a show picks that song
under **Song**, it takes them automatically (asking first if the show already has beats), and **From
song** in the Beats panel brings them back later. Detect in the editor also saves its results with the
song. Each show keeps its own copy, so moving beats in one show doesn't change the song or other shows.

### Editing sections

On the Music tab, the lane above the waveform shows each section in its colour.
Click one to rename it or pick its colour (every section with the same name changes colour together),
**Split at playhead**, **Merge with next** or **Delete** it, and drag the line between two sections to
move it. Changes save with the song; a show that already uses the song picks them up with **From song**.
Give a section **Notes** to tell **Describe it** what happens there or how you'd like it lit, such as
"bells only, very gentle" or "big drop at the end, everything flashes"; the AI follows them.

### Beats

Press **Detect** to have the editor listen to the song and find its tempo, every beat,
where each bar starts (drawn as stronger markers) and its sections, which show as tinted, named bands
behind the waveform (Intro, Verse, Chorus, Bridge, Outro). It runs in your browser in a few seconds,
with nothing sent anywhere. Detection reads songs as 4/4 and prefers a lively tempo, so a slow ballad
may come out at double time; type the BPM you want and press **Fill** if so. You can also press **B**
(or **Tap beat**) in time with the music while it plays, type a **BPM** and press **Fill** to add beats
from the playhead, or click the beat lane to add or remove one. **Clear** removes the beats and
sections. With **Snap** ticked, clips and selections snap to beats and to each other; hold Shift to
place freely.

### Suggestions

Once the song has been analysed, **＋ Add effect…** on a selection starts with looks
suggested for that part of the song: soft ones for a quiet verse, fast ones that move on the beat for
a loud chorus, with speeds set from the tempo and colours from the palette picked in the palette bar.

### Describe it

Type what you'd like in the **Describe it** panel and press **✨ Create**, for example
"red and green chase on the roof in every chorus, gentle white twinkle on the tree the rest of the time"
or "strobe everything on the last four bars". An AI turns it into effects on the lights you name, lined
up with the beats and sections, and they replace what those lights had at those times. If you select a
stretch first and the request doesn't say where or when, it works on the selection. Anything the AI gets
wrong (a light or effect that doesn't exist) is left out and listed in the status bar, and Ctrl+Z undoes
the lot. It needs an AI to be set up first; see [Setting up the AI](#setting-up-the-ai).

### Generate

**✨ Generate** in the Show panel makes a first draft of the whole show from the song.
Pick the **Colours** (any palette) and a **Style** (Calm, Balanced or Lively), and it fills every light
with effects that follow the song: soft, slow looks in quiet parts, faster ones that move on the beat
as it gets louder, every light moving together in the chorus, the same looks each time a section comes
back, and a change every few bars. Quiet starts and ends fade in and out, and with lights traced on the
house photo it can add a sweep across the house as the music lifts. It runs **Detect** first if the song
hasn't been analysed. It replaces the lights' effects, so Ctrl+Z brings them back; press it again for a
different take, then edit whatever you like. The colours start on the palette for the time of year
(Halloween in October, Christmas in December…) when there is one.

With an AI set up (see [Setting up the AI](#setting-up-the-ai)), **Made by** picks who makes it:
**Rules** is instant, as above; **AI** sends the whole song to the AI with the same colours and style,
and it follows the **notes** you've written on the song's sections on the **Music** tab ("the guitar
solo, make it flash", "keep this bit dark"). It takes 10 to 60 seconds, shown in the Describe it panel.

### The timeline

Each light has a track, with the **House** lane at the top. Scroll with the mouse
wheel; zoom with the **−** and **+** buttons in the Timeline panel, the + and − keys, or
Ctrl+wheel (or a trackpad pinch) around the pointer. Click the ruler to move the playhead.

### Adding effects

Drag across a light's track to select a stretch of time (drag up or down to
cover several lights; a plain click selects up to the next beat; hold **Alt** to start a selection
on top of an existing clip). Press **＋ Add effect…** in the Selection panel to open the effect
chooser: a button for every effect, each with a strip playing it on that light for the selection's
length, so you can see it first. Click one to add it (Esc or ✕ closes it without adding). The last
effect you added also gets an **Add … again** button, for laying down a run of the same thing. With
the House lane and lights selected together, the chooser has a section for each. To clear a stretch,
select it and press **Delete effects here** or the Delete key: effects inside it are removed and
ones crossing its edges are trimmed.

### Editing a clip

Click a clip to select it. Drag it to move it (onto another light too), drag
its edges to resize it, and change its effect, colours and settings in the Selection panel. While a
clip is selected it loops on its own in a strip at the top of its settings, so changes show
straight away. To swap the effect, press the **Effect** button: it opens the same effect
chooser used to add one, playing on that light for the clip's length, with the current effect
outlined. Changing effect keeps the clip's colours and brightness.

### Presets

Most effects can look very different depending on their settings (Three colours can sit
still, alternate, or run as a slow or fast marquee). Tick **Show presets** in the effect chooser and
each effect becomes its own boxed group: **Default** first, then its presets, each previewed. Picking
a preset sets just the settings it names. When adding an effect it uses the effect's default colours;
when changing a clip your colours stay. The Effect button shows the preset a clip matches, such as
**Three colours · Wide marquee**. The chooser remembers whether presets were showing.

### Your own presets

Get a clip looking right, then press **Save as preset…** under its settings.
Name it and choose whether to **Include colours** (ticked by default; untick it to save just the
movement and other settings, so the preset takes on whatever colours a clip already has). Your
presets appear in the effect chooser after the built-in ones, marked with a ★, and **★ My presets
only** narrows the chooser to them.

### The Presets tab

The **Presets** tab is the preset editor. Your presets are listed by effect on the left, each with a
small preview; pick one to edit it on the right, where a large preview plays it (choose which light's
segments with **Preview on**). Rename it, change its **Effect** (or start again from one of that
effect's presets), tick or untick **Include colours**, and change its colours (palettes work here
too), settings and brightness; the previews follow every change and it saves by itself.
**Duplicate** makes a copy to try variations, and **Delete preset** removes it. **New preset**
starts one from scratch: pick an effect, or any built-in preset, to start from. Or describe a look in
the box above, such as "slow icy shimmer" or "warm fire flicker", and press **✨ Make presets**: the AI
suggests up to three, each with a live preview, and **Keep** adds one to your presets (it needs an AI
set up, as for **Describe it**). Changing or deleting
a preset doesn't change clips that already used it. They're saved in the add-on, so every browser
sees the same ones.

Tick **Show on the light** to loop it on the real light too while the show is
stopped; the light goes back to normal when you click away. Every effect has a **Brightness %**
slider, so one section can glow softly and the next hit full brightness.

### Copying

Select a clip, or click a light's name to select all its effects, press **Ctrl+C**,
click another light's name and press **Ctrl+V**. Pasted effects keep their times so the lights stay
in step; pasting onto the same light puts them at the playhead. With a light's name selected you
can also **Copy all effects to** another light or all of them, optionally replacing what they had.
Effects scale to each light's segment count. **D** duplicates the selected clip.

### Colour palettes

An effect's settings include a **Palette** picker. Click a colour to put it in
the colour field you last clicked, or press **Apply palette** to fill them all in order. Click a
light's name to **Recolour this light** or **Recolour all lights**: each light steps through the
palette effect by effect, so the lights stay matched (backgrounds are left alone). **Library →
Palettes** lists the built-in palettes and your own: press **New palette**, or **Copy** on a built-in one,
then rename it and change its colours (up to 12). Your palettes are available in every show.

### Lights that are gone

A track whose light was removed from the Devices tab shows as **Missing
device**, and isn't played. Click its name and press **Remove from show** to take it out with its
effects (Ctrl+Z brings it back), or **Remove all unplayed tracks** when there are several.

### Working on one part

Drag along the time ruler to set a **play region**, or select a stretch
and press **▶ Play this part**. Play then plays just that part, and Home goes back to its start.
Tick **Loop** to repeat it (or the whole show when there's no region), and clear the region with
its ✕. Region and Loop apply when the song plays in the browser; on a speaker the whole show plays.

### Undo

Ctrl+Z undoes and Ctrl+Shift+Z (or Ctrl+Y) redoes, even after a change has been saved.

### Shortcuts

| Key | Does |
| --- | --- |
| Space | Play or pause |
| Home | Back to the start (of the play region, if there is one) |
| B | Add a beat at the playhead |
| Delete or Backspace | Delete the selected clip, or clear the selected stretch |
| D | Duplicate the selected clip |
| Esc | Deselect |
| Ctrl+C / Ctrl+V | Copy and paste effects |
| Ctrl+Z / Ctrl+Shift+Z | Undo and redo |
| Ctrl+S | Save |
| + / − | Zoom the timeline in and out |
| Ctrl+wheel | Zoom round the pointer |
| Shift while dragging | Place without snapping |
| Alt while dragging | Start a selection on top of a clip |

## Effects

**Effects on a light** run along that light, from the plug end (or the other end with
**Reverse**):

| Effect | What it does |
| --- | --- |
| Solid | One colour |
| Two colours, Three colours | Solid colours side by side. **Split** divides the light into halves or thirds; **Alternate** repeats them along it, **Segments per colour** wide. **Move** slides them along like marquee lights (negative numbers go the other way). |
| Pulse | Breathes between a colour and the background |
| Gradient | Blends two or three colours along the light; **Move** slides it back and forth |
| Colour cycle | The whole light changes through two to four colours, fading or stepping |
| Fade | Fades from one colour to another over the clip; fade to a darker colour for a gentle dim |
| Chase | A block of colour running along the light |
| Rainbow | A moving rainbow |
| Comet | A bright head with a fading tail running along the light |
| Scanner | A dot bouncing from end to end |
| Flicker | Candle or fire flicker between two colours |
| Lightning | Random bright flashes over a dark background |
| Strobe | Flashes on and off |
| Twinkle | Segments sparkle at random |
| Wipe | Fills the light with colour over the clip |

**Effects on the House lane** run across all your lights at once, by where each one is on the
house photo, like xLights' model effects. Add them the same way, by selecting a stretch of the
House lane. They sit on top of each light's own effects.

| Effect | What it does |
| --- | --- |
| Sweep | A band of colour crossing the house. Set its **Width** and how many **Sweeps** fit in the clip. |
| House wipe | Fills the house with a colour over the clip, with a **Soft edge**. |
| Rainbow wave | A rainbow across the house; set how many fit across it and how fast it moves. |

- **Direction** can be left to right, right to left, top to bottom, bottom to top, out from the
  centre or in to the centre.
- **Elsewhere** decides what lights outside the band show: the **Background** colour, or their own
  effects.
- Only lights traced on the House tab take part, and bulbs marked out of view are left alone.
- Positions are worked out when the show is saved. Playing from the editor picks up any retracing
  by itself, but a show started from an automation needs saving again after you retrace a light
  (any edit with Auto save on does it).

## 5. Play it

### Saving

**Save** stores the show and bakes every frame for playback (Play saves first if
needed). With **Auto save** ticked in the show's settings (the default), the show also saves itself a couple of seconds
after each change and when you switch shows; the note next to it says whether everything is saved.
A new show is saved once it has its first effect. Auto save waits while a show is playing.

### While you edit

The Playback panel chooses where the song plays. This is kept in your browser
and never changes where the real show plays:

- **Song in this browser**: the song plays in your browser and the add-on streams the lights in
  sync. Untick **Lights** to preview in the browser only. If the lights lead or lag, adjust
  **Light offset** under **Setup → Speakers**.
- **Speaker: …**: the add-on starts the song on that speaker and the lights with it, and the
  playhead follows along. Line the lights up with the speaker's **Delay ms** under **Setup →
  Speakers** (also shown under Timing there while that speaker is picked).

### The real show

**Show speaker** in the show's **⚙ Settings…** (Show panel) is where the song plays when the show is
started from an automation or the MQTT Play button. Leave it on **Default** to use the default show
speaker from the Speakers tab, or pick a speaker for this show only. So you can design on a speaker
indoors and the real show still plays outside. With no show speaker and no default, the lights play
on their own.

## 6. Automations

### With MQTT

With the Mosquitto broker add-on and MQTT integration set up, the add-on creates a **Govee
Light Show** device with a **Show** select, **Play** and **Stop** buttons, and a **Status** sensor
(the playing show's name, or `idle`). For example, to play a show at sunset:

```yaml
triggers:
  - trigger: sun
    event: sunset
actions:
  - action: select.select_option
    target:
      entity_id: select.govee_light_show_show
    data:
      option: Halloween
  - action: button.press
    target:
      entity_id: button.govee_light_show_play
```

You can also publish a show's name or id to the `govee_show/play` MQTT topic.

### Without MQTT

Without MQTT, use the add-on's stdin:

```yaml
actions:
  - action: hassio.addon_stdin
    data:
      addon: <slug>_govee_show   # pick Govee Light Show in the UI editor
      input:
        action: play
        show: Halloween
        media_player: media_player.garden   # optional; defaults to the show speaker
```

Send `input: {action: stop}` to stop. **Setup → Speakers** shows the exact input for the open show, under Automations.

## Arrange the editor

Drag any editor panel (Show, Song, Playback, Beats, Describe it, Preview, House, Timeline and Selection) by its
title to move it to the top, left, middle, right or bottom, or to change its order there; a blue
bar shows where it will land. The **⋯** button in its corner does the same from a menu: it shows a
small picture of the page, so click the area you want the panel in. **Earlier** and **Later**
change its order, which also works on a touch screen. Any panel except the Timeline can be
**Hidden**. To keep a panel to hand but out of the way, press the **▾** before its name to
collapse it to its title, and **▸** to open it again.

The **page layout** sets how those five areas fit together. Pick it at the bottom of any panel's
**⋯** menu or under **Settings → Layout**:

| Page layout | Arrangement |
| --- | --- |
| Classic | Top and bottom run the full width; left, middle and right sit side by side between them. |
| Side columns | Left and right run the full height of the page, with top, middle and bottom stacked between them. |
| Right column | Right runs the full height; top and bottom span the left and middle. Handy for keeping Selection beside everything. |

Out of the box the Show and Playback panels run along the top, Song, Preview, House and Beats sit
down the left, Selection and Describe it down the right, and the Timeline takes the middle, so the
timeline and the selected clip are on screen together. **Reset layout** goes back to this. While the
top area is short enough, it stays in view as you scroll, so **Play** is always to hand.

An area with no panels in it takes no space. On a narrow screen every area stacks in one column. With Selection hidden, clips can still be moved, resized, copied and
deleted on the timeline, but adding or editing effects needs it back. The layout is saved in your
browser, so each computer or phone keeps its own.

## Settings

**Setup → Settings** holds the rest. Timing and Automations sit with the speakers, under **Setup →
Speakers**: **Light offset** for playing in the browser (positive values delay the lights), or the
picked speaker's delay, and the exact `hassio.addon_stdin` input for the open show.

| Section | What's there |
| --- | --- |
| AI | Which AI **Describe it** uses, or how to set one up (below). |
| Layout | Where every editor panel sits, including hidden ones, and **Reset layout**. |
| Experimental | **Govee scenes** (below). |
| Packet lab | Sends hand-made messages to one light, for trying out new ways of driving it (below). |
| Listen for Govee traffic | Records what your lights say to each other, to help support new ways of driving them (below). |

## Setting up the AI

**Describe it**, **✨ Make presets** and Generate's **AI** option need one of these:

- **Claude, with your own API key.** Create a key at console.anthropic.com, then in Home Assistant open
  **Settings → Add-ons → Govee Light Show → Configuration**, paste it into **Claude API key** and save.
  Each request costs a few US cents on your Anthropic account (it uses Claude Opus 5.5 at low effort).
- **Home Assistant's AI Task.** With no key, the add-on asks Home Assistant, which uses whichever AI
  integration you've set up there with an AI Task entity: Anthropic, OpenAI, Google Gemini, or a local
  model through Ollama, which keeps everything on your network. If you have several, set **AI Task
  entity** on the Configuration tab, or Home Assistant's preferred one is used. Smaller local models
  may follow the instructions less well.

The **Settings** tab shows which one is in use. The AI is sent your lights' names and segment counts,
the effect list, the song's tempo, beats and sections, your palettes, the selection and the effects
already on the lights. It's never sent the song itself.

## Packet lab

**Setup → Settings → Packet lab** is for experiments: it sends one light a message you choose and
lists anything the light sends back. You won't need it to make shows.

1. Pick the **Light** (only lights on the Devices tab with an IP address are offered).
2. Pick a starting point under **Start from**, such as **Ask for its status** or **Realtime: rainbow**,
   and set **Segments** and **Colour** for it. The message appears in the box, where you can change it.
3. Choose how many times to send it and how often. Realtime messages are sent 50 times, a tenth of a
   second apart, with **Realtime on first**, because lights drop back to their own scene within a
   moment otherwise.
4. Press **Send**. **Stop** ends it early. A playing show is stopped first.

The three types are a whole **JSON message**, a **Realtime (razer) packet** (type the command byte
and its data in hex; the header, length and checksum are added, and **Length field** overrides the
length), and an **App command (ptReal)**: one Govee app command per line, in hex.

### Reaching past the realtime window

Some lights, like the 30 m Christmas String Lights 2 (H70C5) and the icicle lights, only take
realtime colours for their first few dozen bulbs (44 on the H70C5). **Run sweep** tries nine guesses
at how the rest of the bulbs might be reached, one after another for about 45 seconds. Each guess
asks for the bulbs just past the window in its own colour. Set **Segments** to the size of the window
first, then film the whole light while it runs. A colour appearing past the window means that guess
works; the list under the button says which colour is which.

### Per bulb speed test

For lights on **Per bulb (experimental)**: **Run speed test** changes the picture for six seconds,
at the number of **Pictures a second** you pick. **First 10 bulbs** flips them between red and blue;
**Every bulb** moves a red, green and blue pattern along the whole light one bulb at a time. Set
**Segments** to the light's number of bulbs. If the light changes every time, it keeps up at that
rate; if it skips or stalls, it doesn't.

## Listen for Govee traffic

Some Govee features drive lights in more detail than the add-on can. In **Scene Stage**, for example,
one light (the sync centre) plays a picture across all the others. **Setup → Settings → Listen for
Govee traffic** helps work out how, so the add-on can learn to do the same:

1. Start Scene Stage (or whatever you want recorded) in the Govee Home app.
2. Press **Listen for 60 seconds**. Nothing is sent to your lights, and a playing show is stopped.
3. When it finishes, the table shows which lights sent what. Press **Download** and attach the file to
   an issue on the add-on's GitHub page.

If it hears nothing, the lights are talking to each other directly, where Home Assistant can't hear.

## Experimental: Govee scenes

Turn on **Settings → Experimental → Govee scenes** to add a **Govee scene** effect. Its clip hands
the light to one of the scenes built into the Govee app (the app's Scenes list, not your own saved
snapshots or DIYs) for as long as the clip lasts, then the show takes the light back.

- Pick the scene in the clip's settings. The list comes from Govee's public scene library for the
  light's model, so the light needs a model (scan for it on the Devices tab) and Home Assistant
  needs internet access the first time. The list is then cached for a week.
- It sends the light the same commands the Govee app sends over Bluetooth, through the LAN API's
  unofficial `ptReal` command. Not every light accepts it.
- The preview shows a purple shimmer where a scene runs, because the editor can't know what the
  scene looks like. The light may blink as it switches in and out of a scene.

## Troubleshooting

| Problem | Try |
| --- | --- |
| Scan finds nothing | Check **LAN Control** is on for each light in the Govee Home app, and that Home Assistant and the lights are on the same network with multicast allowed. Add the light by IP instead. |
| Test only turns the light on | Change **Protocol** on the Devices tab and test again. |
| Only the first part of a light lights up | Some lights only accept a few segments in realtime mode. The 30 m Christmas String Lights 2 (H70C5) stops at 44 bulbs. Set **Protocol** to **Per bulb (experimental)** and **Segments** to the number of bulbs (300 for the H70C5). **App segments (experimental)** and **Whole light only** also light the whole string, more coarsely. |
| Effects run from the wrong end | Tick **Reverse** on the Devices tab. |
| Lights run ahead of or behind the music | In the browser, adjust **Light offset** under **Setup → Speakers**. On a speaker, adjust its **Delay ms** in the same place. |
| A speaker can't be added | The test shows Home Assistant's reason. Some integrations can't play files from the media folder; use another media player for the song. |
| A show from an automation plays no music | Set a **Show speaker** for the show, or a **Default show speaker** on the Speakers tab. |
| House lane effects do nothing | Trace the lights on the House tab first. |
| The House view looks sparse | Set **Bulbs** on the Devices tab to the real count. |

## Where things are stored

Shows, devices, palettes, your presets, the house photo and settings live in the add-on's config folder
(`/addon_configs/<slug>_govee_show/`), so they are included in Home Assistant backups. Uploaded songs
go to `/media/govee_show/` so media players can play them. The editor layout, the editing speaker
and the experimental switch are kept in each browser.

## Notes

- Lights are driven with Govee's realtime ("razer") protocol, which the Govee app's own LAN API
  doesn't document. While a show plays, the lights ignore other commands; they go back to their
  previous state when it stops.
- The add-on uses the host network for Govee discovery, but its web server only answers Home
  Assistant's ingress proxy, so the editor isn't reachable directly on your LAN.
