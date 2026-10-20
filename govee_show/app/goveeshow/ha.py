"""Home Assistant access through the Supervisor (homeassistant_api: true).

Outside Home Assistant, set HA_URL (e.g. http://homeassistant.local:8123) and
HA_TOKEN (a long-lived access token) to develop against a real instance.
"""
import logging
import os
from datetime import datetime
from urllib.parse import quote

import aiohttp

log = logging.getLogger(__name__)


class HAError(Exception):
    pass


def media_content_id(path: str) -> str:
    """A file under /media as a media source id any HA media player can resolve."""
    return "media-source://media_source/local/" + quote(path)


def position_now(state: dict, now: datetime) -> float | None:
    """Estimate a playing media player's position from its last reported one."""
    attrs = state.get("attributes", {})
    pos, updated = attrs.get("media_position"), attrs.get("media_position_updated_at")
    if pos is None or not updated:
        return None
    try:
        at = datetime.fromisoformat(updated)
    except ValueError:
        return None
    return float(pos) + (now - at).total_seconds()


class HomeAssistant:
    def __init__(self):
        token = os.environ.get("SUPERVISOR_TOKEN")
        if token:
            self.base, self.token = "http://supervisor/core/api", token
            self.supervisor = "http://supervisor"
        else:
            self.base = os.environ.get("HA_URL", "").rstrip("/") + "/api"
            self.token = os.environ.get("HA_TOKEN", "")
            self.supervisor = None
        self._session: aiohttp.ClientSession | None = None

    @property
    def available(self) -> bool:
        return bool(self.token and self.base != "/api")

    @property
    def session(self) -> aiohttp.ClientSession:
        if self._session is None or self._session.closed:
            self._session = aiohttp.ClientSession(
                headers={"Authorization": f"Bearer {self.token}"},
                timeout=aiohttp.ClientTimeout(total=10))
        return self._session

    async def close(self):
        if self._session:
            await self._session.close()

    async def _request(self, method: str, url: str, json=None):
        if not self.available:
            raise HAError("Home Assistant API is not available")
        try:
            async with self.session.request(method, url, json=json) as resp:
                if resp.status >= 400:
                    raise HAError(f"{resp.status}: {(await resp.text())[:200]}")
                return await resp.json(content_type=None)
        except aiohttp.ClientError as e:
            raise HAError(str(e)) from e

    async def states(self, domain: str | None = None) -> list[dict]:
        states = await self._request("GET", f"{self.base}/states")
        return [s for s in states if not domain or s["entity_id"].startswith(domain + ".")]

    async def state(self, entity_id: str) -> dict:
        return await self._request("GET", f"{self.base}/states/{entity_id}")

    async def call(self, domain: str, service: str, data: dict):
        log.debug("calling %s.%s %s", domain, service, data)
        return await self._request("POST", f"{self.base}/services/{domain}/{service}", json=data)

    async def mqtt_service(self) -> dict | None:
        """Broker details from the Supervisor (services: mqtt:want), if a broker is set up."""
        if not self.supervisor:
            return None
        try:
            body = await self._request("GET", f"{self.supervisor}/services/mqtt")
        except HAError:
            return None
        return body.get("data") if isinstance(body, dict) else None
