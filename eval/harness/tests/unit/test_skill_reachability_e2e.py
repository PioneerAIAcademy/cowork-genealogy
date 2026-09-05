"""Dark-skill guard — a shipped skill that no e2e run ever invokes (#2106).

Twelve of the twenty-seven skills under `packages/engine/plugin/skills/` have
**zero** invocations across the committed e2e corpus. Nothing in either eval tier
fails on that today: a unit suite grades a skill that is invoked *by construction*
(the harness names it), and the e2e tier grades the research outcome, not which
skills reached it. So a skill can ship, be maintained, cost prompt tokens in every
router decision, and never run — which is what happened here, unnoticed, until
someone counted.

This is the `nothing-checks` half of #2106, and it is deliberately independent of
the routing half. The routing fix as that card first proposed it — add the dark
skills to the orchestrator's table — was refuted in review: `hypothesis-tracking`
is already a routing-table row and is dark, while `check-warnings` is named nowhere
in `research/SKILL.md` and is invoked 40 times. A guard that reports the population
is useful whatever the eventual fix turns out to be, and it is what makes the next
regression visible rather than discovered by hand a month later.

**The list below may only SHRINK.** An entry leaves when the skill starts being
invoked. Adding one means a skill went dark and the change that did it should be
reconsidered instead — which is the regression this exists to catch.
"""

from __future__ import annotations

import json
from collections import Counter
from pathlib import Path

# eval/ is three levels up from eval/harness/tests/unit/; the repo root is one more.
EVAL_ROOT = Path(__file__).resolve().parents[3]
REPO_ROOT = EVAL_ROOT.parent
E2E_RUNLOGS = EVAL_ROOT / "runlogs" / "e2e"
SKILLS_DIR = REPO_ROOT / "packages" / "engine" / "plugin" / "skills"

# Skills with zero e2e invocations as of 2026-09-01, measured over 159 runs.
#
# Being on this list is not a verdict that the skill is unwanted — #2107 already
# falsified that for `convert-dates` (no inline handling was found, so the skill is
# not redundant). It records only that nothing in the corpus reaches it.
#
# Two of these are expected and would not be fixed by routing. Both checked rather
# than assumed:
#   - `project-status` reports state to a human. Every e2e run is launched as
#     `/research --autonomous` (`eval/harness/e2e/orchestrator.py:876`), so there is
#     no human mid-run to report to.
#   - `forget-and-rederive` is operator-driven. No fixture requests it: the only
#     match across `eval/tests/e2e/*/fixture.json` is in `cook-spouse-children`'s
#     `notes`, describing that fixture's provenance — its starting tree was
#     pre-stripped to mirror a real forget-and-rederive bug (#1473) — rather than
#     asking the agent to invoke the skill.
# They are listed rather than exempted so the count stays honest.
DARK_SKILLS_2026_09_01 = frozenset(
    {
        "citation",
        "convert-dates",
        "forget-and-rederive",
        "historical-context",
        "hypothesis-tracking",
        "project-status",
        "search-familysearch-wiki",
        "search-wikipedia",
        "timeline",
        "translation",
        "tree-edit",
        "validate-schema",
    }
)


def invocation_counts() -> Counter:
    """Skill invocations across every committed e2e run log.

    Counts `Skill` and `SlashCommand` tool calls. Every name in the corpus today is
    bare (`'question-selection'`, `'search-records'`, …) — none carries a
    `plugin:` prefix — so the split below is defensive against a namespaced form
    appearing later, not a case observed here. Unreadable logs are skipped rather
    than failing the guard: a corrupt log is its own problem and should not mask
    this one.

    Three names in the ledger are not skill directories (`assertion-classification`,
    `gps-mentor`, `update-config`); intersecting with `shipped_skills()` drops them.
    """
    counts: Counter = Counter()
    for path in sorted(E2E_RUNLOGS.glob("*/run-*.json")):
        if path.name.endswith(".ann.json") or ".final-" in path.name:
            continue
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        for call in data.get("tool_calls", []) or []:
            if call.get("tool") not in ("Skill", "SlashCommand"):
                continue
            args = call.get("args") or {}
            name = args.get("skill") or args.get("command") or args.get("name") or ""
            if name:
                counts[str(name).lstrip("/").split(":")[-1]] += 1
    return counts


def shipped_skills() -> set[str]:
    return {p.name for p in SKILLS_DIR.iterdir() if p.is_dir()}


def test_the_corpus_is_actually_readable():
    """Guard the guard: an empty scan would make every skill look dark and every
    assertion below pass vacuously in the wrong direction."""
    counts = invocation_counts()
    assert sum(counts.values()) > 0, "no skill invocations found — is E2E_RUNLOGS right?"
    assert len(shipped_skills()) > 20, "skills directory did not enumerate"


def test_no_new_skill_has_gone_dark():
    """The ratchet. A shipped skill with zero invocations that is not in the
    recorded set is either a regression or a skill added since 2026-09-01 — the
    failure message separates them, because the right response is opposite."""
    counts = invocation_counts()
    newly_dark = sorted(
        s for s in shipped_skills() if counts.get(s, 0) == 0 and s not in DARK_SKILLS_2026_09_01
    )
    assert not newly_dark, (
        f"shipped skill(s) with zero e2e invocations, not in the recorded set: "
        f"{newly_dark}. Two causes, needing opposite responses:\n"
        "  * It used to be invoked -> something stopped reaching it. Reconsider that "
        "change. Do NOT add the skill to DARK_SKILLS_2026_09_01: that set only "
        "shrinks, and adding an entry is how a regression becomes the new baseline.\n"
        "  * It is newer than 2026-09-01 -> nothing regressed; it was never in the "
        "population this set records. Give it e2e coverage, or re-baseline the set "
        "deliberately and say why in the comment above it — the set holds bare names "
        "and cannot carry a per-entry reason, so the reason belongs in that comment."
    )


def test_the_dark_list_has_no_stale_entries():
    """The list may only shrink. An entry that is now invoked must be removed, or
    the recorded population drifts upward from reality and stops being a baseline."""
    counts = invocation_counts()
    revived = sorted(s for s in DARK_SKILLS_2026_09_01 if counts.get(s, 0) > 0)
    assert not revived, (
        f"listed as dark but now invoked: {revived}. Remove from "
        "DARK_SKILLS_2026_09_01 — the list only shrinks."
    )


def test_every_listed_skill_still_exists():
    """A deleted skill should leave the list rather than sit in it forever looking
    like an outstanding problem."""
    missing = sorted(s for s in DARK_SKILLS_2026_09_01 if s not in shipped_skills())
    assert not missing, f"listed as dark but no longer shipped: {missing}"
