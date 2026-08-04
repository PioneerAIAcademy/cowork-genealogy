"""Skill-specific validators for the search-familysearch-wiki skill.

search-familysearch-wiki searches the FamilySearch Research Wiki via the
`wiki_search` tool. This file holds the deterministic invariant for its
boundary negatives: when a request belongs to a sibling skill
(search-wikipedia, locality-guide, historical-context), this skill must
NOT handle it by running its own `wiki_search`.

See test_universal.py for the validator function-signature contract; the
`test` argument is the inner "test" block, used to gate on test["tags"].
Note: the FamilySearch wiki tool is `wiki_search`; search-wikipedia's tool
is `wikipedia_search` (which does NOT contain the substring "wiki_search"),
so `.endswith("wiki_search")` cleanly targets only the FS-wiki tool.
"""

from __future__ import annotations

import pytest


def test_no_spurious_wiki_search(tool_calls, test):
    """Invariant behind the `grade_on_invariant` flag on search-familysearch-wiki
    boundary negatives, gated on the `no-wiki-search` tag.

    When a request belongs to a sibling skill, search-familysearch-wiki must
    not handle it by running its own FamilySearch-wiki search. Whether the
    router declines the request or routes it to the correct sibling, this
    skill must not call `wiki_search`. Deterministic check: `wiki_search` was
    never invoked. This is the real gate that keeps grade_on_invariant from
    passing vacuously.
    """
    if "no-wiki-search" not in (test.get("tags") or []):
        pytest.skip("only applies to no-wiki-search negative tests")
    called = [
        tc["tool"] for tc in tool_calls
        if tc.get("tool", "").endswith("wiki_search")
    ]
    assert not called, (
        "this boundary negative must not trigger a FamilySearch-wiki search; "
        f"wiki_search was invoked: {called}"
    )
