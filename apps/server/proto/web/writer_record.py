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

from typing import Any

# Only these change project state, and each one carries its section IMPLICITLY -- a
# first version read `section`/`op` generically and covered only `research_append`,
# leaving 46 of the captured session's 173 writer calls (27%) uncharacterised. The
# other writers do not take a section argument at all; the tool IS the section.
#
# `research_append` is the exception, and the only one: it is the general writer and
# names its section in the call, so its entry here is a default the input overrides.
#
# A read recorded here would bury the diff it is meant to produce, and an unknown
# tool records nothing rather than guessing at a shape it has never seen.
_WRITERS: dict[str, tuple[str, str]] = {
    # tool                  (section,       default op)
    "research_append":      ("",            "append"),      # names its own section
    "research_log_append":  ("log",         "append"),
    "extraction_append":    ("extractions", "append"),
    "tree_edit":            ("tree",        "edit"),
    "tree_correct":         ("tree",        "correct"),
    "merge_tree_persons":   ("tree",        "merge"),
    "materialize_facts":    ("tree",        "materialize"),
    "project_create":       ("project",     "create"),
}

# Fields that name something a diff should be able to reach back to.
_ID_FIELDS = ("id", "planItemId", "plan_item_id", "assertionId", "personId")


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
        implicit_section, default_op = entry

        ops = tool_input.get("ops")
        if isinstance(ops, list) and ops:
            sections: list[str] = []
            kinds: list[str] = []
            ids: list[str] = []
            for op in ops:
                if not isinstance(op, dict):
                    continue
                if isinstance(op.get("section"), str):
                    sections.append(op["section"])
                if isinstance(op.get("op"), str):
                    kinds.append(op["op"])
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
        op = tool_input.get("op")
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
