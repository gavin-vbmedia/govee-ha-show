# Home Assistant lights and switches

Any `light.*` or `switch.*` entity as a light in shows. `output.HaDevice` drives it through the HA REST
API the add-on already uses (`ha.HomeAssistant.call`); no new dependencies.

## Saved devices

`"kind": "ha"`, `entity` (`light.x` or `switch.x`; empty for a planned one), `ip: ""`, `segments: 1`.
`protocol` comes from the entity: `ha_light` or `ha_switch`. `output.linked(d)` (an IP or an entity) is
what "linked" means everywhere now, in Python and the editor.

## Driving it

- One call at a time per entity, queued in order: snapshot, changes, put back. While a call is going the
  latest frame waits; a failing call is logged and the show plays on.
- **Snapshot** when the light is claimed: `GET /api/states/<entity>` for `supported_color_modes`, then
  `scene.create` with `scene_id: haliday_show_<entity>` and `snapshot_entities`. **Put back** when it's
  released: `scene.turn_on` on that scene. `Output.close` waits up to 5 s for these before the HA client
  closes.
- **Light**: the frame's average colour, after **Brightness %**. Under 3/255 → `light.turn_off`; else
  `light.turn_on` with `brightness` (the brightest channel), `transition: 0` and, for colour lights
  (hs/xy/rgb/rgbw/rgbww), `rgb_color` scaled to full. At most every 0.25 s, and only when a channel moves
  by more than 6/255.
- **Switch**: on at 128/255 or brighter, else off; at most once a second (Gavin's choice, for plug relays
  and inflatables).
- Govee scenes on these tracks are ignored. The Test rainbow on a one-segment light cycles colours.

Editor: `lightspeed.js` lists `ha_light` (4 changes a second) and `ha_switch` (1) as slow, so clips that
are too fast are marked. Lights are picked from `GET /api/ha/entities` (lights and switches, with
whether each does colour).

## Checked

Against a fake Home Assistant (states and services on 127.0.0.1:8123, `HA_URL`/`HA_TOKEN`): Test on a
light sent about 4 `light.turn_on` a second, a switch one `switch.turn_on`, and stopping put both back
with `scene.turn_on`. No real entities tested yet.

## Open questions

- Whether some integrations reject `transition: 0`. HA drops it for lights that don't support transitions.
- Groups of many Zigbee bulbs may not keep up with 4 changes a second; a per-light pace may be needed.
