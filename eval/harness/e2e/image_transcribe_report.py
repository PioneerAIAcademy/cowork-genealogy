"""How often `image_transcribe` fails to reach OpenRouter, over committed e2e runs.

Issue #1594's reachability half. That issue reported 26 of 267 calls (9.7%) lost
to reachability rather than to content, and shipped a shell snippet to re-derive
it. The snippet no longer works, and the way it breaks is the reason this file
exists rather than a corrected one-liner.

No live run, no model, no API spend — same posture as `wiki_failure_report.py`,
`nudge_report.py` and `corpus_report.py`. It reads committed run JSONs only.

## The instrument shrank, and the number it prints went DOWN

`b065b687` ("e2e retention: strip response_summary past 14 days") landed after
#1594 was filed. It drops `response_summary` from every run log older than the
14-day window and marks the file `captures_stripped: true`.

The snippet greps `response_summary`, so a stripped call can never match its
numerator — but it stays in its denominator. Measured 2026-08-23: 134 of 159 run
logs stripped, 219 of 394 `image_transcribe` calls carrying no summary at all.

    naive re-run          30 / 394 = 7.6%    <- reads as the problem receding
    over measurable calls 30 / 175 = 17.1%
    issue headline        26 / 267 = 9.7%

The corpus rate is not recoverable from the working tree: it is bounded only by
7.6% (if no stripped call errored) and 63% (if every one did). So this report
prints the stripped tally as a first-class line and never a bare percentage
without the denominator it was taken over. A shrinking corpus must read as
shrinking evidence, not as good news.

**There is no durable field to switch to.** `is_error` survives the strip, but
every call carrying it is already unstripped — the stripped calls predate run-log
schema v3 and have neither field. It also over-counts: `Unrecognized ark` is
`is_error: true` and is a content error, not reachability (3 in the corpus; the
2 that postdate schema v3 carry the field). So the horizon is genuinely the
14-day capture window, and
`SINCE=all` mainly shows how much has been stripped. Pre-strip captures remain in
git history if a whole-corpus pass is ever wanted.

## Why the by-author split does NOT answer "host-side or OpenRouter"

`wiki_failure_report.py` established, for the wiki tools, that unreachable
failures track the operator rather than the calendar — one contributor logged 31
unreachable calls and 1 success while four others logged 25 successes and 0
failures the same day. That shape is decisive because the runs *interleave*.

The same split over `image_transcribe` clusters too, but it is NOT the same
shape, and this report says so rather than letting the clustering be read as
proof. Only three days in the corpus carry more than one operator, and on the
single one with any failures BOTH operators failed. So the by-author table here
is a lead, not a verdict, and `interleaving_verdict()` prints that in words.

The definitive split needs the socket cause codes added by PR #1785 (2026-08-20).
There are zero cause-coded failures in the corpus today; they accumulate from
post-#1785 runs. This report will show them under `unreachable` with the code
once they land.
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import Counter, defaultdict
from pathlib import Path
from typing import Callable, NamedTuple

from e2e.runlog_selection import all_result_jsons, result_jsons_for, run_date
# Reused, not re-implemented: `commit_author` spawns one git process per run log
# (~60s over the corpus) and `resolve_authors` does the same work in a single
# `git log`. Both are public and already carry the "first add wins" subtlety.
# Left in their module rather than lifted to a shared one — this is the second
# consumer, so a third is the point to lift (CLAUDE.md § Code reuse).
from e2e.wiki_failure_report import commit_author, resolve_authors
from harness.since_window import add_since_arg, describe_window, filter_since

# Matched on the BARE tail so every server spelling resolves — the harness
# registers `mcp__genealogy__`, Cowork uses two other prefixes (CLAUDE.md
# § "Dual-spelled tool names"). Deliberately not a shared `bare_tool` helper:
# six near-copies of that already exist across the harness with three different
# guards, and adding a seventh is the wrong direction.
TOOL_SUFFIX = "image_transcribe"

# Buckets, fixed rather than re-derived per run, and mapped to distinct owners:
# `unreachable`/`timeout` are the service or the machine's reach to it (the
# subject of #1594); `unrecognized_ark` and `upstream_error` are the call being
# wrong or the upstream refusing it, NOT reachability; `unclassified` is the
# safety net.
SUCCESS = "success"
UNREACHABLE = "unreachable"
TIMEOUT = "timeout"
UNRECOGNIZED_ARK = "unrecognized_ark"
UPSTREAM_ERROR = "upstream_error"
UNCLASSIFIED = "unclassified"

#: The two buckets #1594 counts as "lost to reachability, not to content".
REACHABILITY_BUCKETS = (UNREACHABLE, TIMEOUT)


def classify(response_summary: str) -> str:
    """Which bucket one call's response text falls in.

    Unescape first, then match: `response_summary` has two shapes depending on
    size — under ~4000 chars the MCP envelope is passed through with the document
    as an escaped string, over it the document is unwrapped and its keys are real
    JSON keys (`orchestrator.py::_summarize_tool_response`). A quoted-key matcher
    run against the RAW text silently misses the escaped form;
    `wiki_failure_report.py` learned this the expensive way, with 42 real
    responses falling into `unclassified`. Unescaping below is what makes the
    `"error":` key match safe on both shapes — and the key match is in turn what
    keeps a transcription that merely quotes the word from reading as a failure.
    """
    # Unescaped before matching. `response_summary` has two shapes, and in the
    # escaped one the document's own keys read `\"error\"` — which contains
    # neither `"error"` nor `error:`, so the two generic matchers below saw
    # nothing and the call fell through to `success`. 52 of the 175 measurable
    # calls are in that shape. None carries an error today, so no printed number
    # moves; but "an unknown shape never lands in success" is the one guarantee
    # this classifier exists for, and it was holding for only 70% of the corpus.
    s = (response_summary or "").lower().replace('\\"', '"')
    # `"null"` is what `json.dumps(None)` produces. `"none"` is deliberately
    # NOT here: `scan` never calls `str()`, so no infrastructure path produces
    # it, and the only thing it could match is a genuine transcription of the
    # word — filing a real success as unclassified.
    #
    # The orchestrator creates
    # every tool-call entry with `response_summary: None`, filling it when the
    # result streams back. A run cut off by its wall-clock or tool cap mid-call
    # therefore commits a null summary — likeliest on this tool, the slowest one
    # at 180s. Non-empty, so it sailed past the guard below into `success`.
    # (Measured: 0 such calls in the committed corpus today — this is a latent
    # hole in the guarantee, not a live miscount.) The sibling
    # `wiki_failure_report.py` defaults to `unclassified` here; this one
    # defaulted to `success`, so the guard was the only protection.
    if s.strip() in ("", "null"):
        # Never `success`. An absent summary means we cannot see the outcome, and
        # folding it into success is the exact under-reporting this file exists
        # to stop. Stripped runs are excluded upstream, before reaching here.
        return UNCLASSIFIED
    if "could not reach openrouter" in s:
        return UNREACHABLE
    if "timed out after" in s:
        return TIMEOUT
    if "unrecognized ark" in s:
        return UNRECOGNIZED_ARK
    # The envelope shape (`"error":`), not a bare `"error"` substring.
    # Unescaping above is what makes the loose form dangerous: a genuine
    # transcription that QUOTES the word — `the clerk wrote "error" in the
    # margin` — unescapes to contain `"error"` and was filed as a failure,
    # dropping a real success from the reached count. That is the reverse of
    # the direction unescaping was added for; key-adjacency avoids both.
    if '"error":' in s:
        return UPSTREAM_ERROR
    return SUCCESS


class Call(NamedTuple):
    run: str
    bucket: str
    day: str
    author: str
    sample: str


class ScanResult(NamedTuple):
    calls: list[Call]
    unreadable: int
    stripped_calls: int
    stripped_runs: int

    @property
    def measurable(self) -> int:
        return len(self.calls)

    @property
    def reachability_failures(self) -> int:
        return sum(1 for c in self.calls if c.bucket in REACHABILITY_BUCKETS)


def scan(
    paths: list[Path],
    author_of: Callable[[Path], str] = commit_author,
) -> ScanResult:
    """Classify every `image_transcribe` call whose captures survive, and tally
    the two kinds of call that cannot be classified.

    A run past the 14-day capture window carries `captures_stripped: true` and no
    `response_summary`, so its calls are counted as `stripped` and NOT run
    through the classifier — where a missing summary would masquerade as
    `unclassified` and inflate the unknown bucket this report keeps honest.
    Unreadable run logs are tallied too: a corpus that is entirely stripped or
    unreadable must not print "no calls found" and read as clean.

    `author_of` is injectable so tests need not shell out to git.
    """
    calls: list[Call] = []
    unreadable = stripped_calls = stripped_runs = 0
    for p in paths:
        run = f"{p.parent.name}/{p.stem}"
        # THE WHOLE PER-RUN BODY IS THE PROTECTED REGION, not the parse alone.
        #
        # Two reviews running found a malformed shape that escaped this guard:
        # first a run log that was valid JSON but not an object, then a truthy
        # non-list `tool_calls` (42, True) reaching `for tc in ...`. Same cause
        # both times — the guard enumerated the shapes someone had thought of, so
        # each fix closed one and left its neighbour. A run log is written by
        # another process; the honest failure domain is the RUN, not a list of
        # shapes. Anything malformed anywhere in one run now costs that run only.
        #
        # Nothing is counted until the run parses cleanly, so a run that throws
        # half way cannot leave its first few calls in the tally.
        run_calls: list[Call] = []
        run_stripped = 0
        try:
            doc = json.loads(p.read_text(encoding="utf-8"))
            if not isinstance(doc, dict):
                raise ValueError("run log is not a JSON object")
            stripped = bool(doc.get("captures_stripped"))
            d = run_date(p)
            day = d.isoformat() if d else "undated"
            author = author_of(p)
            for tc in doc.get("tool_calls") or []:
                if not isinstance(tc, dict):
                    continue
                if not str(tc.get("tool") or "").endswith(TOOL_SUFFIX):
                    continue
                if stripped:
                    run_stripped += 1
                    continue
                rs = tc.get("response_summary")
                rs = rs if isinstance(rs, str) else json.dumps(rs)
                run_calls.append(
                    Call(run, classify(rs), day, author, rs[:160].replace("\n", " "))
                )
        except (
            OSError,
            UnicodeDecodeError,
            json.JSONDecodeError,
            ValueError,
            TypeError,
            AttributeError,
        ):
            unreadable += 1
            continue

        calls.extend(run_calls)
        stripped_calls += run_stripped
        if run_stripped:
            stripped_runs += 1
    return ScanResult(calls, unreadable, stripped_calls, stripped_runs)


def interleaving_verdict(calls: list[Call]) -> tuple[str, list[str]]:
    """Whether this corpus can separate a machine-side cause from a service-side one.

    It can only do so on days when more than one operator ran: if one fails while
    another succeeds in the same window, the cause travels with the machine. With
    no such day — or none carrying a failure — the by-author table below is a
    lead and nothing more, and saying that plainly is the point.
    """
    # Three counters per cell: [reachability failures, total calls, REACHED].
    # "Reached" is a demonstrated `success`, not merely the absence of a failure.
    # An operator whose calls were all `unrecognized_ark` has no reachability
    # failure and yet never got as far as OpenRouter — that error is raised
    # before the call is made — so counting them as a concurrent success would
    # print "points at the machine" on evidence that shows nothing about reach.
    # This is the one function whose whole job is to not over-claim.
    by_day: dict[str, dict[str, list[int]]] = defaultdict(
        lambda: defaultdict(lambda: [0, 0, 0])
    )
    for c in calls:
        cell = by_day[c.day][c.author]
        cell[1] += 1
        if c.bucket in REACHABILITY_BUCKETS:
            cell[0] += 1
        elif c.bucket == SUCCESS:
            cell[2] += 1

    rows: list[str] = []
    split_days = 0
    for day in sorted(by_day):
        if len(by_day[day]) < 2:
            continue
        split_days += 1
        parts = " ".join(
            f"{a}={e}/{n}" for a, (e, n, _r) in sorted(by_day[day].items())
        )
        rows.append(f"  {day}: {parts}")

    if split_days == 0:
        return (
            "CANNOT SEPARATE machine from service: no day has more than one "
            "operator, so no failure is ever observed against a concurrent success.",
            rows,
        )
    def _separates(cells: dict[str, list[int]]) -> bool:
        """A DISTINCT operator must have reached, not merely someone.

        Asking "did anyone fail" and "did anyone reach" as two independent
        questions is satisfied by ONE operator who did both — and a day where
        alice failed once, alice succeeded once, and bob only threw
        `unrecognized_ark` printed "another succeeded, which points at the
        machine" though no second operator ever reached OpenRouter. The claim
        needs two different people: someone who failed, and someone else who
        demonstrably got through.

        The eligible reacher must have had NO failure of their own
        (`reached - failed`), which is stricter than "someone else succeeded",
        and the corpus is why. On 2026-08-13 Gennecis failed 11 and reached 31,
        and mercyokum failed 2 and reached 2 — both failed AND both got through.
        That pattern is intermittency affecting everyone who ran, which is
        evidence AGAINST a machine-specific cause, so counting one of them as the
        other's "concurrent success" would print "points at the machine" on data
        that argues the opposite. Requiring a clean operator is what isolates the
        difference to the operator. Under-claiming is the safe direction for the
        one function whose job is to not over-claim.
        """
        failed = {a for a, (e, _n, _r) in cells.items() if e}
        reached = {a for a, (_e, _n, r) in cells.items() if r}
        return bool(failed) and bool(reached - failed)

    mixed = [
        day
        for day in by_day
        if len(by_day[day]) >= 2 and _separates(by_day[day])
    ]
    if mixed:
        return (
            f"SEPARATES on {len(mixed)} day(s) — one operator failed while another "
            "succeeded concurrently, which points at the machine rather than the "
            f"service: {', '.join(sorted(mixed))}.",
            rows,
        )
    return (
        f"CANNOT SEPARATE machine from service: {split_days} day(s) have more than "
        "one operator, but none shows one operator failing while another succeeds, "
        "so the clustering below is a lead, not a verdict.",
        rows,
    )


def format_report(result: ScanResult) -> str:
    """The report. Every rate carries the denominator it was taken over."""
    out: list[str] = []
    m = result.measurable
    total_seen = m + result.stripped_calls

    out.append("image_transcribe reachability over committed e2e runs (issue #1594)")
    out.append("")
    out.append(f"  {TOOL_SUFFIX} calls found:      {total_seen}")
    out.append(
        f"  captures STRIPPED (>14d):    {result.stripped_calls} "
        f"in {result.stripped_runs} run(s) — cannot be classified, excluded below"
    )
    out.append(f"  measurable:                  {m}")
    if result.unreadable:
        out.append(f"  UNREADABLE run logs:         {result.unreadable}")
    out.append("")

    if m == 0:
        out.append(
            "  NO MEASURABLE CALLS. This is not a 0% failure rate — it means every "
            "capture in range has been stripped or is unreadable. Narrow SINCE, or "
            "recover pre-strip captures from git history."
        )
        return "\n".join(out)

    fails = result.reachability_failures
    out.append(
        f"  lost to reachability:        {fails} of {m} measurable "
        f"({round(100 * fails / m, 1)}%)"
    )
    if result.stripped_calls:
        lo = round(100 * fails / total_seen, 1)
        hi = round(100 * (fails + result.stripped_calls) / total_seen, 1)
        out.append(
            f"  true rate over this window:  unrecoverable — bounded [{lo}%, {hi}%] "
            "by what the strip removed"
        )
    else:
        # Nothing stripped in range, so the rate above IS the rate. Saying
        # "unrecoverable" here would overstate the uncertainty, which is the
        # same failure as understating it.
        out.append(
            "  true rate over this window:  exact — no captures stripped in range"
        )
    out.append("")

    out.append("By cause:")
    counts = Counter(c.bucket for c in result.calls)
    for bucket, n in counts.most_common():
        mark = "  <- reachability" if bucket in REACHABILITY_BUCKETS else ""
        out.append(f"  {bucket:18} {n:>5} of {m}{mark}")
    unc = [c for c in result.calls if c.bucket == UNCLASSIFIED]
    if unc:
        out.append(f"  example unclassified: {unc[0].sample!r}")
    out.append("")

    verdict, rows = interleaving_verdict(result.calls)
    out.append("Can this corpus tell machine from service?")
    out.append(f"  {verdict}")
    if rows:
        out.append("  Days with more than one operator:")
        out.extend(rows)
    out.append("")

    out.append("By commit author (a machine proxy — a run log records no host):")
    by_author: dict[str, list[int]] = defaultdict(lambda: [0, 0])
    for c in result.calls:
        by_author[c.author][1] += 1
        if c.bucket in REACHABILITY_BUCKETS:
            by_author[c.author][0] += 1
    for author, (e, n) in sorted(by_author.items(), key=lambda kv: -kv[1][0]):
        out.append(f"  {author[:32]:32} {e:>4} of {n:>4} ({round(100 * e / n):>3}%)")
    return "\n".join(out)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="image-transcribe-report",
        description="image_transcribe reachability over committed e2e run logs (#1594).",
    )
    parser.add_argument("--test", default=None, help="Only this fixture slug.")
    # Windowed like its five aggregating siblings (eval/CLAUDE.md § Run log
    # naming): mixing eras corrupts one tallied number. Here the default window
    # is doubly right — past 14 days the captures are stripped, so `SINCE=all`
    # mostly reports how much can no longer be classified.
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
    print(format_report(result))
    # Non-zero when nothing could be measured: a report that inspected nothing
    # must not read as a clean bill of health.
    return 1 if result.measurable == 0 else 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
