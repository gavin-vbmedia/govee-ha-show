import json
from types import SimpleNamespace

import pytest

from goveeshow import ai, server
from goveeshow.ha import HAError

REPLY = {"summary": "A red chase on the roof", "clips": [
    {"light": "Roof", "start": 0, "end": 4, "effect": "chase", "settings": [{"key": "color", "value": "#ff0000"}]}]}


@pytest.fixture(autouse=True)
def no_options(tmp_path, monkeypatch):
    monkeypatch.setattr(ai, "OPTIONS", tmp_path / "options.json")
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    return tmp_path / "options.json"


class FakeHA:
    available = True

    def __init__(self, entities=("ai_task.openai",), reply=None, error=None):
        self.entities, self.reply, self.error, self.calls = entities, reply, error, []

    async def states(self, domain=None):
        return [{"entity_id": e} for e in self.entities]

    async def call_with_response(self, domain, service, data, timeout=10):
        self.calls.append((domain, service, data))
        if self.error:
            raise HAError(self.error)
        return {"service_response": {"conversation_id": "x", "data": self.reply}}

    async def mqtt_service(self):
        return None

    async def close(self):
        pass


def test_parse_reply_finds_json_in_prose():
    text = "Here you go:\n```json\n" + json.dumps(REPLY) + "\n```"
    assert ai.parse_reply(text) == REPLY
    with pytest.raises(ai.AIError):
        ai.parse_reply("Sorry, I can't")
    with pytest.raises(ai.AIError):
        ai.parse_reply("{not json}")


async def test_uses_home_assistant_ai_task_without_a_key():
    ha = FakeHA(reply="```json\n" + json.dumps(REPLY) + "\n```")
    out = await ai.create_clips(ha, "red chase on the roof", {"lights": [{"name": "Roof"}]})
    assert out["via"] == "ha" and out["clips"] == REPLY["clips"]
    domain, service, data = ha.calls[0]
    assert (domain, service) == ("ai_task", "generate_data")
    assert data["entity_id"] == "ai_task.openai"  # the only one
    assert "red chase on the roof" in data["instructions"] and '"Roof"' in data["instructions"]


async def test_home_assistant_picks_configured_or_preferred_entity(no_options):
    ha = FakeHA(entities=("ai_task.a", "ai_task.b"), reply=json.dumps(REPLY))
    await ai.create_clips(ha, "x", {})
    assert "entity_id" not in ha.calls[0][2]  # Home Assistant's preferred one
    no_options.write_text(json.dumps({"ai_task_entity": "ai_task.b"}))
    await ai.create_clips(ha, "x", {})
    assert ha.calls[1][2]["entity_id"] == "ai_task.b"


async def test_structured_ai_task_data_is_accepted():
    ha = FakeHA(reply=REPLY)  # some integrations return an object, not text
    assert (await ai.create_clips(ha, "x", {}))["clips"] == REPLY["clips"]


async def test_errors_are_explained():
    with pytest.raises(ai.AIError, match="no AI is set up"):
        await ai.create_clips(FakeHA(entities=()), "x", {})
    with pytest.raises(ai.AIError, match="type what"):
        await ai.create_clips(FakeHA(), "  ", {})
    with pytest.raises(ai.AIError, match="AI Task failed"):
        await ai.create_clips(FakeHA(error="500: boom"), "x", {})


async def test_uses_claude_with_a_key(no_options, monkeypatch):
    no_options.write_text(json.dumps({"claude_api_key": "sk-test"}))
    sent = {}

    class FakeMessages:
        async def create(self, **kw):
            sent.update(kw)
            return SimpleNamespace(stop_reason="end_turn", content=[
                SimpleNamespace(type="thinking", thinking=""), SimpleNamespace(type="text", text=json.dumps(REPLY))])

    class FakeClient:
        def __init__(self, api_key, **kw):
            sent["key"] = api_key
            self.beta = SimpleNamespace(messages=FakeMessages())

        async def close(self):
            pass

    import anthropic
    monkeypatch.setattr(anthropic, "AsyncAnthropic", FakeClient)
    ha = FakeHA()
    out = await ai.create_clips(ha, "red chase", {"lights": []})
    assert out["via"] == "claude" and out["summary"] == REPLY["summary"]
    assert not ha.calls
    assert sent["key"] == "sk-test" and sent["model"] == ai.CLAUDE_MODEL
    assert sent["output_config"]["format"]["schema"] == ai.SCHEMA
    assert sent["fallbacks"] == "default"
    assert (await ai.status(ha))["via"] == "claude"


async def test_ai_endpoints(aiohttp_client, tmp_path, monkeypatch):
    monkeypatch.setattr(server, "HomeAssistant", lambda: FakeHA(reply=json.dumps(REPLY)))
    app = server.make_app(tmp_path / "config", tmp_path / "media", allow_all=True)
    client = await aiohttp_client(app)
    st = await (await client.get("/api/ai")).json()
    assert st["via"] == "ha" and st["entities"] == ["ai_task.openai"]
    resp = await client.post("/api/ai/clips", json={"request": "red chase", "context": {}})
    assert resp.status == 200 and (await resp.json())["clips"] == REPLY["clips"]
    resp = await client.post("/api/ai/clips", json={"request": "", "context": {}})
    assert resp.status == 400 and (await resp.text()).startswith("Type what")
    assert (await client.post("/api/ai/clips", json={"request": "x"})).status == 400
