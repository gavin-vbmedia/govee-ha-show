# Govee Light Show

Open **Light Shows** from the Home Assistant sidebar to build and play shows.

## Requirements

- Home Assistant OS or Supervised (anything with Settings → Add-ons).
- Optional: the Mosquitto broker add-on and MQTT integration, for show entities.
- Govee devices with **LAN Control** switched on in the Govee Home app.
- Devices on the same network as Home Assistant, with multicast allowed.

## 1. Add your devices

On the **Devices** tab press **Scan network**, then **Add** each device it finds (or add one by IP).
Govee doesn't report how many segments a device has, so press **Test**: a rainbow runs with a white
dot stepping along it. Set **Segments** so the dot visits every segment once per lap, and tick
**Reverse** if it runs the wrong way. Most strips and outdoor lights have 10 to 15 segments.

**Light still on its reel?** Press **Find** next to **Segments** instead. It lights a single
segment and asks whether you can see any light at all. A light with fewer segments has nowhere to
show it, so each answer halves the range, and after about 7 answers the count is filled in. Set
**Reverse** later, once the light is hung up and you can see which end the Test dot starts from.

**Test only turns the light on?** Lights accept different forms of the realtime command. Change
**Protocol** and press **Test** again:

| Protocol | When to use it |
| --- | --- |
| Realtime | The default, the same packets OpenRGB sends. Works for most strips and outdoor lights. |
| Realtime (Razer) | The fixed-size packet Razer Chroma sends. Try it next. |
| Realtime v2 | The newer DreamView form some recent lights use. |
| Whole light only | For lights with no realtime mode. The whole light shows the average colour of its segments, at up to 10 changes a second, and each change fades a little. |

**Lights not delivered yet?** Pick the model (e.g. `H7093`) and use **Add planned light**, then
build shows with it straight away. The model list comes from Govee's product data: **✓ realtime**
means Govee lists the model as supporting per-segment realtime control, which this add-on needs.
**⚠ unverified** means it isn't on that list; some unlisted models still work, but test one
before buying more. Govee doesn't publish realtime segment counts, so the count is a guess (15)
until you Test the real light. Planned lights show in the preview
but nothing is sent to them. When the light arrives, press **Scan network** and choose **Link to**
next to it (or type its IP into the planned light's row). The shows you built carry over. If the
real segment count differs, just change it: effects scale to any number of segments.

## 2. Build a show

- Pick a song from your Home Assistant **media** folder, or **Upload** one. You can also make a
  lights-only show and set its length.
- Add beat markers: press **B** (or **Tap beat**) in time with the music while it plays, type a
  **BPM** and press **Fill**, or click the beat lane. Clips snap to beats and to each other
  (hold Shift to place freely).
- To add an effect, drag across a light's track to select a stretch of time (drag up or down to
  cover several lights; a plain click selects up to the next beat). Then click an effect in the
  effects bar, or pick one and press **Add effect** below the timeline. To clear a stretch, select
  it and press **Delete effects here** or the Delete key: effects inside it are removed and ones
  crossing its edges are trimmed. Hold **Alt** to start a selection on top of an existing clip.
- Click a clip to edit it. Drag it to move it (including onto another device), drag its edges to
  resize, and edit colours and speed below the timeline. The preview strip shows every segment of every device as the playhead moves.
- **Two colours** and **Three colours** are solid effects with more than one colour. **Split**
  divides the light into halves or thirds; **Alternate** repeats the colours along it, with
  **Segments per colour** setting how wide each block is. Set **Move** to slide the colours along
  the light like marquee lights (negative numbers go the other way).
- The other effects:

  | Effect | What it does |
  | --- | --- |
  | Solid | One colour |
  | Pulse | Breathes between a colour and the background |
  | Gradient | Blends two or three colours along the light; **Move** makes it slide back and forth |
  | Colour cycle | The whole light changes through two to four colours, fading or stepping |
  | Fade | Fades from one colour to another over the clip |
  | Chase | A block of colour running along the light |
  | Rainbow | A moving rainbow |
  | Comet | A bright head with a fading tail running along the light |
  | Scanner | A dot bouncing from end to end |
  | Flicker | Candle or fire flicker between two colours |
  | Lightning | Random bright flashes over a dark background |
  | Strobe | Flashes on and off |
  | Twinkle | Segments sparkle at random |
  | Wipe | Fills the light with colour over the clip |
