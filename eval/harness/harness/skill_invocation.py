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
from collections import Counter
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


def did_not_land(entry: dict[str, Any]) -> bool:
    """True when this tool call changed nothing on disk.

    Two ways that happens. `is_error` is the old one. The other is the
    no-project answer (issue #1695): the user was not in a research project, so
    the writer tool wrote nothing and returned `reason: "no_project"` —
    deliberately WITHOUT `is_error`, because it is an answer rather than a
    failure. Every detector that skips a call because it never landed must skip
    this one too, or a write that did not happen is counted as a landed
    protected write and manufactures a violation in paid e2e grading.

    Matched as a substring rather than by parsing: `response_summary` arrives
    single-encoded, double-encoded, and truncated across the committed corpus,
    so a parse fails on shapes a substring handles.

    MATCH THE BARE NAME, never `'"no_project"'`. `_summarize_tool_response` in
    `e2e/orchestrator.py` passes any response under 500 chars through VERBATIM as
    the raw MCP envelope, where the tool's document is an escaped string —
    `[{"type": "text", "text": "{\\"reason\\": \\"no_project\\"}"}]`. The quoted
    key does not occur in that, because a backslash sits where the closing quote
    would be. The no-project envelope measures 236 chars, or 248 for the read
    variant, against `_RUNLOG_VERBATIM_MAX` of 500 — so it ALWAYS takes the
    verbatim path, and the envelope shape outnumbers the unwrapped one in every
    committed run. A quoted-key match therefore never fires in production while
    passing every hand-built test. That orchestrator docstring says this
    outright: "grep the bare name, which matches both."

    The bare name survives the other branch too: past the threshold the
    summarizer unwraps the document and keeps every dict key, so `reason` lands
    as a real JSON key and matches there as well. Nothing rests on the message
    staying short.
    """
    if entry.get("is_error") is True:
        return True
    return "no_project" in str(entry.get("response_summary") or "")


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
        if did_not_land(entry):
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


def _relationship_key(r: dict[str, Any]) -> tuple[Any, ...]:
    """A stable identity for a ParentChild/Couple relationship, for diffing a
    final tree against its starting tree.

    A ParentChild carries parent/child; a Couple carries person1/person2. Key on
    the endpoint tuple, never on `id`: 7 fixtures seed a relationship pointing at
    a PID-TODO placeholder that the agent resolves during the run, and an `id`
    key would read that genuinely-re-pointed relationship as seeded — a false
    negative in the gates that diff against the starting tree. Shared by
    `find_effects_without_invocation` (§8 hard gate) and
    `find_relationship_writes_without_warnings_check` (§7 shadow).
    """
    return (r.get("type"), r.get("person1"), r.get("person2"), r.get("parent"), r.get("child"))


def _relationship_conclusion_signature(r: dict[str, Any]) -> tuple[Any, ...]:
    """Endpoint identity plus normalized content, for detecting a conclusion written
    INTO an existing relationship — a marriage fact dated onto a seeded couple, a
    parentage re-classified Biological->Adopted — which `_relationship_key` alone
    cannot see (issue #1569, was #1368). Used only by
    `find_effects_without_invocation`'s proof-conclusion arm;
    `find_relationship_writes_without_warnings_check` asks a different question (was a
    NEW edge written) and keeps using the plain endpoint key.

    Ignores `id` for the same reason `_relationship_key` does, and ignores fact ORDER —
    a harmless re-serialization must not register as a new conclusion, the exact disease
    issue #1340 cures. A `frozenset` of `Counter` items, not a sorted tuple and not a bare
    `frozenset` of the facts themselves: two facts of the same type can have one
    populated and one None `standard_place` (real corpus shape, e.g.
    `chresten-nielsen-daughter`'s R1 — two Marriage facts, one with a place, one
    without), and sorting a tuple containing both raises `TypeError` comparing `None` to
    `str`. Neither `Counter` construction nor `frozenset` construction ever orders its
    elements relative to each other, so the comparison that crashes a sort never happens
    — but a bare `frozenset` of the facts would also collapse two facts that carry the
    IDENTICAL normalized signature into one, silently hiding a genuinely-added duplicate
    (found by review). Routing through `Counter` first preserves that multiplicity while
    keeping the same hash-only, comparison-free construction. Same pattern
    `_primary_fact_signatures` uses below.
    """
    facts = r.get("facts") if isinstance(r.get("facts"), list) else []
    fact_counts = Counter(
        (f.get("type"), f.get("standard_date"), f.get("standard_place"))
        for f in facts
        if isinstance(f, dict)
    )
    fact_sig = frozenset(fact_counts.items())
    return _relationship_key(r) + (r.get("subtype"), fact_sig)


def _fact_signatures(p: dict[str, Any]) -> Counter[tuple[Any, ...]]:
    """Normalized `(type, standard_date, standard_place)` for EVERY fact on a
    person, not filtered to `primary: true` -- the identity-based counterpart to
    a raw count for the person-evidence arm's "did new content appear" check,
    which cares about any new fact, not just a primary one (issue #1569 found
    the same count-based blind spot here that the proof-conclusion arm had: a
    fact REPLACED in place read as unchanged). A `Counter`, not a `set`, for the
    same multiplicity reason as `_primary_fact_signatures` below."""
    return Counter(
        (f.get("type"), f.get("standard_date"), f.get("standard_place"))
        for f in (p.get("facts") or [])
        if isinstance(f, dict)
    )


