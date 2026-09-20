"""Offline tests for D19's proto/demo.py: the opening prompt, the acceptance queries and their
rendering, the verdict, and the make target that runs it. No Postgres, no stack, no model."""

from __future__ import annotations

import re
from pathlib import Path

import pytest

import httpx

from proto import demo, turn
from tests.test_proto_config import COMPOSE, STEP_CEILING_S, _env, _load, _recipe, _service

IDS = ("turn_x", "sess_y", "proj_z")


# ── opening prompt ──────────────────────────────────────────────────────────────────


def test_opening_prompt_uses_the_fixture_question_unless_overridden():
    # The harness's own message (orchestrator.py), so the run compares with the e2e corpus
    # instead of answering the bare question off the live tree.
    meta = {"researcher_question": "Who was the father of William A. Bagley?"}
    assert demo.opening_prompt(meta, None) == "/research --autonomous Who was the father of William A. Bagley?"
    assert demo.opening_prompt(meta, "  Find his mother.  ") == "Find his mother.", "--prompt is verbatim"


def test_opening_prompt_refuses_a_fixture_without_a_question():
    with pytest.raises(ValueError, match="--prompt"):
        demo.opening_prompt({}, None)
    with pytest.raises(ValueError):
        demo.opening_prompt({"researcher_question": "   "}, "")


# ── acceptance queries ──────────────────────────────────────────────────────────────


def test_acceptance_queries_cover_the_criteria_and_bind_only_their_ids():
    qs = demo.acceptance_queries(*IDS)
    labels = " | ".join(label for label, _, _ in qs)
    assert "criterion 1" in labels and "criterion 2" in labels and "tokens" in labels
    for label, sql, params in qs:
        assert sql.lstrip().upper().startswith("SELECT"), label
        assert sql.count("%s") == len(params), label
        assert set(params) <= set(IDS), label
    # criterion 1 reads the redelivery counter D17 judges receive_count >= 2 from, and the
    # D18 arm's veto count
    c1 = next(sql for label, sql, _ in qs if label.startswith("criterion 1"))
    assert "receive_count" in c1 and "completed_at" in c1 and "FROM turns" in c1
    assert re.search(r"\bnudges\b", c1), "the turns row shows whether the Stop hook vetoed anything"
    # the token query names every column turn.py sums
    tok = next(sql for label, sql, _ in qs if label.startswith("tokens"))
    assert all(c in tok for c in turn.TOKEN_COLUMNS)


def test_section_counts_sql_counts_every_array_key_without_a_section_list():
    sql = demo.section_counts_sql()
    assert "jsonb_object_keys" in sql and "jsonb_typeof" in sql and "'array'" in sql
    assert "jsonb_array_length" in sql and sql.count("%s") == 1
    assert "'sources'" not in sql  # generic: no hand-picked section names


# ── rendering ───────────────────────────────────────────────────────────────────────


def test_render_query_prints_label_pasteable_sql_and_rows():
    out = demo.render_query("criterion 1: turns", "SELECT a FROM t WHERE id = %s AND s = %s",
                            ("x'y", "z"), [(1, "ok"), (2, None)])
    lines = out.splitlines()
    assert lines[0] == "-- criterion 1: turns"
    assert lines[1] == "SELECT a FROM t WHERE id = 'x''y' AND s = 'z'"  # psql-ready, quote doubled
    assert lines[2].strip() == "1  ok" and lines[3].strip() == "2  None"


def test_render_query_substitutes_each_placeholder_once_even_when_a_param_contains_one():
    out = demo.render_query("l", "WHERE id = %s AND s = %s", ("x%sy", "Z"), [])
    assert out.splitlines()[1] == "WHERE id = 'x%sy' AND s = 'Z'"


def test_render_query_says_no_rows_rather_than_nothing():
    out = demo.render_query("l", "SELECT 1 WHERE false", (), [])
    assert out.splitlines()[-1].strip() == "(no rows)"


