"""Reconstruct research.json state at any point in a run, by replaying the
writer-tool calls recorded in a run log's `tool_calls` ledger.

**Why this exists.** Every offline analysis in this repo can see a run's FINAL
state (the committed `run-<ts>.final-research.json` sidecar) and its call
ledger, but nothing can see the state *between* two calls. That blocks several
separate pieces of work at once:

  * "would a gate have refused this write, at the moment it was made?" — a
    precondition can only be judged against the state that preceded it;
  * issue #1569 part 1 — measuring the lane-check narrowing over the corpus;
  * issue #1569 part 2 — its acceptance asks for a replay reporting every run
    whose detector result changes, and records that no such instrument exists
    ("There is no make target for either. Build it once.");
  * issue #1484's `--recompute` — deriving violations from `tool_calls`.

**It replays arguments, not semantics.** This module does NOT reimplement
`research_append`'s validation, id assignment, or place resolution — a Python
copy of those would drift from the TypeScript silently, which is the failure
this repo has hit before. Instead it reads the id the tool *reported* back:
every successful call's response carries `entryId` (single op) or
`results[].entryId` (batch). So the reconstruction is anchored to what the real
tool actually did.

**A rejected call is not a write.** ~12% of writer calls in the corpus return
`{"ok": false}` after failing validation. Those changed nothing on disk and must
not be applied; applying them is how a replay quietly invents state that never
existed.

**Coverage is reported, never assumed.** A replay that silently ignores a writer
tool is worse than no replay, because it looks complete. `ReplayResult.unmodelled`
names every tool and section this module did not know how to apply, so a caller
can decide whether its question survives the gap.

**Its useful horizon is the capture window, and most of the corpus is past it.**
This module reads ids out of each call's `response_summary`, and the e2e capture
strip reclaims that field past 14 days. Until 2026-08-23 the strip dropped it
outright: measured that day, 133 of the 134 stripped runs could no longer be
replayed against 18 of the 23 unstripped ones that could — an 88% -> 13%
collapse in `make replay-check` that looked like a regression here and was not.
The strip now keeps a replay remnant (`scripts/prune_runlogs.py::replay_remnant`),
so it stops getting worse, but **the runs already stripped are not recoverable**.
Anything that needs mid-run state across the whole historical corpus cannot have
it; ask the question over recent runs, or measure how many runs actually carry
the ids before quoting a rate. `make replay-check` reports the current figure.

Stdlib only, and **no `claude_agent_sdk` import** — `corpus_report` states in its
own module docstring that it is pure analysis over committed data, and importing
`e2e.orchestrator` would drag the SDK in. Keep it that way.
"""

from __future__ import annotations

import copy
import json
import re
from dataclasses import dataclass, field
from typing import Any

# The research.json writers. Tree writers are deliberately out of scope for now:
# `tree_edit` / `tree_correct` / `materialize_facts` / `merge_tree_persons` have
# op-shaped semantics this module would have to model rather than read back, and
# no current consumer needs tree state. They are reported as unmodelled.
#
# Since #2472 `research_append` and `extraction_append` also write
# `tree.gedcomx.json` when an assertion `update` corrects a fact's
# place/standard_place/date/value. That happens on the research path, so those
# two stay in this set and the replay reads their research.json effect back
# correctly; the TREE half is not modelled and is reported per-op as
# `tree:<tool>:fact-rewrite`. A partial gap needs its own key rather than the
# whole-tool `tool:<name>` one: the research half really was applied, and
# reporting the call as wholly unmodelled would be the opposite lie.
RESEARCH_WRITERS = frozenset(
    {"research_append", "research_log_append", "extraction_append"}
)

#: The attributes an assertion `update` mirrors onto its materialized tree fact.
#: Mirrors ASSERTION_FACT_ATTRS in materialize-facts.ts. A fifth added there and
#: not here under-reports the gap rather than mis-applying anything.
_MIRRORED_FACT_ATTRS = frozenset({"place", "standard_place", "date", "value"})

