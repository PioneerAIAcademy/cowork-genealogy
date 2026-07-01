"""E2e result schema and persistence.

A run produces four artifacts under eval/runlogs/e2e/<test-id>/, named by
outcome (see runlog_prefix):

- a PASSING run uses the committable `run-<timestamp>.*` prefix — it is the
  fixture's validity artifact and is committed (e2e-test-spec.md §14).
- any other outcome (partial / fail / skipped) uses `scratch_<timestamp>.*`,
  which `.gitignore` keeps out of version control so a non-passing run can't
  be committed as if it validated the fixture.

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


def timestamp_slug(now: datetime | None = None) -> str:
    """A filesystem-safe ISO-ish timestamp for filenames."""
    t = now or datetime.now(timezone.utc)
    return t.strftime("%Y-%m-%d_%H-%M-%S")


def is_committable_run(verdict: str) -> bool:
    """Whether a run is the fixture's *validity* artifact (committed).

    Only a `pass` validates a fixture (e2e-test-spec.md §14); every other
    outcome is a scratch run that `.gitignore` keeps out of version control,
    so a failed run can't be committed as if it had validated the fixture.
    """
    return verdict == "pass"


def runlog_prefix(verdict: str) -> str:
    """`run-` for a committable (passing) run, otherwise `scratch_`."""
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
