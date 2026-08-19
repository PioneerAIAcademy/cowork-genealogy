"""Why wiki and pop-stats calls fail, over committed e2e runs — issue #1552.

The blended failure-rate headline — one number that counted connectivity
failures — is correctly scoped but conflates five different causes under it, and
the fix for each is different (run this report for the current split). This report
splits every `wiki_search` / `wiki_read` / `wiki_place_page` / `place_population`
call in the committed corpus into a fixed taxonomy, then reports the split three
ways — by cause, by day, and by the run log's committing author.

No live run, no model, no API spend — same posture as `nudge_report.py`,
`latency_report.py` and `corpus_report.py`. It reads only committed run JSONs.

## The buckets, and why they are fixed (not re-derived per run)

`success`, `unreachable`, `upstream_5xx`, `no_wiki_page`, `no_population_series`,
`unresolvable_place`, `legacy_markdown_dir`, `other`, `unclassified`. They map to
distinct owners: `unreachable` + `upstream_5xx` are the service (or the machine's
reach to it); `no_wiki_page` + `no_population_series` are the corpus correctly
reporting it holds no data for a place; `unresolvable_place` is client-side;
`legacy_markdown_dir` is a dead code path that live code cannot produce
(`wikiMarkdownDir` was removed — `docs/specs/wiki-page-tool-spec.md:127`); `other`
is a recognised non-service failure (a too-large result, a tool the session never
loaded); `unclassified` is the load-bearing safety net.

`unclassified` is the whole point of the exercise. A classifier that folds what
it cannot match into `success` reports a lower failure rate than reality — the
same defect as the blended headline. So an unmatched shape lands in `unclassified`
and is printed with one example, never silently absorbed.

## Two traps this file is written around (issue #1552, "Method note")

1. **`response_summary` has two shapes.** Under ~4000 chars the raw MCP envelope
   is passed through with the tool's document as an escaped string
   (`\\"error\\":\\"Place not found\\"`); over it, the document is unwrapped and its
   keys are real JSON keys (`orchestrator.py::_summarize_tool_response`). Every
   matcher here is a BARE substring for that reason — a quoted-key match
   (`'"error":"Place not found"'`) misses the escaped form and undercounts. This
   was not hypothetical: matching quoted keys dropped 42 real `Place not found`
   responses into `unclassified` in the first cut of this file.

2. **Past 14 days the captures are STRIPPED, not just windowed out.** The e2e
   capture strip (`prune_runlogs.py --strip-e2e-captures`, eval/CLAUDE.md § "E2e
   capture strip") drops `response_summary` from every run log older than the
   14-day window, keeping only `tool`/`args`, and marks the file
   `captures_stripped: true`. A wiki call in a stripped run therefore carries no
   cause text at all, so it CANNOT be classified — this report counts it under a
   `stripped` tally and excludes it from the taxonomy rather than misfiling it as
   `unclassified` (which is reserved for a live shape the matchers do not know).
   The upshot is that the report's real horizon is the 14-day capture window: it
   classifies fresh runs fully, and `SINCE=all` mainly shows how much older data
   has been stripped. The `legacy_markdown_dir` bucket, all pre-14-day, is now
   stripped from the WORKING TREE — not lost: the pre-strip captures are still in
   git history (`git show <commit-before-b065b687>:<path>` recovers 111 of them
   from a single anders-monsen run), so a whole-corpus pass stays possible for
   anyone who wants it. This report reads the working tree only, which is a scope
   choice rather than a data-availability limit. Acceptable for that bucket
   either way, since the issue itself said the dead code path needs no
   investigation.

## Attribution is by commit author, not by machine

A run log records no host, so "who ran this" is approximated by the git author
who first committed the run log — a proxy for the machine, since a contributor
commits their own runs. The unreachable failures track the operator, not the
calendar (issue #1552 finding 1: on one day one contributor logged 31 unreachable
calls and 1 success while four others logged 25 successes and 0 failures in
interleaving runs). The by-author split is what surfaces that; the output labels
it a commit-author proxy so nobody reads it as a machine-level fact.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from collections import Counter, defaultdict
from pathlib import Path
from typing import Callable, NamedTuple

from e2e.runlog_selection import (
    REPO_ROOT,
    add_since_arg,
    all_result_jsons,
    describe_window,
    filter_since,
    result_jsons_for,
    run_date,
)

# The four tools whose failures issue #1552 is about. Matched on the BARE name,
# since the run log stores the server-qualified spelling
# (`mcp__genealogy__wiki_search`) and the qualifier varies by registrar.
WIKI_POP_TOOLS = frozenset(
    {"wiki_search", "wiki_read", "wiki_place_page", "place_population"}
)

# Display order for the taxonomy. `success` first, `unclassified` last so a
# non-empty safety net is the last thing a reader sees.
BUCKETS = (
    "success",
    "unreachable",
    "upstream_5xx",
    "no_wiki_page",
    "no_population_series",
    "unresolvable_place",
    "legacy_markdown_dir",
    "other",
    "unclassified",
)

# Meta-classes for the one-line rollup that answers the issue's thesis directly:
# the headline number is several different things. Ordered; `success` and the
# safety nets are handled outside this map.
CAUSE_CLASS = {
    "unreachable": "service failure (reach/uptime)",
    "upstream_5xx": "service failure (reach/uptime)",
    "no_wiki_page": "corpus has no data for the place",
    "no_population_series": "corpus has no data for the place",
    "unresolvable_place": "client-side (place did not resolve)",
    "legacy_markdown_dir": "dead code path (live code cannot produce)",
    "other": "other / uncategorised",
    "unclassified": "other / uncategorised",
}

# Ordered failure matchers; first hit wins. BARE substrings on purpose — see the
# module docstring, trap 1. Each phrase is a specific error string the tool
# emits, chosen not to collide with wiki article prose.
_FAILURE_MATCHERS: tuple[tuple[str, tuple[str, ...]], ...] = (
    (
        "unreachable",
        ("Could not reach wiki-query-api", "Population data service is unavailable"),
    ),
    ("legacy_markdown_dir", ("Wiki markdown directory is not configured",)),
    # A 5xx from either service — the same cause. Both tools format the failure
    # as `... error: {status}` (wiki-*.ts, place-population.ts:48), so the needle
    # pins the leading `5` to keep a 4xx out of a bucket named 5xx; a non-5xx
    # upstream status is rare and falls to `unclassified` honestly.
    ("upstream_5xx", ("wiki-query-api error: 5", "Population API error: 5")),
    ("no_wiki_page", ("No wiki page found for",)),
    ("unresolvable_place", ("to a single FamilySearch place",)),
    # place-population.ts passes the upstream 200 body through unread, so a place
    # with no series arrives as `{"error":"Place not found","place_id":...}`.
    ("no_population_series", ("Place not found",)),
    (
        "other",
        (
            "No such tool available",
            "Output too large",
            "exceeds maximum allowed tokens",
            "is disabled for this benchmark fixture",
        ),
    ),
)


def classify(tool: str, response_summary: str) -> str:
    """Which bucket one call's `response_summary` falls in.

    Failure matchers run first (they are specific error phrases); a response with
    none of them is either a success or, for `place_population`, the second
    no-series shape. Anything left is `unclassified` — never folded into success.
    """
    rs = response_summary or ""
    for bucket, needles in _FAILURE_MATCHERS:
        if any(n in rs for n in needles):
            return bucket

    # No error phrase. A wiki hit carries a page URL or a chunk count; both
    # survive either envelope shape as bare tokens.
    if "total_chunks" in rs or "/en/wiki/" in rs:
        return "success"

    # `place_population` returns `{place, population}` on success. A body that
    # resolved a place but carries no `population` series is the OTHER no-series
    # shape, distinct from the `Place not found` error handled above — it is a
    # data gap, not an unknown, so bucket it as such rather than leaking a known
    # cause into `unclassified`.
    if tool == "place_population":
        if "population" in rs:
            return "success"
        if "place" in rs:
            return "no_population_series"

    return "unclassified"


class Call(NamedTuple):
    """One wiki/pop-stats tool call, with everything the three splits need."""

    run: str  # "<fixture>/<run stem>"
    tool: str  # bare tool name
    bucket: str
    day: str  # ISO date, or "undated"
    author: str  # git author who first committed the run log (a machine proxy)
    sample: str  # truncated response_summary, for the other/unclassified examples


def _bare_tool(tool: str) -> str:
    """`mcp__genealogy__wiki_search` -> `wiki_search`; passes a bare name through."""
    return tool.rsplit("__", 1)[-1] if tool else tool


def commit_author(path: Path) -> str:
    """The git author who first committed `path` — a proxy for the machine that
    produced the run, since the run log records no host.

    `--diff-filter=A` selects the commits that ADDED the file; the oldest such
    (last line) is the first commit. Returns `(uncommitted)` for a run log not
    yet in git (a fresh local run) and `(unknown)` if git is unavailable — never
    raises, because a reporting tool must not die on a git hiccup.
    """
    try:
        out = subprocess.run(
            ["git", "log", "--diff-filter=A", "--follow", "--format=%an", "--", str(path)],
            capture_output=True,
            text=True,
            encoding="utf-8",
            cwd=str(REPO_ROOT),
            timeout=15,
        )
    except (OSError, subprocess.SubprocessError):
        return "(unknown)"
    names = [ln for ln in out.stdout.splitlines() if ln.strip()]
    return names[-1] if names else "(uncommitted)"


def resolve_authors(paths: list[Path]) -> dict[Path, str]:
    """First-commit author for many run logs in ONE `git log`, keyed by path.

    Per-file `commit_author` is correct but spawns one git process per run log
    (~60s over the committed corpus). This walks a single `--name-only` log
    newest-first and lets the OLDEST commit that names each file win — the same
    "first add" `commit_author` computes, at one subprocess. Falls back to the
    per-file resolver's answer (`(unknown)`/`(uncommitted)`) for any path the
    batch never named, so a locally-uncommitted run is still labelled.
    """
    authors: dict[Path, str] = {}
    try:
        out = subprocess.run(
            ["git", "log", "--diff-filter=A", "--name-only", "--format=%x01%an",
             "--", str(REPO_ROOT / "eval" / "runlogs" / "e2e")],
            capture_output=True, text=True, encoding="utf-8",
            cwd=str(REPO_ROOT), timeout=60,
        )
    except (OSError, subprocess.SubprocessError):
        return {p: commit_author(p) for p in paths}

    wanted = {str(p.resolve()): p for p in paths}
    current = ""
    for line in out.stdout.splitlines():
        if line.startswith("\x01"):
            current = line[1:].strip()
            continue
        if not line.strip():
            continue
        key = str((REPO_ROOT / line).resolve())
        p = wanted.get(key)
        if p is not None:
            # Newest-first stream, so a later (older) commit overwrites — leaving
            # the earliest add, which is exactly `commit_author`'s answer.
            authors[p] = current
    for p in paths:
        # NOT `setdefault(p, commit_author(p))`: setdefault evaluates its default
        # eagerly, so it would spawn a git process for every path even when the
        # batch already resolved it — defeating the one-shot `git log` above
        # (~72s vs 0.19s over the corpus). Only the paths the batch missed pay for
        # a per-file resolve.
        if p not in authors:
            authors[p] = commit_author(p)
    return authors


class ScanResult(NamedTuple):
    """What one scan of the run logs found."""

    calls: list[Call]     # classifiable wiki/pop calls (captures intact)
    unreadable: int       # run logs that failed to parse at all
    stripped_calls: int   # wiki/pop calls whose response_summary was stripped
    stripped_runs: int    # distinct stripped runs that held wiki/pop calls


def scan(
    paths: list[Path], author_of: Callable[[Path], str] = commit_author
) -> ScanResult:
    """Classify every wiki/pop-stats call whose captures survive, and tally the
    two kinds of call that cannot be classified.

    A run older than the 14-day capture window has been through the e2e capture
    strip (`captures_stripped: true`), which drops `response_summary` — so its
    wiki calls carry no cause text and are counted as `stripped`, NOT run through
    the classifier (where a missing summary would masquerade as `unclassified`
    and inflate the unknown bucket the whole report is built to keep honest).
    Unreadable run logs are tallied too: a corpus that is entirely stripped or
    unreadable must not print "no calls found" and read as a clean run.
    `author_of` is injectable so tests need not shell out to git.
    """
    calls: list[Call] = []
    unreadable = 0
    stripped_calls = 0
    stripped_runs = 0
    for p in paths:
        run = f"{p.parent.name}/{p.stem}"
        try:
            doc = json.loads(p.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            unreadable += 1
            continue
        stripped = bool(doc.get("captures_stripped"))
        d = run_date(p)
        day = d.isoformat() if d else "undated"
        author = author_of(p)
        run_stripped_hits = 0
        for tc in doc.get("tool_calls") or []:
            tool = _bare_tool(str((tc or {}).get("tool") or ""))
            if tool not in WIKI_POP_TOOLS:
                continue
            if stripped:
                stripped_calls += 1
                run_stripped_hits += 1
                continue
            rs = (tc or {}).get("response_summary")
            rs = rs if isinstance(rs, str) else json.dumps(rs)
            calls.append(
                Call(run, tool, classify(tool, rs), day, author, rs[:200].replace("\n", " "))
            )
        if run_stripped_hits:
            stripped_runs += 1
    return ScanResult(calls, unreadable, stripped_calls, stripped_runs)


def _pct(n: int, total: int) -> str:
    return f"{(100 * n / total):.0f}%" if total else "0%"


def _bucket_tail(counts: Counter, exclude: frozenset[str] = frozenset({"success"})) -> str:
    """Nonzero buckets as `bucket=count`, taxonomy order, minus `exclude`."""
    parts = [f"{b}={counts[b]}" for b in BUCKETS if b not in exclude and counts.get(b)]
    return " ".join(parts)


def _stripped_note(stripped_calls: int, stripped_runs: int) -> str:
    return (
        f"{stripped_calls} wiki/pop-stats call(s) in {stripped_runs} run(s) had "
        "their response_summary stripped past the 14-day capture window and "
        "cannot be classified by cause (only tool + args survive the strip). They "
        "are excluded from the taxonomy below, NOT counted as unclassified."
    )


def format_report(
    calls: list[Call],
    n_runs: int,
    unreadable: int = 0,
    stripped_calls: int = 0,
    stripped_runs: int = 0,
) -> str:
    if not calls:
        base = (
            "No classifiable wiki or pop-stats calls in the selected runs."
        )
        if stripped_calls:
            base += "\n" + _stripped_note(stripped_calls, stripped_runs)
        else:
            base += (
                "\nThat is a real result: no run in the window called wiki_search, "
                "wiki_read, wiki_place_page or place_population."
            )
        if unreadable:
            base += (
                f"\nAlso, {unreadable} run log(s) in the window could not be parsed, "
                "so this is not proof of a clean corpus — fix those and re-run."
            )
        return base

    by_bucket = Counter(c.bucket for c in calls)
    by_tool = Counter(c.tool for c in calls)
    total = len(calls)
    runs_hit = {c.run for c in calls}

    lines = [
        f"{total} classifiable wiki/pop-stats call(s) across {len(runs_hit)} of {n_runs} run(s)"
        f"   tools: " + ", ".join(f"{t}={by_tool[t]}" for t in sorted(by_tool)),
        "Attribution below is by the git author who first committed each run "
        "log — a proxy for the machine that ran it, not a host record.",
    ]
    if stripped_calls:
        lines.append("NOTE: " + _stripped_note(stripped_calls, stripped_runs))
    if unreadable:
        lines.append(
            f"NOTE: {unreadable} run log(s) in the window could not be parsed and "
            "are excluded from every count below."
        )

    # By cause — the taxonomy, plus the meta-rollup that answers the issue's
    # thesis: the one headline number is several different things.
    lines += ["", "By cause:"]
    for b in BUCKETS:
        # `unclassified` always prints, even at 0: it is the safety net, and a
        # reader has to see it was checked and empty, not merely absent.
        if by_bucket.get(b) or b == "unclassified":
            lines.append(f"  {by_bucket[b]:>4}  {_pct(by_bucket[b], total):>4}  {b}")
    meta = Counter()
    for b, n in by_bucket.items():
        if b == "success":
            continue
        meta[CAUSE_CLASS[b]] += n
    if meta:
        lines += ["", "  Non-success calls by kind (the headline conflates these):"]
        for kind, n in meta.most_common():
            lines.append(f"    {n:>4}  {_pct(n, total):>4}  {kind}")

    # By day — a day carries both successes and failures when different operators
    # ran it, which is the evidence that this is not downtime.
    by_day: dict[str, Counter] = defaultdict(Counter)
    for c in calls:
        by_day[c.day][c.bucket] += 1
    lines += ["", "By day:"]
    for day in sorted(by_day):
        cc = by_day[day]
        dt = sum(cc.values())
        tail = _bucket_tail(cc)
        lines.append(
            f"  {day}   {dt:>4} call(s)   success={cc['success']}"
            + (f"   {tail}" if tail else "")
        )

    # By author — sorted by unreachable rate then volume, to surface the
    # per-operator reachability split (issue #1552 finding 1).
    by_author: dict[str, Counter] = defaultdict(Counter)
    for c in calls:
        by_author[c.author][c.bucket] += 1
    lines += ["", "By run-log author (commit-author proxy, NOT a machine record):"]
    ranked = sorted(
        by_author.items(),
        key=lambda kv: (-(kv[1]["unreachable"] / sum(kv[1].values())), -sum(kv[1].values())),
    )
    for author, cc in ranked:
        at = sum(cc.values())
        tail = _bucket_tail(cc, exclude=frozenset({"success", "unreachable"}))
        lines.append(
            f"  {author}   {at:>4} call(s)   success={cc['success']}"
            f"   unreachable={cc['unreachable']} ({_pct(cc['unreachable'], at)})"
            + (f"   {tail}" if tail else "")
        )

    # Examples for the two catch-alls — one per distinct shape, so a reader can
    # see what `other`/`unclassified` actually held rather than trust a count.
    for bucket in ("other", "unclassified"):
        rows = [c for c in calls if c.bucket == bucket]
        if not rows:
            continue
        seen: set[str] = set()
        lines += ["", f"{bucket} ({len(rows)}) — one example per shape:"]
        for c in rows:
            key = c.sample[:60]
            if key in seen:
                continue
            seen.add(key)
            lines.append(f"  [{c.tool}] {c.sample}")

    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Why wiki/pop-stats calls fail, over committed e2e runs (issue #1552).",
    )
    parser.add_argument("--test", default=None, help="Only this fixture slug.")
    add_since_arg(parser)
    args = parser.parse_args(argv)

    all_paths = result_jsons_for(args.test) if args.test else all_result_jsons()
    cutoff = args.since
    paths = filter_since(all_paths, cutoff)
    if not paths:
        where = f" on/after {cutoff.isoformat()}" if (cutoff and all_paths) else ""
        print(f"No committed runs found{where}.", file=sys.stderr)
        return 1

    authors = resolve_authors(paths)
    result = scan(paths, author_of=lambda p: authors.get(p, "(unknown)"))
    print(describe_window(cutoff, n_runs=len(paths), n_total=len(all_paths)))
    print(
        format_report(
            result.calls,
            n_runs=len(paths),
            unreadable=result.unreadable,
            stripped_calls=result.stripped_calls,
            stripped_runs=result.stripped_runs,
        )
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
