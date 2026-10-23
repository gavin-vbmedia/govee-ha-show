"""Commands from automations: the hassio.app_stdin action (hassio.addon_stdin before HA 2026.2) and MQTT.

  {"action": "play", "show": "halloween", "media_player": "media_player.garden"}
  {"action": "stop"}

"show" may be a show's id or its name. Without "media_player" the show's saved
speaker is used; a show with no speaker plays the lights only.
"""
import asyncio
import json
import logging
import os
import sys
import threading

from .runner import Runner, RunnerError
from .storage import Storage

log = logging.getLogger(__name__)


def find_show(storage: Storage, ref: str) -> str | None:
    ref = ref.strip()
    shows = storage.list_shows()
    for s in shows:
        if s["id"] == ref:
            return s["id"]
    for s in shows:
        if s["name"].strip().lower() == ref.lower():
            return s["id"]
    return None


def parse(raw) -> dict:
    if isinstance(raw, (bytes, bytearray)):
        raw = raw.decode(errors="replace")
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except ValueError:
            pass
        if isinstance(raw, str):  # plain text: "stop" or "play <show>"
            action, _, rest = raw.strip().partition(" ")
            return {"action": action, "show": rest.strip()}
    if not isinstance(raw, dict):
        raise ValueError('expected an object like {"action": "play", "show": "..."}')
    return raw


def split_stream(buf: str) -> tuple[list[str], str]:
    """Pull complete commands off the stdin buffer: JSON values, or text lines.

    The Supervisor writes the action's input without a trailing newline, so JSON
    is split by parsing rather than by line.
    """
    out, decoder = [], json.JSONDecoder()
    while buf := buf.lstrip():
        if buf[0] in '{"':
            try:
                _, end = decoder.raw_decode(buf)
            except ValueError:
                break  # incomplete; wait for more
            out.append(buf[:end])
            buf = buf[end:]
        elif "\n" in buf:
            line, buf = buf.split("\n", 1)
            out.append(line)
        else:
            break
    return out, buf


async def handle(runner: Runner, raw) -> str:
    cmd = parse(raw)
    action = str(cmd.get("action", "")).lower()
    if action == "stop":
        await runner.stop()
        return "stopped"
    if action == "play":
        show_id = find_show(runner.storage, str(cmd.get("show", "")))
        if not show_id:
            raise ValueError(f"no show called '{cmd.get('show')}'")
        await runner.play(show_id, media_player=cmd.get("media_player") or None,
                          use_show_speaker=True)
        return f"playing {show_id}"
    raise ValueError(f"unknown action '{action}'")


async def read_stdin(runner: Runner):
    """Run commands sent with the hassio.app_stdin action.

    A daemon thread does the reading, so any kind of stdin works (pipe, socket,
    /dev/null) and a blocked read never holds up shutdown.
    """
    loop = asyncio.get_running_loop()
    chunks: asyncio.Queue[bytes] = asyncio.Queue()

    def reader():
        while True:
            try:
                chunk = os.read(sys.stdin.fileno(), 4096)
            except (OSError, ValueError):
                chunk = b""
            loop.call_soon_threadsafe(chunks.put_nowait, chunk)
            if not chunk:
                return

    threading.Thread(target=reader, name="stdin", daemon=True).start()
    buf = ""
    while chunk := await chunks.get():
        commands, buf = split_stream(buf + chunk.decode(errors="replace"))
        for raw in commands:
            try:
                log.info("automation: %s", await handle(runner, raw))
            except (ValueError, RunnerError) as e:
                log.error("automation command %r failed: %s", raw[:200], e)
