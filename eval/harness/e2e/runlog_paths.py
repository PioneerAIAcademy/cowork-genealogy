"""Where the committed e2e run logs are, and which files count as one.

Extracted from `guardrail_shadow_report` once a third module needed it
(`corpus_report`, `latency_report`). Corpus membership is a property of the
corpus, not of any one report — and `guardrail_shadow_report` is a shadow-mode
calibration tool that issue #911 expects to retire, so two unrelated reports
should not depend on it surviving.

**One definition of "a run file, not a sidecar."** `is_result_json` is it.
A second predicate answering the same question by a different mechanism is how
the two drift apart on the next sidecar shape someone adds, and a sidecar
counted as a run inflates every denominator in every report at once.
"""

from __future__ import annotations

from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
E2E_RUNLOGS = REPO_ROOT / "eval" / "runlogs" / "e2e"


def is_result_json(p: Path) -> bool:
    """A committed structured result, not its tree/research/ann/session siblings."""
    name = p.name
    return (
        name.startswith("run-")
        and name.endswith(".json")
        and not name.endswith(".ann.json")
        and ".final-" not in name
    )


def all_result_jsons() -> list[Path]:
    """EVERY committed run, not just the latest per fixture — calibration
    wants maximum sample size, unlike latency_report's "latest only" (which
    exists to avoid stale per-fixture latency numbers, a different goal)."""
    if not E2E_RUNLOGS.is_dir():
        return []
    out: list[Path] = []
    for d in sorted(E2E_RUNLOGS.iterdir()):
        if d.is_dir():
            out.extend(sorted(p for p in d.iterdir() if is_result_json(p)))
    return out


def result_jsons_for(test_slug: str) -> list[Path]:
    d = E2E_RUNLOGS / test_slug
    if not d.is_dir():
        return []
    return sorted(p for p in d.iterdir() if is_result_json(p))
