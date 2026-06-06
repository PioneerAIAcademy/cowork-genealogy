"""Realtime seam (Phase 1 of the Ably migration): the in-process mock fans out,
LocalWsRealtime fans out to attached sockets, the factory selects by config, and
AblyRealtime mints a subscribe-only capability token + publishes to the session
channel (with the `ably` SDK faked — no account needed)."""
import sys
import types

import pytest

from app.realtime import LocalWsRealtime, make_realtime
from app.realtime.mock import MockRealtime


async def test_mock_publish_records_and_delivers():
    rt = MockRealtime()
    got = []
    rt.subscribe("s1", lambda m: got.append(m))
    await rt.publish("s1", {"type": "status", "state": "ready"})
    await rt.publish("s2", {"type": "x"})  # different session, not delivered to s1's cb
    assert rt.published["s1"] == [{"type": "status", "state": "ready"}]
    assert got == [{"type": "status", "state": "ready"}]
    tok = await rt.mint_token("s1")
    assert tok.backend == "ably_mock" and tok.channel == "session:s1"


async def test_local_ws_fans_out_to_attached_sockets():
    rt = LocalWsRealtime()
    sent = []

    class FakeWs:
        async def send_text(self, t):
            sent.append(t)

    ws = FakeWs()
    rt.attach("s1", ws)
    await rt.publish("s1", {"type": "research_updated", "data": {}})
    assert sent == ['{"type": "research_updated", "data": {}}']
    rt.detach("s1", ws)
    await rt.publish("s1", {"type": "x"})  # no subscribers now
    assert len(sent) == 1
    tok = await rt.mint_token("s1")
    assert tok.backend == "local_ws"


def test_factory_default_is_local_ws():
    assert isinstance(make_realtime(), LocalWsRealtime)


def test_factory_ably_requires_key(monkeypatch):
    from app import config

    s = config.get_settings()
    monkeypatch.setattr(s, "realtime", "ably")
    monkeypatch.setattr(s, "ably_api_key", None)
    with pytest.raises(RuntimeError, match="ABLY_API_KEY"):
        make_realtime()


async def test_ably_adapter_token_is_subscribe_only(monkeypatch):
    # Fake the `ably` SDK so we test our adapter's call shapes without a network
    # call or a real account.
    captured = {}

    class FakeChannel:
        async def publish(self, name, data):
            captured["publish"] = (name, data)

    class FakeChannels:
        def get(self, name):
            captured["channel"] = name
            return FakeChannel()

    class FakeAuth:
        async def create_token_request(self, params):
            captured["token_params"] = params
            return dict(params)  # echo; AblyRealtime json.dumps it

    class FakeAblyRest:
        def __init__(self, key):
            captured["key"] = key
            self.channels = FakeChannels()
            self.auth = FakeAuth()

    fake = types.ModuleType("ably")
    fake.AblyRest = FakeAblyRest
    monkeypatch.setitem(sys.modules, "ably", fake)

    from app.realtime.ably import AblyRealtime

    rt = AblyRealtime("fake.app:secret")
    tok = await rt.mint_token("prj_abc")
    assert tok.backend == "ably"
    assert tok.channel == "session:prj_abc"
    assert captured["token_params"]["capability"] == {"session:prj_abc": ["subscribe"]}

    await rt.publish("prj_abc", {"type": "agent_event", "event": {"kind": "text"}})
    name, data = captured["publish"]
    assert name == "agent_event" and data["event"]["kind"] == "text"
    assert captured["channel"] == "session:prj_abc"
