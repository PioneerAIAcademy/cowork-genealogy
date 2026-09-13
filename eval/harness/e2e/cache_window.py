"""Corpus cost of a 5-minute prompt-cache window, over committed e2e runs.

Production writes 5-minute cache entries either way. The hosted path
authenticates with an API key, on which the CLI writes at the 5-minute TTL
unless `ENABLE_PROMPT_CACHING_1H` is set -- nothing in `apps/server/app` sets
it, and P3b's first-party control (`apps/server/dev/p1/probe_gateway_path.py`,
2026-09-11) wrote 1h=0 / 5m=30,352 -- and FamilySearch's gateway (Bedrock
Converse, one cache-point variant) cannot offer a longer one. This corpus,
though, ran under the 1-HOUR TTL: the e2e orchestrator routes agent runs to the
operator's Claude subscription (`env_for_sdk(resolve_auth())`), and the CLI
grants the 1-hour TTL on an OAuth token through its `sdk` allowlist (of the
148 analysed runs, 129 carry 1h-only writes, 1 5m-only, 6 both and 12 predate
the split; 2026-09-11 -- and `pricing.py`'s cost calibration lands at 0.90x on
the 1-hour write price against 0.77x on the 5-minute one, the same fact from
the billing side). That is what
makes the corpus's gaps price-able: a cache read that occurred more than 300 s
after the previous call on the same thread was a hit under 1h and would be a
WRITE under 5m. FamilySearch's own suggestion for sizing that: treat every such
read as a write and report what it costs. This module does that. Pure analysis
over committed run JSONs -- no live run, no API spend -- same posture as
`latency_report.py` and `compaction_report.py`.

The production delta is the lost-read delta alone. The write-price term is $0:
production never pays the 1-hour write rate, so re-pricing the corpus's own
1-hour writes at the 5-minute rate compares against a configuration production
does not run. That figure is still printed, labelled as a reference against the
subscription-run corpus, not against production.

## What the run log carries, and what it does not

Per-call cache figures do not exist in a committed run. `usage.usage` is the
SDK ResultMessage's run TOTAL (`cache_read_input_tokens`,
`cache_creation_input_tokens`, and the `cache_creation` 5m/1h split); its
`iterations` array is a single entry in every run that carries it (138 of 163,
measured 2026-09-11), not a per-call ledger; `subagents[].turns[]` carries
`output_tokens` only. The orchestrator reads per-message usage off the stream
(`_accumulate_usage`) but persists only the sums. So the timing comes from
`usage.timeline`, and the run's cache-read tokens are distributed over the
calls that timeline yields.

## Model calls from the timeline

`usage.timeline` is `[[elapsed_s, kind, tool_names?], ...]`, one row per SDK
message. The SDK re-emits an assistant message once per content block, so one
model call is a BURST of consecutive `assistant` rows on one thread, ended by
that thread's `tool_result`. Subagent messages are interleaved into the same
timeline with no thread tag, but the CLI emits a `system:task_progress` row
immediately before each subagent message: a non-system row is attributed to a
subagent when the row before it is `system:task_progress`, an `assistant` row
whose previous row is an `assistant` row is another block of that message and
stays on its thread, a `tool_result` inherits the thread of the non-system row
before it, and everything else is the main thread. Checked against
`tool_calls[].agent_id` on the 24 runs that carry both tags (2026-09-11): 1041
of 1051 subagent tool rows and 3265 of 3278 main-thread tool rows land on the
right thread; the same-message rule covers the 145 assistant rows (against
4971 that directly follow a `task_progress`; 158 runs with a timeline,
2026-09-11) that continue a subagent message without a `task_progress` of
their own, each of which would otherwise open a spurious main-thread call.
Concurrent subagents share one "sub" thread here -- their identity is not on
the timeline -- so subagent gaps are a lower bound.

Gaps are counted PER THREAD: a delegation window during which the main thread
makes no call counts as a main-thread gap, because a subagent's calls do not
refresh the main context's cache entry. A main gap is a delegation window when
any subagent activity -- a sub-thread row, or a `task_started` /
`task_progress` / `task_notification` -- falls inside it. The per-thread count
is about 2x what the literal rule "gap > 300 s between consecutive assistant
rows" gives; the summary prints both, and the delegation-window share.

A `system:task_started` row starts a fresh subagent context: the first call
after it gaps against nothing, since a new subagent's conversation was never
cached and only its base prefix could be a hit or a miss.

A call's time is its first assistant row (the response's arrival). The gap to
the previous call on the same thread is therefore response-to-response, which
differs from the request-to-request gap the TTL actually runs on by the
difference of two adjacent generation times -- small against a 300 s threshold.
A text-only end of turn followed by a harness continue-nudge merges with the
next burst (no `tool_result` separates them), which undercounts calls slightly
and never hides a gap.

## Two ways to price a lost read, both reported

The run's `cache_read_input_tokens` is spread over its model calls two ways:

  avg  -- every call read the run's average cached prefix (the estimate the
          suggestion above names).
  grow -- a call's prefix is proportional to its position in its thread
          segment plus `BASE_PREFIX_CALLS`: the main thread's context grows
          with every call until a `system:compact_boundary` resets it, and a
          subagent's from each `system:task_started`. The main thread's
          post-delegation call sits late in a long segment, so this weights the
          misses a delegation window causes more heavily than `avg` does.

A call whose same-thread gap exceeds `CACHE_TTL_S` is re-priced from the
cache-read rate to the 5-minute cache-write rate. That delta, as a share of
recorded run cost, is the production figure. The corpus's own 1-hour writes
(`usage.usage.cache_creation.ephemeral_1h_input_tokens`) re-priced at the
5-minute rate are printed as a reference line only -- see the opening.

## Between turns

The corpus is autonomous -- `--autonomous` plus a yield-vetoing Stop hook makes
one giant turn per run -- so human think time between turns is NOT in it. Every
gap here is a tool, a delegation window, a stall-resume or a long generation.

CLI (from eval/harness/):
  uv run python -m e2e.cache_window
  uv run python -m e2e.cache_window --since all --markdown
  uv run python -m e2e.cache_window --test spriggs-parents-1898 --since all
"""

