# HA-liday Show

![HA-liday Show](https://raw.githubusercontent.com/gdeboos/ha-liday-show/main/haliday_show/logo.png)

Music-synchronised light shows for the lights you already have, built right inside Home Assistant:
Govee, WLED, pixel controllers (DDP or E1.31), Twinkly (experimental), and any Home Assistant light or
smart plug.

![The editor: a generated show on five lights, playing on the house preview](https://raw.githubusercontent.com/gdeboos/ha-liday-show/main/docs/images/editor.webp)

- 🎵 Detects the song's tempo, beats and sections, and snaps every effect to them
- 🪄 **Generate** a first draft of the whole show in one click, then edit anything
- 💬 **Describe it** in words and an AI adds the effects (Claude, or any AI set up in Home Assistant)
- 🏠 Watch the show on a photo of your house, bulb by bulb, before it runs for real
- 📦 Plan shows for lights that haven't arrived yet
- ⏯️ Play the song on any Home Assistant speaker and start shows from automations (MQTT or
  `hassio.addon_stdin`)

Works with any mix of those lights on your network; Govee lights need **LAN Control** switched on in the
Govee Home app. After starting the add-on, open **HA-liday Show** from the sidebar and press
**+ Add a light** under **Setup → Devices**. The **Documentation** tab has the full guide.

[Source, issues and screenshots on GitHub](https://github.com/gdeboos/ha-liday-show)
