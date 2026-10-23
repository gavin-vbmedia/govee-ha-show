"""Twinkly lights (experimental): Twinkly's local realtime mode, which isn't official but is well
documented by the xled project (https://xled-docs.readthedocs.io).

Over HTTP the add-on logs in, notes the light's current mode and switches it to realtime ("rt"); then
frames go to UDP port 7777 with the login token in each packet. When the show stops, the light is put
back in the mode it was in. See docs/twinkly.md.
"""
import asyncio
import base64
import logging
import os

import aiohttp

log = logging.getLogger(__name__)

HTTP_PORT = 80  # tests point this at a fake Twinkly
RT_PORT = 7777
FRAGMENT = 900  # bytes of colour in one v3 packet
# Firmware 2.4.30 and later take frames split into numbered fragments (v3); older takes one packet (v2).
V3_FIRMWARE = (2, 4, 30)


class TwinklyError(Exception):
    pass


def _version(text: str) -> tuple:
    try:
        return tuple(int(x) for x in text.split(".")[:3])
    except ValueError:
        return (0,)


def rt_packets(token: bytes, rgb: bytes, *, rgbw: bool = False, v3: bool = True) -> list[bytes]:
    """One frame as realtime packets. An RGBW light takes white first, then red, green and blue, so the
    white channel is left off and the colours stay as they are."""
    if rgbw:
        rgb = b"".join(b"\0" + rgb[i: i + 3] for i in range(0, len(rgb), 3))
    if not v3:
        return [b"\x02" + token + b"\x00" + rgb]
    return [b"\x03" + token + b"\x00\x00" + bytes([n]) + rgb[at: at + FRAGMENT]
            for n, at in enumerate(range(0, max(len(rgb), 1), FRAGMENT))]


class Twinkly:
    """One light's HTTP side: log in, read what it is, switch its mode."""

    def __init__(self, ip: str, timeout: float = 4.0):
        self.base = f"http://{ip}:{HTTP_PORT}/xled/v1"
        self.timeout = aiohttp.ClientTimeout(total=timeout)
        self.header = ""  # the token as sent in X-Auth-Token
        self.token = b""  # the same token as raw bytes, for realtime packets

    async def _request(self, method: str, path: str, body=None) -> dict:
        headers = {"X-Auth-Token": self.header} if self.header else {}
        try:
            async with aiohttp.ClientSession(timeout=self.timeout) as s:
                async with s.request(method, self.base + path, json=body, headers=headers) as r:
                    if r.status != 200:
                        raise TwinklyError(f"{path} answered {r.status}")
                    data = await r.json(content_type=None)
        except (aiohttp.ClientError, asyncio.TimeoutError, ValueError) as e:
            raise TwinklyError(f"no Twinkly light answered at {self.base.split('/')[2]}") from e
        if isinstance(data, dict) and data.get("code", 1000) != 1000:
            raise TwinklyError(f"{path} refused (code {data.get('code')})")
        return data

    async def info(self) -> dict:
        g = await self._request("GET", "/gestalt")
        try:
            leds = int(g["number_of_led"])
        except (KeyError, TypeError, ValueError):
            raise TwinklyError("that doesn't look like a Twinkly light")
        try:
            firmware = (await self._request("GET", "/fw/version")).get("version", "")
        except TwinklyError:
            firmware = ""
        return {"name": str(g.get("device_name") or "Twinkly")[:64], "leds": leds,
                "rgbw": str(g.get("led_profile", "RGB")).upper() == "RGBW", "firmware": str(firmware)}

    async def login(self):
        challenge = base64.b64encode(os.urandom(32)).decode()
        self.header = ""
        got = await self._request("POST", "/login", {"challenge": challenge})
        try:
            header, answer = got["authentication_token"], got["challenge-response"]
            token = base64.b64decode(header)
        except (KeyError, TypeError, ValueError):
            raise TwinklyError("the light's login answer wasn't understood")
        self.header, self.token = header, token
        await self._request("POST", "/verify", {"challenge-response": answer})

    async def mode(self) -> str:
        return str((await self._request("GET", "/led/mode")).get("mode") or "movie")

    async def set_mode(self, mode: str):
        await self._request("POST", "/led/mode", {"mode": mode})


async def fetch(ip: str) -> dict:
    return await Twinkly(ip).info()


def is_v3(firmware: str) -> bool:
    return not firmware or _version(firmware) >= V3_FIRMWARE