from __future__ import annotations

import argparse
import json
import math
import statistics
import sys
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from e2e import pricing
from e2e.runlog_selection import (
    add_since_arg,
    all_result_jsons,
    branch_scope_note,
    describe_window,
    filter_since,
    result_jsons_for,
)

#: The cache lifetime production runs on, in seconds: the API key's default
#: and the most the gateway can offer.
CACHE_TTL_S = 300.0

#: Gap sizes counted per run, in seconds. The middle one is the TTL.
GAP_THRESHOLDS_S = (60.0, CACHE_TTL_S, 1800.0)

THREADS = ("main", "sub")

#: USD per 1M tokens, Claude Sonnet standard tier. The read rate matches
#: `pricing._PER_MTOK`; the write rates are the 5-minute and 1-hour ephemeral
#: prices. A 5-minute write costs 12.5x a read.
CACHE_READ_PER_MTOK = 0.30
CACHE_WRITE_5M_PER_MTOK = 3.75
CACHE_WRITE_1H_PER_MTOK = 6.00

#: The `grow` weighting's offset, in calls: a call's cached prefix is taken as
#: proportional to (calls since its segment began + this). Ten stands in for a
#: system prompt + tool schemas + skill body of a few tens of thousands of
#: tokens against a per-call growth of a few thousand. A stated assumption, not
#: a measurement -- which is why `avg` is printed beside it.
BASE_PREFIX_CALLS = 10

_SUB_MARKER = "system:task_progress"
#: System rows that mean a subagent is active (for the delegation-window count).
_SUB_SYSTEM_ROWS = ("system:task_started", _SUB_MARKER, "system:task_notification")
_MTOK = 1_000_000


@dataclass(frozen=True)
class ModelCall:
    t: float             # elapsed seconds of the call's first assistant row
    thread: str          # "main" | "sub"
    depth: int           # calls since this thread's segment began (0-based)
    gap_s: float | None  # since the previous call on the same thread


def row_threads(timeline: list[list[Any]]) -> list[str | None]:
    """Per-row thread attribution: `main`, `sub`, or None for a system/result
    row. The rules are in the module docstring ("Model calls from the timeline")."""
    threads: list[str | None] = []
    for i, row in enumerate(timeline):
        kind = str(row[1])
        if kind.startswith("system:") or kind == "result":
            threads.append(None)
            continue
        prev_kind = str(timeline[i - 1][1]) if i else ""
        if prev_kind == _SUB_MARKER:
            thread = "sub"
        elif prev_kind == "assistant":
            # Another content block of the same message: a subagent's second
            # block has no task_progress of its own, so it stays on its thread.
            thread = threads[i - 1] or "main"
        elif kind == "assistant" or not i or prev_kind.startswith("system:"):
            thread = "main"
        else:
            thread = threads[i - 1] or "main"
        threads.append(thread)
    return threads