# Project-file writers this module does NOT apply. Named explicitly so a run
# containing them reports a coverage gap instead of looking fully replayed.
# Read tools are not listed: they change no state, so counting them would bury
# the real gap in noise.
UNMODELLED_WRITERS = frozenset(
    {
        "tree_edit",
        "tree_correct",
        "tree_forget",
        "materialize_facts",
        "merge_tree_persons",
        "timeline_build",
    }
)

# Sections that live as top-level arrays on research.json. `plan_items` is NOT
# one of them — it is a pseudo-section that nests into `plans[].items` — and
# that asymmetry is exactly what makes the ownership table and the tool
# disagree (see PLAN.md, probe A1).
_SINGLETON_SECTIONS = frozenset({"project", "researcher_profile"})


def bare_tool_name(tool_name: str) -> str:
    """Strip any `mcp__<server>__` prefix. Mirrors context_policy.bare_tool_name."""
    return tool_name.rsplit("__", 1)[-1] if "__" in tool_name else tool_name


# Id prefixes, read from `docs/specs/schemas/research.schema.json` rather than
# invented. Needed because the ledger does NOT record every assigned id — see
# `parse_tool_result` — so ids past the truncation point are reconstructed by
# the tool's own sequential convention, and the acceptance test in
# `tests/unit/test_replay.py` is what validates that the convention holds.
SECTION_ID_PREFIX = {
    "questions": "q_",
    "plans": "pl_",
    "plan_items": "pli_",
    "log": "log_",
    "sources": "src_",
    "assertions": "a_",
    "person_evidence": "pe_",
    "conflicts": "c_",
    "hypotheses": "h_",
    "timelines": "t_",
    "proof_summaries": "ps_",
    "evaluations": "ev_",
    "localities": "loc_",
    "namesakes": "ns_",
    "rejected_links": "rj_",
}

_ID_RE = re.compile(r'"(?:entryId|logId)"\s*:\s*"([^"]+)"')
_URL_RE = re.compile(r'"url"\s*:\s*"([^"]+)"')
_OK_RE = re.compile(r'"ok"\s*:\s*(true|false)')
_FULL_LEN_RE = re.compile(r'"_full_length"\s*:\s*(\d+)')


def parse_tool_result(response_summary: Any) -> dict | None:
    """A normalised `{ok, ids, full_length}` view of the tool's response.

    **Two things about the ledger make a strict JSON parse the wrong tool here**,
    both measured over the corpus rather than assumed:

    1. **Responses are truncated.** 1,629 of ~4,800 writer responses are cut
       mid-JSON, so `json.loads` fails on text that is otherwise perfectly
       well-formed at the front. A regex over the raw text recovers the ids in
       order regardless of where the cut lands.
    2. **Batch results are summarised.** A large batch returns
       `{"results": {"_summary_truncated": true, "_full_length": 11,
       "_first_n": [...3 entries...]}}` — so **the ledger never recorded the
       other 8 ids.** `full_length` is what tells a caller how many ops really
       ran, so the missing ids can be reconstructed by convention instead of
       silently dropped.

    Never raises. `None` means "do not apply", which is the safe direction.
    """
    if response_summary is None:
        return None
    text = (
        response_summary
        if isinstance(response_summary, str)
        else json.dumps(response_summary, default=str)
    )
    # The ledger stores the tool's JSON *inside* a JSON string, so the inner
    # quotes arrive escaped (`\"ok\": true`). Unescaping once lets one set of
    # patterns read both the escaped and the plain form, and — unlike
    # `json.loads` — it survives a response truncated mid-object.
    text = text.replace('\\"', '"').replace("\\n", "\n")
    ok_m = _OK_RE.search(text)
    if ok_m is None:
        return None
    full_m = _FULL_LEN_RE.search(text)
    return {
        "ok": ok_m.group(1) == "true",
        "ids": _ID_RE.findall(text),
        "full_length": int(full_m.group(1)) if full_m else None,
    }


def _section_entries(state: dict, section: str) -> list:
    """The entries an id is allocated against.

    `plan_items` is the exception and the reason this helper exists: there is no
    top-level `plan_items` array, so reading `state["plan_items"]` always found
    nothing and every synthesised item id came out as `pli_001`. The real tool
    allocates from the pool flattened across every plan, so that is what this
    returns.
    """
    if section == "plan_items":
        plans = state.get("plans")
        if not isinstance(plans, list):
            return []
        return [
            item
            for plan in plans
            if isinstance(plan, dict)
            for item in (plan.get("items") or [])
        ]
    arr = state.get(section)
    return arr if isinstance(arr, list) else []


