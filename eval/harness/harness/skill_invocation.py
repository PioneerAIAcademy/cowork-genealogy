"""Guardrail-skill invocation detection.

docs/specs/guardrail-enforcement-spec.md §7/§8 — autonomous `/research`
sometimes lets the four GPS guardrail skills (`research-exhaustiveness`,
`proof-conclusion`, `person-evidence`, `conflict-resolution`) get bypassed:
their documented effect lands in the project files without the skill ever
having been successfully invoked. This module is pure matching logic, no I/O,
over the harness's own `tool_calls` list shape
(`{"tool": ..., "args": ..., "response_summary": ..., "is_error": ...,
"agent_id": ..., "agent_type": ...}`, built by `e2e/orchestrator.py`'s
message loop and `pretool_hook` — the last two are `None`/absent on a
main-thread call and only meaningful once spec §11's ledger-attribution lands;
older runlogs simply lack the keys) plus the project's persisted
`research.json`/`tree.gedcomx.json`.

Three consumers, all described in the plan:
  - `owning_skills` + `recently_succeeded` — the live, shadow-mode caller-id
    check (§4.1): before a protected write is allowed to proceed, was its
    owning skill successfully invoked recently?
  - `find_effects_without_invocation` — the post-run hard detector (§8):
    does the FINAL project state show a guardrail skill's effect with no
    matching successful invocation anywhere in the whole run?
  - `find_protected_writes_by_unnamed_delegate` — the post-run shadow-mode
    detector (spec §11): does a protected write's own `agent_id`/`agent_type`
    show it was made by neither the main thread nor a dedicated agent?
"""

from __future__ import annotations

import re
from typing import Any

from harness.context_policy import bare_tool_name

GUARDRAIL_SKILLS = (
    "research-exhaustiveness",
    "proof-conclusion",
    "person-evidence",
    "conflict-resolution",
)

_QUESTION_ID_RE = re.compile(r"\bq_\d+\b")


def skill_name_if_skill_call(tool: str, args: dict[str, Any] | None) -> str | None:
    """The skill name if this tool call is a `Skill` invocation, else None.

    Matches the shape observed in committed runlogs and the SDK's own
    `Skill` tool: `{"tool": "Skill", "args": {"skill": "<name>", ...}}`.
    """
    if tool != "Skill":
        return None
    name = (args or {}).get("skill")
    return name if isinstance(name, str) and name else None


def _iter_ops(args: dict[str, Any]) -> list[dict[str, Any]]:
    """Normalize a tool call's single-op vs batch-op (`ops: [...]`) form."""
    ops = args.get("ops")
    if isinstance(ops, list):
        return [op for op in ops if isinstance(op, dict)]
    return [args]


def _question_id_from_skill_call(args: dict[str, Any] | None) -> str | None:
    """Best-effort question id from a `Skill` call's free-text `args` string
    (e.g. `"--autonomous q_001 projectPath=..."`, the shape observed in
    committed runlogs). Returns None when not derivable — callers must treat
    that as "unknown," not "no question," and fall back to a skill-only
    window (see docs/specs/guardrail-enforcement-spec.md §7/§10)."""
    text = (args or {}).get("args")
    if not isinstance(text, str):
        return None
    m = _QUESTION_ID_RE.search(text)
    return m.group(0) if m else None


def _question_id_from_op(op: dict[str, Any]) -> str | None:
    """Best-effort question id a protected-write op references."""
    v = op.get("question_id")
    if isinstance(v, str):
        return v
    entry = op.get("entry")
    if isinstance(entry, dict) and isinstance(entry.get("question_id"), str):
        return entry["question_id"]
    fields = op.get("fields")
    if isinstance(fields, dict) and isinstance(fields.get("question_id"), str):
        return fields["question_id"]
    if op.get("section") == "questions" and isinstance(op.get("entryId"), str):
        return op["entryId"]
    return None


