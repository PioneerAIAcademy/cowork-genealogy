"""Per-skill episode fingerprint report over committed e2e runs.

docs/specs/guardrail-enforcement-spec.md §7, GitHub issue #1463 — §7's recency
check credits a guardrail skill through `recently_succeeded`, which reads
`is_error` on `Skill` ledger entries. Every `Skill` result in the corpus is a
*launch acknowledgement*, so that gate can only ever observe an unknown-skill
launch failure, never "the skill ran and produced nothing." Closing that would
need an instrument observing skill **completion**.

The cheapest candidate instrument is the trace: between a skill's launch and the
next one, did the skill's own documented tool sequence appear? This report is the
measurement that decides whether such a fingerprint exists. It does not.

Adds NO instrumentation to a run (same posture as `corpus_report.py` /
`guardrail_shadow_report.py` / `latency_report.py`): pure analysis over
already-committed data, no model, no network, no API spend.

## Definitions

These are contract, not commentary — two of them were left implicit in the first
draft of this work and produced numbers that contradicted the report's own
conclusion.

- **Episode** — a `Skill(X)` ledger entry through to the next `Skill` entry, or
  end of ledger.
- **Recall** of tool T for skill X — episodes of X containing T, over all
  episodes of X. "How reliably does T accompany X?"
- **Precision** of T for X — episodes of X containing T, over **every `Skill`
  episode in the corpus**, not just the guardrail ones. "When T fires inside
  some episode, how often is that episode X's?" The wider denominator is what
  makes precision a specificity measure; scoping it to guardrail episodes only
  inflates it (`materialize_facts`/`person-evidence` reads 0.84 here and 0.95
  guardrail-only).
- **Most specific tool** — the highest-precision tool clearing **both** recall
  >= `RECALL_FLOOR` and precision >= `PRECISION_FLOOR`, over tools that are not
  session built-ins. `none` when nothing clears both.

  All three parts carry weight. Without the built-in filter,
  `research-exhaustiveness` reports `Read`. Without the precision floor,
  `conflict-resolution` reports `research_query` on 3 of 9 episodes at
  precision 0.02. And the protected-write tools must **not** be excluded:
  `materialize_facts` and `tree_correct` are themselves protected writes under
  `skill_invocation.owning_skills`, so dropping them zeroes every cell.

## Limits

- **A nested `Skill` launch truncates the enclosing episode**, attributing the
  outer skill's later calls to the callee. Not observed for the four guardrail
  skills — none of their `SKILL.md` bodies contains `Skill(` or `@plugin:` — but
  a future skill could nest, and this report is meant to outlive that check.
- **Subagent-made calls are folded into the launching skill's episode.** A
  protected write made by a `general-purpose` or `gps-mentor` delegate inside an
  episode counts toward that skill's fingerprint. That is the spec §11 bypass
  population being credited to the skill it bypassed. Only 6 committed runs carry
  per-call `agent_type` (post-PR #1027), so this cannot be filtered corpus-wide
  today; it inflates recall slightly and does not move the conclusion.
- **Small denominators.** `conflict-resolution` has single-digit episodes. Read
  its row as directional — and below `EPISODE_FLOOR` a skill is dropped from the
  verdict entirely, so its row informs nothing but itself.
- **The corpus only grows.** Absolute counts here are a point-in-time replay.
  The shape is what reproduces — see `docs/specs/guardrail-enforcement-spec.md`
  §3, which documents the same trap for the sibling report.

CLI (from eval/harness/):
  uv run python -m e2e.skill_episode_report
  uv run python -m e2e.skill_episode_report --since all
  uv run python -m e2e.skill_episode_report --test bagley-father-1884
  uv run python -m e2e.skill_episode_report --since all --all-skills
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

from e2e.runlog_selection import (
    add_since_arg,
    all_result_jsons,
    describe_window,
    filter_since,
    result_jsons_for,
)
from harness.context_policy import bare_tool_name
from harness.skill_invocation import GUARDRAIL_SKILLS, skill_name_if_skill_call

# Session built-ins are not candidate fingerprints: they accompany everything,
# so their precision is near the base rate no matter which skill launched.
SESSION_BUILTINS = frozenset(
    {
        "Read",
        "Write",
        "Edit",
        "NotebookEdit",
        "Bash",
        "Glob",
        "Grep",
        "Agent",
        "Task",
        "Skill",
        "ToolSearch",
        "TodoWrite",
        "WebFetch",
        "WebSearch",
    }
)

# A fingerprint has to accompany the skill often enough to be evidence of
# absence, and be specific enough that its presence means anything.
RECALL_FLOOR = 0.30
PRECISION_FLOOR = 0.30

# Above this, a tool would be a usable completion fingerprint. Nothing reaches
# it — that is the finding. Kept as a named constant so the assertion in
# `tests/unit/test_skill_episode_report.py` and the §3 acceptance check in
# PLAN.md refer to the same number.
FINGERPRINT_PRECISION_TARGET = 0.90

# Below this many episodes a precision of 1.00 is one or two runs agreeing by
# chance, so the verdict is withheld rather than announcing a refutation. It
# gates only the verdict, not the table: `--test <slug>` narrows the corpus to a
# single fixture, where two episodes are enough to read 1.00 and claim the
# finding refuted.
EPISODE_FLOOR = 20


class EpisodeStats:
    """Accumulated episode counts across a corpus.

    Kept as one object rather than a tuple of dicts because every derived figure
    needs the corpus-wide episode totals, not just the per-skill ones — the
    precision denominator is the whole point (see the module docstring).
    """

    def __init__(self) -> None:
        self.episodes: Counter[str] = Counter()  # skill -> episode count
        self.empty: Counter[str] = Counter()  # skill -> episodes with zero tool calls
        self.tool_episodes: defaultdict[str, Counter[str]] = defaultdict(Counter)
        self.tool_total: Counter[str] = Counter()  # tool -> episodes containing it, ANY skill

    @property
    def total_episodes(self) -> int:
        return sum(self.episodes.values())

    def recall(self, skill: str, tool: str) -> float:
        n = self.episodes[skill]
        return self.tool_episodes[skill][tool] / n if n else 0.0

    def precision(self, skill: str, tool: str) -> float:
        n = self.tool_total[tool]
        return self.tool_episodes[skill][tool] / n if n else 0.0

    def most_specific(self, skill: str) -> tuple[str, float, float] | None:
        """Highest-precision tool clearing both floors, or None.

        Ties break on recall, then tool name, so the output is stable across
        runs and platforms rather than following dict insertion order.
        """
        best: tuple[float, float, str] | None = None
        for tool in self.tool_episodes[skill]:
            if tool in SESSION_BUILTINS:
                continue
            recall = self.recall(skill, tool)
            precision = self.precision(skill, tool)
            if recall < RECALL_FLOOR or precision < PRECISION_FLOOR:
                continue
            candidate = (precision, recall, tool)
            if best is None or candidate > best:
                best = candidate
        if best is None:
            return None
        precision, recall, tool = best
        return tool, precision, recall

    def top_by_recall(self, skill: str) -> tuple[str, float] | None:
        """The tool accompanying this skill most often, built-ins included.

        Built-ins are kept here deliberately: this column answers "what actually
        happens in the episode", and hiding `Read` would misrepresent it. The
        filtering belongs to `most_specific`, which answers a different question.
        """
        best: tuple[float, str] | None = None
        for tool in self.tool_episodes[skill]:
            candidate = (self.recall(skill, tool), tool)
            if best is None or candidate > best:
                best = candidate
        if best is None:
            return None
        recall, tool = best
        return tool, recall


def skill_launches(tool_calls: list[Any]) -> list[tuple[int, str]]:
    """`(index, skill_name)` for every `Skill` entry, in ledger order.

    Delegates the "is this a skill launch" test to
    `skill_invocation.skill_name_if_skill_call`, which is what §7's own detector
    uses. A second definition here would let this report and the check it exists
    to judge drift apart on the one predicate they must agree about.
    """
    out: list[tuple[int, str]] = []
    for i, entry in enumerate(tool_calls):
        if not isinstance(entry, dict):
            continue
        name = skill_name_if_skill_call(entry.get("tool", ""), entry.get("args"))
        if name:
            out.append((i, name))
    return out


def accumulate(tool_calls: list[Any], stats: EpisodeStats) -> None:
    """Fold one run's ledger into `stats`.

    A tool is counted once per episode, not once per call: the question is
    whether T accompanied X, and a skill that calls `research_append` eleven
    times in one episode is not eleven times more fingerprinted by it.
    """
    launches = skill_launches(tool_calls)
    for n, (start, skill) in enumerate(launches):
        end = launches[n + 1][0] if n + 1 < len(launches) else len(tool_calls)
        tools = {
            bare_tool_name(entry.get("tool", ""))
            for entry in tool_calls[start + 1 : end]
            if isinstance(entry, dict)
        }
        tools.discard("")
        stats.episodes[skill] += 1
        if not tools:
            stats.empty[skill] += 1
        for tool in tools:
            stats.tool_episodes[skill][tool] += 1
            stats.tool_total[tool] += 1


def scan_corpus(paths: list[Path]) -> EpisodeStats:
    """Accumulate every committed run given. Unreadable files are skipped with a
    stderr note rather than raised — one corrupt log must not void the report."""
    stats = EpisodeStats()
    for path in paths:
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError) as e:
            print(f"  skip {path}: {e}", file=sys.stderr)
            continue
        tool_calls = data.get("tool_calls")
        if isinstance(tool_calls, list) and tool_calls:
            accumulate(tool_calls, stats)
    return stats


def has_usable_fingerprint(stats: EpisodeStats, skills: tuple[str, ...]) -> list[str]:
    """Skills with a tool clearing `RECALL_FLOOR` and `FINGERPRINT_PRECISION_TARGET`.

    Empty is the finding: no guardrail skill has a non-circular completion
    fingerprint. Returned rather than printed so the unit test and the CLI assert
    the same thing.
    """
    found: list[str] = []
    for skill in skills:
        for tool in stats.tool_episodes[skill]:
            if tool in SESSION_BUILTINS:
                continue
            if (
                stats.recall(skill, tool) >= RECALL_FLOOR
                and stats.precision(skill, tool) >= FINGERPRINT_PRECISION_TARGET
            ):
                found.append(f"{skill}/{tool}")
    # Sorted, not insertion-ordered: `accumulate` builds each episode's tool set
    # with a set comprehension, and per-process string-hash randomization makes
    # that set's iteration order — and so this Counter's key order — differ
    # between two runs over byte-identical input.
    return sorted(found)


def format_report(
    stats: EpisodeStats, *, skills: tuple[str, ...], episode_floor: int = EPISODE_FLOOR
) -> str:
    lines = [
        f"Episodes: {stats.total_episodes} across all skills; "
        f"{sum(stats.episodes[s] for s in skills)} for the skills below.",
        f"Precision denominator: all {stats.total_episodes} Skill episodes. "
        f"Floors: recall >= {RECALL_FLOOR:.2f}, precision >= {PRECISION_FLOOR:.2f}, "
        f"verdict withheld below {episode_floor} episodes.",
        "",
        f"{'skill':26} {'episodes':>8} {'empty':>6}  {'highest-recall tool':<34} most specific tool",
    ]
    for skill in skills:
        n = stats.episodes[skill]
        if not n:
            lines.append(f"{skill:26} {0:>8} {0:>6}  {'(no episodes)':<34} -")
            continue
        top = stats.top_by_recall(skill)
        top_str = f"{top[0]} ({top[1]:.2f})" if top else "(none)"
        spec = stats.most_specific(skill)
        spec_str = f"{spec[0]} (prec {spec[1]:.2f} / recall {spec[2]:.2f})" if spec else "none"
        lines.append(f"{skill:26} {n:>8} {stats.empty[skill]:>6}  {top_str:<34} {spec_str}")

    empty_total = sum(stats.empty[s] for s in skills)
    ep_total = sum(stats.episodes[s] for s in skills)
    pct = (empty_total / ep_total * 100) if ep_total else 0.0
    lines += [
        "",
        f"Empty episodes: {empty_total}/{ep_total} ({pct:.2f}%). An empty episode is "
        "the only shape a ledger can express for 'launched, did nothing' —",
        "and the failure mode this measures is an episode whose only event IS the "
        "inline write, which is indistinguishable from success here.",
    ]

    # The verdict is always about the FOUR guardrail skills, never about whatever
    # `skills` happens to hold. Under --all-skills, `locality-guide` and
    # `check-warnings` do clear the target — they have genuinely specific tools —
    # and reporting that as "contradicts the premise of #1463" told a reader the
    # finding was refuted while the guardrail rows in the same table read `none`.
    # ...and it is scoped again to the guardrail skills clearing `episode_floor`.
    # Saying "all four" while the floor silently dropped one is the same
    # over-claim one level down.
    evaluated = [s for s in GUARDRAIL_SKILLS if stats.episodes[s] >= episode_floor]
    withheld = [s for s in GUARDRAIL_SKILLS if 0 < stats.episodes[s] < episode_floor]
    usable = has_usable_fingerprint(stats, tuple(evaluated))
    if not evaluated:
        lines += [
            "",
            f"Sample too small to decide: no GUARDRAIL skill has >= {episode_floor} "
            "episodes. This is NOT the no-fingerprint finding — on a corpus this "
            "narrow, claiming it confirmed is the opposite error.",
        ]
    elif usable:
        lines += [
            "",
            f"USABLE FINGERPRINT FOUND for a GUARDRAIL skill (recall >= {RECALL_FLOOR:.2f}, "
            f"precision >= {FINGERPRINT_PRECISION_TARGET:.2f}): {', '.join(usable)}",
            "This contradicts the premise of issue #1463 — re-read it before acting.",
        ]
    else:
        lines += [
            "",
            f"No tool clears recall >= {RECALL_FLOOR:.2f} with precision >= "
            f"{FINGERPRINT_PRECISION_TARGET:.2f} for the {len(evaluated)} GUARDRAIL "
            f"skill(s) with >= {episode_floor} episodes ({', '.join(evaluated)}):",
            "no non-circular completion fingerprint exists.",
        ]
    if withheld:
        lines.append(
            f"Withheld below the {episode_floor}-episode floor: "
            + ", ".join(
                f"{s} ({stats.episodes[s]} episode{'' if stats.episodes[s] == 1 else 's'})"
                for s in withheld
            )
            + "."
        )

    # Non-guardrail skills are reported as context, never as the verdict: several
    # of them DO have a usable fingerprint, which is why the scoping above matters.
    others = [s for s in skills if s not in GUARDRAIL_SKILLS]
    if others:
        other_usable = has_usable_fingerprint(stats, tuple(others))
        lines.append(
            f"(Non-guardrail skills with one, for contrast: "
            f"{', '.join(other_usable) if other_usable else 'none'}.)"
        )
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(
        description="Per-skill episode fingerprint report (issue #1463)."
    )
    ap.add_argument("--test", help="scan every committed run for this fixture slug only")
    ap.add_argument(
        "--all-skills",
        action="store_true",
        help="report every skill seen, not just the four guardrail skills",
    )
    add_since_arg(ap)
    args = ap.parse_args(argv)

    all_paths = result_jsons_for(args.test) if args.test else all_result_jsons()
    cutoff = args.since
    paths = filter_since(all_paths, cutoff)
    if not paths:
        print("No committed runs found.", file=sys.stderr)
        return 1

    stats = scan_corpus(paths)
    skills = (
        # Name breaks ties, so row order is stable as the corpus grows — the same
        # guarantee `most_specific` pins deliberately.
        tuple(sorted(stats.episodes, key=lambda s: (-stats.episodes[s], s)))
        if args.all_skills
        else GUARDRAIL_SKILLS
    )
    print(describe_window(cutoff, n_runs=len(paths), n_total=len(all_paths)))
    print(f"Scanned {len(paths)} committed run(s).")
    print()
    print(format_report(stats, skills=skills))
    return 0


if __name__ == "__main__":
    sys.exit(main())
