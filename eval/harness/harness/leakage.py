"""Pre-flag verdict-shaped `additional_criteria` for senior review.

Spec §5.4 names criterion leakage as the biggest validity threat to
LLM-as-judge grading: an author embeds the expected answer in their
criterion ("should resolve in favor of Ireland") and the judge agrees
by construction.

The judge prompt's neutrality guardrail is reactive — it nudges the
judge to grade reasoning over verdict. This module is proactive: pattern-
match each criterion against a list of verdict-shaped phrases and
surface matches in the run log so senior genealogists can audit which
criteria need rewriting.

**Recall is intentionally conservative — expect ~30-60%.** The patterns
catch the most common verdict-shapes (should resolve in favor of, should
classify as, should identify X as, the right answer is, since X is true,
etc.) but cannot catch every paraphrase or implicit-verdict construction
(e.g., "Patrick is from Ireland"). The detector is a first-pass flag,
not exhaustive auto-detection — **senior review on flagged criteria is
the real safety net.** Treat the empty-flags case as "no obvious leakage,"
not "criterion is safe."

The advisory is non-blocking — a flagged criterion still runs. The
purpose is auditing, not auto-correction.
"""

from __future__ import annotations

import re
from typing import Any


# Patterns that strongly suggest a criterion has baked in a verdict.
# Each pattern is a tuple (compiled_regex, human_description).
#
# The patterns lean conservative — we'd rather false-flag a few
# legitimate criteria than miss leakage. Senior review on flagged
# criteria is cheap; missed leakage poisons the grading layer.
_VERDICT_PATTERNS: list[tuple[re.Pattern[str], str]] = [
    (
        re.compile(r"\bshould\s+resolve(?:\s+\w+){0,3}\s+in\s+favor\b", re.IGNORECASE),
        "resolves toward a specific outcome",
    ),
    (
        re.compile(r"\bshould\s+(?:classify|categorize)\s+(?:[\w-]+\s+){0,3}as\b", re.IGNORECASE),
        "asserts a specific classification",
    ),
    (
        re.compile(r"\bshould\s+(?:choose|select|pick|prefer)\b", re.IGNORECASE),
        "asserts a specific choice",
    ),
    (
        re.compile(r"\bshould\s+conclude\s+(?:that\s+)?\b", re.IGNORECASE),
        "asserts a specific conclusion",
    ),
    (
        # Allows multi-word subjects between "identify" and "as", e.g.,
        # "identify Thomas Flynn as".
        re.compile(r"\bshould\s+identify\s+\w+(?:\s+\w+){0,4}\s+as\b", re.IGNORECASE),
        "asserts a specific identification",
    ),
    (
        re.compile(r"\bthe\s+right\s+(?:answer|conclusion)\s+is\b", re.IGNORECASE),
        "states the answer directly",
    ),
    (
        re.compile(r"\bcorrect(?:ly)?\s+conclud(?:e|ing|es)\b", re.IGNORECASE),
        "implies one correct conclusion",
    ),
    # Verdict-first phrasing: "Ireland is the right birthplace" /
    # "Ireland is the correct birthplace".
    (
        re.compile(
            r"\b[A-Z][\w-]+\s+is\s+the\s+(?:right|correct)\s+\w+",
            re.IGNORECASE,
        ),
        "states a specific verdict-first",
    ),
    # Reason-baked-in framings: "since X is true", "given that X",
    # "because X is the case".
    (
        re.compile(r"\b(?:since|because|given\s+that)\s+\w[\w\s]{0,40}\bis\b", re.IGNORECASE),
        "frames a premise as established truth",
    ),
    # Negated forms: "should not conclude Y", "should not say PA".
    (
        re.compile(r"\bshould\s+not\s+(?:conclude|say|claim|state|select|choose)\b", re.IGNORECASE),
        "explicitly forbids a specific verdict",
    ),
    # Bare equality framing: "X = Y" pattern (common in concise criteria).
    (
        re.compile(r"\b[A-Z][\w-]+\s*=\s*[A-Z][\w-]+\b"),
        "asserts an equality verdict",
    ),
]


def flag_verdict_shaped_criteria(criteria: list[str]) -> list[dict[str, Any]]:
    """Scan criteria for verdict-shaped phrasing.

    Returns a list of advisory entries (one per flagged criterion) suitable
    for inclusion in the run log under `output.criteria_leakage_flags`.
    Each entry: `{criterion, matched_pattern, advisory}`.

    Returns [] when nothing matches — most criteria *don't* leak, and the
    field stays empty in the run log.
    """
    flags: list[dict[str, Any]] = []
    for criterion in criteria:
        for pattern, label in _VERDICT_PATTERNS:
            if pattern.search(criterion):
                flags.append(
                    {
                        "criterion": criterion,
                        "matched_pattern": label,
                        "advisory": (
                            "Criterion appears to embed a specific verdict. Apply the "
                            "spec §5.4 neutrality test: would a genealogist reaching "
                            "the opposite conclusion still endorse this criterion as "
                            "fair? If not, rewrite to grade the reasoning, not the verdict."
                        ),
                    }
                )
                break  # one flag per criterion is enough; first match wins
    return flags
