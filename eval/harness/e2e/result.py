"""E2e result schema and persistence.

A run produces four artifacts under eval/runlogs/e2e/<test-id>/, named by
outcome (see runlog_prefix):

- a gradeable run (verdict pass / partial / fail) uses the committable
  `run-<timestamp>.*` prefix and is committed. A committed `fail` is retained
  signal — "the system can't solve this yet; retry later" — exactly as a failing
  unit test is committed. Fixture *validity* is a separate axis: only a `pass`
  proves the fixture solvable (e2e-test-spec.md §14).
- a `skipped` run (the judge never ran — the agent crashed before producing any
  tree, so there is nothing to grade) uses `scratch_<timestamp>.*`, which
  `.gitignore` keeps out of version control.

The four files per run ({prefix} = `run-` or `scratch_`):

- {prefix}<timestamp>.json — structured result (this module)
- {prefix}<timestamp>.transcript.md — human-readable transcript
- {prefix}<timestamp>.final-tree.gedcomx.json — agent's final tree
- {prefix}<timestamp>.final-research.json — agent's final research.json

See e2e-test-spec.md §8.
"""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


@dataclass
class E2eResult:
    test_id: str
    captured_at: str  # ISO-8601 UTC

    # Verdict from the judge: "pass" | "partial" | "fail" — or "skipped"
    # when the judge did not run (e.g. SDK crashed before producing
    # any tree state).
    verdict: str

    # Why the run stopped. See spec §6.5.
    # One of: completed | inactivity | timeout | tool_cap | cost_cap |
    # max_turns | natural_end | error
    stop_reason: str

    # Structured judge output (per_finding, recall_required, recall_total,
    # verdict, rationale). Empty dict when judge was skipped.
    judge_output: dict[str, Any] = field(default_factory=dict)

    # Token / cost / duration counters from the SDK ResultMessage.
    usage: dict[str, Any] = field(default_factory=dict)

    # Every MCP tool call the agent attempted, in order. Each entry is
    # {tool, args, response_summary}. Critical for diffing across runs
    # when investigating drift.
    tool_calls: list[dict[str, Any]] = field(default_factory=list)

    # Free-text error message when stop_reason == "error".
    error: str | None = None

    # Tags copied from fixture.json — kept on the result so the roll-up
    # report can group without re-reading every fixture.
    tags: dict[str, str] = field(default_factory=dict)

    # Denied attempts to read the answer off the live tree (person_read /
    # person_search / person_ancestors are disabled in e2e runs — see
    # e2e-test-spec.md §6.1). Each entry is {tool, args}. A non-empty list
    # means the agent tried to shortcut research by reading the tree; the
    # calls were blocked, so the verdict is still earned from records, but
    # it's worth a reviewer's eye.
    blocked_tree_reads: list[dict[str, Any]] = field(default_factory=list)

    # Compact per-subagent transcript summaries (agent_type, per-turn
    # stop_reason / output_tokens / block shape, and a `runaway_thinking` flag).
    # Captured from the SDK's ephemeral subagent cache — which the runlog
    # otherwise does not store — so a subagent that burned its whole output
    # budget on thinking (stop_reason=max_tokens, no tool call), invisible from
    # `tool_calls` alone, is diagnosable directly from the committed runlog.
    # See subagent_capture.py.
    subagents: list[dict[str, Any]] = field(default_factory=list)


def timestamp_slug(now: datetime | None = None) -> str:
    """A filesystem-safe ISO-ish timestamp for filenames."""
    t = now or datetime.now(timezone.utc)
    return t.strftime("%Y-%m-%d_%H-%M-%S")


_GRADED_VERDICTS = frozenset({"pass", "partial", "fail"})


def is_committable_run(verdict: str) -> bool:
    """Whether a run produced a gradeable tree worth committing.

    A judge verdict of pass / partial / fail means the run produced a final
    tree, so it is committed as `run-<ts>.*` and must be graded (§7.4) —
    including a `fail`, which is retained signal: a capability gap to retry
    later, exactly as a failing unit test is committed. Only a `skipped` (or
    otherwise non-graded) run — the judge never ran, so there is no tree to
    grade — stays a gitignored `scratch_` run.

    Fixture *validity* is a separate axis (e2e-test-spec.md §14): only a `pass`
    proves the fixture solvable. A committed `fail` does NOT validate the
    fixture (validity is a recommended authoring practice, not a CI check).
    """
    return verdict in _GRADED_VERDICTS


def runlog_prefix(verdict: str) -> str:
    """`run-` for a gradeable run (pass/partial/fail), else `scratch_` (skipped)."""
    return "run-" if is_committable_run(verdict) else "scratch_"


def write_result_files(
    *,
    result: E2eResult,
    runlog_dir: Path,
    transcript: str,
    final_tree: dict[str, Any] | None,
    final_research: dict[str, Any] | None,
    timestamp: str | None = None,
) -> dict[str, Path]:
    """Write the four committed artifacts. Returns the paths written."""
    runlog_dir.mkdir(parents=True, exist_ok=True)
    ts = timestamp or timestamp_slug()
    stem = f"{runlog_prefix(result.verdict)}{ts}"

    paths = {
        "result": runlog_dir / f"{stem}.json",
        "transcript": runlog_dir / f"{stem}.transcript.md",
        "tree": runlog_dir / f"{stem}.final-tree.gedcomx.json",
        "research": runlog_dir / f"{stem}.final-research.json",
    }

    paths["result"].write_text(json.dumps(asdict(result), indent=2), encoding="utf-8")
    paths["transcript"].write_text(transcript, encoding="utf-8")
    if final_tree is not None:
        paths["tree"].write_text(json.dumps(final_tree, indent=2), encoding="utf-8")
    if final_research is not None:
        paths["research"].write_text(
            json.dumps(final_research, indent=2), encoding="utf-8"
        )

    return paths
