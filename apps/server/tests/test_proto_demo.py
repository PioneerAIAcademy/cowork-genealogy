"""Offline tests for D19's proto/demo.py: the opening prompt, the acceptance queries and their
rendering, the verdict, and the make target that runs it. No Postgres, no stack, no model."""

from __future__ import annotations

import argparse
import ast
import contextlib
import re
from pathlib import Path

import pytest

import httpx

from proto import bounds, demo, turn
from tests.test_proto_config import MAKEFILE, STEP_CEILING_S, _recipe

PROTO = MAKEFILE.parent / "apps" / "server" / "proto"

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
    # criterion 1 reads the redelivery counter D17 judges receive_count >= 2 from
    c1 = next(sql for label, sql, _ in qs if label.startswith("criterion 1"))
    assert "receive_count" in c1 and "completed_at" in c1 and "FROM turns" in c1
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




# ── verdict ─────────────────────────────────────────────────────────────────────────


@pytest.mark.parametrize("done, c3, reauth, code", [
    (True, True, False, 0),
    (False, True, False, 1),
    (True, False, False, 1),
    (True, True, True, 1),
])
def test_verdict(done, c3, reauth, code):
    assert demo.verdict(done, c3, reauth) == code






def test_project_status_is_read_by_the_same_sql_the_evidence_block_prints():
    # section_counts_sql cannot carry it: `project` is an object, and that query filters to
    # array-typed keys. The verdict's value must be the one the reader can re-run.
    assert "jsonb_typeof" not in demo.PROJECT_STATUS_SQL
    assert "doc->'project'->>'status'" in demo.PROJECT_STATUS_SQL
    assert demo.PROJECT_STATUS_SQL.count("%s") == 1
    printed = [sql for label, sql, _ in demo.acceptance_queries(*IDS) if "project.status" in label]
    assert printed == [demo.PROJECT_STATUS_SQL], "the status the verdict reads must be printed with its SQL"


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


# ── the grant (U3) ──────────────────────────────────────────────────────────────────


def _no_grant_db(dsn, sql, params):
    if sql == turn.GRANT_SQL:
        return []
    return [(1,)]


def test_scripts_refuse_to_run_without_a_grant(monkeypatch, capsys):
    """Without a grant every real turn would only end signin_required. Both scripts check
    up front, exit 2 and say what to run -- before anything is posted."""
    monkeypatch.setattr(turn.httpx, "get", lambda *a, **k: httpx.Response(200, json={"queue": "SqsQueue"},
                                                                         request=httpx.Request("GET", "http://x")))
    monkeypatch.setattr(turn, "db", _no_grant_db)
    monkeypatch.setattr(turn, "run", lambda *a, **k: (_ for _ in ()).throw(AssertionError("posted")))
    monkeypatch.setattr(turn, "run_kill", lambda *a, **k: (_ for _ in ()).throw(AssertionError("posted")))
    assert turn.main([]) == 2
    assert "make proto-grant EMAIL=dev@localhost" in capsys.readouterr().err
    assert turn.main(["--kill", "--email", "b@example.org"]) == 2
    assert "make proto-grant EMAIL=b@example.org" in capsys.readouterr().err
    monkeypatch.setattr(demo, "run", lambda args: (_ for _ in ()).throw(AssertionError("seeded")))
    assert demo.main([]) == 2
    assert "make proto-grant" in capsys.readouterr().err
    # With a grant the check is silent; a refused one is not a grant.
    assert turn.require_grant("dsn", "dev@localhost") is not None
    monkeypatch.setattr(turn, "db", lambda dsn, sql, params: [(1,)])
    assert turn.require_grant("dsn", "Dev@Localhost") is None
    assert "refresh_refused_at IS NULL" in turn.GRANT_SQL


