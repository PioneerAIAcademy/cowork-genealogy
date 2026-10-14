"""`make e2e-agent-spend` — what each subagent costs, and whether it is earning it.

**The question this answers.** `docs/plan/cost-latency-10x.md` is trying to cut a
median research run from $10.57 to $1.00. Its Wave 4 decides which agent gets
which model rung. That decision needs two columns per agent — what it spends and
whether it is doing well — and until #2582 the first column did not exist: the
run log counted the main thread's tokens and nothing else, so an agent's cost was
total-minus-main, a residual rather than a measurement.

It also needs to know whether a cheaper model is even safe inside the agent, so
the report shows (T1.3) the models each agent ran on, its busiest moment —
`peak_window_tokens`, the tallest single read, a max not a sum — and how many of
its spawns were compacted. Spend and peak answer different questions: ten 30k
reads and two 150k reads cost the same and sit at opposite distances from the
compaction line. Each spawn is priced at the model it ran on (T1.11, `price_helper`),
so a helper moved to a cheaper model shows a cheaper row.

The four-box rule this serves, in the owner's own words:

    spending much and doing badly  -> revisit first
    spending much and doing well   -> cut the cost, protect the quality
    spending little and doing badly -> revisit
    spending little and doing well  -> leave it alone

**What is a real join and what is only a name match.** `subagents[].usage`,
`num_assistant_turns`, `runaway_thinking`, `hit_output_cap`, `models`,
`peak_window_tokens` and `compactions` are recorded
against `agent_type` on the same object, so the spend and the per-agent failure
flags are a genuine join. Guardrail *violations* are not: `corpus_report` tallies
them by **rule**, not by agent, and only some rule names happen to coincide with
an agent's name. They are reported in a separate column that says so, because a
name match presented as attribution is how a confident wrong number gets quoted.

**Price basis: corpus, per model.** A spawn that records exactly one model is
priced at that model's rate (`pricing.MODEL_RATES`, cache writes at the 1-hour
rate). A spawn recording no model predates the field and keeps the flat Sonnet
table (`pricing.estimate_cost_usd`), labelled so. A spawn on a model the table
does not know, or on more than one model, is counted as unpriced with its reason
— never as $0 and never at the Sonnet rate. The production (5-minute) basis is
~8% lower; state the basis next to any figure lifted out of here.

**Runs written before #2582 carry no `subagents[].usage`** and are counted as
uncovered rather than as zero, and the coverage line says how many. A zero
denominator is reported loudly: a report that cannot see its input must not print
a cheerful 0.00.

Zero API spend — pure analysis over committed run logs.
"""

from __future__ import annotations

import argparse
import json
import statistics
from collections import defaultdict
from pathlib import Path
from typing import Any

from e2e import pricing
from e2e.runlog_selection import all_result_jsons

USAGE_FIELDS = pricing.PRICED_FIELDS


def _load(path: Path) -> dict[str, Any] | None:
    try:
        doc = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError, UnicodeDecodeError):
        return None
    return doc if isinstance(doc, dict) else None


NOT_RECORDED = "not recorded"
NO_TOKENS = "no token counts"


def price_helper(sub: dict[str, Any]) -> tuple[float | None, str]:
    """One spawn's cost and the rule that priced it — the one rule every report uses.

    Returns `(cost, how)`. `how` is the model id, `NOT_RECORDED` (flat Sonnet
    table, the spawn predates `models`), or a reason the spawn is unpriced. Tokens
    are not split per model inside one spawn, so a multi-model spawn is unpriced
    rather than guessed (none is recorded yet).
    """
    usage = sub.get("usage")
    if pricing.estimate_cost_usd(usage) is None:
        return None, NO_TOKENS
    models = sub.get("models")
    names = [m for m in models if isinstance(m, str)] if isinstance(models, list) else []
    if not names:
        return pricing.estimate_cost_usd(usage), NOT_RECORDED
    if len(set(names)) > 1:
        return None, "mixed models, not split"
    cost = pricing.estimate_cost_for_model(usage, names[0])
    if cost is None:
        return None, f"no rate for {names[0]}"
    return cost, names[0]


