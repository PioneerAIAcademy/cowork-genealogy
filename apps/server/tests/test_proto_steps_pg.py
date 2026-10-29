"""Decision 28's measures over `turns`, against REAL Postgres.

Acceptance item 11: per-step p50/p90 wait, per-step spend and reply-per-boundary
queries return figures. These run here rather than against a fake because the
report is mostly SQL -- a LATERAL join for "the next turn on this session" and
the `step IS NOT NULL` partial index that serves it -- and a fake would be
asserting my own restatement of the query rather than the query.

Without the DSN the module skips -- except under ``CI``, where it fails, so the
job cannot pass by skipping.
"""

from __future__ import annotations

import sys
import uuid

import pytest
from psycopg.types.json import Jsonb

from tests._proto_pg import PROTO, database, sql

sys.path.insert(0, str(PROTO.parent))

from proto import steps  # noqa: E402


@pytest.fixture
def pg_steps_dsn():
    """A fresh database per test: these assert whole-table aggregates, so one
    test's turns would land in the next one's percentiles."""
    with database(prefix="steps_") as dsn:
        yield dsn


def _session(dsn: str) -> tuple[str, str]:
    sid, pid = "sess_" + uuid.uuid4().hex[:10], "proj_" + uuid.uuid4().hex[:10]
    sql(dsn, "INSERT INTO sessions (session_id, project_id) VALUES (%s, %s)", (sid, pid))
    return sid, pid


def _turn(
    dsn: str, sid: str, pid: str, text: str, *, seq: int, step=None, mode=None,
    wait_s: int = 0, tokens=(0, 0, 0, 0), auto: bool = False, completed: bool = True,
    outcome=None,
) -> str:
    """One turn, enqueued `seq` minutes apart so `enqueued_at` orders them, and
    closed `wait_s` after it was enqueued."""
    tid = "turn_" + uuid.uuid4().hex[:10]
    message = {"turn_id": tid, "session_id": sid, "project_id": pid, "text": text}
    if auto:
        message["auto"] = True
    sql(
        dsn,
        "INSERT INTO turns (turn_id, session_id, project_id, message, enqueued_at, completed_at, "
        "step, mode, input_tokens, cache_creation_tokens, cache_read_tokens, output_tokens, outcome) "
        "VALUES (%s, %s, %s, %s, now() + make_interval(mins => %s), "
        "CASE WHEN %s THEN now() + make_interval(mins => %s, secs => %s) END, %s, %s, %s, %s, %s, %s, %s)",
        (tid, sid, pid, Jsonb(message), seq, completed, seq, wait_s, step, mode, *tokens, outcome),
    )
    return tid


def _report(dsn: str, **kw) -> dict:
    """`steps.main`'s report, built the way the CLI builds it."""
    import argparse

    argv = ["--pg-dsn", dsn, "--json"] + [a for k, v in kw.items() for a in (f"--{k}", str(v))]
    parser_args = argparse.Namespace()
    # Call through the module's own entry point so the test covers argument
    # handling too, capturing stdout rather than re-implementing the assembly.
    import io
    import json
    from contextlib import redirect_stdout

    buf = io.StringIO()
    old = sys.argv
    sys.argv = ["steps.py"] + argv
    try:
        with redirect_stdout(buf):
            assert steps.main() == 0
    finally:
        sys.argv = old
    del parser_args
    return json.loads(buf.getvalue())


def test_per_step_wait_and_spend_are_reported_per_step(pg_steps_dsn):
    dsn = pg_steps_dsn
    sid, pid = _session(dsn)
    # Two search turns (10s and 30s) and one link turn (100s), with token counts
    # that price to something non-zero.
    _turn(dsn, sid, pid, "go", seq=1, step="search-records", wait_s=10, tokens=(1000, 0, 0, 100))
    _turn(dsn, sid, pid, "Continue.", seq=2, step="search-records", wait_s=30, tokens=(2000, 0, 0, 200))
    _turn(dsn, sid, pid, "Continue.", seq=3, step="person-evidence", wait_s=100, tokens=(5000, 0, 0, 500))

    r = _report(dsn)
    assert r["turns"] == 3
    assert r["wait_s"]["search-records"]["n"] == 2
    assert r["wait_s"]["search-records"]["p50"] == 10
    assert r["wait_s"]["search-records"]["p90"] == 30
    assert r["wait_s"]["person-evidence"]["p50"] == 100
    # Priced from the token columns, so every step shows a figure.
    assert r["spend_usd"]["search-records"]["total"] > 0
    assert r["spend_usd"]["person-evidence"]["total"] > r["spend_usd"]["search-records"]["p50"]


def test_spend_comes_from_the_token_columns_not_cost_usd(pg_steps_dsn):
    """`turns.cost_usd` is the completing attempt's figure, so a turn killed and
    redelivered leaves its earlier attempts' spend out of it. The token columns
    are summed over `session_entries` at close and include them, which is why
    decision 28 names them."""
    dsn = pg_steps_dsn
    sid, pid = _session(dsn)
    tid = _turn(dsn, sid, pid, "go", seq=1, step="search-records", wait_s=5, tokens=(1_000_000, 0, 0, 0))
    # A cost_usd that disagrees with the tokens: if the report read it, the
    # figure below would be 0.01 rather than the input rate for 1M tokens.
    sql(dsn, "UPDATE turns SET cost_usd = 0.01 WHERE turn_id = %s", (tid,))

    r = _report(dsn)
    assert r["spend_usd"]["search-records"]["total"] >= 1.0, r["spend_usd"]