def owning_skills(tool: str, args: dict[str, Any] | None) -> list[str]:
    """Which guardrail skill(s), if any, own this write.

    Covers both `research.json` fields and the `tree.gedcomx.json` writes the
    adversarial review added (§8): `materialize_facts` minting a brand-new
    tree person with no `person_evidence` entry required is a live
    identity-bypass route distinct from the `person_evidence` section itself,
    and `proof-conclusion`'s documented output includes the tree-encoding
    writes (`primary: true`, a `ParentChild`/`Couple` relationship), not just
    the `proof_summaries` entry. Returns a list (not a single value) since one
    batch call can touch more than one protected section — the caller decides
    how to key each; see docs/specs/guardrail-enforcement-spec.md §10 on
    batch semantics not being exhaustively audited beyond the one TOCTOU case
    found in §4.2.
    """
    args = args or {}
    bare = bare_tool_name(tool)
    owners: list[str] = []

    if bare == "research_append":
        for op in _iter_ops(args):
            section = op.get("section")
            if section == "proof_summaries":
                owners.append("proof-conclusion")
            elif section == "person_evidence":
                owners.append("person-evidence")
            elif section == "conflicts":
                owners.append("conflict-resolution")
            elif section == "questions":
                fields = op.get("fields") if isinstance(op.get("fields"), dict) else op.get("entry")
                ed = (fields or {}).get("exhaustive_declaration") if isinstance(fields, dict) else None
                if isinstance(ed, dict) and ed.get("declared") is True:
                    owners.append("research-exhaustiveness")
    elif bare == "materialize_facts":
        for op in _iter_ops(args):
            if not op.get("personId"):
                owners.append("person-evidence")  # mints a brand-new tree person
    elif bare in ("tree_edit", "tree_correct"):
        for op in _iter_ops(args):
            rel = op.get("relationship")
            if isinstance(rel, dict) and rel.get("type") in ("ParentChild", "Couple"):
                owners.append("proof-conclusion")
            fact = op.get("fact")
            if isinstance(fact, dict) and fact.get("primary") is True:
                owners.append("proof-conclusion")

    # De-dup, preserve first-seen order.
    seen: set[str] = set()
    deduped: list[str] = []
    for o in owners:
        if o not in seen:
            seen.add(o)
            deduped.append(o)
    return deduped


def recently_succeeded(
    skill: str,
    tool_calls: list[dict[str, Any]],
    *,
    before_index: int,
    window: int,
    question_id: str | None = None,
) -> bool:
    """Was `skill` successfully invoked within `window` calls before
    `before_index`? When `question_id` is given AND a candidate `Skill` call's
    own question id is derivable, they must match; when either side's
    question id can't be derived, falls back to a skill-only match (the
    "generous, not per-question-airtight" behavior documented in the plan)."""
    lo = max(0, before_index - window)
    for i in range(lo, before_index):
        entry = tool_calls[i]
        if entry.get("is_error") is True:
            continue
        name = skill_name_if_skill_call(entry.get("tool", ""), entry.get("args"))
        if name != skill:
            continue
        if question_id is None:
            return True
        candidate_q = _question_id_from_skill_call(entry.get("args"))
        if candidate_q is None or candidate_q == question_id:
            return True
    return False


def find_unguarded_protected_writes(
    tool_calls: list[dict[str, Any]],
    *,
    window: int,
) -> list[dict[str, Any]]:
    """Shadow-mode scan (§4.1): every protected write with no matching
    successful skill invocation in its trailing window. Returns violation
    records (never denies anything itself — that's the caller's call, and the
    plan mandates shadow mode — log, don't deny — until the false-positive
    rate is measured)."""
    violations: list[dict[str, Any]] = []
    for i, entry in enumerate(tool_calls):
        if entry.get("is_error") is True:
            continue
        tool = entry.get("tool", "")
        args = entry.get("args") or {}
        owners = owning_skills(tool, args)
        if not owners:
            continue
        qid = None
        for op in _iter_ops(args):
            qid = _question_id_from_op(op)
            if qid:
                break
        for owner in owners:
            if not recently_succeeded(owner, tool_calls, before_index=i, window=window, question_id=qid):
                violations.append(
                    {
                        "index": i,
                        "tool": tool,
                        "required_skill": owner,
                        "question_id": qid,
                    }
                )
    return violations