def _primary_fact_signatures(p: dict[str, Any]) -> Counter[tuple[Any, ...]]:
    """Normalized `(type, standard_date, standard_place)` for every `primary: true`
    fact on a person, ignoring `id` and ordering — the identity-based counterpart to a
    raw count, so a primary fact REPLACED in place (count unchanged, content changed)
    is visible the same way a primary fact ADDED is (issue #1569). A `Counter`, not a
    `set`: two primary facts that happen to carry the identical normalized signature
    are a real duplicate, and a `set` would collapse them — silently hiding a
    genuinely-added second fact the same way the raw-count check this replaces was
    supposed to catch (found by review). `Counter(current) - Counter(baseline)` is
    truthy exactly when some signature's count went up, which is what "has a new
    primary fact" means; a bare set difference would miss that for a duplicate."""
    return Counter(
        (f.get("type"), f.get("standard_date"), f.get("standard_place"))
        for f in (p.get("facts") or [])
        if isinstance(f, dict) and f.get("primary") is True
    )


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

    `starting_tree`, when given, lets both the proof-conclusion and the
    person-evidence checks ignore what a seeded fixture already carried before
    this run began: the person-evidence arm ignores persons that already had
    facts/names, and the proof-conclusion arm ignores ParentChild/Couple
    relationships and primary facts already present, flagging a conclusion
    encoded as a NEW relationship, an ADDED primary fact, a conclusion written
    INTO an existing relationship (a marriage fact dated onto a seeded couple,
    a parentage re-classified Biological->Adopted), or a primary fact REPLACED
    in place — see `_relationship_conclusion_signature` and
    `_primary_fact_signatures` (issue #1569, was #1368). Without a starting
    tree every seeded relationship or already-unlinked seed person would read
    as a violation. Best-effort and may over-flag when omitted.

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

    # Starting-tree baseline, shared by the proof-conclusion arm below and the
    # person-evidence arm further down: only content that APPEARED this run is a
    # skill's product. Without it a fixture's seeded relationships, persons, and
    # facts read as this run's work — which fired the proof-conclusion arm on
    # seed state alone, since 99 of 104 fixtures ship ParentChild/Couple
    # relationships in their starting tree (issue #998). When no starting tree is
    # given, treat everything as new (best-effort), matching the person-evidence
    # arm.
    starting_persons = (starting_tree or {}).get("persons") if isinstance((starting_tree or {}).get("persons"), list) else []
    starting_ids = {p.get("id") for p in starting_persons if isinstance(p, dict)}
    starting_fact_signatures = {
        p.get("id"): _fact_signatures(p)
        for p in starting_persons
        if isinstance(p, dict)
    }
    starting_primary_signatures = {
        p.get("id"): _primary_fact_signatures(p)
        for p in starting_persons
        if isinstance(p, dict)
    }

    starting_relationship_signatures = {
        _relationship_conclusion_signature(r)
        for r in ((starting_tree or {}).get("relationships") or [])
        if isinstance(r, dict) and r.get("type") in ("ParentChild", "Couple")
    }

    def _has_new_primary_fact(p: dict[str, Any]) -> bool:
        current = _primary_fact_signatures(p)
        if starting_tree is None:
            return bool(current)
        baseline = starting_primary_signatures.get(p.get("id"), Counter())
        return bool(current - baseline)

    # Detects a conclusion encoded as a NEW ParentChild/Couple relationship, a
    # conclusion written INTO an existing one, an ADDED primary fact, or a primary
    # fact REPLACED in place — each diffed against the starting tree via a
    # normalized signature (both relationships and primary facts are routinely
    # seeded). The proof_summaries disjunct still catches the normal path where a
    # summary is also written. proof_summaries itself needs no baseline — no
    # fixture seeds a non-empty one.
    has_primary_fact = any(isinstance(p, dict) and _has_new_primary_fact(p) for p in persons)
    has_conclusion_relationship = any(
        isinstance(r, dict)
        and r.get("type") in ("ParentChild", "Couple")
        and (starting_tree is None or _relationship_conclusion_signature(r) not in starting_relationship_signatures)
        for r in relationships
    )
    if (
        (len(proof_summaries) > 0 or has_primary_fact or has_conclusion_relationship)
        and "proof-conclusion" not in invoked
    ):
        violations.append(
            "research.json/tree.gedcomx.json shows a proof_summaries entry and/or an encoded "
            "conclusion (a primary fact, or a ParentChild/Couple relationship) new this run but "
            "'proof-conclusion' was never successfully invoked in this run"
        )

    person_evidence = research.get("person_evidence") if isinstance(research.get("person_evidence"), list) else []
    linked_person_ids = {pe.get("person_id") for pe in person_evidence if isinstance(pe, dict)}

    def _has_content(p: dict[str, Any]) -> bool:
        return bool(p.get("facts") or p.get("names"))

    # Identity-based, like the proof-conclusion arm's fact checks above, not
    # count-based: a seeded person's fact REPLACED in place (count unchanged,
    # content changed) is new content the same way an ADDED fact is (found by
    # review; same defect class as the proof-conclusion arm's, in this same
    # function). Names are not part of this comparison -- unchanged from
    # before this fix, and not something the review raised.
    def _is_new_content_this_run(p: dict[str, Any]) -> bool:
        if starting_tree is None:
            return True  # no baseline available; best-effort per the docstring
        pid = p.get("id")
        if pid not in starting_ids:
            return True  # brand-new person this run
        baseline = starting_fact_signatures.get(pid, Counter())
        return bool(_fact_signatures(p) - baseline)

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
    Errored calls don't count — the spec's §7 success-gating. That guard only
    began to bind once #1255/#1289 made the e2e orchestrator populate
    `is_error` on each entry; before that nothing set the key, so a failed
    `same_person` still marked the identity scored.

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


def _assertion_id_from_pe_op(op: dict[str, Any]) -> str | None:
    """The `assertion_id` a `person_evidence` append op cites, mirroring
    `_person_id_from_pe_op`'s container walk.

    Reads ONLY the singular key. 103 committed ops carry a plural
    `assertion_ids` array, which is not a schema field (`person_evidence_entry`
    is `additionalProperties: false` with `assertion_id` required), so those
    ops are rejected writes; treating one as resolvable would exempt a link
    that never landed."""
    for container in ("entry", "fields"):
        c = op.get(container)
        if isinstance(c, dict) and isinstance(c.get("assertion_id"), str):
            return c["assertion_id"]
    return op.get("assertion_id") if isinstance(op.get("assertion_id"), str) else None


def _provenance_index(
    research: dict[str, Any] | None,
) -> tuple[dict[str, dict[str, Any]], dict[str, dict[str, Any]]]:
    """`(assertions_by_id, log_entries_by_id)` for the persona-reachability
    join. Tolerates a missing or non-list section, like every other reader
    here."""
    research = research or {}
    assertions = research.get("assertions")
    log = research.get("log")
    by_assertion = {
        a["id"]: a
        for a in (assertions if isinstance(assertions, list) else [])
        if isinstance(a, dict) and isinstance(a.get("id"), str)
    }
    by_log = {
        entry["id"]: entry
        for entry in (log if isinstance(log, list) else [])
        if isinstance(entry, dict) and isinstance(entry.get("id"), str)
    }
    return by_assertion, by_log


def _lookup_assertion(
    assertions_by_id: dict[str, dict[str, Any]], assertion_id: Any
) -> dict[str, Any] | None:
    """The assertion an id names, or None when the id is absent or not a string.

    A `person_evidence` entry's `assertion_id` is unvalidated here, and a
    non-string value (a list, say) raises `TypeError: unhashable type` from a
    bare `.get()`. This module never raises."""
    return assertions_by_id.get(assertion_id) if isinstance(assertion_id, str) else None


def _persona_reachable(
    assertion: dict[str, Any] | None, log_entries_by_id: dict[str, dict[str, Any]]
) -> bool:
    """Whether a record persona `same_person` could score against is reachable
    for this assertion — the discriminator the §8 provenance checks narrow on.

    `same_person` takes two GedcomX documents plus a focus id inside each. It
    never reads `record_persona_id`; that field is a pointer into a retained
    search sidecar, so a null value proves only that no sidecar was kept. What
    decides reachability is the tool that produced the assertion:

    - a non-null `record_persona_id` — `research_append` verified it against
      the record's `gedcomx.persons[]` on write, so the persona exists;
    - `record_read` — it returns a `SimplifiedGedcomX` with a persons array,
      so a persona was in hand when the assertion was extracted;
    - `record_search` with a retained `results_ref` — the sidecar result
      carries the record's `gedcomx`.

    Everything else is unreachable: image-, external-site- and PDF-sourced
    assertions, a search whose sidecar was not retained, and **every**
    `fulltext_search` hit — an FTS result carries transcript text, names and
    places but no GedcomX, and its ARK is a `3:1:`/`3:2:` image entry that
    `record_read` (which takes a `1:1:` record-persona ARK) cannot open.

    UNKNOWN provenance counts as reachable, i.e. keeps flagging. Exempting on
    an absent field is the shape this narrowing exists to reject: it would let
    an assertion written with no `log_entry_id` shed the scoring requirement
    entirely. Flagging there is also never worse than the un-narrowed check.

    **What this deliberately does NOT decide: whether a fresh fetch would
    work.** The question asked is "could a persona be got out of what the run
    RETAINED" — the sidecar on disk, or the document `record_read` already
    returned. It is not "is there any call that might produce one". 48 of the
    306 links it exempts on today's corpus carry a `record_id` that is a `1:1:`
    FamilySearch record ARK (29 sidecar-less `record_search`, 19
    `image_transcribe`), so `record_read` might reach a persona for them. That
    is left exempt on purpose: the detector cannot verify offline that such a
    fetch resolves, and flagging on an unproven capability is the error this
    change corrected in the `fulltext_search` lane. Tightening it is a real
    option, not an oversight — it would also require `person-evidence` to reach
    for `record_read` on a sidecar-less search, which needs new fixtures on
    roughly eleven unit tests that stock none today. See
    `docs/specs/guardrail-enforcement-spec.md` §4 for the revisit trigger.
    """
    if not isinstance(assertion, dict):
        return True  # unresolvable assertion — provenance unknown, not proven unscoreable
    if assertion.get("record_persona_id"):
        return True
    # `isinstance(..., str)` before the lookup, not decoration: a malformed
    # `log_entry_id` holding a list or dict raises `TypeError: unhashable type`
    # inside `.get()`, and this module never raises — a raise here would kill
    # the whole run's post-run result computation. 103 committed ops already
    # carry a plural `assertion_ids` array, so malformed id fields are real.
    log_entry_id = assertion.get("log_entry_id")
    entry = log_entries_by_id.get(log_entry_id) if isinstance(log_entry_id, str) else None
    if not isinstance(entry, dict):
        return True  # no log entry — provenance unknown
    tool = entry.get("tool")
    if tool == "record_read":
        return True
    if tool == "record_search" and entry.get("results_ref"):
        return True
    return False


def unguarded_new_person_evidence_links(
    tool: str,
    args: dict[str, Any] | None,
    *,
    scored_ids: set[str],
    starting_ids: set[str],
    research: dict[str, Any] | None = None,
) -> list[str]:
    """Pre-write check (issue #963, spec §8): the NEW tree person id(s) this
    pending `research_append` would link via `person_evidence` that have NOT
    been scored by `same_person` yet. Empty => nothing to report.

    Scoped like `find_person_evidence_missing_same_person` on WHICH persons
    count:
    - a person id already in the starting (seed) tree is never flagged
      (linking an assertion to a pre-existing person isn't a new identity);
    - a person id already scored by a prior successful `same_person` passes;
    - a link whose provenance lane cannot yield a record persona is skipped
      (`_persona_reachable`), so a person all of whose pending links are
      unscoreable drops out. That needs the project document to join through,
      which is what `research` supplies.

    `research=None` means "no provenance available, narrow nothing" — today's
    un-narrowed behaviour, NOT "exempt everything". A guardrail that silently
    disables itself on an unreadable file is the worse failure, and
    `guardrail_shadow_report._links_any_person_evidence` relies on this
    parameter defaulting to "no narrowing" to keep meaning "does this call link
    anyone at all".

    But it asks a STRICTER question than that post-run detector, and the two
    are not equivalent. The post-run form is whole-run: a `same_person`
    anywhere in the run, INCLUDING after the link, satisfies it. This one runs
    before the write, so it can only see calls already made — link-then-score
    is a hit here and a pass there. Rare but real: one occurrence across the
    committed corpus (ferber-marriage 2026-07-21, person I5 linked at call #45
    and scored at #68). Callers reading the hit count should treat it as
    "unscored at write time", not as a preview of the post-run verdict.

    Fact-based, no proximity window (unlike `find_unguarded_protected_writes`)
    — `same_person` is a required tool call, so "was it called for this
    person" is a fact rather than a window judgment. That is why the post-run
    form (spec §8) went straight to a hard fail; the live pre-write form still
    runs in shadow mode, because denying on it would fire in 65 of 81 fixtures
    (issue #1231). Returns ids in first-seen order, de-duped.

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
    assertions_by_id, log_entries_by_id = _provenance_index(research)
    out: list[str] = []
    seen: set[str] = set()
    for op in _iter_ops(args):
        if op.get("section") != "person_evidence":
            continue
        pid = _person_id_from_pe_op(op)
        if not pid or pid in starting_ids or pid in scored_ids or pid in seen:
            continue
        if research is not None and not _persona_reachable(
            assertions_by_id.get(_assertion_id_from_pe_op(op)), log_entries_by_id
        ):
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
    receives a **scoreable** `person_evidence` link must have been the subject
    of at least one `same_person` call somewhere in the run.

    The authority is `person-evidence/SKILL.md`, the skill that owns the
    identity decision — not `research/SKILL.md`'s one-line orchestrator
    paraphrase ("scores every cross-record link with `same_person` before it
    links"), which this docstring used to cite. The narrower owning contract
    wins on conflict, and citing the paraphrase is how the broad rule kept
    being re-derived.

    "Scoreable" is `_persona_reachable`: a link is skipped only when its
    assertion's own provenance lane cannot yield a record persona —
    image-, external-site- and PDF-sourced assertions, every `fulltext_search`
    hit, and searches whose sidecar was not retained. A `record_read`-sourced
    link and a sidecar-backed search link both stay flagged; so does unknown
    provenance, since exempting on an absent field would be a bypass. A person
    drops out only when EVERY link to them is unscoreable;
    `unscoreable_person_evidence_links` counts what that skips.

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
    assertions_by_id, log_entries_by_id = _provenance_index(research)
    linked_new_person_ids = {
        pe.get("person_id")
        for pe in person_evidence
        if isinstance(pe, dict)
        and pe.get("person_id") in new_person_ids
        and _persona_reachable(
            _lookup_assertion(assertions_by_id, pe.get("assertion_id")), log_entries_by_id
        )
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


def unscoreable_person_evidence_links(
    research: dict[str, Any] | None,
    tree: dict[str, Any] | None,
    *,
    starting_tree: dict[str, Any] | None = None,
) -> list[str]:
    """The `person_evidence` ids on brand-new tree persons whose assertion
    lane cannot yield a record persona — the *unscoreable by design*
    population `find_person_evidence_missing_same_person` deliberately does not
    flag.

    A COUNT, never a violation. The lead asked (2026-08-09) for the exemption
    to be visible rather than silent: a population that is dropped without a
    number attached cannot be watched if it grows, and gives a revisit trigger
    nothing to fire on. It deliberately gets no `VIOLATION_ARMS` entry in
    `e2e.corpus_report` — that map is checked for set equality against the
    messages the detectors actually emit, so an arm nothing emits fails the
    test.

    Scoped exactly like the detector on WHICH PERSONS count — brand-new persons
    only, and with no `starting_tree` every current person reads as new (the
    same best-effort convention `find_effects_without_invocation` documents).

    But the two numbers are **not** complements and must not be subtracted from
    one another: this counts exempted LINKS, while the detector emits one
    violation per flagged PERSON. Same population of persons, different unit.
    """
    research = research or {}
    tree = tree or {}
    persons = tree.get("persons") if isinstance(tree.get("persons"), list) else []
    starting_persons = (
        (starting_tree or {}).get("persons") if isinstance((starting_tree or {}).get("persons"), list) else []
    )
    starting_ids = {p.get("id") for p in starting_persons if isinstance(p, dict)}
    new_person_ids = {p.get("id") for p in persons if isinstance(p, dict) and p.get("id") not in starting_ids}

    person_evidence = research.get("person_evidence") if isinstance(research.get("person_evidence"), list) else []
    assertions_by_id, log_entries_by_id = _provenance_index(research)
    return [
        pe["id"]
        for pe in person_evidence
        if isinstance(pe, dict)
        and isinstance(pe.get("id"), str)
        and pe.get("person_id") in new_person_ids
        and not _persona_reachable(
            _lookup_assertion(assertions_by_id, pe.get("assertion_id")), log_entries_by_id
        )
    ]


def check_guardrail_compliance(
    tool_calls: list[dict[str, Any]],
    final_research: dict[str, Any] | None,
    final_tree: dict[str, Any] | None,
    *,
    starting_tree: dict[str, Any] | None = None,
) -> list[str]:
    """The §8 HARD guardrail detector — every non-windowed check, in one call.

    docs/specs/guardrail-enforcement-spec.md §8. A guardrail skill's
    effect present in the FINAL project state with no matching successful
    invocation anywhere in the run, or a resolved question's proof_summary
    missing its mandatory gps-mentor proof-critique verdict. Mirrors the unit
    harness's `test_positive_fails_when_skill_not_in_skills_invoked`, which
    had no e2e equivalent. Unlike §4.1's shadow-mode recency check, this only
    asks whether the skill ran AT ALL across the whole run, so it is far less
    prone to false positives and was safe to hard-fail on immediately rather
    than rolling out in shadow mode first.

    `find_person_evidence_missing_same_person` is a separate, also-hard,
    also-non-windowed check added after the first real run of
    bagley-father-1884 showed the gap in "invoked anywhere": that run linked a
    brand-new person across 13 person_evidence entries with zero same_person
    calls in the whole run, while person-evidence ITSELF was invoked 52 tool
    calls later for unrelated work — passing the "invoked anywhere" bar while
    still skipping the identity-scoring doctrine entirely. It checks the
    specific required tool for the specific person instead of the skill's mere
    presence in the run.

    Note this is NOT vacuous on a treeless run: `find_missing_mentor_verdicts`
    takes no tree at all, and the exhaustiveness arm reads only
    `research["questions"]`. That is why compliance is always a real result
    and never "not checked" for a run this harness performed.

    Lives here beside the three detectors it composes so `e2e.corpus_report`
    can import it without dragging `claude_agent_sdk` into its pure-analysis
    posture (issue #1484); `e2e.orchestrator` re-exports it so `run_e2e_test`
    and the `monkeypatch.setattr(orchestrator, ...)` tests keep resolving it as
    a module global unchanged. Originally extracted from `run_e2e_test` (issue
    #972) to be unit-testable away from the 1200-line async function.
    """
    return (
        find_effects_without_invocation(
            tool_calls, final_research, final_tree, starting_tree=starting_tree
        )
        + find_missing_mentor_verdicts(final_research)
        + find_person_evidence_missing_same_person(
            tool_calls, final_research, final_tree, starting_tree=starting_tree
        )
    )


# The dedicated Cowork agents under packages/engine/plugin/agents/*.md — each
# carries its own self-contained, baked-in doctrine (per CLAUDE.md's "No
# playbook/reference files for agents": the agent body IS the doctrine), so a
# protected write made by one of these is trusted without further doctrine
# checks. `general-purpose` (the SDK's own blank-slate fallback) and any
# other subagent_type are NOT in this set and start with no doctrine of their
# own. Hand-maintained: no existing code enumerates this list (build_workspace
# globs the directory but never hardcodes names), so adding an agent file
# without updating this set makes find_protected_writes_by_unnamed_delegate
# under-flag (fail toward false-negative, not false-positive).
#
# The count is derivable — `ls packages/engine/plugin/agents/*.md` — so this
# comment does not state one. It said "four" over a set of five for the four
# days after proof-conclusion was added.
DEDICATED_AGENT_NAMES = frozenset(
    {
        "record-extractor",
        "image-reader",
        "gps-mentor",
        # Added when proof_summaries moved behind the hook's caller check: the
        # owning skill now delegates the write, so EVERY legitimate proof
        # summary arrives from this agent. Without the name here each one reads
        # as an unnamed-delegate bypass — the detector would fire hardest on
        # exactly the runs that did the right thing.
        "proof-conclusion",
        # Same shape, for the exhaustiveness claim (issue #1335, Phase 4): the
        # hook routes `exhaustive_declaration.declared: true` to this agent, so
        # every legitimate declaration now arrives from it.
        "research-exhaustiveness",
    }
)


def strip_agent_namespace(agent_type: Any) -> str | None:
    """The bare agent name for comparison, from a hook-stamped ``agent_type``.

    Cowork logs a plugin-namespaced spelling ("genealogy-research:record-extractor")
    while the harness reports bare names; strip a leading "<plugin>:" segment so an
    equality/membership test that is green in CI is not dead the moment it sees
    production data — the #650/#698/#939 failure shape (a live 2026-08-15 Cowork
    probe logged "genealogy-research:image-reader"). One segment only: a double
    namespace ("a:b:record-extractor") over-flags rather than over-exempts, the safe
    direction for a shadow-only report. A non-str (never stamped by the SDK, which
    emits str|None) maps to ``None`` so a ``in DEDICATED_AGENT_NAMES`` membership
    test cannot raise ``TypeError`` on an unhashable value under a corpus-wide
    replay; ``None`` flags, the same safe over-flag direction. Callers keep the RAW
    ``agent_type`` for violation messages. Shared by the live detector below and its
    lane-check replica (``e2e/detector_before_after_report.py::_lane_check_old``) so
    the two cannot drift on the strip (#1856)."""
    return agent_type.split(":", 1)[-1] if isinstance(agent_type, str) else None


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

    The "or main thread" clause above is, for `extraction_append`, a
    classification statement (a main-thread call is not an *unnamed-delegate*
    bypass) — NOT a claim that the record-extraction router may do the
    extraction itself. It may not: a main-thread `extraction_append` is
    hard-denied upstream at PreToolUse by the #942 guard
    (`e2e/orchestrator.py::is_main_thread_subagent_only_tool` in e2e,
    `context_policy.subagent_only_violation` in the unit harness; e2e-test-spec
    §6.1.1), so it never executes. The attempt still reaches this function —
    `tool_calls` is appended before the PreToolUse decision — but it exits at
    the `agent_id is None` branch on the classification above: a main-thread
    call (denied or not) is not an *unnamed-delegate* bypass, full stop. It is
    not counted, and that classification stands on its own regardless of
    whether the denied call also carries `is_error: true` — this detector
    reads `is_error` nowhere (issue #1569): the rule here is about who called,
    not whether the call succeeded, so a caller that should not have made this
    decision is a violation whether the write landed, was rejected by
    validation, or was denied outright.

    Note what the two layers do and do not compose to. The main-thread half is
    DENIED; this delegate half is only LOGGED — it is shadow-mode, deliberately
    not read by `E2eResult.__post_init__` until its false-positive rate is
    calibrated. So a `general-purpose` delegate's `extraction_append`
    still succeeds today; what this detector buys is that it is recorded.

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

    Known gap, and it is LIVE — this paragraph used to say it was not.

    This treats ANY of `DEDICATED_AGENT_NAMES` as sufficient for a
    `GUARDRAIL_SKILLS`-owned write, unlike `extraction_append`'s tighter
    single-name check. It was a no-op while the set held only agents that
    could not reach such a section: `record-extractor` disallows
    `research_append` and never declares `materialize_facts`/`tree_edit`, the
    two image readers hold no writer tool at all, and `gps-mentor`'s only
    writer tool is structurally exempted via the `evaluations[]` carve-out
    above.

    Two agents since have exactly the shape the old text warned a future edit
    would create, and both are in `GUARDRAIL_SKILLS` above: `proof-conclusion`
    holds `research_append` and writes `proof_summaries`, and
    `research-exhaustiveness` holds it and writes `questions`. So a
    `proof_summaries` write attributed to the exhaustiveness agent — or a
    declaration attributed to proof-conclusion — is accepted here today. What
    actually stops it is the plugin hook's per-agent lane
    (`AGENT_WRITABLE_SECTIONS`), which does not reach either harness. Closing
    it here means keying the exemption on (agent, section) rather than on
    agent alone, which is the same map the hook already carries.

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
        tool = entry.get("tool", "")
        args = entry.get("args") or {}
        agent_id = entry.get("agent_id")
        agent_type = entry.get("agent_type")
        # Compare on the namespace-stripped name (Cowork logs "<plugin>:record-extractor";
        # the harness logs bare) but keep the RAW agent_type in the messages below. See
        # strip_agent_namespace for the #650/#698/#939 rationale and the over-flag safety.
        bare_agent_type = strip_agent_namespace(agent_type)

        if bare_tool_name(tool) == "extraction_append":
            if agent_id is None or bare_agent_type == "record-extractor":
                continue
            violations.append(
                f"tool_calls[{i}] extraction_append was made by agent_type="
                f"{agent_type!r} (agent_id={agent_id!r}) — only the dedicated "
                "'record-extractor' agent may hold this tool"
            )
            continue

        if bare_tool_name(tool) == "research_append":
            # #1273 Item 4: research_append to `sources`/`assertions` is the same
            # protected write extraction_append is denied for. record-extraction
            # creates these and citation refines `sources` (ownership.json); because
            # owning_skills does not attribute those sections, without this branch an
            # unnamed delegate writes them through the broad tool unflagged. The
            # legitimate callers are exactly the sibling extraction_append arm's: the
            # main thread (agent_id None; citation refines `sources` there, exempt for
            # free) and the `record-extractor` agent alone — NOT every dedicated
            # agent, because sources/assertions are not owning_skills sections, so a
            # gps-mentor/proof-conclusion/research-exhaustiveness delegate writing
            # them is out of lane exactly as it is for extraction_append (which uses
            # the same tight `== record-extractor`). Uses `bare_agent_type` (the
            # shared namespace strip #1856 added) so the namespaced spelling of
            # record-extractor is exempt too. Shadow only. No `continue`: a batch may
            # ALSO touch an owning_skills section, still checked below. One violation
            # per offending CALL (not per op), matching the sibling arms' granularity
            # so a batch does not inflate the shadow signal.
            if agent_id is not None and bare_agent_type != "record-extractor":
                sections = sorted(
                    {
                        op.get("section")
                        for op in _iter_ops(args)
                        if op.get("section") in ("sources", "assertions")
                    }
                )
                if sections:
                    violations.append(
                        f"tool_calls[{i}] research_append to {'/'.join(sections)} was "
                        f"made by agent_type={agent_type!r} (agent_id={agent_id!r}) — "
                        "this is record-extraction/citation's protected write, made "
                        "by neither the main thread nor the record-extractor agent"
                    )

        owners = owning_skills(tool, args)
        if not owners or agent_id is None or bare_agent_type in DEDICATED_AGENT_NAMES:
            continue
        for owner in owners:
            violations.append(
                f"tool_calls[{i}] {tool} is a protected write owned by "
                f"'{owner}' but was made by agent_type={agent_type!r} "
                f"(agent_id={agent_id!r}) — neither the main thread nor a "
                "dedicated agent"
            )
    return violations


# Marks a citation-nulling shadow entry in the shared
# `guardrail_shadow_violations` list. `guardrail_shadow_report.py` keys on it to
# count this failure class in its own bucket instead of lumping it with the
# #963 person_evidence-provenance gaps (both carry a `detail`).
CITATION_NULLING_KIND = "citation_nulling"

# Marks a #963 provenance entry recorded by a run launched in DENY mode
# (`--person-evidence-guard deny`, issue #1231). Same list, same `detail` shape,
# but a different meaning: the write was blocked and retried rather than landing,
# and the loop valve can record several denials plus a release for one logical
# gap. `scan_provenance` excludes it so the shadow fire rate the graduation
# decision reads is not inflated by deny-mode runs. Lives here beside its sibling
# rather than in `e2e/orchestrator.py` — which sets it — so that
# `guardrail_shadow_report.py` can read it without importing the orchestrator
# (and with it the Claude Agent SDK) just to learn one string.
PERSON_EVIDENCE_DENY_KIND = "person_evidence_deny"

# Marks a #1193 warnings-unchecked shadow entry in the shared
# `guardrail_shadow_violations` list: a run wrote a new ParentChild/Couple
# relationship but never called the (free, deterministic) `person_warnings`
# guardrail. `guardrail_shadow_report.py` keys on it to count this class in its
# own bucket. Lives here beside its siblings so the report can read it without
# importing the orchestrator (and the Claude Agent SDK) for one string.
WARNINGS_UNCHECKED_KIND = "warnings_unchecked"


def find_citation_nulling_in_conclusions(
    research: dict[str, Any] | None,
) -> list[dict[str, Any]]:
    """Shadow-mode post-hoc detector (issue #1133): a source that BACKS A WRITTEN
    CONCLUSION carries a null or empty ESM ``citation`` string — the "provenance
    nulling" failure class the engine's write-seam guard deliberately does not
    cover.

    Provenance nulling has two halves. A null *source-ref* on authored tree
    content (a fact/name/edge pointing at no source) is already unrepresentable
    at the write seam — the mandatory-ref golden in
    ``materialize-facts.test.ts`` / ``tree-edit.test.ts`` rejects it, inverting
    the cruz "0/13 facts carried a ref" leak. This detector covers the OTHER
    half that golden explicitly disowns
    (``docs/specs/tree-materialization-spec.md`` — "The ESM citation string is
    out of scope here"): a source that exists and is cited by a conclusion but
    whose citation *string* was left empty. That is the cruz "11/14 citation-less
    tree sources" / birkeland "F1/F2 citation-less conclusion facts" class in
    ``docs/record-extraction-consolidation-closing-report.md`` §4, which the
    judge cannot see and the three §7.5 compliance checks do not read.

    GATED ON A WRITTEN CONCLUSION. Fires only when a ``proof_summaries`` entry
    exists, and only for the sources its ``supporting_assertion_ids`` reference
    (``assertion.source_id`` → ``sources[].id``). This gate is what keeps the
    check from false-positiving on honest partial runs: tree S-entry citations
    are populated by ``proof-conclusion`` at UPLOAD time, so a run that
    legitimately stops before upload has empty citations by design — but a run
    that WROTE a conclusion has asserted the evidence is citable, so a concluded
    source with an empty citation string is a real nulling. Reads
    ``research.json`` only (upload-independent): the citation string is AUTHORED
    there before ``proof-conclusion`` copies it to the tree, so this catches the
    nulling at its origin rather than waiting on upload.

    SHADOW MODE ONLY: returns violation records shaped to share
    ``guardrail_shadow_violations`` with the other shadow sources (an ``int``
    ``index`` and string ``tool`` so ``guardrail_shadow_report``'s formatters
    never hit a ``None`` format spec; ``kind == CITATION_NULLING_KIND`` so that
    report counts this class in its own bucket). Never fails a run. Graduating to
    a hard 4th compliance check is a deliberate follow-up (issue #1358) gated on
    measuring the fire rate across the corpus — not decided here.
    """
    research = research or {}
    proof_summaries = (
        research.get("proof_summaries")
        if isinstance(research.get("proof_summaries"), list)
        else []
    )
    if not proof_summaries:
        return []  # the gate: no written conclusion, so nothing is held to a citation

    sources = research.get("sources") if isinstance(research.get("sources"), list) else []
    assertions = (
        research.get("assertions") if isinstance(research.get("assertions"), list) else []
    )
    sources_by_id = {s.get("id"): s for s in sources if isinstance(s, dict)}
    assertions_by_id = {a.get("id"): a for a in assertions if isinstance(a, dict)}

    def _citation_is_empty(src: dict[str, Any]) -> bool:
        c = src.get("citation")
        return c is None or (isinstance(c, str) and c.strip() == "")

    violations: list[dict[str, Any]] = []
    seen: set[tuple[Any, Any]] = set()  # one entry per (conclusion, source)
    for ps in proof_summaries:
        if not isinstance(ps, dict):
            continue
        ps_id = ps.get("id")
        qid = ps.get("question_id")
        aids = (
            ps.get("supporting_assertion_ids")
            if isinstance(ps.get("supporting_assertion_ids"), list)
            else []
        )
        for aid in aids:
            assertion = assertions_by_id.get(aid)
            if not isinstance(assertion, dict):
                continue  # dangling assertion ref — a schema concern, not this detector's
            sid = assertion.get("source_id")
            if not sid:
                continue  # assertion not source-backed (e.g. a bare hypothesis) — nothing to cite
            src = sources_by_id.get(sid)
            if not isinstance(src, dict):
                continue  # dangling source ref — a schema concern, not this detector's
            if not _citation_is_empty(src):
                continue
            key = (ps_id, sid)
            if key in seen:
                continue
            seen.add(key)
            violations.append(
                {
                    "index": -1,  # post-hoc final-state read; there is no tool-call index
                    "tool": "research.json",
                    "required_skill": "citation",
                    "question_id": qid,
                    "kind": CITATION_NULLING_KIND,
                    "detail": (
                        f"concluded source {sid} (via assertion {aid}, "
                        f"proof_summary {ps_id}) has a null/empty citation string"
                    ),
                }
            )
    return violations


# Marks a #1358 tree-side citation-nulling shadow entry in the shared
# `guardrail_shadow_violations` list. Distinct from CITATION_NULLING_KIND so the
# report counts the two arms separately: the research-side arm reads
# `research.json` (where the citation is AUTHORED) and the tree-side arm reads
# `tree.gedcomx.json` (where `proof-conclusion` COPIES it at upload). They fire
# on opposite sides of the same seam and their rates differ by two orders of
# magnitude, so folding them into one bucket would hide that.
TREE_CITATION_NULLING_KIND = "tree_citation_nulling"


def find_citation_nulling_in_tree_sources(
    research: dict[str, Any] | None,
    tree: dict[str, Any] | None,
) -> list[dict[str, Any]]:
    """Shadow-mode post-hoc detector (issue #1358): a tree ``sources[]`` entry
    that an UPLOADED conclusion rests on carries a null or empty ``citation``.

    The tree-side half of the #1133 citation-nulling class. Its sibling
    ``find_citation_nulling_in_conclusions`` reads ``research.json``, where the
    citation is authored, and measures **zero** across the committed corpus —
    1,884 concluded sources over 141 runs, all cited. That zero is a real
    invariant worth pinning, but it is not this class: the failure the class was
    built for lives on the other side of the seam, where ``proof-conclusion``
    copies the string onto the tree S-entry.

    THE OBLIGATION, quoted from the site that states it. Not
    ``proof-conclusion/SKILL.md`` — that body moved to the delegated agent when
    the skill became a skill-agent pair — but
    ``packages/engine/plugin/agents/proof-conclusion.md`` step 3, "Source entries
    (upload-time citation + conclusion-gated upload)":

        copy the finalized ``research.json`` ``sources[].citation`` string into
        the **``citation``** field … **Upload is conclusion-gated:** the working
        tree carries *all* sourced evidence facts (materialized at link time by
        person-evidence), but **only ``primary``/proof-backed facts upload to
        FamilySearch** — un-concluded evidence stays out.

    THE GATE IS THAT SENTENCE, both clauses. A tree source is held to a citation
    only when (1) the run wrote a ``proof_summaries`` entry, and (2) the source is
    referenced by a ``primary`` fact or by a relationship — i.e. by content that
    actually uploads. Without clause (2) this would flag every evidence fact
    person-evidence materialized during honest research, which the same sentence
    says is *supposed* to be citation-less until a conclusion promotes it. That
    is why this ships in shadow with a gate rather than as a fail:
    ``docs/specs/simplified-gedcomx-spec.md`` makes the tree citation
    upload-populated by design, so some fraction of any count here is
    legitimately-not-yet-uploaded and only a human can price it.

    SHADOW MODE ONLY, and this card deliberately does not graduate it. The
    research-side arm's zero is *not* a licence to graduate — per
    ``docs/specs/guardrail-enforcement-spec.md``, "zero is not 'low enough', it
    is nobody has seen this detector fire." Detect before teaching: a skill edit
    costs a paid eval run and there is no baseline to measure it against until
    this arm has been in the corpus for a few runs.
    """
    research = research or {}
    tree = tree or {}

    proof_summaries = (
        research.get("proof_summaries")
        if isinstance(research.get("proof_summaries"), list)
        else []
    )
    if not proof_summaries:
        return []  # clause 1: no written conclusion, so nothing has uploaded

    sources = tree.get("sources") if isinstance(tree.get("sources"), list) else []
    sources_by_id = {s.get("id"): s for s in sources if isinstance(s, dict)}
    if not sources_by_id:
        return []

    def _refs(container: Any) -> list[Any]:
        """Source ids named by one fact/relationship.

        Two spellings live in the committed corpus: ``sources: [{"ref": "S3"}]``
        (the common one) and a bare ``source_ids: ["S3"]``. Reading only the
        first silently under-counts, which on a detector whose whole job is a
        rate would look like the problem being smaller than it is.
        """
        if not isinstance(container, dict):
            return []
        out: list[Any] = []
        for entry in container.get("sources") or []:
            if isinstance(entry, dict) and entry.get("ref"):
                out.append(entry["ref"])
            elif isinstance(entry, str):
                out.append(entry)
        for sid in container.get("source_ids") or []:
            if isinstance(sid, str):
                out.append(sid)
        return out

    # clause 2: only content that UPLOADS holds a source to a citation.
    uploading: list[tuple[str, Any, list[Any]]] = []
    for person in tree.get("persons") or []:
        if not isinstance(person, dict):
            continue
        for fact in person.get("facts") or []:
            if not isinstance(fact, dict) or not fact.get("primary"):
                continue
            uploading.append(("primary fact", fact.get("id"), _refs(fact)))
    for rel in tree.get("relationships") or []:
        if not isinstance(rel, dict):
            continue
        uploading.append(("relationship", rel.get("id"), _refs(rel)))
        for fact in rel.get("facts") or []:
            if isinstance(fact, dict) and fact.get("primary"):
                uploading.append(("relationship fact", fact.get("id"), _refs(fact)))

    def _citation_is_empty(src: dict[str, Any]) -> bool:
        c = src.get("citation")
        return c is None or (isinstance(c, str) and c.strip() == "")

    violations: list[dict[str, Any]] = []
    seen: set[Any] = set()  # one entry per source, however many facts cite it
    for what, holder_id, refs in uploading:
        for sid in refs:
            if sid in seen:
                continue
            src = sources_by_id.get(sid)
            if not isinstance(src, dict):
                continue  # dangling ref — a schema concern, not this detector's
            if not _citation_is_empty(src):
                continue
            seen.add(sid)
            violations.append(
                {
                    "index": -1,  # post-hoc final-state read; no tool-call index
                    "tool": "tree.gedcomx.json",
                    "required_skill": "proof-conclusion",
                    "question_id": None,
                    "kind": TREE_CITATION_NULLING_KIND,
                    "detail": (
                        f"uploaded tree source {sid} (referenced by {what} "
                        f"{holder_id}) has a null/empty citation string"
                    ),
                }
            )
    return violations


# Marks a conflict-not-persisted shadow entry in the shared
# `guardrail_shadow_violations` list, told apart from the citation-nulling and
# #963 person_evidence buckets by this `kind` in `guardrail_shadow_report.py`.
CONFLICT_UNPERSISTED_KIND = "conflict_unpersisted"

# Substrings in a `conflict_resolution` stop-criterion that mean "there was no
# conflict to persist" — checked before firing so an honest "no conflicts" note
# is not read as an unpersisted resolution.
_NO_CONFLICT_SUBSTRINGS = (
    "no conflict",
    "no material conflict",
    "no remaining conflict",
    "no unresolved conflict",
    "no discrepanc",  # "no discrepancy" / "no discrepancies"
    "without conflict",
)
# Whole-field values (stripped, lowercased) that mean the same thing. Matched
# exactly rather than as substrings so a bare "none"/"n/a" can't false-negative
# a real resolution sentence that merely contains those letters.
_NO_CONFLICT_EXACT = {"", "none", "n/a", "na", "not applicable"}

# `stop_criteria.conflict_resolution` is a REQUIRED field on every declared
# exhaustive_declaration (research.schema.json), so it is always populated —
# "doesn't match the negative list" therefore defaults to FIRE, which over-fires
# badly on the real corpus (senior review of PR #1438: 18 of 38 firing strings
# explicitly negated a resolution — "UNRESOLVED.", "Not met —", …). So the check
# requires POSITIVE resolution language rather than the mere ABSENCE of negative
# language: an opener that negates a resolution is skipped, and a field with no
# resolution marker at all is skipped. The `\b` on the marker is what stops
# `resolved` matching inside `unresolved`.
_RESOLUTION_MARKER_RE = re.compile(
    r"\b(resolv(?:ed|es|ing)|resolution|reconcil(?:ed|es|ing)|outweigh(?:s|ed|ing)?"
    r"|adjudicated|preferred assertion)\b",
    re.I,
)
_NON_RESOLUTION_OPENER_RE = re.compile(
    r"^\s*(unresolved|not met|partial|partially met|n/?a\b|not applicable|none)", re.I
)
# `c_NNN` ids named in a stop-criterion's prose, e.g. "resolved (c_001, preferred
# a_019 …)". Used to tell a conclusion that names the conflict it relied on from
# one that names none — a resolved conflicts[] entry the conclusion *names* backs
# it even when it is not cited on resolved_conflict_ids (senior review, PR #1438).
_CONFLICT_ID_RE = re.compile(r"\bc_\d+\b", re.I)


def find_unpersisted_conflict_resolutions(
    research: dict[str, Any] | None,
) -> list[dict[str, Any]]:
    """Shadow-mode post-hoc detector (issue #1317): a WRITTEN CONCLUSION relies on
    a conflict it says was resolved, but no structured ``conflicts[]`` entry backs
    it — the resolution lives only in prose, so the viewer's Conflicts section is
    blank. This is the "concluded-in-prose-but-not-persisted-structurally" class,
    the conflict-side sibling of ``find_citation_nulling_in_conclusions``.

    THE EVIDENCED FAILURE (issue #1317, john-applegarth-family): a research.json
    with 25 assertions and 2 ``proof_summaries`` whose narrative carried a full
    "Conflict Discussion" and whose ``exhaustive_declaration.stop_criteria.
    conflict_resolution`` read "Ella Chase marriage conflict resolved …" — yet
    ``conflicts`` was ``[]`` and every ``resolved_conflict_ids`` was ``[]``. The
    conflict was reasoned through by ``proof-conclusion`` / ``research-exhaustiveness``
    and never routed to ``conflict-resolution`` (the sole writer of ``conflicts[]``,
    per ``docs/specs/research-schema-spec.md`` §155), so nothing was persisted.

    GATED ON A WRITTEN CONCLUSION. Fires only when a ``proof_summaries`` entry
    exists — a run that legitimately stops before concluding has an empty
    ``conflicts[]`` by design and must not fire. For each concluded question, the
    reliance signal is a non-trivial ``conflict_resolution`` stop-criterion on that
    question's ``exhaustive_declaration`` (a *structured* field with bounded
    vocabulary — deliberately NOT the free ``narrative_markdown``, which cannot be
    parsed reliably). A ``conflict_resolution`` that says there was no conflict
    (``_NO_CONFLICT_SUBSTRINGS`` / ``_NO_CONFLICT_EXACT``) is skipped.

    The reliance is BACKED, and no violation fires, when a ``status == "resolved"``
    ``conflicts[]`` entry is linked to the conclusion any of four ways: cited on the
    proof_summary's ``resolved_conflict_ids``; naming this question in its own
    ``blocks_question_ids``; NAMED (its ``c_`` id) in the stop-criterion prose; or —
    when the prose names no ``c_`` id at all — simply existing. Each means the
    conflict was written to ``conflicts[]``, so the viewer's Conflicts section is
    populated and this is not the #1317 miss. A fire therefore means **no resolved
    conflict backs this conclusion**: either ``conflicts[]`` holds no resolved entry
    at all, or the stop-criterion names a ``c_`` id that is not resolved. The fourth
    way is what keeps that true — ``blocks_question_ids`` is schema-required but
    legitimately empty, so without it a resolved conflict could exist, populate the
    viewer, and still be reported as unpersisted.

    SHADOW MODE ONLY: returns records shaped to share ``guardrail_shadow_violations``
    (int ``index``, string ``tool``, ``kind == CONFLICT_UNPERSISTED_KIND``). Never
    fails a run. Because the reliance signal is a text heuristic on one structured
    field, this ships shadow-first to measure the fire rate before any promotion to
    a hard gate — exactly how the citation-nulling detector (#1358) is staged.
    """
    research = research or {}
    proof_summaries = (
        research.get("proof_summaries")
        if isinstance(research.get("proof_summaries"), list)
        else []
    )
    if not proof_summaries:
        return []  # the gate: no written conclusion, nothing is held to a conflict record

    questions = research.get("questions") if isinstance(research.get("questions"), list) else []
    conflicts = research.get("conflicts") if isinstance(research.get("conflicts"), list) else []
    questions_by_id = {q.get("id"): q for q in questions if isinstance(q, dict) and q.get("id")}
    resolved_conflict_ids = {
        c.get("id")
        for c in conflicts
        if isinstance(c, dict) and c.get("status") == "resolved" and c.get("id")
    }
    # A resolved conflict can back a question WITHOUT being cited on the
    # proof_summary's resolved_conflict_ids — via its own schema field
    # conflicts[].blocks_question_ids. Reading only resolved_conflict_ids (senior
    # review of PR #1438) fired on runs that had correctly written the resolved
    # conflict[] entry — the viewer's Conflicts section populated, exactly what
    # #1317 asks for — and then emitted a factually false "no resolved entry backs
    # it". So a question blocked by a resolved conflict counts as backed too.
    resolved_blocked_qids = {
        q
        for c in conflicts
        if isinstance(c, dict) and c.get("status") == "resolved"
        for q in (c.get("blocks_question_ids") or [])
    }

    def _resolution_claimed(question: dict[str, Any]) -> str | None:
        """The stop-criterion text if it asserts a resolution, else None."""
        decl = question.get("exhaustive_declaration")
        if not isinstance(decl, dict):
            return None
        crit = decl.get("stop_criteria")
        if not isinstance(crit, dict):
            return None
        cr = crit.get("conflict_resolution")
        if not isinstance(cr, str):
            return None
        crl = cr.strip().lower()
        if crl in _NO_CONFLICT_EXACT:
            return None
        if any(s in crl for s in _NO_CONFLICT_SUBSTRINGS):
            return None
        if _NON_RESOLUTION_OPENER_RE.match(crl):
            return None  # text opens by negating a resolution ("UNRESOLVED.", "Not met —")
        if not _RESOLUTION_MARKER_RE.search(crl):
            return None  # no positive resolution language — not a resolution claim
        return cr

    violations: list[dict[str, Any]] = []
    seen: set[tuple[Any, Any]] = set()  # one entry per (conclusion, question)
    for ps in proof_summaries:
        if not isinstance(ps, dict):
            continue
        ps_id = ps.get("id")
        qid = ps.get("question_id")
        rcids = (
            ps.get("resolved_conflict_ids")
            if isinstance(ps.get("resolved_conflict_ids"), list)
            else []
        )
        question = questions_by_id.get(qid)
        if not isinstance(question, dict):
            continue  # no linked question to read a reliance signal from
        claimed = _resolution_claimed(question)
        if claimed is None:
            continue  # no conflict claimed (or explicitly "no conflicts") — nothing owed
        # A resolved conflicts[] entry backs this conclusion when it is cited on the
        # proof_summary, blocks this question, is NAMED in the conclusion's prose (a
        # resolved c_ id in the stop-criterion text), or — when the prose names no
        # conflict id at all — simply exists. Any of these means the conflict was
        # written to conflicts[] and the viewer's Conflicts section is populated, so
        # the #1317 miss this detector catches (nothing persisted) does not apply.
        # blocks_question_ids alone is too weak: it is schema-required but
        # legitimately empty, so most resolved conflicts do not carry it (senior
        # review, PR #1438 — mary-dwyer-father / jimmie-jewel-neal wrote a resolved
        # c_001 with blocks_question_ids: [] and were wrongly reported as unpersisted).
        named_ids = set(_CONFLICT_ID_RE.findall(claimed))
        if (
            any(rc in resolved_conflict_ids for rc in rcids)
            or qid in resolved_blocked_qids
            or bool(named_ids & resolved_conflict_ids)
            or (not named_ids and bool(resolved_conflict_ids))
        ):
            continue  # a resolved conflicts[] entry backs it — persisted, not the #1317 miss
        key = (ps_id, qid)
        if key in seen:
            continue
        seen.add(key)
        violations.append(
            {
                "index": -1,  # post-hoc final-state read; there is no tool-call index
                "tool": "research.json",
                "required_skill": "conflict-resolution",
                "question_id": qid,
                "kind": CONFLICT_UNPERSISTED_KIND,
                "detail": (
                    f"proof_summary {ps_id} (question {qid}) relies on a resolved "
                    "conflict per its exhaustive_declaration.stop_criteria."
                    "conflict_resolution, but no resolved conflicts[] entry is linked "
                    "to it (not cited on resolved_conflict_ids, not named in the "
                    "stop-criterion, and no resolved conflict blocks this question)"
                ),
            }
        )
    return violations


def find_relationship_writes_without_warnings_check(
    tool_calls: list[dict[str, Any]] | None,
    tree: dict[str, Any] | None,
    *,
    starting_tree: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    """Shadow-mode post-hoc detector (issue #1193): the run wrote a NEW
    ``ParentChild``/``Couple`` relationship but never called ``person_warnings``,
    the cheapest guardrail in the system (deterministic, no LLM — it reads
    ``tree.gedcomx.json`` and evaluates ~75 predicates, so a call costs one tool
    round-trip). Two runs of the same fixture, same skills, diverged only on
    whether the parentage write was delegated to ``proof-conclusion`` (which
    carries the "run check-warnings after tree writes" step) or inlined by the
    orchestrator (which does not) — and nothing recorded that the guardrail was
    never consulted. This makes that omission visible.

    GATED ON A NEW RELATIONSHIP THIS RUN. Fires only when a ``ParentChild`` or
    ``Couple`` relationship in the final tree is absent from the starting tree
    (diffed on the endpoint tuple, not ``id`` — see ``_relationship_key``). 99 of
    104 fixtures seed such relationships, so an ungated check would fire on seed
    state alone; the diff is what limits it to this run's own product. When no
    starting tree is given, treat everything as new (best-effort), matching
    ``find_effects_without_invocation``.

    KEYED ON THE TOOL, not the ``check-warnings`` skill. The #1193 signal is
    literally "the guardrail tool never ran", so it must catch a direct/ToolSearch
    ``person_warnings`` call and a ``check-warnings`` skill that launches but fails
    before reaching the tool alike. Sub-agent / inside-skill MCP calls surface in
    the flat e2e ``tool_calls`` stream, so a tool-name scan sees ``person_warnings``
    even when it fired inside ``check-warnings``. A call counts as consulting the
    guardrail only if it succeeded (``is_error`` falsy) — a failed call left the
    tree unchecked.

    SHADOW MODE ONLY: returns violation records shaped to share
    ``guardrail_shadow_violations`` with the other shadow sources (an ``int``
    ``index`` and string ``tool`` so ``guardrail_shadow_report``'s formatters
    never hit a ``None`` format spec; ``kind == WARNINGS_UNCHECKED_KIND`` so that
    report counts this class in its own bucket). Never fails a run. Promotion to a
    hard gate — or a mandatory pre/post-write call in the ``/research``
    orchestrator so an inlined write is still gated — is a deliberate follow-up
    (issue #1193, question b), gated on measuring this fire rate across the corpus.
    """
    tree = tree or {}
    relationships = tree.get("relationships") if isinstance(tree.get("relationships"), list) else []

    starting_relationship_keys = {
        _relationship_key(r)
        for r in ((starting_tree or {}).get("relationships") or [])
        if isinstance(r, dict) and r.get("type") in ("ParentChild", "Couple")
    }
    new_relationship = any(
        isinstance(r, dict)
        and r.get("type") in ("ParentChild", "Couple")
        and (starting_tree is None or _relationship_key(r) not in starting_relationship_keys)
        for r in relationships
    )
    if not new_relationship:
        return []  # the gate: nothing was written that a warnings check should have preceded

    # NOTE the polarity: unlike every other `is_error` gate in this module, this
    # one CREDITS a call rather than skipping it — a successful person_warnings
    # means the tree was checked. So the no-project answer has to be excluded
    # from `consulted`, not added to a skip. Get it backwards and a warnings
    # check that never ran is credited as done, which is a MISSED violation and
    # therefore silent (issue #1695).
    consulted = any(
        isinstance(call, dict)
        and bare_tool_name(call.get("tool") or "") == "person_warnings"
        and not did_not_land(call)
        for call in (tool_calls or [])
    )
    if consulted:
        return []

    return [
        {
            "index": -1,  # post-hoc final-state read; there is no tool-call index
            "tool": "tree.gedcomx.json",
            "required_skill": "check-warnings",
            "question_id": None,
            "kind": WARNINGS_UNCHECKED_KIND,
            "detail": (
                "a new ParentChild/Couple relationship was written this run but "
                "person_warnings (the free deterministic guardrail) was never "
                "successfully called"
            ),
        }
    ]