def _next_id(state: dict, section: str) -> str | None:
    """The id the tool would assign next, by its own sequential convention.

    Derived from what is already in the section so it survives a seeded fixture;
    falls back to the schema-declared prefix when the section is empty.
    """
    prefix = SECTION_ID_PREFIX.get(section)
    arr = _section_entries(state, section)
    highest = 0
    if isinstance(arr, list):
        for e in arr:
            eid = e.get("id") if isinstance(e, dict) else None
            if isinstance(eid, str):
                m = re.fullmatch(r"([a-z_]+?_)(\d+)", eid)
                if m:
                    prefix = prefix or m.group(1)
                    if m.group(1) == (prefix or m.group(1)):
                        highest = max(highest, int(m.group(2)))
    if not prefix:
        return None
    return f"{prefix}{highest + 1:03d}"


# `research_log_append`'s input field -> the key the tool persists. The tool
# takes a FLAT op (`{tool, query, outcome, planItemId, …}`), not `research_append`'s
# `{section, op, entry}`, and it renames camelCase to snake_case on the way in.
#
# This is the one place the module maps the tool's semantics rather than reading
# its output back, and it is deliberately narrow: renames only, no validation, no
# defaulting beyond `plan_item_id`. Without it the whole `log` section replayed as
# `[{"id": "log_001"}, …]` — id-shaped shells with no body — while the fidelity
# check compared id sets only and reported a 94-100% match over nothing.
_LOG_FIELD_RENAMES = {
    "planItemId": "plan_item_id",
    "resultsExamined": "results_examined",
    "resultsAvailable": "results_available",
    "externalSite": "external_site",
}
_LOG_EXTERNAL_SITE_RENAMES = {
    "urlGenerated": "url_generated",
    "captureReceived": "capture_received",
    "captureFilename": "capture_filename",
}
# Control keys and tool-derived values that are not part of the entry body.
# `performed` is stamped from the wall clock and `results_ref` from a real
# sidecar write, so neither is reconstructible from arguments — they are left
# ABSENT rather than invented.
_LOG_NON_BODY_KEYS = frozenset(
    {"section", "op", "ops", "projectPath", "entryId", "planId", "stagedResultsRef"}
)


def _log_entry_body(op: dict) -> dict:
    """A `research_log_append` op's flat arguments as the tool's persisted entry."""
    body: dict = {}
    for key, value in op.items():
        if key in _LOG_NON_BODY_KEYS:
            continue
        name = _LOG_FIELD_RENAMES.get(key, key)
        if name == "external_site" and isinstance(value, dict):
            value = {
                _LOG_EXTERNAL_SITE_RENAMES.get(k, k): v for k, v in value.items()
            }
        body[name] = value
    body.setdefault("plan_item_id", None)
    return body


def _ops_from_args(args: dict, tool: str = "") -> list[dict]:
    """Normalise the single-op and batch forms into one list.

    `research_append` accepts either `{section, op, entry}` or `{ops: [...]}`.
    `research_log_append` carries **no** `section` in either form — the tool
    implies `log` — so its ops must have one supplied, in the batch case too.
    Missing that was 582 dropped ops, and it read as "unmodelled" rather than
    as a bug, which is exactly why the coverage counter exists.

    A log op is additionally reshaped: its arguments are flat, so they are lifted
    into an `entry` the generic applier can use. Without that lift every log
    entry replayed as a bare id.
    """
    if tool == "research_log_append":
        raw = (
            [o for o in args["ops"] if isinstance(o, dict)]
            if isinstance(args.get("ops"), list)
            else [args]
        )
        return [
            {"section": "log", "op": "append", "entry": _log_entry_body(o)} for o in raw
        ]
    if isinstance(args.get("ops"), list):
        return [o for o in args["ops"] if isinstance(o, dict)]
    if args.get("section"):
        return [args]
    return [dict(args, section="log")]