def test_nudges_line_shows_the_rows_count_and_the_cap_or_off():
    assert demo.nudges_line(3, "20") == "nudges      3  (cap 20)"
    assert demo.nudges_line(0, None) == "nudges      0  (cap off)"
    assert demo.nudges_line(0, "0") == "nudges      0  (cap off)", "AUTONOMOUS_MAX_NUDGES=0 is off"
    assert demo.nudges_line(0, " ") == "nudges      0  (cap off)"
    assert demo.nudges_line(None, "20") == "nudges      ?  (cap 20)", "a row with no count (a turn that never completed)"


# ── verdict ─────────────────────────────────────────────────────────────────────────


@pytest.mark.parametrize("done, c3, reauth, code", [
    (True, True, False, 0),
    (False, True, False, 1),
    (True, False, False, 1),
    (True, True, True, 1),
])
def test_verdict(done, c3, reauth, code):
    assert demo.verdict(done, c3, reauth) == code


def test_default_deadline_covers_one_shim_driven_resume():
    # READ_TIMEOUT_S is one step ceiling per attempt; a one-ceiling deadline reports FAIL as attempt 2 begins
    assert demo.DEFAULT_DEADLINE_S > 2 * STEP_CEILING_S


# ── the reauth void check ───────────────────────────────────────────────────────────


@pytest.mark.parametrize("summary", [
    "User is not logged in to FamilySearch. Call the login tool to authenticate.",
    "FamilySearch session has expired and refresh failed. Call the login tool to re-authenticate.",
    'Click "Reconnect FamilySearch" at the top of the app to sign in again',
    "Error: 401 Unauthorized",
])
def test_reauth_matches_what_the_auth_module_actually_says(summary):
    assert demo.REAUTH.search(summary)


@pytest.mark.parametrize("summary", [
    "Authenticated copy of the will of David Bagley",   # record text turn.REAUTH would flag
    "the Login family of Vermont",
    "No login required for this collection",
])
def test_reauth_ignores_record_text_that_merely_mentions_logins(summary):
    assert not demo.REAUTH.search(summary)
    assert turn.REAUTH.search(summary)  # the D14 arm's regex, scoped to one tool there, does flag it


# ── the poll rides out transient tier faults ────────────────────────────────────────


def test_wait_turn_done_retries_a_transient_fault_then_returns(monkeypatch):
    calls = []

    def flaky(client, base, session_id, turn_id, deadline_s):
        calls.append(deadline_s)
        if len(calls) == 1:
            raise httpx.ConnectError("tier restarting")
        if len(calls) == 2:
            raise KeyError("events")
        return 7, 0.1

    monkeypatch.setattr(demo.turn, "wait_turn_done", flaky)
    monkeypatch.setattr(demo.time, "sleep", lambda s: None)
    assert demo.wait_turn_done(None, "http://x", "s", "t", 60.0) >= 0
    assert len(calls) == 3 and calls[0] <= 60.0


def test_wait_turn_done_gives_up_at_the_deadline(monkeypatch):
    monkeypatch.setattr(demo.turn, "wait_turn_done", lambda *a: (_ for _ in ()).throw(httpx.ConnectError("down")))
    monkeypatch.setattr(demo.time, "sleep", lambda s: None)
    clock = iter([0.0, 0.0, 1.0, 5.0, 5.0, 10.0])
    monkeypatch.setattr(demo.time, "monotonic", lambda: next(clock))
    with pytest.raises(TimeoutError):
        demo.wait_turn_done(None, "http://x", "s", "t", 3.0)


# ── the make targets ────────────────────────────────────────────────────────────────


def test_proto_demo_target_brings_the_stack_up_and_runs_the_script():
    body = "\n".join(_recipe("proto-demo"))
    assert "apps/server/proto/env.sh" in body, "the recipe must source env.sh (model key + FS token)"
    assert "ANTHROPIC_API_KEY" in body, "refuse without a model key, as proto-turn does"
    assert re.search(r"up -d --wait .*\bworker\b.*\bshim\b.*\bweb\b", body), "wait for worker, shim and web"
    assert "proto/demo.py" in body
    # --fixture is passed only when FIXTURE is set: `make proto-demo ARGS="--session <id>"` must not
    # load the default fixture's question into someone else's session (the script defaults it)
    assert re.search(r"\$\(if \$\(FIXTURE\),\s*--fixture '\$\(FIXTURE\)',\s*\)", body), body
    assert "bagley-father-1884" not in body and demo.DEFAULT_FIXTURE == "bagley-father-1884"
    # The harness's tree-read block reaches the worker, and an explicit empty value lifts it.
    assert re.search(r'export BLOCKED_TOOLS="\$\$\{BLOCKED_TOOLS-', body), body  # raw make text: $$ is the shell's $
    for tool in ("person_read", "person_search", "person_ancestors", "person_record_matches", "person_person_matches"):
        assert tool in body, tool


