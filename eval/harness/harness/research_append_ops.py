"""The ops one `research_append` call writes, in canonical form.

`research_append` accepts an op's payload beside `section`/`op` (a flat op) and a
new plan as `plan` + `planItems` (the plan form), and converts both into its
canonical batch before reading the call (`src/tools/research-append-forms.ts`).
Every harness reader of a call's input reads it through this function, so a
validator, a guardrail report and the replay all see what the tool wrote. The
plugin hook (`guard_project_files.py`, `_ops`) and the beta worker
(`apps/server/proto/worker/writer_record.py`) carry their own copies; change
them together.
"""

from __future__ import annotations

import json
from typing import Any

# The keys a canonical op carries, and the call's own arguments, which stay
# unread on an op. Every other key on an op is its payload. Not `verdict`: it is
# also a field of `hit_verdicts` and `evaluations` entries.
OP_KEYS = frozenset(
    {"section", "op", "entry", "entryId", "fields", "edits", "guideSection", "surveyRef", "planId",
     "projectPath", "resolveStandardPlace", "sourceDescription"}
)


def _json_or_none(value: Any) -> Any:
    if isinstance(value, str):
        try:
            return json.loads(value)
        except (ValueError, TypeError):
            return None
    return value


def canonical_op(op: dict) -> dict:
    """`op` with any payload beside `section`/`op` moved under `entry` (append)
    or `fields` (update). A payload sent both ways is merged, so nothing the
    call carried is missed."""
    wrapper = {"append": "entry", "update": "fields"}.get(op.get("op"))
    loose = {k: v for k, v in op.items() if k not in OP_KEYS}
    if not wrapper or not loose:
        return op
    present = _json_or_none(op.get(wrapper))
    out = {k: v for k, v in op.items() if k in OP_KEYS}
    out[wrapper] = {**present, **loose} if isinstance(present, dict) else loose
    return out


def is_plan_form(args: dict) -> bool:
    return "plan" in args or "planItems" in args


def plan_form_ops(args: dict) -> list[dict]:
    """The plan form as the batch the tool writes: the `plans` append, then one
    `plan_items` append per item."""
    plan, items = _json_or_none(args.get("plan")), _json_or_none(args.get("planItems"))
    ops: list[dict] = [{"section": "plans", "op": "append", "entry": plan if isinstance(plan, dict) else {}}]
    ops += [
        {"section": "plan_items", "op": "append", "entry": item}
        for item in (items if isinstance(items, list) else [])
        if isinstance(item, dict)
    ]
    return ops


def research_append_ops(args: Any) -> list[dict]:
    """Every op one `research_append` call writes, from any shape the model sends:
    a batch `ops` (a list or a JSON string), the plan form, or one top-level op."""
    args = _json_or_none(args)
    if not isinstance(args, dict):
        return []
    if is_plan_form(args):
        return plan_form_ops(args)
    raw = _json_or_none(args.get("ops"))
    if not isinstance(raw, list):
        return [args] if args.get("section") else []
    return [canonical_op(op) for op in raw if isinstance(op, dict)]
