"""Offline tests for D19's proto/demo.py: the opening prompt, the acceptance queries and their
rendering, the verdict, and the make target that runs it. No Postgres, no stack, no model."""

from __future__ import annotations

import argparse
import contextlib
import os
import pathlib
import re
import subprocess
from pathlib import Path

import pytest

import httpx

from proto import demo, turn
from tests.test_proto_config import COMPOSE, MAKEFILE, STEP_CEILING_S, _env, _load, _recipe, _service

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


@pytest.mark.parametrize("autonomous, completed, code", [
    # The 2026-09-20 run: the Stop hook was never consulted, the project never completed,
    # and the arm said PASS. On the autonomous arm an unfinished project is a FAIL.
    (True, False, 1),
    (True, True, 0),
    # One turn of proto-demo is not expected to finish a project.
    (False, False, 0),
    (False, True, 0),
])
def test_verdict_requires_a_completed_project_on_the_autonomous_arm_only(autonomous, completed, code):
    assert demo.verdict(True, True, False, autonomous=autonomous, completed=completed) == code
    # The other three clauses still bind on either arm.
    for done, c3, reauth in ((False, True, False), (True, False, False), (True, True, True)):
        assert demo.verdict(done, c3, reauth, autonomous=autonomous, completed=completed) == 1


def test_autonomous_arm_reads_the_cap_the_way_the_nudges_line_does():
    for cap in ("40", "1", " 40 "):
        assert demo.autonomous_arm(cap), cap
    for cap in (None, "", " ", "0"):
        assert not demo.autonomous_arm(cap), cap
    # One definition: the verdict and the printed line cannot disagree about which arm ran.
    assert demo.nudges_line(0, "0").endswith("(cap off)") and not demo.autonomous_arm("0")
    assert demo.nudges_line(2, "40").endswith("(cap 40)") and demo.autonomous_arm("40")


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
    for tool in ("person_read", "person_search", "person_ancestors", "person_record_matches", "person_person_matches", "person_quality"):
        assert tool in body, tool


def test_proto_test_runs_the_d17_and_demo_suites():
    body = "\n".join(_recipe("proto-test"))
    for name in ("tests/test_proto_d17.py", "tests/test_proto_demo.py", "tests/test_proto_kill.py"):
        assert name in body, f"make proto-test does not run {name}"


ORCHESTRATOR = Path(__file__).resolve().parents[3] / "eval" / "harness" / "e2e" / "orchestrator.py"


def test_proto_demo_auto_exports_the_harness_cap_and_delegates_to_proto_demo():
    body = "\n".join(_recipe("proto-demo-auto"))
    # raw make text: $$ is the shell's $. `:-`, not `-`: proto-demo now resolves an empty
    # value to 0, so a `-40` here would hand it "" and the auto arm would run with the hook off.
    cap = re.search(r'export AUTONOMOUS_MAX_NUDGES="\$\$\{AUTONOMOUS_MAX_NUDGES:-(\d+)\}"', body)
    assert cap, body
    harness = re.search(r"^\s*max_continue_nudges: int = (\d+)", ORCHESTRATOR.read_text(encoding="utf-8"), re.M)
    # The literal is the tripwire, not the invariant: the arm's default IS the harness's
    # cap, and pinning the number too means a harness change lands here for a person to
    # read rather than silently widening the arm (it moved 20 -> 40 on 2026-09-20).
    assert harness and cap.group(1) == harness.group(1) == "40", \
        "the arm's default cap is the harness's max_continue_nudges: re-sync both, and the plan's D18 note"
    # `make help` prints the rule line's `##` text, which no recipe read reaches -- so it is
    # where the number went stale when the harness moved 20 -> 40 on 2026-09-20.
    rule = re.search(r"^proto-demo-auto:.*?##(.*)$", MAKEFILE.read_text(encoding="utf-8"), re.M)
    assert rule, "proto-demo-auto lost its ## help text: `make help` would stop listing it"
    assert f"default {cap.group(1)}" in rule.group(1), \
        f"`make help` says {rule.group(1).strip()!r}, which no longer matches the exported cap"
    assert re.search(r'\$\(MAKE\) proto-demo FIXTURE="\$\(FIXTURE\)" ARGS="[^"]*\$\(ARGS\)"', body), body
    # 1a moved the DEFAULT: the web service now carries AUTONOMOUS_MAX_NUDGES with a
    # non-zero interpolation default, so silence no longer means 0 and proto-demo has to
    # pin its own -- `:-0`, which keeps proto-demo-auto's non-empty export exactly as `-0`
    # did; the two differ only on an empty value, which `-0` handed to compose's `:-60`.
    assert _pins_nudges_before_compose_up(_recipe("proto-demo")), \
        "proto-demo must pin 0 itself to stay a one-turn run, now that the compose default is not 0"
    web_default = _env(_service(_load(COMPOSE), "web")).get("AUTONOMOUS_MAX_NUDGES", "")
    assert web_default.startswith("${AUTONOMOUS_MAX_NUDGES:-"), \
        "the web tier carries the cap (1a); proto-demo's pin is only meaningful against it"
    assert web_default != "${AUTONOMOUS_MAX_NUDGES:-0}", \
        "a 0 default here would ship the stop-every-step behaviour the plan exists to remove"


