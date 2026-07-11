# `tree_edit` — single-edit tree mutation tool — Spec

> **Status:** New (2026-06-19). The sibling of the merge tools
> (`merge-gedcomx-spec.md` §5b): where those collapse persons, this one does the
> **ad-hoc single-entity edits** the `tree-edit` skill performs today by hand —
> add/correct a fact or name, add a person or relationship, and the one permitted
> deletion (tier downgrade). It reuses the exact write layer shipped with the
> merge tools (`validate-project-refactor-spec.md` §10) so the last hand-edited-
> JSON path in `tree-edit` becomes a validated, atomic, id-assigning tool call.

```
tree_edit({ projectPath, operation, ...operationFields }) -> compact summary
```

A single tool with an `operation` discriminator. The LLM supplies the **content
judgment** (which fact, what value, which relationship); the tool does the
error-prone clerical work — id allocation, the primary/preferred flag swaps,
`standard_place` resolution, array mutation, validate-before-persist, and the
atomic write.

---

## 1. Why this exists

`tree-edit/SKILL.md` §"Ad-hoc edits" (lines 52–124) is hand-done JSON surgery on
`tree.gedcomx.json`, and the skill itself warns the cost of getting it wrong:
*"Get this right on the first write — validation failures cost turns"* and *"Ad-hoc
edits should be rare."* The mechanical hazards are exactly the ones the merge tools
already removed for the collapse case:

- **Id allocation by hand** — "Generate the next available `F` prefix ID"
  (`SKILL.md:67`), "Use synthetic IDs (`I` prefix + next number)" (`SKILL.md:85`).
  A reused or skipped id corrupts the tree.
- **The primary-flag swap** — "add `primary: true` (and remove `primary` from any
  existing fact of the same type)" (`SKILL.md:70–72`). Forgetting the second half
  leaves two primaries of one type.
- **`standard_place` re-resolution** — "Whenever you set a fact's `place`, also set
  `standard_place`: call `place_search` … use the first result's `standardPlace`"
  (`SKILL.md:68–70`), repeated for corrections (`SKILL.md:79–81`). Easy to forget on
  a place edit, leaving a stale standardized place.
- **Re-serialize-and-revalidate** — every edit ends at "call
  `validate_research_schema` … fix errors" (`SKILL.md:243–248`), the whole-file
  rewrite loop this whole tool direction exists to kill.

The merge work already built the machinery (atomic write, `validateParsed`,
`.bak`); a single-entity edit is a strict subset of it.

---

## 2. Scope

In scope — the `tree-edit` ad-hoc operations (`SKILL.md:52–124`):

| Operation | Replaces (SKILL.md) |
|-----------|---------------------|
| `add_fact` | "Adding a fact to a person" |
| `update_fact` | "Correcting a value" (fact date/place/value) |
| `add_name` / `update_name` | "Correcting a value" (name given/surname) |
| `update_person` | gender/ark correction |
| `add_person` | "Adding a person" |
| `add_relationship` | "Adding a relationship" |
| `add_source` / `update_source` | source-description (`S` entry) add/correct — record-extraction step 5c, proof-conclusion step 6 |
| `remove` | "Removing concluded data (tier downgrade)" — facts/relationships only |

In scope for sources: the lightweight **tree** `sources[]` entry (the `S`
description in `tree.gedcomx.json`, `simplified-gedcomx-spec.md` §4.3) — `title`,
optional `author`/`url`/`citation`. Out of scope: the rich `research.json`
`sources[]` (citation, repository, classification, …), which `research_append`
owns; the two are linked by `gedcomx_source_description_id`.

Out of scope: **person merging / person removal** — that is the merge tools'
job (`merge_tree_persons` removes a collapsed person and remaps `research.json`);
`tree_edit` never deletes a person. Also out of scope: `research.json` edits
(those are `research_append`), and `check-warnings` (a separate skill
step, run after — see §8).

---

## 3. Evidence base (seen directly)

