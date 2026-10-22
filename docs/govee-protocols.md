# Govee protocols: what we know and how we found it

Developer notes for whoever works on how lights are driven next (person or AI). Everything here was
worked out on the owner's real lights in October 2026, mostly in issue #74. Code references are to
`govee_show/app/goveeshow/` unless they say otherwise.

## The ways the add-on can drive a light

Each light picks one **Protocol** on Setup → Devices (`PROTOCOLS` in `protocol.py`):

| Protocol | Wire format | Speed | Notes |
| --- | --- | --- | --- |
| `standard` (Realtime) | razer `BB <len16> B0 <flag> <n> <rgb…> <xor>` | 40 fps | What OpenRGB sends. One byte for the count, so ≤ 255 segments. |
| `razer` | same, length field fixed at `0x0E` | 40 fps | SignalRGB's "Razer". |
| `v2` | razer `B4` with a zone byte after each colour | 40 fps | SignalRGB's "DreamView V2". |
| `whole` | official `colorwc` with the average colour | ≤ 10/s | Fades every change. |
| `segments` (App segments) | `ptReal` of BLE packets `33 05 15 01 r g b 00×5 <mask LE>` | see below | The Govee app's own segment colour command. |
| `pixels` (Per bulb) | `ptReal` of a Finger sketch picture (below) | see below | Every bulb, any light whose app has Finger sketch. |

`whole`, `segments` and `pixels` are the "slow" protocols (`static/js/lightspeed.js`): Generate and
the AI pick slow-friendly looks for them, and the Selection panel warns when a clip is too fast.

`ptReal` is the LAN API's unofficial command `{"msg":{"cmd":"ptReal","data":{"command":[base64…]}}}`
carrying the same 20-byte packets the Govee app sends over Bluetooth: up to 19 bytes padded with zeros,
then the XOR of those 19 bytes. **Over the LAN these are not encrypted**, even on lights whose Bluetooth
is (see below). Bigger payloads go as an `a3` multi-packet upload (`multi_packets()`): `a3 00 01 <lines>
<kind> …`, then `a3 01`, `a3 02` … with the last line numbered `ff`. Scenes are kind `02`, Finger sketch
pictures kind `03`.

## Realtime (razer) on newer string lights: a 44-bulb window

The 30 m Christmas String Lights 2 (**H70C5**, 300 bulbs, `Pillars` on the owner's network) in razer
mode, tested from the packet lab:

- It lights one bulb per segment and only ever the **first 44 bulbs**. A frame of n ≤ 44 colours is
  spread over bulbs 1–44; it lights `min(length field, 44)` bulbs. More than 44 colours (true length) is
  **rejected**: the whole light goes off.
- The flag byte (byte after `B0`) only switches crisp/blend (`01`, `02` both lit the same 44 bulbs).
- `B4` (v2) is ignored. The fixed-length 14 variant lit 4 bulbs (the light honours the length field).
- The **Run sweep** in the packet lab (`labtemplates.js` `windowSweep`) tries nine ways to address
  bulbs past the window (two-byte count, start offsets, commands `b2`/`b3`/`b5`, zone bytes). Not yet run
  on the real light at the time of writing.
- The Govee app has no setting for the window, and Govee Desktop doesn't offer screen sync for it.
- The newer icicle lights (H70D1/H70D2) behave the same way ("only part of the string").

Govee's product data (`static/models.json`, built by `tools/build_models.py` from SignalRGB's copy)
marks **none** of the 54 Scene Stage models as realtime-capable, including the Permanent Outdoor
Lights Pro (H706A/B/C) that do work (owner's, and signalrgb-govee's 60/90/108 LEDs). So the flag is out
of date for newer lights: the UI says **? untested**, not a warning, and `KNOWN_REALTIME` /
`KNOWN_NOTES` / `KNOWN_SEGMENTS` in `build_models.py` record what real lights showed.

## Per bulb: the Finger sketch picture

The Govee app's **Finger sketch** colours any bulb on these lights. Its format, from a decrypted
Bluetooth capture and confirmed by replaying it over the LAN (`pixel_picture()` / `pixel_packets()`):

```
a3 upload of kind 03 holding:
  <effect> <speed> <brightness> <background r g b> <groups, 2 bytes LE>
  per group: <bulbs, 2 LE> <r g b> <bulbs ≥ 256, 2 LE>
             <each bulb < 256, 1 byte> <each bulb ≥ 256, 2 bytes LE>
then the packet 33 05 0a 20 03 to show it.
```

- Bulbs count from 0 at the plug. Bulbs in no group show the background colour.
- Effect `13` = Twinkle, `14` = Breathe, `0f` = Gradient. `00`, `01`, `02`, `10`, `12`, `15` turn the
  light off (invalid). **Gradient at speed 0 holds still**: that's what `pixels` sends. Speed `32`/`64`
  animate (Gradient at `64` flashes). Brightness `64` = 100%.
- The app's background colour is the header's rgb (white by default). We send the **most common colour**
  as the background so only the other bulbs need listing: a single colour is 2 packets.