# The four optional `conflict` fields that are conflict-resolution's analytical
# PRODUCT rather than the mere record that a conflict exists. Several skills
# legitimately open a conflicts entry — person-evidence (#738's mandatory entry
# when identity rests on one uncorroborated read), proof-conclusion,
# question-selection, research-plan, timeline, init-project — but they write only
# the schema's required fields (id / conflict_type / description /
# competing_assertion_ids / status / blocks_question_ids). These four are
# optional in `research.schema.json` and, across the whole plugin, are written
# ONLY by `conflict-resolution/SKILL.md` and by `research/SKILL.md` — i.e. the
# orchestrator that is supposed to *delegate* to it. So their presence is the
# effect, and their absence is why "a conflict was recorded" alone must not fire.
CONFLICT_ANALYSIS_FIELDS = (
    "independence_analysis",
    "weighing_analysis",
    "preferred_assertion_id",
    "resolution_rationale",
)


def _is_conflict_resolution_product(conflict: Any) -> bool:
    """Whether a `conflicts[]` entry carries conflict-resolution's own output.

    Two independent signals, either sufficient:

    - any of `CONFLICT_ANALYSIS_FIELDS` populated (non-empty, non-null), or
    - `status == "resolved"` — resolving is the skill's job whatever fields it
      left behind.

    Checking status ALONE (the original rule) under-fires: `unresolved` is a
    legitimate *outcome* of a full weighing — the skill ran, analysed, and
    concluded the conflict stands. The `eulogia-gatica-burial` run
    (run-2026-07-28_17-07-48) is the live case: the router wrote c_001 with a
    full `independence_analysis` and `weighing_analysis`, never invoked
    conflict-resolution, and slipped past the status check because it left the
    conflict `unresolved` — then stamped the proof `proved` over it.
    """
    if not isinstance(conflict, dict):
        return False
    if conflict.get("status") == "resolved":
        return True
    return any(conflict.get(f) for f in CONFLICT_ANALYSIS_FIELDS)


