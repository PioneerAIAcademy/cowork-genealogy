# Adding a `no_evidence` value to `evidence_type` — blast-radius & decision record

**Status:** DEFERRED (recommend *not* doing it as a quick fix; see Recommendation).
**Date:** 2026-06-21.
**Context:** the research-latency quick-wins work deferred this as out of scope; this doc is the captured analysis so it does not have to be re-derived. Cited line numbers are point-in-time (verified 2026-06-21) — confirm against current files before acting.

---

## The question

`evidence_type` is a closed enum `direct | indirect | negative`. Skills repeatedly observe the model *try* to write a fourth value, `no_evidence`, for a fact that is irrelevant to every open research question — the model's instinct is GPS-correct (the BCG three-layer model genuinely has a fourth "No Evidence" relationship), but the schema rejects it, costing retry turns. The quick-wins work pinned the closed set in SKILL prose to stop the retries. Should we instead make `no_evidence` a *real* enum value?

## TL;DR

**Mechanically cheap and backward-compatible; semantically expensive.** It is an enum-**value** widening, not a required-**field** add, so it breaks no existing data. But it is **loud-safe / silent-risky**: validation won't catch the places that now silently miscount the new value, and the field's scalar shape can't represent "no evidence" honestly. **Recommendation: don't add it as a quick win** — the retry pain is already fixed by the prose pin. If pursued, do it as a deliberate schema change with the design decisions below settled first.

## Why this is *not* like adding a required field

The expensive, fixture-breaking schema change is adding a **required field** (see the sibling note: it breaks `eval/fixtures/scenarios/*/research.json` and Python stubs because `additionalProperties:false` + required-key validation fails on every doc lacking the field).

Adding an enum **value** is the opposite: validation is allow-list membership (`validator.ts` `checkEnum` → `validValues.has(value)`; JSON-Schema `enum`). **Widening an allow-list never invalidates data that used the narrower set.** All 471 `evidence_type` occurrences across 41 fixtures (250 `direct` / 220 `indirect` / 1 `negative`) stay valid; nothing needs a backfill.

| | Required-field add | Enum-value add (this) |
|---|---|---|
| Existing data | **breaks loudly** (validation fails everywhere) | **stays valid** (membership widening) |
| Risk profile | loud-risky / silent-safe | **loud-safe / silent-risky** |
| Where the real risk is | mechanical backfill of every doc | consumers silently miscounting the new value |

## Definition edit sites (~6) — and why CLAUDE.md's "three places" rule undercounts here

`evidence_type` is defined/validated in **two parallel schema trees plus a hand-maintained validator Set plus a TS union**:

| # | Site | Note |
|---|---|---|
| 1 | `docs/specs/schemas/enums.schema.json:25` (`$defs.evidence_type`) | **Canonical** enum. `research.schema.json` only `$ref`s it (`:431`, required at `:405`) — editing `research.schema.json` itself does nothing. |
| 2 | `packages/engine/mcp-server/src/validation/validator.ts:31` (`CLOSED_ENUMS`) | Hand-maintained `Set`, **not** derived from the JSON Schema. Rebuild the `build/` artifact after. |
| 3 | `docs/specs/research-schema-spec.md:69` | §4 shared-enums table. |
| 4 | `docs/specs/research-schema-spec.md:390` | §5.6 per-field row ("Direct, Indirect, or Negative"). |
| 5 | `packages/schema/schemas/enums.schema.json:25` | **Second, independent copy** of the enum (web/monorepo overlay). |
| 6 | `packages/schema/src/index.ts:13` (`export type EvidenceType`) | Hand-maintained TS union, re-exported to viewer-ui / web / server. |

Plus **semantic prose that must be hand-written, not just appended to a list**: the §5.6 "Negative evidence / dog not barking" paragraph (`research-schema-spec.md:370`) is the *only* place the negative-family values are disambiguated; it ties `negative` to `record_role:"absent"` + a real `source_id`. A `no_evidence` value needs prose drawing the line between `negative` (meaningful expected-but-absent finding) and `no_evidence` (present but irrelevant), and stating its `record_role`/`source_id` expectations.


> **Meta-finding (fixed in this PR):** CLAUDE.md's "three places" rule (the `research_profile`/schema-extension paragraph) was **inaccurate for an enum-value change** — it named `research.schema.json` (wrong file — the enum lives in `enums.schema.json` via `$ref`) and omitted the `packages/schema` copy + the `EvidenceType` TS union. It has been corrected into two checklists (new-field vs. enum-value).

## Code consumers — essentially zero

- **MCP server `src/`: no consumers.** The token `evidence_type` appears 0× under `packages/engine/mcp-server/src/`. `research-append` treats assertions as opaque pass-through (spread fields, assign ids, validate). Adding the value is transparent to all tool code.
- **Viewer is data-derived:** `AssertionsSection` builds its filter from values present in the data, so `no_evidence` surfaces automatically; `StatusBadge` falls back to a gray "no evidence" badge (add a color entry if a deliberate one is wanted). No hardcoded list to edit.
- **Validator has no value-specific branch:** there is no special-casing of `negative` in `validator.ts`. The §5.6 negative-evidence rules (`record_role:"absent"`, `source_id` present) are **documented but not machine-enforced**. So any cross-field rule `no_evidence` needs is **new logic to write**, not a tweak.

## The real cost: prose + semantics