- Colours are plain RGB. When a frame has more than 24 colours they're merged (`_palette`).

**Speed (H70C5, measured with the packet lab's Per bulb speed test):**

| Picture | Packets | 2/s | 4/s | 8/s |
| --- | --- | --- | --- | --- |
| 10 bulbs | 3 | keeps up | | drops some |
| every bulb | 23 | keeps up (odd drop) | drops every run | |

So each picture costs about **0.12 s + 0.018 s per packet**, and sending faster makes the light drop
pictures (it then shows about one in three). `output.py` waits `PIXELS_PICTURE_S + PIXELS_PACKET_S ×
packets` (0.13 s + 0.02 s) between pictures and splits each into `ptReal` messages of ≤ 12 packets
40 ms apart (govee-lan-bridge found 24 packets in one message dropped, 18 fine). Result: about 6
pictures a second for mostly-one-colour looks, about 1.5 for a full 300-bulb rainbow. The owner's
verdict: "ok but not amazing"; it's the light's processing, not the transport, so a faster link won't
help. Fast chases look steppy; fades, colour changes and beat flashes look good.

## App segments: 33 05 15

`33 05 15 01 <r g b> 00 00 00 00 00 <segment mask LE, bit 0 = segment 1>` colours the app's own
segments (10 on the H70C5). Separate datagrams sent back-to-back get dropped, so commands are bundled
in one `ptReal`. Sending ~100 commands a second made the H70C5 lag behind; `output.py` now sends at
most 3 per send, biggest change first (`SEGMENTS_PER_SEND`), skipping changes ≤ 12/255. Not retested on
the light after that fix. govee-lan-bridge's notes agree (≤ 12 commands per message; `33 05 15 02` is
per-segment brightness).

## Bluetooth: encrypted, but decryptable

Newer Govee lights encrypt Bluetooth (handshake `e7 01` / `e7 02`). The published scheme
(govee-ble-local, bartekpacia/govee, openHAB #20976) worked on the H70C5:

- Pre-shared key `MakingLifeSmarte` (the first 16 bytes of "MakingLifeSmarter").
- Each 20-byte packet: AES-128-ECB on bytes 0–15, RC4 (restarted per packet, same key) on 16–19.
- The phone sends `e7 01` + random, under the pre-shared key. **The light's `e7 01` reply carries the
  session key in bytes 2–17.** Then `e7 02` both ways, then everything uses the session key.
- After that the plaintext is ordinary Govee BLE: `aa 01` keep-alive every 2 s, `aa 40` reports the
  bulb count (`01 2c` = 300), `aa a5` the segment colours, `33 05 …` commands, `a3` uploads.

`tools/govee_btsnoop.py` decrypts an Android `btsnoop_hci.log` with this.

**How the captures were made (Samsung Android):** Developer options → Bluetooth HCI snoop log =
Enabled, toggle Bluetooth, turn Wi-Fi *and* mobile data off so the app must use Bluetooth, use the app,
then take a bug report (Developer options → Bug report → Full; it takes a few minutes with no feedback)
and pull `FS/data/log/bt/btsnoop_hci.log` (or search the extracted zip for `btsnoop`). `*#9900#` →
SysDump is the fallback. With Wi-Fi on, the app goes through Govee's cloud instead (AWS IoT MQTT on
port 8883, TLS, seen with PCAPdroid): nothing goes to the light over the LAN, so a LAN capture shows
nothing useful.

## Things tried that didn't help

- **Listening for Scene Stage** (Setup → Settings → Listen): a sync centre (Curtain Lights 2, not the
  Permanent Pro) drives other lights per bulb, but almost certainly unicast to each light, which the HA
  host can't hear. Not run; the Finger sketch route made it unnecessary.
- **Wireshark on a laptop**: can't see phone ↔ light unicast. A UniFi access point can `tcpdump` its
  bridge (SSH), but the app used the cloud, not the LAN.
- **HA Bluetooth proxies**: only relay advertisements; can't sniff connections, and add-ons can't use
  them. Bluetooth control would be the same commands as `ptReal`, only slower.
- **Beshelmek/govee_ble_lights** and **SamWiIIiams/govee-lan-bridge**: same `33 05 15` segment
  command, nothing per bulb.

## Tools in the add-on for this kind of work

All under Setup → Settings:

- **Packet lab** (`lab.py`, `static/js/labtemplates.js`): send JSON, razer or `ptReal` to one of the
  configured lights, repeated on a timer, and see replies. Has the **Run sweep** (past the realtime
  window) and the **Per bulb speed test**.
- **Listen for Govee traffic** (`listen.py`): records Govee packets the HA host can hear.

## Open questions

- Does any of the nine sweep guesses reach past bulb 44 in realtime mode? (Would give 40 fps per bulb.)
- Is the Per bulb picture rate the same on the icicles? Do other lights with Finger sketch accept it?
- App segments after the 0.2.71 lag fix: does it keep up now?
