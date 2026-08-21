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

import pytest


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


def new_log_entries(before_state: dict[str, Any], after_state: dict[str, Any]) -> list[dict]:
    """Log entries present in `after_state` but not `before_state`, by id.

    Takes the wrapped per-run state dicts ({"research_json": {...}, ...}),
    not the unwrapped research.json dict assert_log_append_only and its
    neighbors above take -- that mismatch is deliberate: every call site
    this helper was lifted from (test_search_full_text.py,
    test_search_records.py, test_search_external_sites.py,
    test_search_images.py) already had its own byte-identical copy taking
    wrapped state, so matching that signature let each site switch over
    with no logic change, rather than matching the unwrapped convention
    the two helpers above use.
    """
    before = before_state.get("research_json") or {}
    after = after_state.get("research_json") or {}
    before_ids = {e.get("id") for e in before.get("log", []) if isinstance(e, dict)}
    return [
        e for e in after.get("log", [])
        if isinstance(e, dict) and e.get("id") not in before_ids
    ]


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


def assert_capture_pending_item_not_terminal(
    before_state: dict[str, Any],
    after_state: dict[str, Any],
    test: dict[str, Any],
) -> None:
    """A plan item whose external-site search is still awaiting a capture must
    not be terminal.

    `search-external-sites` cannot search a paywalled site: it builds a URL,
    hands it to the user, and waits for a PDF. Marking the plan item
    `completed` (or `skipped`) at that point tells `research-exhaustiveness`
    the avenue was searched when nothing was, and it declares the question
    exhaustively researched. See issue #1226 and the endings table in
    `search-external-sites/SKILL.md` step 7.

    Scoped deliberately:

    * Only items **this run changed** — a scenario's pre-existing `completed`
      external-site items (e.g. `mid-research-flynn`'s `pli_002`/`pli_003`)
      are fixture state, not this run's doing.
    * `tool == "external_site"` is the discriminator; `log_entry` has no
      `type` property.
    * Latest entry per item wins, across **every** tool — not just the
      external-site ones. An item whose most recent entry is a FamilySearch
      hit was closed by that search; the stale handoff sitting further up the
      log is not evidence about how it ended.
    * A capture that arrived is a later *entry*, never an edit of the earlier
      one, and step 6 names the fields to carry onto it without naming
      `planItemId` — so the arrival can land with `plan_item_id: null` and
      leave no per-item trace. Arrivals are therefore also matched on
      `(site, url_generated)`, which the schema requires on every
      external-site entry. That keeps the ending the table calls `completed`
      from failing here. The guarantee still belongs in the skill text; this
      is the approximation available to a validator.
    * Tests whose expected ending is terminal are exempt by tag. Keyed on
      `terminal-status-expected` for the reason the tag exists, with
      `autonomous`/`user-requested-skip` still honoured: `autonomous` is a
      mode, and a future autonomous test in another suite would silently
      disarm this guard by inheriting an exemption it never asked for.
    """
    tags = test.get("tags") or []
    exempt = {"terminal-status-expected", "autonomous", "user-requested-skip"}
    if exempt & set(tags):
        pytest.skip("test expects a terminal plan-item status by design")

    before = (before_state or {}).get("research_json")
    after = (after_state or {}).get("research_json")
    if not before or not after:
        pytest.skip("no research.json in scenario")

    def _items(doc: dict) -> dict[str, str]:
        out: dict[str, str] = {}
        for plan in doc.get("plans") or []:
            for item in plan.get("items") or []:
                if item.get("id"):
                    out[item["id"]] = item.get("status")
        return out

    before_items, after_items = _items(before), _items(after)
    changed = {
        pid
        for pid, status in after_items.items()
        if before_items.get(pid) != status
    }
    if not changed:
        pytest.skip("this run changed no plan-item status")

    # Latest entry per plan item across the whole final log, any tool. An item
    # closed by a later FamilySearch hit is not this guard's business, even
    # when an older external-site handoff for it is still marked in-flight.
    latest: dict[str, dict] = {}
    # Captures that arrived, keyed by the search they answer. Step 6 does not
    # say to carry `planItemId` onto the arrival, so a triaged capture can be
    # invisible per-item; `(site, url_generated)` identifies the same handoff.
    captured: set[tuple[str, str]] = set()
    for entry in after.get("log") or []:
        pid = entry.get("plan_item_id")
        if pid:
            latest[pid] = entry
        if entry.get("tool") != "external_site":
            continue
        detail = entry.get("external_site") or {}
        url = detail.get("url_generated")
        if detail.get("capture_received") is True and detail.get("site") and url:
            captured.add((detail["site"], url))

    for pid in sorted(changed):
        entry = latest.get(pid)
        if entry is None or entry.get("tool") != "external_site":
            continue
        site = entry.get("external_site") or {}
        if site.get("capture_received") is True:
            continue
        if (site.get("site"), site.get("url_generated")) in captured:
            continue
        status = after_items.get(pid)
        assert status not in ("completed", "skipped"), (
            f"plan item {pid} is '{status}' but its latest external_site log "
            f"entry ({entry.get('id')}) has capture_received="
            f"{site.get('capture_received')!r} — the capture never arrived, so "
            f"the search did not happen. Expected 'in_progress'. See #1226."
        )
