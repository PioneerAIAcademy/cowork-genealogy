"""Tests for the judge-regrade target (issue #2479 PR 1).

The important invariants, all testable WITHOUT a model call:

1. `render_judge_prompt_for_test` reads the judge prompt from disk every time
   (bypasses `judge.judge_prompt_template()`'s @lru_cache). A regression that
   caches a stored prompt would certify a prose-only judge edit as a no-op
   without noticing — these tests catch that at $0.
2. The renderer is deterministic: same inputs render byte-identical twice.
3. A rubric edit moves every prompt hash in that skill's log; a scenario edit
   moves only its referencing tests; a SKILL.md edit moves nothing (the judge
   prompt doesn't embed SKILL.md).
4. `collect_regradeable_logs` includes active-but-mismatched logs AND returns a
   `reason_refused` on skill-side-stale logs (which rule 2 owns).
5. The regrade and the live run funnel through the same
   `orchestrator.build_judge_grade_kwargs`, so a positive / negative / direct
   test renders a BYTE-IDENTICAL prompt either way — the drift the PR's second
   review round caught.

The tests build minimal on-disk fixtures under `tmp_path` and monkeypatch
`judge_regrade`'s module-level path constants onto them — never editing the
real tree. That is the pattern that makes assertion 3 safe to run in CI.
"""

from __future__ import annotations

import json
import tempfile
from pathlib import Path
from types import SimpleNamespace

import pytest

from harness import judge
from harness.judge_render import judge_render_hash
from harness import orchestrator as _orchestrator
from harness import validator_runner
from harness.scenario_brief import load_scenario_brief
from harness.workspace import build_workspace, snapshot_files
import judge_regrade


# --- Fixtures --------------------------------------------------------------


def _write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def _minimal_test_spec(scenario: str | None = None) -> dict:
    """Schema-valid skeleton — the loader validates against unit-test.schema.json."""
    inp: dict = {"user_message": "demo message"}
    if scenario:
        inp["scenario"] = scenario
    return {
        "test": {
            "id": "ut_demo_001",
            "skill": "demo",
            "name": "Demo test",
            "type": "positive",
            "description": "A minimal fixture used by the judge-regrade unit tests.",
            "tags": [],
        },
        "input": inp,
        "mcp_fixtures": [],
        "judge_context": ["check that output names the person"],
    }


def _minimal_run_log(skill: str = "demo", scenario: str | None = None) -> dict:
    """Minimal run log matching the real envelope shape (verified against
    `eval/runlogs/unit/citation/v*.json`): per-test uses `test_id` not `id`,
    and `activated`/`skills_invoked`/`text_response`/`tool_calls`/`file_changes`/
    `builtin_tool_calls`/`warnings` are all nested under `output`."""
    return {
        "schema_version": 3,
        "skill": skill,
        "version": 1,
        "released": False,
        "releasable": True,
        "invocation": "skill",
        "timestamp": "2026-10-09_00-00-00",
        "harness_version": "0.1.0",
        "model": "claude-sonnet-4-5",
        "judge_prompt_hash": "a" * 64,  # STALE on purpose
        "snapshot": {},  # empty → diff_snapshot_vs_disk returns {} → active
        "tests": [
            {
                "test_id": "ut_demo_001",
                "outcome": "pass",
                "runs": [
                    {
                        "run_index": 0,
                        "aborted_reason": None,
                        "outcome": "pass",
                        "judge_skipped": False,
                        "output": {
                            "activated": True,
                            "skills_invoked": ["demo"],
                            "text_response": "John Smith is the person.",
                            "tool_calls": [],
                            "file_changes": [],
                            "builtin_tool_calls": [],
                            "warnings": [],
                        },
                        "validators": {"passed": True, "results": []},
                        "judge": {
                            "dimensions": [
                                {"source": "base", "name": "Correctness", "score": 3, "rationale": "names the person"},
                            ],
                            "judge_cost_usd": 0.01,
                            "input_tokens": 100,
                            "cached_input_tokens": 0,
                            "output_tokens": 50,
                            "skipped": False,
                        },
                    }
                ],
            }
        ],
        "totals": {},
    }