def test_proto_kill_pins_a_one_turn_run_unless_the_caller_sets_nudges():
    """The web tier stamps its own cap on every message (1a, default 60), so a kill turn
    left on that default is nudged as an autonomous run on its redelivery and, with no
    project, ends no_progress -- the kill check then FAILs on a resume that worked
    (2026-09-30, the U5 SIGTERM run). proto-probe-resume still passes its own 40."""
    kill = "\n".join(_recipe("proto-kill"))
    assert re.search(r'AUTONOMOUS_MAX_NUDGES="\$\$\{AUTONOMOUS_MAX_NUDGES:?-0\}" \$\(MAKE\) proto-turn', kill), kill
    probe = "\n".join(_recipe("proto-probe-resume"))
    assert re.search(r'AUTONOMOUS_MAX_NUDGES="\$\$\{AUTONOMOUS_MAX_NUDGES:-40\}" \$\(MAKE\) proto-kill', probe), probe


_PIN = re.compile(r"""^export AUTONOMOUS_MAX_NUDGES=(["']?)\$\$\{AUTONOMOUS_MAX_NUDGES:?-0\}\1$""")
_COMPOSE_UP = re.compile(r"^\$\(PROTO_COMPOSE\)\s+up\b")


def _recipe_commands(body: list[str]) -> list[str]:
    return [c.strip() for line in body for c in re.split(r"&&|;|\|\|", line) if c.strip()]


def _pins_nudges_before_compose_up(body: list[str]) -> bool:
    """Whether a recipe exports AUTONOMOUS_MAX_NUDGES with a 0 default (an outer setting
    wins) as its own shell command before its first `$(PROTO_COMPOSE) up`, which is where
    the web and worker containers take their environment -- read command by command, so a
    reflowed or re-indented recipe still reads the same. env.sh never touches the name, so
    where the pin sits relative to it does not matter."""
    commands = _recipe_commands(body)
    pin = next((i for i, c in enumerate(commands) if _PIN.match(c)), None)
    up = next((i for i, c in enumerate(commands) if _COMPOSE_UP.match(c)), None)
    return pin is not None and up is not None and pin < up


def test_proto_turn_pins_the_stop_hook_off_before_compose_up():
    """The web tier stamps its own cap (default 60) on every message and the worker prefers
    it, so a proto-turn left on that default ran with the Stop hook on: a lookup on a
    project-less session is never "completed", every stop is vetoed, and the turn ends
    no_progress. proto-kill's own pin covers only the --kill arm."""
    assert _pins_nudges_before_compose_up(_recipe("proto-turn")), "\n".join(_recipe("proto-turn"))
    assert "AUTONOMOUS_MAX_NUDGES" not in (PROTO / "env.sh").read_text(encoding="utf-8"), \
        "env.sh now touches AUTONOMOUS_MAX_NUDGES: the pin's place relative to it matters again"


_CAP_DEFAULT = re.compile(r"""AUTONOMOUS_MAX_NUDGES=(["']?)\$\$\{AUTONOMOUS_MAX_NUDGES:?-\d+\}\1""")
_DELEGATES = re.compile(r"\$\(MAKE\) (proto-[\w-]+)")


def _sh_resolve(assignment: str, caller: str | None) -> str:
    """What sh makes of a recipe's ``AUTONOMOUS_MAX_NUDGES=…`` given the caller's value
    (None: unset)."""
    env = {k: v for k, v in os.environ.items() if k != "AUTONOMOUS_MAX_NUDGES"}
    if caller is not None:
        env["AUTONOMOUS_MAX_NUDGES"] = caller
    script = "export " + assignment.replace("$$", "$") + '; printf %s "$AUTONOMOUS_MAX_NUDGES"'
    out = subprocess.run(["sh", "-c", script], env=env, capture_output=True, text=True,
                         encoding="utf-8", check=True)
    return out.stdout


