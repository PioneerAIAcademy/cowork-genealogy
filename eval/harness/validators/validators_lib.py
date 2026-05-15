"""Shared validator helpers.

Per spec §8: structural correctness checks are deterministic functions
that take some subset of `before_state`, `after_state`, `tool_calls`,
and `skill_frontmatter`, then raise `AssertionError` on failure.

The first two seed validators (test_conflict_resolution.py,
test_record_extraction.py) duplicated diff logic, append-only checks,
and foreign-key reference checks across files. As the corpus grows to
23 skills, that drift compounds — a fix in one file silently misses
the others. These helpers centralise the patterns.

Helpers raise AssertionError with informative messages on failure;
on success they return None. Most accept the parsed research.json
dicts directly (callers do `before_state.get("research_json")` and
the pytest.skip-on-None dance themselves) — that keeps the helpers
small and lets each validator file decide how to handle missing state.
"""

from __future__ import annotations

from typing import Any


def assert_no_section_deletions(
    before: dict[str, Any],
    after: dict[str, Any],
    section: str,
) -> None:
    """Every entry present before must still be present after.

    Modifications are allowed — many skills update classification
    fields in place. Deletion is what's forbidden across the board
    (research-schema-spec.md §4 "General rule").
    """
    before_ids = {e.get("id") for e in before.get(section, []) if isinstance(e, dict)}
    after_ids = {e.get("id") for e in after.get(section, []) if isinstance(e, dict)}
    missing = before_ids - after_ids
    assert not missing, (
        f"entries deleted from `{section}`: {sorted(missing)}. "
        f"No section allows deletion — supersede with a status field instead."
    )


def assert_only_writes_to_sections(
    before: dict[str, Any],
    after: dict[str, Any],
    owned: set[str],
    *,
    all_sections: set[str] | None = None,
    skill_name: str = "skill",
) -> None:
    """The skill may only modify sections in `owned`. Any other section
    that changed between before/after triggers an assertion.

    `all_sections` defaults to the 11 top-level research.json sections
    plus `tree_gedcomx_json` and `tree.gedcomx.json` aliases — pass
    your own set if you have a narrower scope to check.
    """
    sections = all_sections or _DEFAULT_ALL_SECTIONS
    modified = []
    for s in sections:
        if before.get(s) != after.get(s):
            modified.append(s)
    unauthorized = set(modified) - owned
    assert not unauthorized, (
        f"{skill_name} modified sections it doesn't own: {sorted(unauthorized)}. "
        f"Allowed: {sorted(owned)}"
    )


def assert_foreign_keys_valid(
    after: dict[str, Any],
    references: list[tuple[str, str, str]],
    *,
    before: dict[str, Any] | None = None,
) -> None:
    """Every reference in `references` must resolve.

    `references` is a list of `(source_section, field, target_section)`
    triples. For each (section, field, target_section), the helper
    checks every entry in `after[source_section]` and confirms that
    `entry[field]` matches some `target_section[].id`. Skips entries
    where the field is unset/None/empty.

    When `before` is supplied, only NEW entries are checked (those whose
    id wasn't present in `before[source_section]`). This is the common
    pattern — pre-existing entries already passed validation in an
    earlier run, and reflagging them on every run is noise.
    """
    errors: list[str] = []
    for source_section, field, target_section in references:
        valid_ids = {
            t.get("id")
            for t in after.get(target_section, [])
            if isinstance(t, dict) and t.get("id")
        }
        before_ids = (
            {
                e.get("id")
                for e in (before or {}).get(source_section, [])
                if isinstance(e, dict)
            }
            if before is not None
            else set()
        )
        for entry in after.get(source_section, []):
            if not isinstance(entry, dict):
                continue
            if entry.get("id") in before_ids:
                continue
            ref = entry.get(field)
            if ref is None or ref == "":
                continue
            # Single id or list of ids
            ids_to_check = ref if isinstance(ref, list) else [ref]
            for r in ids_to_check:
                if r not in valid_ids:
                    errors.append(
                        f"{source_section}[{entry.get('id')}].{field}"
                        f"='{r}' doesn't match any {target_section}[].id"
                    )
    assert not errors, "Dangling references:\n  - " + "\n  - ".join(errors)


def assert_log_append_only(
    before: dict[str, Any],
    after: dict[str, Any],
) -> None:
    """Existing log entries must not be modified or deleted.

    The log is the only strictly append-only section per spec §4.
    """
    before_log = before.get("log", [])
    after_log = after.get("log", [])
    assert len(after_log) >= len(before_log), (
        f"log entries deleted: before {len(before_log)} → after {len(after_log)}"
    )
    for i, entry in enumerate(before_log):
        assert i < len(after_log), f"log entry {entry.get('id')} deleted"
        assert after_log[i] == entry, (
            f"log entry {entry.get('id')} was modified — log is append-only"
        )


_DEFAULT_ALL_SECTIONS: set[str] = {
    "project", "questions", "plans", "log", "sources",
    "assertions", "person_evidence", "conflicts",
    "hypotheses", "timelines", "proof_summaries",
}