@pytest.fixture
def disk_tree(tmp_path, monkeypatch):
    """Build a minimal on-disk corpus and point judge_regrade at it."""
    repo = tmp_path / "repo"
    tests_unit = repo / "eval" / "tests" / "unit" / "demo"
    scenarios = repo / "eval" / "fixtures" / "scenarios" / "demo-scenario"
    mcp_fixtures = repo / "eval" / "fixtures" / "mcp"
    runlogs = repo / "eval" / "runlogs" / "unit" / "demo"
    judge_prompt_dir = repo / "eval" / "harness" / "judge"
    validators_dir = repo / "eval" / "harness" / "validators"

    _write(
        tests_unit / "test-001.json",
        json.dumps(_minimal_test_spec(scenario="demo-scenario")),
    )
    _write(
        tests_unit / "rubric.md",
        "# demo\n\n## Demo dimension\n\n- **pass:** demo passes\n"
        "- **partial:** demo partial\n- **fail:** demo fails\n",
    )
    _write(scenarios / "README.md", "# Scenario README\n\nSome prose.\n")
    _write(scenarios / "research.json", "{}")
    _write(scenarios / "tree.gedcomx.json", "{}")
    _write(mcp_fixtures / "demo.json", json.dumps({"tool": "x", "args": {}, "response": {"ok": True}}))

    # Two real validator functions — one response-derived (reads text_response),
    # one state-derived (reads before_state/after_state only). The parity test
    # proves `_split_observations_from_warnings` reads their signatures the
    # same way `validator_runner._run_module` does. Without this file the
    # test's "live" side used to call the regrade's own helper and both paths
    # agreed vacuously (chesworthrm, 2026-10-12).
    _write(validators_dir / "test_universal.py", "")
    _write(
        validators_dir / "test_demo.py",
        "def report_demo_response_check(text_response, test):\n"
        "    assert False, 'response-side observation'\n"
        "\n"
        "def report_demo_state_check(before_state, after_state):\n"
        "    assert False, 'state-side observation'\n",
    )

    # Judge prompt — minimal but non-empty so JUDGE_PROMPT_PATH.read_text works.
    _write(
        judge_prompt_dir / "prompt.md",
        "# Judge prompt\n\n{rubric}\n\n{judge_context}\n\n{scenario_readme}\n\n"
        "{user_message}\n\n{skills_invoked}\n\n{text_response}\n\n"
        "{file_changes_summary}\n\n{tool_calls}\n\n{before_state}\n\n"
        "{validator_failures}\n\n{harness_observations}\n",
    )

    # Point module path constants onto the tmp tree.
    monkeypatch.setattr(judge_regrade, "REPO_ROOT", repo)
    monkeypatch.setattr(judge_regrade, "UNIT_RUNLOGS", runlogs.parent)
    monkeypatch.setattr(judge_regrade, "TESTS_UNIT", repo / "eval" / "tests" / "unit")
    monkeypatch.setattr(judge_regrade, "SCENARIOS", repo / "eval" / "fixtures" / "scenarios")
    monkeypatch.setattr(judge_regrade, "MCP_FIXTURES", mcp_fixtures)
    # judge.py uses its own JUDGE_PROMPT_PATH; redirect it AND clear the lru_cache.
    monkeypatch.setattr(judge, "JUDGE_PROMPT_PATH", judge_prompt_dir / "prompt.md")
    monkeypatch.setattr(
        judge_regrade, "JUDGE_PROMPT_PATH", judge_prompt_dir / "prompt.md"
    )
    judge.judge_prompt_template.cache_clear()

    yield {
        "repo": repo,
        "tests_unit": tests_unit,
        "scenarios": scenarios,
        "mcp_fixtures": mcp_fixtures,
        "runlogs": runlogs,
        "judge_prompt": judge_prompt_dir / "prompt.md",
    }

    # Clean cache state after the test too, so a later test seeing a different
    # judge prompt doesn't re-use this one's.
    judge.judge_prompt_template.cache_clear()


# --- Rendering: deterministic, reads from disk -----------------------------


def test_render_is_deterministic(disk_tree):
    """Two renders of the same inputs produce byte-identical text."""
    log = _minimal_run_log(scenario="demo-scenario")
    test_entry = log["tests"][0]
    run_entry = test_entry["runs"][0]
    a = judge_regrade.render_judge_prompt_for_test(log, test_entry, run_entry)
    b = judge_regrade.render_judge_prompt_for_test(log, test_entry, run_entry)
    assert a == b


def test_render_includes_on_disk_rubric_verbatim(disk_tree):
    """The rendered text embeds the rubric file's current bytes."""
    log = _minimal_run_log(scenario="demo-scenario")
    test_entry = log["tests"][0]
    run_entry = test_entry["runs"][0]
    rendered = judge_regrade.render_judge_prompt_for_test(log, test_entry, run_entry)
    rubric_text = (disk_tree["tests_unit"] / "rubric.md").read_text(encoding="utf-8")
    # Rubric content is embedded (first line is a non-empty marker).
    assert rubric_text.splitlines()[0] in rendered


def test_rubric_edit_moves_prompt_hash(disk_tree):
    """Editing rubric.md moves the prompt hash — not caching anything stale."""
    log = _minimal_run_log(scenario="demo-scenario")
    test_entry = log["tests"][0]
    run_entry = test_entry["runs"][0]
    h0 = judge_regrade.hash_rendered_prompt(
        judge_regrade.render_judge_prompt_for_test(log, test_entry, run_entry)
    )

    rubric_path = disk_tree["tests_unit"] / "rubric.md"
    rubric_path.write_text(
        rubric_path.read_text(encoding="utf-8") + "\nextra line\n",
        encoding="utf-8",
    )
    h1 = judge_regrade.hash_rendered_prompt(
        judge_regrade.render_judge_prompt_for_test(log, test_entry, run_entry)
    )
    assert h0 != h1