def _plan_items_target(state: dict, op: dict) -> dict | None:
    """The plan a `plan_items` op nests into.

    Falls back to the most recently appended plan when `planId` is absent or
    unrecoverable — a batch that creates a plan and its items in one call has
    the plan's id only in the (frequently truncated) response.
    """
    plan_id = op.get("planId") or op.get("plan_id")
    plans = state.get("plans")
    if not isinstance(plans, list) or not plans:
        return None
    if plan_id:
        for plan in plans:
            if plan.get("id") == plan_id:
                return plan
    return plans[-1]


@dataclass
class ReplayResult:
    research: dict
    applied: int = 0
    rejected: int = 0
    unparseable: int = 0
    #: ids the ledger never recorded, reconstructed by the tool's sequential
    #: convention. A high count means the reconstruction leans on that
    #: convention rather than on observed fact — report it, never hide it.
    synthesised_ids: int = 0
    unmodelled: dict[str, int] = field(default_factory=dict)

    def note_unmodelled(self, what: str) -> None:
        self.unmodelled[what] = self.unmodelled.get(what, 0) + 1


def _count_overlapping(text: str, needle: str) -> int:
    count, i = 0, text.find(needle)
    while i != -1:
        count += 1
        i = text.find(needle, i + 1)
    return count


def _expand_edits(state: dict, op: dict, entry_id: str | None) -> dict | None:
    """The fields an accepted `edits` op wrote, or None when the replayed text cannot
    show them. The engine accepted each `old` only where it occurred exactly once, so
    the same count in the replayed text reproduces the write."""
    edits = op.get("edits")
    if isinstance(edits, str):
        try:
            edits = json.loads(edits)
        except ValueError:
            return None
    if op.get("section") != "proof_summaries" or not isinstance(edits, list):
        return None
    target = entry_id or op.get("entryId")
    entry = next(
        (e for e in state.get("proof_summaries") or [] if isinstance(e, dict) and e.get("id") == target),
        None,
    )
    if entry is None:
        return None
    written: dict = {}
    for e in edits:
        if not isinstance(e, dict):
            return None
        field, old, new = e.get("field"), e.get("old"), e.get("new")
        text = written.get(field, entry.get(field))
        if not (isinstance(text, str) and isinstance(old, str) and old and isinstance(new, str)):
            return None
        if _count_overlapping(text, old) != 1:
            return None
        i = text.index(old)
        written[field] = text[:i] + new + text[i + len(old):]
    return written


def _apply_op(state: dict, op: dict, entry_id: str | None, out: ReplayResult) -> None:
    section = op.get("section")
    verb = op.get("op") or "append"
    # research_append expands `edits` into `fields`. Where the replayed text cannot
    # reproduce the expansion, report it rather than replay the field as unchanged;
    # with no `fields` beside it there is then nothing applied.
    if op.get("edits"):
        written = _expand_edits(state, op, entry_id)
        if written is None:
            out.note_unmodelled(f"{section}:edits")
            if not isinstance(op.get("fields"), dict):
                return
        else:
            fields = op.get("fields") if isinstance(op.get("fields"), dict) else {}
            op = {**op, "fields": {**fields, **written}}
    entry = op.get("entry")
    if not isinstance(entry, dict):
        entry = op.get("fields") if isinstance(op.get("fields"), dict) else {}

    if section in _SINGLETON_SECTIONS:
        target = state.setdefault(section, {})
        if isinstance(target, dict):
            target.update(entry)
            out.applied += 1
        else:
            out.note_unmodelled(f"singleton:{section}")
        return

    if section == "plan_items":
        plan = _plan_items_target(state, op)
        if plan is None:
            out.note_unmodelled("plan_items:no-plan-exists")
            return
        items = plan.setdefault("items", [])
        if verb == "append":
            items.append({**entry, "id": entry_id} if entry_id else dict(entry))
        else:
            target = entry_id or op.get("entryId") or op.get("id")
            # Same fix as the generic section path below, and this one bites
            # hardest: plan-item status flips are the op most often batched.
            for it in items:
                if it.get("id") == target:
                    it.update(entry)
                    break
            else:
                # Counting a miss as applied is the same dishonest-count class
                # the `entryId` fix above removes: the generic path reports it,
                # this one silently inflated `applied` and reported nothing.
                out.note_unmodelled("update:no-such-id:plan_items")
                return
        out.applied += 1
        return

    if not section:
        out.note_unmodelled("op:no-section")
        return

    arr = state.setdefault(section, [])
    if not isinstance(arr, list):
        out.note_unmodelled(f"section-not-a-list:{section}")
        return

    if verb == "append":
        arr.append({**entry, "id": entry_id} if entry_id else dict(entry))
        out.applied += 1
        return

    # `op["entryId"]` is the caller's own target, and for an UPDATE it is the
    # authoritative one — the response merely echoes it back. Consulting it
    # matters whenever the ledger did not report an id for this op, which is not
    # an edge case: a summarised batch records only `_first_n` entries, so every
    # UPDATE past that cut arrived here with `entry_id = None`, fell through to
    # `id` (which an update payload does not carry), and was dropped as
    # `no-such-id` — silently, and while naming its target in plain sight.
    target_id = entry_id or op.get("entryId") or op.get("id") or entry.get("id")
    for existing in arr:
        if existing.get("id") == target_id:
            existing.update(entry)
            out.applied += 1
            return
    out.note_unmodelled(f"update:no-such-id:{section}")


