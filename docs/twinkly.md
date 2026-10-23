# Twinkly (experimental)

Twinkly's local realtime mode. Not official; follows the xled project's docs
(https://xled-docs.readthedocs.io). `twinkly.py` has the HTTP client and packet builder,
`output.TwinklyDevice` drives it. Marked **experimental** in the editor and the user guide, at Gavin's
request, until it's been tried on a real Twinkly.

## Saved devices

`"kind": "twinkly"`, `protocol: "twinkly"`, `ip`, `segments` (= LEDs, up to 1000). Nothing else is
saved: RGB or RGBW and the firmware version are read from the light each time it's claimed.

## Setting up (HTTP, port 80)

- `GET /xled/v1/gestalt`: `device_name`, `number_of_led`, `led_profile` (`RGB`/`RGBW`). `POST
  /api/twinkly/info` returns these to the editor.
- `GET /xled/v1/fw/version`: 2.4.30 and later get v3 realtime packets, older ones v2.
- `POST /xled/v1/login {"challenge": <32 random bytes, base64>}` → `authentication_token`,
  `challenge-response`; then `POST /xled/v1/verify` with the response and `X-Auth-Token`.
- `GET /xled/v1/led/mode` to remember the mode, `POST /xled/v1/led/mode {"mode": "rt"}` to start; when
  the light is let go, the remembered mode is set back (`movie` if it was already `rt`).
- Calls run one at a time in the background (`output.Calls`, shared with HA lights); frames wait until
  the light is in realtime mode. The login is renewed after 3 hours (it lasts about 4).

## Frames (UDP 7777)

- v3: `0x03`, the 8-byte token (the base64 login token decoded), `00 00`, fragment number, then up to 900
  bytes of colour. A frame of more than 300 RGB LEDs goes as several fragments.
- v2: `0x02`, token, `00`, then the whole frame.
- RGBW lights take white, red, green, blue per LED; white is sent as 0.
- Up to 40 frames a second; a still frame is repeated every 0.5 s so the light stays in realtime mode.

## Checked

Only against a fake Twinkly (HTTP on 127.0.0.1:80, UDP 7777): adding by IP filled in 400 LEDs; Test logged
in, switched to `rt`, sent two v3 fragments a frame with the token, and stopping set `movie` back.

## Open questions

- Untested on a real Twinkly: the RGBW order, whether newer firmware still accepts this login, and how
  long the light stays in realtime mode without frames.
- Twinkly's own LED order on trees and curtains may not match the order on the house photo.