def _cap_reaching_compose(target: str, caller: str | None) -> str:
    """The AUTONOMOUS_MAX_NUDGES a `make <target>` hands compose: each recipe's own
    default evaluated by sh, then the target its `$(MAKE)` delegates to, until one that
    runs compose itself."""
    value = caller
    for _ in range(5):
        body = "\n".join(_recipe(target))
        cap = _CAP_DEFAULT.search(body)
        assert cap, f"{target} sets no AUTONOMOUS_MAX_NUDGES default"
        value = _sh_resolve(cap.group(0), value)
        delegate = _DELEGATES.search(body)
        if delegate is None:
            return value
        target = delegate.group(1)
    raise AssertionError("delegation deeper than five targets")


@pytest.mark.parametrize("target, default", [
    ("proto-turn", "0"), ("proto-kill", "0"), ("proto-demo", "0"),
    ("proto-demo-auto", "40"), ("proto-probe-resume", "40"),
])
@pytest.mark.parametrize("caller", [None, "", "7"])
def test_every_proto_target_resolves_unset_and_empty_to_its_default_and_keeps_a_callers_value(
    target, default, caller,
):
    """An empty value is the hole `-0` leaves: it survives the pin, compose's `:-60` turns
    it into 60 on the web tier, and a one-turn run ends no_progress. Followed through the
    delegation, because proto-kill's `-0` hands "" on to proto-turn (whose `:-0` makes it
    0), and a `-40` on an arm that needs the hook ON would hand "" to a `:-0` and run it
    off -- an hour of billed proto-probe-resume that cannot fire."""
    assert _cap_reaching_compose(target, caller) == (caller or default)


@pytest.mark.parametrize("body, expected", [
    (['\texport AUTONOMOUS_MAX_NUDGES="$${AUTONOMOUS_MAX_NUDGES:-0}"; . apps/server/proto/env.sh && \\',
      "\t  $(PROTO_COMPOSE) up -d --build"], True),
    (["\texport AUTONOMOUS_MAX_NUDGES=$${AUTONOMOUS_MAX_NUDGES-0} && \\", "\t$(PROTO_COMPOSE)  up -d"], True),
    (["\t. apps/server/proto/env.sh && \\", '\t  export AUTONOMOUS_MAX_NUDGES="$${AUTONOMOUS_MAX_NUDGES:-0}"; \\',
      "\t  $(PROTO_COMPOSE) up -d --build"], True),
    (["\t$(PROTO_COMPOSE) up -d --build && \\", '\texport AUTONOMOUS_MAX_NUDGES="$${AUTONOMOUS_MAX_NUDGES:-0}"'], False),
    (['\texport AUTONOMOUS_MAX_NUDGES="$${AUTONOMOUS_MAX_NUDGES:-60}"; $(PROTO_COMPOSE) up -d'], False),
    (['\texport AUTONOMOUS_MAX_NUDGES="$${AUTONOMOUS_MAX_NUDGES-60}"; $(PROTO_COMPOSE) up -d'], False),
    (['\t# export AUTONOMOUS_MAX_NUDGES="$${AUTONOMOUS_MAX_NUDGES:-0}"', "\t$(PROTO_COMPOSE) up -d"], False),
    (['\texport AUTONOMOUS_MAX_NUDGES="$${AUTONOMOUS_MAX_NUDGES:-0}"; . apps/server/proto/env.sh'], False),
    (["\t$(PROTO_COMPOSE) up -d --build"], False),
])
def test_the_nudge_pin_reader_accepts_a_reflow_and_rejects_a_misplaced_or_wrong_pin(body, expected):
    assert _pins_nudges_before_compose_up(body) is expected


def test_proto_demo_auto_pins_the_step_ceiling_and_waits_out_six_attempts():
    """One message is a whole run on this arm, but the per-attempt ceiling is the SAME
    pinned 1800 s every other target runs at -- the 7200 s override of 2026-09-20 was a
    symptom of the resume defect, not a capacity finding, and came back down with it
    (PR #2870 item 0b, "the step ceiling: 1,800 s, no test exception").

    So the arm no longer buys a longer attempt; it waits out MORE of them. The export
    stays because --deadline-s is sized off the name and POSIX arithmetic reads an unset
    name as 0 -- deleting the line would give `--deadline-s 300` on an hour-long billed
    run, which is why that is asserted here and not merely commented."""
    body = "\n".join(_recipe("proto-demo-auto"))
    # `:-` on both sides, so an explicitly empty READ_TIMEOUT_S takes the default here as
    # it does in compose's fallback -- never sh arithmetic reading "" as 0.
    ceiling = re.search(r'export READ_TIMEOUT_S="\$\$\{READ_TIMEOUT_S:-(\d+)\}"', body)
    assert ceiling, "proto-demo-auto must keep exporting READ_TIMEOUT_S: --deadline-s is sized off the name"
    assert int(ceiling.group(1)) == STEP_CEILING_S, \
        f"the ruling is {STEP_CEILING_S} s with no exception; this arm exports {ceiling.group(1)}"
    assert _env(_service(_load(COMPOSE), "shim"))["READ_TIMEOUT_S"].startswith("${READ_TIMEOUT_S:-"), \
        "compose must fall back on an empty READ_TIMEOUT_S too"
    # Six attempts, not one resume: 32% of the 134 completed e2e runs exceed 2 * 1800 + 300,
    # and the longest in the corpus needed six -- demo.py turns the shortfall into a FAIL.
    assert re.search(r'ARGS="--deadline-s \$\$\(\(6 \* READ_TIMEOUT_S \+ 300\)\) \$\(ARGS\)"', body), body
    for target in ("proto-demo", "proto-turn", "proto-kill"):
        assert "READ_TIMEOUT_S" not in "\n".join(_recipe(target)), f"{target} keeps the pinned 1800 s ceiling"