def test_scenario_readme_edit_moves_prompt_hash(disk_tree):
    log = _minimal_run_log(scenario="demo-scenario")
    test_entry = log["tests"][0]
    run_entry = test_entry["runs"][0]
    h0 = judge_regrade.hash_rendered_prompt(
        judge_regrade.render_judge_prompt_for_test(log, test_entry, run_entry)
    )

    readme = disk_tree["scenarios"] / "README.md"
    readme.write_text(readme.read_text(encoding="utf-8") + "edit\n", encoding="utf-8")
    h1 = judge_regrade.hash_rendered_prompt(
        judge_regrade.render_judge_prompt_for_test(log, test_entry, run_entry)
    )
    assert h0 != h1


def test_judge_prompt_edit_moves_hash_without_rebuild(disk_tree):
    """Editing the judge prompt body itself must move the hash on the very next
    call — proves the disk read is NOT cached per invocation."""
    log = _minimal_run_log(scenario="demo-scenario")
    test_entry = log["tests"][0]
    run_entry = test_entry["runs"][0]
    h0 = judge_regrade.hash_rendered_prompt(
        judge_regrade.render_judge_prompt_for_test(log, test_entry, run_entry)
    )

    prompt_path = disk_tree["judge_prompt"]
    prompt_path.write_text(
        prompt_path.read_text(encoding="utf-8") + "\n# extra section\n",
        encoding="utf-8",
    )
    # Must also clear the module cache since judge.render_prompt_parts reads
    # via judge_prompt_template(). The regrader does this itself in
    # dry_run / regrade_run_log via the direct disk read on the hash side.
    judge.judge_prompt_template.cache_clear()
    h1 = judge_regrade.hash_rendered_prompt(
        judge_regrade.render_judge_prompt_for_test(log, test_entry, run_entry)
    )
    assert h0 != h1


# --- collect_regradeable_logs classification -------------------------------


def test_collect_classifies_active_mismatched_as_regradeable(disk_tree, monkeypatch):
    log = _minimal_run_log(scenario="demo-scenario")
    log_path = disk_tree["runlogs"] / "v1_2026-10-09_00-00-00.json"
    log_path.parent.mkdir(parents=True, exist_ok=True)
    log_path.write_text(json.dumps(log), encoding="utf-8")

    # Current prompt hash is NOT "a" * 64, so the log reads as mismatched.
    targets = judge_regrade.collect_regradeable_logs(disk_tree["runlogs"].parent)
    assert len(targets) == 1
    t = targets[0]
    assert t.skill == "demo"
    assert t.reason_refused is None


def test_collect_refuses_skill_side_stale(disk_tree):
    """A log whose snapshot points at a missing file is skill-side stale."""
    log = _minimal_run_log(scenario="demo-scenario")
    log["snapshot"] = {"eval/__no_such_file__/x.md": "deadbeef" * 8}
    log_path = disk_tree["runlogs"] / "v1_2026-10-09_00-00-00.json"
    log_path.parent.mkdir(parents=True, exist_ok=True)
    log_path.write_text(json.dumps(log), encoding="utf-8")

    targets = judge_regrade.collect_regradeable_logs(disk_tree["runlogs"].parent)
    assert len(targets) == 1
    t = targets[0]
    assert t.reason_refused is not None
    assert "skill-side" in t.reason_refused


def _render_hash_log(**envelope) -> dict:
    """A minimal run log with the given envelope fields set."""
    log = _minimal_run_log(scenario="demo-scenario")
    log.update(envelope)
    return log


def test_collect_skips_logs_already_on_current_prompt(disk_tree):
    """Current on BOTH fingerprints — rule 2b has nothing to clear."""
    _write_log(
        disk_tree,
        _render_hash_log(
            judge_prompt_hash=judge.judge_prompt_hash(),
            judge_render_hash=judge_render_hash(),
        ),
    )
    assert judge_regrade.collect_regradeable_logs(disk_tree["runlogs"].parent) == []


def test_collect_takes_a_log_with_no_render_hash(disk_tree):
    """A log written before the field is eligible: this regrade is what stamps
    it, and rule 2b only warns until one is present."""
    _write_log(disk_tree, _render_hash_log(judge_prompt_hash=judge.judge_prompt_hash()))
    targets = judge_regrade.collect_regradeable_logs(disk_tree["runlogs"].parent)
    assert len(targets) == 1
    assert targets[0].reason_refused is None


