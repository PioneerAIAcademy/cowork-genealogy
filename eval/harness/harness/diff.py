"""Structured before/after diff per unit-test-spec.md §15.

The algorithm: per section (array of objects keyed by `id`), compute
added/modified/deleted. `project` and `researcher_profile` are single
objects, not arrays — each is treated as a one-entry array for diff
purposes, keyed by its own `id` field when it has one (`project`),
else by the section name itself (`researcher_profile`, which has no
`id` per its schema) — the same `entryId` `research_append` echoes for
a singleton write. A future single-object section only needs adding to
`_SINGLETON_SECTIONS`; the keying falls back automatically.

Fields added during modification emit {"before": null, "after": value};
fields removed emit {"before": value, "after": null}. Literal null is
used so the judge sees a uniform shape.
"""

from __future__ import annotations

from typing import Any, Callable


# Sections of research.json that are single objects, not arrays of IDed entries.
_SINGLETON_SECTIONS = {"project", "researcher_profile"}


def diff_research_json(
    before: dict[str, Any] | None, after: dict[str, Any] | None
) -> dict[str, Any]:
    """Diff two research.json snapshots. Returns {sections_modified, diff}."""
    if after is None:
        return {"sections_modified": [], "diff": {}}
    before = before or {}
    sections = sorted(set(before.keys()) | set(after.keys()))

    out_diff: dict[str, dict[str, list]] = {}
    modified_sections: list[str] = []

    for section in sections:
        b = before.get(section)
        a = after.get(section)

        if section in _SINGLETON_SECTIONS:
            b_list = [b] if isinstance(b, dict) else []
            a_list = [a] if isinstance(a, dict) else []
            # A singleton keys on its own `id` field when it has one (`project`);
            # otherwise fall back to the section name, the same synthetic
            # `entryId` research_append echoes for a singleton write.
            section_diff = _diff_array(b_list, a_list, key_fn=lambda e, s=section: e.get("id", s))
        else:
            b_list = b if isinstance(b, list) else []
            a_list = a if isinstance(a, list) else []
            section_diff = _diff_array(b_list, a_list)
        if section_diff["added"] or section_diff["modified"] or section_diff["deleted"]:
            out_diff[section] = section_diff
            modified_sections.append(section)

    return {"sections_modified": modified_sections, "diff": out_diff}


def diff_tree_gedcomx(
    before: dict[str, Any] | None, after: dict[str, Any] | None
) -> dict[str, Any] | None:
    """Diff two tree.gedcomx.json snapshots. Returns None when unchanged."""
    if before is None and after is None:
        return None
    before = before or {}
    after = after or {}
    sections = sorted(set(before.keys()) | set(after.keys()))

    out_diff: dict[str, dict[str, list]] = {}
    modified_sections: list[str] = []

    for section in sections:
        b_list = before.get(section, []) if isinstance(before.get(section), list) else []
        a_list = after.get(section, []) if isinstance(after.get(section), list) else []
        section_diff = _diff_array(b_list, a_list)
        if section_diff["added"] or section_diff["modified"] or section_diff["deleted"]:
            out_diff[section] = section_diff
            modified_sections.append(section)

    if not modified_sections:
        return None
    return {"sections_modified": modified_sections, "diff": out_diff}


def _diff_array(
    before_list: list[dict[str, Any]],
    after_list: list[dict[str, Any]],
    key_fn: Callable[[dict[str, Any]], Any] | None = None,
) -> dict[str, list]:
    """Diff two arrays of objects, keyed by 'id' unless `key_fn` says otherwise."""
    if key_fn is None:
        by_id_before = {e["id"]: e for e in before_list if isinstance(e, dict) and "id" in e}
        by_id_after = {e["id"]: e for e in after_list if isinstance(e, dict) and "id" in e}
    else:
        by_id_before = {key_fn(e): e for e in before_list if isinstance(e, dict)}
        by_id_after = {key_fn(e): e for e in after_list if isinstance(e, dict)}

    added = [by_id_after[i] for i in by_id_after if i not in by_id_before]
    deleted = [by_id_before[i] for i in by_id_before if i not in by_id_after]

    modified = []
    for entry_id in by_id_before:
        if entry_id not in by_id_after:
            continue
        b = by_id_before[entry_id]
        a = by_id_after[entry_id]
        changed_fields: dict[str, dict[str, Any]] = {}
        for field in set(b.keys()) | set(a.keys()):
            if field == "id":
                continue
            if b.get(field) != a.get(field):
                changed_fields[field] = {
                    "before": b.get(field) if field in b else None,
                    "after": a.get(field) if field in a else None,
                }
        if changed_fields:
            modified.append({"id": entry_id, "changed_fields": changed_fields})

    return {"added": added, "modified": modified, "deleted": deleted}