def _builder_hand_off(entry: dict) -> tuple[dict, str] | None:
    """The log op a `build_external_search_url` call wrote, with its id.

    The builder writes only when called with a `projectPath`, and then exactly
    one entry: the in-flight `external_site` hand-off. Applied only when the
    ledger kept both the returned `logId` and `url` — never with a synthesised
    id, because the 155 committed calls that carried no projectPath wrote
    nothing, and inventing an entry for each would be the opposite lie.
    """
    args = entry.get("args") if isinstance(entry.get("args"), dict) else {}
    if not args.get("projectPath") or entry.get("is_error"):
        return None
    result = parse_tool_result(entry.get("response_summary"))
    if result is None or result.get("ok") is not True or not result.get("ids"):
        return None
    summary = entry.get("response_summary")
    text = summary if isinstance(summary, str) else json.dumps(summary, default=str)
    url_m = _URL_RE.search(text.replace('\\"', '"'))
    if url_m is None:
        return None
    attributes = args.get("attributes")
    body = {
        "plan_item_id": args.get("planItemId"),
        "tool": "external_site",
        "query": dict(attributes) if isinstance(attributes, dict) else {},
        "outcome": "partial",
        "results_examined": 0,
        "external_site": {
            "site": args.get("site"),
            "url_generated": url_m.group(1),
            "capture_received": False,
        },
        "results_ref": None,
    }
    return {"section": "log", "op": "append", "entry": body}, result["ids"][0]


_LOG_ID_RE = re.compile(r'"logId"\s*:\s*"([^"]+)"')


def _is_staged_extraction(name: str, args: dict) -> bool:
    """`extraction_append` in its record-id form (#3312): the arguments name the
    records and the tool writes their source, log entry and assertions itself,
    so nothing the replay needs is in the arguments."""
    return (
        name == "extraction_append"
        and ("recordIds" in args or "documents" in args)
        and not args.get("ops")
        and not args.get("section")
    )


