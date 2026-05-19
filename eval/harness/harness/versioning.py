"""Run-log filename versioning + invocation classification.

Three kinds of run log live in `eval/runlogs/unit/<skill>/`:

  - `v{N}.json`                                released (final, immutable)
  - `v{N}_{YYYY-MM-DD}_{HH-MM-SS}.json`        candidate (full skill run, unreleased)
  - `scratch_{YYYY-MM-DD}_{HH-MM-SS}.json`     scratch (gitignored, partial / filtered)

A run is **releasable** iff the harness was invoked as `--skill <name>`
with no `--tag` or `--test` filter — i.e. the full skill suite ran. Any
filter makes it a scratch run (no version assignment, no release path,
no participation in active-state or trend).

See docs/plan/eval-runlog-versioning.md §A3, §A5, §A6.
"""

from __future__ import annotations

import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal, NamedTuple


# Filename grammar: `YYYY-MM-DD_HH-MM-SS` — underscore separates the
# date (hyphen-joined) from the time (hyphen-joined). Underscore also
# separates the kind prefix (`v{N}` or `scratch`) from the timestamp.
_TIMESTAMP = r"\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}"

RELEASED_RE = re.compile(rf"^v(\d+)\.json$")
CANDIDATE_RE = re.compile(rf"^v(\d+)_({_TIMESTAMP})\.json$")
SCRATCH_RE = re.compile(rf"^scratch_({_TIMESTAMP})\.json$")

RELEASED_ANN_RE = re.compile(rf"^v(\d+)\.ann\.json$")
CANDIDATE_ANN_RE = re.compile(rf"^v(\d+)_({_TIMESTAMP})\.ann\.json$")
SCRATCH_ANN_RE = re.compile(rf"^scratch_({_TIMESTAMP})\.ann\.json$")


RunLogKind = Literal["released", "candidate", "scratch", "other"]


class Classification(NamedTuple):
    kind: RunLogKind
    version: int | None
    timestamp: str | None


def classify(filename: str) -> Classification:
    """Identify a run log filename's role. Unrecognized names → 'other'."""
    if m := RELEASED_RE.match(filename):
        return Classification("released", int(m.group(1)), None)
    if m := CANDIDATE_RE.match(filename):
        return Classification("candidate", int(m.group(1)), m.group(2))
    if m := SCRATCH_RE.match(filename):
        return Classification("scratch", None, m.group(1))
    return Classification("other", None, None)


def classify_ann(filename: str) -> Classification:
    """Same as classify() but for `.ann.json` annotation filenames."""
    if m := RELEASED_ANN_RE.match(filename):
        return Classification("released", int(m.group(1)), None)
    if m := CANDIDATE_ANN_RE.match(filename):
        return Classification("candidate", int(m.group(1)), m.group(2))
    if m := SCRATCH_ANN_RE.match(filename):
        return Classification("scratch", None, m.group(1))
    return Classification("other", None, None)


def ann_filename_for(runlog_filename: str) -> str:
    """Return the `.ann.json` filename for the given run-log filename."""
    if not runlog_filename.endswith(".json"):
        raise ValueError(f"not a run log filename: {runlog_filename!r}")
    return runlog_filename[: -len(".json")] + ".ann.json"


def is_releasable_invocation(*, mode: str, has_tag_filter: bool) -> bool:
    """A run is releasable iff `--skill <name>` with no extra filters.

    `mode` is the CLI selection mode: "test" | "skill" | "all" | "tag".
    A `--skill X` invocation with `--tag` still filters tests within the
    skill, so it's not a full suite run.
    """
    return mode == "skill" and not has_tag_filter


def now_utc_filename_timestamp() -> str:
    """Filename-safe UTC timestamp: `YYYY-MM-DD_HH-MM-SS` (underscore
    between the date and time for readability)."""
    return datetime.now(timezone.utc).strftime("%Y-%m-%d_%H-%M-%S")


def scan_versions(skill_runlog_dir: Path) -> tuple[int, int]:
    """Return `(highest_released, highest_candidate)`.

    Either may be 0 when no file of that kind exists yet.
    """
    highest_released = 0
    highest_candidate = 0
    if not skill_runlog_dir.is_dir():
        return (0, 0)
    for path in skill_runlog_dir.iterdir():
        if not path.is_file():
            continue
        c = classify(path.name)
        if c.kind == "released":
            highest_released = max(highest_released, c.version or 0)
        elif c.kind == "candidate":
            highest_candidate = max(highest_candidate, c.version or 0)
    return (highest_released, highest_candidate)


def next_filename_for(
    *,
    skill_runlog_dir: Path,
    releasable: bool,
    timestamp: str | None = None,
) -> tuple[str, int | None]:
    """Resolve the filename for the next run log on a full-skill harness run.

    Returns `(filename, version_or_None)`.
      - releasable + candidate already exists for v{U} > released v{R}:
        next candidate is `v{U}_<ts>.json` (continue iterating).
      - releasable + no higher candidate: next is `v{R+1}_<ts>.json`
        (new candidate line). When neither released nor candidate exists,
        starts at v1.
      - not releasable: `scratch_<ts>.json`, version is None.
    """
    ts = timestamp or now_utc_filename_timestamp()
    if not releasable:
        return (f"scratch_{ts}.json", None)

    released, candidate = scan_versions(skill_runlog_dir)
    next_version = candidate if candidate > released else released + 1
    return (f"v{next_version}_{ts}.json", next_version)
