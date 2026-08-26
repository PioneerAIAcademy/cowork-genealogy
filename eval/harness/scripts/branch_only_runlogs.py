"""List graded e2e run logs that exist on some other ref but not HEAD.

GitHub issue #1444. `all_result_jsons()` (and every reader built on it) reads
`eval/runlogs/e2e/` in the CURRENT checkout only — a run graded and committed
on an unmerged branch is not skipped, it is never seen, and no reader can say
so. Every reader now prints a caveat saying that (`branch_scope_note()` in
`harness/since_window.py`); this is the on-demand remedy a human runs when
that caveat actually matters, not something embedded in every reader.

A 34-line prototype measured 2026-08-25 found 23 result JSONs across 16 stale
refs against zero runs behind an open PR that day, which is the reason a
reader-embedded crawl was rejected (see `guardrail-enforcement-spec.md` §4).
**That population count is a snapshot, not a standing property**: T-FEH's
review of this PR found a genuinely in-flight graded run (`elena-asmundsdotter-origin`,
behind open PR #1921) within about a day of the 2026-08-25 measurement — and
this script, run at review time, did not find it, for a structural reason and
not a bug: `_refs()` only sees LOCAL and REMOTE-TRACKING refs this checkout
already knows about, so a branch nobody has fetched here is invisible to it
regardless of how in-flight its work is. The Makefile target runs
`git fetch --prune origin` first for exactly this reason (still no query
against GitHub's PR state — a network-visible ref is not the same claim as
"behind an open PR", just a precondition for seeing it at all). The
23-across-16 figure stays a dated historical anchor, not a claim this script
reproduces on every checkout — the population is fetch-state-dependent by
construction.

Local refs only: diffs `git ls-tree` between HEAD and every LOCAL and
REMOTE-TRACKING ref already known to this checkout. The module itself makes
no network call — whatever the caller last fetched is what this sees (the
Makefile target fetches first; calling the module directly does not).
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
    """[(refname, tip date)] for every local branch and remote-tracking ref
    NOT already merged into HEAD.

    `--no-merged HEAD` drops a ref whose tip is a full ancestor of HEAD —
    that ref cannot be carrying a run "HEAD is missing", since every commit
    on it (including whichever one added the run) is already in HEAD's
    history. Without this, a ref merged long ago whose run log was later
    *deliberately deleted* from HEAD (`make prune-runlogs`, or a fixture
    rewrite like #627) is misreported as "present there, absent from HEAD" —
    a run committed-then-removed on purpose, not one this checkout has never
    seen (T-FEH's review of this PR; live example: `pauline-shaver-death-burial`
    and `scotland-thomson-grandparents`, deleted from HEAD by 13b36e6b/#627,
    still on the long-merged `senior-shaunese-applegarth-family-1878`).

    `refs/remotes/<remote>/HEAD` is a symbolic ref to another ref already in
    this list (excluded below), not a distinct branch — including it would
    double-report whatever it currently points at. Scoped to `refs/remotes/`
    specifically, not any ref ending in `/HEAD`: a real branch could be named
    e.g. `team/HEAD`. That said, this is not a fully precise symbolic-ref
    test — a remote-tracking branch literally named `<remote>/team/HEAD`
    would also be (wrongly) treated as symbolic and skipped; narrowing
    further would need `git symbolic-ref` per candidate, not justified for
    an edge case this rare in a discovery aid.
    """
    out = _git(
        "for-each-ref", "--no-merged", "HEAD",
        "--format=%(refname)\t%(committerdate:short)",
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
    # A path can sit on more than one ref (a local branch and its remote
    # twin, most often) -- de-dupe before counting, or the header
    # double-counts that run (T-FEH's review of this PR).
    unique_runs = {p for e in found.values() for p in e.paths}
    lines = [f"{len(unique_runs)} run(s) across {len(found)} ref(s):"]
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