| Fact | Source |
|------|--------|
| Ad-hoc fact/name/person/relationship payload shapes + id rules + primary swap + standard_place resolution | `packages/engine/plugin/skills/tree-edit/SKILL.md:52–124` |
| Deletion is permitted ONLY for facts/relationships on a tier downgrade | `tree-edit/SKILL.md:118–124` |
| Simplified ids are `I/N/F/R/S`, "unique within their array, immutable once created" | `docs/specs/simplified-gedcomx-spec.md:61–69` |
| `SimplifiedFact.primary?`, `SimplifiedName.preferred?`, relationship `parent/child` vs `person1/person2` | `src/types/gedcomx.ts:104–151` |
| Shared write layer: `atomicWriteJson`, `assertInsideProject`, `validateParsed`, exported `validateGedcomx` | `src/utils/project-io.ts`, `src/validation/validator.ts` (shipped) |
| `.bak`-before-overwrite + compact-return + validate-before-persist pattern | `src/tools/merge-record-into-tree.ts` (Mode 1 writes only the tree) |
| Per-prefix max-id logic already exists (private) | `src/utils/merge-gedcomx.ts` `maxIdNum` |
| Name→standard place resolver | `src/utils/place-resolver.ts` `resolveStandardPlace` (`place_search` returns `standardPlace`) |

---

## 4. The tool

```typescript
tree_edit({
  projectPath: string,
  operation:
    | "add_fact" | "update_fact"
    | "add_name" | "update_name" | "update_person"
    | "add_person" | "add_relationship"
    | "add_source" | "update_source" | "remove",

  // ── targeting (per operation) ──
  personId?: string,          // add_fact/update_fact (person-held facts — exactly one of
                              //   personId | relationshipId), add_name, update_name, update_person
  factId?: string,            // update_fact, remove
  nameId?: string,            // update_name
  relationshipId?: string,    // add_fact/update_fact (Couple-held facts — exactly one of
                              //   personId | relationshipId), remove
  sourceId?: string,          // update_source

  // ── payloads (snake_case, NO id — the tool assigns) ──
  fact?: SimplifiedFact,            // add_fact (full) / update_fact (fields to set)
  name?: SimplifiedName,            // add_name (full) / update_name (fields to set)
  person?: SimplifiedPerson,        // add_person (full; nested names get N ids too)
  relationship?: SimplifiedRelationship, // add_relationship (full)
  source?: SimplifiedSourceDescription,  // add_source (full) / update_source (fields to set)
  gender?: string, ark?: string,    // update_person

  resolveStandardPlace?: boolean,   // default true: auto-resolve standard_place when place is set
})
```

### 4.1 Per-operation contract

- **`add_fact`** `{ personId | relationshipId, fact }` — append `fact` to the
  target's `facts`, assigning the next `F` id above the tree max. The target is
  **exactly one of** `personId` (a person-held fact) or `relationshipId` (a
  Couple-held fact — Marriage, Divorce, … live on the Couple relationship, never
  duplicated onto each spouse); supplying both or neither is an input error, and
  a `relationshipId` that names a `ParentChild` is an input error (the tree
  schema allows `facts` only on Couples). If `fact.primary === true`, clear
  `primary` on every other fact of the **same `type`** on that holder. If
  `fact.place` is set and `resolveStandardPlace !== false` and no
  `fact.standard_place` was supplied, resolve it via `resolveStandardPlace` (null
  when nothing resolves).
- **`update_fact`** `{ personId | relationshipId, factId, fact }` — shallow-merge
  the provided `fact` fields onto the existing fact (id immutable) on the same
  exactly-one-target contract as `add_fact`; the `factId` must live on the named
  holder. If `place` changed (and not explicitly accompanied by
  `standard_place`), re-resolve `standard_place`. If `primary: true` set, run the
  same-type swap on that holder.
- **`add_name`** `{ personId, name }` — append, assign next `N`. If
  `name.preferred === true`, clear `preferred` on the person's other names.