def find_effects_without_invocation(
    tool_calls: list[dict[str, Any]],
    research: dict[str, Any] | None,
    tree: dict[str, Any] | None,
    *,
    starting_tree: dict[str, Any] | None = None,
) -> list[str]:
    """Post-run hard detector (§8): a guardrail skill's documented effect is
    present in the FINAL project state, but the skill was never successfully
    invoked anywhere in the run. Mirrors the unit harness's
    `test_positive_fails_when_skill_not_in_skills_invoked`, extended to cover
    both project files and to run over a whole e2e run rather than one
    isolated skill call.

    `starting_tree`, when given, lets the person-evidence check ignore
    persons that already had facts/names before this run began (a seeded
    fixture's starting tree) and flag only NEW persons or persons that GAINED
    facts this run — without it, every already-linked-by-nothing seed person
    would read as a violation. Best-effort and may over-flag when omitted.

    Each arm keys on a *product* of the skill, never on the skill's mere
    footprint — see `_is_conflict_resolution_product` for why the
    conflict-resolution arm cannot key on `status` alone.
    """
    research = research or {}
    tree = tree or {}
    violations: list[str] = []

    invoked: set[str] = set()
    for entry in tool_calls:
        if entry.get("is_error") is True:
            continue
        name = skill_name_if_skill_call(entry.get("tool", ""), entry.get("args"))
        if name:
            invoked.add(name)

    questions = research.get("questions") if isinstance(research.get("questions"), list) else []
    if any(
        isinstance(q, dict) and (q.get("exhaustive_declaration") or {}).get("declared") is True
        for q in questions
    ) and "research-exhaustiveness" not in invoked:
        violations.append(
            "research.json has a question with exhaustive_declaration.declared=true "
            "but 'research-exhaustiveness' was never successfully invoked in this run"
        )

    proof_summaries = research.get("proof_summaries") if isinstance(research.get("proof_summaries"), list) else []
    persons = tree.get("persons") if isinstance(tree.get("persons"), list) else []
    relationships = tree.get("relationships") if isinstance(tree.get("relationships"), list) else []
    has_primary_fact = any(
        isinstance(p, dict) and any(isinstance(f, dict) and f.get("primary") is True for f in (p.get("facts") or []))
        for p in persons
        if isinstance(p, dict)
    )
    has_conclusion_relationship = any(
        isinstance(r, dict) and r.get("type") in ("ParentChild", "Couple") for r in relationships
    )
    if (
        (len(proof_summaries) > 0 or has_primary_fact or has_conclusion_relationship)
        and "proof-conclusion" not in invoked
    ):
        violations.append(
            "research.json/tree.gedcomx.json shows a proof_summaries entry and/or an encoded "
            "conclusion (a primary fact, or a ParentChild/Couple relationship) but "
            "'proof-conclusion' was never successfully invoked in this run"
        )

    person_evidence = research.get("person_evidence") if isinstance(research.get("person_evidence"), list) else []
    linked_person_ids = {pe.get("person_id") for pe in person_evidence if isinstance(pe, dict)}
    starting_persons = (starting_tree or {}).get("persons") if isinstance((starting_tree or {}).get("persons"), list) else []
    starting_ids = {p.get("id") for p in starting_persons if isinstance(p, dict)}
    starting_fact_counts = {p.get("id"): len(p.get("facts") or []) for p in starting_persons if isinstance(p, dict)}

    def _has_content(p: dict[str, Any]) -> bool:
        return bool(p.get("facts") or p.get("names"))

    def _is_new_content_this_run(p: dict[str, Any]) -> bool:
        if starting_tree is None:
            return True  # no baseline available; best-effort per the docstring
        pid = p.get("id")
        if pid not in starting_ids:
            return True  # brand-new person this run
        return len(p.get("facts") or []) > starting_fact_counts.get(pid, 0)

    unlinked = [
        p
        for p in persons
        if isinstance(p, dict) and _has_content(p) and _is_new_content_this_run(p) and p.get("id") not in linked_person_ids
    ]
    if unlinked and "person-evidence" not in invoked:
        violations.append(
            f"tree.gedcomx.json has {len(unlinked)} person(s) with new facts/names this run and no "
            "person_evidence entry linking them (e.g. materialize_facts minting a person directly) "
            "but 'person-evidence' was never successfully invoked in this run"
        )

    conflicts = research.get("conflicts") if isinstance(research.get("conflicts"), list) else []
    if any(_is_conflict_resolution_product(c) for c in conflicts) and (
        "conflict-resolution" not in invoked
    ):
        violations.append(
            "research.json has a conflict carrying conflict-resolution's analytical product "
            f"({', '.join(CONFLICT_ANALYSIS_FIELDS)}, or status='resolved') but "
            "'conflict-resolution' was never successfully invoked in this run"
        )

    return violations