def test_the_reply_each_boundary_got_is_counted_per_step(pg_steps_dsn):
    dsn = pg_steps_dsn
    sid, pid = _session(dsn)
    _turn(dsn, sid, pid, "go", seq=1, step="search-records", wait_s=5)
    _turn(dsn, sid, pid, "Continue.", seq=2, step="person-evidence", wait_s=5)
    _turn(dsn, sid, pid, "Keep going.", seq=3, step="research-exhaustiveness", wait_s=5, auto=True)
    _turn(dsn, sid, pid, "Wrap it up.", seq=4, step="proof-conclusion", wait_s=5)

    r = _report(dsn)
    # Each step is labelled by what came NEXT, not by its own message.
    assert r["replies"]["search-records"] == {"Continue.": 1}
    assert r["replies"]["person-evidence"] == {"Keep going. (host)": 1}, r["replies"]
    assert r["replies"]["research-exhaustiveness"] == {"Wrap it up.": 1}
    # The last turn has no successor: the run ended there.
    assert r["replies"]["proof-conclusion"] == {"none (run ended)": 1}


def test_a_host_wrap_up_is_the_host_s_and_a_typed_phrase_reads_as_step_mode_reads_it(pg_steps_dsn):
    """The host also sends "Wrap it up." (a second planning round), and that was being
    counted as the researcher's choice. And `step_mode` ignores case and trailing
    punctuation, so "Continue?" typed by hand is the Continue reply, not something else."""
    dsn = pg_steps_dsn
    sid, pid = _session(dsn)
    _turn(dsn, sid, pid, "go", seq=1, step="research-plan", wait_s=5)
    _turn(dsn, sid, pid, "Wrap it up.", seq=2, step="search-records", wait_s=5, auto=True)
    _turn(dsn, sid, pid, "continue?", seq=3, step="person-evidence", wait_s=5)

    r = _report(dsn)
    assert r["replies"]["research-plan"] == {"Wrap it up. (host)": 1}, r["replies"]
    assert r["replies"]["search-records"] == {"Continue.": 1}, r["replies"]


def test_a_superseded_host_reply_is_not_credited_as_the_answer(pg_steps_dsn):
    """A held `auto` reply the researcher's own message displaced closes
    `superseded`. It was never sent and nobody saw it, so counting it would
    report the boundary as answered by a reply that did not happen -- and would
    hide the researcher's real one, which is the next row after it."""
    dsn = pg_steps_dsn
    sid, pid = _session(dsn)
    _turn(dsn, sid, pid, "go", seq=1, step="search-records", wait_s=5)
    # The host queued "Keep going.", the researcher typed over it, and the held
    # row was superseded.
    _turn(dsn, sid, pid, "Keep going.", seq=2, auto=True, outcome="superseded")
    _turn(dsn, sid, pid, "Wrap it up.", seq=3, step="proof-conclusion", wait_s=5)

    r = _report(dsn)
    assert r["replies"]["search-records"] == {"Wrap it up.": 1}, r["replies"]


def test_a_typed_message_is_not_counted_as_a_reply_phrase(pg_steps_dsn):
    """Exact-phrase only, as `step_mode` reads it on the way in. A message that
    merely contains "keep going" started no job turn."""
    dsn = pg_steps_dsn
    sid, pid = _session(dsn)
    _turn(dsn, sid, pid, "go", seq=1, step="search-records", wait_s=5)
    _turn(dsn, sid, pid, "keep going but skip the census", seq=2, step="search-records", wait_s=5)

    r = _report(dsn)
    assert r["replies"]["search-records"] == {"typed (something else)": 1, "none (run ended)": 1}


def test_a_wrapup_turn_is_held_out_of_the_per_step_figures(pg_steps_dsn):
    """It runs several steps, so attributing its wait and spend to the one step
    it opened with would overstate that step."""
    dsn = pg_steps_dsn
    sid, pid = _session(dsn)
    _turn(dsn, sid, pid, "go", seq=1, step="search-records", wait_s=10, tokens=(1000, 0, 0, 100))
    _turn(dsn, sid, pid, "Wrap it up.", seq=2, step="research-plan", mode="wrapup",
          wait_s=900, tokens=(900_000, 0, 0, 90_000))

    r = _report(dsn)
    assert "research-plan" not in r["wait_s"], r["wait_s"]
    assert "research-plan" not in r["spend_usd"]
    assert r["wrapup_turns"]["n"] == 1
    assert r["wrapup_turns"]["wait_p50"] == 900
    assert r["wrapup_turns"]["spend_total"] > 1.0
    # The step turn's own figures are untouched by it.
    assert r["wait_s"]["search-records"]["p50"] == 10


def test_a_turn_that_ran_no_step_is_not_reported(pg_steps_dsn):
    """`step IS NULL` is a turn that spawned nothing — a question answered from
    the project, an upload. It belongs to no step's figures."""
    dsn = pg_steps_dsn
    sid, pid = _session(dsn)
    _turn(dsn, sid, pid, "what did you find?", seq=1, wait_s=5)
    r = _report(dsn)
    assert r["turns"] == 0 and r["steps"] == []


def test_an_open_turn_is_not_reported_until_it_closes(pg_steps_dsn):
    dsn = pg_steps_dsn
    sid, pid = _session(dsn)
    _turn(dsn, sid, pid, "go", seq=1, step="search-records", completed=False)
    assert _report(dsn)["turns"] == 0


def test_one_session_can_be_singled_out(pg_steps_dsn):
    dsn = pg_steps_dsn
    a_sid, a_pid = _session(dsn)
    b_sid, b_pid = _session(dsn)
    _turn(dsn, a_sid, a_pid, "go", seq=1, step="search-records", wait_s=5)
    _turn(dsn, b_sid, b_pid, "go", seq=1, step="person-evidence", wait_s=5)

    assert _report(dsn)["turns"] == 2
    assert _report(dsn, session=a_sid)["steps"] == ["search-records"]
