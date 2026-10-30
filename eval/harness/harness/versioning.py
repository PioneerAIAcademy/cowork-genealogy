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

import json
import re
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, Iterable, Literal, NamedTuple


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


#: How many candidate run logs to keep per skill. Nothing in the repo reads
#: deeper than this: `skill_latency_report` reads logs[-1]/logs[-2],
#: `check_runlogs` and `skill-improver` read the latest, and the CRUD UI halts
#: on first match. `rubric-critic` is the one reader that wants depth — it
#: flags dimensions whose score "swings across runs/versions with no code
#: change" — which is why this is 5 and not 2. See GitHub issue #985.
DEFAULT_KEEP_CANDIDATES = 5


def prunable_candidates(filenames: list[str], *, keep: int) -> list[str]:
    """Candidate run-log filenames to delete, keeping the `keep` newest.

    Ordering is by (version, timestamp) — both ascending, so the newest
    candidate sorts last. Timestamps are `YYYY-MM-DD_HH-MM-SS`, which sorts
    correctly as a string.

    Never returns:
      - a **released** `v{N}.json` — those are the blessed canonical versions
        and are kept forever;
      - a **scratch** or unrecognized name — scratch runs are gitignored local
        artifacts, and `other` covers anything this module does not own.

    Keyed on rank, not age. An age rule would delete the *only* run log for
    any skill nobody touched that month, and `check_runlogs` rule 2 gates the
    next edit to that skill on exactly that file.
    """
    if keep < 1:
        raise ValueError(f"keep must be >= 1, got {keep}")
    candidates = [
        (c.version, c.timestamp, name)
        for name in filenames
        if (c := classify(name)).kind == "candidate"
        and c.version is not None
        and c.timestamp is not None
    ]
    candidates.sort()
    return [name for _, _, name in candidates[:-keep]] if len(candidates) > keep else []


def landed_order(skill_dir: Path, ref: str) -> dict[str, int] | None:
    """When each run log in `skill_dir` landed on `ref`: the position, counted
    from the oldest, of the first-parent commit that last added it. A log `ref`
    never added -- one a branch adds -- is absent. None when git cannot answer
    (no repository, an unknown ref).

    `--no-renames` so a candidate -> release rename counts as the release
    landing; first-parent so a log lands when its PR merged, not when the
    branch commit that wrote it was made."""
    try:
        out = subprocess.run(
            ["git", "log", "--first-parent", "--no-renames", "--diff-filter=A",
             "--relative", "--name-only", "--format=%x00", ref, "--", "."],
            cwd=skill_dir, capture_output=True, text=True, encoding="utf-8", check=True,
        ).stdout
    except (OSError, subprocess.CalledProcessError):
        return None
    commits = out.split("\x00")[1:]
    order: dict[str, int] = {}
    for i, block in enumerate(commits):
        for name in block.split():
            order.setdefault(name, len(commits) - i)
    return order


def _is_full_skill(name: str) -> bool:
    c = classify(name)
    return c.version is not None and (
        c.kind == "released" or (c.kind == "candidate" and c.timestamp is not None)
    )


def newest_full_skill_runlog(
    names: Iterable[str],
    read: Callable[[str], dict],
    *,
    landed: dict[str, int] | None = None,
) -> tuple[str, dict] | None:
    """Return (filename, parsed_log) for the newest full-skill run log among
    `names`, released or candidate; `read` parses one by name. Scratch runs
    ignored.

    With `landed` (`landed_order`), the log that landed last wins, and one that
    has not landed beats every one that has. Two PRs that run one suite can
    merge in the opposite order to the one they ran in, and the log that merged
    last is the one CI checked against the tree that followed.

    Among logs that landed together, or with no `landed`, by when the run
    happened, not by kind. A candidate line above the newest release starts
    only once that release exists (`next_filename_for`), so it is newer; one
    below it is older. A candidate left beside the release of its own version
    line can be either, so at equal versions the candidate's filename time is
    compared with the release's envelope `timestamp`, which the release flow
    preserves; the release wins a tie, and when it has no `timestamp` to
    compare.
    """
    if landed is not None:
        full = [n for n in names if _is_full_skill(n)]
        if full:
            last = max(landed.get(n, float("inf")) for n in full)
            names = [n for n in full if landed.get(n, float("inf")) == last]
    release: tuple[int, str] | None = None
    candidate: tuple[int, str, str] | None = None
    for name in names:
        c = classify(name)
        if c.kind == "released" and c.version is not None:
            release = max(release or (c.version, name), (c.version, name))
        elif c.kind == "candidate" and c.version is not None and c.timestamp is not None:
            entry = (c.version, c.timestamp, name)
            candidate = max(candidate or entry, entry)

    if release is not None and (candidate is None or candidate[0] <= release[0]):
        log = read(release[1])
        released_at = log.get("timestamp")
        if candidate is None or candidate[0] < release[0] or not released_at or str(released_at) >= candidate[1]:
            return release[1], log
    if candidate is None:
        return None
    return candidate[2], read(candidate[2])


def latest_full_skill_runlog(
    skill_dir: Path, ref: str | None = None
) -> tuple[str, dict] | None:
    """`newest_full_skill_runlog` over the run logs on disk in `skill_dir`,
    ordered by when they landed on `ref` when one is given and git can say."""
    return newest_full_skill_runlog(
        [p.name for p in skill_dir.iterdir() if p.is_file()],
        lambda name: json.loads((skill_dir / name).read_text(encoding="utf-8")),
        landed=landed_order(skill_dir, ref) if ref else None,
    )


def ann_filename_for(runlog_filename: str) -> str:
    """Return the `.ann.json` filename for the given run-log filename."""
    if not runlog_filename.endswith(".json"):
        raise ValueError(f"not a run log filename: {runlog_filename!r}")
    return runlog_filename[: -len(".json")] + ".ann.json"


InvocationMode = Literal["test", "skill", "tag"]
_VALID_MODES: frozenset[str] = frozenset({"test", "skill", "tag"})


def is_releasable_invocation(
    *,
    mode: InvocationMode,
    has_tag_filter: bool,
    runs_per_test: int = 1,
    tool_search: bool = True,
    store: str | None = None,
) -> bool:
    """A run is releasable iff `--skill <name>`, no tag filter, single run.

    `mode` is the CLI selection mode: "test" | "skill" | "tag". A
    `--skill X` invocation with `--tag` still filters tests within the
    skill, so it's not a full suite run. Unknown modes raise ValueError
    rather than silently returning False, so a future CLI mode that
    needs releasability has to be wired in explicitly.

    `runs_per_test` is the resolved runs-per-test for the invocation. A
    `--runs-per-test N` (N > 1) run repeats each test to surface the
    `flaky` flag; by lead ruling (issue #2816) it is a scratch run, never
    a committed candidate — so N > 1 makes the invocation non-releasable
    regardless of mode. The default 1 is the normal single-run path.

    `tool_search=False` (`--no-tool-search`, every tool schema loaded up
    front) is an experiment, not the configuration the corpus runs, so it is
    scratch by the same mechanism. So is `store="pg"` (`--store pg`, U15):
    a parity check of the Postgres backend, never a release.
    """
    if mode not in _VALID_MODES:
        raise ValueError(
            f"unknown invocation mode {mode!r}; expected one of "
            f"{sorted(_VALID_MODES)}"
        )
    return (
        mode == "skill"
        and not has_tag_filter
        and runs_per_test <= 1
        and tool_search
        and store is None
    )


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