def find_missing_mentor_verdicts(research: dict[str, Any] | None) -> list[str]:
    """Every `ps_id` a resolved question references must carry a matching
    `evaluations[]` entry (`focus: "proof-critique"`, `target_id: <ps_id>`) —
    research/SKILL.md's own final completion check, and per docs/plan/
    guardrail-enforcement-spec.md §8/§10, this gate is itself just
    another routing-table step the orchestrator could silently skip under the
    same context pressure as the four guardrail skills.

    Deliberately reads `research.json`'s `evaluations[]` directly rather than
    inferring from `tool_calls` — the durable record of whether the gate ran
    IS the evaluations entry (`gps-mentor` writes only there, per the schema
    spec's "append-only ownership"), so there's no invocation-log inference
    needed here the way there is for the four in-session guardrail skills.
    """
    research = research or {}
    questions = research.get("questions") if isinstance(research.get("questions"), list) else []
    proof_summaries = research.get("proof_summaries") if isinstance(research.get("proof_summaries"), list) else []
    evaluations = research.get("evaluations") if isinstance(research.get("evaluations"), list) else []

    resolved_question_ids = {
        q.get("id") for q in questions if isinstance(q, dict) and q.get("status") == "resolved"
    }
    referenced_ps_ids = {
        ps.get("id")
        for ps in proof_summaries
        if isinstance(ps, dict) and ps.get("question_id") in resolved_question_ids
    }
    verdicted_ps_ids = {
        ev.get("target_id")
        for ev in evaluations
        if isinstance(ev, dict) and ev.get("focus") == "proof-critique"
    }
    missing = sorted(pid for pid in (referenced_ps_ids - verdicted_ps_ids) if pid)
    return [
        f"proof_summaries entry '{ps_id}' is referenced by a resolved question but has no "
        "'proof-critique' evaluations[] verdict on record (the mandatory gps-mentor gate)"
        for ps_id in missing
    ]


def same_person_scored_ids(tool_calls: list[dict[str, Any]]) -> set[str]:
    """Every record/tree id a SUCCESSFUL `same_person` call has scored so far
    (its `primaryId1`/`primaryId2` args). When one side of a call is the tree,
    that side's `primaryId` equals the tree `person_id` (see
    `find_person_evidence_missing_same_person` for the confirmed-live basis of
    that equality), so this doubles as "which tree persons have been scored."
    Errored calls don't count — the plan's success-gating (§4.1).

    Ids are strings throughout: FamilySearch persona/tree ids (`primaryId1/2`
    and `person_evidence.person_id`) are always string identifiers. The
    `isinstance(v, str)` guard deliberately ignores any non-string value rather
    than coercing it — a numeric or structured `primaryId` would be a malformed
    call, and silently `str()`-ing it could fabricate a match against a
    stringified `person_id`. Same string-only assumption in
    `_person_id_from_pe_op` and `unguarded_new_person_evidence_links`."""
    scored: set[str] = set()
    for entry in tool_calls:
        if entry.get("is_error") is True:
            continue
        if bare_tool_name(entry.get("tool", "")) != "same_person":
            continue
        args = entry.get("args") or {}
        for key in ("primaryId1", "primaryId2"):
            v = args.get(key)
            if isinstance(v, str):
                scored.add(v)
    return scored


def _person_id_from_pe_op(op: dict[str, Any]) -> str | None:
    """The tree `person_id` a `person_evidence` append op links. The shape in
    committed runlogs is `{section: 'person_evidence', op: 'append',
    entry: {person_id: ...}}`; also tolerate a `fields`/flat shape."""
    for container in ("entry", "fields"):
        c = op.get(container)
        if isinstance(c, dict) and isinstance(c.get("person_id"), str):
            return c["person_id"]
    return op.get("person_id") if isinstance(op.get("person_id"), str) else None


def unguarded_new_person_evidence_links(
    tool: str,
    args: dict[str, Any] | None,
    *,
    scored_ids: set[str],
    starting_ids: set[str],
) -> list[str]:
    """Pre-write check (issue #963, plan §4.1/§9): the NEW tree person id(s)
    this pending `research_append` would link via `person_evidence` that have
    NOT been scored by `same_person` yet. Empty => allow the write.

    Scoped exactly like `find_person_evidence_missing_same_person`, so the
    deny fires only where that post-run hard-fail already would — no NEW
    false-positive class:
    - a person id already in the starting (seed) tree is never flagged
      (linking an assertion to a pre-existing person isn't a new identity);
    - a person id already scored by a prior successful `same_person` passes.

    Fact-based, no proximity window (unlike `find_unguarded_protected_writes`)
    — `same_person` is a required tool call, so "was it called for this
    person" is a fact, which is why the plan (§9) never gave it a shadow
    period. Returns ids in first-seen order, de-duped.

    Keying the check on `research_append` is sound because it is the SOLE tool
    that creates `person_evidence` entries: `extraction_append` explicitly does
    not (see its tool header, "Identity links (`person_evidence`) are NOT
    written here"), and the merge/`tree_forget` tools only re-point or count
    existing entries. If a future tool starts creating `person_evidence` links,
    this gate (and the caller's `bare == "research_append"` fast-path) must be
    widened to cover it, or that tool becomes a bypass route."""
    args = args or {}
    if bare_tool_name(tool) != "research_append":
        return []
    out: list[str] = []
    seen: set[str] = set()
    for op in _iter_ops(args):
        if op.get("section") != "person_evidence":
            continue
        pid = _person_id_from_pe_op(op)
        if not pid or pid in starting_ids or pid in scored_ids or pid in seen:
            continue
        seen.add(pid)
        out.append(pid)
    return out


