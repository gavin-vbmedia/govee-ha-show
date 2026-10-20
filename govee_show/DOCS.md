# Govee Light Show

Build music-synchronised light shows for Govee lights, preview them on a photo of your house, and
play them from Home Assistant. Open **Light Shows** from the Home Assistant sidebar.

**Contents:** [Requirements](#requirements) · [Quick start](#quick-start) ·
[Devices](#1-devices) · [Speakers](#2-speakers) · [Your house](#3-your-house) ·
[Build a show](#4-build-a-show) · [Effects](#effects) · [Play it](#5-play-it) ·
[Automations](#6-automations) · [Arrange the editor](#arrange-the-editor) ·
[Settings](#settings) · [Govee scenes](#experimental-govee-scenes) ·
[Troubleshooting](#troubleshooting) · [Where things are stored](#where-things-are-stored)

## Requirements

- Home Assistant OS or Supervised (anything with **Settings → Add-ons**).
- Govee lights with **LAN Control** switched on in the Govee Home app, on the same network as
  Home Assistant, with multicast allowed. The model needs Govee's per-segment realtime mode (the
  Devices tab tells you whether a model is known to have it).
- Optional: a Home Assistant media player for the music. Without one, songs play in your browser
  while you edit, and shows started from automations play the lights only.
- Optional: the Mosquitto broker add-on and MQTT integration, for show entities in automations.

## Quick start

1. **Devices** tab: **Scan network**, **Add** each light, then press **Find** or **Test** to set
   its segment count.
2. **Speakers** tab (optional): **Test and add** your speaker and pick it as the default show
   speaker.
3. **House** tab (optional): upload a photo of your house and trace each light on it.
4. **Editor** tab: pick or upload a song, drag across a light's track and pick an effect. Press
   Space to play.
5. Run it from an automation with the MQTT **Play** button or the `hassio.addon_stdin` action.

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

**Setting the segment count.** Press **Test**: a rainbow runs along the light with a white dot
stepping from segment to segment. Set **Segments** so the dot visits every segment once per lap,
and tick **Reverse** if it runs the wrong way. If the light is still on its reel, press **Find**
next to **Segments** instead: it lights one segment and asks whether anything is lit. Each answer
halves the possible range, so after about 7 answers the count is filled in. Set **Reverse** later,
once the light is hung up.

**Test only turns the light on?** Lights accept different forms of the realtime command. Change
**Protocol** and press **Test** again:

| Protocol | When to use it |
| --- | --- |
| Realtime | The default, the same packets OpenRGB sends. Works for most strips and outdoor lights. |
| Realtime (Razer) | The fixed-size packet Razer Chroma sends. Try it next. |
| Realtime v2 | The newer DreamView form some recent lights use. |
| Whole light only | For lights with no realtime mode. The whole light shows the average colour of its segments, at up to 10 changes a second, and each change fades a little. |

**Lights not delivered yet?** Pick the model (for example `H7093`), give it a name and press **Add
planned light**, then build shows with it straight away. The model list comes from Govee's product
data: **✓ realtime** means Govee lists the model as supporting per-segment realtime control, which
this add-on needs, and **⚠ unverified** means it isn't on that list (some still work, but test one
before buying more). Segment counts aren't published, so 15 is a guess until you test the real
light. Planned lights appear in the previews but nothing is sent to them. When the light arrives,
press **Scan network** and choose **Link to** next to it, or type its IP into the planned light's
row. Its shows carry over, and if the real segment count differs, just change it: effects scale
to any number of segments.

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

**Parts you can't see.** If eaves carry on round the back of the house, or an extension lead runs
from the plug to the first bulb, trace past that part anyway (a short line is fine). Then click
that stretch of the line, choose **Out of view** and enter how many bulbs are on it (0 for an
extension lead). It's drawn dashed on the House tab and left out of the House panel. Its bulbs still
take their share of the segments, so the bulbs you can see show the right part of each effect, and
the real light plays the whole show as usual.

Each light has a **Style**:

| Style | For | How to set it up |
| --- | --- | --- |
| Line | Strips, string lights, eaves lights | Trace along it, as above. |
| Icicle | Icicle lights | Trace the line the icicles hang from, then set **Drops** to how many drops it has and **Length** to how far the longest one hangs on the photo. The drops are staggered, each in its segment's colour, with the light's **Bulbs** shared between them. |
| Spots | Spotlights such as the H7093 | Press **Trace** and click where each spotlight sits, starting nearest the plug. Each one shines a soft wash of colour; drag its round handle to aim it, and use **Beam** for how wide the beams are. A spot covering several segments shows them blended. |

## 4. Build a show

**Shows.** Pick a show in the Show panel, or **＋ New show** to start one. Type in the name box to
rename it, and **Delete** removes it.

**Songs.** Pick a song from your Home Assistant **media** folder, or **Upload** one (MP3, M4A, AAC,
OGG, Opus, WAV, FLAC or WebM). Uploads go to `/media/govee_show/` so media players can play them.
For a lights-only show, choose no song and set its **Length**.

**Beats.** Press **B** (or **Tap beat**) in time with the music while it plays, type a **BPM** and
press **Fill** to add beats from the playhead, or click the beat lane to add or remove one. With
**Snap** ticked, clips and selections snap to beats and to each other; hold Shift to place freely.

**The timeline.** Each light has a track, with the **House** lane at the top. Scroll with the mouse
wheel; zoom with the **−** and **+** buttons in the Timeline panel, the + and − keys, or
Ctrl+wheel (or a trackpad pinch) around the pointer. Click the ruler to move the playhead.

**Adding effects.** Drag across a light's track to select a stretch of time (drag up or down to
cover several lights; a plain click selects up to the next beat; hold **Alt** to start a selection
on top of an existing clip). The **Selection** panel shows a button for every effect, each with a
strip playing it on that light, so you can see it first. Click one to add it. To clear a stretch,
select it and press **Delete effects here** or the Delete key: effects inside it are removed and
ones crossing its edges are trimmed.

**Editing a clip.** Click a clip to select it. Drag it to move it (onto another light too), drag
its edges to resize it, and change its effect, colours and settings in the Selection panel. While a
clip is selected it loops on its own in a strip at the top of its settings, so changes show
straight away. Tick **Show on the light** to loop it on the real light too while the show is
stopped; the light goes back to normal when you click away. Every effect has a **Brightness %**
slider, so one section can glow softly and the next hit full brightness.

**Copying.** Select a clip, or click a light's name to select all its effects, press **Ctrl+C**,
click another light's name and press **Ctrl+V**. Pasted effects keep their times so the lights stay
in step; pasting onto the same light puts them at the playhead. With a light's name selected you
can also **Copy all effects to** another light or all of them, optionally replacing what they had.
Effects scale to each light's segment count. **D** duplicates the selected clip.

**Colour palettes.** An effect's settings include a **Palette** picker. Click a colour to put it in
the colour field you last clicked, or press **Apply palette** to fill them all in order. Click a
light's name to **Recolour this light** or **Recolour all lights**: each light steps through the
palette effect by effect, so the lights stay matched (backgrounds are left alone). The **Palettes**
tab lists the presets and your own: press **New palette**, or **Copy to my palettes** on a preset,
then rename it and change its colours (up to 12). Your palettes are available in every show.

**Working on one part.** Drag along the time ruler to set a **play region**, or select a stretch
and press **▶ Play this part**. Play then plays just that part, and Home goes back to its start.
Tick **Loop** to repeat it (or the whole show when there's no region), and clear the region with
its ✕. Region and Loop apply when the song plays in the browser; on a speaker the whole show plays.

**Undo.** Ctrl+Z undoes and Ctrl+Shift+Z (or Ctrl+Y) redoes, even after a change has been saved.

**Shortcuts**

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

**Saving.** **Save** stores the show and bakes every frame for playback (Play saves first if
needed). With **Auto save** ticked (the default), the show also saves itself a couple of seconds
after each change and when you switch shows; the note next to it says whether everything is saved.
A new show is saved once it has its first effect. Auto save waits while a show is playing.

**While you edit**, the Playback panel chooses where the song plays. This is kept in your browser
and never changes where the real show plays:

- **Song in this browser**: the song plays in your browser and the add-on streams the lights in
  sync. Untick **Lights** to preview in the browser only. If the lights lead or lag, adjust
  **Light offset** on the **Settings** tab.
- **Speaker: …**: the add-on starts the song on that speaker and the lights with it, and the
  playhead follows along. Line the lights up with the speaker's **Delay ms** on the Speakers tab
  (also shown on the Settings tab while that speaker is picked).

**The real show.** **Show speaker** in the Song panel is where the song plays when the show is
started from an automation or the MQTT Play button. Leave it on **Default** to use the default show
speaker from the Speakers tab, or pick a speaker for this show only. So you can design on a speaker
indoors and the real show still plays outside. With no show speaker and no default, the lights play
on their own.

## 6. Automations

**With MQTT** (the Mosquitto broker add-on and MQTT integration), the add-on creates a **Govee
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

**Without MQTT**, use the add-on's stdin:

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

Send `input: {action: stop}` to stop. The **Settings** tab shows the exact input for the open show.

## Arrange the editor

Drag any editor panel (Show, Song, Playback, Beats, Preview, House, Timeline and Selection) by its
title to move it to the top, left, middle, right or bottom, or to change its order there; a blue
bar shows where it will land. The **⋯** button in its corner does the same from a menu, with
**Earlier** and **Later** to change the order, which also works on a touch screen. Top and bottom
run the full width; left, middle and right sit side by side between them. Any panel except the
Timeline can be **Hidden**. With Selection hidden, clips can still be moved, resized, copied and
deleted on the timeline, but adding or editing effects needs it back. The layout is saved in your
browser, so each computer or phone keeps its own.

## Settings

| Section | What's there |
| --- | --- |
| Timing | **Light offset** for playing in the browser (positive values delay the lights), or the picked speaker's delay. |
| Automations | The exact `hassio.addon_stdin` input for the open show. |
| Layout | Where every editor panel sits, including hidden ones, and **Reset layout**. |
| Experimental | **Govee scenes** (below). |

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
| Effects run from the wrong end | Tick **Reverse** on the Devices tab. |
| Lights run ahead of or behind the music | In the browser, adjust **Light offset** on the Settings tab. On a speaker, adjust its **Delay ms** on the Speakers tab. |
| A speaker can't be added | The test shows Home Assistant's reason. Some integrations can't play files from the media folder; use another media player for the song. |
| A show from an automation plays no music | Set a **Show speaker** for the show, or a **Default show speaker** on the Speakers tab. |
| House lane effects do nothing | Trace the lights on the House tab first. |
| The House view looks sparse | Set **Bulbs** on the Devices tab to the real count. |

## Where things are stored

Shows, devices, palettes, the house photo and settings live in the add-on's config folder
(`/addon_configs/<slug>_govee_show/`), so they are included in Home Assistant backups. Uploaded songs
go to `/media/govee_show/` so media players can play them. The editor layout, the editing speaker
and the experimental switch are kept in each browser.

## Notes

- Lights are driven with Govee's realtime ("razer") protocol, which the Govee app's own LAN API
  doesn't document. While a show plays, the lights ignore other commands; they go back to their
  previous state when it stops.
- The add-on uses the host network for Govee discovery, but its web server only answers Home
  Assistant's ingress proxy, so the editor isn't reachable directly on your LAN.
