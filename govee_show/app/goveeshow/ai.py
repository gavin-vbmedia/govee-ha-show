"""Turns a request in words ("red and green chase on the roof in the chorus") into clips.

Two ways to reach a model: Claude directly, when the add-on's Configuration has a Claude API key,
or else Home Assistant's AI Task action, which uses whichever AI integration the user has set up
there (Anthropic, OpenAI, Google, a local Ollama...). The editor sends the request with the show's
context, and checks and places the clips that come back.
"""
import json
import logging
import os
import re
from pathlib import Path

from .ha import HAError, HomeAssistant

log = logging.getLogger(__name__)

CLAUDE_MODEL = "claude-opus-5-5"
OPTIONS = Path(os.environ.get("GOVEE_SHOW_OPTIONS", "/data/options.json"))
MAX_REQUEST = 2000  # characters the user can type
MAX_CONTEXT = 200_000  # bytes of show context


class AIError(Exception):
    pass


def options() -> dict:
    """The add-on's Configuration tab settings (the Supervisor writes them to /data/options.json)."""
    try:
        return json.loads(OPTIONS.read_text())
    except (OSError, ValueError):
        return {}


def claude_key() -> str:
    return str(options().get("claude_api_key") or os.environ.get("ANTHROPIC_API_KEY") or "").strip()


INSTRUCTIONS = """You design light shows for Govee LED lights. Each light is a strip of segments that the \
show colours frame by frame. A show is a list of clips: one effect, with its settings, on one light from a \
start time to an end time in seconds. Clips you add replace what that light had in that stretch of time.

Turn the user's request into clips, using the context below:
- "lights": each light's name and segment count. "House" is a special lane whose effects (the ones marked \
"house") run across every light by where it sits on the house photo; use it only if it is listed, and only \
with house effects. Other lights take only the other effects.
- "effects": every effect, with its settings (key, type, range or options, and default). Leave out settings \
the default suits. Colours are "#rrggbb"; LEDs wash out pastels and dark shades, so use strong colours, and \
"#000000" for off.
- "song": its length, tempo, beat and bar times, and sections (Intro, Verse, Chorus...) with their energy \
from 0 (quiet) to 1 (loud). Start and end clips on bar or beat times so changes land with the music, and \
set speeds from the tempo (for example one step or flash per beat).
- "selection": the stretch of time and lights the user has selected, if any. When the request doesn't say \
where or when, use the selection, else the whole song.
- "palettes": named colour sets, for requests like "in Christmas colours".
- "clips": what the lights have now, for requests that refer to it.

Use only light names and effect keys from the context. Keep clips within the song. Give a one-sentence \
summary of what you made, in plain words. If the request can't be done with these lights and effects, \
return no clips and say why in the summary."""

SCHEMA = {
    "type": "object",
    "properties": {
        "summary": {"type": "string"},
        "clips": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "light": {"type": "string"},
                    "start": {"type": "number"},
                    "end": {"type": "number"},
                    "effect": {"type": "string"},
                    "settings": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {"key": {"type": "string"}, "value": {"type": "string"}},
                            "required": ["key", "value"],
                            "additionalProperties": False,
                        },
                    },
                },
                "required": ["light", "start", "end", "effect", "settings"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["summary", "clips"],
    "additionalProperties": False,
}


def prompt(request: str, context: dict) -> str:
    return f"Context:\n{json.dumps(context, separators=(',', ':'))}\n\nRequest: {request}"


def parse_reply(text: str) -> dict:
    """The JSON object in a model's reply, which may be wrapped in a code block or prose."""
    m = re.search(r"\{.*\}", text or "", re.S)
    if not m:
        raise AIError("the AI didn't return any clips")
    try:
        data = json.loads(m.group(0))
    except ValueError as e:
        raise AIError(f"the AI's reply wasn't valid JSON: {e}") from e
    if not isinstance(data, dict) or not isinstance(data.get("clips", []), list):
        raise AIError("the AI's reply wasn't in the expected shape")
    return {"summary": str(data.get("summary") or ""), "clips": data.get("clips") or []}


async def ask_claude(key: str, text: str) -> dict:
    import anthropic  # imported here so the add-on starts even if the package is missing

    client = anthropic.AsyncAnthropic(api_key=key, timeout=120, max_retries=2)
    try:
        response = await client.beta.messages.create(
            model=CLAUDE_MODEL,
            max_tokens=16000,
            system=INSTRUCTIONS,
            messages=[{"role": "user", "content": text}],
            output_config={"effort": "low", "format": {"type": "json_schema", "schema": SCHEMA}},
            # If Claude declines, the API retries on a fallback model in the same call.
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
        )
    except anthropic.AuthenticationError as e:
        raise AIError("Claude didn't accept the API key; check it on the add-on's Configuration tab") from e
    except anthropic.RateLimitError as e:
        raise AIError("Claude is busy or the account is out of credit; try again shortly") from e
    except anthropic.APIStatusError as e:
        raise AIError(f"Claude returned an error ({e.status_code}): {e.message}") from e
    except anthropic.APIConnectionError as e:
        raise AIError("couldn't reach Claude; check the Home Assistant host's internet connection") from e
    finally:
        await client.close()
    if response.stop_reason == "refusal":
        raise AIError("Claude declined that request")
    if response.stop_reason == "max_tokens":
        raise AIError("that request needs too many clips at once; try a smaller part of the show")
    return parse_reply(next((b.text for b in response.content if b.type == "text"), ""))


async def ask_home_assistant(ha: HomeAssistant, text: str, entity: str | None) -> dict:
    data = {"task_name": "Govee light show clips",
            "instructions": f"{INSTRUCTIONS}\n\nReply with only a JSON object matching this schema:\n"
                            f"{json.dumps(SCHEMA)}\n\n{text}"}
    if entity:
        data["entity_id"] = entity
    try:
        reply = await ha.call_with_response("ai_task", "generate_data", data, timeout=120)
    except HAError as e:
        raise AIError(f"Home Assistant's AI Task failed: {e}") from e
    result = (reply or {}).get("service_response") or {}
    return parse_reply(result.get("data") if isinstance(result.get("data"), str) else json.dumps(result.get("data")))


async def status(ha: HomeAssistant) -> dict:
    """Which way requests will go: "claude", "ha" (with its AI Task entities) or None."""
    if claude_key():
        return {"via": "claude", "model": CLAUDE_MODEL}
    entities = []
    if ha.available:
        try:
            entities = [s["entity_id"] for s in await ha.states("ai_task")]
        except HAError:
            pass
    # The entity named in the Configuration, else the only one, else Home Assistant's preferred one.
    entity = str(options().get("ai_task_entity") or "") or (entities[0] if len(entities) == 1 else None)
    return {"via": "ha" if entities else None, "entities": entities, "entity": entity}


async def create_clips(ha: HomeAssistant, request: str, context: dict) -> dict:
    request = (request or "").strip()
    if not request:
        raise AIError("type what you'd like the lights to do")
    if len(request) > MAX_REQUEST:
        raise AIError("that request is too long")
    text = prompt(request, context)
    if len(text) > MAX_CONTEXT:
        raise AIError("this show is too big to describe to the AI in one go")
    key = claude_key()
    if key:
        return {**await ask_claude(key, text), "via": "claude"}
    st = await status(ha)
    if not st["via"]:
        raise AIError("no AI is set up: add a Claude API key on the add-on's Configuration tab, "
                      "or set up an AI integration with an AI Task entity in Home Assistant")
    return {**await ask_home_assistant(ha, text, st["entity"]), "via": "ha"}