def collect(paths: list[Path]) -> tuple[dict[str, dict[str, Any]], dict[str, int]]:
    """`(per_agent, counters)` over every run log that can be read."""
    per_agent: dict[str, dict[str, Any]] = defaultdict(
        lambda: {"spawns": 0, "costs": [], "turns": [], "runaway": 0, "capped": 0,
                 "tokens": dict.fromkeys(USAGE_FIELDS, 0), "runs": set(),
                 "models": {}, "no_model": 0, "peaks": [], "squeezed": 0,
                 "costs_by_key": {}, "unpriced": {}}
    )
    counters = {"runs": 0, "unreadable": 0, "runs_with_subagents": 0,
                "subagents_seen": 0, "subagents_with_usage": 0,
                "subagents_with_peak": 0}

    for path in paths:
        doc = _load(path)
        if doc is None:
            counters["unreadable"] += 1
            continue
        counters["runs"] += 1
        subagents = doc.get("subagents")
        if not isinstance(subagents, list) or not subagents:
            continue
        counters["runs_with_subagents"] += 1
        for sub in subagents:
            if not isinstance(sub, dict):
                continue
            counters["subagents_seen"] += 1
            name = sub.get("agent_type") or "(unnamed)"
            bucket = per_agent[name]
            bucket["spawns"] += 1
            bucket["runs"].add(path.parent.name)
            if sub.get("runaway_thinking"):
                bucket["runaway"] += 1
            if sub.get("hit_output_cap"):
                bucket["capped"] += 1
            turns = sub.get("num_assistant_turns")
            if isinstance(turns, int):
                bucket["turns"].append(turns)
            models = sub.get("models")
            if isinstance(models, list) and any(isinstance(m, str) for m in models):
                for m in models:
                    if isinstance(m, str):
                        bucket["models"][m] = bucket["models"].get(m, 0) + 1
            else:
                bucket["no_model"] += 1
            # The busiest moment and the squeezes (T1.3) are measured only when
            # the peak is present. A spawn without it predates the field and is
            # "not measured" — never a 0 peak, which would read as "tiny".
            peak = sub.get("peak_window_tokens")
            if isinstance(peak, int) and not isinstance(peak, bool):
                counters["subagents_with_peak"] += 1
                bucket["peaks"].append(peak)
                compactions = sub.get("compactions")
                if isinstance(compactions, list) and compactions:
                    bucket["squeezed"] += 1
            usage = sub.get("usage")
            if not isinstance(usage, dict):
                continue
            counters["subagents_with_usage"] += 1
            for field in USAGE_FIELDS:
                value = usage.get(field)
                bucket["tokens"][field] += value if isinstance(value, int) else 0
            cost, how = price_helper(sub)
            if cost is None:
                if how != NO_TOKENS:
                    bucket["unpriced"][how] = bucket["unpriced"].get(how, 0) + 1
                continue
            bucket["costs"].append(cost)
            key = pricing.canonical_model(how) if how != NOT_RECORDED else how
            bucket["costs_by_key"].setdefault(key, []).append(cost)
    return per_agent, counters


def _models_cell(bucket: dict[str, Any]) -> str:
    names = ", ".join(bucket["models"]) if bucket["models"] else ""
    if bucket["no_model"]:
        missing = "(not recorded)" if not names else f"(+{bucket['no_model']} not recorded)"
        names = f"{names} {missing}".strip()
    return names