def find_person_evidence_missing_same_person(
    tool_calls: list[dict[str, Any]],
    research: dict[str, Any] | None,
    tree: dict[str, Any] | None,
    *,
    starting_tree: dict[str, Any] | None = None,
) -> list[str]:
    """Every BRAND-NEW tree person (not present in `starting_tree`) that
    receives a `person_evidence` link must have been the subject of at least
    one `same_person` call somewhere in the run — research/SKILL.md's own
    doctrine ("scores every cross-record link with `same_person` before it
    links").

    This is a deliberately different, narrower question than
    `find_effects_without_invocation`'s "was `person-evidence` invoked
    anywhere" check: it asks whether the specific REQUIRED TOOL ran for THIS
    specific person, so it catches the case that check cannot — a new
    identity linked with zero scoring, even when `person-evidence` *was*
    properly invoked elsewhere in the same run for unrelated work. Confirmed
    live: the `bagley-father-1884` run linked a brand-new person (the
    father) across 13 `person_evidence` entries with zero `same_person`
    calls anywhere in the run, while `person-evidence` itself was invoked 52
    tool calls later for a different, later-extracted record — invisible to
    the "invoked anywhere" check, caught by this one.

    `same_person` takes two RECORD-PERSONA arguments (`primaryId1`/
    `primaryId2`), not a tree `person_id` — but when one side of a call IS
    the tree, that side's `primaryId` is documented to equal a `persons[].id`
    in its `gedcomx`, which for a tree-side call is the tree person id
    itself (confirmed against a live example — a committed
    `anders-monsen-ancestry` run calls `same_person` with `primaryId2:
    "LKFW-9XH"`, a literal FamilySearch tree person id). So this is a flat
    string match against `primaryId1`/`primaryId2` — no need to join through
    assertions/records.

    Whole-run, no proximity window — same false-positive profile as
    `find_effects_without_invocation`'s other checks, deliberately not the
    windowed heuristic `find_unguarded_protected_writes` uses.
    """
    research = research or {}
    tree = tree or {}
    persons = tree.get("persons") if isinstance(tree.get("persons"), list) else []
    starting_persons = (
        (starting_tree or {}).get("persons") if isinstance((starting_tree or {}).get("persons"), list) else []
    )
    starting_ids = {p.get("id") for p in starting_persons if isinstance(p, dict)}
    # No baseline: best-effort, treat every current person as new (may
    # over-flag) — same convention find_effects_without_invocation documents.
    new_person_ids = {p.get("id") for p in persons if isinstance(p, dict) and p.get("id") not in starting_ids}

    person_evidence = research.get("person_evidence") if isinstance(research.get("person_evidence"), list) else []
    linked_new_person_ids = {
        pe.get("person_id")
        for pe in person_evidence
        if isinstance(pe, dict) and pe.get("person_id") in new_person_ids
    }
    if not linked_new_person_ids:
        return []

    scored_ids = same_person_scored_ids(tool_calls)

    missing = sorted(pid for pid in linked_new_person_ids if pid not in scored_ids)
    return [
        f"tree person '{pid}' is new this run and has a person_evidence link, but 'same_person' "
        "was never called for it anywhere in the run — the identity was asserted, never scored"
        for pid in missing
    ]


