"""Per-skill latency analyzer for *unit* run logs — the cheap 2a feedback loop.

Phase 0 (see e2e/latency_report.py + docs/plan/research-latency-baseline-*.md)
established that ~98% of an e2e run's active loop is the model generating, so the
dominant latency lever is **output tokens generated** (turns × tokens/turn). A
full e2e run costs $3-10 and ~30-70 min and needs live FamilySearch auth — far
too heavy to gate every SKILL.md prose edit.

But every *unit* run log already records the model's output-token count (and, for
newer logs, `num_turns` and `duration_api_ms`) per test and per skill. Editing a
SKILL.md forces a unit re-run anyway (the run-log snapshot gate). So the unit
re-run the author already does is a *free* measurement of the edit's effect on
generation cost — this module reads it out.

Two modes:
  * report — the per-test / per-skill output-token + turn profile of one run log.
  * diff   — before/after two run logs for the same skill, matched by test_id, to
             size a prose change. When the two logs embed identical test-side
             snapshots the aggregate is a clean prose-only signal; when the tests
             changed between them the diff says so (per-test deltas then conflate
             prose + test changes and must be read test-by-test).

Pure analysis over committed JSON — no live run, no API. `analyze_runlog` /
`diff_skill` are pure and unit-tested; the CLI locates run logs and prints.

Caveat carried in every number: unit tests run `runs_per_test=1` with no
temperature=0 (eval/CLAUDE.md), so a single test's token count carries run-to-run
variance. Trust the *direction* and the *aggregate across a skill's tests*, not a
single test's exact percentage.

CLI (from eval/harness/):
  uv run python -m skill_latency_report --skill timeline
  uv run python -m skill_latency_report --skill timeline --vs-prev
  uv run python -m skill_latency_report --before A.json --after B.json
  uv run python -m skill_latency_report --all [--markdown]
  uv run python -m skill_latency_report A.json B.json      # positional = diff
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[2]
UNIT_RUNLOGS = REPO_ROOT / "eval" / "runlogs" / "unit"


# --- Analysis (pure) --------------------------------------------------------

@dataclass
class SkillLatency:
    """Generation-cost profile of one unit run log."""

    skill: str
    source_file: str | None = None
    n_tests: int = 0

    # Summed across the skill's tests (each test's `totals`, which with
    # runs_per_test=1 is its single run).
    output_tokens: int = 0
    # None when any test predates the num_turns instrumentation (older logs).
    num_turns: int | None = None
    duration_api_ms: float | None = None
    total_cost_usd: float | None = None

    # test_id -> {"output_tokens": int, "num_turns": int|None, "outcome": str}
    per_test: dict[str, dict[str, Any]] = field(default_factory=dict)


def analyze_runlog(runlog: dict[str, Any], source_file: str | None = None) -> SkillLatency:
    """Derive a SkillLatency from a parsed unit run-log envelope (pure)."""
    tests = runlog.get("tests") or []
    per_test: dict[str, dict[str, Any]] = {}
    out_sum = 0
    turns_sum = 0
    turns_all_present = True
    for t in tests:
        tid = t.get("test_id", "?")
        totals = t.get("totals") or {}
        out = totals.get("output_tokens") or 0
        turns = totals.get("num_turns")
        if turns is None:
            turns_all_present = False
        else:
            turns_sum += turns
        out_sum += out
        per_test[tid] = {
            "output_tokens": out,
            "num_turns": turns,
            "outcome": t.get("outcome", "?"),
        }

    env = runlog.get("totals") or {}
    return SkillLatency(
        skill=runlog.get("skill", "?"),
        source_file=source_file,
        n_tests=len(tests),
        # Prefer the envelope's own summed output_tokens; fall back to our sum.
        output_tokens=env.get("output_tokens", out_sum) or out_sum,
        num_turns=(env.get("num_turns") if env.get("num_turns") is not None
                   else (turns_sum if turns_all_present and tests else None)),
        duration_api_ms=env.get("duration_api_ms"),
        total_cost_usd=env.get("total_cost_usd"),
        per_test=per_test,
    )


def _test_snapshot_keys(runlog: dict[str, Any], skill: str) -> dict[str, str]:
    """The run log's embedded snapshot of this skill's *test-side* inputs.

    Keys under ``eval/tests/unit/<skill>/`` (the test JSONs + rubric). Two run
    logs with an identical such mapping ran against identical test inputs, so a
    diff between them isolates the SKILL.md (prose) change.
    """
    snap = runlog.get("snapshot") or {}
    prefix = f"eval/tests/unit/{skill}/"
    return {k: v for k, v in snap.items() if k.startswith(prefix)}


def same_test_inputs(before: dict[str, Any], after: dict[str, Any], skill: str) -> bool:
    """True iff both run logs embed byte-identical test-side snapshots.

    When False, a token diff between the two conflates prose changes with test
    changes and must be read per-test rather than in aggregate. Returns False if
    either log carries no test-side snapshot (can't prove stability).

    (Not named ``test_*`` on purpose — that prefix makes pytest try to collect
    it as a test case.)
    """
    b = _test_snapshot_keys(before, skill)
    a = _test_snapshot_keys(after, skill)
    if not b or not a:
        return False
    return b == a


@dataclass
class TestDelta:
    test_id: str
    before_out: int
    after_out: int

    @property
    def delta(self) -> int:
        return self.after_out - self.before_out

    @property
    def pct(self) -> float | None:
        return (100.0 * self.delta / self.before_out) if self.before_out else None


@dataclass
class LatencyDiff:
    skill: str
    before_file: str | None
    after_file: str | None
    inputs_stable: bool
    per_test: list[TestDelta] = field(default_factory=list)  # shared tests only
    # Raw aggregates over ALL shared tests.
    agg_before: int = 0
    agg_after: int = 0
    # Concision aggregates over "both-active" tests only — tests that generated
    # output on BOTH sides. A test that went to/from 0 output is an activation or
    # abort change (the skill declined / the run aborted before generating), NOT
    # a per-turn concision change; counting it would dump its whole value into the
    # "reduction" and overstate the concision win. `n_activation_changed` is how
    # many shared tests flipped 0<->non-0 (excluded from the concision aggregate).
    active_before: int = 0
    active_after: int = 0
    n_both_active: int = 0
    n_activation_changed: int = 0
    before_only: list[str] = field(default_factory=list)
    after_only: list[str] = field(default_factory=list)
    # Turn aggregates, only when both logs carry num_turns for all shared tests.
    turns_before: int | None = None
    turns_after: int | None = None

    @property
    def agg_delta(self) -> int:
        return self.agg_after - self.agg_before

    @property
    def agg_pct(self) -> float | None:
        return (100.0 * self.agg_delta / self.agg_before) if self.agg_before else None

    @property
    def concision_pct(self) -> float | None:
        """Output-token change over both-active tests — the honest concision signal."""
        return (100.0 * (self.active_after - self.active_before) / self.active_before
                if self.active_before else None)


def diff_skill(
    before: SkillLatency,
    after: SkillLatency,
    inputs_stable: bool,
) -> LatencyDiff:
    """Match two run logs by test_id and size the output-token change (pure)."""
    shared = sorted(set(before.per_test) & set(after.per_test))
    deltas = [
        TestDelta(tid, before.per_test[tid]["output_tokens"], after.per_test[tid]["output_tokens"])
        for tid in shared
    ]
    # Sort most-improved (most negative delta) first.
    deltas.sort(key=lambda d: d.delta)

    both_active = [d for d in deltas if d.before_out > 0 and d.after_out > 0]
    n_activation_changed = sum(
        1 for d in deltas if (d.before_out > 0) != (d.after_out > 0)
    )

    turns_b = [before.per_test[t]["num_turns"] for t in shared]
    turns_a = [after.per_test[t]["num_turns"] for t in shared]
    both_complete = bool(shared) and all(x is not None for x in turns_b + turns_a)
    # A turn *delta* needs both sides; if either is incomplete, report neither.
    turns_before = sum(turns_b) if both_complete else None
    turns_after = sum(turns_a) if both_complete else None

    return LatencyDiff(
        skill=after.skill if after.skill != "?" else before.skill,
        before_file=before.source_file,
        after_file=after.source_file,
        inputs_stable=inputs_stable,
        per_test=deltas,
        agg_before=sum(d.before_out for d in deltas),
        agg_after=sum(d.after_out for d in deltas),
        active_before=sum(d.before_out for d in both_active),
        active_after=sum(d.after_out for d in both_active),
        n_both_active=len(both_active),
        n_activation_changed=n_activation_changed,
        before_only=sorted(set(before.per_test) - set(after.per_test)),
        after_only=sorted(set(after.per_test) - set(before.per_test)),
        turns_before=turns_before,
        turns_after=turns_after,
    )


# --- Presentation -----------------------------------------------------------

def _pct(x: float | None) -> str:
    return f"{x:+.1f}%" if x is not None else "n/a"


def format_skill(sl: SkillLatency) -> str:
    turns = sl.num_turns if sl.num_turns is not None else "n/a"
    per_turn = (
        f"{sl.output_tokens / sl.num_turns:.0f}/turn"
        if sl.num_turns else "n/a/turn"
    )
    lines = [
        f"=== {sl.skill}  ({Path(sl.source_file).name if sl.source_file else '?'}) ===",
        f"  tests: {sl.n_tests}   output tokens: {sl.output_tokens}   turns: {turns}   ({per_turn})",
        f"  cost: ${sl.total_cost_usd}" if sl.total_cost_usd is not None else "  cost: n/a",
    ]
    return "\n".join(lines)


def format_diff(d: LatencyDiff) -> str:
    lines = [
        f"=== {d.skill}: output-token diff over {len(d.per_test)} shared tests ===",
        f"  before: {Path(d.before_file).name if d.before_file else '?'}",
        f"  after:  {Path(d.after_file).name if d.after_file else '?'}",
    ]
    if not d.inputs_stable:
        lines.append(
            "  ⚠ test inputs CHANGED between these runs — deltas conflate "
            "prose + test changes; read per-test."
        )
    # Lead with the honest concision signal (both-active tests), then raw.
    lines.append(
        f"  concision:     {d.active_before} -> {d.active_after}  "
        f"({d.active_after - d.active_before:+d}, {_pct(d.concision_pct)})"
        f"   [{d.n_both_active} both-active tests"
        + (f"; {d.n_activation_changed} flipped 0<->non-0, excluded" if d.n_activation_changed else "")
        + "]"
        + ("   prose-only" if d.inputs_stable else "")
    )
    if d.n_activation_changed or d.agg_pct != d.concision_pct:
        lines.append(
            f"  raw (all {len(d.per_test)}): {d.agg_before} -> {d.agg_after}  "
            f"({d.agg_delta:+d}, {_pct(d.agg_pct)})  "
            "<- includes activation/abort changes, not just concision"
        )
    if d.turns_before is not None and d.turns_after is not None:
        dt = d.turns_after - d.turns_before
        pct = (100.0 * dt / d.turns_before) if d.turns_before else None
        lines.append(f"  turns:         {d.turns_before} -> {d.turns_after}  ({dt:+d}, {_pct(pct)})")
    if d.before_only or d.after_only:
        lines.append(f"  unmatched: before-only={d.before_only or '-'} after-only={d.after_only or '-'}")
    # Biggest movers (top 5 by absolute delta already sorted most-improved first).
    movers = sorted(d.per_test, key=lambda x: abs(x.delta), reverse=True)[:5]
    if movers:
        lines.append("  biggest movers:")
        for m in movers:
            lines.append(f"    {m.test_id}: {m.before_out} -> {m.after_out}  ({m.delta:+d}, {_pct(m.pct)})")
    return "\n".join(lines)


def format_markdown_table(sls: list[SkillLatency]) -> str:
    header = (
        "| skill | tests | output tokens | turns | tok/turn | cost |\n"
        "|---|---|---|---|---|---|"
    )
    rows = []
    for sl in sls:
        per_turn = f"{sl.output_tokens / sl.num_turns:.0f}" if sl.num_turns else "n/a"
        turns = sl.num_turns if sl.num_turns is not None else "n/a"
        cost = f"${sl.total_cost_usd:.2f}" if sl.total_cost_usd is not None else "n/a"
        rows.append(
            f"| {sl.skill} | {sl.n_tests} | {sl.output_tokens} | {turns} | {per_turn} | {cost} |"
        )
    return "\n".join([header, *rows])


# --- Run-log discovery + CLI ------------------------------------------------

def _is_releasable_runlog(p: Path) -> bool:
    """A committed `v{N}[_ts].json` envelope, not a scratch / .ann sibling."""
    n = p.name
    return n.startswith("v") and n.endswith(".json") and not n.endswith(".ann.json")


def releasable_runlogs_for(skill: str) -> list[Path]:
    """All releasable run logs for a skill, oldest-first (filename sorts by version+ts)."""
    d = UNIT_RUNLOGS / skill
    if not d.is_dir():
        return []
    return sorted((p for p in d.iterdir() if _is_releasable_runlog(p)), key=lambda p: p.name)


def all_skills() -> list[str]:
    if not UNIT_RUNLOGS.is_dir():
        return []
    return sorted(d.name for d in UNIT_RUNLOGS.iterdir() if d.is_dir())


def _load(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def _diff_paths(before_path: Path, after_path: Path) -> LatencyDiff:
    before_raw, after_raw = _load(before_path), _load(after_path)
    before = analyze_runlog(before_raw, str(before_path))
    after = analyze_runlog(after_raw, str(after_path))
    skill = after.skill if after.skill != "?" else before.skill
    stable = same_test_inputs(before_raw, after_raw, skill)
    return diff_skill(before, after, stable)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Per-skill unit-runlog latency report / diff.")
    ap.add_argument("files", nargs="*", help="two run-log paths => diff them")
    ap.add_argument("--skill", help="report the latest run log for this skill")
    ap.add_argument("--vs-prev", action="store_true",
                    help="with --skill: diff the two newest releasable run logs")
    ap.add_argument("--before", help="explicit before run-log path (with --after)")
    ap.add_argument("--after", help="explicit after run-log path (with --before)")
    ap.add_argument("--all", action="store_true", help="table of latest run log per skill")
    ap.add_argument("--markdown", action="store_true", help="emit a Markdown table (with --all)")
    args = ap.parse_args(argv)

    # Explicit / positional diff.
    if args.before and args.after:
        print(format_diff(_diff_paths(Path(args.before), Path(args.after))))
        return 0
    if len(args.files) == 2:
        print(format_diff(_diff_paths(Path(args.files[0]), Path(args.files[1]))))
        return 0
    if args.files:
        print("Pass exactly two run-log paths to diff, or use --skill / --all.", file=sys.stderr)
        return 1

    if args.skill:
        logs = releasable_runlogs_for(args.skill)
        if not logs:
            print(f"No releasable run logs for skill '{args.skill}'.", file=sys.stderr)
            return 1
        if args.vs_prev:
            if len(logs) < 2:
                print(f"Need >=2 run logs to diff '{args.skill}'; found {len(logs)}.", file=sys.stderr)
                return 1
            print(format_diff(_diff_paths(logs[-2], logs[-1])))
            return 0
        print(format_skill(analyze_runlog(_load(logs[-1]), str(logs[-1]))))
        return 0

    if args.all:
        sls = []
        for skill in all_skills():
            logs = releasable_runlogs_for(skill)
            if logs:
                sls.append(analyze_runlog(_load(logs[-1]), str(logs[-1])))
        if args.markdown:
            print(format_markdown_table(sls))
        else:
            for sl in sls:
                print(format_skill(sl))
                print()
        return 0

    ap.print_help()
    return 1


if __name__ == "__main__":
    sys.exit(main())