- **`update_name`** `{ personId, nameId, name }` — shallow-merge fields; preferred
  swap if set true.
- **`update_person`** `{ personId, gender?, ark? }` — set scalar person fields.
- **`add_person`** `{ person }` — append a new person, assigning the next `I` id,
  an `N` id for each nested name (exactly-one `preferred`), and an `F` id for each
  nested fact (reported as `assignedIds.facts`). Inline facts follow the same rules
  as `add_fact`: a caller-supplied fact `id` is rejected ("add_person facts must not
  carry ids — the tool assigns them"), and each fact's `standard_place` is resolved
  from `place` when unset. Synthesized stubs omit `ark`
  (`simplified-gedcomx-spec.md` §4.6).
- **`add_relationship`** `{ relationship }` — append, assign next `R`. Facts
  supplied on a new **Couple** relationship (e.g. its Marriage) get the same
  treatment as `add_fact`: tool-assigned `F` ids (caller-supplied ids rejected),
  `standard_place` resolution, `assignedIds.facts`. Facts on a `ParentChild` are an
  input error. Endpoint
  integrity (`parent`/`child` for `ParentChild`, `person1`/`person2` for `Couple`
  reference existing persons — tree persons or FS ids already present) and shape (no
  `person1` on a `ParentChild`) are enforced by the final whole-tree validation pass
  (§4.3, §5), not by an inline check in the apply step — so within a batch an endpoint
  added by an earlier op is accepted.
- **`add_source`** `{ source }` — append `source` to the tree's `sources`, assigning
  the next `S` id above the tree max (top-level, like `add_relationship` — no person
  scope, no place resolution, no primary swap). A caller-supplied `id` is rejected.
  `title` is required, enforced by the shared validation pass (`validator.ts`
  requires `[id, title]` on each tree source), so a titleless source writes nothing.
- **`update_source`** `{ sourceId, source }` — shallow-merge the provided `source`
  fields onto the existing source (`id` immutable). Errors if `sourceId` is not found
  in the on-disk tree.
- **`remove`** `{ factId }` **or** `{ relationshipId }` — delete that entry. **Only
  facts and relationships** — a `personId` here is an error (person removal is
  `merge_tree_persons`).

**Fact payload shape (all fact write paths).** On every path that writes a fact —
`add_fact`, `update_fact`, `add_person` inline facts, `add_relationship` facts —
the scalar fact fields `date`, `standard_date`, `place`, `standard_place`, and
`value` must be **plain strings** when present (`simplified-gedcomx-spec.md` §4.1, §4.5).
Anything else (most commonly a raw-GedcomX nested `date: { original, formal }`
object, but also `null` or an array) is rejected at write time with an input error
naming the op, the field, and the expected shape, before validation runs. The final
whole-tree validation would also reject these (`'date' must be a string`), but the
write-time check attributes the error to the offending op (`ops[i]: …` in a batch)
instead of a persons-index path — this closed the e2e failure where an accepted
malformed nested date later crashed `person_warnings` date parsing.

### 4.2 Return value (compact — never the tree)

```typescript
{
  ok: true,
  operation: string,
  assignedIds?: {                 // ids the tool allocated, for narration
    person?: string, fact?: string, name?: string,
    relationship?: string, source?: string,
    names?: string[],             // add_person nested names
    facts?: string[],             // add_person / add_relationship nested facts
  },
  filesWritten: ["tree.gedcomx.json"],
  validation: { valid: true, warnings: string[] },
}
// on failure: { ok: false, errors: string[] } — nothing written
```

### 4.3 Batch form (`ops`) — several edits in one call

To make several edits at once (e.g. a record's source plus its sibling stubs), pass
an optional `ops` array instead of the top-level `operation`/targeting/payload fields
(ignored when `ops` is present). Each op is the same `{ operation, ...fields }` the
single form takes:

```typescript
tree_edit({
  projectPath,
  ops: [
    { operation: "add_source", source: {...} },
    { operation: "add_person", person: {...} },   // sibling stub
    { operation: "add_fact",   personId: "I3", fact: {...} },
  ],
})
// → { ok: true, results: [{ operation, assignedIds? }, ...], filesWritten: ["tree.gedcomx.json"], validation }
// on failure: { ok: false, errors: ["ops[<i>]: <msg>"] } — nothing written
```

Semantics (decision: `docs/plan/e2e-research-runtime-speedup-plan.md` §6 Q1):

- **All-or-nothing.** Every op applies to one in-memory tree; the whole tree is
  **validated once** and written **once** (one `.bak` reflecting pre-batch state). Any
  op's precondition throw or the final validation failure writes **nothing**. (A
  best-effort `standard_place` resolution miss does not throw — it leaves the field
  unset and adds a warning; it never aborts the batch. See §7.)
- **Per-op error indexing.** A failure on op *i* returns `ops[<i>]: <msg>`.
- **Intra-batch id assignment.** `nextId` rescans the live tree per op, so consecutive
  adds get consecutive `F`/`N`/`I`/`R`/`S` ids, and a later op may reference a person
  added by an earlier op (e.g. `add_person` then `add_relationship` whose endpoint is
  the predicted `I` id). Endpoint/reference integrity is enforced by the **single final
  whole-tree validation**, not per-op, so an `add_person` + `add_relationship` pair in
  one batch validates because the new person is present by validation time.
- **Cross-tool ordering is unchanged.** `tree_edit` and `research_append` remain two
  separate tools/calls; an `add_person` here assigns the `I` id that a later
  `research_append` `person_evidence` op references, so the `tree_edit` batch must
  commit before that `research_append` batch.

The persisted tree shape is unchanged — `ops` changes only the number of write calls.

**Stringified-argument tolerance.** The model occasionally serializes a large or
deeply nested argument as a JSON **string** rather than inline JSON. Since the input
schema declares `ops` as an array and the single-op payloads (`fact`, `name`,
`person`, `relationship`, `source`) as objects, a string value is unambiguously a
mis-serialization. The tool JSON-parses a string-valued `ops` (and those single-op
nested objects) before any shape check (`src/utils/coerce-json-arg.ts`); an
unparseable string falls through to the normal error (e.g. ``` `ops` must be a
non-empty array ```). Not a supported call form — callers should pass real JSON — but
it stops a correct-but-stringified batch from being rejected into a slow
one-op-per-call fallback. `research_append` applies the same tolerance to its
`ops`/`entry`/`fields`; see that spec (§3.3) for the originating rationale.

---

## 5. Persistence — validate-before-persist, atomic, tree-only

Sequence (mirrors `merge_record_into_tree`):

1. Read `tree.gedcomx.json` fresh from disk (ids checked against current state;
   a stale `factId`/`personId`/`relationshipId` is a clear error, not a silent
   no-op), then **heal legacy shapes** (`src/validation/tree-sanitize.ts`):
   trees written before the validator tightening — `preferred:/primary: false`
   from the old merge core, top-level `places[]`, person-level `sources`,
   unknown keys, missing ids, string quality — are repaired in memory with one
   warning per healed class, so a pre-tightening project is never bricked. A
   successful edit persists the healed document (a one-shot migration).
   Ambiguous problems (dangling refs, swapped endpoint keys, duplicate ids)
   are NOT healed and still fail validation. Read `research.json` too — needed
   for the cross-file validation pass.
2. Apply the operation **in memory**: allocate ids, run the primary/preferred
   swaps, resolve `standard_place`.
3. **Validate** the would-be tree with `validateParsed(research, tree, { projectPath })`
   before any write. If invalid → write nothing, return `{ ok: false, errors }`.
4. Persist: back up `tree.gedcomx.json` → `tree.gedcomx.json.bak`, then
   `atomicWriteJson` the new tree. **Only `tree.gedcomx.json` is written** —
   `research.json` is untouched (ad-hoc adds create ids nothing references yet;
   corrections change values, not ids; `remove` deletes facts/relationships, not
   persons — so no person-id reference can dangle). This is the Mode-1 write shape.

> **Reuse, don't reinvent.** Id allocation needs the per-prefix max that
> `merge-gedcomx.ts` already computes privately as `maxIdNum`; with a second
> consumer now, lift it to a shared `src/utils/gedcomx-ids.ts` (the repo's
> "second concrete need → factor it out" rule) and have both call it. The persist
> half is `atomicWriteJson` + `backupIfExists` + `validateParsed`, all shipped.

> **Recovery, not undo** (same caveat as the merge tools): validate-before-persist
> guarantees schema-valid, not *correct*. The `.bak` is the one-deep safety net for
> a wrong-but-valid edit; there is no undo.

---

## 6. Decisions recorded

- **One tool with an `operation` discriminator, not one tool per edit.** Follows
  this repo's "don't create one MCP tool per endpoint — use generic tools with
  parameters" rule (CLAUDE.md) and keeps Claude's tool list lean. The ten
  operations share the entire read → apply → validate → backup → write pipeline;
  only the in-memory mutation differs. *Rejected:* `tree_add_fact`,
  `tree_add_person`, … (ten near-identical tools, ten schema entries, more
  context for no behavioral gain). The merge tools are two tools only because they
  have **different side effects** (one writes one file, the other two + a remap);
  every `tree_edit` operation has the *same* side effect (write the tree), so the
  split that justified two merge tools does not apply here.
- **`standard_place` resolution is internal and on by default.** Removes the
  "call `place_search`, copy the first result's `standardPlace`" hand-step
  (`SKILL.md:68–70`) and makes `place`/`standard_place` atomic. Overridable:
  pass `standard_place` explicitly, or `resolveStandardPlace: false`, to skip the
  network call.
- **`remove` is fact/relationship-only.** The skill permits deletion only on a
  tier downgrade (`SKILL.md:118–124`); person removal is structurally reserved to
  the merge tools, so `tree_edit` cannot delete a person.

---

## 7. Errors / edge cases

| Condition | Behavior |
|-----------|----------|
| `projectPath` missing `tree.gedcomx.json` / invalid JSON | input error; write nothing |
| `personId` / `factId` / `nameId` / `relationshipId` / `sourceId` not found in the on-disk tree | staleness error; write nothing |
| `operation` requires a payload that is absent (e.g. `add_fact` with no `fact`, `add_source` with no `source`, `update_source` with no `sourceId`/`source`) | input error |
| `add_source` / `update_source` payload carries an `id` | rejected (add) / ignored (update — `id` is immutable) |
| `add_source` with a source missing `title` | validation failure; write nothing (the shared validate-before-persist pass requires `[id, title]`) |
| `add_relationship` endpoint references a non-existent person, or field shape mismatches the `type` | input error (also caught by validation) |
| `add_fact` / `update_fact` with both or neither of `personId` / `relationshipId` | input error — "requires exactly one of `personId` or `relationshipId`" |
| `add_fact` / `update_fact` targeting a `ParentChild` relationship, or `add_relationship` with facts on a `ParentChild` | input error — facts live only on Couple relationships |
| A fact payload (any write path) with a non-string `date` / `standard_date` / `place` / `standard_place` / `value` — e.g. a nested `{ original, formal }` date object | input error naming the field and expected shape; write nothing (§4.1 "Fact payload shape") |
| `add_person` inline fact / `add_relationship` fact carries an `id` | input error — the tool assigns `F` ids |
| `remove` with a `personId` (attempt to delete a person) | input error — use `merge_tree_persons` |
| `resolveStandardPlace` network call fails | best-effort: set `standard_place: null`, add a warning; never fail the edit on a place-resolution miss |
| Resulting tree fails project validation | write nothing; return `{ ok: false, errors }` |

---

## 8. Boundary — tool vs. caller

The tool does the **structural** edit (id assignment, swaps, schema validation).
The caller (`tree-edit` skill) still:

- decides the content (which fact/value/relationship, justified by a source);
- runs **`check-warnings`** after the edit to catch genealogical impossibilities
  the structural pass does not (parent younger than child, etc.) — the same
  division of labor the merge spec sets (`merge-gedcomx-spec.md` §10);
- no longer hand-edits JSON, hand-allocates ids, or calls
  `validate_research_schema` itself — the tool does the structural validate.

---

## 9. Test plan (vitest, mirroring the merge tool tests)

- **add_fact** — appends with the next `F` id; `primary: true` clears the prior
  same-type primary; `place` set → `standard_place` resolved (mock the resolver);
  only `tree.gedcomx.json` written; `.bak` created; project validates.
  Relationship-targeted: `relationshipId` appends to the Couple's own `facts`
  (same F id / primary swap / place resolution; nothing lands on either spouse);
  both/neither of `personId`/`relationshipId` rejected; `ParentChild` target
  rejected; stale `relationshipId` rejected.
- **update_fact** — field merge by `factId`; a place change re-resolves
  `standard_place`; id unchanged. Also merges by `relationshipId` + `factId` on a
  Couple-held fact; a `factId` not on the named holder errors.
- **add_name / update_name** — `N` id assigned; `preferred: true` clears other
  preferred; exactly one preferred remains.
- **update_person** — gender/ark set; nothing else changed.
- **add_person** — `I` id + `N` ids assigned; stub omits `ark`; inline facts get
  `F` ids (surfaced as `assignedIds.facts`) with `standard_place` resolution; an
  inline fact carrying an id is rejected.
- **add_relationship** — `R` id assigned; endpoints validated; `ParentChild` with
  `person1` rejected; Couple facts get `F` ids, caller-supplied fact ids rejected.
- **fact payload shape** — a nested `{ original }` date (or non-string
  place/standard_date/…) is rejected on every fact write path (add_fact person +
  relationship, update_fact, add_person inline, add_relationship facts) with an
  error naming the field; nothing written, no `.bak`.
- **add_source / update_source** — `S` id assigned above the tree max (S-aware
  `nextId`, so `S1`→`S2`); a caller-supplied `id` is rejected on add; `author`/`url`
  round-trip into the written `S` entry; `update_source` merges by `sourceId` (id
  immutable), errors on an unknown `sourceId`; missing-payload guards return
  `{ ok: false }`; a titleless `add_source` fails validation and writes nothing.
- **remove** — fact/relationship deleted by id; `remove` with `personId` rejected.
- **id allocation** — adding to a tree with `F1..F9` yields `F10` (max + 1).
- **staleness** — an unknown `factId` returns an error, writes nothing.
- **validate-before-persist** — an edit that would invalidate the project writes
  nothing and returns `{ ok: false, errors }`; no `.bak` written.
- **research.json untouched** — byte-unchanged after any operation.

---

## 10. Wiring

Standard MCP tool: `src/tools/tree-edit.ts`, schema in `allToolSchemas`
(`src/tool-schemas.ts`), dispatch in `src/index.ts`, name in `manifest.json`
(packaging drift test enforces parity). camelCase params at the boundary;
persisted tree stays snake_case (the tool renames nothing — payload fields are
already the snake_case simplified-GedcomX shape the skill passes).

---

## 11. Consumers

- `tree-edit` skill — its "Ad-hoc edits" section is rewritten to call `tree_edit`
  (one call per edit) instead of hand-editing JSON + calling
  `validate_research_schema`. The "Person merging" section already routes to the
  merge tools (per `skill-rewrites-for-persistence-tools-spec.md`); this completes
  the migration of the skill's write paths. Together, `merge_*` + `tree_edit` cover
  every write to `tree.gedcomx.json`.