# The four dedicated Cowork agents under packages/engine/plugin/agents/*.md —
# each carries its own self-contained, baked-in doctrine (per CLAUDE.md's "No
# playbook/reference files for agents": the agent body IS the doctrine), so a
# protected write made by one of these is trusted without further doctrine
# checks. `general-purpose` (the SDK's own blank-slate fallback) and any
# other subagent_type are NOT in this set and start with no doctrine of their
# own. Hand-maintained: no existing code enumerates this list (build_workspace
# globs the directory but never hardcodes names), so adding a 5th agent file
# without updating this set makes find_protected_writes_by_unnamed_delegate
# under-flag (fail toward false-negative, not false-positive).
DEDICATED_AGENT_NAMES = frozenset(
    {"record-extractor", "image-reader", "image-reader-opus", "gps-mentor"}
)


def find_protected_writes_by_unnamed_delegate(tool_calls: list[dict[str, Any]]) -> list[str]:
    """A protected write attributed to neither the main thread nor a
    dedicated agent.

    docs/specs/guardrail-enforcement-spec.md §11 (supersedes §11's
    retired `find_skill_call_without_doctrine`, a heuristic that guessed
    "who is currently executing" from `Skill`/`Agent`/`Read` adjacency in a
    flat, unattributed `tool_calls` list — confirmed to miss real bypasses
    because it asked the wrong question, see below). `e2e/orchestrator.py`'s
    `pretool_hook` now stamps every `tool_calls` entry with the PreToolUse
    hook's own `agent_id`/`agent_type` (`claude_agent_sdk` 0.1.81's
    `_SubagentContextMixin`: present only inside a Task-spawned subagent,
    absent — not merely falsy — on the main thread; see
    `harness/context_policy.py::is_subagent_call` for the probe-verified
    precedent this reuses, though that module is unit-harness-only and does
    not itself cover e2e). Given that TRUE caller identity per entry, this
    check needs no windowing or episode-boundary heuristic at all: a write
    owned by one of the four `GUARDRAIL_SKILLS` (per the existing
    `owning_skills`), or an `extraction_append` call, is legitimate iff it
    came from the main thread (no `agent_id`) or from one of the four
    dedicated Cowork agents (`DEDICATED_AGENT_NAMES`) that carry their own
    self-contained doctrine — anyone else making that decision is a bypass,
    full stop.

    `extraction_append` is checked separately from `owning_skills` on
    purpose, not folded into it: `owning_skills`'s contract is specifically
    "which of the four `GUARDRAIL_SKILLS` owns this" (relied on elsewhere,
    e.g. `find_effects_without_invocation`), and `extraction_append` is not
    one of the four guardrail skills' writes at all — it's hard-restricted at
    the TypeScript layer to exactly `sources`/`assertions`
    (`extraction-append.ts`), and `record-extractor.md` is the only agent
    file that even declares the tool. So its legitimate caller is narrower
    than "any dedicated agent": only `agent_type == "record-extractor"`
    exactly — a wrong dedicated agent (e.g. `gps-mentor`) holding this tool
    is not a case any agent's own `tools:`/`disallowedTools` declaration is
    set up to permit, and is itself worth flagging.

    Confirmed live in `ogletree-children/run-2026-07-21_13-24-05.json` (a
    committed, judge-`pass` run): `tool_calls[266]`, an `Agent` call with no
    `subagent_type` key at all (description "Link Louise Barrett death cert
    assertions to tree"), spawns the run's own `subagents[13]`
    (`agent_type: "general-purpose"`) — confirmed by matching that
    subagent's own turn-by-turn tool sequence against `tool_calls[267:289]`
    in order. That subagent calls `Skill(person-evidence)` itself at 267 (so
    person-evidence's doctrine WAS injected — this is a different bug from
    "doctrine never loaded," which is exactly why the retired check missed
    it: it only asked whether doctrine was reloaded, not who was allowed to
    act on it), then makes three writes `owning_skills` attributes to a
    guardrail skill: a personId-less `materialize_facts` at 278 (mints a new
    tree person — person-evidence), a `tree_edit` at 279 adding two
    `ParentChild` relationships and a `Couple` relationship
    (proof-conclusion — the tree-encoding side of a conclusion, not
    person-evidence, despite sharing the same subagent span), and a 19-op
    `research_append` batch at 280, entirely `person_evidence`
    (person-evidence). All three were made by `general-purpose` — neither
    the main thread nor a dedicated agent. Three OTHER `materialize_facts`
    calls earlier in the same span (275-277) attach facts to already-known
    `personId`s and are correctly NOT owned by any guardrail skill under
    `owning_skills`'s "no personId == mint" rule; they are not part of this
    violation. The run's `subagents[12]` (`agent_type: "record-extractor"`,
    extracting the same death certificate) makes several `extraction_append`
    calls in the preceding span — a legitimate, correctly-attributed control
    case this function must NOT flag.

    `gps-mentor` legitimately declares `research_append` and uses it in
    dozens of committed runs, but only to append to `evaluations[]` — a
    section `owning_skills`'s `research_append` branch never attributes to
    any of the four `GUARDRAIL_SKILLS`. So a gps-mentor call is already
    exempt before caller identity is even considered (`owners` comes back
    empty) — the same structural reason `find_effects_without_invocation`
    never needed a gps-mentor special case either.

    Known gap, not yet exercised in the corpus: this treats ANY of
    `DEDICATED_AGENT_NAMES` as sufficient for a `GUARDRAIL_SKILLS`-owned
    write, unlike `extraction_append`'s tighter single-name check. That is
    currently a no-op in practice — `record-extractor` explicitly disallows
    `research_append` and never declares `materialize_facts`/`tree_edit`,
    `image-reader`/`image-reader-opus` hold no writer tool at all, and
    `gps-mentor`'s only writer tool is structurally exempted via the
    `evaluations[]` carve-out above — but that's enforced by each agent's
    own `tools:`/`disallowedTools` declaration, not by this function. A
    future agent-file edit that gave any dedicated agent a legitimate-but-
    narrow reason to touch a `GUARDRAIL_SKILLS`-owned section would make
    this check silently accept it — see the identical caution already on
    `DEDICATED_AGENT_NAMES` above about a 5th agent file.

    Ships in shadow mode only (`e2e/orchestrator.py`'s
    `protected_writes_by_unnamed_delegate`, logged, never denied): historical
    runlogs carry no `agent_id`/`agent_type` at all (Step 0 just landed), so
    today's validation is one hand-backfilled fixture, not the full-corpus
    mechanical check a check like `find_person_evidence_missing_same_person`
    got. Graduating to a hard fail is a separate, deliberate follow-up once
    real runs accumulate a shadow-mode sample — tracked as its own backlog
    item, not duplicated here.
    """
    violations: list[str] = []
    for i, entry in enumerate(tool_calls):
        if entry.get("is_error") is True:
            continue
        tool = entry.get("tool", "")
        args = entry.get("args") or {}
        agent_id = entry.get("agent_id")
        agent_type = entry.get("agent_type")

        if bare_tool_name(tool) == "extraction_append":
            if agent_id is None or agent_type == "record-extractor":
                continue
            violations.append(
                f"tool_calls[{i}] extraction_append was made by agent_type="
                f"{agent_type!r} (agent_id={agent_id!r}) — only the dedicated "
                "'record-extractor' agent may hold this tool"
            )
            continue

        owners = owning_skills(tool, args)
        if not owners or agent_id is None or agent_type in DEDICATED_AGENT_NAMES:
            continue
        for owner in owners:
            violations.append(
                f"tool_calls[{i}] {tool} is a protected write owned by "
                f"'{owner}' but was made by agent_type={agent_type!r} "
                f"(agent_id={agent_id!r}) — neither the main thread nor a "
                "dedicated agent"
            )
    return violations