def test_regrade_stamps_both_fingerprints_and_clears_rule_2b(disk_tree, monkeypatch):
    """The stamp half of the regrade contract.

    This card traded the live `make judge-regrade` break row for this
    assertion, so without it the one line that writes `judge_render_hash` has
    no test at all: deleting it leaves the suite green (verified).

    A log with no `tests[]` reaches the envelope stamp without a judge call,
    which is what keeps this free.
    """
    monkeypatch.setattr(judge_regrade, "resolve_auth", lambda *a, **k: None)
    log = _minimal_run_log(scenario="demo-scenario")
    log["tests"] = []
    log["judge_render_hash"] = "0" * 64  # stale on purpose
    # `_minimal_run_log` carries `totals: {}`, which no other test notices
    # because none of them writes through the regrade's pre-write schema
    # validation. This one does, and `totals` has ten required fields.
    log["totals"] = {
        k: 0
        for k in (
            "duration_ms", "input_tokens", "cached_input_tokens", "output_tokens",
            "judge_input_tokens", "judge_cached_input_tokens", "judge_output_tokens",
            "skill_cost_usd", "judge_cost_usd", "total_cost_usd",
        )
    }
    path = _write_log(disk_tree, log)

    judge_regrade.regrade_run_log(path)

    written = json.loads(path.read_text(encoding="utf-8"))
    assert written["judge_prompt_hash"] == judge.judge_prompt_hash()
    assert written["judge_render_hash"] == judge_render_hash()
    # That the refreshed hash then CLEARS the gate is the paired assertion in
    # test_check_runlogs.py::test_rule2b_render_passes_when_touched_but_hash_unchanged
    # — `check_runlogs` is a script loaded by importlib there, not a module to
    # import here.


def test_collect_takes_a_log_whose_render_hash_is_stale(disk_tree):
    """The prompt is current and only the render code moved — still eligible,
    which is the whole point of the render half."""
    _write_log(
        disk_tree,
        _render_hash_log(
            judge_prompt_hash=judge.judge_prompt_hash(),
            judge_render_hash="0" * 64,
        ),
    )
    targets = judge_regrade.collect_regradeable_logs(disk_tree["runlogs"].parent)
    assert len(targets) == 1
    assert targets[0].reason_refused is None


# --- Warning dedupe (S3) ---------------------------------------------------


def test_judge_was_skipped_reads_dotted_field_and_aborted():
    """`judge.skipped` under the judge block AND `aborted_reason` both route to skipped.

    The regression this guards: a top-level `judge_skipped` key never exists on
    the committed envelope — the writer stores it under the `judge` block as
    `judge.skipped` — so a `run_entry.get("judge_skipped")` test is dead code
    that never resurrects a judge-skipped run.
    """
    # Live-shape skipped: judge.skipped is True.
    assert judge_regrade._judge_was_skipped({"judge": {"skipped": True}}) is True
    # Aborted runs skip the judge too.
    assert judge_regrade._judge_was_skipped({"aborted_reason": "max_turns"}) is True
    # Live-shape non-skipped: judge.skipped is False, no aborted_reason.
    assert judge_regrade._judge_was_skipped(
        {"judge": {"skipped": False}, "aborted_reason": None}
    ) is False
    # The OLD (broken) top-level `judge_skipped` key is NOT read as skipped —
    # proves the field-name regression stays fixed.
    assert judge_regrade._judge_was_skipped({"judge_skipped": True}) is False


def test_strip_prior_coerced_warnings_removes_only_that_kind():
    warnings = [
        {"kind": "prose_observation", "observation": "keep"},
        {"kind": "coerced_routing_negative_to_na", "score_was": 1},
        {"kind": "prose_observation", "observation": "also keep"},
    ]
    out = judge_regrade._strip_prior_coerced_warnings(warnings)
    assert len(out) == 2
    assert all(w["kind"] == "prose_observation" for w in out)


# --- Live-vs-regrade prompt parity (issue #2479 PR 1, 2026-10-09 review) --
#
# The regrade must render the same prompt a live run would send; otherwise
# a judge-prompt edit's regrade scores diverge from what the next live run
# will produce, which is the drift the PR exists to prevent. Captured by
# intercepting `render_prompt_parts` on both paths and comparing the kwargs
# it was called with.


class _KwargsRecorder:
    """Capture the kwargs render_prompt_parts was called with."""

    def __init__(self) -> None:
        self.kwargs: dict | None = None

    def __call__(self, **kwargs):
        self.kwargs = kwargs
        # Return a benign (prefix, suffix) tuple so the caller can concatenate.
        return ("", "")


def _spec_positive(scenario: str | None = "demo-scenario") -> dict:
    inp: dict = {"user_message": "Please find John Smith's death record."}
    if scenario:
        inp["scenario"] = scenario
    return {
        "test": {
            "id": "ut_demo_positive",
            "skill": "demo",
            "name": "Positive",
            "type": "positive",
            "description": "Positive test.",
            "tags": [],
        },
        "input": inp,
        "mcp_fixtures": [],
        "judge_context": ["check that output names the person"],
    }


def _spec_negative(scenario: str | None = "demo-scenario") -> dict:
    inp: dict = {"user_message": "Translate 'hello' to Spanish."}
    if scenario:
        inp["scenario"] = scenario
    return {
        "test": {
            "id": "ut_demo_negative",
            "skill": "demo",
            "name": "Negative",
            "type": "negative",
            "description": "Negative test.",
            "tags": [],
        },
        "input": inp,
        "mcp_fixtures": [],
        "judge_context": ["check that output declines"],
        "negative": {
            "correct_skill": [],
            "explanation": "demo skill should not translate text.",
        },
    }


