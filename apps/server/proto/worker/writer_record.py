"""What a write wrote, in the shape a change review needs.

"Show me what this session changed, and what my conclusion rests on" is the
highest-value item in the phase-3 plan, and it is blocked on data nobody records:
`tool_calls` stores `tool_name` and `input_path` and no payload. The captured session
made 173 writes and not one of them is recoverable from the structured table.

This records the SHAPE of a write -- which section, which operation, which ids -- and
deliberately not its payload. A diff needs to know what moved; storing whole entries
would put every record body in the call log, and the captured run's entries run to
kilobytes each.
"""

from __future__ import annotations

import json

from typing import Any

# Only these change project state, and each one carries its section IMPLICITLY -- a
# first version read `section`/`op` generically and covered only `research_append`,
# leaving 46 of the captured session's 173 writer calls (27%) uncharacterised. The
# other writers do not take a section argument at all; the tool IS the section.
#
# `research_append` is the exception, and the only one: it is the general writer and
# names its section in the call, so its entry here is a default the input overrides.
# (`evaluation_append` also takes a `section`, but it can only be `evaluations`, so
# the tool still implies it.)
#
# A read recorded here would bury the diff it is meant to produce, and an unknown
# tool records nothing rather than guessing at a shape it has never seen.
_WRITERS: dict[str, tuple[str, str]] = {
    # tool                  (section,       default op)
    "research_append":      ("",            "append"),      # names its own section
    "evaluation_append":    ("evaluations", "append"),      # research_append scoped to evaluations; the input may restate it
    "research_log_append":  ("log",         "append"),
    "extraction_append":    ("extractions", "append"),
    "tree_edit":            ("tree",        "edit"),
    "tree_correct":         ("tree",        "correct"),
    "merge_tree_persons":   ("tree",        "merge"),
    "materialize_facts":    ("tree",        "materialize"),
    "project_create":       ("project",     "create"),
    # Found by review: the engine's own writer list carries three more
    # (`tool-result.ts`, OK_FALSE_IS_FAILURE minus NOT_A_DOCUMENT_WRITER), and all
    # three recorded `wrote = NULL`. `test_every_engine_document_writer_is_characterised`
    # reads that list rather than restating it, so the next one cannot slip.
    "tree_forget":          ("tree",        "forget"),
    "timeline_build":       ("timelines",   "append"),
    "build_external_search_url": ("log",    "append"),
}

# Fields that name something a diff should be able to reach back to.
#
# Both spellings on purpose: tool PARAMETERS are camelCase and persisted ENTRY fields are
# snake_case (CLAUDE.md, "Identifier casing"), and a writer call carries both -- the entry
# in its persisted shape, the op's own ids as parameters. Carrying only the camel half is
# why most writers recorded `ids: []`: verified against each schema, `tree_edit`
# (relationshipId, sourceAssertionId), `tree_correct` (factId, relationshipId),
# `materialize_facts` (recordId) and every `research_append` update (entryId) reached back
# to nothing at all.
#
# An APPENDED entry's own id is still absent, and that is not a gap here: `PreToolUse`
# runs before the tool does, and the tool assigns the id afterwards. Its REFERENCED ids
# -- assertion_id, person_id, log_entry_id, planId -- do exist by then, which is what
# this list now reaches.
_ID_LIST_FIELDS = ("recordIds", "questionIds")

_ID_FIELDS = (
    "id", "entryId", "planId", "planItemId", "plan_item_id",
    "assertionId", "assertion_id", "personId", "person_id",
    "log_entry_id", "relationshipId", "sourceAssertionId", "factId", "recordId",
)


# The engine runs `coerceJsonArg` on these, so a stringified one is decoded and
# APPLIED. A recorder that does not decode them records the write as empty -- a
# stringified research_append update came out as {"section": "", "op": "append", "ids": []}.
_JSON_ARGS = ("ops", "entry", "fields", "merges")


def _decoded(value: Any) -> Any:
    if not isinstance(value, str):
        return value
    try:
        return json.loads(value)
    except (ValueError, RecursionError):
        return value


def _with_json_args(value: Any) -> Any:
    """Decode ONLY the four keys the engine coerces.

    Not every field: an id like "12345" would become a number, and a value that
    explodes under inspection must still be swallowed rather than decoded.
    """
    value = _decoded(value)
    if not isinstance(value, dict):
        return value
    decoded = {k: _decoded(value.get(k)) for k in _JSON_ARGS}
    return {**value, **{k: v for k, v in decoded.items() if v is not None}}


