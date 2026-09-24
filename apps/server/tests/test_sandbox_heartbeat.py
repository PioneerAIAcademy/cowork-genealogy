"""The sandbox heartbeat (research-as-a-job 1d).

``_RUNNING_TIMEOUT_S`` is E2B's Hobby-tier maximum and it clocks CONTINUOUS RUNTIME, not
idleness. Until 1d, ``set_timeout`` had exactly one caller -- ``resume()``, on ``/connect``
-- so a session's whole hour was spent from the moment the browser attached. Against a
corpus median run of 53.9 minutes and a p90 of 107.9, one continuous turn per job pauses
mid-turn at or before p90. Ruled 2026-09-21: the heartbeat, not a Pro upgrade and not
accepting the pause.
"""

from __future__ import annotations

import asyncio
from datetime import timedelta

import pytest
from sqlmodel import Session, select

from app import sandbox_heartbeat
from app.db import get_engine
from app.models import Project, utcnow
from app.sandbox.base import SandboxProvider


def _resolved(value):
    """A coroutine already holding `value`, for monkeypatching an async method."""
    async def _inner():
        return value

    return _inner()


class FakeProvider:
    def __init__(self, *, dead: set[str] | None = None, raises: set[str] | None = None) -> None:
        self.beaten: list[str] = []
        self.dead = dead or set()
        self.raises = raises or set()

    async def heartbeat(self, sandbox_id: str) -> bool:
        if sandbox_id in self.raises:
            raise RuntimeError("the sandbox API is down")
        self.beaten.append(sandbox_id)
        return sandbox_id not in self.dead


def _project(
    session: Session, *, sandbox_id: str, age_s: float, status: str = "active"
) -> Project:
    p = Project(
        id=f"sess_{sandbox_id or 'blank'}_{int(age_s)}",
        user_id="u1",
        sandbox_id=sandbox_id,
        status=status,
        last_active=utcnow() - timedelta(seconds=age_s),
    )
    session.add(p)
    session.commit()
    return p


@pytest.fixture
def db():
    """The suite's own SQLite DB (conftest points DATA_DIR at a temp dir before the app
    imports). Rows are cleared around each test so one test's projects cannot be beaten
    by another's."""
    from app.db import init_db

    init_db()
    with Session(get_engine()) as s:
        for row in s.exec(select(Project)).all():
            s.delete(row)
        s.commit()
        yield s
        for row in s.exec(select(Project)).all():
            s.delete(row)
        s.commit()


def test_the_interval_leaves_room_for_missed_beats():
    """The number that matters is not the interval but how many beats may be missed. At
    300 s against a 3600 s ceiling a beat restarts a clock with ~55 minutes still on it,
    so ELEVEN consecutive misses are needed before a sandbox can pause -- which means the
    control plane has been down for an hour, and the pause is not the first thing the
    patron notices."""
    from app.sandbox.e2b import _RUNNING_TIMEOUT_S

    assert sandbox_heartbeat.BEAT_INTERVAL_S < _RUNNING_TIMEOUT_S
    tolerated = _RUNNING_TIMEOUT_S // sandbox_heartbeat.BEAT_INTERVAL_S
    assert tolerated >= 6, (
        f"only {tolerated} missed beats are tolerated before a live sandbox can pause "
        f"mid-turn; one transient failure must not be able to do that"
    )
    # The window is NOT the ceiling. `last_active` is written only by /connect and
    # /resume, and a running turn refreshes neither -- so this is time since the browser
    # attached, and it must cover the LONGEST RUN, not one ceiling. The corpus puts that
    # at 168.8 minutes.
    LONGEST_RUN_S = 168.8 * 60
    assert sandbox_heartbeat.LIVE_WINDOW_S > LONGEST_RUN_S, (
        f"a window of {sandbox_heartbeat.LIVE_WINDOW_S}s stops beating before the longest "
        f"run in the corpus ({LONGEST_RUN_S:.0f}s) finishes, and the sandbox pauses mid-turn"
    )


def test_only_live_sandboxes_are_beaten(db):
    _project(db, sandbox_id="sb-live", age_s=10)
    _project(db, sandbox_id="sb-recent", age_s=1800)
    _project(db, sandbox_id="sb-mid-run", age_s=7200)  # 2 h in: past the ceiling, still running
    _project(db, sandbox_id="sb-cold", age_s=6 * 60 * 60)  # past any run in the corpus
    _project(db, sandbox_id="", age_s=10)            # row written before its sandbox existed
    ids = sandbox_heartbeat.live_sandbox_ids(db)
    assert sorted(ids) == ["sb-live", "sb-mid-run", "sb-recent"], (
        "`last_active` is time since the browser ATTACHED, not since the agent last "
        "worked -- so a 2-hour-old session is the normal shape of a long run and must "
        "still be beaten. Only a session past the longest run ever recorded is dropped."
    )


def test_an_archived_project_is_left_to_pause(db):
    """Archiving is the one action that is SUPPOSED to let a sandbox go. Without the
    status filter -- the one every other live-project query in the app applies -- an
    archived project is beaten awake every 5 minutes for as long as its `last_active`
    stays inside a four-hour window, billing E2B for a sandbox the patron put away, in
    the one code path whose entire purpose is to stop clocks running out."""
    _project(db, sandbox_id="sb-active", age_s=10)
    _project(db, sandbox_id="sb-archived", age_s=10, status="archived")
    assert sandbox_heartbeat.live_sandbox_ids(db) == ["sb-active"]


