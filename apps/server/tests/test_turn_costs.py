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
from app.models import ApiCall, Project, TurnCost

_PAYLOAD = {"cost_usd": 0.42, "model": "claude-sonnet-4-6", "input_tokens": 1500, "output_tokens": 300}


@pytest.fixture
def db():
    init_db()

    def clear(s):
        for model in (TurnCost, ApiCall, Project):
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
    def __init__(self, frames, during=None):
        self.frames, self.during = frames, during

    async def query(self, text):
        pass

    async def receive_response(self):
        if self.during:
            self.during()
        for f in self.frames:
            yield f

    async def receive_messages(self):
        return
        yield


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
    monkeypatch.setattr(real_agent, "_sandbox_build", lambda: "abc123+dirty")
    agent = real_agent.RealAgent(tmp_path)
    agent._hook_counter = counter = {"tool_calls": 0, "delivered": False, "continuations": 0}

    def two_overridden_stops():
        counter["continuations"] += 2

    for frames, during in (([_result(0.30, 1000, 100)], two_overridden_stops), ([_result(0.50, 1600, 250)], None)):
        client = _OneStream(frames, during)

        async def _ensure(client=client):
            agent._client = client
            return client

        agent._ensure_client = _ensure
        [ev async for ev in agent.handle_turn("go")]
    await asyncio.to_thread(done.wait, 5)

    assert [p["model"] for _, p in posted] == ["claude-sonnet-4-6"] * 2
    assert [p["cost_usd"] for _, p in posted] == pytest.approx([0.30, 0.20])
    assert [(p["input_tokens"], p["output_tokens"]) for _, p in posted] == [(1000, 100), (600, 150)]
    assert [p["build"] for _, p in posted] == ["abc123+dirty"] * 2
    assert [p["continuations"] for _, p in posted] == [2, 0], "a turn reported another turn's continuations"


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



def test_build_and_continuations_are_stored_and_old_sandboxes_still_report(db):
    assert _post({**_PAYLOAD, "build": "abc123", "continuations": 3}, proxy_token("sbx-1")).status_code == 204
    assert _post(_PAYLOAD, proxy_token("sbx-1")).status_code == 204
    rows = db.exec(select(TurnCost).order_by(TurnCost.id)).all()
    assert [(r.build, r.continuations) for r in rows] == [("abc123", 3), (None, None)]


@pytest.mark.parametrize("bad", [{"continuations": -1}, {"build": "x" * 65}, {"continuations": "many"}])
def test_a_malformed_build_or_count_is_rejected(db, bad):
    assert _post({**_PAYLOAD, **bad}, proxy_token("sbx-1")).status_code == 422
    assert db.exec(select(TurnCost)).all() == []


class _Matcher:
    def __init__(self, **kw):
        self.kw = kw


def test_the_stop_hook_counts_the_stops_it_overrides_per_turn(tmp_path, monkeypatch):
    (tmp_path / "research.json").write_text('{"project": {"status": "active"}}', encoding="utf-8")
    monkeypatch.setattr(real_agent, "AUTONOMOUS_MAX_NUDGES", 60)
    agent = real_agent.RealAgent(tmp_path)
    hooks = real_agent._build_hooks(_Matcher, tmp_path, agent)
    stop = hooks["Stop"][0].kw["hooks"][0]
    count_tool = hooks["PreToolUse"][0].kw["hooks"][0]
    call = lambda hook: asyncio.run(hook({"tool_name": "Read", "tool_input": {}}, "t", None))  # noqa: E731

    assert call(stop)["decision"] == "block"
    call(count_tool)
    assert call(stop)["decision"] == "block"
    assert agent._hook_counter["continuations"] == 2

    (tmp_path / "research.json").write_text('{"project": {"status": "completed"}}', encoding="utf-8")
    call(count_tool)
    assert call(stop) == {}
    assert agent._hook_counter["continuations"] == 2, "an allowed stop was counted"

    agent._begin_turn_hook_state()
    assert agent._hook_counter["continuations"] == 0