def model_calls(timeline: list[list[Any]]) -> list[ModelCall]:
    """One entry per model call, in timeline order. See the module docstring
    for the burst and thread rules."""
    calls: list[ModelCall] = []
    threads = row_threads(timeline)
    last_kind: dict[str, str] = {}
    last_t: dict[str, float] = {}
    depth: dict[str, int] = {thread: 0 for thread in THREADS}
    for i, row in enumerate(timeline):
        t = float(row[0])
        kind = str(row[1])
        if kind.startswith("system:") or kind == "result":
            if kind == "system:compact_boundary":
                depth["main"] = 0
            elif kind == "system:task_started":
                # A fresh subagent context: its first call has nothing cached
                # from the previous subagent's conversation to lose, so it
                # gaps against nothing (and starts a new burst).
                depth["sub"] = 0
                last_t.pop("sub", None)
                last_kind.pop("sub", None)
            continue
        thread = threads[i] or "main"
        if kind != "assistant":
            last_kind[thread] = kind
            continue
        if last_kind.get(thread) == "assistant":
            continue  # another content block of the same message
        last_kind[thread] = "assistant"
        gap = (t - last_t[thread]) if thread in last_t else None
        last_t[thread] = t
        calls.append(ModelCall(t=t, thread=thread, depth=depth[thread], gap_s=gap))
        depth[thread] += 1
    return calls


@dataclass(frozen=True)
class RunRow:
    fixture: str
    run: str
    n_calls: dict[str, int]
    gaps: dict[tuple[str, float], int]  # (thread, threshold) -> count
    delegation_gaps: int                # main gaps > TTL spanning >= 1 sub call
    agnostic_gaps: int                  # > TTL between consecutive assistant rows, any thread
    cache_read: int
    creation_1h: int | None             # None when the run has no 5m/1h split
    creation_5m: int | None
    lost_avg: float
    lost_grow: float
    cost: float | None
    cost_estimated: bool

    @property
    def delta_avg(self) -> float:
        return self.lost_avg * (CACHE_WRITE_5M_PER_MTOK - CACHE_READ_PER_MTOK) / _MTOK

    @property
    def delta_grow(self) -> float:
        return self.lost_grow * (CACHE_WRITE_5M_PER_MTOK - CACHE_READ_PER_MTOK) / _MTOK

    @property
    def write_price_delta(self) -> float | None:
        """What the run's own 1-hour writes would have cost at the 5-minute
        rate, minus what they did cost. A reference against the subscription-run
        corpus, not a production term: production writes at 5m already."""
        if self.creation_1h is None:
            return None
        return self.creation_1h * (CACHE_WRITE_5M_PER_MTOK - CACHE_WRITE_1H_PER_MTOK) / _MTOK

    @property
    def write_ttl(self) -> str:
        """Which ephemeral split the run's writes landed in: `1h`, `5m`, `both`,
        `none` (a split with zero writes), or `no-split` (run predates it)."""
        if self.creation_1h is None and self.creation_5m is None:
            return "no-split"
        h, m = bool(self.creation_1h), bool(self.creation_5m)
        return "both" if h and m else "1h" if h else "5m" if m else "none"


def _int(value: Any) -> int | None:
    return value if isinstance(value, int) and not isinstance(value, bool) else None