- Colour palettes: an effect's settings include a **Palette** picker. Click one of its colours to
  put it in the colour field you last clicked (or the first one), or press **Apply palette** to
  fill all of them in order. Click a light's name to **Recolour this light** or **Recolour all
  lights**: each light steps through the palette effect by effect, so lights stay matched.
  Backgrounds are left alone. The **Palettes** tab lists the presets and your own palettes: press
  **New palette**, or **Copy to my palettes** on a preset, then rename it and change its colours
  (up to 12). Your palettes are saved in the add-on and available in every show.
- Copy effects between lights: select a clip (or click a light's name to select all its effects),
  press **Ctrl+C**, click another light's name and press **Ctrl+V**. Pasted effects keep their
  times so the lights stay in step; pasting onto the same light puts them at the playhead. With a
  light selected you can also **Copy all effects to** another light or all of them, optionally
  replacing what they had. Effects scale to each light's segment count.

- To work on one part, drag along the **time ruler** at the top of the timeline to set a **play
  region** (or select a stretch and press **▶ Play this part**). Play then plays just that part,
  and Home goes back to its start. Tick **Loop** to repeat it, or the whole show when there's no
  region. Clear the region with the ✕ next to it. Region and Loop apply when the song plays in the
  browser; on a speaker the whole show plays.

Shortcuts: Space play/pause, B beat, Delete remove clip or clear the selection, Esc deselect, D duplicate, Ctrl+C / Ctrl+V copy and paste, Ctrl+Z / Ctrl+Shift+Z undo
and redo, Ctrl+S save, + and − zoom, Ctrl+scroll zoom.

## 3. Play it

**Save** stores the show and bakes every frame for playback (Play saves first if needed). With
**Auto save** ticked (the default), the show also saves itself a couple of seconds after each
change, and when you switch to another show; the note next to it says whether everything is saved.
A new show is saved automatically once it has its first effect. Auto save waits while a show is
playing, and Ctrl+Z still undoes changes after they've been saved.

Next to Play, choose where the song plays:

- **Song in this browser**: the song plays in your browser and the add-on streams the lights in
  sync with it. Untick **Lights** to preview in the browser only. If the lights lead or lag,
  adjust **Light offset** on the **Settings** tab.
- **Speaker: …** (any Home Assistant media player): the add-on starts the song on that speaker
  and the lights with it; the editor's playhead follows along. Speakers start playing a little
  after they report they have, so set **Speaker delay** on the **Settings** tab (with that speaker
  picked in Playback) for each speaker (often 100 to 500 ms
  for Wi-Fi speakers) until the lights land on the beat. The speaker you pick is saved with the
  show and is what automations use.

## 4. Schedule it with automations

**With MQTT** (if you have the Mosquitto broker add-on and MQTT integration set up), the add-on
creates a **Govee Light Show** device with a **Show** select, **Play** and **Stop** buttons and a
**Status** sensor. For example:

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

You can also publish a show's name or id to the `govee_show/play` topic.

**Without MQTT**, use the add-on's stdin:

```yaml
actions:
  - action: hassio.addon_stdin
    data:
      addon: <slug>_govee_show   # pick Govee Light Show in the UI editor
      input:
        action: play
        show: Halloween
        media_player: media_player.garden   # optional; defaults to the show's speaker
```

Send `input: {action: stop}` to stop. The exact input for the open show is shown on the
**Settings** tab. A show with no speaker plays the lights only.

## Arrange the editor

Every editor panel (Show, Song, Playback, Beats, Zoom, Preview, Effects and Selection) has a **⋯**
button in its corner: use it to move the panel to the top, left, right or bottom of the timeline.
The **Layout** section of the **Settings** tab lists every panel in one place and has **Reset
layout**. The layout is saved in your browser, so each computer or phone keeps its own.

## Where things are stored

Shows, devices and settings live in the add-on's config folder
(`/addon_configs/<slug>_govee_show/`), so they are included in Home Assistant backups. Uploaded
songs go to `/media/govee_show/` so media players can play them.

## Notes

- Lights are driven with Govee's realtime ("razer") protocol, which the Govee app's own LAN API
  doesn't document. While a show plays, the devices ignore other commands; they return to their
  previous state when it stops.
- The add-on uses the host network for Govee discovery, but its web server only answers Home
  Assistant's ingress proxy, so the editor isn't reachable directly on your LAN.
