"""Invoke deterministic validators per unit-test-spec.md §8.

The harness imports test_universal.py + test_<skill>.py if present, finds all
top-level test_* and report_* functions, and calls each with the args from its
signature (a subset of the available_args dict).

- test_* (tier 1, gating): failure blocks the test and is sent to the judge as
  a validator failure name.
- report_* (tier 2, reporting): failure is an observation fed to the judge as
  anonymous text, never gates the test outcome. (Issue #1749.)

This matches the spec's "Validators that don't need an argument simply ignore
it" while remaining compatible with the seed validators' pytest-style fixtures.
"""

from __future__ import annotations

import importlib.util
import inspect
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

# Validators authored as pytest test functions use pytest.skip() to signal
# "not applicable to this state." We catch that explicitly rather than
# string-matching the exception name.
from _pytest.outcomes import Skipped


@dataclass
class ValidatorRunResult:
    name: str
    passed: bool
    error: str | None
    reporting_only: bool = False  # tier-2 report_* functions (issue #1749)


def run_validators(
    *,
    skill: str,
    validators_dir: Path,
    before_state: dict[str, Any],
    after_state: dict[str, Any],
    tool_calls: list[dict[str, Any]],
    skill_frontmatter: dict[str, Any] | None = None,
    test: dict[str, Any] | None = None,
    blocked_context_calls: list[dict[str, Any]] | None = None,
    blocked_protected_writes: list[dict[str, Any]] | None = None,
    attempted_mcp_calls: list[dict[str, Any]] | None = None,
    skills_invoked: list[str] | None = None,
    text_response: str | None = None,
    activated: bool | None = None,
    num_turns: int | None = None,
    output_tokens: int | None = None,
    aborted_reason: str | None = None,
) -> list[ValidatorRunResult]:
    """Run universal validators + the per-skill validator file if present."""
    results: list[ValidatorRunResult] = []

    available_args = {
        "before_state": before_state,
        "after_state": after_state,
        "tool_calls": tool_calls,
        "skill_frontmatter": skill_frontmatter or {},
        # Every skill invoked through the SDK's `Skill` tool, in call order,
        # captured by the PreToolUse hook in skill_runner. Ground truth for
        # "did the skill delegate to X" — the hook fires on the real call, so
        # this cannot be fooled by narration that merely *offers* to delegate.
        # `tool_calls` can't answer this: it records only `mcp__` calls, and
        # `Skill` is an SDK built-in, not an MCP tool. Use it to assert a
        # required hand-off deterministically instead of leaving that fact to
        # the LLM judge, which has misread it (a judge scored "failed to call
        # search-external-sites" on a run where the hook recorded the call).
        "skills_invoked": list(skills_invoked or []),
        # Main-thread calls to subagent-only tools that the PreToolUse hook
        # denied (harness.context_policy). Non-empty means the skill broke the
        # context boundary. Note this is the *denied* set: because the hook
        # blocks the call, it never reaches `tool_calls`, so this is the only
        # place the violation is visible.
        "blocked_context_calls": blocked_context_calls or [],
        # Raw Write/Edit/NotebookEdit calls to a protected project file
        # (research.json / tree.gedcomx.json) the main thread tried and the hook
        # denied (harness.context_policy.protected_file_denial). Same shape and
        # same rationale as blocked_context_calls: the denied call never reaches
        # `tool_calls`, so this is the only place a raw-write attempt is visible.
        # The universal validator asserts it is empty (issue #1493).
        "blocked_protected_writes": blocked_protected_writes or [],
        # MCP calls the model emitted that never reached a fixture match —
        # denied by policy, fixture caps, or aborts. Distinct from tool_calls,
        # which records only successful dispatches. Used by test_tool_allowlist
        # to check the full set of tools the skill *tried* to call, not just
        # the ones that succeeded (issue #1748).
        "attempted_mcp_calls": attempted_mcp_calls or [],
        # `test` is the parsed test JSON dict (the inner "test" block,
        # plus top-level validator-facing blocks the orchestrator threads
        # in — currently `expected_classifications`). Validators gate
        # test-specific checks on test["tags"], e.g.
        #   if "slug-apostrophe" not in test.get("tags", []): pytest.skip(...)
        "test": test or {},
        # Every assistant text block concatenated, not the final reply alone
        # — the same string the run log stores as `output.text_response` and
        # the judge grades.
        #
        # Here so a reply-shape rule can be decided mechanically instead of
        # inferred. Several skill bodies state one ("One sentence only", "do
        # not restate the article content", "never claim a tool failed"), and
        # a judge dimension grades those unevenly: on run
        # v1_2026-08-22_10-20-08 the search-wikipedia `Reply economy`
        # dimension caught a narrating reply on one test and scored a
        # byte-identical shape 3 on another, quoting a reply it had not been
        # given (#1662 finding F7).
        #
        # Use it for a literal, falsifiable property of the text. Do NOT use
        # it to re-grade prose quality — that is the judge's job, and a
        # validator that tries becomes a rubric dimension nobody can tune.
        "text_response": text_response or "",
        # Whether the skill activated (derived by derive_activated in
        # orchestrator). None = unknown (e.g. abort before derivation).
        "activated": activated,
        # SDK-reported turn count and output token count, extracted from
        # result.usage. Defaults to 0 when absent or on early abort.
        "num_turns": num_turns or 0,
        "output_tokens": output_tokens or 0,
        # Abort reason if the run was aborted (e.g. "max_wall_clock_seconds",
        # "sdk_stream_silence", "error"). None when the run completed normally.
        "aborted_reason": aborted_reason,
    }

    universal = validators_dir / "test_universal.py"
    if universal.exists():
        module = _import_validator_module(universal, "harness_validators_universal")
        results.extend(_run_module(module, available_args))

    skill_validator = validators_dir / f"test_{skill.replace('-', '_')}.py"
    if skill_validator.exists():
        module = _import_validator_module(
            skill_validator, f"harness_validators_{skill.replace('-', '_')}"
        )
        results.extend(_run_module(module, available_args))

    return results


