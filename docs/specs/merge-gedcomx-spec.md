# `merge_gedcomx` — Spec (rev. 3, read/write tools)

> **Status:** Rev. 3 (2026-06-19) folds in Dallan's decision to expose the merge
> as **read/write MCP tools** instead of a util the skill calls and then
> re-serializes. The pure core (`mergeGedcomx`, §5) is unchanged; it is now
> wrapped by **two tools** (§5b) — `merge_record_into_tree` and
> `merge_tree_persons` — that read the project files off disk, merge, remap
> `research.json`, validate, and persist atomically. Rev. 2 decisions (Dallan +
> Richard, PR #254 / Issue #250) are in §4; #2 is amended there. The old §11
> "remaining clarification" is now resolved.
>
> **Update (2026-07-18, tree-materialization #701):** the Mode-1 write tool
> `merge_record_into_tree` has been **retired** (0 live calls; superseded by
> `materialize_facts` — see `tree-materialization-spec.md` §9). The pure core
> and **both** modes are unchanged. **Mode 1 (cross-document) is now reached only
> by `merge_warnings`**, which folds the candidate in memory for its dry-run
> coherence checks and never writes; it independently exercises
> `sanitizeCandidate` / `validateCandidateGedcomx`, so those and Mode 1 stay.
> Only **Mode 2** (`merge_tree_persons`) retains a write tool. Sections below
> that describe `merge_record_into_tree` as a live tool are historical — read
> "the Mode-1 fold path" as `merge_warnings`'s in-memory merge.

A deterministic merge of two GedcomX documents (or of two persons within one
document), given an explicit list of person-id pairs to collapse. For each pair
the **first** id survives and the **second** is folded into it. A pure core
(`mergeGedcomx`, §5) does the data merge; **two thin MCP tools** (§5b) own the
filesystem I/O, the `research.json` remap, validation, and persistence.

```
// Tool — fold a candidate record into the tree (writes tree.gedcomx.json):
merge_record_into_tree({ projectPath, candidateGedcomx, merges })
//   merges = [ [target_id, candidate_id], ... ]

// Tool — merge two persons already in the tree (writes both files):
merge_tree_persons({ projectPath, merges })
//   merges = [ [survivor_id, collapsed_id], ... ]  (both ids in the tree)
```

Source issue: <https://github.com/PioneerAIAcademy/cowork-genealogy/issues/250>.
Review thread: PR #254.

---

## 1. Why this exists

Today the `tree-edit` skill (`packages/engine/plugin/skills/tree-edit/SKILL.md`, "Person
merging") performs a merge **by hand** — the LLM is instructed to dedup names,
dedup facts, repoint relationships, and delete the deprecated person (Steps
1–5). That is error-prone (ID collisions, missed references). #250 replaces the
hand-done merge with one **deterministic function** so the result is reliable
and testable. Per Issue #250: *"Make sure that the tree-edit tool calls that
function."*

The **pure core** (`mergeGedcomx`, §5) does the **tree data merge only**. It
deliberately does NOT:
- decide *which* people are the same — the caller supplies the `merges` pairs
  (§4, Dallan's FINAL DECISION),
- touch `research.json`, the filesystem, or run validation — those belong to the
  **tool wrappers** (§5b), which own persistence and the cross-file remap (§10),
- run warning checks (`check-warnings` does that after a merge — see
  `tree-edit/references/relationship-accuracy.md`).

---

## 2. The real-world scenario (Dallan's framing)

> *"If we have a person with relatives that we are researching as the target,
> and we have a census record where that person appears, also with relatives,
> then we need to merge everyone in the census into the target person with
> relatives, which may update some relatives and add new relatives."*

So both sides are **whole-tree** documents. The caller (e.g. `tree-edit`, having
used `same_person` / `proof-conclusion` to score who-is-who) decides the
pairs: focus↔focus, and likely father↔father, mother↔mother, maybe spouse↔spouse
and child↔child. Whatever isn't paired is simply **carried in as a new relative**.

---

## 3. Evidence base (seen directly in the repo / reference)

| Fact | Source (seen directly) |
|------|------------------------|
| Closest sibling tool operates on **SimplifiedGedcomX** | `packages/engine/mcp-server/src/tools/same-person.ts` |
| `SimplifiedFact` has `primary?: boolean`; `SimplifiedName` has `preferred?: boolean` (so "keep both, mark 1 preferred" is representable) | `packages/engine/mcp-server/src/types/gedcomx.ts:112,123` |
| `SimplifiedFact = { id, type, primary?, date?, standard_date?, place?, standard_place?, value?, sources? }` — `standard_place` is the standardized hierarchical place name (added 2026-06-05); equivalence uses it, falling back to free-text `place` | `packages/engine/mcp-server/src/types/gedcomx.ts:120` |
| Marriage/couple facts live on the **relationship** (`SimplifiedRelationship.facts`), not the person | `packages/engine/mcp-server/src/types/gedcomx.ts:139` |
| IDs `I/N/F/R/S` unique within their array (restart at 1 per doc → collisions on merge) | `docs/specs/simplified-gedcomx-spec.md` |
| `gedcomx-convert.ts` exports `toSimplified`/`toGedcomX` (+ `collectFacts`/`standardizePlaces`/`toSimplifiedStandardized`) — **no ID-remap or dedup helper there** | `packages/engine/mcp-server/src/utils/gedcomx-convert.ts` |
| The pure core `mergeGedcomx` (§5–§7) is **already implemented and unit-tested** — the §5b tool wrappers are shipped | `src/utils/merge-gedcomx.ts` (728 lines), `tests/utils/merge-gedcomx.test.ts` |
| The hand-done merge protocol this replaces | `packages/engine/plugin/skills/tree-edit/SKILL.md` §"Person merging" |

Richard attached FamilySearch's **`MobMergeUtil.java`** (the match-system merge)
to #250 as an *ideas* reference — explicitly **not** a straight port. The exact
equivalence/selection logic extracted from it (with line refs) is in §7 and §12.

---

## 4. Decisions from review (Dallan / Richard on PR #254)

These were **open questions** in the draft; now answered — recorded verbatim-ish
so implementation doesn't re-litigate:

| # | Question | Decision |
|---|----------|----------|
| 1 | Simplified vs full GedcomX | **Simplified.** |
| 2 | Util only, or also an MCP tool wrapper | **Amended rev. 3 → pure core + two read/write tools** (note below). Was "util only"; the whole-tree persistence + atomic remap requirement changed the call. |
| 3 | Source dedup key | **`title`.** |
| 4 | Who decides which persons merge | **The caller does.** merge_gedcomx "should be told which people to merge by taking a list of id-pairs to merge." Two modes (§ signature). |
| 5 | `ark` conflict on a merged person | **Keep target's ark.** |
| 6 | Integration shape (cross-doc vs in-tree) | **Whole-tree target + whole-tree candidate** (cross-document). Plus a same-document mode (candidate = null) for merging two persons already in the target. |
| 7 | Conflicting facts — keep both or pick best | **Keep both, but mark one as primary/preferred.** Never throw names or facts away. *Additionally:* **merge equivalent** names/facts (one is a less-specific version of the other) and take the more-specific value. For **Birth/Death/Christening/Burial** mark the single best fact `primary`. |

Richard's clarification (confirmed by Dallan): SimplifiedGedcomX allows multiple
facts of a type, even Birth/Death, with a `primary` marker. Identify the "best"
fact as the **preferred (primary)** fact for Birth, Death, Christening, Burial
(single-occurrence events). For other fact types, just merge equivalents.
**Never discard unmerged names/facts.**

**Amendment to #2 (2026-06-19, Dallan).** "Util only, no separate merge-gedcomx
tool" assumed the skill could call the util and persist the result itself. It
can't usefully: the merged document is the **whole tree**, so handing it back for
the skill to re-serialize through `Write` reintroduces the large-JSON-write
failure mode `record-extraction` §5 contorts to avoid, and the §10 cross-file
remap must be **atomic** with the tree write. Decision: keep `mergeGedcomx` as the
pure, tested core (§5) and expose it through **two thin MCP tools** (§5b). The two
former "modes" become the two tools — a `mode` parameter is deliberately *not*
exposed (§5b explains why).

---

## 5. Pure core — `mergeGedcomx`

The internal, side-effect-free merge. Operates on **SimplifiedGedcomX**
(`{ persons[], relationships[], sources[], places[] }`); any of
`relationships`/`sources`/`places` may be absent on an input and is treated as
empty (never throw on a missing array). Candidate `places[]` and person-level
`sources[]` are tolerated on input but never enter the result — the persisted
tree format has neither (see §6.3, §6.7), and the tool layer strips them from
candidates with a warning before the merge (`sanitizeCandidate`, §5b.2). It is
**not** advertised as an MCP tool on its own — the two tools in §5b wrap it.

```typescript
function mergeGedcomx(
  targetGedcomx: SimplifiedGedcomX,
  candidateGedcomx: SimplifiedGedcomX | null,
  merges: Array<[string, string]>,   // [survivingId, collapsedId]
): SimplifiedGedcomX
```

The two call shapes are an **internal** distinction of the core, surfaced to
skills as two separate tools (§5b) — **not** as a `mode` argument:

- **Mode 1 — record-into-tree** (`candidateGedcomx` is a document). Each `merges`
  pair is `[targetId, candidateId]`: the candidate person collapses into the
  target, target id survives. Unpaired candidate persons are carried in as new
  relatives. → tool `merge_record_into_tree`.
- **Mode 2 — within-tree** (`candidateGedcomx` is `null`). Each `merges` pair is
  `[targetIdA, targetIdB]`, both already in `targetGedcomx`: `B` collapses into
  `A` (A survives). Use case: "two fathers that weren't merged earlier turn out
  to be the same person." → tool `merge_tree_persons`.

Returns a **new** `SimplifiedGedcomX` (pure — inputs are not mutated).

---

## 5b. Tool wrappers — `merge_record_into_tree` and `merge_tree_persons`

Two MCP tools wrap the pure core. Both read the project files off disk (the way
`validate_research_schema` does), call `mergeGedcomx`, validate the result, and
persist atomically. **The merged tree is never returned to the model** — that is
the whole reason these are tools and not a returned document. They return a
compact summary (§5b.3).

**Why two tools, not one with a `mode` flag.** The skill always knows which it
needs — it either holds a candidate record (just ran `record_read`) or it is
collapsing two persons already in the tree — so the mode is a consequence of the
task, not something to detect. The two have **different parameters and different
side effects** (below). A `mode` argument would be redundant with candidate
presence and would let the model emit a contradictory call; a single tool's
null-candidate sentinel also risks a skill handing the whole tree in as its own
"candidate" (silent person duplication). Two named tools make the model select by
intent and make the within-tree merge structurally unable to take a candidate.

### 5b.1 Inputs (camelCase at the boundary; persisted docs stay snake_case)

```typescript
// Mode 1
merge_record_into_tree({
  projectPath: string,                 // dir holding tree.gedcomx.json + research.json
  candidateGedcomx: SimplifiedGedcomX, // the record to fold in (passed inline)
  merges: Array<[string, string]>,     // [targetId, candidateId]
})

// Mode 2
merge_tree_persons({
  projectPath: string,
  merges: Array<[string, string]>,     // [survivorId, collapsedId], both in the tree
})
```

- `candidateGedcomx` is passed **inline**: it is one record (not the whole tree)
  and the skill already holds it from `record_read`, so the tool need not know the
  `results/` sidecar machinery. (A future `candidate-by-reference` input —
  `log_id` + `recordId` read from a sidecar — is a natural extension, out of scope
  for v1.) Simplified-GedcomX only; a caller holding full GedcomX converts via
  `toSimplified` first.
- The tools read `tree.gedcomx.json` **fresh from disk**, so `merges` ids are
  checked against current on-disk state, not the model's possibly-stale context. A
  survivor id absent from the on-disk tree is a clear error (§8) that surfaces
  staleness instead of misbehaving silently.

### 5b.2 Persistence — validate-before-persist, atomic, mode-aware

Sequence inside each tool:

1. Read `tree.gedcomx.json` (and, for `merge_tree_persons`, `research.json`).
   **`merge_record_into_tree` only:** sanitize the inline candidate first —
   drop top-level `places[]` and person-level `sources[]` (legal in tool
   output like `record_read`'s `gedcomx`, not in the tree format) with a
   warning per stripped kind, then validate the sanitized candidate
   (`sanitizeCandidate` + `validateCandidateGedcomx` in `merge-shared.ts`).
   `merge_warnings` sanitizes identically so the dry-run merges the same
   document the writer would.
2. Run `mergeGedcomx` (§5–§7) to build the new tree in memory.
3. **`merge_tree_persons` only:** remap `research.json` person-id references from
   each collapsed id → its survivor id (§10).
4. **Validate the in-memory result** with the project validator before anything
   touches disk. If invalid, **write nothing** and return the errors (§8).
5. Persist. `merge_record_into_tree` writes **only `tree.gedcomx.json`**
   (`research.json` is unchanged — see §10). `merge_tree_persons` writes **both**
   files **both-or-neither** (write both temps → rename both back-to-back). Note:
   two renames are **not** truly atomic on POSIX, so a crash *between* the renames
   leaves tree=new / research=old; the back-to-back ordering shrinks that window to
   microseconds and the next `validateProject` on open detects the inconsistency.
   Use the shared `atomicWriteBoth` helper (`validate-project-refactor-spec.md`
   §10) — don't hand-roll it.

Net guarantee: the on-disk files are always schema-valid after the call, and
`validate-schema` becomes a backstop rather than the primary safety net.

> **Recovery, not undo.** Validate-before-persist guarantees the result is
> **schema-valid**, not **correct**: merging the wrong two persons passes validation
> and overwrites the prior (separate-persons) state irrecoverably — the tools add no
> undo. Because a deterministic merge is *faster and more trusted* than the hand-merge
> it replaces, the blast radius of a confident mistake is higher, not lower. Before
> these tools land, confirm the project folder has version history to fall back on
> (git-tracked, or the viewer's snapshots); if neither exists, write a one-deep backup
> (`tree.gedcomx.json.bak`, plus `research.json.bak` for Mode 2) before the atomic
> overwrite. The data is the user's irreplaceable research.

> **Implementation note.** `validateProject` (`src/validation/validator.ts`) today
> only takes a `projectPath` and reads from disk. Step 4 needs an **in-memory**
> entry point that validates already-parsed `research`/`tree` objects: extract the
> body of `validateProject` to accept the two objects, and keep the path-based
> function as a thin reader in front of it. Full spec:
> `docs/specs/validate-project-refactor-spec.md`.

### 5b.3 Return value (compact summary — never the tree)

```typescript
{
  ok: true,
  filesWritten: string[],              // ["tree.gedcomx.json"] or both
  pairs: Array<{                       // one per merge
    survivorId: string,
    namesMerged: number, namesKept: number,
    factsMerged: number, factsKept: number,
    primarySet: string[],              // fact types given a new primary, e.g. ["Birth"]
    genderConflictKeptSurvivor: boolean,
  }>,
  newRelatives: string[],              // Mode 1 — ids of carried-in new relatives
  researchRefsUpdated: {               // Mode 2 only; absent/zero for Mode 1
    subject_person_ids: number, person_evidence: number,
    timelines: number, known_holdings: number,
  },
  validation: { valid: true, warnings: string[] },
}
```

The skill narrates from this (e.g. "folded the census father into I3; added the
mother as new relative I7") without ever holding the merged tree. On validation
failure the result is `{ ok: false, errors: string[] }` and no files are written.

Every field here is derivable by the wrapper from `mergeGedcomx`'s returned
document plus its inputs — **the shipped core needs no change.** `newRelatives` is
`result.persons` ids minus the target ids minus the survivors; the merged/kept
counts come from comparing each survivor's pre-merge union (target survivor +
collapsed candidate person) against the post-merge survivor; `primarySet` and
`genderConflictKeptSurvivor` read off the result. The `{candidateId → newId}`
backlink is deliberately dropped — it lives only in the core's internal id map, and
recovering it would mean replicating private allocation order; bare new ids are
enough for narration.

---

## 6. The merge algorithm

**Phase order (sequence matters — later phases depend on earlier maps):**
(1) validate `merges` (§6.1); (2) build the person-id map *and* the source-id map,
including source dedup-by-title (§6.2, §6.6); (3) rewrite **all** cross-references
through those maps; (4) collapse each pair at the person level (§6.3); (5) carry
over + dedup relationships (§6.5); (6) final pass to re-id any duplicate fact/name
id (§6.8). Building the id maps *before* collapsing is what lets §6.3's
ref-rewriting resolve source ids — otherwise §6.3-before-§6.6 is circular.

### 6.1 Validate `merges` (`validateMerges`)
- `target` must have at least one person and `merges` must be non-empty — else
  throw (§8).
- No id may appear twice on the **survivor** side, nor twice on the **collapsed**
  side (`firstDuplicate`) — else throw.
- **Mode 2 only:** an id may not be both a survivor and a collapsed id — that is a
  merge chain (`a→b, b→c`), rejected to keep the remap deterministic. In Mode 1 the
  survivor ids (target namespace) and collapsed ids (candidate namespace) are
  independent, so the same string appearing on both sides is **not** a chain and is
  allowed.
- Every survivor id must exist on the target side; every collapsed id must exist on
  the candidate side (Mode 1) or the target side (Mode 2) — else throw.

### 6.2 ID remapping (Mode 1 — the core collision problem)
Both documents number `I/N/F/R/S` from 1, so candidate ids collide with target
ids. Procedure:
1. `targetGedcomx` keeps **all** its ids unchanged.
2. For each prefix, find the max number used in `targetGedcomx` and allocate
   surviving candidate ids **above** it.
3. Build a per-kind `candidateId → newId` map so every cross-reference
   (relationship `parent`/`child`/`person1`/`person2`, source `ref`s) is
   rewritten. **Exception:** for each `[targetId, candidateId]` pair, the
   candidate person id maps to the **target id** (the collapse).
> Remap **globally** within each prefix so no collision is possible regardless
> of whether N/F ids are per-person or per-document unique.

Mode 2 needs no remap (single document); it only repoints refs from each
collapsed id to its surviving id and drops the collapsed person.

### 6.3 Collapse each merge pair (person-level)
For each `[survivor, collapsed]` pair, merge the collapsed person **into** the
survivor (survivor id is kept):
- **`ark`** — keep survivor's. If survivor has none and the other does, adopt it.
- **`gender`** — keep survivor's if present; else the other's. (If both present
  and differ, keep survivor's; `check-warnings` flags the conflict downstream.)
- **Names** — union, then **merge equivalent names** and **keep all distinct
  names** (§7.1). Exactly one resulting name is marked `preferred`.
- **Facts** — union (person facts), then **merge equivalent facts** and **keep
  all distinct facts** (§7.2). For Birth/Death/Christening/Burial, mark the one
  best fact `primary`.
- **Person source refs** — none. The tree format carries source references on
  names/facts/relationships, not on persons (`tree-gedcomx.schema.json`
  `$defs/person` has no `sources`). A candidate persona's person-level refs are
  stripped by the tool layer with a warning (§5b.2); the core does not fold them.

### 6.4 Non-paired candidate persons (Mode 1)
Carried into the result with **remapped** ids — these are the "new relatives."
No automatic dedup against target persons (the caller decides merges; §4 #4).

### 6.5 Relationships
Every candidate relationship is carried over (Mode 1) / retained (Mode 2) with:
- `id` remapped (Mode 1 only),
- `parent`/`child`/`person1`/`person2` rewritten through the id map (collapsed
  ids → survivor ids; others → remapped),
- relationship-level `facts` and `sources` ref-rewritten; couple/marriage facts
  merged per §7.2 when the same couple appears on both sides.
Then **dedup**: collapse duplicate relationships — same `type` and same endpoints
— into one, **folding the duplicate's facts and source refs into the kept
relationship** (so e.g. a candidate couple's Marriage fact is not lost when the
same couple already exists on the target). Compare endpoints **after** remap; for
`Couple`, treat `{person1, person2}` as an **unordered set** (the two docs may
list the partners in opposite order). A self-referential relationship produced by
a collapse (parent == child / person1 == person2) is dropped.

### 6.6 Sources
Candidate `sources[]` merged into target `sources[]`:
- **Dedup by `title`** (§4 #3). A deduped candidate source's id maps to the
  matching target source id; a surviving candidate source gets a remapped id.
- All candidate source `ref`s (on persons/names/facts/relationships) rewritten
  to the resulting source ids.

### 6.7 `places[]`
Candidate `places[]` are **not** carried into the result. The persisted tree
format has no top-level `places` section (`tree-gedcomx.schema.json` closes the
root at `persons`/`relationships`/`sources`; facts carry place **names**), so
carrying them would persist a document the tree schema rejects. The tool layer
strips candidate places with a warning before the merge (§5b.2); a legacy
target's own `places` never reach the core: every tool heals the on-disk
tree at read (`src/validation/tree-sanitize.ts` drops the section with a
warning), so the merge operates on — and its next write persists — the
healed document.

> *Changed from rev. 3,* which carried candidate places with id-collision
> renaming. That behavior wrote trees that failed the tree JSON Schema —
> the `gedcomx-schema-drift` audit's missed-drift finding.

### 6.8 Result
`{ persons, relationships, sources }` where every merged pair's survivor
id is preserved, all candidate ids are collision-free, every cross-reference
resolves, and no names/facts were discarded. Because fact/name ids are unique
only *within their source array*, a final pass re-ids any duplicate fact/name id
so the result is globally unique (safe — nothing references fact/name ids).

---

## 7. Name & fact equivalence (keep-both semantics)

The rule throughout: **merge two entries only when one is a less-specific
version of the other; take the more-specific value; never drop a genuinely
distinct entry.**

These sections describe the **shipped** implementation in
`src/utils/merge-gedcomx.ts` (the TS function names below are the source of truth);
the MobMergeUtil ideas this adapted from, and where v1 deliberately simplifies, are
catalogued in §12.

### 7.1 Names (TS: `namesEquivalent` / `tokensCompatible` / `scoreName` / `mergeNames`)
- **Normalize** (`nameTokens`): NFD-decompose and strip diacritics (combining
  marks), lowercase, then split into alphanumeric tokens (punctuation and
  whitespace are separators); compare given tokens and surname tokens separately.
  Note: v1 does **not** strip name prefixes/suffixes like `Mr.`/`Jr.` — they
  survive as tokens and, being a superset, don't block equivalence.
- **Equivalent** when, for given tokens *and* surname tokens independently, one
  side's token set is a **subset** of the other's — treating a single-letter
  **initial** as matching any token starting with that letter (`j` ~ `john`).
- **Merge** equivalents into the **more complete** name (`scoreName` =
  letters×10 + diacritics — longer, with diacritics, wins).
- **Preferred** name = the **largest** equivalence class (most frequent across
  inputs); tie-break by `scoreName`. Mark exactly one `preferred: true`; all other
  distinct names carry no `preferred` flag at all — absence means false, the
  schema pins the field to `const: true`, and writing `preferred: false`
  persists a tree the schema rejects.

### 7.2 Facts (TS: `factsEquivalent` / `mergeFactGroup` / `mergeFacts`)
- **Equivalent** when **same `type`** AND **dates compatible** AND **places
  compatible** (`factsEquivalent`):
  - *Dates compatible* (`datesCompatible`): convert each fact's `standard_date` to
    a day range (`getDayRange`); compatible when one range **contains** the other,
    or either fact is undated. So `1900` (the whole-year range) contains
    `1900-01-10`. This is range containment, **not** field-by-field Y/M/D equality.
  - *Places compatible* (`placesCompatible`): take each fact's place chain
    (`standard_place` ∨ free-text `place`, split on commas, normalized, root-first)
    and accept when one chain is a **prefix** of the other (`Utah, United States` ≈
    `Provo, Utah, United States`), or either is absent. Uses the standardized
    *name*, not MobMergeUtil's place-**id** (§12), because that is what skills pass.
  - *Relationship / couple facts:* the "same other-person" constraint is enforced
    **structurally, not in `factsEquivalent`** — couple facts live on the
    relationship, and `dedupRelationships` only folds together facts of
    relationships with the **same (unordered, post-remap) endpoints** (§6.5), so
    only same-couple Marriage facts are ever compared.
- **Merge** equivalents (`mergeFactGroup`) → keep the **narrowest day-range** date
  (`factDateWidth`, most specific) and the **longest place chain** (most specific);
  keep the first non-empty `value`; set `primary` if any member had it; union the
  group's source refs. There are **no** "most-common" / "longest-display-text"
  tiebreaks — the width/length heuristics are the whole rule.
- **Distinct** (non-equivalent) facts are **all kept**.
- **Primary marking** (`mergeFacts`) — for `type ∈ {Birth, Death, Christening,
  Burial}` (`VITAL_PRIMARY_TYPES`), after merging, clear any inherited `primary` in
  that type's group and mark the single **most-complete** surviving fact
  `primary: true` (`factMoreComplete`: narrower day range first, then longer place
  chain). Other types get no primary from this pass — they keep an input `primary`
  if one was set.

### 7.3 Gender
Survivor's gender wins (§6.3). (MobMergeUtil uses majority vote across many
records, `computeMergedGender` 568; for pairwise merges the survivor-keeps rule
is the natural reduction and mirrors the ark decision.)

---

## 8. Errors

| Condition | Behavior |
|-----------|----------|
| A surviving id in `merges` not found on the target side | throw `"merge survivor id <id> not found in target_gedcomx"` |
| A collapsed id not found (candidate side mode 1 / target side mode 2) | throw `"merge id <id> not found"` |
| An id appears twice on the same side of `merges` | throw `"invalid merges: <id> appears in multiple pairs"` |
| (Mode 2) an id is both a survivor and a collapsed id | throw `"invalid merges: <id> appears as both a survivor and a collapsed id (chains are not supported)"` |
| `merges` empty | throw (nothing to merge) |
| `targetGedcomx` missing/empty `persons` | throw a clear input error |

Tool-level (the rows above are the pure core's throws):

| Condition | Behavior |
|-----------|----------|
| `projectPath` has no `tree.gedcomx.json`, or it is invalid JSON | clear input error before merging; write nothing |
| `merge_tree_persons` and `research.json` is missing/invalid | clear input error; write nothing |
| `candidateGedcomx` is not valid SimplifiedGedcomX | clear input error (reuse the exported `validateGedcomx`, `validate-project-refactor-spec.md` §10); write nothing |
| Merge result fails project validation | **write nothing**; return `{ ok: false, errors }` (§5b.2 step 4) |
| A `merges` survivor id not found in the **on-disk** tree | staleness error (§5b.1); write nothing |

---

## 9. Test plan (vitest, mirroring `match-two-examples.test.ts`)

- **ID remap, no collision** (disjoint id ranges) — all refs resolve.
- **ID remap, full collision** (both docs use `I1/N1/F1/R1/S1`) — candidate side
  fully renumbered above target max, every ref rewritten, no dangling refs.
- **Single focus pair** — collapse, target id survives, union of names/facts.
- **Multi-pair** (focus + father + mother) in one call — each survivor id kept,
  unpaired candidate persons added as new relatives, relationships repointed.
- **Mode 2** (candidate = null) — two target persons collapse, refs repointed,
  collapsed person removed.
- **Name equivalence** — `J Flynn` + `James Flynn` → one name `James Flynn`
  preferred; a genuinely different name kept as non-preferred.
- **Fact equivalence (merge)** — `Birth 1900 / Utah` + `Birth 10 Jan 1900 /
  Provo, Utah` → one Birth `10 Jan 1900 / Provo, Utah`, `primary: true`.
- **Fact conflict (keep both)** — `Birth 1900 Utah` + `Birth 1888 Ohio` → both
  kept, the better one marked `primary`.
- **Non-primary type** — two compatible Residence facts merge; two different
  Residence facts both kept, neither marked primary.
- **Relationship dedup** — same ParentChild pair from both docs → one; collapse
  producing parent==child → dropped.
- **Source dedup by title** + every `ref` rewritten.
- **ark / gender** retention on survivor.
- **Errors** — missing id; duplicate id in pairs; empty merges.
- **Purity** — inputs not mutated.

Tool-level (wrappers over the pure core):

- **Record-into-tree persistence** — only `tree.gedcomx.json` is written;
  `research.json` is byte-unchanged; the summary lists new relatives with their
  assigned ids.
- **Within-tree persistence** — both files written; `research.json` person-id refs
  (`subject_person_ids`, `person_evidence.person_id`, `timelines.person_ids`,
  `known_holdings.relates_to_person_ids`) repointed collapsed → survivor;
  `researchRefsUpdated` counts match.
- **Validate-before-persist** — a merge that would produce an invalid project
  writes **nothing** and returns `{ ok: false, errors }`.
- **Atomicity (Mode 2)** — two injected-failure cases: (a) failure **before** the
  first rename leaves both files byte-unchanged (pre-merge); (b) failure **between**
  the two renames leaves tree=new / research=old, and the next `validateProject`
  flags the inconsistency. (Pins the both-temps-then-rename-both contract and its
  residual window — `validate-project-refactor-spec.md` §10.)
- **Candidate validation** — `merge_record_into_tree` with a malformed
  `candidateGedcomx` (e.g. a person missing required fields) is rejected via the
  shared `validateGedcomx` before any merge or write.
- **Stale `merges`** — a survivor id not in the on-disk tree returns the staleness
  error and writes nothing.
- **Return summary** — names/facts merged-vs-kept counts and `primarySet` match the
  merged tree.

---

## 10. Boundary — pure core vs. tool vs. caller

**Pure core (`mergeGedcomx`)** — tree data merge only; no filesystem, no
`research.json`, no validation.

**Tool wrappers (§5b)** — own persistence, validation, and the cross-file
`research.json` person-id remap. The remap is **Mode-2-only**:

- **`merge_record_into_tree` (Mode 1) does not touch `research.json`.** Every
  target id is preserved (§6.2.1) and the collapsed ids are *candidate* ids that
  `research.json` does not yet reference (it's a fresh record); the new relatives
  get fresh ids nothing references yet. Nothing to remap — the tool writes only
  `tree.gedcomx.json`. (Linking the new relatives into `research.json` via
  `person_evidence` is a separate, later skill step.)
- **`merge_tree_persons` (Mode 2) remaps `research.json`.** The collapsed id `B`
  is an existing tree person `research.json` may reference. Repoint every person-id
  reference `B → A`: `project.subject_person_ids`, `person_evidence[].person_id`,
  `timelines[].person_ids`, and `known_holdings[].relates_to_person_ids`. This set
  is exactly `validateCrossFile`'s person-id checks in
  `src/validation/validator.ts` and **must stay in sync with it** — extract the
  field list as one shared constant (e.g. `PERSON_ID_REF_FIELDS`) consumed by
  **both** the validator and this remap, rather than hand-maintaining it twice. The
  drift failure is *safe* (a missed field leaves a dangling ref that
  validate-before-persist catches, so the symptom is "merge refuses," not
  corruption), but a shared constant removes the trap entirely.
  `gedcomx_source_description_id` needs **no** remap: target S-ids are preserved
  and `research.json` never references candidate S-ids.

**Caller (the `tree-edit` skill) still** runs `check-warnings`
(`relationship-accuracy.md`) after the merge to catch genealogical impossibilities
it may have introduced (e.g. parent younger than child). The tool does the
**structural** validate (schema + refs) but **not** the genealogical-plausibility
checks — those stay a separate skill step. The caller no longer hand-edits
`research.json` refs or calls `validate_research_schema` itself; the tool does
both.

---

## 11. Integration — resolved (rev. 3)

The rev. 2 open question ("util only, but how does a Markdown skill call a TS
util?") is closed: there is no util-only path. `mergeGedcomx` is the pure core in
`src/utils/`; it is exposed through the two MCP tools `merge_record_into_tree` and
`merge_tree_persons` in `src/tools/`, wired the standard way — schemas in
`src/tool-schemas.ts` (`allToolSchemas`), dispatch in `src/index.ts`, names added
to `manifest.json`'s `tools` array (the packaging drift test enforces parity). The
`tree-edit` skill calls these tools like any other MCP tool; it does not import
the util. Its "Person merging" section is rewritten to call the right tool
(record-into-tree vs. within-tree) instead of hand-merging.

---

## 12. Mapping to `MobMergeUtil.java` (what we adopted vs simplified)

Adopted (ideas, not a port — Richard's guidance):
- **It does not decide who merges either** — `shouldMergePersons` (1496) is
  `id1.equals(id2)`; the match system assigns shared ids upstream. Our `merges`
  list is the explicit form of that contract.
- **Fact equivalence** — `isSimilarFact` (1132): same type + same other-person +
  `datesMatch` (hierarchical Y/M/D containment, 1159) + `placesMatch`
  (place-chain containment, 1195/`isChildPlace` 1221).
- **Best-value selection** — `getBestDate` (1370) / `scoreDate` (1356,
  Y=100/M=10/D=1) → most complete then most common; `getBestPlace` → most
  specific then most common.
- **Single-occurrence primary types** — `SINGLE_ALLOWED_FACT_TYPES`
  `{Birth, Death, Christening, Burial}` (41–42); `createManufacturedFacts` (1042)
  marks one best fact per such type.
- **Name equivalence/scoring** — `isSimilarName` (798) /
  `containsAllOrInitials` (844) / `scoreName` (959) / `findLongestName` (971).

Deliberately simplified for v1 (note as limitations):
- **Place comparison** uses the standardized place **name** chain
  (`standard_place`), not MobMergeUtil's place-**id** database / `MStandardPlace`
  chains — but the standardized name is what the skills now pass everywhere.
- **Name matching** uses normalized subset + initials; we omit the Jaro-Winkler
  scorer and the `std_given.txt`/`std_surname.txt` lookup tables (nickname/
  spelling-variant maps) — exact/normalized compare for v1, extendable later.
- **No "manufacture one best fact and drop the rest"** — we keep all facts and
  only *mark* one primary, per §4 #7 ("never throw facts away").
- **No father-surname inference** for surname-less children (`addFatherSurname*`)
  — too domain-specific for the first cut.
