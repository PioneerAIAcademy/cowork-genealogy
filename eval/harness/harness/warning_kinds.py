"""Single source of truth for `output.warnings` kinds (#2025).

Every entry in a run log's `output.warnings` carries a `"kind"`. The CLI
summary tallies the *judge* kinds under "Judge rule violations" and ignores the
*harness* kinds; which kind is which used to be decided by a regex scan of a
hardcoded two-file list in `test_cli.py`. That guard was blind in two ways, and
either one silently reintroduced the dark-warning bug (a kind that prints
nowhere for its whole life) with CI green:

- **File-blind.** It scanned `judge.py` + `orchestrator.py` only. A kind
  emitted from a third file — or from a helper like
  `flag_routing_negative_judge_fail`, which builds its dict outside
  `_build_warnings` — was invisible to the scan. (That one happened to be in a
  scanned file; nothing guaranteed the next one would be.)
- **Form-blind.** It matched `"kind": "<literal>"`. A kind built from a
  constant or f-string (already how the sibling `guardrail_shadow_violations`
  channel writes every one of its kinds) matched nothing.

This registry closes both. Every `output.warnings` entry converges through the
single return of `orchestrator._build_warnings` (the only site that assembles
that list; the judge's own kinds enter it via the `judge_warnings` fold). That
return calls `validate_warning_kinds`, which checks each entry's kind **by value
at runtime** against `WARNING_KIND_SIDES`. So discovery is structural, not
textual: a new kind from any file, built any way, is caught the first time it is
emitted — it cannot reach a run log unregistered. The summary's tally list is
derived from this registry (`run_tests._JUDGE_WARNING_KINDS`), so the two cannot
drift.

Adding a kind: add one row here with its side (`"judge"` or `"harness"`). That
is the whole change — the emit site keeps its literal (validated, not parsed),
the summary picks up a `"judge"` row automatically, and `validate_warning_kinds`
stops rejecting it.
"""

from __future__ import annotations

from typing import Any, Iterable

#: kind -> which class the CLI summary treats it as.
#:   "judge"   — a judge/grading rule fired; tallied under "Judge rule
#:               violations" (this set IS run_tests._JUDGE_WARNING_KINDS).
#:   "harness" — an advisory about the skill, the fixtures, or the harness
#:               itself; deliberately NOT tallied as a judge fault.
WARNING_KIND_SIDES: dict[str, str] = {
    # --- judge-side (grading rules) ---
    "dropped_duplicate_dimension": "judge",
    "dropped_unknown_base_dimension": "judge",
    "dropped_unknown_rubric_dimension": "judge",
    "coerced_tool_arguments_to_na": "judge",
    "routing_negative_judge_fail": "judge",
    # --- harness-side (advisories about skill / fixtures / harness) ---
    "unread_skill_call": "harness",
    "missing_tool_usage_dimension": "harness",
    "uncovered_tool_call": "harness",
    "prose_observation": "harness",
    "harness_node_timeout": "harness",  # a node-subprocess flake, not the judge (#2025)
}

_VALID_SIDES = frozenset({"judge", "harness"})

JUDGE_WARNING_KINDS = frozenset(
    k for k, side in WARNING_KIND_SIDES.items() if side == "judge"
)
HARNESS_WARNING_KINDS = frozenset(
    k for k, side in WARNING_KIND_SIDES.items() if side == "harness"
)


class UnregisteredWarningKind(Exception):
    """An `output.warnings` entry carried a kind absent from the registry.

    Raised at the `_build_warnings` chokepoint so an unregistered kind fails
    loudly on first emission rather than printing nowhere. The fix is always to
    add the kind to `WARNING_KIND_SIDES` with its side.
    """


def validate_warning_kinds(warnings: Iterable[dict[str, Any]]) -> None:
    """Raise `UnregisteredWarningKind` if any warning's kind is not registered.

    Value-based, so it is immune to how the kind string was built (literal,
    constant, or f-string) and to which file emitted it — every
    `output.warnings` entry passes through here.
    """
    for w in warnings:
        kind = w.get("kind")
        if kind not in WARNING_KIND_SIDES:
            raise UnregisteredWarningKind(
                f"output.warnings carries unregistered kind {kind!r}. Add it to "
                f"WARNING_KIND_SIDES in harness/warning_kinds.py with its side "
                f"('judge' or 'harness'). Registered kinds: "
                f"{sorted(WARNING_KIND_SIDES)}"
            )
