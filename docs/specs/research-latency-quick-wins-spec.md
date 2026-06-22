# Research-Latency Quick Wins — Spec

**Project:** Cowork Genealogy — AI genealogy research assistant
**Status:** DRAFT, for review (dev + genealogist)
**Scope:** Two high-value, high-confidence, low-blast-radius changes to cut
wasted agent turns/thinking in a research session — landed **before** the
re-measurement gate in [`research-latency-reduction-plan.md`](../plan/research-latency-reduction-plan.md).

---

## 1. Why these two, why now

The latency analysis (see the reduction plan §"Baseline") found that a research
session's wall-clock is ~90% **model generation** (tool/API latency is ~0), and
that two phases dominate: `search-records` and `record-extraction`. The 2026-06-19
persistence-tool migration already removed the biggest mechanical tax (the separate
`validate_research_schema` calls + the array-re-serialization through `Edit`), so the
*right* next step is to re-measure before prioritizing the rest.

But two changes are worth landing **first** because they are correct regardless of
what the re-measure shows, carry near-zero risk, and remove *known* wasted work:

| Change | Value | Confidence | Blast radius |
|---|---|---|---|
| 1. `tree_edit` gains `add_source`/`update_source` | Removes the last hand-edit in the #1-cost phase (`record-extraction`) and in `proof-conclusion` | High — the gap is verified in code | Low — additive op on an existing tool; two SKILLs get *simpler* |
| 2. Pin closed-vocabulary enums in SKILL prose | Kills the `no_evidence` dead-end + invalid-enum validation-retry loops observed in the run | High — the loops are verified in the transcript | None — prose only, no code |

Neither depends on the re-measure. Neither changes a contract other code relies on.

**Explicitly deferred to the reduction plan** (NOT quick wins): `research_append`
batch/`entries[]` (re-touches freshly-migrated skills + their evals; magnitude is
measurement-dependent), the `project`/`researcher_profile` writer, the `init-project`
migration, MCP-tool preloading (runtime-dependent — `allowed-tools` is ignored by the
Agent SDK; see reduction plan §Phase 2), and any auto-chaining of the skill pipeline
(a UX/design decision).

---

## 2. Change 1 — `tree_edit`: `add_source` / `update_source`

### Problem

`tree.gedcomx.json` has a top-level `sources[]` array (the `S1`, `S2`, … source
descriptions). Today **no write tool can add or edit one** outside a record merge:
`tree_edit`'s operations are `add_fact` / `update_fact` / `add_name` / `update_name`
/ `update_person` / `add_person` / `add_relationship` / `remove` (`tree-edit.ts`),
none of which touch `sources[]`; `merge_record_into_tree` only folds in sources
carried on a candidate record. So two skills still author the `S` entry without a
working tool path — in two different ways:

- **`record-extraction`** — step 5c: *"Write `tree.gedcomx.json` — append the `S`
  entry to `sources`. This file is not a `research_append` section; write it
  directly."* (SKILL.md ~lines 461-465) — an explicit hand-write with `Edit`/`Write`.
  This runs once per source, and `record-extraction` is the #1-cost phase.
- **`proof-conclusion`** — step 6 "Sources": *"ensure every source cited in the proof
  has a GedcomX `S` entry. If one is missing, add it through the tree (the tool
  validates the source shape…)"* (SKILL.md ~lines 286-289). This prose is **already
  tool-first** — it promises a `tree_edit` source op that does not exist yet, so the
  shipped SKILL is latently broken today. Work item A is what makes the instruction
  actually work.

Hand-editing forces the model to re-serialize tree JSON and re-derive the next `S`
id, and (pre-migration) triggered a separate validate. It is the one remaining
instance of exactly the pattern the persistence tools were built to eliminate.

### Proposed change

Add two operations to `tree_edit`, following the existing op-dispatch pattern:

- **`add_source`** — append a new source description to `tree.gedcomx.json`
  `sources[]`. Caller passes a `source` object **without an `id`**; the tool
  allocates the next `S<N>` via the existing `nextId(tree, "S")` helper and rejects a
  caller-supplied id (same discipline as `add_person`/`add_fact`).
- **`update_source`** — merge a partial `source` object (skipping `id`) into an
  existing source identified by `sourceId` — mirrors `update_fact`'s `factId` +
  partial `fact` convention.

**`source` object shape** (simplified-GedcomX tree source; see
`docs/specs/simplified-gedcomx-spec.md`): `title` (required), optional `author`,
`url`, `citation`. No nested entries; this is the lightweight tree-level source
description, distinct from the rich `research.json` `sources[]` (which
`research_append` already owns).

**Input schema delta** (additive):

```jsonc
// operation enum gains: "add_source" | "update_source"
{
  "operation": "add_source",
  "source": { "title": "...", "author": "...", "url": "...", "citation": "..." }
}
{
  "operation": "update_source",
  "sourceId": "S3",
  "source": { "citation": "...", "url": "..." }
}
```

**Behavior** (identical discipline to the other `tree_edit` ops):
- Read `tree.gedcomx.json` fresh, mutate in memory.
- `add_source`: reject if `source` carries an `id`; allocate `nextId(tree,"S")`.
- `update_source`: error if `sourceId` not found; merge the partial `source`
  (skipping `id`), exactly as `update_fact` merges its partial `fact`.
