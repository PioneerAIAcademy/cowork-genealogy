"""Guardrail-skill invocation detection.

docs/plan/research-guardrail-bypass-plan.md §4.1/§4.4 — autonomous `/research`
sometimes lets the four GPS guardrail skills (`research-exhaustiveness`,
`proof-conclusion`, `person-evidence`, `conflict-resolution`) get bypassed:
their documented effect lands in the project files without the skill ever
having been successfully invoked. This module is pure matching logic, no I/O,
over the harness's own `tool_calls` list shape
(`{"tool": ..., "args": ..., "response_summary": ..., "is_error": ...}`, built
by `e2e/orchestrator.py`'s message loop) plus the project's persisted
`research.json`/`tree.gedcomx.json`.

Two consumers, both described in the plan:
  - `owning_skills` + `recently_succeeded` — the live, shadow-mode caller-id
    check (§4.1): before a protected write is allowed to proceed, was its
    owning skill successfully invoked recently?
  - `find_effects_without_invocation` — the post-run hard detector (§4.4):
    does the FINAL project state show a guardrail skill's effect with no
    matching successful invocation anywhere in the whole run?
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
    window (see docs/plan/research-guardrail-bypass-plan.md §4.1/§6)."""
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
    how to key each; see docs/plan/research-guardrail-bypass-plan.md §6 on
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
    """Post-run hard detector (§4.4): a guardrail skill's documented effect is
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
    research-guardrail-bypass-plan.md §4.4/§6, this gate is itself just
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

    scored_ids: set[str] = set()
    for entry in tool_calls:
        if entry.get("is_error") is True:
            continue
        if bare_tool_name(entry.get("tool", "")) != "same_person":
            continue
        args = entry.get("args") or {}
        for key in ("primaryId1", "primaryId2"):
            v = args.get(key)
            if isinstance(v, str):
                scored_ids.add(v)

    missing = sorted(pid for pid in linked_new_person_ids if pid not in scored_ids)
    return [
        f"tree person '{pid}' is new this run and has a person_evidence link, but 'same_person' "
        "was never called for it anywhere in the run — the identity was asserted, never scored"
        for pid in missing
    ]