def _spec_direct() -> dict:
    return {
        "test": {
            "id": "ut_demo_direct",
            "skill": "demo",
            "name": "Direct",
            "type": "positive",
            "description": "Direct-agent test.",
            "tags": [],
        },
        "input": {
            "delegation": "The caller said: declared=true. Verify.",
            "scenario": "demo-scenario",
        },
        "mcp_fixtures": [],
        "judge_context": ["grade from the per-test context, not the delegation"],
    }


def _run_entry_for(test_id: str, *, direct: bool = False) -> dict:
    output = {
        "activated": True,
        "skills_invoked": [] if direct else ["demo"],
        "text_response": (
            "Dispatcher relayed: ok." if direct else "John Smith died 1890."
        ),
        "tool_calls": [],
        "file_changes": [],
        "builtin_tool_calls": (
            [{"tool": "Agent", "args": {"subagent_type": "demo"}}] if direct else []
        ),
        "agent_returns": (
            [{"subagent_type": "demo", "text": "Agent's own return text."}]
            if direct
            else []
        ),
        # Two observations — one about the reply, one about saved files —
        # named by `check` so `_split_observations_from_warnings` can look
        # the function's signature up in the disk tree's validator module.
        # Without both kinds the parity assertion is vacuous.
        "warnings": [
            {
                "kind": "prose_observation",
                "check": "report_demo_response_check",
                "observation": "response-side observation",
            },
            {
                "kind": "prose_observation",
                "check": "report_demo_state_check",
                "observation": "state-side observation",
            },
        ],
    }
    return {
        "run_index": 0,
        "aborted_reason": None,
        "outcome": "pass",
        "judge_skipped": False,
        "output": output,
        "validators": {
            "passed": False,
            "results": [
                {"name": "test_demo_check", "passed": False, "error": "expected 'X' not 'Y'"},
                {
                    "name": "report_demo_observation",
                    "passed": False,
                    "error": "observed thing",
                    "reporting_only": True,
                },
            ],
        },
        "judge": {
            "dimensions": [
                {"source": "base", "name": "Correctness", "score": 3, "rationale": "ok"},
            ],
            "judge_cost_usd": 0.01,
            "input_tokens": 100,
            "cached_input_tokens": 0,
            "output_tokens": 50,
            "skipped": False,
        },
    }


def _log_with(skill: str, test_spec: dict, run_entry: dict) -> dict:
    return {
        "schema_version": 3,
        "skill": skill,
        "version": 1,
        "released": False,
        "releasable": True,
        "invocation": "skill",
        "timestamp": "2026-10-09_00-00-00",
        "harness_version": "0.1.0",
        "model": "claude-sonnet-4-5",
        "judge_prompt_hash": "a" * 64,
        "snapshot": {},
        "tests": [
            {
                "test_id": test_spec["test"]["id"],
                "outcome": "pass",
                "runs": [run_entry],
            }
        ],
        "totals": {},
    }