def test_reauth_entry_hits_reads_full_tool_results(monkeypatch):
    """The summaries reauth_hits reads are cut at 160 chars, so an instruction deep in a long
    result is invisible there; this reads the whole tool_result. Only the engine's two
    anchors: record text has page and film numbers \\b401\\b would flag."""
    pad = "x" * 300
    entries = [
        ({"type": "user", "message": {"content": [{"type": "tool_result", "content": pad + " Call the login tool to authenticate."}]}},),
        ({"type": "user", "message": {"content": [{"type": "tool_result", "content": [
            {"type": "text", "text": "census page 401, film 1234401"}]}]}},),
        ({"type": "assistant", "message": {"content": [{"type": "text", "text": "Reconnect FamilySearch?"}]}},),
        ({"type": "user", "message": {"content": [{"type": "tool_result", "content": [
            {"type": "text", "text": pad}, {"type": "text", "text": 'Click "Reconnect FamilySearch" at the top'}]}]}},),
    ]
    seen = []

    def fake_db(dsn, sql, params):
        seen.append((sql, params))
        return entries

    monkeypatch.setattr(turn, "db", fake_db)
    hits = turn.reauth_entry_hits("dsn", "sdk-1", "turn-1")
    assert len(hits) == 2, hits
    assert "Call the login tool" in hits[0] and "Reconnect FamilySearch" in hits[1]
    [(sql, params)] = seen
    assert params == ("sdk-1", "turn-1") and "entries_seq_before" in sql and "subpath" not in sql, \
        "every subpath (delegated agents' too), above the turn's high-water mark"
    assert turn.reauth_entry_hits("dsn", None, "turn-1") == []
    assert not turn.REAUTH_ENTRY.search("page 401") and turn.REAUTH_HITS.search("HTTP 401")
    assert demo.REAUTH is turn.REAUTH_HITS and demo.reauth_hits is turn.reauth_hits


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
    blocked = re.search(r'export BLOCKED_TOOLS="\$\$\{BLOCKED_TOOLS-([^}]*)\}"', body)  # raw make text: $$ is the shell's $
    assert blocked, body
    assert {p.strip() for p in blocked.group(1).split(",") if p.strip()} == _harness_constant("BLOCKED_TREE_TOOLS"), \
        "proto-demo's BLOCKED_TOOLS default is the harness's BLOCKED_TREE_TOOLS (orchestrator.py): re-sync the Makefile"
    # The worker blocks by bare name only; it has no copy of the harness's argument-decided map.
    assert _harness_constant("LIVE_TREE_ARG_TOOLS") == {}, \
        "orchestrator.py's LIVE_TREE_ARG_TOOLS is no longer empty: the worker blocks by bare name " \
        "only (BLOCKED_TOOLS), so an argument-decided block needs a worker port before proto-demo compares"


def test_proto_test_runs_the_d17_and_demo_suites():
    body = "\n".join(_recipe("proto-test"))
    for name in ("tests/test_proto_d17.py", "tests/test_proto_demo.py", "tests/test_proto_kill.py"):
        assert name in body, f"make proto-test does not run {name}"


ORCHESTRATOR = Path(__file__).resolve().parents[3] / "eval" / "harness" / "e2e" / "orchestrator.py"


def _harness_constant(name: str):
    """A module-level literal in orchestrator.py, read by AST (the harness is not importable
    here); a ``frozenset({...})`` call reads as its set."""
    for node in ast.parse(ORCHESTRATOR.read_text(encoding="utf-8")).body:
        if isinstance(node, ast.Assign) and [getattr(t, "id", None) for t in node.targets] == [name]:
            value = node.value
            if isinstance(value, ast.Call) and getattr(value.func, "id", None) == "frozenset" and len(value.args) == 1:
                value = value.args[0]
            return ast.literal_eval(value)
    raise AssertionError(f"orchestrator.py has no module-level {name}")


























def _recipe_commands(body: list[str]) -> list[str]:
    """A recipe's shell commands, split on ``&&``, ``;`` and ``||``, so a reflowed or
    re-indented recipe reads the same (test_proto_bounds reads recipes with it too)."""
    return [c.strip() for line in body for c in re.split(r"&&|;|\|\|", line) if c.strip()]