- Validate the whole project via `validateParsed(research, tree, {projectPath})`
  before persisting — **no separate `validate_research_schema` needed**.
- On success persist via `backupIfExists` + `atomicWriteJson` (writes the one-deep
  `.bak`, as the existing ops do). On `valid:false` return `{ok:false, errors}` and
  write nothing.
- Return the allocated/updated `sourceId` and `filesWritten: ["tree.gedcomx.json"]`.

### SKILL changes

- `record-extraction` step 5c: replace the hand-write instruction with
  `tree_edit({operation:"add_source", source:{…}})`, one call per new source. Note
  that `tree_edit` validates-before-persist, so the existing "this file is written
  directly" caveat is removed.
- `proof-conclusion` step 6: a small clarification (not a hand-write→tool rewrite) — the
  prose is already tool-first but promises a missing op; name the operation explicitly,
  `tree_edit({operation:"add_source"|"update_source"})`.

### Risk / blast radius

Low. The change is additive — existing `tree_edit` operations are untouched, and the
two SKILL edits *remove* hand-written-JSON instructions (net-simpler skills). The only
files touched: `packages/engine/mcp-server/src/tools/tree-edit.ts` (the op + its
co-located `treeEditSchema`), `src/types/gedcomx.ts` (the `author` field on
`SimplifiedSourceDescription`), the two SKILL.md files, and
`docs/specs/tree-edit-tool-spec.md`. **No edit to `src/tool-schemas.ts`** (it imports
`treeEditSchema`, `tool-schemas.ts:46,85`) or **`manifest.json`** (it lists the tool by
name, `manifest.json:63`) — both are unchanged.

### Verification

- Unit test: `add_source` allocates the next `S` id, rejects a caller id, validates,
  writes atomically; `update_source` merges fields and 404s on a missing id.
- Re-run the `record-extraction` and `proof-conclusion` unit tests/evals — the
  expected behavior is one fewer hand-edit, identical resulting tree state.

---

## 3. Change 2 — Pin closed-vocabulary enums in SKILL prose

### Problem

The session burned real model time exploring **invalid enum values**, then failing
validation and retrying — a pure dead-weight loop:

- `evidence_type`: the agent tried `no_evidence` (a category the GPS three-layer model
  has conceptually but the schema does **not** allow), validation rejected it, and it
  reverted all the changes — a documented multi-turn detour in `assertion-classification`.
- `informant_proximity`: the agent emitted `self_or_household_member` (not a valid
  value), validation rejected it, fix-and-retry.

The schema only allows fixed vocabularies for these fields, but the SKILLs don't state
them inline, so the model guesses and learns the constraint the slow way — via a
validation round-trip. Post-migration the write tool returns the error in-band rather
than via a separate validate, but the *retry turn* and the *deliberation* remain.

### Proposed change

In `assertion-classification` and `record-extraction` SKILL.md, state the valid values
inline at the point each field is set, citing `docs/specs/research-schema-spec.md` as
the source of truth so the prose can't silently drift:

- **`evidence_type`** ∈ `direct` | `indirect` | `negative`. Add explicitly: *"There is
  no `no_evidence` value. A fact that is irrelevant to the open question keeps
  `indirect`; do not attempt `no_evidence` — the schema rejects it."*
- **`information_quality`** ∈ `primary` | `secondary` | `indeterminate`.
- **`informant_proximity`** ∈ `self` | `household_member` | `family_not_present` |
  `official_duty` | `witness` | `unknown`.

(`assertion-classification` owns `evidence_type`/`information_quality`/`informant_*`;
`record-extraction` sets them at extraction time — both should carry the list.)

### Risk / blast radius

None code-wise — prose only, in two SKILL.md files. The one mild risk is
**vocabulary drift** between the prose and the schema; mitigated by citing
`research-schema-spec.md` as canonical and keeping the lists in one place per skill.

### Out of scope (a real decision, deferred)

Whether to *add* a `no_evidence` value to the `evidence_type` schema (so the model's
GPS-correct instinct is representable) is a schema design question — higher blast
radius (schema + `validator.ts` + every consumer + the three-places rule in CLAUDE.md)
and not a quick win. Left to the reduction plan / a separate schema decision. This
change takes the low-blast-radius path: tell the model the valid values.

### Verification

- Re-run `assertion-classification` unit tests/evals: expect no `no_evidence` attempt
  and no invalid-`informant_proximity` retry in the transcript.
- The e2e re-measure (reduction plan Phase 0) confirms the turn/time delta, but this
  change lands first because it is confident and zero-risk regardless.

---

## 4. Sequencing & ownership

- Both changes are independent and can land in one PR or two.
- Change 1: developer (tool op + schema + manifest + 2 SKILL edits + unit test +
  spec update). Follows the `tree_edit` scaffolding; `spec-review` audits against
  `tree-edit-tool-spec.md`.
- Change 2: genealogist or developer (prose only).
- Neither blocks, nor is blocked by, the reduction plan's Phase 0 re-measure — but
  landing them first means the re-measure already reflects them.