def _bare(tool_name: str) -> str:
    return (tool_name or "").rsplit("__", 1)[-1]


def _id_of(entry: Any) -> list[str]:
    """Every id-like field on one entry, so a log row can be traced to its plan item
    as well as to itself."""
    out: list[str] = []
    if isinstance(entry, dict):
        for field in _ID_FIELDS:
            value = entry.get(field)
            if isinstance(value, str) and value:
                out.append(value)
        # Plural spellings carry LISTS of ids -- `extraction_append` takes `recordIds`
        # and `questionIds` -- and a string-only check can never pick one up, so those
        # calls reached back to nothing.
        for field in _ID_LIST_FIELDS:
            value = entry.get(field)
            if isinstance(value, list):
                out.extend(v for v in value if isinstance(v, str) and v)
        # `merge_tree_persons` carries its ids as pairs, `merges: [[survivor, collapsed]]`
        # -- unreachable by any field NAME, so it is matched by shape. A merge is the
        # change a review most needs to trace, and it recorded nothing.
        merges = entry.get("merges")
        if isinstance(merges, list):
            for pair in merges:
                if isinstance(pair, (list, tuple)):
                    out.extend(v for v in pair if isinstance(v, str) and v)
    return out


def writer_record(tool_name: str, tool_input: Any) -> dict[str, Any] | None:
    """`{"section", "op", "ids"}` for a write, else None.

    Never raises. This runs inside the `PreToolUse` hook, and a recorder that threw
    would fail a tool call the user was entitled to make -- the same rule the hook's
    own logging already follows.
    """
    try:
        # .get(), not `in` + [] -- a missing key must return None BY DESIGN, not by
        # raising into the catch below. Break-testing found the catch masking this:
        # removing the guard still returned None, so the guard looked tested and was
        # not.
        entry = _WRITERS.get(_bare(tool_name))
        if entry is None or not isinstance(tool_input, dict):
            return None
        tool_input = _with_json_args(tool_input)
        implicit_section, default_op = entry

        ops = tool_input.get("ops")
        if isinstance(ops, list) and ops:
            sections: list[str] = []
            kinds: list[str] = []
            ids: list[str] = []
            for op in ops:
                op = _with_json_args(op)
                if not isinstance(op, dict):
                    continue
                if isinstance(op.get("section"), str):
                    sections.append(op["section"])
                # `operation`, not `op`, on tree_edit and tree_correct -- without it a
                # `remove` was recorded as the tool's default label.
                kind = op.get("op") or op.get("operation")
                if isinstance(kind, str):
                    kinds.append(kind)
                # Ids live BOTH inside `entry` and on the op itself -- a log op carries
                # `planItemId` directly, and a diff must reach the plan item it belongs
                # to, not only the log row.
                ids.extend(_id_of(op.get("entry")))
                ids.extend(_id_of(op))
            if not sections:
                sections = [implicit_section] if implicit_section else []
            if not kinds:
                kinds = [default_op]
            ids.extend(_id_of(tool_input))
            return {
                "section": ",".join(dict.fromkeys(sections)),
                # One label when every op agrees, which is the common case; else the
                # list, because "append" would be a lie about a mixed call.
                "op": kinds[0] if kinds and len(set(kinds)) == 1 else ",".join(kinds),
                "ids": list(dict.fromkeys(ids)),
            }

        section = tool_input.get("section")
        # `operation` is tree_edit/tree_correct's spelling of the same field.
        op = tool_input.get("op") or tool_input.get("operation")
        ids = _id_of(tool_input.get("entry")) + _id_of(tool_input)
        for nested in ("assertions", "entries"):
            value = tool_input.get(nested)
            if isinstance(value, list):
                for item in value:
                    ids.extend(_id_of(item))
        return {
            # The tool's own section unless it named one -- only `research_append` does.
            "section": section if isinstance(section, str) and section else implicit_section,
            "op": op if isinstance(op, str) and op else default_op,
            "ids": list(dict.fromkeys(ids)),
        }
    except Exception:  # noqa: BLE001 - see the docstring: this must never fail a call
        return None
