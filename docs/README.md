# How lights are driven

HA-liday Show plays the same baked frames on every kind of light; only the sending differs. Each kind
has its own notes: what's sent, what's been checked (on real lights or only on the wire), and open
questions. Read the one for a kind before changing how it's driven, and add what you learn.

| Kind | Notes | Code | Checked on real lights |
| --- | --- | --- | --- |
| Govee | [govee-protocols.md](govee-protocols.md), plus [capture-help.md](capture-help.md) for capturing the Govee app's traffic | `protocol.py`, `output.OutputDevice`, `discovery.py`, `lab.py`, `listen.py` | Yes (H706A/B/C, H70C5) |
| WLED | [wled.md](wled.md) | `wled.py`, `output.DdpDevice` | Not yet |
| Pixel controllers over DDP | [ddp.md](ddp.md) | `wled.ddp_packets`, `output.DdpDevice` | Not yet |
| Pixel controllers over E1.31 (sACN) | [e131.md](e131.md) | `e131.py`, `output.E131Device` | Not yet |
| Home Assistant lights and switches | [ha-lights.md](ha-lights.md) | `output.HaDevice`, `ha.py` | Not yet |
| Twinkly (experimental) | [twinkly.md](twinkly.md) | `twinkly.py`, `output.TwinklyDevice` | Not yet |

Things every kind shares:

- A saved light's `kind` (`govee`, `wled`, `ddp`, `e131`, `ha`, `twinkly`) decides how it's driven.
  Lights saved before 0.2.88 have no `kind` and are Govee (`migrate.fill_device_kinds` fills it in).
- `output.make_device` picks the sender from the light's `protocol`; `output.address(d)` is the key a
  light is claimed under (its IP, or more when several lights share one controller); `output.linked(d)`
  says whether it has somewhere to send to.
- Lights set up over HTTP (Home Assistant, Twinkly) queue their calls with `output.Calls`, and are put
  back as they were when they're let go.
- The editor's `lightspeed.js` lists the slow ones, so effects too fast for them are marked.
- To check the wire without the real light, point a light at 127.0.0.1 and listen on its port: UDP 4003
  (Govee), 4048 (WLED and DDP), 5568 (E1.31), 7777 (Twinkly), or run a fake Home Assistant for `HA_URL`.
