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

import json
from typing import Any

import pytest

# Re-exported for back-compat with existing `from validators_lib import
# extract_year` callers; the canonical definitions live in harness/dates.py so
# both validators/ and e2e/ can share them without pulling in this module's
# pytest dependency.
from harness.dates import EMBEDDED_YEAR_RE, extract_year  # noqa: F401


def bare_tool_name(tool: str) -> str:
    """Bare tool name, whatever server prefix the run exposed it under.

    A run records MCP calls under whichever of the three server spellings the
    session resolved (CLAUDE.md, "Dual-spelled tool names"), so a validator
    that matches a qualified name matches nothing on two thirds of runs.
    """
    tool = tool or ""
    return tool.split("__")[-1] if "__" in tool else tool


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


def new_section_entries(
    before_state: dict[str, Any],
    after_state: dict[str, Any],
    section: str,
    *,
    include_modified: bool = False,
) -> list[dict]:
    """Entries of `section` present in `after_state` but not `before_state`, by id
    — or, when `include_modified` is set, also entries with the same id whose
    content changed in place (research_append op:"update").

    The general form of `new_log_entries` below, which is now a thin alias for
    `section="log"`. Generalised rather than copied when `test_record_extraction`
    needed the same diff over `sources`; `include_modified` was added for
    `localities`, which locality-guide can rewrite in place, so an update is not
    silently skipped. `include_modified` defaults False, so `new_log_entries` and
    the `sources` caller are unchanged.

    An earlier draft of this docstring called that copy "the fifth" and credited
    the `isinstance` guard to "the four earlier ones". Both were wrong, and the
    reviewer who supplied the error corrected it (#2390 round 2). By the time
    this PR began, `new_log_entries` was already a single shared helper on main
    **carrying the guard** — the four byte-identical copies it was lifted from
    were gone, and what remains is four *importing* files
    (`test_search_full_text`, `test_search_records`, `test_search_external_sites`,
    `test_search_images`). So the thing avoided here was a second helper beside
    the first, not a fifth copy beside four.

    Takes the wrapped per-run state dicts ({"research_json": {...}, ...}), not
    the unwrapped research.json dict `assert_log_append_only` and its neighbours
    above take — see `new_log_entries` for why that mismatch is deliberate.
    """
    before = before_state.get("research_json") or {}
    after = after_state.get("research_json") or {}
    # `or []`, not `.get(section, [])`: an explicit `"log": null` satisfies the
    # default and then raises TypeError on iteration. This is NEW here — the
    # shared helper on main used `after.get("log", [])` — so it is not, as an
    # earlier draft said, pre-existing in copies this replaced (#2390 round 2).
    # It fires on 0 of the 2130 committed unit runs across 27 skills, so it is
    # hardening rather than a fix; the section being caller-supplied is what
    # widens the set of shapes that reach here. (2130 drifts as runs land — the
    # 0 is the claim.)
    # `prior` is a dict {id: entry}, not the set of ids the pre-`include_modified`
    # helper kept: `include_modified` needs the entry itself to compare against.
    # One consequence beyond the "default unchanged" claim above: duplicate ids in
    # `before` collapse to the LAST occurrence, so a same-id pair there is compared
    # only against its last member. No section reaching this holds duplicate ids
    # today (research_append assigns them), so it is latent, not live.
    prior = {
        e.get("id"): e for e in (before.get(section) or []) if isinstance(e, dict)
    }
    out = []
    for e in (after.get(section) or []):
        if not isinstance(e, dict):
            continue
        eid = e.get("id")
        if eid not in prior or (include_modified and prior[eid] != e):
            out.append(e)
    return out


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
    return new_section_entries(before_state, after_state, "log")


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
    captured: set[tuple[str | None, str, str]] = set()
    for entry in after.get("log") or []:
        pid = entry.get("plan_item_id")
        tool = entry.get("tool")
        # Only an external-site entry, or a records search that actually
        # FOUND something, says how an item ended. A later nil search — or
        # another external_links_search, which only discovers links —
        # leaves the outstanding capture outstanding.
        if pid and (
            tool == "external_site"
            or (entry.get("outcome") == "positive" and tool != "external_links_search")
        ):
            latest[pid] = entry
        if tool != "external_site":
            continue
        detail = entry.get("external_site") or {}
        url = detail.get("url_generated")
        if detail.get("capture_received") is True and detail.get("site") and url:
            # Scoped to the item it answers: an arrival naming a DIFFERENT
            # item must not launder this one.
            captured.add((pid, detail["site"], url))

    for pid in sorted(changed):
        entry = latest.get(pid)
        if entry is None or entry.get("tool") != "external_site":
            continue
        site = entry.get("external_site") or {}
        if site.get("capture_received") is True:
            continue
        key = (site.get("site"), site.get("url_generated"))
        if (pid, *key) in captured or (None, *key) in captured:
            continue
        status = after_items.get(pid)
        assert status not in ("completed", "skipped"), (
            f"plan item {pid} is '{status}' but its latest external_site log "
            f"entry ({entry.get('id')}) has capture_received="
            f"{site.get('capture_received')!r} — the capture never arrived, so "
            f"the search did not happen. Expected 'in_progress'. See #1226."
        )