def format_report(per_agent: dict[str, dict[str, Any]], counters: dict[str, int]) -> str:
    out: list[str] = []
    seen, covered = counters["subagents_seen"], counters["subagents_with_usage"]
    out.append(
        f"{counters['runs']} run(s) read, {counters['runs_with_subagents']} with "
        f"subagents; {seen} subagent spawn(s), {covered} carrying token counts."
    )
    if counters["unreadable"]:
        out.append(f"  {counters['unreadable']} run log(s) could not be read.")
    if seen == 0:
        out.append("")
        out.append("NO SUBAGENT SPAWNS FOUND — this report proves nothing. Check the")
        out.append("corpus path before reading anything into a zero.")
        return "\n".join(out)
    if covered == 0:
        out.append("")
        out.append(f"NONE of the {seen} spawn(s) carries `subagents[].usage`. Every run")
        out.append("in this corpus predates #2582, so no cost column can be computed.")
        out.append("Commit a run made after that change, then re-run this report.")
        return "\n".join(out)
    if covered < seen:
        out.append(
            f"  COVERAGE: {covered}/{seen} spawns priced "
            f"({100 * covered / seen:.0f}%). The rest predate #2582 and are counted"
            " as uncovered, never as zero."
        )

    rows = sorted(per_agent.items(), key=lambda kv: -sum(kv[1]["costs"]))
    total = sum(sum(b["costs"]) for _, b in rows) or 1.0

    out.append("")
    out.append("Spend per agent (corpus basis — each spawn at its own model's rate, 1h cache")
    out.append("write; a spawn with no model recorded at the flat Sonnet table):")
    out.append("")
    head = f"  {'agent':<26} {'spawns':>6} {'$/spawn':>9} {'$ total':>9} {'share':>6} {'turns':>6}"
    out.append(head + "   models")
    out.append("  " + "-" * (len(head) - 2))
    for name, b in rows:
        if not b["costs"]:
            out.append(f"  {name:<26} {b['spawns']:>6} {'--':>9} {'--':>9} {'--':>6}"
                       f" {'--':>6}   (no priced spawn)  {_models_cell(b)}")
            continue
        med = statistics.median(b["costs"])
        tot = sum(b["costs"])
        turns = statistics.median(b["turns"]) if b["turns"] else 0
        out.append(
            f"  {name:<26} {b['spawns']:>6} {med:>9.3f} {tot:>9.2f}"
            f" {100 * tot / total:>5.0f}% {turns:>6.0f}   {_models_cell(b)}"
        )
        # One agent on more than one model (a Wave-4 A/B, or old flat-priced
        # spawns beside new per-model ones): a sub-row per model, so a cheaper
        # rung reads as a cheaper row rather than vanishing into one median.
        if len(b["costs_by_key"]) > 1:
            for key, costs in sorted(b["costs_by_key"].items()):
                label = f"  {key}" if key != NOT_RECORDED else "  (model not recorded, flat)"
                out.append(f"    {label:<24} {len(costs):>6} {statistics.median(costs):>9.3f}"
                           f" {sum(costs):>9.2f}")
    unpriced = [(name, how, n) for name, b in rows for how, n in sorted(b["unpriced"].items())]
    if unpriced:
        out.append("")
        out.append("  UNPRICED (left out of every figure above, never counted as $0):")
        for name, how, n in unpriced:
            out.append(f"    {name:<26} {n:>4} spawn(s) — {how}")

    out.append("")
    measured = counters["subagents_with_peak"]
    if measured == 0:
        out.append("No spawn records its busiest moment or its squeezes — every priced")
        out.append("run predates those fields (T1.3). Commit a newer run.")
    else:
        out.append("Busiest moment and squeezes per agent (tokens read at once; the main")
        out.append("thread compacts at ~167k on a 200k window). A squeezed spawn's peak")
        out.append("stops at the line, so read the squeezed column first:")
        if measured < covered:
            out.append(f"  MEASURED: {measured}/{covered} priced spawns carry it; the rest"
                       " predate T1.3 and are left out, never counted as 0.")
        out.append("")
        head2 = f"  {'agent':<26} {'busiest (max)':>14} {'busiest (typical)':>18} {'squeezed':>12}"
        out.append(head2)
        out.append("  " + "-" * (len(head2) - 2))
        for name, b in rows:
            if not b["peaks"]:
                continue
            out.append(
                f"  {name:<26} {max(b['peaks']):>14,} {int(statistics.median(b['peaks'])):>18,}"
                f" {str(b['squeezed']) + ' of ' + str(len(b['peaks'])):>12}"
            )

    out.append("")
    out.append("Per-agent trouble flags (a genuine join — same object as the spend):")
    out.append("")
    out.append(f"  {'agent':<26} {'runaway':>8} {'hit cap':>8}  of spawns")
    out.append("  " + "-" * 54)
    for name, b in rows:
        if not (b["runaway"] or b["capped"]):
            continue
        out.append(f"  {name:<26} {b['runaway']:>8} {b['capped']:>8}  of {b['spawns']}")
    if not any(b["runaway"] or b["capped"] for _, b in rows):
        out.append("  none — no spawn in this corpus ran away or hit its output cap.")

    out.append("")
    out.append("Guardrail violations are NOT joined here. `make e2e-corpus` tallies")
    out.append("them by RULE, not by agent; some rule names merely coincide with an")
    out.append("agent name. Read the two side by side, do not add a column.")
    return "\n".join(out)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--test", help="one fixture slug, else the whole corpus")
    parser.add_argument("--log", action="append", type=Path, default=[],
                        help="read this run log instead of the committed corpus (repeatable)")
    args = parser.parse_args()

    paths = args.log or all_result_jsons()
    if args.test:
        paths = [p for p in paths if p.parent.name == args.test]
        if not paths:
            print(f"No committed run logs for fixture {args.test!r}.")
            return 2
    per_agent, counters = collect(paths)
    print(format_report(per_agent, counters))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
