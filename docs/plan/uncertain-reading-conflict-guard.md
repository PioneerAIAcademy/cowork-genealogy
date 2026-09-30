# Plan: Uncertain [?] reading cannot win a conflict without corroboration

**Issue:** #2940
**Status:** in progress

## Problem

A single OCR pass can overrule the user's reading of an image. When the agent
sets `preferred_assertion_id` to an assertion whose value carries `[?]`
(the structural doubt marker), the conflict is settled on uncertain evidence
with no second record to confirm it.

## Design (decided, lead 2026-09-27)

Key the tool rule on the existing `[?]` doubt marker in assertion values.
No schema change. A `[?]` assertion can win a conflict only when another
record agrees with it.

## Changes

### 1. Tool rule in `research-append.ts` (~L362–402, ~L3127–3143)

**New function** `uncertainPreferenceInvariants(entry, research)` in the
same neighbourhood as `conflictInvariants` (L362). It:

- Returns `[]` when `preferred_assertion_id` is null (deferral is legal).
- Looks up the preferred assertion in `research.assertions` by id.
- Returns `[]` when the preferred assertion does not `hasUncertainReading`.
- Checks for a corroborating assertion. Corroboration requires ALL FOUR:
  1. The corroborator's own value carries no `[?]`.
  2. It is on a different record, compared as `record_id ?? source_id`
     (same key `corroboratingRecordCount` uses at ~L562).
  3. It has the same `fact_type`, and its value equals the preferred value
     once `[?]` is removed, whitespace is collapsed, and case is folded.
  4. It is tied to the same person: it is in this conflict's
     `competing_assertion_ids`, OR a live `person_evidence` row (no
     `superseded_by`) links it to a `person_id` that a live row also
     links the preferred assertion to.
- If no corroborator exists, returns a refusal message naming the two
  routes: a second record, or an assertions update op by id that removes
  the `[?]` from value once the user confirms the reading. Also says
  leaving `preferred_assertion_id` null is legal (same wording as the
  completion gate at ~L2818).
- Does NOT tell the agent to re-extract (§3.4.3 refuses a second copy).

Reads live `research`, not the pre-call snapshot: the corroborating
assertion may be appended in the same batch. This is consistent with how
`personEvidenceInvariants` and `placeContainmentErrors` work.

**Call site** in the `section === "conflicts"` block (~L3127–3143):

- Call `uncertainPreferenceInvariants(resultEntry, research)` and push
  errors, scoped to: `op.op === "append"` OR the update's `fields`
  include `preferred_assertion_id` or `status`. Same scoping pattern as
  the place-containment check at ~L3133–3137.
- Do NOT add it inside the `status === "moot"` early return in
  `conflictInvariants`. The issue says: apply whenever
  `preferred_assertion_id` is non-null, whatever the status —
  including moot.

**Signature change to `conflictInvariants`:** None. The new function is
separate, called from the dispatch block with `research`.

### 2. Tests in `research-append.test.ts`

Add a new `describe` block for the uncertain-preference guard. Tests:

1. **Refuse uncorroborated [?] preference** — conflict resolved preferring
   `a_001` whose value is `"Jannetje [?] van Noord"`, no corroborating
   assertion. Expect refusal.
2. **Accept [?] preference corroborated by another source** — same as
   above, but add `a_003` on a different record with the same fact_type,
   value `"Jannetje van Noord"` (no [?]), linked to the same person.
   Expect success.
3. **Accept non-[?] preference** — standard resolved conflict with clean
   assertion. Expect success (existing test coverage, but explicit here).
4. **Accept unresolved conflict** — conflict left unresolved with no
   preferred. Expect success.
5. **Clean assertion on different record, different person** — `a_003` on
   different record, equal value, but NOT in competing_assertion_ids and
   not linked to the same person via person_evidence. Expect refusal.
6. **Corroborator that itself carries [?]** — `a_003` on different record,
   same fact_type, value `"Jannetje [?] van Noord"`. Expect refusal.
7. **Update touching only description** — update a conflict that already
   prefers an uncorroborated [?], but `fields` only has `description`.
   Expect accepted (scoping: not touching `preferred_assertion_id` or
   `status`).
8. **status: "moot" with [?] preferred_assertion_id** — moot conflict
   preferring a [?] assertion. Expect refusal (must not slip through
   the moot early return).

### 3a. Spec update in `docs/specs/research-schema-spec.md`

Add the invariant to the `conflicts` section (~L773–793), after the
existing field table. Add the four corroboration conditions. No reasoning
in the spec — just the rule.

### 3b. Invariant row in `docs/specs/research-append-tool-spec.md`

Add a row to the invariant table (~L862–865) after the existing
`conflicts` rows, documenting the new guard: section `conflicts`
append or update that (re)sets `preferred_assertion_id` or `status`,
the invariant (uncorroborated [?] preference refused), and the source.

### 4. Prose line in `conflict-resolution/SKILL.md`

One line (the issue's text): "A reading the user disputes is recorded
with [?], and the conflict is settled by another record or by the user."

Check `ls packages/engine/plugin/skills/conflict-resolution` first — if
issue #1852 has landed, this goes in `agents/conflict-resolution.md`
instead. (Checked: skill still exists.)

### 5. Unit scenario in `eval/tests/unit/conflict-resolution/`

New file: `user-disputes-ocr-reading.json`. The user disputes an OCR
reading, a second record in the project agrees with the user. The agent
must:
- Record the conflict
- Not overrule the user
- Cite the second record

Uses an existing scenario with a conflict or creates the fixture inline
via the `scenario` field pointing to a scenario with the needed shape.

## Files touched

- `packages/engine/mcp-server/src/tools/research-append.ts`
- `packages/engine/mcp-server/tests/tools/research-append.test.ts`
- `docs/specs/research-schema-spec.md`
- `docs/specs/research-append-tool-spec.md`
- `packages/engine/plugin/skills/conflict-resolution/SKILL.md`
- `eval/tests/unit/conflict-resolution/user-disputes-ocr-reading.json`
- `eval/fixtures/scenarios/dutch-mother-name-disputed/` (research.json, tree.gedcomx.json, README.md)

## Acceptance

- All 8 tests in step 2 pass.
- Existing conflict tests still pass.
- The eval scenario in step 5 passes on one `make eval-skill
  SKILL=conflict-resolution` run. The run log is committed and
  `check_runlogs.py` does not block the PR. Book the genealogist
  annotator before opening the PR.
- `make test` passes (specifically the research-append test suite).

## Ordering note

PR #2979 edits research-append.ts. This card goes first; keep the diff
local. If #2979 merges first, rebase. If #1852 lands, the prose line
and scenario move to the agent.