def _apply_staged_extraction(
    entry: dict, final_research: dict | None, out: ReplayResult
) -> None:
    """Apply a record-id `extraction_append` from the run's final notes.

    The call's response reports one `logId` per record, and everything the tool
    wrote for that record carries it: the log entry's own id, and
    `log_entry_id` on the source and on every assertion. So the entries are read
    back from the final notes by the id the tool reported, which is the same
    anchor the rest of this module uses. Without the final notes the call is
    reported, never guessed at: the generic path would append one empty log
    entry and none of the assertions.
    """
    summary = entry.get("response_summary")
    text = summary if isinstance(summary, str) else json.dumps(summary, default=str)
    log_ids = list(dict.fromkeys(_LOG_ID_RE.findall(text.replace('\\"', '"'))))
    if final_research and "_summary_truncated" in text:
        log_ids += _log_ids_cut_from_summary(entry, text, final_research, out.research, log_ids)
    if not final_research or not log_ids:
        out.note_unmodelled("tool:extraction_append:record-ids")
        return
    state = out.research
    for log_id in log_ids:
        found = False
        for section, key in (("log", "id"), ("sources", "log_entry_id"), ("assertions", "log_entry_id")):
            arr = state.setdefault(section, [])
            have = {e.get("id") for e in arr if isinstance(e, dict)}
            for e in final_research.get(section) or []:
                if isinstance(e, dict) and e.get(key) == log_id:
                    found = True
                    if e.get("id") not in have:
                        arr.append(copy.deepcopy(e))
                        out.applied += 1
        if not found:
            out.note_unmodelled("extraction_append:not-in-final")


def _record_key(record_id) -> str:
    return str(record_id or "").split("1:1:")[-1].split("?")[0].strip().strip("/").upper()


def _log_ids_cut_from_summary(
    entry: dict, text: str, final_research: dict, state: dict, seen: list[str]
) -> list[str]:
    """Log ids for the records a truncated summary cut off.

    The capture keeps only the first few records of a long `extraction_append`
    answer (`_summary_truncated`), so their `logId`s never reach the replay and
    everything those records wrote is missing from the replayed notes. The call's
    own `recordIds` are never cut: each one not visible in the summary is matched
    to the earliest log entry in the final notes whose `query.recordId` names it
    and that neither the summary nor the replay already accounts for -- the entry
    this call wrote, since the replay applies calls in order. The cut can fall
    inside a record, after its `recordId` and before its `logId`, so being named in
    the summary is not enough; a record the summary shows with a status other than
    `extracted` wrote nothing and is never back-filled.
    """
    args = entry.get("args") or {}
    asked = args.get("recordIds")
    if isinstance(asked, str):
        try:
            asked = json.loads(asked)
        except ValueError:
            asked = [asked]
    if not isinstance(asked, list):
        return []
    seen_entries = {e.get("id"): e for e in final_research.get("log") or [] if isinstance(e, dict)}
    accounted = {_record_key((seen_entries.get(i) or {}).get("query", {}).get("recordId")) for i in seen}
    # A record the summary shows as not extracted wrote no log entry; any entry
    # for it in the final notes belongs to a later call.
    unwritten = {
        _record_key(rid)
        for rid, status in re.findall(
            r'recordId\\?"\s*:\s*\\?"([^"\\]+)\\?"\s*,\s*\\?"status\\?"\s*:\s*\\?"([^"\\]+)', text)
        if status != "extracted"
    }
    applied = {e.get("id") for e in state.get("log") or [] if isinstance(e, dict)} | set(seen)
    out: list[str] = []
    for record in asked:
        key = _record_key(record)
        if not key or key in unwritten or key in accounted:
            continue
        for e in final_research.get("log") or []:
            if not isinstance(e, dict) or e.get("id") in applied or e.get("id") in out:
                continue
            query = e.get("query") or {}
            if _record_key(query.get("recordId")) == key:
                out.append(e["id"])
                break
    return out


