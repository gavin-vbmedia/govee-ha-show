# WLED

How HA-liday Show drives WLED strips. Govee lights are in `govee-protocols.md`; nothing here changes them.

## Saved devices

A device with `"kind": "wled"` is a WLED strip. Devices saved before WLED support have no `kind` and
are marked Govee at start-up (`migrate.fill_device_kinds`, from 0.2.89), and a device that still arrives
without one (say, from an old backup) is read as Govee (`server._clean_device`). A WLED device always has `protocol: "ddp"`, `sku: ""` and no
blending, and can have up to `MAX_SEGMENTS` (1000) segments, one per LED.

## Sending frames: DDP

`wled.ddp_packets` and `output.WledDevice`. Frames go to UDP port 4048 as DDP:

- 10-byte header: flags `0x40` (version 1), `| 0x01` (push) on a frame's last packet; sequence 1–15;
  data type `0x0B` (8-bit RGB); destination `0x01`; data offset in bytes (4, big-endian); data length (2).
- At most 480 LEDs (1440 bytes) a packet, so any frame fits normal network packets.
- Up to 40 frames a second (the same cap as Govee realtime). An unchanged frame is repeated every
  second: WLED's realtime timeout is 2.5 s by default, after which it goes back to its own effect.
- Nothing is sent to start or stop: WLED switches to realtime on the first packet and back when they
  stop. Govee scenes on a WLED track are ignored.

Chosen over WLED's own UDP realtime (port 21324, DRGB/DNRGB) because DRGB caps a packet at 490 LEDs,
DNRGB needs its own start index per packet and a timeout byte, and DDP needs no setup in WLED.

Not checked on a real WLED yet (none in reach of a cloud session): only on the wire, with a fake WLED
at 127.0.0.1 listening on UDP 4048.

## Parts from WLED segments

`POST /api/wled/info {ip}` reads `http://<ip>/json`: `info.name`, `info.leds.count` and `state.seg`.
Each segment (`start` 0-based, `stop` exclusive) becomes a part `w<segment id>` running `start+1`–`stop`,
named from its `n` or *Segment N*. One segment covering the whole strip isn't a split, so it gives no
parts. Overlapping or empty segments are skipped. Part ids follow WLED's segment ids so clips stay on
a part when **Use WLED segments** is pressed again.

During a show the add-on writes every LED directly, so WLED's segment effects, mirroring and grouping
don't apply. WLED's **Use main segment only** (Config → Sync Interfaces) limits realtime data to the
main segment, so it should be off. WLED's master brightness still scales the frames.

## Open questions

- Matrices (2D): later. For now a matrix is driven as one long strip in WLED's LED order.
- Strips over 1000 LEDs: only the first 1000 are driven.
- Finding WLED lights automatically (mDNS, or Home Assistant's WLED integration): would need a new
  library or HA's websocket API; adding by IP covers it for now.
