"""Shared date helpers for validators and the e2e author CLI.

`EMBEDDED_YEAR_RE` / `extract_year` live here rather than in
`validators/validators_lib.py` so both `validators/` and `e2e/` can import
them without either pulling in `validators_lib`'s module-scope `import pytest`
(a dev-group dependency that has no business in a fixture-authoring CLI). Both
layers already depend on `harness/`; `validators_lib` re-exports these for
back-compat with existing `from validators_lib import extract_year` callers.
"""

from __future__ import annotations

import re

# A bare 4-digit year embedded in free text. `1000`-`2099` is the union of
# every range this repo's validators/scripts have independently used for the
# same purpose (test_research_plan.py: 1000-2049; test_record_extraction.py's
# `_EMBEDDED_YEAR_RE`: 1500-2099; e2e/author.py's `_YEAR`: 1000-2099) --
# widening only, never narrowing, so migrating a caller here cannot silently
# stop matching something it used to (PR #2004 review, clack391: "the three
# disagree on what a year is"). `e2e/author.py` is migrated onto this;
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