def replay(
    tool_calls: list[dict],
    starting_research: dict | None = None,
    upto: int | None = None,
    final_research: dict | None = None,
) -> ReplayResult:
    """Reconstruct research.json after the first `upto` ledger entries.

    `upto=None` replays the whole run. `upto=i` yields the state the i-th call
    would have SEEN — i.e. entries `[0, i)` applied — which is what a
    precondition check needs.

    `final_research` is the run's committed final notes. It is read only for a
    record-id `extraction_append` (`_apply_staged_extraction`); without it that
    call is reported as unmodelled. A caller that measures the replay AGAINST
    the final notes must not pass them, or it is comparing them with themselves.
    """
    out = ReplayResult(research=copy.deepcopy(starting_research or {}))
    for entry in tool_calls[: upto if upto is not None else len(tool_calls)]:
        if not isinstance(entry, dict):
            continue
        name = bare_tool_name(str(entry.get("tool") or ""))
        # Its own branch, ahead of the generic writer path: that path would turn
        # the builder's arguments into the entry and synthesise an id for every
        # call, including the ones that wrote nothing.
        if name == "build_external_search_url":
            hand_off = _builder_hand_off(entry)
            if hand_off is not None:
                _apply_op(out.research, hand_off[0], hand_off[1], out)
            continue
        if name not in RESEARCH_WRITERS:
            # Report it. The module docstring promises `unmodelled` names every
            # tool this replay could not apply, and `check_replay_fidelity`
            # prints it as "the coverage gap, reported rather than hidden" — but
            # a bare `continue` hid exactly the tree writers the constant above
            # says are reported. A silent skip is the failure mode the counter
            # exists to prevent, so it must not be the counter's own behaviour.
            if name in UNMODELLED_WRITERS:
                out.note_unmodelled(f"tool:{name}")
            continue
        if entry.get("is_error"):
            out.rejected += 1
            continue
        result = parse_tool_result(entry.get("response_summary"))
        if result is None:
            out.unparseable += 1
            continue
        if result.get("ok") is False:
            out.rejected += 1
            continue

        args = entry.get("args") if isinstance(entry.get("args"), dict) else {}
        # extraction_append({ personId }) extracts and links a person's attached
        # records, none of which its arguments carry. Reported, never applied:
        # the generic path below would read it as one log entry.
        if name == "extraction_append" and "personId" in args and not args.get("recordIds"):
            out.note_unmodelled("extraction_append:person-links")
            continue
        if _is_staged_extraction(name, args):
            _apply_staged_extraction(entry, final_research, out)
            # What the replay applies is each record's source, log entry and
            # assertions. A question tie on a re-found record and a plan-item
            # completion are written too, and neither is in the arguments.
            if args.get("questionIds"):
                out.note_unmodelled("extraction_append:question-tie")
            # `parse_tool_result` keeps only ok and ids from a summary the
            # ledger may have truncated, so the marker is read off the raw text.
            if '"planItems"' in str(entry.get("response_summary") or ""):
                out.note_unmodelled("extraction_append:plan-items")
            continue
        ops = _ops_from_args(args, name)
        ids = result.get("ids") or []
        for i, op in enumerate(ops):
            # The id the tool reported, when the ledger kept it; otherwise the
            # id the tool's own sequential convention would have produced. The
            # second case is not a guess we are free to make — it is validated
            # by replaying 154 committed runs and comparing against their
            # final-state sidecars.
            entry_id = ids[i] if i < len(ids) else None
            if entry_id is None:
                section = op.get("section") or ("log" if not op.get("ops") else None)
                if section and op.get("op", "append") == "append":
                    entry_id = _next_id(out.research, section)
                    if entry_id is not None:
                        out.synthesised_ids += 1
            # A re-sent staged ref that was already logged answers with the
            # existing entry's id and writes nothing, so an id the log already
            # holds is not a second append.
            if (
                name == "research_log_append"
                and entry_id is not None
                and any(e.get("id") == entry_id for e in out.research.get("log") or [] if isinstance(e, dict))
            ):
                continue
            _apply_op(out.research, op, entry_id, out)
            # An assertion `update` touching a mirrored attribute ALSO rewrites
            # the tree fact minted from it (#2472). The research half is applied
            # above; the tree half is not modelled, so report it rather than let
            # a consumer read a pre-call tree as current. Reported on the op's
            # SHAPE, not on whether a fact was really rewritten: the replay
            # cannot see the tree, and `unmodelled` means "this call may have
            # done something I did not apply", which is exactly the claim.
            #
            # Its own blind spot, inherited from `_ops_from_args`: a JSON-STRING
            # `ops` payload (which the engine coerces, so the write lands) parses
            # as a log op here and never reaches this branch. That is a
            # pre-existing gap in the parser rather than in this report, and it
            # under-reports rather than over-reports.
            if (
                op.get("section") == "assertions"
                and op.get("op") == "update"
                and isinstance(op.get("fields"), dict)
                and _MIRRORED_FACT_ATTRS & set(op["fields"])
            ):
                out.note_unmodelled(f"tree:{name}:fact-rewrite")
    return out
