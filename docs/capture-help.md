# Help wanted: recording how Govee syncs long string lights

**Who this is for:** anyone with a Govee **TV sync box / DreamView kit** or a **Scene Stage sync centre**
(for example the Curtain Lights 2) that drives other Govee lights, especially the **Christmas String
Lights 2** (H70C5 and the 20 m set) or the **icicle lights** (H70D1/H70D2).

**Why:** [HA-liday Show](https://github.com/gdeboos/ha-liday-show) is a free Home Assistant app
for music light shows. On the Christmas String Lights 2, the live colour mode we can use only reaches the
**first 44 bulbs**. Yet a TV sync box gets colour onto the **whole string**, live. We've tried every
command we could think of. We need a recording of what your sync box (or sync centre) actually sends to
the lights. Twenty minutes of your time could unlock the whole string for everyone.

You don't need to understand any of it. Nothing here changes your lights or your Govee app.

---

## Step 1: tell us your set-up (2 minutes, anyone can do this)

Even if you stop here, this helps. Please note down:

1. The model of your sync box or sync centre, and of each light it drives (Govee Home app → the device →
   ⚙ settings → **Device info**). Include the firmware versions shown there.
2. How it's set up in the app: is the light added to a **DreamView** group, a **Scene Stage**, or
   something else? Did you have to **set the segments**? A few screenshots of the set-up screens are ideal.
3. When it's running, does the **whole** string follow the colours, or only part of it? Does each bulb
   look different, or does the string move in about 10 blocks?
4. **One quick test:** in the app, turn **LAN Control** off on the string light (device → ⚙ → **LAN
   Control**), then start the sync again. Does it still work? Turn it back on afterwards.
   (This tells us whether the sync goes over your Wi-Fi or over Bluetooth.)

## Step 2: film it (5 minutes, anyone can do this)

Film the whole string for about a minute while the sync runs. For a TV sync box, play these on the TV,
about 10 seconds each, and say out loud which one is on:

1. a plain **red** screen
2. a plain **blue** screen
3. a screen that's **red on the left half, blue on the right**
4. something colourful and moving

(Search YouTube for "red screen" etc.) For Scene Stage, say which scene you picked.

This alone tells us whether the sync gives every bulb its own colour or just colours a few blocks.

## Step 3: record the traffic (needs a router that can capture)

This is the part that will crack it. The sync box talks to the light directly over your Wi-Fi (if the
LAN Control test said so), and a phone or laptop on the same Wi-Fi **can't** see that. Your **router or
access point** can, if it has a packet capture feature. Pick whichever you have:

- **FRITZ!Box:** go to `http://fritz.box/html/capture.html`, log in, and press **Start** next to the
  Wi-Fi interface (try the ones named **WLAN** or **AP**). Press **Stop** when done; it downloads a file.
- **UniFi access point:** SSH into the access point (Settings → System → Device SSH credentials), run
  `tcpdump -i br0 -w /tmp/govee.pcap host LIGHT_IP`, stop with Ctrl+C, then copy the file off with `scp`.
  If `br0` sees nothing, `ifconfig` lists the other interfaces to try.
- **OpenWrt:** `opkg install tcpdump`, then the same `tcpdump` command as UniFi (interface `br-lan`).
- **pfSense / OPNsense:** **Diagnostics → Packet Capture**, interface = the LAN or Wi-Fi one, host =
  the light's IP. This only works if the access point traffic passes through it, which it often doesn't.
- **Anything else** with "packet capture" or `tcpdump` (some ASUS/Merlin, MikroTik "Packet Sniffer",
  Omada): same idea. Capture on the Wi-Fi side, filtered to the light's IP address.

`LIGHT_IP` is the string light's address (your router's device list, or Home Assistant). Filtering to it
keeps the recording small and leaves out the rest of your home network.

**What to do while recording** (about 2 minutes in all, and note the time of each step):

1. Start recording with the sync **off**. Wait 10 seconds.
2. Turn the sync **on**. Wait 20 seconds.
3. Play the same red / blue / half-and-half / moving sequence as Step 2 (10 seconds each).
4. Turn the sync **off**. Wait 10 seconds. Stop recording.

If you can film the lights at the same time, even better.

**Heard nothing at all from the sync box?** That's an answer too. It probably means it's using Bluetooth
(see below) or Govee's cloud. Please still tell us.

## Step 4 (optional): Bluetooth

If the LAN Control test says the sync doesn't use Wi-Fi, it's probably Bluetooth between the sync box and
the light. That's much harder to record: it needs a Bluetooth sniffer such as a **Nordic nRF52840
dongle** with Nordic's free **nRF Sniffer for Bluetooth LE** in Wireshark. If you happen to have one,
record the sync box connecting to the light (start the sniffer **before** you turn the sync on, so it
catches the connection being made) and send us the file. Don't buy one just for this.

## Sending it to us

Open an issue at <https://github.com/gdeboos/ha-liday-show/issues> (or reply where you saw this)
with:

- your answers from Step 1, and the video,
- the capture file (zip it if GitHub won't take it), and
- the times you noted for each step.

**Privacy:** filtered to one light's address, the recording only holds what goes to and from that light:
colours, plus the light's and sync box's local addresses. No passwords or Govee account details. If you
couldn't filter it, say so and we'll only look at the light's packets.

Thank you!

---

## For maintainers: what to look for

- Packets to the light on **UDP 4003** carrying `{"msg":{"cmd":"razer",…}}` or `ptReal`. Decode the base64:
  razer `BB … B0 <flag> <n> <rgb…>` means it's the known protocol; then compare `<n>`, the flag and the
  length field against what's in `govee-protocols.md` (the 44-bulb window). A different command byte, a
  set-up message just after "sync on", or a different port is the prize.
- `ptReal` with `33 05 15` (App segments) means the sync box is only colouring segments.
- The half-and-half screen tells per-segment from whole-string at a glance in the video.
- Record whatever we learn in `govee-protocols.md`, including "it was Bluetooth" or "it was segments".