1. **Two guards just landed would have to be reversed.** They now assert the set is closed and `no_evidence` is rejected — that becomes false:
   - `record-extraction/SKILL.md:345,347`
   - `assertion-classification/SKILL.md:146,149,226,235`
   - `assertion-classification/references/three-layer-model.md` already teaches "No Evidence" as a real 4th category (as a *concept*) — currently in tension with the guards; promoting the value reconciles them but requires editing that model + the Direct/Indirect/Negative subsections + Standard-40 phrasing.

2. **The semantic crux — scalar vs. (fact, question) pair.** "No evidence" is a property of a **(fact, question) pair**, but `evidence_type` is a **single scalar** on the assertion (relevance lives in the `extracted_for_question_ids` *list*). One assertion can be `direct` for q1 and no-evidence for q2; a scalar can't express that. A bare value silently commits to "irrelevant to *all* listed questions," which **goes stale the moment a new question opens** (assertion-classification §4 already warns the type changes with new questions — but nothing recomputes it).

3. **Silent miscounting in consumers — the part no validator catches.** `proof-conclusion` quality scoring (`SKILL.md:294`), `conflict-resolution` weighing, `timeline`, and `hypothesis-tracking` (`SKILL.md:209` filters supporting assertions on `evidence_type:"direct"`) all treat every assertion as carrying weight. A `no_evidence` assertion would silently enter analysis / scoring unless each is taught to exclude it.

4. **Extraction-time sequencing.** At extraction, open questions may not exist yet (opportunistic extraction writes empty `extracted_for_question_ids`), so the "correct" value would be `no_evidence` for almost everything → floods the field → defeats its purpose. The current best-effort-`indirect`-then-refine workflow exists *precisely because* the field is required but questions arrive later.

## Eval impact

Fixtures don't break (value widening). But:
- Rubrics that **grade** `evidence_type`: `eval/tests/unit/record-extraction/rubric.md` (Evidence-type accuracy) and `eval/tests/unit/assertion-classification/rubric.md` (Layer-3) enumerate only the three values — extend or the judge can't reward/penalize the 4th.
- Negative-control tests use "no evidence" as a *concept* to reject: `assertion-classification/negative-evidence-will-omission.json` and `no-open-questions-guard.json` would need rewording.
- Python goldens assert exact values (`test_assertion_classification.py` demands `a_001 == "direct"`) — update any whose expected classification legitimately becomes `no_evidence`.
- **Zero positive coverage** today — a new scenario fixture + a validator (none exists; the negative-evidence validators key only on `=="negative"`) would be needed.

## Design decisions to settle *before* this is safe

1. **Scalar vs. per-question relevance.** Does `no_evidence` mean "irrelevant to all listed questions" (lossy scalar, goes stale on question churn) — or should relevance move to a per-question structure on `extracted_for_question_ids` (the larger change that actually fixes the root mismatch)? Adding the bare value picks the lossy interpretation by default.
2. **Who may write it, and when.** Extraction-time (floods the field) vs. classification-time-only (then record-extraction must forbid emitting it).
3. **Re-classification lifecycle.** Define the trigger/owner that re-evaluates `no_evidence` assertions when a new question opens. Without it the values are write-once and silently rot.
4. **Structural convention + invariant.** Mirror the crispness §5.6 gives `negative` (role/source). Confirm a `no_evidence` assertion keeps its real role and is barred from `absent`-role and from `proof_summary.supporting_assertion_ids`.
5. **Is it worth it at all?** The model's actual pain (wasted retries) is already removed by the prose pin (PR #433). Weigh semantic honesty against touching every consumer.

## Recommendation

**Do not add `no_evidence` as a quick fix.** The retry-loop pain is already addressed by the lower-blast-radius prose pin landed in PR #433 (state the valid values inline + "there is no `no_evidence`; keep best-effort `indirect`"), which kills the loop without touching a single consumer. The model's instinct is GPS-correct, but the scalar `evidence_type` cannot represent "no evidence" honestly, and a bare enum add buys semantic honesty at the cost of new exclusion logic in four consumers (none validator-caught) plus an under-specified value. If the team later decides the honesty is worth it, do it deliberately: settle decision #1 (the root mismatch) first, define the structural convention + eval invariant + re-classification trigger, and land all ~6 definition sites + both skills + the eval rubrics/goldens **at once**.

## If we do proceed — the one-pass checklist

- [ ] `docs/specs/schemas/enums.schema.json` `$defs.evidence_type` enum
- [ ] `packages/schema/schemas/enums.schema.json` enum (second copy)
- [ ] `packages/schema/src/index.ts` `EvidenceType` union
- [ ] `packages/engine/mcp-server/src/validation/validator.ts` `CLOSED_ENUMS.evidence_type` Set (+ rebuild `build/`)
- [ ] `docs/specs/research-schema-spec.md` §4 table (`:69`), §5.6 field row (`:390`), §5.6 negative-evidence prose (`:370` — add the negative-vs-no_evidence distinction + role/source convention)
- [ ] Reverse the guards: `record-extraction/SKILL.md`, `assertion-classification/SKILL.md`, `three-layer-model.md`
- [ ] Add exclusion rules: `proof-conclusion`, `conflict-resolution`, `timeline`, `hypothesis-tracking`
- [ ] Eval: `record-extraction`/`assertion-classification` `rubric.md`, the two negative-control tests, Python goldens, + a new positive-coverage fixture & validator
- [x] ~~Fix CLAUDE.md's "three places" rule~~ — done in this PR (now two checklists: new-field vs. enum-value)