@pytest.mark.parametrize(
    "spec_builder, direct, label",
    [
        (lambda: _spec_positive(), False, "positive"),
        (lambda: _spec_negative(), False, "negative"),
        (lambda: _spec_direct(), True, "direct"),
    ],
)
def test_regrade_and_live_render_same_prompt(disk_tree, monkeypatch, spec_builder, direct, label):
    """Live `_run_judge` and `render_judge_prompt_for_test` must shape
    render_prompt_parts kwargs identically.

    The regression this guards is drift between the regrade's hand-rebuilt
    inputs and `orchestrator._run_judge`'s inputs. On the current refactor both
    paths funnel through `build_judge_grade_kwargs`, so the captured kwargs are
    equal. Before the refactor the regrade sent `grade()` a full rubric on
    negative tests, empty `skills_invoked` on direct tests, and "name: error"
    validator-failure strings — all of which would read as unequal kwargs here.
    """
    spec_dict = spec_builder()
    test_path = disk_tree["tests_unit"] / f"{spec_dict['test']['id']}.json"
    test_path.write_text(json.dumps(spec_dict), encoding="utf-8")
    # A source on file, so the before-state slot renders something to compare.
    # With an empty research.json both sides render "(none)" and a regrade that
    # built its before-snapshot under the wrong keys passed this test (#2478).
    (disk_tree["scenarios"] / "research.json").write_text(
        json.dumps({"sources": [{"id": "src_001", "citation": "Demo citation"}]}),
        encoding="utf-8",
    )

    run_entry = _run_entry_for(spec_dict["test"]["id"], direct=direct)
    log = _log_with("demo", spec_dict, run_entry)
    test_entry = log["tests"][0]

    # --- Dry render path: capture render_prompt_parts kwargs ---
    dry_recorder = _KwargsRecorder()
    monkeypatch.setattr(judge_regrade, "render_prompt_parts", dry_recorder)
    judge_regrade.render_judge_prompt_for_test(log, test_entry, run_entry)
    assert dry_recorder.kwargs is not None, "dry path did not call render_prompt_parts"

    # --- Live path: run _run_judge, which calls grade -> render_prompt_parts ---
    live_recorder = _KwargsRecorder()
    monkeypatch.setattr(judge, "render_prompt_parts", live_recorder)

    # Short-circuit the model call once render_prompt_parts has been exercised:
    # grade() builds the prompt before dispatching to Anthropic. We don't want
    # the test to hit the network; raising from the recorder's follow-up is one
    # option, but it's easier to monkey-patch the client dispatch.
    def _no_model_dispatch(client, prefix, suffix, tool, model, enable_cache):
        # Return a shape _parse_grading_result can read: one dimension.
        return SimpleNamespace(
            content=[
                SimpleNamespace(
                    type="tool_use",
                    name="submit_grading",
                    input={
                        "dimensions": [
                            {
                                "source": "base",
                                "name": "Correctness",
                                "score": 3,
                                "rationale": "ok",
                            }
                        ]
                    },
                )
            ],
            usage=SimpleNamespace(
                input_tokens=10,
                cache_read_input_tokens=0,
                cache_creation_input_tokens=0,
                output_tokens=5,
            ),
        )

    monkeypatch.setattr(judge, "_dispatch_grading", _no_model_dispatch, raising=False)
    # Fall back: _make_client needs auth; stub it to a no-op.
    monkeypatch.setattr(judge, "_make_client", lambda auth: object())

    # Build the live result namespace exactly as the orchestrator would.
    live_result = SimpleNamespace(
        text_response=run_entry["output"]["text_response"],
        tool_calls=run_entry["output"]["tool_calls"],
        skills_invoked=run_entry["output"]["skills_invoked"],
        builtin_tool_calls=run_entry["output"]["builtin_tool_calls"],
        agent_returns=run_entry["output"]["agent_returns"],
        slash_entry_skill=None,
    )

    # Load the test spec the same way the orchestrator would, so we exercise
    # the real `TestSpec` object the live path reads from.
    live_spec = judge_regrade._load_test_spec("demo", spec_dict["test"]["id"])
    live_rubric = judge_regrade._load_rubric("demo")
    # The live side builds both from the calls the orchestrator itself makes,
    # never from a regrade helper, or a regrade bug agrees with itself here.
    live_scenario_readme = load_scenario_brief(
        disk_tree["repo"] / "eval" / "fixtures" / "scenarios", live_spec.scenario
    ).text
    with tempfile.TemporaryDirectory() as _ws:
        build_workspace(
            scenario_name=live_spec.scenario,
            scenarios_dir=disk_tree["repo"] / "eval" / "fixtures" / "scenarios",
            skills_dir=_orchestrator.DEFAULT_SKILLS,
            target_dir=Path(_ws),
            stage_skills=False,
        )
        live_before_snapshot = snapshot_files(Path(_ws))
    live_validator_failures = judge_regrade._gating_validator_failure_names(
        run_entry["validators"]
    )
    # Build the live-side observations the way the orchestrator does: run the
    # demo validator module (two real `report_*` functions in the disk tree)
    # through `_run_module`, then feed its results to `split_observations`.
    # The regrade's helper reads the SAME functions' signatures off disk, so
    # if the regrade and the live run disagree about which section a given
    # observation belongs in, these two tuples diverge and the kwargs don't
    # match. Chesworthrm's 2026-10-12 review named this as the drift the
    # old parity test failed to detect — both sides had called the regrade's
    # own helper, so both made the same mistake.
    _demo_validator_module = validator_runner._import_validator_module(
        disk_tree["repo"] / "eval" / "harness" / "validators" / "test_demo.py",
        "live_demo",
    )
    _live_validator_results = validator_runner._run_module(
        _demo_validator_module,
        {
            "text_response": run_entry["output"]["text_response"],
            "test": live_spec,
            "before_state": {},
            "after_state": {},
            "skill_frontmatter": {},
        },
    )
    live_harness_observations, live_state_observations = (
        validator_runner.split_observations(_live_validator_results)
    )

    # Try the full `_run_judge`; if the stubbed dispatch isn't where
    # the installed judge module routes requests through, fall back to
    # capturing render_prompt_parts' kwargs directly through grade().
    try:
        _orchestrator._run_judge(
            spec=live_spec,
            rubric=live_rubric,
            scenario_readme=live_scenario_readme,
            result=live_result,
            file_changes=run_entry["output"]["file_changes"],
            before_snapshot=live_before_snapshot,
            auth=None,
            judge_model="claude-haiku-4-5",
            validator_failures=live_validator_failures,
            harness_observations=live_harness_observations,
            state_observations=live_state_observations,
        )
    except Exception:
        # The stub may not match every private contract inside grade();
        # but render_prompt_parts gets called BEFORE the model dispatch,
        # so the recorder has captured its kwargs by now.
        pass

    assert live_recorder.kwargs is not None, (
        f"[{label}] live path did not reach render_prompt_parts"
    )

    # The kwargs must match byte-for-byte: same rubric, judge_context,
    # user_message, skills_invoked, text_response, tool_calls, validator_failures.
    # If any one differs, the regrade is sending a prompt the live run never would.
    assert "src_001" in live_recorder.kwargs["before_state"], (
        f"[{label}] live before-state did not render the on-file source"
    )
    assert dry_recorder.kwargs == live_recorder.kwargs, (
        f"[{label}] regrade prompt kwargs diverged from live run.\n"
        f"dry  = {dry_recorder.kwargs}\n"
        f"live = {live_recorder.kwargs}"
    )