def test_the_status_filter_is_the_one_the_rest_of_the_app_uses(db):
    """Spelled against the app's own call sites rather than against a literal written
    here, so renaming the state fails this with the others instead of leaving the
    heartbeat quietly beating rows nothing else considers live."""
    import inspect

    from app import anthropic_proxy, sessions

    expected = 'Project.status == "active"'
    for module in (sessions, anthropic_proxy):
        assert expected in inspect.getsource(module), (
            f"{module.__name__} no longer filters live projects with {expected!r}; the "
            f"heartbeat's copy of it needs to move with it"
        )
    assert expected in inspect.getsource(sandbox_heartbeat)


def test_beat_once_restarts_every_live_clock(db, monkeypatch):
    _project(db, sandbox_id="sb-1", age_s=10)
    _project(db, sandbox_id="sb-2", age_s=60)
    provider = FakeProvider()
    assert asyncio.run(sandbox_heartbeat.beat_once(provider)) == 2
    assert sorted(provider.beaten) == ["sb-1", "sb-2"]


def test_one_dead_sandbox_does_not_stop_the_others(db):
    """The loop beats many. A sandbox someone deleted, or one whose API call fails, must
    cost only itself -- otherwise a single stale row silently stops every other live
    session's clock and they all pause an hour later."""
    _project(db, sandbox_id="sb-gone", age_s=10)
    _project(db, sandbox_id="sb-angry", age_s=10)
    _project(db, sandbox_id="sb-fine", age_s=10)
    provider = FakeProvider(dead={"sb-gone"}, raises={"sb-angry"})
    beaten = asyncio.run(sandbox_heartbeat.beat_once(provider))
    assert beaten == 1, "only sb-fine had its clock restarted"
    assert "sb-fine" in provider.beaten


def test_a_database_that_will_not_answer_is_a_warning_not_a_crash(monkeypatch):
    """A beat is best-effort by construction. Raising out of the loop would take the
    heartbeat down for every session until the process restarts."""
    def boom(*a, **k):
        raise RuntimeError("postgres is away")

    monkeypatch.setattr(sandbox_heartbeat, "get_engine", boom)
    assert asyncio.run(sandbox_heartbeat.beat_once(FakeProvider())) == 0


def test_the_provider_contract_has_a_default_so_a_clockless_provider_is_correct():
    """LocalProvider has no continuous-runtime clock. Making this abstract would force
    every provider to write the same no-op."""
    assert not getattr(SandboxProvider.heartbeat, "__isabstractmethod__", False)

    class Minimal(SandboxProvider):
        async def create(self, spec): ...
        async def get(self, sandbox_id): ...
        async def resume(self, sandbox_id): ...
        async def suspend(self, sandbox_id): ...
        async def delete(self, sandbox_id): ...
        async def list(self, labels=None): ...
        async def aclose(self): ...

    assert asyncio.run(Minimal().heartbeat("sb-1")) is False


def test_the_e2b_provider_actually_restarts_the_clock(monkeypatch):
    """Driven, not grepped. A source-text check passes on
    `sb.set_timeout(...)` with the `await` dropped -- the coroutine is never run, the clock
    is never restarted, and 1d's exact failure (a sandbox pausing mid-turn at ~p90) ships
    with CI green."""
    from app.sandbox import e2b

    seen: list[int] = []

    class FakeSandbox:
        async def set_timeout(self, seconds):
            seen.append(seconds)

    provider = e2b.E2BProvider.__new__(e2b.E2BProvider)
    monkeypatch.setattr(e2b.E2BProvider, "_connect", lambda self, sid: _resolved(FakeSandbox()))
    assert asyncio.run(provider.heartbeat("sb-1")) is True
    assert seen == [e2b._RUNNING_TIMEOUT_S], \
        "the beat must AWAIT set_timeout with the same ceiling create() used"


def test_the_e2b_provider_returns_false_for_a_sandbox_that_is_gone(monkeypatch):
    from e2b.exceptions import SandboxNotFoundException

    from app.sandbox import e2b

    async def gone(self, sandbox_id):
        raise SandboxNotFoundException("deleted")

    provider = e2b.E2BProvider.__new__(e2b.E2BProvider)
    monkeypatch.setattr(e2b.E2BProvider, "_connect", gone)
    assert asyncio.run(provider.heartbeat("sb-1")) is False, \
        "the loop beats many; one deleted sandbox must not raise out of it"


def test_run_heartbeat_actually_beats_on_a_loop(monkeypatch):
    """`while True:` -> `while False:` left the whole suite green before this existed: a
    heartbeat that starts and never beats is indistinguishable from a working one."""
    provider = FakeProvider()
    beats: list[int] = []

    async def fake_beat(p, **kw):
        beats.append(1)
        if len(beats) >= 3:
            raise asyncio.CancelledError
        return 1

    monkeypatch.setattr(sandbox_heartbeat, "beat_once", fake_beat)

    async def no_sleep(_s):
        return None

    monkeypatch.setattr(sandbox_heartbeat.asyncio, "sleep", no_sleep)
    with pytest.raises(asyncio.CancelledError):
        asyncio.run(sandbox_heartbeat.run_heartbeat(provider, interval_s=0))
    assert len(beats) == 3, "the loop must keep beating, not beat once and return"


def test_the_lifespan_runs_the_loop_and_cancels_it():
    import inspect

    from app import main

    source = inspect.getsource(main.lifespan)
    assert "run_heartbeat" in source, "nothing beats unless the lifespan starts it"
    assert "heartbeat_task.cancel()" in source, \
        "an un-cancelled task keeps a test event loop alive and leaks between reloads"
