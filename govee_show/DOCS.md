# Govee Light Show

Open **Light Shows** from the Home Assistant sidebar to build and play shows.

## Requirements

- Home Assistant OS or Supervised (anything with Settings → Add-ons).
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

**Save** stores the show and bakes every frame for playback. **Play** plays the song in your browser
and sends the lights the matching frames over the network (it saves first if needed). Untick
**Lights** to preview in the browser only. If the lights lead or lag your speakers, adjust
**Light offset** under Playback settings.

## Where things are stored

Shows, devices and uploaded songs live in the add-on's config folder
(`/addon_configs/<slug>_govee_show/`), so they are included in Home Assistant backups.

## Notes

- Lights are driven with Govee's realtime ("razer") protocol, which the Govee app's own LAN API
  doesn't document. While a show plays, the devices ignore other commands; they return to their
  previous state when it stops.
- The add-on uses the host network for Govee discovery, but its web server only answers Home
  Assistant's ingress proxy, so the editor isn't reachable directly on your LAN.
