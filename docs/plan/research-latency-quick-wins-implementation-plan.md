# Research-Latency Quick Wins — Implementation Plan

**Project:** Cowork Genealogy — AI genealogy research assistant
**Status:** IMPLEMENTED — landed on `main` (`184f857d`). Work item A (`tree_edit` `add_source`/`update_source` + tests + `tree-edit-tool-spec.md` + SKILL adoption) and Work item B (closed-enum prose) are both shipped. Retained for provenance.
**Implements:** [`docs/specs/research-latency-quick-wins-spec.md`](../specs/research-latency-quick-wins-spec.md)
**Companion:** [`research-latency-reduction-plan.md`](./research-latency-reduction-plan.md) (the larger, measurement-gated effort)

This is the *how-to-build* for the two changes in the spec. They are independent and
may ship as one PR or two. Work item A is a tool extension; work item B is SKILL prose.

**Reduced blast radius (confirmed in code):** adding operations to `tree_edit` changes
only the tool's own file and schema object — **no edit to `tool-schemas.ts`** (it
imports `treeEditSchema`, `tool-schemas.ts:46,85`) and **no edit to `manifest.json`**
(it lists the tool by name, `manifest.json:63`, which is unchanged). The validate +
backup + atomic-write tail (`tree-edit.ts:262-291`) is shared by all operations, so it
needs no change either. (The spec's Risk section,
`research-latency-quick-wins-spec.md:122-123`, still lists `tool-schemas.ts` +
`manifest.json` as touched — stale; this plan is the accurate account. Align the spec
separately.)

---

## Work item A — `tree_edit`: `add_source` / `update_source`

### Files to touch

| File | Change |
|---|---|
| `packages/engine/mcp-server/src/tools/tree-edit.ts` | New operations: union type, input type, switch cases, schema enum + props, result type |
| `packages/engine/mcp-server/src/types/gedcomx.ts` | Add `author?: string` to `SimplifiedSourceDescription` — documented in `simplified-gedcomx-spec.md:151` + used in examples, but currently missing from the type |
| `packages/engine/mcp-server/src/utils/gedcomx-ids.ts` (verify only) | **Already S-aware** — `maxIdNum` scans `tree.sources[]` (`gedcomx-ids.ts:29`). No change; a unit test confirms `S1`→`S2`. |
| `packages/engine/mcp-server/tests/tools/tree-edit.test.ts` | Tests for both operations |
| `docs/specs/tree-edit-tool-spec.md` | Reflect the two new operations (so `spec-review` covers them) |
| `packages/engine/plugin/skills/record-extraction/SKILL.md` | Step 5c: use `add_source` instead of hand-writing the `S` entry |
| `packages/engine/plugin/skills/proof-conclusion/SKILL.md` | Step 6: use `add_source`/`update_source` |

### Steps (tree-edit.ts)

1. **Union type** (`~line 33`): add `"add_source" | "update_source"` to `TreeEditOperation`.
2. **Input type** (`~line 38/64`): add optional `source?: SimplifiedSourceDescription`
   (the partial/full source object — the type is `SimplifiedSourceDescription`, **not**
   `SimplifiedSource`, which does not exist; see `types/gedcomx.ts:159`) and
   `sourceId?: string`. (`factId`/`nameId`/`relationshipId` already exist; `sourceId` is
   new.) Add `author?: string` to `SimplifiedSourceDescription` first (see Files to
   touch) so a caller-supplied `author` is type-safe.