def analyze_run(doc: dict, *, fixture: str, run: str) -> RunRow | str:
    """A RunRow, or the exclusion reason: `no-timeline` or `no-cache-figures`."""
    usage = doc.get("usage") or {}
    timeline = usage.get("timeline")
    if not isinstance(timeline, list) or not timeline:
        return "no-timeline"
    inner = usage.get("usage") if isinstance(usage.get("usage"), dict) else {}
    cache_read = _int(inner.get("cache_read_input_tokens"))
    if cache_read is None:
        return "no-cache-figures"
    split = inner.get("cache_creation") if isinstance(inner.get("cache_creation"), dict) else {}
    creation_1h = _int(split.get("ephemeral_1h_input_tokens"))
    creation_5m = _int(split.get("ephemeral_5m_input_tokens"))

    calls = model_calls(timeline)
    n_calls = {thread: sum(1 for c in calls if c.thread == thread) for thread in THREADS}
    gaps: dict[tuple[str, float], int] = {
        (thread, thr): 0 for thread in THREADS for thr in GAP_THRESHOLDS_S
    }
    for c in calls:
        if c.gap_s is None:
            continue
        for thr in GAP_THRESHOLDS_S:
            if c.gap_s > thr:
                gaps[(c.thread, thr)] += 1

    lost = [c for c in calls if c.gap_s is not None and c.gap_s > CACHE_TTL_S]
    # A main gap is a delegation window when a subagent was active inside it:
    # any sub-thread row, or a task_started / task_progress / task_notification.
    sub_activity = [
        float(row[0]) for row, thread in zip(timeline, row_threads(timeline))
        if thread == "sub" or str(row[1]) in _SUB_SYSTEM_ROWS
    ]
    delegation_gaps = sum(
        1 for c in lost
        if c.thread == "main" and any(c.t - c.gap_s < t < c.t for t in sub_activity)
    )
    # The literal, thread-agnostic rule: > TTL between consecutive assistant rows.
    assistant_times = [float(row[0]) for row in timeline if str(row[1]) == "assistant"]
    agnostic_gaps = sum(
        1 for a, b in zip(assistant_times, assistant_times[1:]) if b - a > CACHE_TTL_S
    )
    lost_avg = cache_read * len(lost) / len(calls) if calls else 0.0
    total_weight = sum(c.depth + BASE_PREFIX_CALLS for c in calls)
    lost_weight = sum(c.depth + BASE_PREFIX_CALLS for c in lost)
    lost_grow = cache_read * lost_weight / total_weight if total_weight else 0.0

    cost = usage.get("total_cost_usd")
    estimated = False
    if not isinstance(cost, (int, float)) or isinstance(cost, bool):
        cost = pricing.estimate_cost_usd(inner)
        estimated = cost is not None

    return RunRow(
        fixture=fixture,
        run=run,
        n_calls=n_calls,
        gaps=gaps,
        delegation_gaps=delegation_gaps,
        agnostic_gaps=agnostic_gaps,
        cache_read=cache_read,
        creation_1h=creation_1h,
        creation_5m=creation_5m,
        lost_avg=lost_avg,
        lost_grow=lost_grow,
        cost=cost,
        cost_estimated=estimated,
    )


def scan(paths: list[Path]) -> tuple[list[RunRow], Counter]:
    """Every readable run as a RunRow; excluded runs counted by reason rather
    than silently dropped (the `compaction_report.scan` convention)."""
    rows: list[RunRow] = []
    excluded: Counter = Counter()
    for p in paths:
        try:
            doc = json.loads(p.read_text(encoding="utf-8"))
        except (OSError, UnicodeDecodeError, json.JSONDecodeError):
            doc = None
        if not isinstance(doc, dict):
            excluded["unreadable"] += 1
            continue
        result = analyze_run(doc, fixture=p.parent.name, run=p.stem)
        if isinstance(result, str):
            excluded[result] += 1
            continue
        rows.append(result)
    return rows, excluded


# --- Presentation -----------------------------------------------------------

def _mtok(tokens: float) -> str:
    return f"{tokens / _MTOK:.2f}"


def _usd(value: float | None, *, estimated: bool = False) -> str:
    if value is None:
        return "n/a"
    return f"{value:.2f}{'*' if estimated else ''}"


def _fmt_n(value: float) -> str:
    return f"{value:.0f}"


def _fmt_m(value: float) -> str:
    return f"{value / _MTOK:.2f}M"


def _fmt_d(value: float) -> str:
    return f"${value:.2f}"


def _p90(values: list[float]) -> float:
    ordered = sorted(values)
    return ordered[max(0, math.ceil(0.9 * len(ordered)) - 1)]


def _spread(values: list[float], fmt) -> str:
    if not values:
        return "n/a"
    return f"median {fmt(statistics.median(values))} / p90 {fmt(_p90(values))} / max {fmt(max(values))}"


def _pct(part: float, whole: float) -> str:
    return f"{100 * part / whole:.1f}%" if whole else "n/a"


COLUMNS = (
    "fixture", "run", "calls main+sub", ">60s", ">300s main", ">300s sub",
    ">1800s", "cache read Mtok", "lost Mtok avg", "lost Mtok grow",
    "delta $ avg", "delta $ grow", "run $",
)


