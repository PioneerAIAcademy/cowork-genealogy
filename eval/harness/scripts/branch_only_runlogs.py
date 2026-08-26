"""List graded e2e run logs that exist on some other ref but not HEAD.

GitHub issue #1444. `all_result_jsons()` (and every reader built on it) reads
`eval/runlogs/e2e/` in the CURRENT checkout only — a run graded and committed
on an unmerged branch is not skipped, it is never seen, and no reader can say
so. Every reader now prints a caveat saying that (`branch_scope_note()` in
`harness/since_window.py`); this is the on-demand remedy a human runs when
that caveat actually matters, not something embedded in every reader — a
34-line prototype measured 2026-08-25 found 23 result JSONs across 16 stale
refs against zero runs behind an open PR, so a reader-embedded version would
add that noise to every single invocation for no live gain.

Local refs only: diffs `git ls-tree` between HEAD and every LOCAL and
REMOTE-TRACKING ref already known to this checkout. No `git fetch`, no
network call — whatever `git fetch origin` last synced is what this sees.
Does not attempt to tell in-flight work from abandoned; the human triages,
which is why this is a script and not a warning baked into a reader.

CLI (from eval/harness/):  uv run python -m scripts.branch_only_runlogs
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path
from typing import NamedTuple

from e2e.runlog_selection import E2E_RUNLOGS, REPO_ROOT, is_result_json

E2E_RUNLOGS_REL = E2E_RUNLOGS.relative_to(REPO_ROOT).as_posix()


class RefEntry(NamedTuple):
    tip_date: str
    paths: list[str]


def _git(*args: str) -> str:
    return subprocess.check_output(
        ["git", *args], cwd=REPO_ROOT, text=True, encoding="utf-8"
    )


def _refs() -> list[tuple[str, str]]:
    """[(refname, tip date)] for every local branch and remote-tracking ref.

    `refs/remotes/<remote>/HEAD` is a symbolic ref to another ref already in
    this list (excluded below), not a distinct branch — including it would
    double-report whatever it currently points at. Scoped to `refs/remotes/`
    specifically, not any ref ending in `/HEAD`: a real branch could be named
    e.g. `team/HEAD`, and that must still be checked.
    """
    out = _git(
        "for-each-ref", "--format=%(refname)\t%(committerdate:short)",
        "refs/heads", "refs/remotes",
    )
    rows: list[tuple[str, str]] = []
    for line in out.splitlines():
        if not line.strip():
            continue
        ref, tip_date = line.split("\t", 1)
        if ref.startswith("refs/remotes/") and ref.endswith("/HEAD"):
            continue
        rows.append((ref, tip_date))
    return rows


def _result_json_paths(ref: str) -> set[str]:
    """Every graded-run path under `eval/runlogs/e2e/` as of `ref`."""
    out = _git("ls-tree", "-r", "--name-only", ref, "--", E2E_RUNLOGS_REL)
    return {
        line for line in out.splitlines()
        if line.strip() and is_result_json(Path(line))
    }


def branch_only() -> dict[str, RefEntry]:
    """{ref: RefEntry(tip_date, [paths present on ref but absent from HEAD])}.

    A ref whose listing is a subset of HEAD's is omitted entirely — nothing
    to report, not an empty group. A ref whose `git ls-tree` call fails (a
    stale/gone remote-tracking ref) is skipped: this is a discovery aid, not
    a gate, and one broken ref must not hide every other one's results.

    Listing every ref (`_refs()`) and reading HEAD's own listing are NOT
    given that same per-ref leniency — both are hard prerequisites (there is
    nothing to diff without them), so their failure propagates to `main()`
    rather than being swallowed into a false "nothing found".
    """
    head_paths = _result_json_paths("HEAD")
    found: dict[str, RefEntry] = {}
    for ref, tip_date in _refs():
        try:
            ref_paths = _result_json_paths(ref)
        except subprocess.CalledProcessError:
            continue
        only = sorted(ref_paths - head_paths)
        if only:
            found[ref] = RefEntry(tip_date, only)
    return found


def format_report(found: dict[str, RefEntry]) -> str:
    if not found:
        return "No graded run logs found on another ref that HEAD is missing."
    lines = [f"{sum(len(e.paths) for e in found.values())} run(s) across {len(found)} ref(s):"]
    for ref, entry in sorted(found.items(), key=lambda kv: kv[1].tip_date, reverse=True):
        lines.append(f"\n{ref} (tip {entry.tip_date}):")
        lines.extend(f"  {p}" for p in entry.paths)
    return "\n".join(lines)


def main() -> int:
    try:
        found = branch_only()
    except subprocess.CalledProcessError as e:
        print(f"Could not list refs or read HEAD's own tree: {e}", file=sys.stderr)
        return 1
    print(format_report(found))
    return 0


if __name__ == "__main__":
    sys.exit(main())