def test_the_resume_probe_target_wires_both_missing_pieces():
    """0a's probe fires only if both line up (the nudge cap that was a third went with the
    Stop veto, step mode phase 2), and either one missing looks identical to
    "the model never delegated" -- an hour of billed run, no kill, no finding. So the
    recipe is asserted rather than left to whoever types the command. U23 moved it onto
    proto-bounds' probe_resume case: the worker foregrounds every delegation, so the old
    `run_in_background=true` input selector could no longer pick one."""
    body = "\n".join(_recipe("proto-probe-resume"))
    # 1. the selector: the case that kills at the first SUBAGENT row (test_proto_bounds
    #    pins that it waits on agent_id IS NOT NULL), inside its 5-20 s window by default.
    assert re.search(r"\$\(MAKE\) proto-bounds CASE=probe_resume\b", body), body
    assert bounds.CASES["probe_resume"] is bounds.case_probe_resume
    after = re.search(r"--kill-after-s \$\$\{KILL_AFTER_S-(\d+(?:\.\d+)?)\}", body)
    lo, hi = bounds.KILL_AFTER_RANGE_S
    assert after and lo <= float(after.group(1)) <= hi, body
    # 2. a message that provokes two delegations. bounds.py names it; repointing it at a
    #    file that does not exist reds this instead of failing an hour into a billed run.
    assert bounds.RESUME_TEXT.is_file(), f"{bounds.RESUME_TEXT} is not in the repo"
    assert bounds.RESUME_TEXT.read_text(encoding="utf-8").strip(), f"{bounds.RESUME_TEXT} is empty"
    assert re.search(r'test -n "\$\(SESSION\)"', body), "refuse without SESSION rather than probe a fresh project"
    assert re.search(r'SESSION="\$\(SESSION\)"', body), "the session must reach proto-bounds"
    rule = re.search(r"^proto-probe-resume:.*?##(.*)$", MAKEFILE.read_text(encoding="utf-8"), re.M)
    assert rule and "billed" in rule.group(1), "`make help` must say this one costs money"


def test_proto_export_target_requires_a_session_and_runs_the_script():
    body = "\n".join(_recipe("proto-export"))
    assert re.search(r'test -n "\$\(SESSION\)"', body), "refuse without SESSION rather than export nothing"
    assert "proto/export.py" in body and "--session '$(SESSION)'" in body
    assert re.search(r"\$\(if \$\(OUT\),\s*--out '\$\(abspath \$\(OUT\)\)',\s*\)", body), \
        "OUT is resolved against the repo root before the cd into apps/server"


# ── run(): the verdict is wired to the row, not just correct in isolation ──


def _fake_stack(monkeypatch, status: str | None):
    """Every side effect of demo.run() answered from memory: a seeded session, a posted turn
    that reaches turn_done, a clean audit, no reauth hit, and `status` as the project's."""
    monkeypatch.setattr(demo, "preflight", lambda base, dsn: None)
    monkeypatch.setattr(demo, "seed_session", lambda args: ("sess_1", "proj_1", {"researcher_question": "Who?"}))
    monkeypatch.setattr(demo.turn, "post_message", lambda client, base, session_id, text: "turn_1")
    monkeypatch.setattr(demo, "wait_turn_done", lambda *a: 1.0)
    monkeypatch.setattr(demo, "reply_text", lambda dsn, session_id, turn_id: (0, "done"))
    monkeypatch.setattr(demo, "reauth_hits", lambda dsn, session_id, since: [])
    monkeypatch.setattr(demo.audit, "load", lambda dsn, session_id: [])
    monkeypatch.setattr(demo.turn, "signed_in_client", lambda base, email, **kw: contextlib.nullcontext())

    def rows(dsn, sql, params):
        if sql == demo.PROJECT_STATUS_SQL:
            return [(status,)] if status is not None else []
        return []

    monkeypatch.setattr(demo, "rows", rows)


