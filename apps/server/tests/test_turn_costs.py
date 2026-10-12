"""Per-turn cost: the sandbox reports each turn's cost, the control plane stores a row."""
import asyncio
import threading

import pytest
from claude_agent_sdk import ResultMessage
from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.agent import real_agent
from app.anthropic_proxy import proxy_token
from app.db import get_engine, init_db
from app.main import app
from app.models import Project, TurnCost

_PAYLOAD = {"cost_usd": 0.42, "model": "claude-sonnet-4-6", "input_tokens": 1500, "output_tokens": 300}


@pytest.fixture
def db():
    init_db()

    def clear(s):
        for model in (TurnCost, Project):
            for row in s.exec(select(model)).all():
                s.delete(row)
        s.commit()

    with Session(get_engine()) as s:
        clear(s)
        s.add(Project(id="sess_1", user_id="u1", sandbox_id="sbx-1"))
        s.commit()
        yield s
        clear(s)


def _post(payload, token):
    return TestClient(app).post("/api/turn-cost", json=payload, headers={"x-api-key": token})


def test_a_turn_is_recorded_against_its_project_and_user(db):
    assert _post(_PAYLOAD, proxy_token("sbx-1")).status_code == 204
    _post({**_PAYLOAD, "cost_usd": 0.08}, proxy_token("sbx-1"))
    rows = db.exec(select(TurnCost)).all()
    assert [(r.project_id, r.user_id, r.model) for r in rows] == [("sess_1", "u1", "claude-sonnet-4-6")] * 2
    assert sum(r.cost_usd for r in rows) == pytest.approx(0.50)
    assert (rows[0].input_tokens, rows[0].output_tokens) == (1500, 300)


@pytest.mark.parametrize("token", ["", "sbx-1:forged", proxy_token("sbx-1")[:-4] + "0000"])
def test_a_bad_token_is_refused_and_writes_nothing(db, token):
    assert _post(_PAYLOAD, token).status_code == 401
    assert db.exec(select(TurnCost)).all() == []


def test_a_sandbox_with_no_project_writes_nothing(db):
    assert _post(_PAYLOAD, proxy_token("sbx-unknown")).status_code == 404
    assert db.exec(select(TurnCost)).all() == []


@pytest.mark.parametrize("bad", [{**_PAYLOAD, "cost_usd": -1.0}, {**_PAYLOAD, "cost_usd": "lots"}, {"model": "x"}])
def test_a_malformed_report_is_rejected(db, bad):
    assert _post(bad, proxy_token("sbx-1")).status_code == 422
    assert db.exec(select(TurnCost)).all() == []


@pytest.mark.parametrize("base, url", [
    ("https://wb.example.com/api/anthropic-proxy", "https://wb.example.com/api/turn-cost"),
    (None, None),
    ("https://gateway.example.com/v1", None),
])
def test_the_report_url_comes_from_the_proxy_base_url(monkeypatch, base, url):
    monkeypatch.setattr(real_agent, "_current_base_url", lambda: base)
    assert real_agent._turn_cost_url() == url


def test_a_failed_report_is_logged_not_raised(capsys):
    real_agent._post_turn_cost("http://127.0.0.1:9/api/turn-cost", "k", _PAYLOAD)
    assert "turn cost report failed" in capsys.readouterr().err


class _OneStream:
    def __init__(self, frames):
        self.frames = frames

    async def query(self, text):
        pass

    async def receive_response(self):
        for f in self.frames:
            yield f


def _result(cumulative_cost, in_tok, out_tok):
    return ResultMessage(
        subtype="success", duration_ms=1, duration_api_ms=1, is_error=False, num_turns=1,
        session_id="s1", total_cost_usd=cumulative_cost,
        usage={"input_tokens": in_tok, "output_tokens": out_tok},
    )


@pytest.mark.asyncio
async def test_each_turn_reports_its_own_cost_not_the_session_total(tmp_path, monkeypatch):
    posted, done = [], threading.Event()

    def capture(url, key, payload):
        posted.append((url, payload))
        if len(posted) == 2:
            done.set()

    monkeypatch.setenv("MODEL", "claude-sonnet-4-6")
    monkeypatch.setattr(real_agent, "_turn_cost_url", lambda: "https://wb/api/turn-cost")
    monkeypatch.setattr(real_agent, "_post_turn_cost", capture)
    agent = real_agent.RealAgent(tmp_path)
    for frames in ([_result(0.30, 1000, 100)], [_result(0.50, 1600, 250)]):
        client = _OneStream(frames)

        async def _ensure(client=client):
            agent._client = client
            return client

        agent._ensure_client = _ensure
        [ev async for ev in agent.handle_turn("go")]
    await asyncio.to_thread(done.wait, 5)

    assert [p["model"] for _, p in posted] == ["claude-sonnet-4-6"] * 2
    assert [p["cost_usd"] for _, p in posted] == pytest.approx([0.30, 0.20])
    assert [(p["input_tokens"], p["output_tokens"]) for _, p in posted] == [(1000, 100), (600, 150)]


@pytest.mark.asyncio
async def test_no_report_without_a_proxy(tmp_path, monkeypatch):
    monkeypatch.setattr(real_agent, "_turn_cost_url", lambda: None)
    monkeypatch.setattr(real_agent, "_post_turn_cost", lambda *a: pytest.fail("reported with no proxy"))
    agent = real_agent.RealAgent(tmp_path)
    client = _OneStream([_result(0.30, 1000, 100)])

    async def _ensure():
        agent._client = client
        return client

    agent._ensure_client = _ensure
    events = [ev async for ev in agent.handle_turn("go")]
    assert any(e.get("kind") == "usage" for e in events)