@pytest.mark.parametrize("content, expected", [
    ('{"commit": "abc123", "dirty": false}', "abc123"),
    ('{"commit": "abc123", "dirty": true}', "abc123+dirty"),
    ('{"commit": ""}', None),
    ("not json", None),
    (None, None),
])
def test_the_sandbox_reads_its_own_build(tmp_path, monkeypatch, content, expected):
    stamp = tmp_path / "BUILD_INFO.json"
    if content is not None:
        stamp.write_text(content, encoding="utf-8")
    monkeypatch.setattr(real_agent, "_BUILD_INFO", stamp)
    assert real_agent._sandbox_build() == expected



# ── the live table gets the new columns at startup ──────────────────────────────────────

_TABLE_AS_FIRST_DEPLOYED = """CREATE TABLE turn_costs (
    id INTEGER NOT NULL PRIMARY KEY, project_id VARCHAR NOT NULL, user_id VARCHAR NOT NULL,
    model VARCHAR, cost_usd FLOAT NOT NULL, input_tokens INTEGER, output_tokens INTEGER,
    created DATETIME NOT NULL)"""


def test_startup_adds_the_new_columns_to_a_table_created_before_them(tmp_path, monkeypatch):
    from sqlalchemy import create_engine, inspect, text

    from app import db as db_module

    engine = create_engine(f"sqlite:///{tmp_path / 'live.db'}")
    with engine.begin() as conn:
        conn.execute(text(_TABLE_AS_FIRST_DEPLOYED))
        conn.execute(text("INSERT INTO turn_costs VALUES (1, 'p', 'u', 'm', 0.5, 1, 2, '2026-10-12 00:00:00')"))
    monkeypatch.setattr(db_module, "_engine", engine)

    db_module.init_db()
    db_module.init_db()

    assert {"build", "continuations"} <= {c["name"] for c in inspect(engine).get_columns("turn_costs")}
    with Session(engine) as s:
        s.add(TurnCost(project_id="p", user_id="u", cost_usd=0.25, build="abc123", continuations=4))
        s.commit()
        rows = s.exec(select(TurnCost).order_by(TurnCost.id)).all()
    assert [(r.cost_usd, r.build, r.continuations) for r in rows] == [(0.5, None, None), (0.25, "abc123", 4)]


def test_a_table_that_already_has_every_column_is_left_alone():
    from app.db import add_missing_columns

    init_db()
    assert add_missing_columns(get_engine(), TurnCost) == []


# ── make alpha-costs ────────────────────────────────────────────────────────────────────

@pytest.fixture
def seeded(db):
    from datetime import timedelta

    from app.models import User, utcnow

    now = utcnow()
    user = db.get(User, "u-cost") or User(id="u-cost", email="cost-report@example.com")
    db.add(user)
    for project, build, cost, conts, age in [
        ("prj_a", "abc123def456", 10.0, 3, timedelta(days=1)),
        ("prj_a", "abc123def456", 5.0, 0, timedelta(days=1)),
        ("prj_b", "fff999aaa000+dirty", 2.0, 0, timedelta(hours=1)),
        ("prj_c", None, 1.5, None, timedelta(hours=2)),
        ("prj_old", "abc123def456", 99.0, 0, timedelta(days=40)),
    ]:
        db.add(TurnCost(project_id=project, user_id="u-cost", cost_usd=cost, build=build,
                        continuations=conts, created=now - age))
    db.commit()
    yield
    db.delete(db.get(User, "u-cost"))
    db.commit()


def test_the_report_groups_by_day_build_and_session(seeded, capsys):
    from app import cost_report

    cost_report.main(["--days", "30"])
    out = capsys.readouterr().out
    assert "4 turns, 3 sessions, $18.50." in out, out
    assert "prj_old" not in out and "$99" not in out
    build_rows = {line.split()[0]: line.split() for line in out.splitlines()
                  if line.startswith(("abc123def ", "fff999aaa+dirty ", "(not reported)"))}
    assert build_rows["abc123def"][3:8] == ["$15.00", "1", "$15.00", "2", "3"]
    assert build_rows["fff999aaa+dirty"][3:8] == ["$2.00", "1", "$2.00", "1", "0"]
    assert build_rows["(not"][-1] == "-", "a build with no continuation data shows a count"
    top = out.split("Turns, the 3 most expensive sessions")[1].splitlines()[2]
    assert top.split()[:3] == ["prj_a", "$15.00", "2"] and "cost-report@example.com" in top