def as_mapping(value: Any) -> dict:
    """A tool argument a model may have serialized as a JSON string.

    Production tools recover a stringified object argument themselves
    (`coerceJsonArg`), so the call SUCCEEDS; reading it raw here raised
    `AttributeError` instead of grading, and a crash in a validator is not an
    observation. Anything that is not a mapping after one parse attempt reads as
    absent, which is what an omitted argument does, so this never invents a
    value and cannot turn a passing call into a firing one.
    """
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except (ValueError, TypeError):
            return {}
    return value if isinstance(value, dict) else {}


def tool_input_keys(tool: str, nested: str | None = None) -> frozenset[str] | None:
    """Input property names of `tool` from the compiled MCP build, the schema
    production advertises, or of its object property `nested` (e.g.
    `build_external_search_url`'s `attributes`). None when the build is not
    readable: a validator that cannot know the vocabulary must skip, not guess.

    Imported lazily: `harness.mock_mcp` pulls in the agent SDK and the fixture
    loader, and every validator module imports this file.
    """
    from harness.mock_mcp import _load_build_tool_catalog

    schema = (_load_build_tool_catalog().get(tool) or {}).get("inputSchema") or {}
    props = schema.get("properties")
    if nested is not None:
        props = ((props or {}).get(nested) or {}).get("properties")
    return frozenset(props) if isinstance(props, dict) and props else None


# Inputs a search tool echoes that are not filters: host plumbing, and paging /
# response-shape controls. Mirrors NOT_A_FILTER in
# packages/engine/mcp-server/src/tools/research-log-append.ts; a claim about one
# of these is not a claim about which records a search matched.
NOT_A_FILTER: frozenset[str] = frozenset({"projectPath", "subjectId", "count", "offset", "includeFacets"})


def filter_claim_findings(query: Any, sent: Any, vocabulary: frozenset[str]) -> tuple[list[str], list[str]]:
    """Compare a log entry's `query` with the arguments its call sent.

    `sent` is what reached the search: for `record_search`, pass it through
    `record_search_sent` first.

    Returns `(never_sent, differs)`: filter keys the entry claims with a value
    that the call did not send at all, and keys both carry with different
    values. Only keys in `vocabulary` that are filters count; a `None` or `""`
    claim claims nothing. The `never_sent` class is the one
    `research_log_append` refuses for a staged entry; `differs` is mostly place
    normalization and is observed, never refused.
    """
    query, sent = as_mapping(query), as_mapping(sent)
    never_sent: list[str] = []
    differs: list[str] = []
    for key, claimed in query.items():
        if claimed is None or claimed == "" or key in NOT_A_FILTER or key not in vocabulary:
            continue
        # An `*Exact` flag reaches the search only when true; `false` is the default.
        if claimed is False and key.endswith("Exact"):
            continue
        if key not in sent:
            never_sent.append(f"{key}={claimed!r}")
        elif sent[key] != claimed:
            differs.append(f"{key}: logged {claimed!r}, sent {sent[key]!r}")
    return never_sent, differs


def record_search_sent(args: Any) -> dict:
    """`record_search`'s arguments as searched: it fills the missing half of an
    alternate name before building the query. Mirrors `applyAltNameAutoPair` in
    packages/engine/mcp-server/src/tools/record-search.ts, which the tool's own
    refusal calls directly; a Python validator cannot, so this is the one copy."""
    out = dict(as_mapping(args))
    if out.get("surnameAlt") and not out.get("givenNameAlt") and out.get("givenName"):
        out["givenNameAlt"] = out["givenName"]
    if out.get("givenNameAlt") and not out.get("surnameAlt") and out.get("surname"):
        out["surnameAlt"] = out["surname"]
    return out


def hashable_key(value: Any) -> str:
    """A grouping key for any JSON value, so a list-valued field cannot crash a
    validator that groups by it."""
    return json.dumps(value, sort_keys=True, default=str)