def _cells(row: RunRow) -> list[str]:
    g = row.gaps
    return [
        row.fixture,
        row.run.removeprefix("run-"),
        f"{row.n_calls['main']}+{row.n_calls['sub']}",
        str(g[("main", 60.0)] + g[("sub", 60.0)]),
        str(g[("main", CACHE_TTL_S)]),
        str(g[("sub", CACHE_TTL_S)]),
        str(g[("main", 1800.0)] + g[("sub", 1800.0)]),
        _mtok(row.cache_read),
        _mtok(row.lost_avg),
        _mtok(row.lost_grow),
        _usd(row.delta_avg),
        _usd(row.delta_grow),
        _usd(row.cost, estimated=row.cost_estimated),
    ]


def format_table(rows: list[RunRow], *, markdown: bool) -> str:
    """One line per run. Markdown pipes, or padded plain text."""
    table = [list(COLUMNS)] + [_cells(r) for r in rows]
    if markdown:
        lines = ["| " + " | ".join(table[0]) + " |", "|" + "---|" * len(COLUMNS)]
        lines += ["| " + " | ".join(cells) + " |" for cells in table[1:]]
        return "\n".join(lines)
    widths = [max(len(r[i]) for r in table) for i in range(len(COLUMNS))]
    return "\n".join(
        "  ".join(
            cell.ljust(w) if i < 2 else cell.rjust(w)
            for i, (cell, w) in enumerate(zip(cells, widths))
        )
        for cells in table
    )