# --- README fallback warning and scratch mode (issue #2478) -----------------


def _write_log(disk_tree, log: dict) -> Path:
    path = disk_tree["runlogs"] / "v1_2026-10-09_00-00-00.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(log), encoding="utf-8")
    return path


def test_rederive_fallback_warning_follows_the_current_brief(disk_tree):
    stale = [
        {"kind": "prose_observation", "observation": "keep"},
        {"kind": "scenario_readme_fallback", "scenario": "demo-scenario", "advisory": "old"},
    ]
    fallback = judge_regrade._load_scenario_brief("demo-scenario")
    out = judge_regrade._rederive_fallback_warning(stale, fallback)
    assert [w["kind"] for w in out] == ["prose_observation", "scenario_readme_fallback"]
    assert out[1]["advisory"] != "old"

    (disk_tree["scenarios"] / "judge-brief.md").write_text("Mocked.\n", encoding="utf-8")
    briefed = judge_regrade._load_scenario_brief("demo-scenario")
    out = judge_regrade._rederive_fallback_warning(stale, briefed)
    assert [w["kind"] for w in out] == ["prose_observation"]


def test_rederive_replaces_a_readme_fallback_with_brief_missing(disk_tree):
    stale = [{"kind": "scenario_readme_fallback", "scenario": "demo-scenario", "advisory": "old"}]
    (disk_tree["scenarios"] / "README.md").unlink()
    bare = judge_regrade._load_scenario_brief("demo-scenario")
    out = judge_regrade._rederive_fallback_warning(stale, bare)
    assert [w["kind"] for w in out] == ["scenario_brief_missing"]
    # And back: a brief clears the missing entry too.
    (disk_tree["scenarios"] / "judge-brief.md").write_text("Mocked.\n", encoding="utf-8")
    briefed = judge_regrade._load_scenario_brief("demo-scenario")
    assert judge_regrade._rederive_fallback_warning(out, briefed) == []


def test_slot_readme_renders_the_readme_over_a_brief(disk_tree):
    (disk_tree["scenarios"] / "judge-brief.md").write_text("BRIEF_SENTINEL\n", encoding="utf-8")
    log = _minimal_run_log(scenario="demo-scenario")
    test_entry, run_entry = log["tests"][0], log["tests"][0]["runs"][0]
    brief = judge_regrade.render_judge_prompt_for_test(log, test_entry, run_entry)
    readme = judge_regrade.render_judge_prompt_for_test(
        log, test_entry, run_entry, force_readme=True
    )
    assert "BRIEF_SENTINEL" in brief and "Some prose." not in brief
    assert "Some prose." in readme and "BRIEF_SENTINEL" not in readme


def test_scratch_collect_waives_both_refusals(disk_tree):
    log = _minimal_run_log(scenario="demo-scenario")
    log["judge_prompt_hash"] = judge.judge_prompt_hash()
    log["snapshot"] = {"eval/__no_such_file__/x.md": "deadbeef" * 8}
    _write_log(disk_tree, log)
    root = disk_tree["runlogs"].parent
    assert judge_regrade.collect_regradeable_logs(root) == [] or all(
        t.reason_refused for t in judge_regrade.collect_regradeable_logs(root)
    )
    targets = judge_regrade.collect_regradeable_logs(root, scratch=True)
    assert [(t.skill, t.reason_refused) for t in targets] == [("demo", None)]


def test_copy_to_scratch_filters_and_never_touches_the_committed_log(disk_tree, tmp_path):
    committed = _write_log(disk_tree, _minimal_run_log(scenario="demo-scenario"))
    before = committed.read_bytes()
    target = judge_regrade.collect_regradeable_logs(
        disk_tree["runlogs"].parent, scratch=True
    )[0]
    scratch = tmp_path / "readme-1"

    assert judge_regrade.copy_to_scratch(
        target, scratch, only_scenarios={"other-scenario"}
    ) is None
    copy = judge_regrade.copy_to_scratch(
        target, scratch, only_scenarios={"demo-scenario"}
    )
    assert copy is not None and copy.path.parent == scratch / "demo"
    assert [t["test_id"] for t in copy.log["tests"]] == ["ut_demo_001"]
    assert committed.read_bytes() == before

    with pytest.raises(judge_regrade.ScratchDirNotEmpty):
        judge_regrade.copy_to_scratch(target, scratch)


def test_scratch_regrade_refuses_a_path_outside_its_root(disk_tree, tmp_path):
    committed = _write_log(disk_tree, _minimal_run_log(scenario="demo-scenario"))
    with pytest.raises(ValueError, match="not under"):
        judge_regrade.regrade_run_log(committed, scratch_root=tmp_path / "scratch")


