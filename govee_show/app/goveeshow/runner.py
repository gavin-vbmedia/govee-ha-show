"""Start and stop shows, with the song on a Home Assistant media player or in the browser.

Every way of playing a show goes through here: the editor, automations (add-on
stdin) and the MQTT entities.
"""
import asyncio
import logging
from datetime import datetime, timezone

from .baked import decode
from .ha import HAError, HomeAssistant, media_content_id, position_now
from .player import Player
from .storage import Storage

log = logging.getLogger(__name__)

START_TIMEOUT_S = 20
FOLLOW_EVERY_S = 1.0
RESYNC_S = 1.0  # media players report position coarsely; only correct big jumps


class RunnerError(Exception):
    pass


def _parse_time(value: str | None) -> datetime | None:
    try:
        return datetime.fromisoformat(value) if value else None
    except ValueError:
        return None


class Runner:
    def __init__(self, storage: Storage, player: Player, ha: HomeAssistant):
        self.storage = storage
        self.player = player
        self.ha = ha
        self.media_player: str | None = None
        self.delay = 0.0
        self._follow: asyncio.Task | None = None
        self._lock = asyncio.Lock()

    def status(self) -> dict:
        st = self.player.status()
        show = self.storage.load_show(st["show"]) if st["show"] else None
        return {**st, "media_player": self.media_player if st["playing"] else None,
                "name": show.get("name") if show else None}

    async def play(self, show_id: str, *, media_player: str | None = None, use_show_speaker=False,
                   position: float = 0.0, offset: float = 0.0):
        """Play a baked show.

        media_player plays the song on that HA entity and follows it. With
        use_show_speaker the show's own speaker, or else the default show speaker from
        Settings, is used when none is given.
        Without a speaker only the lights run (the browser plays the song itself).
        """
        async with self._lock:
            blob = self.storage.load_baked(show_id)
            show = self.storage.load_show(show_id)
            if blob is None or show is None:
                raise RunnerError(f"show '{show_id}' doesn't exist or hasn't been saved in the editor")
            baked = decode(blob)
            if use_show_speaker and not media_player:
                media_player = (show.get("media_player")
                                or self.storage.load_settings().get("show_speaker") or None)
            await self._stop()
            devices = self.storage.devices_by_id()
            if not media_player:
                await self.player.play(show_id, baked, devices, position=position, offset=offset)
                return
            audio = show.get("audio")
            if not audio:
                raise RunnerError("this show has no song to play on a speaker")
            self.delay = self.storage.load_settings()["speaker_delays"].get(media_player, 0) / 1000
            await self._start_speaker(media_player, audio["path"], position)
            await self.player.play(show_id, baked, devices, position=position, offset=self.delay)
            self.media_player = media_player
            self._follow = asyncio.create_task(self._follow_speaker(media_player))
            log.info("playing %s on %s", show_id, media_player)

    async def _start_speaker(self, entity: str, path: str, position: float):
        asked = datetime.now(timezone.utc)
        try:
            await self.ha.call("media_player", "play_media", {
                "entity_id": entity, "media_content_id": media_content_id(path),
                "media_content_type": "music"})
        except HAError as e:
            raise RunnerError(f"couldn't start {entity}: {e}") from e
        # Wait for the speaker to report it is playing the new song, not the old one.
        loop = asyncio.get_running_loop()
        deadline = loop.time() + START_TIMEOUT_S
        while loop.time() < deadline:
            try:
                st = await self.ha.state(entity)
            except HAError:
                st = {}
            updated = _parse_time(st.get("last_updated"))
            pos = st.get("attributes", {}).get("media_position")
            if (st.get("state") == "playing" and updated and updated >= asked
                    and (pos is None or pos < 3)):
                break
            await asyncio.sleep(0.1)
        else:
            raise RunnerError(f"{entity} didn't start playing within {START_TIMEOUT_S} seconds")
        if position > 0:
            try:
                await self.ha.call("media_player", "media_seek",
                                   {"entity_id": entity, "seek_position": position})
            except HAError as e:
                log.warning("seek on %s failed: %s", entity, e)

    async def _follow_speaker(self, entity: str):
        """Stop the lights if the speaker stops; correct large drift."""
        try:
            while self.player.playing:
                await asyncio.sleep(FOLLOW_EVERY_S)
                try:
                    st = await self.ha.state(entity)
                except HAError:
                    continue
                if st.get("state") not in ("playing", "buffering"):
                    log.info("%s is %s; stopping the lights", entity, st.get("state"))
                    self.media_player = None
                    await self.player.stop()
                    return
                est = position_now(st, datetime.now(timezone.utc))
                if est is not None and abs(self.player.position() - est) > RESYNC_S:
                    self.player.sync(est)
        except asyncio.CancelledError:
            pass

    async def stop(self):
        async with self._lock:
            await self._stop()

    async def _stop(self):
        if self._follow:
            self._follow.cancel()
            self._follow = None
        await self.player.stop()
        if self.media_player:
            try:
                await self.ha.call("media_player", "media_stop", {"entity_id": self.media_player})
            except HAError as e:
                log.warning("couldn't stop %s: %s", self.media_player, e)
            self.media_player = None