3. **Switch cases** (in `applyOperation`, after `add_relationship`, before `remove`,
   `~line 220`):
   - `add_source` — structurally mirror **`add_relationship`** (`:213-219`), not
     `add_fact`: sources are top-level (no `requirePerson`, no place resolution, no
     primary swap). Require `input.source`; reject a caller-supplied `id`; allocate
     `const id = nextId(tree, "S")`; push to `tree.sources` (init `tree.sources ??= []`);
     set `assignedIds.source = id`.
   - `update_source` — mirror `update_fact` (`:145-158`) **minus the `requirePerson`
     lookup** (sources aren't person-scoped): require `sourceId` + `source`; `find` the
     existing source in `tree.sources`; `TreeEditError` if not found; merge non-`id` keys
     via the same `for (const [k,v] of Object.entries(input.source))` loop.
   No place resolution / primary-flag handling applies to sources (skip those bits).
4. **ID helper** (`gedcomx-ids.ts`): **no change needed** — `maxIdNum` already scans
   `doc.sources` (and `doc.places`) for the `"S"` prefix (`gedcomx-ids.ts:29`), so
   `nextId(tree,"S")` works today. Verify-only; a unit test asserting `S1`→`S2` locks it
   in.
5. **Schema** (`treeEditSchema`, `:295-363`): add `"add_source"`, `"update_source"` to the
   `operation` enum (`:320`); add `source` (object) and `sourceId` (string) properties
   with descriptions; extend the schema's prose to mention adding/correcting a source.
   `required` stays `["projectPath","operation"]`.
6. **Result type** (`TreeEditResult.assignedIds`): add an optional `source?: string`.
7. **No change** to `tool-schemas.ts` or `manifest.json` (see note above). The shared
   `treeEdit()` tail already runs `validateParsed` then `backupIfExists` +
   `atomicWriteJson` and returns `{ok:false,errors}` on invalid — sources get this free.

### `source` object shape

Simplified-GedcomX tree source (`SimplifiedSourceDescription`; see
`docs/specs/simplified-gedcomx-spec.md` §4.3): `title` (required on add), optional
`author`, `url`, `citation`. **Note:** the TS type currently omits `author` even though
the spec documents it (`simplified-gedcomx-spec.md:151`) and examples use it — add
`author?: string` to the type (Files to touch). `title`-required is enforced by the
shared `validateParsed` tail (`validator.ts:810` requires `[id, title]`), so the op
itself needs no title check. This is the lightweight tree `sources[]` entry (e.g. `S2`
in `tree.gedcomx.json`), distinct from the rich `research.json` `sources[]` that
`research_append` owns.

### Tests (tree-edit.test.ts)

- `add_source`: assigns the next `S<N>`, rejects a caller-supplied `id`, returns
  `assignedIds.source`, and the project validates + writes (with `.bak`).
- `add_source` twice: ids increment (`S1`→`S2`), confirming `nextId(tree,"S")` (covers
  the already-S-aware `gedcomx-ids.ts:29`).
- `add_source`: a caller-supplied `author`/`url` round-trips into the written `S` entry
  (locks in the new `author` type field).
- `update_source`: merges supplied fields, leaves others intact, errors on an unknown
  `sourceId`, refuses to change `id`.
- Missing-argument guards: `add_source` with no `source` → `{ok:false}`; `update_source`
  with no `sourceId` → `{ok:false}`; `update_source` with no `source` → `{ok:false}`.
- A failing case: a `source` with no `title` breaks tree validation, returns `{ok:false}`
  and writes nothing (covers the shared validate-before-persist path for the new op).

### SKILL adoption

- `record-extraction` SKILL.md step 5c (`~lines 461-465`): replace *"This file is not a
  `research_append` section; write it directly"* with a `tree_edit({operation:"add_source",
  source:{…}})` call, one per new source; drop the "written directly / separate validate"
  caveat (the tool validates).
- `proof-conclusion` SKILL.md step 6 (`~lines 286-289`): this is **already tool-first
  prose** — *"add it through the tree (the tool validates the source shape…)"* — which
  promises a `tree_edit` source op that does not exist yet, so the shipped SKILL is
  latently broken today. This is a small clarification (name the operation explicitly:
  `tree_edit({operation:"add_source"})`, or `update_source` to correct an existing `S`
  entry's citation), **not** a hand-write→tool rewrite. Work item A is what makes this
  shipped instruction actually work.

### Verification

- `cd packages/engine/mcp-server && npm test` (the tree_edit suite).
- Run `spec-review` on `tree-edit.ts` against `docs/specs/tree-edit-tool-spec.md`.
- Re-run the `record-extraction` and `proof-conclusion` skill evals — expected delta:
  one fewer hand-edit, identical resulting tree state.
- Optional: extend `dev/try-tree-edit.ts` (if present) with an `add_source` smoke call.

---

## Work item B — Pin closed-vocabulary enums in SKILL prose

### Files to touch

| File | Change |
|---|---|
| `packages/engine/plugin/skills/assertion-classification/SKILL.md` | State valid values where `evidence_type` / `information_quality` / `informant_proximity` are set (`~lines 206-230`) |
| `packages/engine/plugin/skills/record-extraction/SKILL.md` | Same lists at extraction time, where these fields are first written |

### Steps

At the point each field is set, add the valid-value list inline and cite
`docs/specs/research-schema-spec.md` as the source of truth (so the prose can't silently
drift):

- **`evidence_type`** ∈ `direct` | `indirect` | `negative`. Add explicitly:
  *"There is no `no_evidence` value — a fact irrelevant to the open question keeps
  `indirect`. Do not attempt `no_evidence`; the schema rejects it and the write tool
  will refuse the entry."*
- **`information_quality`** ∈ `primary` | `secondary` | `indeterminate`.
- **`informant_proximity`** ∈ `self` | `household_member` | `family_not_present` |
  `official_duty` | `witness` | `unknown`.

### Verification

- Re-run the `assertion-classification` eval: confirm the transcript shows no
  `no_evidence` attempt and no invalid-`informant_proximity` retry (these were the
  wasted loops in the baseline run).
- No code change; nothing to unit-test. The e2e re-measure (reduction plan Phase 0)
  confirms the turn/time delta, but this lands first because it is confident and
  zero-risk.

### Out of scope (a real decision, deferred)

Whether to *add* a `no_evidence` value to the `evidence_type` schema (so the model's
GPS-correct instinct is representable) is a schema change — higher blast radius (schema
+ `validator.ts` + every consumer + the three-places rule in CLAUDE.md). Left to the
reduction plan / a separate schema decision. The full blast-radius analysis and
recommendation are captured in
[`no-evidence-evidence-type-decision.md`](./no-evidence-evidence-type-decision.md).

---

## Sequencing & ownership

1. **Work item A** — developer. Follows the `tree_edit` scaffolding; PR includes the
   tool change, tests, the `tree-edit-tool-spec.md` update, and the two SKILL edits.
   `spec-review` audits the tool against its spec before merge.
2. **Work item B** — genealogist or developer; prose-only.
3. Either order; B has no dependency on A. Both can land in one PR.
4. Neither blocks the reduction plan's Phase 0 re-measure — but landing them first means
   the re-measure already reflects them, which is the point of doing them up front.

## Risk / rollback

- Work item A is additive (new operations); existing `tree_edit` behavior is untouched,
  so rollback is reverting the tool + type + two SKILL edits. Even lower risk than first
  drafted: the `nextId`/`maxIdNum` `"S"`-prefix support is **already present**
  (`gedcomx-ids.ts:29`), so there is no non-trivial code spot — only the additive switch
  cases and a one-line type field, both covered by unit tests.
- Work item B is prose; rollback is a revert with no runtime effect.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Codex Review | `/codex review` | Independent 2nd opinion | 0 | — | — |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | issues_found | 6 findings (1 reframing, 4 corrections, 1 type gap); 0 critical failure-mode gaps; +4 tests; all folded into plan |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | — | — |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

- **VERDICT:** ENG CLEARED — scope accepted as-is, 6 findings resolved into the plan, 0 critical gaps. Work item A reframed as also fixing a latent `proof-conclusion` breakage. Outside-voice (Codex) pass offered but not run (tiny prose + one-op change). Ready to implement.

NO UNRESOLVED DECISIONS