@pytest.mark.parametrize(
    "argv", [["--scenario", "demo-scenario"], ["--slot", "readme"]]
)
def test_scratch_only_flags_require_runlogs_root(argv):
    with pytest.raises(SystemExit) as exc:
        judge_regrade.main(argv)
    assert exc.value.code == 2


def test_scratch_dry_run_counts_prompts_and_writes_nothing(disk_tree, tmp_path, capsys):
    committed = _write_log(disk_tree, _minimal_run_log(scenario="demo-scenario"))
    before = committed.read_bytes()
    scratch = tmp_path / "dry"
    code = judge_regrade.main(
        ["--dry-run", "--runlogs-root", str(scratch), "--scenario", "demo-scenario"]
    )
    out = capsys.readouterr().out
    assert code == 0
    assert "1 prompt(s) rendered in total" in out
    assert "1 scenario(s) graded without a judge brief (README or nothing): demo-scenario" in out
    assert committed.read_bytes() == before
    assert not scratch.exists()


def test_scratch_dry_run_skips_a_test_deleted_since_the_log(disk_tree, tmp_path, capsys):
    log = _minimal_run_log(scenario="demo-scenario")
    gone = json.loads(json.dumps(log["tests"][0]))
    gone["test_id"] = "ut_demo_deleted"
    log["tests"].append(gone)
    _write_log(disk_tree, log)
    code = judge_regrade.main(["--dry-run", "--runlogs-root", str(tmp_path / "dry")])
    out = capsys.readouterr().out
    assert code == 0
    assert "skipped 1 deleted test(s): ut_demo_deleted" in out
    assert "1 prompt(s) rendered in total" in out


def test_scratch_refuses_an_unknown_scenario_and_a_relative_root(disk_tree, tmp_path, capsys):
    _write_log(disk_tree, _minimal_run_log(scenario="demo-scenario"))
    assert judge_regrade.main(
        ["--runlogs-root", str(tmp_path / "x"), "--scenario", "demo-scenaro"]
    ) == 2
    assert "names no scenario directory: demo-scenaro" in capsys.readouterr().err
    assert judge_regrade.main(["--runlogs-root", "relative/dir"]) == 2
    assert "must be an absolute path" in capsys.readouterr().err


def test_scratch_exits_non_zero_when_nothing_matched(disk_tree, tmp_path, capsys):
    _write_log(disk_tree, _minimal_run_log(scenario="demo-scenario"))
    (disk_tree["repo"] / "eval" / "fixtures" / "scenarios" / "other").mkdir()
    code = judge_regrade.main(
        ["--dry-run", "--runlogs-root", str(tmp_path / "x"), "--scenario", "other"]
    )
    assert code == 1
    assert "no test matched" in capsys.readouterr().err


def test_scratch_refuses_an_occupied_pass_dir_before_any_regrade(disk_tree, tmp_path, monkeypatch, capsys):
    _write_log(disk_tree, _minimal_run_log(scenario="demo-scenario"))
    occupied = tmp_path / "pass" / "demo"
    occupied.mkdir(parents=True)
    (occupied / "v1.json").write_text("{}", encoding="utf-8")
    called = []
    monkeypatch.setattr(judge_regrade, "regrade_run_log", lambda *a, **k: called.append(a))
    assert judge_regrade.main(["--runlogs-root", str(tmp_path / "pass")]) == 1
    assert called == []
    assert "already holds run logs" in capsys.readouterr().err


def test_scratch_removes_the_copy_when_the_regrade_fails(disk_tree, tmp_path, monkeypatch):
    _write_log(disk_tree, _minimal_run_log(scenario="demo-scenario"))

    def failing(path, **kwargs):
        return judge_regrade.RegradeResult(skill="demo", path=path, error="judge failed")

    monkeypatch.setattr(judge_regrade, "regrade_run_log", failing)
    assert judge_regrade.main(["--runlogs-root", str(tmp_path / "pass")]) == 1
    assert not any((tmp_path / "pass" / "demo").glob("*.json"))


def test_before_snapshot_is_staged_once_per_scenario_and_again_after_an_edit(disk_tree, monkeypatch):
    staged = []
    real = judge_regrade._stage_before_snapshot
    monkeypatch.setattr(judge_regrade, "_BEFORE_SNAPSHOT_CACHE", {})
    monkeypatch.setattr(
        judge_regrade, "_stage_before_snapshot", lambda s: staged.append(s) or real(s)
    )
    judge_regrade._load_before_snapshot("demo-scenario")
    judge_regrade._load_before_snapshot("demo-scenario")
    assert staged == ["demo-scenario"]
    (disk_tree["scenarios"] / "research.json").write_text(
        json.dumps({"sources": [{"id": "src_009"}]}), encoding="utf-8"
    )
    snap = judge_regrade._load_before_snapshot("demo-scenario")
    assert staged == ["demo-scenario", "demo-scenario"]
    assert snap["research_json"]["sources"][0]["id"] == "src_009"