def _args(**over):
    base = dict(base="http://x", pg_dsn="dsn", s3_endpoint="s3", deadline_s=1.0, anchor="/project",
                ceiling_s=1800.0, session=None, prompt=None, fixture="fx", fixture_given=False,
                project_id=None, title=None, email="dev@localhost")
    base.update(over)
    return argparse.Namespace(**base)




# ── seed_session: who creates the project ──


class _SessionClient:
    def __init__(self, calls: list):
        self.calls = calls

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def post(self, path, json):
        self.calls.append(("post", dict(json)))
        return httpx.Response(200, json={"id": "sess_9"}, request=httpx.Request("POST", "http://t" + path))


def _seed_fakes(monkeypatch, calls: list):
    monkeypatch.setattr(demo.seed, "resolve_fixture", lambda name: Path("bagley-father-1884"))
    monkeypatch.setattr(demo.seed, "plan_files", lambda fixture: [])
    monkeypatch.setattr(demo.seed, "fixture_meta", lambda fixture: {"name": "Bagley"})
    monkeypatch.setattr(demo.seed, "default_project_id", lambda fixture: "proj_chosen")
    monkeypatch.setattr(demo.seed, "seed", lambda files, **kw: calls.append(("seed", kw["project_id"])) or 0)
    monkeypatch.setattr(demo.turn, "signed_in_client", lambda base, email, **kw: _SessionClient(calls))
    monkeypatch.setattr(demo, "rows", lambda dsn, sql, params: [("proj_tier_made",)])


def _seed_args(**over):
    return argparse.Namespace(**{"fixture": "bagley-father-1884", "project_id": None, "title": None,
                                 "base": "http://t", "email": "e@x", "pg_dsn": "dsn", "s3_endpoint": "s3", **over})


@pytest.mark.parametrize("status", ["active", "completed", None])
def test_run_passes_one_turn_whatever_the_projects_status(monkeypatch, capsys, status):
    """One turn of proto-demo is one step; it is not expected to finish a project."""
    _fake_stack(monkeypatch, status)
    assert demo.run(_args()) == 0
    out = capsys.readouterr().out
    assert f"project.status={status}" in out, "the value the run read must be printed"
    assert "PASS" in out.splitlines()[-1]


def test_no_proto_target_sets_the_deleted_nudge_cap():
    """The Stop veto is deleted (step mode phase 2), so no recipe exports its cap, and
    proto-demo-auto, the arm that existed to exercise it, is retired."""
    text = MAKEFILE.read_text(encoding="utf-8")
    assert "AUTONOMOUS_MAX_NUDGES" not in text
    assert not re.search(r"^proto-demo-auto:", text, re.M)


def test_seed_session_under_dev_login_seeds_the_chosen_id_then_claims_it(monkeypatch):
    calls: list = []
    monkeypatch.delenv(demo.turn.COOKIE_FILE_ENV, raising=False)
    _seed_fakes(monkeypatch, calls)
    assert demo.seed_session(_seed_args()) == ("sess_9", "proj_chosen", {"name": "Bagley"})
    assert calls == [("seed", "proj_chosen"), ("post", {"title": "Bagley", "project_id": "proj_chosen"})]


def test_seed_session_under_familysearch_signin_opens_the_session_first_and_seeds_its_project(monkeypatch):
    calls: list = []
    monkeypatch.setenv(demo.turn.COOKIE_FILE_ENV, "/cookie")
    _seed_fakes(monkeypatch, calls)
    assert demo.seed_session(_seed_args()) == ("sess_9", "proj_tier_made", {"name": "Bagley"})
    assert calls == [("post", {"title": "Bagley"}), ("seed", "proj_tier_made")]


def test_seed_session_under_familysearch_signin_refuses_a_chosen_project_id(monkeypatch):
    calls: list = []
    monkeypatch.setenv(demo.turn.COOKIE_FILE_ENV, "/cookie")
    _seed_fakes(monkeypatch, calls)
    with pytest.raises(RuntimeError, match="needs dev-login"):
        demo.seed_session(_seed_args(project_id="proj_x"))
    assert calls == []
