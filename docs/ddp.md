# Pixel controllers (DDP)

Generic DDP receivers: Falcon Player, ESPixelStick, ESPHome's DDP component, Tasmota, DIY ESP32 strings.
They use the same sender as WLED (`wled.ddp_packets`, `output.DdpDevice`); the packet format is in
`wled.md`. Nothing here changes Govee or WLED lights.

## Saved devices

`"kind": "ddp"`, `protocol: "ddp"`, `ip`, `segments` (= LEDs, up to 1000) and `first` (the light's first
LED on the controller, 1-based, default 1, up to 100000). `first` is only stored for this kind.

There's no API to ask, so the user types the LED count (**LEDs** next to **Add by IP**) and checks it
with **Test**.

## Several lights on one controller

A light's frames start at DDP byte offset `(first - 1) * 3`, so lights sharing an IP each drive their own
LEDs. Each frame carries the push flag, so each light shows as soon as its frame arrives.

Lights are claimed in `Output` by address, not IP: `output.address(d)` is `ip` for every light except a
DDP light with `first > 1`, which is `ip#first`. Tests, previews and the player all use it, so two lights
on one controller can be tested and played at once. Keys for Govee and WLED lights are unchanged.

`js/controllers.js`: a new light on an IP starts after the last one on it (`nextFirstLed`), and rows
warn when two lights on one controller share LEDs (`overlapping`).

## Checked

Only on the wire, with a fake DDP receiver on 127.0.0.1:4048: two lights on one IP, 100 and 60 LEDs,
tested at once, arrived at offsets 0 and 300 with 300 and 180 bytes and the push flag. No real
controller yet.

## Open questions

- We send destination id `0x01` (default output); FPP and ESPixelStick are expected to accept it.
- Controllers with more than 1000 LEDs on one light: split across several lights for now.
