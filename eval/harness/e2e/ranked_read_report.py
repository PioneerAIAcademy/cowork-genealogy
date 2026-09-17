"""Are the main thread's record reads inside the ranker's VISIBLE top 3?

GitHub issue #1156. No live run, no model, no API spend — it reads committed
run JSONs only, same posture as `nudge_report.py`, `corpus_report.py`,
`compaction_report.py` and `image_transcribe_report.py`.

## The question this corpus can answer, and the one it cannot

Not "did the ranker surface it". `_summarize_response` (`harness/judge.py`)
samples any list past three entries into `{_summary_truncated, _full_length,
_first_n}`, and `ranked.matches` is a list whose `_full_length` runs to 10. So
ranks 4-10 are never in the artifact and a read at rank 7 is indistinguishable
from a read of an unranked record. The full scored list is not recoverable
either: `rank_search_matches` appends every candidate to
`results/match-scores.jsonl`, but the e2e harness commits only the
`.final-research.json` / `.final-tree.gedcomx.json` sidecars — `results/` dies
with the temp project.

What is answerable is the narrower thing this module reports: **was the record
the main thread chose to read inside the visible top 3 by `matchRank`?**

## The capture envelope is a list, not a dict

**Every figure in this docstring is dated, and they move.** The corpus grows as
runs land and shrinks when `make prune-runlogs STRIP=1` drops captures past 14
days, so re-derive rather than quote: `make e2e-ranked-reads SINCE=2026-08-04`
prints the current values as its own preamble. The figures below were measured
**2026-09-17** over that window (34 runs).

`_summarize_tool_response` (`e2e/orchestrator.py`) leaves the MCP content-block
list in place, so `response_summary` deserializes to `[{...}]` and NOT to the
document itself. Of the 185 `ranked`-bearing captures, **119 parse to a list
whose element 0 carries `ranked`, 66 raise, and zero parse to a dict**. An
implementation reading `doc["ranked"]` joins nothing at all, on every capture,
while every hand-written unit fixture passes.
A second shape exists too — `[{"type": "text", "text": "{...}"}]`, which is
what `research_log_append` returns — so `_unwrap` descends both.

`ranked_matches` therefore gates its regex fallback on the `ranked` value being
**unreachable**, never on `json.loads` failing (119 captures parse fine and
still need the descent) and never on `len(summary) >= 4000` (the cap is a
constant that can move — `_RUNLOG_MAX_CHARS`, `orchestrator.py`).

## Only the main thread's reads count

`record_search` is called only by the main thread, but a third of
`record_read` calls are not its: 224 main-thread against 84 `record-extractor`
and 32 `person-evidence`. A subagent runs in fresh context and never saw the `ranked` block — it reads the `recordId` it was
handed. Counting those against "the agent ignored the ranker" mis-attributes a
third of the denominator, so they are reported separately as delegated reads.

## How a read is attributed to a search — four arms, counted separately

1. `args.resultsRef` naming a `results/.staging/<uuid>.json` handle, matched to
   the `record_search` whose `staged.resultsRef` emitted it. Exact.
2. `args.resultsRef` naming a `results/log_NNN.json` sidecar, matched through
   the `research_log_append` whose response carries that `resultsRef` and whose
   `args.stagedResultsRef` names the staging handle from arm 1.
3. Nearest preceding main-thread `record_search` in `aligned_calls` order, for
   everything else — **including a ref that resolves to neither**.

4. `earlier-ranked`: the nearest preceding search ranked nothing, so the read
   is attributed to the most recent search that did. `previous` advances on
   EVERY main-thread search, so without this a subject-less sweep between a
   ranking and the read it drove buried that ranking and the read was
   discarded as `ranking-skipped` — 100 of 174 scorable reads. It scores in
   BOTH directions, so it cannot flatter the headline.

Arm 1 covers 19 of the 174 scorable reads, arm 2 just 1 and arm 4 fully 100, so
the headline is predominantly heuristic-joined. `format_report` prints the arm
split, and reports the rate separately for the strong arms (1-3) and arm 4,
because the two rest on very different evidence: 28/74 against 9/100.

## Exclusions, each counted rather than silently dropped

Listed in the order `scan_run` applies them. A read can qualify for several at
once and is counted **once**, in the first it matches — so this order is load
bearing, not presentational:

1. `read-errored`: the `record_read` itself returned an error, so it can never
   join and must not land in the miss column.
2. `unusable-record-id`: `args.recordId` is absent or not a string.
3. `image-ark`: the read's id is a `3:1:` document-image ark, a different id
   space from `ranked[].recordId` — it can never join.
4. `no-preceding-search`: the read had no main-thread search before it.
5. `ranking-skipped`: the supplying search carried `rankingSkipped`, so there
   was no ranking to ignore. This is the analysis-time control
   `record-search-tool-spec-v2.md` says the field exists to enable, and it is
   the confound the issue was filed against (subject-less broad sweeps).
6. `no-ranking-signal`: the supplying search carried neither `ranked` nor
   `rankingSkipped` — a nil search (ranking needs `out.staged`), an errored
   search, or a capture cut before either field.
7. `ranked-no-matches`: the supplying search carried a `ranked` block that
   PARSED and surfaced nothing — the subject would not resolve. Same "no
   ranking to ignore" case as (5), and the preamble's `visible ranked depth
   ... 0:N` line is this population.
8. `ranked-unreadable`: a `ranked` block the recovery could not read. Split
   out of (7) because merging them let a parser limit assert that the search
   ranked nothing — a claim about the ranker drawn from a failure to parse.
9. `unjoinable-id-space`: a `1:2:` read where no visible match carries a
   `recordArk` to join on (`toStub` leaves it optional). The join is
   impossible, so scoring it `not_in_top3` would report the agent reading
   outside a ranking when the truth is that this report cannot see.

Whole runs are excluded separately: `unsegmentable-timeline` /
`tool-count-mismatch` when `aligned_calls` rejects one, `unreadable` when the
file does not parse as a JSON object.

The ordering is not academic. The only main-thread `3:1:` read in the
2026-08-04 window **also** errored, so it lands in `read-errored` and
`image-ark` reads zero there while the bucket is doing real work — which is
why that bucket carries a synthetic test rather than relying on live data.

## Counts, not a rate

`docs/architecture.md` section 9.4 gap 3: "Do not quote a violation rate", and
`make e2e-corpus` "deliberately reports counts, refusing a percentage whose
denominator would be doing the work". Here the denominator is doing exactly
that work — 224 main-thread reads become 174 scorable once the exclusions
above are applied — so this report's primary output is counts by bucket and
any rate appears inline as `n/d`.

CLI (from eval/harness/):
  uv run python -m e2e.ranked_read_report --since 2026-08-04
  uv run python -m e2e.ranked_read_report --test hannah-earnest-children --since all
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter
from pathlib import Path
from typing import Any, NamedTuple

from e2e.compaction_report import EARLY_MAX_SEGMENT, aligned_calls
from e2e.runlog_selection import (
    add_since_arg,
    all_result_jsons,
    branch_scope_note,
    describe_window,
    filter_since,
    result_jsons_for,
    run_date,
)
from harness.context_policy import bare_tool_name

#: The visible depth of `ranked.matches` in a committed capture. `judge.py`'s
#: `_summarize_response` keeps `_first_n` at three entries, so this is a
#: property of the artifact, not a choice.
TOP_N = 3

#: `TOP_N` and the `--cap` default restate two constants that live upstream:
#: how many list entries `judge._summarize_response` keeps, and where
#: `orchestrator._RUNLOG_MAX_CHARS` truncates a capture. Both are read from
#: their owners at import so a change there fails here rather than silently
#: re-defining what "visible" and "at the cap" mean in this report. Imported
#: inside the guard so a refactor that moves either name is a loud ImportError
#: at the assert, not a stale duplicate nobody re-derived.
def _assert_upstream_constants() -> None:
    from harness.judge import _RESPONSE_ARRAY_SAMPLE
    from e2e.orchestrator import _RUNLOG_MAX_CHARS

    assert TOP_N == _RESPONSE_ARRAY_SAMPLE, (
        f"TOP_N={TOP_N} but judge samples {_RESPONSE_ARRAY_SAMPLE} entries — "
        "the 'visible top N' this report measures is no longer what the "
        "capture actually keeps"
    )
    assert DEFAULT_CAP == _RUNLOG_MAX_CHARS, (
        f"DEFAULT_CAP={DEFAULT_CAP} but orchestrator truncates at "
        f"{_RUNLOG_MAX_CHARS} — the 'at the cap' denominator counts the "
        "wrong population"
    )


DEFAULT_CAP = 4000

#: Below this many scorable late-segment reads, print a count and refuse a
#: rate. The window that motivated the report has ~3, which is not a rate.
LATE_RATE_FLOOR = 10

CAVEAT = (
    "Caveat: only the VISIBLE top 3 is measurable. judge.py truncates "
    "ranked.matches past three entries and the full list (_full_length up to "
    "10) is never committed, so a read at rank 7 is indistinguishable here "
    "from a read of an unranked record. 'not in visible top 3' is therefore "
    "an upper bound on ranker disagreement, not a count of ignored rankings. "
    "This measures the eval corpus, not production (architecture.md 9.4 gap "
    "3): there is no production telemetry, so it answers 'did this happen in "
    "our runs', never 'is this getting better for a real user'."
)

# --- id normalization -------------------------------------------------------
# Mirrors arkToBareId (packages/engine/mcp-server/src/utils/ark.ts). The TYPE
# prefix is kept, unlike the TS helper, because it decides which field a read
# joins against: a 1:1: persona id matches ranked[].recordId while a 1:2:
# record-source id matches ranked[].recordArk. Collapsing both to a bare tail
# (as the issue's "normalize with arkToBareId" would) silently scores every
# 1:2: read as a miss.

_ARK_TYPED_RE = re.compile(r"ark:/61903/(\d:\d):([A-Za-z0-9.-]+)")
_BARE_PREFIXED_RE = re.compile(r"^(\d:\d):([A-Za-z0-9.-]+)$")

#: Ids in these spaces can never match a ranked entry.
IMAGE_ARK_TYPES = frozenset({"3:1", "3:2"})


def id_key(value: Any) -> tuple[str | None, str] | None:
    """`(type_prefix, bare_tail)` for any FamilySearch id form, or None.

    A bare `XXXX-XXX` id carries no type and returns `(None, value)`; it is
    joined against `recordId`, which is what the 7 bare reads in the corpus
    are. Never throws — mirrors the TS helper's defensive contract.
    """
    if not isinstance(value, str) or not value:
        return None
    trimmed = value.strip()
    m = _ARK_TYPED_RE.search(trimmed)
    if m:
        return m.group(1), m.group(2)
    m = _BARE_PREFIXED_RE.match(trimmed)
    if m:
        return m.group(1), m.group(2)
    return None, trimmed


# --- capture unwrapping -----------------------------------------------------

#: Every recovery pattern tolerates BOTH serializations, not just the `ranked`
#: key. A capture can arrive with its JSON escaped inside a text block
#: (`{\"matchRank\": 1}`), and fixing only `_RANKED_KEY_RE` produced the worst
#: possible combination on an escaped-and-truncated capture: `has_ranked=True`
#: with zero recovered matches, which the exclusion below then labelled
#: `ranked-no-matches` — a parser failure recorded as a finding about the
#: ranker. One rule for every key, so the two cannot drift apart again.
_MATCH_RANK_RE = re.compile(r'\\?"matchRank\\?"\s*:\s*(\d+)')
_RECORD_ID_RE = re.compile(r'\\?"recordId\\?"\s*:\s*\\?"([^"\\]+)')
_RECORD_ARK_RE = re.compile(r'\\?"recordArk\\?"\s*:\s*\\?"([^"\\]+)')

#: A `ranked` KEY in either serialization. A capture can arrive with its JSON
#: escaped inside a text block (`{\"ranked\": ...}`), where the plain `"ranked"`
#: form is absent — `orchestrator._summarize_tool_response` documents exactly
#: this trap and says to match the bare name, which both forms contain. Written
#: as a key match rather than a bare substring so prose ("unranked") cannot
#: satisfy it.
_RANKED_KEY_RE = re.compile(r'\\?"ranked\\?"\s*:')


def _unwrap(summary: str) -> dict | None:
    """The document inside a `response_summary`, or None.

    Handles both committed envelopes: `[{...document...}]` (what a tool
    returning structured content produces) and `[{"type": "text", "text":
    "{...}"}]` (what `research_log_append` produces). Descends at most two
    levels so a malformed capture cannot loop.
    """
    try:
        value: Any = json.loads(summary)
    except (TypeError, ValueError):
        return None
    for _ in range(3):
        if isinstance(value, list):
            value = value[0] if value else None
            continue
        if isinstance(value, dict):
            text = value.get("text")
            if value.get("type") == "text" and isinstance(text, str):
                try:
                    value = json.loads(text)
                except ValueError:
                    return None
                continue
            return value
        return None
    return value if isinstance(value, dict) else None


class RankedMatch(NamedTuple):
    rank: int
    record_id: tuple[str | None, str] | None
    record_ark: tuple[str | None, str] | None


def _matches_by_regex(summary: str) -> list[RankedMatch]:
    """Recover visible matches from a capture whose JSON is cut mid-document.

    Bounded: each match object's fields are taken from the slice between its
    own `matchRank` and the next one, so a truncated tail yields fewer matches
    rather than fields borrowed from a neighbour.
    """
    spans = list(_MATCH_RANK_RE.finditer(summary))
    out: list[RankedMatch] = []
    for i, m in enumerate(spans):
        end = spans[i + 1].start() if i + 1 < len(spans) else len(summary)
        chunk = summary[m.end() : end]
        rid = _RECORD_ID_RE.search(chunk)
        ark = _RECORD_ARK_RE.search(chunk)
        out.append(
            RankedMatch(
                rank=int(m.group(1)),
                record_id=id_key(rid.group(1)) if rid else None,
                record_ark=id_key(ark.group(1)) if ark else None,
            )
        )
    return out


def ranked_matches(summary: str) -> tuple[list[RankedMatch], bool]:
    """`(matches, recovered_by_regex)` for one `record_search` capture.

    Gated on the `ranked` block being UNREACHABLE, not on the parse failing —
    119 of the corpus's 185 ranked captures parse cleanly and still need the
    list descent, and a length test would bind to a movable constant.
    """
    doc = _unwrap(summary)
    if isinstance(doc, dict):
        ranked = doc.get("ranked")
        if isinstance(ranked, dict):
            raw = ranked.get("matches")
            if isinstance(raw, dict):
                raw = raw.get("_first_n")
            if isinstance(raw, list):
                out = []
                for entry in raw:
                    if not isinstance(entry, dict):
                        continue
                    rank = entry.get("matchRank")
                    if not isinstance(rank, int):
                        continue
                    out.append(
                        RankedMatch(
                            rank=rank,
                            record_id=id_key(entry.get("recordId")),
                            record_ark=id_key(entry.get("recordArk")),
                        )
                    )
                return out, False
    return _matches_by_regex(summary), True


# --- per-run scan -----------------------------------------------------------


class SearchInfo(NamedTuple):
    staging_ref: str | None
    has_ranked: bool
    ranking_skipped: bool
    matches: list[RankedMatch]
    by_regex: bool


class ReadRow(NamedTuple):
    run: str
    segment: int
    arm: str          # "staging" | "log" | "nearest" | "none"
    outcome: str      # "in_top3" | "not_in_top3" | an exclusion reason


def _search_info(call: dict) -> SearchInfo:
    summary = call.get("response_summary") or ""
    doc = _unwrap(summary)
    staging_ref = None
    if isinstance(doc, dict):
        staged = doc.get("staged")
        if isinstance(staged, dict) and isinstance(staged.get("resultsRef"), str):
            staging_ref = staged["resultsRef"]
    if staging_ref is None:
        m = re.search(r'"resultsRef"\s*:\s*"(results/\.staging/[^"]+)"', summary)
        staging_ref = m.group(1) if m else None
    has_ranked = bool(_RANKED_KEY_RE.search(summary))
    matches, by_regex = ranked_matches(summary) if has_ranked else ([], False)
    return SearchInfo(
        staging_ref=staging_ref,
        has_ranked=has_ranked,
        ranking_skipped="rankingSkipped" in summary,
        matches=matches,
        by_regex=by_regex,
    )


def _read_outcome(read_id: tuple[str | None, str], info: SearchInfo) -> str:
    """Whether a read's id appears among the search's visible top-N matches.

    A `1:2:` record-source id is joined against `recordArk`; a `1:1:` or bare
    id against `recordId`. Both forms occur in the corpus and both are real.
    """
    kind, tail = read_id
    visible = [m for m in info.matches if m.rank <= TOP_N]
    for match in visible:
        target = match.record_ark if kind == "1:2" else match.record_id
        if target is not None and target[1] == tail:
            return "in_top3"
    # A `1:2:` read can only ever join on `recordArk`, which `toStub` leaves
    # optional — 34 of 181 regex-recovered entries carry none. When no visible
    # match has one, the join is structurally impossible, and reporting
    # `not_in_top3` would state that the agent read outside the ranking when
    # what actually happened is that this report cannot see. Excluded and
    # counted, the same as any other unmeasurable read.
    if kind == "1:2" and not any(m.record_ark is not None for m in visible):
        return "unjoinable-id-space"
    return "not_in_top3"


def scan_run(
    doc: dict,
    run: str,
    precomputed: tuple[list | None, str | None] | None = None,
) -> tuple[list[ReadRow], Counter, str | None]:
    """`(rows, delegated, exclusion_reason)` for one run.

    `delegated` counts subagent `record_read` calls by `agent_type` — reported
    separately, never scored against the main thread's choice.
    """
    # `precomputed` lets `scan` hand over the alignment it already did.
    # Absent — every direct caller, including the tests — it aligns here,
    # so the two paths cannot diverge in behaviour, only in how often the
    # work is done.
    aligned, reason = precomputed if precomputed is not None else aligned_calls(doc)
    if reason is not None:
        return [], Counter(), reason

    staging_to_search: dict[str, SearchInfo] = {}
    logref_to_staging: dict[str, str] = {}
    for _elapsed, _segment, call in aligned:
        tool = bare_tool_name(call.get("tool") or "")
        if tool == "research_log_append":
            payload = _unwrap(call.get("response_summary") or "")
            staged_ref = (call.get("args") or {}).get("stagedResultsRef")
            if isinstance(payload, dict) and isinstance(staged_ref, str):
                log_ref = payload.get("resultsRef")
                if isinstance(log_ref, str):
                    logref_to_staging[log_ref] = staged_ref

    rows: list[ReadRow] = []
    delegated: Counter = Counter()
    previous: SearchInfo | None = None
    last_ranked: SearchInfo | None = None
    for _elapsed, segment, call in aligned:
        tool = bare_tool_name(call.get("tool") or "")
        agent = call.get("agent_type")
        if tool == "record_search" and agent is None:
            info = _search_info(call)
            if info.staging_ref:
                staging_to_search[info.staging_ref] = info
            previous = info
            # Tracked separately from `previous`: a later barren search must
            # not erase the last ranking the agent actually saw (see the
            # fallback below).
            if info.has_ranked and info.matches:
                last_ranked = info
            continue
        if tool != "record_read":
            continue
        if agent is not None:
            delegated[agent] += 1
            continue

        args = call.get("args") or {}
        ref = args.get("resultsRef")
        arm, supplying = "nearest", previous
        if isinstance(ref, str):
            if ref in staging_to_search:
                arm, supplying = "staging", staging_to_search[ref]
            elif ref in logref_to_staging and logref_to_staging[ref] in staging_to_search:
                arm, supplying = "log", staging_to_search[logref_to_staging[ref]]

        if call.get("is_error"):
            rows.append(ReadRow(run, segment, arm, "read-errored"))
            continue
        read_id = id_key(args.get("recordId"))
        if read_id is None:
            rows.append(ReadRow(run, segment, arm, "unusable-record-id"))
            continue
        if read_id[0] in IMAGE_ARK_TYPES:
            rows.append(ReadRow(run, segment, arm, "image-ark"))
            continue
        if supplying is None:
            rows.append(ReadRow(run, segment, "none", "no-preceding-search"))
            continue
        # A barren nearest-preceding search does not mean there was no ranking
        # to follow. `previous` advances on EVERY main-thread search, so a
        # subject-less broad sweep between a ranked search and the read it
        # drove used to hide that ranking entirely: the read was excluded as
        # `ranking-skipped` while its id sat in the earlier search's visible
        # top 3. Falling back to the most recent search that actually ranked
        # scores those instead of discarding them.
        #
        # The fallback scores in BOTH directions — a read attributed this way
        # can come back `not_in_top3` — so it cannot flatter the headline. The
        # `earlier-ranked` arm in the attribution table is how many rest on it;
        # they lean on a ranking the agent saw earlier in the run rather than
        # immediately before the read.
        if not (supplying.has_ranked and supplying.matches) and last_ranked is not None:
            arm, supplying = "earlier-ranked", last_ranked
        if supplying.ranking_skipped and not supplying.has_ranked:
            rows.append(ReadRow(run, segment, arm, "ranking-skipped"))
            continue
        if not supplying.has_ranked:
            rows.append(ReadRow(run, segment, arm, "no-ranking-signal"))
            continue
        if not supplying.matches:
            # A `ranked` block that surfaced nothing. Two causes, and they are
            # NOT the same finding: the subject would not resolve (a real
            # no-ranking, like `rankingSkipped`), or the capture could not be
            # read and the recovery found none (a parser limit). Filing both
            # under one label made an unreadable capture assert that the search
            # ranked nothing, which is a claim about the ranker drawn from a
            # failure to parse. `by_regex` tells them apart: a block that
            # parsed as JSON and still holds no match genuinely ranked nothing.
            reason = "ranked-unreadable" if supplying.by_regex else "ranked-no-matches"
            rows.append(ReadRow(run, segment, arm, reason))
            continue
        rows.append(ReadRow(run, segment, arm, _read_outcome(read_id, supplying)))
    return rows, delegated, None


class LoadedRun(NamedTuple):
    """One run, read and cursor-aligned ONCE.

    `scan` and `preamble` both walk every run in the window, and both used to
    `read_text` + `json.loads` + `aligned_calls` each file independently. That
    is twice the work, but the reason to share it is correctness rather than
    speed: two independent walks are two places for the population to drift
    apart, and they already did — the preamble once counted tool calls from
    runs the body had dropped, printing 1450 reads against 526 scored under a
    header calling any disagreement a bug in the join. Both now consume the
    same list, so a run either contributes to both or to neither.
    """

    run: str
    path: Path
    doc: dict | None  #: None when the file does not parse to an object.
    aligned: list | None  #: None when `aligned_calls` rejected the timeline.
    reason: str | None  #: Why it was rejected, for the exclusion counters.


def load_runs(paths: list[Path]) -> list[LoadedRun]:
    """Read, parse and align each run exactly once."""
    out: list[LoadedRun] = []
    for path in paths:
        run = f"{path.parent.name}/{path.stem}"
        try:
            doc = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, UnicodeDecodeError, ValueError):
            doc = None
        if not isinstance(doc, dict):
            out.append(LoadedRun(run, path, None, None, None))
            continue
        aligned, reason = aligned_calls(doc)
        out.append(LoadedRun(run, path, doc, aligned, reason))
    return out


def scan(
    paths: list[Path], loaded: list[LoadedRun] | None = None
) -> tuple[list[ReadRow], Counter, Counter, list[str]]:
    """Every main-thread `record_read` across the given runs.

    Returns `(rows, delegated, excluded, unreadable_files)`. Excluded runs are
    counted rather than silently dropped, and `unreadable_files` names them so
    a caller can print which files to go and look at — same contract as
    `compaction_report.scan` and `corpus_report`.
    """
    rows: list[ReadRow] = []
    delegated: Counter = Counter()
    excluded: Counter = Counter()
    unreadable_files: list[str] = []
    for item in loaded if loaded is not None else load_runs(paths):
        if item.doc is None:
            excluded["unreadable"] += 1
            unreadable_files.append(item.run)
            continue
        run_rows, run_delegated, reason = scan_run(
            item.doc, item.run, precomputed=(item.aligned, item.reason)
        )
        if reason:
            excluded[reason] += 1
            continue
        rows.extend(run_rows)
        delegated.update(run_delegated)
    return rows, delegated, excluded, unreadable_files


# --- corpus preamble --------------------------------------------------------


class Preamble(NamedTuple):
    searches: int
    ranked: int
    ranking_skipped: int
    at_cap: int
    unparseable: int
    reads: Counter
    depth: Counter
    #: Oldest and newest run actually read. `describe_window` names the
    #: REQUESTED cutoff and prints no dates at all under `--since all`, which
    #: is not the same thing: issue #1156 asks for the range actually read,
    #: because `make prune-runlogs STRIP=1` can shrink the corpus between two
    #: runs of this report and a figure is only readable against the span it
    #: was taken over.
    first_run: str | None
    last_run: str | None


def preamble(
    paths: list[Path], cap: int, loaded: list[LoadedRun] | None = None
) -> Preamble:
    """The denominators this report is taken over, printed before any finding.

    The issue that commissioned this report pins these figures; a disagreement
    between them and a new run of this function is a bug in the join, not a
    finding, so they are printed rather than assumed.
    """
    searches = ranked = skipped = at_cap = unparseable = 0
    reads: Counter = Counter()
    depth: Counter = Counter()
    #: Dated from the runs that actually CONTRIBUTED, not from every path
    #: offered. Taking the span over `paths` let an unreadable or unsegmentable
    #: run — one whose traffic is deliberately absent from every count above —
    #: still widen the range printed beside those counts, so the line could
    #: claim a corpus the figures were never taken over.
    contributing: list = []
    for item in loaded if loaded is not None else load_runs(paths):
        path, doc = item.path, item.doc
        if doc is None:
            continue
        # Same population as `scan`. Counting tool calls from runs the body
        # drops makes the two disagree by the excluded runs' whole traffic —
        # at SINCE=all that was 1450 reads in the preamble against 526 scored,
        # printed under a header calling any disagreement a bug in the join.
        # The dropped runs are still reported, on the exclusion line.
        if item.reason is not None:
            continue
        contributing.append(path)
        for call in doc.get("tool_calls") or []:
            if not isinstance(call, dict):
                continue
            tool = bare_tool_name(call.get("tool") or "")
            summary = call.get("response_summary") or ""
            if tool == "record_search":
                searches += 1
                if len(summary) >= cap:
                    at_cap += 1
                if "rankingSkipped" in summary:
                    skipped += 1
                if _RANKED_KEY_RE.search(summary):
                    ranked += 1
                    matches, by_regex = ranked_matches(summary)
                    if by_regex:
                        unparseable += 1
                    depth[min(len([m for m in matches if m.rank <= TOP_N]), TOP_N)] += 1
            elif tool == "record_read":
                reads[call.get("agent_type") or "main"] += 1
    dates = sorted(d for d in (run_date(p) for p in contributing) if d is not None)
    return Preamble(
        searches,
        ranked,
        skipped,
        at_cap,
        unparseable,
        reads,
        depth,
        first_run=dates[0].isoformat() if dates else None,
        last_run=dates[-1].isoformat() if dates else None,
    )


def format_preamble(pre: Preamble) -> str:
    lines = [
        "Denominators (a disagreement here is a bug in the join, not a finding):",
        f"  record_search calls              {pre.searches}",
        f"    carrying a ranked block        {pre.ranked}",
        f"    carrying rankingSkipped        {pre.ranking_skipped}",
        f"    at the run-log capture cap     {pre.at_cap}",
        f"    ranked, but cut mid-JSON       {pre.unparseable}",
        "  record_read calls by caller",
    ]
    for caller, n in sorted(pre.reads.items(), key=lambda kv: (-kv[1], str(kv[0]))):
        lines.append(f"    {str(caller):<28} {n}")
    visible = ", ".join(f"{d}:{pre.depth.get(d, 0)}" for d in (3, 2, 1, 0))
    lines.append(f"  visible ranked depth (rank<={TOP_N})  {visible}")
    span = (
        f"{pre.first_run} .. {pre.last_run}"
        if pre.first_run
        else "no dated runs"
    )
    lines.append(f"  corpus date range actually read  {span}")
    return "\n".join(lines)


# --- report -----------------------------------------------------------------


def format_report(
    rows: list[ReadRow],
    delegated: Counter,
    n_runs: int,
    excluded: Counter,
    unreadable_files: list[str] | None = None,
) -> str:
    n_excluded = sum(excluded.values())
    if n_excluded:
        exclusion_line = (
            f"{n_excluded} of {n_runs} run(s) excluded: "
            + ", ".join(f"{v} {k}" for k, v in sorted(excluded.items()))
        )
    else:
        exclusion_line = f"0 of {n_runs} run(s) excluded."
    if unreadable_files:
        exclusion_line += "\n  unreadable: " + ", ".join(unreadable_files)

    if not rows:
        return (
            f"{exclusion_line}\n"
            "No main-thread record_read calls in the segmentable runs in this "
            "window. That is a real result, not an empty one — check the "
            "exclusion count above before reading it as 'no read activity'."
        )

    SCORED = ("in_top3", "not_in_top3")
    scorable = [r for r in rows if r.outcome in SCORED]
    # Keyed on the outcome, not on membership of `scorable`: `r not in
    # scorable` is a linear scan per row, and it also compared rows by
    # value rather than by the property actually being tested.
    dropped = Counter(r.outcome for r in rows if r.outcome not in SCORED)

    lines = [exclusion_line, ""]
    lines.append(f"Main-thread record_read calls: {len(rows)}")
    for reason, n in sorted(dropped.items(), key=lambda kv: (-kv[1], kv[0])):
        lines.append(f"  excluded, {reason:<22} {n}")
    lines.append(f"  scorable                     {len(scorable)}")

    if delegated:
        lines.append("")
        lines.append("Delegated reads (subagents never saw the ranked block):")
        for agent, n in sorted(delegated.items(), key=lambda kv: (-kv[1], kv[0])):
            lines.append(f"  {agent:<28} {n}")

    if scorable:
        arms = Counter(r.arm for r in scorable)
        lines.append("")
        lines.append("How each scorable read was attributed to a search:")
        # Every arm a row can carry must be listed. A missing name silently
        # drops its rows from this table while `len(scorable)` still counts
        # them, so the table stopped summing to the population it describes.
        for arm in ("staging", "log", "nearest", "earlier-ranked", "none"):
            if arms.get(arm):
                lines.append(f"  {arm:<28} {arms[arm]}")
        assert sum(arms.values()) == len(scorable), (
            f"attribution table {sum(arms.values())} != scorable {len(scorable)} "
            f"— an arm is missing from the list above: {sorted(arms)}"
        )
        exact = arms.get("staging", 0) + arms.get("log", 0)
        earlier = arms.get("earlier-ranked", 0)
        lines.append(
            f"  -> {exact} of {len(scorable)} joined by an explicit resultsRef; "
            f"{earlier} rest on a ranking from earlier in the run (the nearest "
            "preceding search ranked nothing); the rest on nearest-preceding."
        )

        inside = sum(1 for r in scorable if r.outcome == "in_top3")
        lines.append("")
        lines.append(
            f"Inside the visible top {TOP_N}: {inside}/{len(scorable)}    "
            f"outside: {len(scorable) - inside}/{len(scorable)}"
        )
        # Split by how the read was attributed, because the two rest on very
        # different evidence and blending them hides that. A read joined to the
        # search immediately before it — or by an explicit resultsRef — is a
        # strong claim about which ranking the agent was looking at. One
        # attributed to a ranking from earlier in the run, with a barren search
        # in between, is a weaker one: the agent may have been working from
        # that older list, or from nothing this report can see. Report both and
        # let the reader weight them rather than quoting a single blended rate.
        strong = [r for r in scorable if r.arm != "earlier-ranked"]
        weak = [r for r in scorable if r.arm == "earlier-ranked"]
        if strong and weak:
            s_in = sum(1 for r in strong if r.outcome == "in_top3")
            w_in = sum(1 for r in weak if r.outcome == "in_top3")
            lines.append(
                f"  attributed to the search just before the read: {s_in}/{len(strong)}"
            )
            lines.append(
                f"  attributed to an earlier ranking (weaker):     {w_in}/{len(weak)}"
            )

        early = [r for r in scorable if r.segment <= EARLY_MAX_SEGMENT]
        late = [r for r in scorable if r.segment > EARLY_MAX_SEGMENT]
        e_in = sum(1 for r in early if r.outcome == "in_top3")
        l_in = sum(1 for r in late if r.outcome == "in_top3")
        lines.append(
            f"  segments 0-{EARLY_MAX_SEGMENT} (early): {e_in}/{len(early)}"
        )
        if len(late) < LATE_RATE_FLOOR:
            lines.append(
                f"  segment {EARLY_MAX_SEGMENT + 1}+ (late):    {l_in}/{len(late)} "
                f"- n={len(late)}, too few to state a rate"
            )
        else:
            lines.append(
                f"  segment {EARLY_MAX_SEGMENT + 1}+ (late):    {l_in}/{len(late)}"
            )

    lines.append("")
    lines.append(CAVEAT)
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Whether the main thread's record reads were inside the ranker's "
            "visible top 3, over committed e2e runs (issue #1156)."
        ),
    )
    parser.add_argument("--test", default=None, help="Only this fixture slug.")
    # Deliberately a flag with a literal default rather than an import of
    # `_RUNLOG_MAX_CHARS`: `e2e.orchestrator` imports `claude_agent_sdk` at
    # module scope, and this is a pure-analysis reader that must stay
    # importable without the SDK. The literal is only ever a DENOMINATOR
    # label — nothing branches on it, because the regex fallback is gated on
    # the `ranked` value being unreachable, never on length.
    parser.add_argument(
        "--cap",
        type=int,
        default=DEFAULT_CAP,
        help="Run-log capture cap, for the 'at the cap' denominator only.",
    )
    add_since_arg(parser)
    args = parser.parse_args(argv)

    all_paths = result_jsons_for(args.test) if args.test else all_result_jsons()
    # As in compaction_report, --test still aggregates every run for the
    # fixture, so the freshness window applies here too; pass SINCE=all for a
    # fixture's whole history.
    cutoff = args.since
    paths = filter_since(all_paths, cutoff)
    if not paths:
        where = f" on/after {cutoff.isoformat()}" if (cutoff and all_paths) else ""
        print(f"No committed runs found{where}.", file=sys.stderr)
        print(branch_scope_note(), file=sys.stderr)
        return 1

    # One read of the corpus, shared by both walks (see `LoadedRun`).
    loaded = load_runs(paths)
    rows, delegated, excluded, unreadable_files = scan(paths, loaded=loaded)
    if args.test:
        print(f"Fixture: {args.test}")
    window = describe_window(cutoff, n_runs=len(paths), n_total=len(all_paths))
    pre = preamble(paths, args.cap, loaded=loaded)
    print(window)
    print(format_preamble(pre))
    print()
    print(
        format_report(
            rows,
            delegated,
            n_runs=len(paths),
            excluded=excluded,
            unreadable_files=unreadable_files,
        )
    )
    # Re-printed in full at the end, denominators included, because a long
    # report scrolls its own preamble away and `make prune-runlogs STRIP=1`
    # drops response_summary past 14 days — so the corpus this ran over can
    # differ from the one the next reader sees, and every figure above is only
    # readable against the counts it was taken over. Issue #1156 asks for
    # exactly this.
    print()
    print(format_preamble(pre))
    print(window)
    # Nothing readable is a failure, not an empty success — same convention as
    # corpus_report.py, so a caller keying on the exit code can tell "clean
    # run, nothing to say" from "the whole window was unreadable".
    readable = len(paths) - excluded.get("unreadable", 0)
    return 0 if readable else 1


if __name__ == "__main__":
    sys.exit(main())
