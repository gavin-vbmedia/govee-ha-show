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

## 2. Build a show

- Pick a song from your Home Assistant **media** folder, or **Upload** one. You can also make a
  lights-only show and set its length.
- Add beat markers: press **B** (or **Tap beat**) in time with the music while it plays, type a
  **BPM** and press **Fill**, or click the beat lane. Clips snap to beats and to each other
  (hold Shift to place freely).
- Pick an effect from the palette and drag on a device's track to place it. Drag a clip to move it
  (including onto another device), drag its edges to resize, and edit colours and speed below the
  timeline. The preview strip shows every segment of every device as the playhead moves.

Shortcuts: Space play/pause, B beat, Delete remove clip, D duplicate, Ctrl+Z / Ctrl+Shift+Z undo
and redo, Ctrl+S save, + and − zoom, Ctrl+scroll zoom.

## 3. Play it

**Save** stores the show and bakes every frame for playback (Play saves first if needed).

Next to Play, choose where the song plays:

- **Song in this browser**: the song plays in your browser and the add-on streams the lights in
  sync with it. Untick **Lights** to preview in the browser only. If the lights lead or lag,
  adjust **Light offset** under *Playback and automation*.
- **Speaker: …** (any Home Assistant media player): the add-on starts the song on that speaker
  and the lights with it; the editor's playhead follows along. Speakers start playing a little
  after they report they have, so set **Speaker delay** for each speaker (often 100 to 500 ms
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

Send `input: {action: stop}` to stop. The exact input for the open show is shown under
*Playback and automation* in the editor. A show with no speaker plays the lights only.

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