def format_summary(rows: list[RunRow], excluded: Counter, *, n_runs: int) -> str:
    n_excluded = sum(excluded.values())
    lines = [
        f"Runs: {len(rows)} analysed, {n_excluded} of {n_runs} excluded"
        + (": " + ", ".join(f"{v} {k}" for k, v in sorted(excluded.items())) if n_excluded else "")
        + ".",
        "",
        f"Prices (Sonnet, USD per Mtok): cache read {CACHE_READ_PER_MTOK:.2f}, "
        f"5-minute cache write {CACHE_WRITE_5M_PER_MTOK:.2f} (12.5x a read), "
        f"1-hour cache write {CACHE_WRITE_1H_PER_MTOK:.2f}. TTL {CACHE_TTL_S:.0f} s. "
        "`*` marks a run cost estimated from tokens (aborted run, no recorded cost).",
    ]
    if not rows:
        return "\n".join(lines)

    calls = [float(sum(r.n_calls.values())) for r in rows]
    main300 = [float(r.gaps[("main", CACHE_TTL_S)]) for r in rows]
    sub300 = [float(r.gaps[("sub", CACHE_TTL_S)]) for r in rows]
    over60 = [float(r.gaps[("main", 60.0)] + r.gaps[("sub", 60.0)]) for r in rows]
    over1800 = [float(r.gaps[("main", 1800.0)] + r.gaps[("sub", 1800.0)]) for r in rows]
    total_read = sum(r.cache_read for r in rows)
    lost_avg = sum(r.lost_avg for r in rows)
    lost_grow = sum(r.lost_grow for r in rows)
    delta_avg = sum(r.delta_avg for r in rows)
    delta_grow = sum(r.delta_grow for r in rows)
    costed = [r for r in rows if r.cost is not None]
    total_cost = sum(r.cost for r in costed)
    n_est = sum(1 for r in costed if r.cost_estimated)
    with_split = [r for r in rows if r.write_price_delta is not None]
    write_delta = sum(r.write_price_delta for r in with_split)
    main_total = int(sum(main300))
    delegation = sum(r.delegation_gaps for r in rows)
    agnostic = sum(r.agnostic_gaps for r in rows)
    ttl_counts = Counter(r.write_ttl for r in rows)

    lines += [
        "",
        f"Model calls per run: {_spread(calls, _fmt_n)}.",
        f"Same-thread gaps > {CACHE_TTL_S:.0f} s per run: main {_spread(main300, _fmt_n)}; "
        f"sub {_spread(sub300, _fmt_n)}. Runs with >= 1 main gap: {sum(1 for v in main300 if v)} of {len(rows)}; "
        f"with >= 1 sub gap: {sum(1 for v in sub300 if v)} of {len(rows)}.",
        f"Gaps are counted per thread: a delegation window during which the main thread makes no call counts "
        f"as a main-thread gap ({delegation} of {main_total} main gaps here); a thread-agnostic count "
        f"(> {CACHE_TTL_S:.0f} s between consecutive assistant rows, any thread) would be {agnostic} in "
        f"{sum(1 for r in rows if r.agnostic_gaps)} runs.",
        f"Gaps > 60 s per run: {_spread(over60, _fmt_n)}; > 1800 s: {_spread(over1800, _fmt_n)}.",
        "",
        f"Cache-read tokens lost to the TTL, avg-prefix:  per run {_spread([r.lost_avg for r in rows], _fmt_m)}; "
        f"corpus {_fmt_m(lost_avg)} of {_fmt_m(total_read)} read = {_pct(lost_avg, total_read)}.",
        f"Cache-read tokens lost to the TTL, grow-prefix: per run {_spread([r.lost_grow for r in rows], _fmt_m)}; "
        f"corpus {_fmt_m(lost_grow)} of {_fmt_m(total_read)} read = {_pct(lost_grow, total_read)}.",
        "",
        f"Cost delta from lost reads (read -> 5-minute write): avg-prefix per run "
        f"{_spread([r.delta_avg for r in rows], _fmt_d)}, corpus {_fmt_d(delta_avg)}; grow-prefix per run "
        f"{_spread([r.delta_grow for r in rows], _fmt_d)}, corpus {_fmt_d(delta_grow)}.",
        f"Run cost: {_spread([r.cost for r in costed], _fmt_d)}; corpus {_fmt_d(total_cost)} over {len(costed)} "
        f"costed runs ({n_est} estimated).",
        f"PRODUCTION DELTA (5-minute TTL vs the 1-hour TTL this corpus ran under) = the lost-read delta alone: "
        f"avg +{_pct(delta_avg, total_cost)} of run cost (+{_fmt_d(delta_avg)}), grow "
        f"+{_pct(delta_grow, total_cost)} (+{_fmt_d(delta_grow)}). The write-price term is $0: production "
        f"(API key, no ENABLE_PROMPT_CACHING_1H) writes at the 5-minute rate with or without the gateway.",
        f"Corpus write TTL, from the 5m/1h split: "
        + ", ".join(f"{ttl_counts[k]} {k}" for k in ("1h", "5m", "both", "none", "no-split") if ttl_counts[k])
        + " -- the e2e orchestrator runs agents on the operator's subscription, where the CLI grants the "
        "1-hour TTL; that is what makes the > 300 s gaps above price-able as lost reads.",
        f"Reference only, vs. the subscription-run corpus (1h writes), not vs. production: re-pricing the "
        f"corpus's own 1-hour writes at the 5-minute rate (6.00 -> 3.75 per Mtok) is {_fmt_d(write_delta)} over "
        f"{len(with_split)} runs carrying the split.",
        "",
        "Between turns: the corpus is autonomous (one giant turn per run), so human think time between turns is NOT "
        "in it; every gap above is a tool, a delegation window, a stall-resume or a long generation. In interactive "
        "use each user turn arriving more than five minutes after the last model call re-writes the whole context at "
        "the write rate, a cost that grows with context length and turn count and that this corpus cannot size.",
        "",
        "Approximations: per-call cache figures are not in the run log, so a run's cache-read total is distributed "
        "over its model calls (avg: uniformly; grow: in proportion to position in the thread segment plus "
        f"{BASE_PREFIX_CALLS} calls); calls are bursts of assistant rows per thread; concurrent subagents share one "
        "thread, so sub gaps are a lower bound; a call's time is its response's arrival, so gaps are "
        "response-to-response.",
    ]
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Corpus cost of a 5-minute prompt-cache window: re-prices every model "
            "call that follows a > 300 s same-thread gap as a cache write, over "
            "committed e2e runs."
        ),
    )
    parser.add_argument("--test", default=None, help="Only this fixture slug.")
    add_since_arg(parser)
    parser.add_argument("--markdown", action="store_true", help="emit a Markdown table")
    args = parser.parse_args(argv)

    all_paths = result_jsons_for(args.test) if args.test else all_result_jsons()
    cutoff = args.since
    paths = filter_since(all_paths, cutoff)
    if not paths:
        where = f" on/after {cutoff.isoformat()}" if (cutoff and all_paths) else ""
        print(f"No committed runs found{where}.", file=sys.stderr)
        print(branch_scope_note(), file=sys.stderr)
        return 1

    rows, excluded = scan(paths)
    if args.test:
        print(f"Fixture: {args.test}")
    print(describe_window(cutoff, n_runs=len(paths), n_total=len(all_paths)))
    print()
    print(format_table(rows, markdown=args.markdown))
    print()
    print(format_summary(rows, excluded, n_runs=len(paths)))
    return 0 if rows else 1


if __name__ == "__main__":
    sys.exit(main())