@pytest.fixture
def calls(db):
    """Two days of calls: a new session and a reopened 30-hour-old one on the first, a third
    session (one of its calls on Sonnet 5) on the second, and one call older than the
    window."""
    from datetime import timedelta

    from app.models import User, utcnow

    noon = utcnow().replace(hour=12, minute=0, second=0, microsecond=0)
    first, second = noon - timedelta(days=3), noon - timedelta(days=2)
    db.add(db.get(User, "u-call") or User(id="u-call", email="calls@example.com"))
    sonnet = "claude-sonnet-4-6"
    for project, created, cost, age_h, tokens, model in [
        ("prj_new", first, 1.00, 1, (10_000, 20_000, 100_000, 2_000), sonnet),
        ("prj_new", first, 0.50, 1, (10_000, 20_000, 100_000, 4_000), sonnet),
        ("prj_reopened", first, 3.00, 96, (10_000, 40_000, 200_000, 3_000), sonnet),
        ("prj_third", second, 2.00, 2, (20_000, 0, 80_000, 5_000), sonnet),
        ("prj_third", second, 0.40, 2, (20_000, 0, 80_000, 5_000), "claude-sonnet-5"),
        ("prj_gone", noon - timedelta(days=40), 50.0, 1, (1, 1, 1, 1), sonnet),
    ]:
        db.add(ApiCall(project_id=project, user_id="u-call", model=model,
                       input_tokens=tokens[0], cache_creation_input_tokens=tokens[1],
                       cache_read_input_tokens=tokens[2], output_tokens=tokens[3],
                       cost_usd=cost, session_age_s=age_h * 3600, created=created))
    db.commit()
    yield first.strftime("%Y-%m-%d"), second.strftime("%Y-%m-%d")
    db.delete(db.get(User, "u-call"))
    db.commit()


def test_the_report_totals_every_call_by_day_and_session_age(calls, capsys):
    from app import cost_report

    first, second = calls
    cost_report.main(["--days", "30"])
    out = capsys.readouterr().out
    assert "Every call the proxy relayed: 5 calls, 3 sessions, $6.90." in out, out
    assert "prj_gone" not in out and "$50" not in out
    days = {line.split()[0]: line.split() for line in out.splitlines()
            if line.startswith((first, second))}
    assert days[first] == [first, "$4.50", "3", "$1.500", "170000", "3000", "2", "1", "$3.00"]
    assert days[second] == [second, "$2.40", "2", "$1.200", "100000", "5000", "1", "1", "$0.00"]
    worst = out.split("Every call, the 3 most expensive sessions")[1].splitlines()[2].split()
    assert worst[:3] == ["prj_reopened", "$3.00", "1"] and worst[3:5] == ["calls@example.com", "4.0d"]
    assert "0 turns, 0 sessions, $0.00." in out, "no turn rows must not hide the calls"


def test_the_report_prices_every_call_by_model_and_token_type(calls, capsys):
    """The Sonnet 5 call's tokens are priced at Sonnet 5's rates: at Sonnet 4.6's, input,
    cache read and output would read $0.21, $0.17 and $0.28."""
    from app import cost_report

    cost_report.main(["--days", "30"])
    out = capsys.readouterr().out
    models = out.split("Every call, by model")[1].splitlines()[2:4]
    assert [line.split() for line in models] == [
        ["claude-sonnet-4-6", "$6.50", "4", "94"], ["claude-sonnet-5", "$0.40", "1", "6"]]
    lines = out.split("Every call, by token type")[1].splitlines()[2:6]
    got = {line.rsplit(None, 2)[0].strip(): line.rsplit(None, 2)[1] for line in lines}
    assert got == {"input": "$0.19", "cache write": "$0.30", "cache read": "$0.16",
                   "output": "$0.26"}


def test_an_empty_window_says_so(db, capsys):
    from app import cost_report

    cost_report.main(["--days", "7"])
    out = capsys.readouterr().out
    assert "0 turns, 0 sessions, $0.00." in out
    assert "Every call the proxy relayed: 0 calls, 0 sessions, $0.00." in out


@pytest.mark.parametrize("argv", [["--days", "0"], ["--top", "0"], ["--days", "x"]])
def test_a_bad_window_is_refused(argv):
    from app import cost_report

    with pytest.raises(SystemExit):
        cost_report.main(argv)
