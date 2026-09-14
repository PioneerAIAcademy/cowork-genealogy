"""Shared date helpers for validators and the e2e author CLI.

`EMBEDDED_YEAR_RE` / `extract_year` live here rather than in
`validators/validators_lib.py` so `e2e/author.py` -- a fixture-authoring CLI --
can import them without pulling in `validators_lib`'s module-scope
`import pytest`. Only the e2e CLI sheds a dependency: `validators/` still
imports pytest directly (`validators_lib.py`), and `harness/` already treats
dev-group pytest as a runtime dependency (`validator_runner.py`'s
`from _pytest.outcomes import Skipped`). Both layers already depend on
`harness/`; `validators_lib` re-exports these for back-compat with existing
`from validators_lib import extract_year` callers.
"""

from __future__ import annotations

import re

# A bare 4-digit year embedded in free text. The `1000`-`2099` *range* is the
# union of every range this repo's validators/scripts have independently used
# for the same purpose (test_research_plan.py: 1000-2049;
# test_record_extraction.py's `_EMBEDDED_YEAR_RE`: 1500-2099; e2e/author.py's
# `_YEAR`: 1000-2099) -- widening the *range* only, never narrowing it (PR #2004
# review, clack391: "the three disagree on what a year is").
#
# "Widening only" is about the numeric range and nothing else. Two limits on it,
# both load-bearing for issue #2330 half 2:
#   * Boundary vs. range. This uses `\b`, so it will NOT match a year abutting a
#     letter or digit: extract_year("12May1879") and ("the 1850s") both return
#     None. A caller using lookarounds `(?<!\d)...(?!\d)` (e.g.
#     test_timeline.py's `_YEAR_RE`) DOES match those, so migrating such a caller
#     onto this would silently *narrow* it. That -- not its 1800-1999 range --
#     is why test_timeline stays out of scope: swapping its lookarounds for `\b`
#     fails the census-wiki validators, whereas widening its range does not.
#   * A wider range creates false positives. Migrating test_record_extraction.py
#     (1500-2099) onto 1000-2099 turns sub-1500 street/district numbers into year
#     matches -- "District 1065, Spalding County, Georgia" (committed in
#     eval/runlogs/e2e/ogletree-children/) starts matching "1065", and that
#     validator counts a false positive as a failed grade. Half 2 must keep
#     1500-2099 (or filter), not adopt this constant verbatim.
#
# `e2e/author.py` is migrated onto this (its old `_YEAR` was byte-identical --
# same `\b`, same 1000-2099 range -- so no behaviour change);
# `test_record_extraction.py` still carries its own copy -- migrating that is
# tracked separately (issue #2330 half 2).
EMBEDDED_YEAR_RE = re.compile(r"\b(1\d{3}|20\d{2})\b")


def extract_year(text: str | None) -> str | None:
    """Pull the first embedded 4-digit year out of `text` -- a bare year,
    `~yyyy`, ISO `yyyy-mm-dd`/`yyyy-mm`, or a `standard_date` sidecar like
    "Abt 1850". `None` when `text` is falsy or no such pattern is found."""
    if not text:
        return None
    m = EMBEDDED_YEAR_RE.search(text)
    return m.group(1) if m else None