def test_the_resume_probe_target_wires_all_three_missing_pieces():
    """0a's probe fires only if all three line up, and any one missing looks identical to
    "the model never chose a background delegation" -- an hour of billed run, no kill, no
    finding. So the recipe is asserted rather than left to whoever types the command."""
    body = "\n".join(_recipe("proto-probe-resume"))
    # 1. the selector: tool NAME alone lands on a foreground delegation, which already
    #    resumed cleanly on 2026-09-20 -- that is why the probe did not confirm.
    assert "--kill-on Agent" in body and "--kill-on-input run_in_background=true" in body, body
    # 2. a message that provokes two concurrent extractions. The path is READ OUT of the
    #    recipe rather than repeated here, so repointing --text-file at a file that does
    #    not exist reds this instead of failing an hour into a billed run.
    named = re.search(r"--text-file (\S+)", body)
    assert named, body
    probe = PROTO / pathlib.PurePosixPath(named.group(1)).relative_to("proto")
    assert probe.is_file(), f"--text-file names {named.group(1)}, which is not in the repo"
    assert probe.read_text(encoding="utf-8").strip(), f"{named.group(1)} is empty"
    # 3. the nudge cap: at 0 the run ends before it ever reaches a delegation -- including
    #    when the caller left it set but empty.
    for caller in (None, ""):
        assert _cap_reaching_compose("proto-probe-resume", caller) not in ("", "0"), body
    assert re.search(r'test -n "\$\(SESSION\)"', body), "refuse without SESSION rather than probe a fresh project"
    rule = re.search(r"^proto-probe-resume:.*?##(.*)$", MAKEFILE.read_text(encoding="utf-8"), re.M)
    assert rule and "billed" in rule.group(1), "`make help` must say this one costs money"


def test_proto_export_target_requires_a_session_and_runs_the_script():
    body = "\n".join(_recipe("proto-export"))
    assert re.search(r'test -n "\$\(SESSION\)"', body), "refuse without SESSION rather than export nothing"
    assert "proto/export.py" in body and "--session '$(SESSION)'" in body
    assert re.search(r"\$\(if \$\(OUT\),\s*--out '\$\(abspath \$\(OUT\)\)',\s*\)", body), \
        "OUT is resolved against the repo root before the cd into apps/server"


# ── run(): the verdict is wired to the env and the row, not just correct in isolation ──


def _fake_stack(monkeypatch, status: str | None, *, nudges: int = 0):
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
        if "SELECT nudges FROM turns" in sql:
            return [(nudges,)]
        return []

    monkeypatch.setattr(demo, "rows", rows)


def _args(**over):
    base = dict(base="http://x", pg_dsn="dsn", s3_endpoint="s3", deadline_s=1.0, anchor="/project",
                ceiling_s=1800.0, session=None, prompt=None, fixture="fx", fixture_given=False,
                project_id=None, title=None, email="dev@localhost")
    base.update(over)
    return argparse.Namespace(**base)


@pytest.mark.parametrize("cap, status, code", [
    ("40", "active", 1),     # the 2026-09-20 run: the hook never bit, and the arm used to say PASS
    ("40", "completed", 0),
    ("40", None, 1),         # no research.json row at all
    ("0", "active", 0),      # proto-demo: one turn, not expected to finish the project
    (None, "active", 0),
])
def test_run_fails_the_autonomous_arm_on_an_unfinished_project(monkeypatch, capsys, cap, status, code):
    _fake_stack(monkeypatch, status)
    monkeypatch.delenv("AUTONOMOUS_MAX_NUDGES", raising=False)
    if cap is not None:
        monkeypatch.setenv("AUTONOMOUS_MAX_NUDGES", cap)
    assert demo.run(_args()) == code
    out = capsys.readouterr().out
    assert f"project.status={status}" in out, "the value the verdict used must be printed"
    assert ("PASS" if code == 0 else "FAIL") in out.splitlines()[-1]
