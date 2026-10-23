"""Home Assistant entities over MQTT discovery, when an MQTT broker is set up.

Creates a "HA-liday Show" device with:
  select.ha_liday_show_show    pick a show
  button.ha_liday_show_play    play the selected show (on its saved speaker)
  button.ha_liday_show_stop    stop
  sensor.ha_liday_show_status  idle, or the name of the show playing

Publishing a show id or name to haliday_show/play also plays it directly.
"""
import asyncio
import json
import logging

from . import __version__, migrate
from .commands import find_show
from .runner import Runner, RunnerError

log = logging.getLogger(__name__)

BASE = "haliday_show"
DISCOVERY = "homeassistant"
DEVICE = {"identifiers": ["haliday_show"], "name": "HA-liday Show",
          "manufacturer": "ha-liday-show", "model": "Light show sequencer", "sw_version": __version__}


def show_options(shows: list[dict]) -> dict[str, str]:
    """Option label -> show id. Names are used unless two shows share one."""
    names = [s["name"] for s in shows]
    return {(s["name"] if names.count(s["name"]) == 1 else f'{s["name"]} ({s["id"]})'): s["id"]
            for s in shows}


def discovery_configs(options: list[str]) -> dict[str, dict]:
    avail = {"availability_topic": f"{BASE}/availability"}
    return {
        f"{DISCOVERY}/select/haliday_show/show/config": {
            "name": "Show", "unique_id": "haliday_show_show", "icon": "mdi:playlist-music",
            "command_topic": f"{BASE}/show/set", "state_topic": f"{BASE}/show/state",
            "options": options or ["(no shows yet)"], "device": DEVICE, **avail},
        f"{DISCOVERY}/button/haliday_show/play/config": {
            "name": "Play", "unique_id": "haliday_show_play", "icon": "mdi:play",
            "command_topic": f"{BASE}/play", "payload_press": "PRESS", "device": DEVICE, **avail},
        f"{DISCOVERY}/button/haliday_show/stop/config": {
            "name": "Stop", "unique_id": "haliday_show_stop", "icon": "mdi:stop",
            "command_topic": f"{BASE}/stop", "payload_press": "PRESS", "device": DEVICE, **avail},
        f"{DISCOVERY}/sensor/haliday_show/status/config": {
            "name": "Status", "unique_id": "haliday_show_status", "icon": "mdi:string-lights",
            "state_topic": f"{BASE}/status", "device": DEVICE, **avail},
    }


class MqttBridge:
    def __init__(self, runner: Runner):
        self.runner = runner
        self.storage = runner.storage
        self.client = None
        self.options: dict[str, str] = {}
        self._status = None
        self._refresh = asyncio.Event()

    def refresh(self):
        """Call after shows change so the select's options follow."""
        self._refresh.set()

    @property
    def selected(self) -> str | None:
        return self.storage.load_settings().get("selected_show")

    def _select(self, show_id: str):
        settings = self.storage.load_settings()
        settings["selected_show"] = show_id
        self.storage.save_settings(settings)

    async def run(self, config: dict):
        import aiomqtt

        delay = 5
        while True:
            try:
                async with aiomqtt.Client(
                        hostname=config["host"], port=int(config.get("port", 1883)),
                        username=config.get("username"), password=config.get("password"),
                        identifier="haliday_show",
                        will=aiomqtt.Will(f"{BASE}/availability", "offline", retain=True)) as client:
                    self.client = client
                    delay = 5
                    log.info("connected to MQTT at %s", config["host"])
                    await client.subscribe(f"{BASE}/#")
                    await client.subscribe(f"{DISCOVERY}/status")
                    await self._publish_all()
                    tasks = [asyncio.create_task(self._watch())]
                    try:
                        async for msg in client.messages:
                            await self._on_message(str(msg.topic), msg.payload)
                    finally:
                        for t in tasks:
                            t.cancel()
            except aiomqtt.MqttError as e:
                log.warning("MQTT connection lost (%s); retrying in %ss", e, delay)
            self.client = None
            await asyncio.sleep(delay)
            delay = min(delay * 2, 300)

    async def _clear_old_entities(self):
        """After importing from Govee Light Show, remove its entities so they aren't left dangling."""
        cfg = self.storage.config_dir
        done = cfg / migrate.OLD_MQTT_CLEARED
        if done.exists() or not (migrate.imported(cfg) or {}).get("files"):
            return
        old = migrate.OLD_SLUG
        topics = [f"{DISCOVERY}/{kind}/{old}/{name}/config" for kind, name in
                  (("select", "show"), ("button", "play"), ("button", "stop"), ("sensor", "status"))]
        topics += [f"{old}/{t}" for t in ("availability", "status", "show/state")]
        for topic in topics:
            await self.client.publish(topic, b"", retain=True)
        done.touch()
        log.info("removed the old Govee Light Show entities")

    async def _publish_all(self):
        await self._clear_old_entities()
        self.options = show_options(self.storage.list_shows())
        for topic, cfg in discovery_configs(list(self.options)).items():
            await self.client.publish(topic, json.dumps(cfg), retain=True)
        await self.client.publish(f"{BASE}/availability", "online", retain=True)
        await self._publish_selected()
        self._status = None
        await self._publish_status()

    async def _publish_selected(self):
        label = next((k for k, v in self.options.items() if v == self.selected), None)
        if label:
            await self.client.publish(f"{BASE}/show/state", label, retain=True)

    async def _publish_status(self):
        st = self.runner.status()
        status = st["name"] or st["show"] if st["playing"] else "idle"
        if status != self._status:
            self._status = status
            await self.client.publish(f"{BASE}/status", status, retain=True)

    async def _watch(self):
        while True:
            try:
                await asyncio.wait_for(self._refresh.wait(), 1)
                self._refresh.clear()
                await self._publish_all()
            except asyncio.TimeoutError:
                await self._publish_status()

    async def _play(self, show_id: str):
        try:
            await self.runner.play(show_id, use_show_speaker=True)
        except RunnerError as e:
            log.error("couldn't play %s: %s", show_id, e)

    async def _on_message(self, topic: str, payload: bytes):
        text = payload.decode(errors="replace").strip()
        try:
            if topic == f"{DISCOVERY}/status" and text == "online":
                await self._publish_all()  # Home Assistant restarted
            elif topic == f"{BASE}/show/set":
                show_id = self.options.get(text) or find_show(self.storage, text)
                if show_id:
                    self._select(show_id)
                    await self._publish_selected()
            elif topic == f"{BASE}/play":
                show_id = self.selected if text in ("", "PRESS") else find_show(self.storage, text)
                if not show_id:
                    raise ValueError(f"no show called '{text}'" if text != "PRESS" else "no show selected")
                # Starting a speaker can take seconds; keep handling messages meanwhile.
                asyncio.create_task(self._play(show_id))
            elif topic == f"{BASE}/stop":
                await self.runner.stop()
                await self._publish_status()
        except (ValueError, RunnerError) as e:
            log.error("MQTT %s failed: %s", topic, e)