def _import_validator_module(path: Path, name: str):
    """Import a validator file as a module.

    Adds the validator file's directory to sys.path so seed validators
    can `from validators_lib import ...` (the shared helpers module).
    Without this, importlib.util.spec_from_file_location loads the file
    but the validator's internal imports fail.
    """
    parent_str = str(path.parent)
    needs_cleanup = parent_str not in sys.path
    if needs_cleanup:
        sys.path.insert(0, parent_str)
    try:
        spec = importlib.util.spec_from_file_location(name, path)
        if spec is None or spec.loader is None:
            raise RuntimeError(f"cannot load validator module from {path}")
        module = importlib.util.module_from_spec(spec)
        # Register in sys.modules so dataclasses / inspect can resolve types.
        sys.modules[name] = module
        spec.loader.exec_module(module)
        return module
    finally:
        if needs_cleanup:
            try:
                sys.path.remove(parent_str)
            except ValueError:
                pass


def _run_module(module, available_args: dict[str, Any]) -> list[ValidatorRunResult]:
    out: list[ValidatorRunResult] = []
    for attr_name in dir(module):
        is_test = attr_name.startswith("test_")
        is_report = attr_name.startswith("report_")
        if not (is_test or is_report):
            continue
        fn = getattr(module, attr_name)
        if not callable(fn):
            continue
        sig = inspect.signature(fn)
        try:
            kwargs = {
                name: available_args[name]
                for name in sig.parameters
                if name in available_args
            }
            # If the function declares a parameter we don't know about, skip
            # it gracefully — pytest fixtures we can't supply.
            if len(kwargs) != len(sig.parameters):
                missing = set(sig.parameters) - set(kwargs)
                valid = sorted(available_args.keys())
                # Deliberately NOT reporting_only, even for a report_* function:
                # a bad signature is a bug in the validator, not an observation
                # about the run. Marking it tier 2 would hide it from the run log
                # (as_dicts drops tier 2) and feed this message — harness
                # internals, including the whole arg roster — to the judge as an
                # observation it is told to weigh.
                out.append(
                    ValidatorRunResult(
                        name=attr_name,
                        passed=False,
                        error=(
                            f"validator declares unknown parameter(s): "
                            f"{sorted(missing)}. Valid harness-supplied "
                            f"args are: {valid}"
                        ),
                    )
                )
                continue
            fn(**kwargs)
            out.append(ValidatorRunResult(
                name=attr_name, passed=True, error=None,
                reporting_only=is_report,
            ))
        except AssertionError as e:
            out.append(
                ValidatorRunResult(
                    name=attr_name, passed=False,
                    error=str(e) or "assertion failed",
                    reporting_only=is_report,
                )
            )
        except Skipped as e:
            # pytest.skip() raises Skipped (a BaseException subclass). Treat
            # it as "validator did not apply" → passed with reason captured.
            out.append(
                ValidatorRunResult(
                    name=attr_name,
                    passed=True,
                    error=f"skipped: {e}",
                    reporting_only=is_report,
                )
            )
        except Exception as e:  # noqa: BLE001 — validator bug, surface verbatim
            # Same as the unknown-parameter branch above: a crash is a validator
            # bug, so it gates whatever the prefix. Only the pass / assert / skip
            # paths carry reporting_only — those are real findings about the run.
            out.append(
                ValidatorRunResult(
                    name=attr_name,
                    passed=False,
                    error=f"{type(e).__name__}: {e}",
                )
            )
    return out


def all_passed(results: list[ValidatorRunResult]) -> bool:
    return all(r.passed for r in results)


def as_dicts(results: list[ValidatorRunResult]) -> list[dict[str, Any]]:
    return [
        {"name": r.name, "passed": r.passed, "error": r.error}
        for r in results
        if not r.reporting_only
    ]


def split_observations(results: list[ValidatorRunResult]) -> list[str]:
    """Extract anonymous observation texts from tier-2 report_* results.

    Returns r.error (the observation text) for every reporting-only result
    that failed and has an error message. Passing report_* results are
    excluded (only fired findings appear). r.name (the function name) is
    never included — it is a verdict, not an observation, and handing it
    to the judge would anchor the grade.
    """
    return [
        r.error for r in results
        if r.reporting_only and not r.passed and r.error
    ]
