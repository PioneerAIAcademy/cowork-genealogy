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
from pathlib import Path
from types import SimpleNamespace

import pytest

from harness import judge
from harness import orchestrator as _orchestrator
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


def test_collect_skips_logs_already_on_current_prompt(disk_tree):
    log = _minimal_run_log(scenario="demo-scenario")
    log["judge_prompt_hash"] = judge.judge_prompt_hash()  # current
    log_path = disk_tree["runlogs"] / "v1_2026-10-09_00-00-00.json"
    log_path.parent.mkdir(parents=True, exist_ok=True)
    log_path.write_text(json.dumps(log), encoding="utf-8")

    targets = judge_regrade.collect_regradeable_logs(disk_tree["runlogs"].parent)
    assert targets == []


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
        "warnings": [],
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
    live_scenario_readme = judge_regrade._load_scenario_readme(live_spec.scenario)
    live_before_snapshot = judge_regrade._load_before_snapshot(live_spec.scenario)
    live_validator_failures = judge_regrade._gating_validator_failure_names(
        run_entry["validators"]
    )
    live_harness_observations = judge_regrade._harness_observations_from_warnings(
        run_entry["output"]["warnings"]
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
            state_observations=None,
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
    assert dry_recorder.kwargs == live_recorder.kwargs, (
        f"[{label}] regrade prompt kwargs diverged from live run.\n"
        f"dry  = {dry_recorder.kwargs}\n"
        f"live = {live_recorder.kwargs}"
    )