def test_proto_test_runs_the_d17_and_demo_suites():
    body = "\n".join(_recipe("proto-test"))
    for name in ("tests/test_proto_d17.py", "tests/test_proto_demo.py", "tests/test_proto_kill.py"):
        assert name in body, f"make proto-test does not run {name}"


ORCHESTRATOR = Path(__file__).resolve().parents[3] / "eval" / "harness" / "e2e" / "orchestrator.py"


def test_proto_demo_auto_exports_the_harness_cap_and_delegates_to_proto_demo():
    body = "\n".join(_recipe("proto-demo-auto"))
    # raw make text: $$ is the shell's $; `-20` (not `:-20`) so an explicit empty value is honoured as given
    cap = re.search(r'export AUTONOMOUS_MAX_NUDGES="\$\$\{AUTONOMOUS_MAX_NUDGES-(\d+)\}"', body)
    assert cap, body
    harness = re.search(r"^\s*max_continue_nudges: int = (\d+)", ORCHESTRATOR.read_text(encoding="utf-8"), re.M)
    # The literal is the tripwire, not the invariant: the arm's default IS the harness's
    # cap, and pinning the number too means a harness change lands here for a person to
    # read rather than silently widening the arm (it moved 20 -> 40 on 2026-09-20).
    assert harness and cap.group(1) == harness.group(1) == "40", \
        "the arm's default cap is the harness's max_continue_nudges: re-sync both, and the plan's D18 note"
    assert re.search(r'\$\(MAKE\) proto-demo FIXTURE="\$\(FIXTURE\)" ARGS="[^"]*\$\(ARGS\)"', body), body
    assert "AUTONOMOUS_MAX_NUDGES" not in "\n".join(_recipe("proto-demo")), "proto-demo itself stays a one-turn run"


def test_proto_demo_auto_raises_the_per_attempt_ceiling_and_sizes_its_deadline_to_it():
    """One message is a whole run on this arm, so it alone exports READ_TIMEOUT_S (7200, the
    lead's call 2026-09-20) into the `up` that recreates the shim, and passes a deadline
    spanning one shim-driven resume; every other target runs at the compose default."""
    body = "\n".join(_recipe("proto-demo-auto"))
    # `:-` on both sides: an explicitly empty READ_TIMEOUT_S means 7200 here as it means 1800
    # in compose's fallback -- never sh arithmetic reading "" as 0 (`--deadline-s 300`)
    # against a shim compose left at 1800.
    ceiling = re.search(r'export READ_TIMEOUT_S="\$\$\{READ_TIMEOUT_S:-(\d+)\}"', body)
    assert ceiling, body
    assert int(ceiling.group(1)) == 7200 > STEP_CEILING_S
    assert _env(_service(_load(COMPOSE), "shim"))["READ_TIMEOUT_S"].startswith("${READ_TIMEOUT_S:-"), \
        "compose must fall back on an empty READ_TIMEOUT_S too"
    assert re.search(r'ARGS="--deadline-s \$\$\(\(2 \* READ_TIMEOUT_S \+ 300\)\) \$\(ARGS\)"', body), body
    for target in ("proto-demo", "proto-turn", "proto-kill"):
        assert "READ_TIMEOUT_S" not in "\n".join(_recipe(target)), f"{target} keeps the pinned 1800 s ceiling"


def test_proto_export_target_requires_a_session_and_runs_the_script():
    body = "\n".join(_recipe("proto-export"))
    assert re.search(r'test -n "\$\(SESSION\)"', body), "refuse without SESSION rather than export nothing"
    assert "proto/export.py" in body and "--session '$(SESSION)'" in body
    assert re.search(r"\$\(if \$\(OUT\),\s*--out '\$\(abspath \$\(OUT\)\)',\s*\)", body), \
        "OUT is resolved against the repo root before the cd into apps/server"
