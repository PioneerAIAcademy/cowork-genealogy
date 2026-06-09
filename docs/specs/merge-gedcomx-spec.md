# `merge_gedcomx` — Spec (rev. 2, post-review)

> **Status:** Revised after Dallan + Richard's review of PR #254 (Issue #250).
> Their decisions are folded in below (§4). The signature **changed** from the
> issue's original four-arg form — merge_gedcomx no longer decides *which*
> people to merge; it is **told** the merge pairs. Remaining clarification is
> in §11 (integration mechanism only — not blocking the core).

A pure function that merges two GedcomX documents (or merges persons within one
document), given an explicit list of person-id pairs to collapse. For each pair
the **first** id survives and the **second** is folded into it.

```
// Mode 1 — merge candidate document into target document:
merge_gedcomx(target_gedcomx, candidate_gedcomx, merges) -> merged_gedcomx
//   merges = [ [target_id, candidate_id], ... ]

// Mode 2 — merge persons within the target document (candidate = null):
merge_gedcomx(target_gedcomx, null, merges) -> merged_gedcomx
//   merges = [ [target_id, target_id], ... ]
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

The function does the **data merge only**. It deliberately does NOT:
- decide *which* people are the same — the caller supplies the `merges` pairs
  (§4, Dallan's FINAL DECISION),
- update `research.json` references (stays with the caller — see §10),
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
| Convert util exposes only `toSimplified`/`toGedcomX` — **no existing ID-remap or dedup helper** | `packages/engine/mcp-server/src/utils/gedcomx-convert.ts` |
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
| 2 | Util only, or also an MCP tool wrapper | **Util only.** "The tree-edit tool calls this tool; we don't need a separate merge-gedcomx tool." (See §11 re: integration mechanism.) |
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

---

## 5. Input / Output

Operates on **SimplifiedGedcomX** (`{ persons[], relationships[], sources[],
places[] }`).

```typescript
function mergeGedcomx(
  targetGedcomx: SimplifiedGedcomX,
  candidateGedcomx: SimplifiedGedcomX | null,
  merges: Array<[string, string]>,   // [survivingId, collapsedId]
): SimplifiedGedcomX
```

- **Mode 1** — `candidateGedcomx` is a document. Each `merges` pair is
  `[targetId, candidateId]`: the candidate person collapses into the target
  person, target id survives. Unpaired candidate persons are carried in as new
  relatives.
- **Mode 2** — `candidateGedcomx` is `null`. Each `merges` pair is
  `[targetIdA, targetIdB]`, both already in `targetGedcomx`: `B` collapses into
  `A` (A survives). Use case: "two fathers that weren't merged earlier turn out
  to be the same person."

Returns a **new** `SimplifiedGedcomX` (pure — inputs are not mutated).

---

## 6. The merge algorithm

### 6.1 Validate `merges`
- Every first id must exist (target side); every second id must exist
  (candidate side in mode 1, target side in mode 2). Else throw (§8).
- v1 guard: a person id may appear **at most once** across all pairs, and an id
  may not be both a "surviving" and a "collapsed" id (no merge chains
  `a→b, b→c`). Throw a clear error if violated. (Keeps the remap deterministic;
  chains can be a later enhancement.)

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
- **Person source refs** — union, dedup by `ref|page`.

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
Then **dedup**: collapse duplicate `type` + endpoint relationships into one,
**folding the duplicate's facts and source refs into the kept relationship**
(so e.g. a candidate couple's Marriage fact is not lost when the same couple
already exists on the target). A self-referential relationship produced by a
collapse (parent == child / person1 == person2) is dropped.

### 6.6 Sources
Candidate `sources[]` merged into target `sources[]`:
- **Dedup by `title`** (§4 #3). A deduped candidate source's id maps to the
  matching target source id; a surviving candidate source gets a remapped id.
- All candidate source `ref`s (on persons/names/facts/relationships) rewritten
  to the resulting source ids.

### 6.7 `places[]`
Candidate `places[]` are carried into the result; a candidate place id that
collides with a target place id is given a fresh unique id. Nothing references
place ids in the simplified format (facts carry place **names**), so no ref
rewriting is needed and v1 does not dedup places by content.

### 6.8 Result
`{ persons, relationships, sources, places }` where every merged pair's survivor
id is preserved, all candidate ids are collision-free, every cross-reference
resolves, and no names/facts were discarded. Because fact/name ids are unique
only *within their source array*, a final pass re-ids any duplicate fact/name id
so the result is globally unique (safe — nothing references fact/name ids).

---

## 7. Name & fact equivalence (adapted from MobMergeUtil — keep-both semantics)

The rule throughout: **merge two entries only when one is a less-specific
version of the other; take the more-specific value; never drop a genuinely
distinct entry.**

### 7.1 Names (`isSimilarName`/`containsAllOrInitials`, `scoreName`, MobMergeUtil)
- **Normalize:** lowercase, strip prefixes (`Mr.`/`Mrs.`)/suffixes
  (`Jr.`/`Deceased`)/diacritics/punctuation, collapse whitespace; compare given
  parts and surname parts separately.
- **Equivalent** when, for given parts *and* surname parts independently, one
  side's token set is a **subset** of the other's — treating a single-letter
  **initial** as matching any token starting with that letter (`J.` ~ `John`).
- **Merge** equivalents into the **more complete** name (more tokens / longer /
  has diacritics — `scoreName` = chars×10 + diacritics).
- **Preferred** name = the most **frequent** across inputs; tie-break most
  complete. Mark `preferred: true`; all other distinct names `preferred: false`.

### 7.2 Facts (`isSimilarFact` 1132, `combineFacts` 1239, `getBestDate` 1370)
- **Equivalent** when **same `type`** AND **dates compatible** AND **places
  compatible** (AND, for relationship facts, same other-person):
  - *Dates compatible* (`datesMatch` 1159): parse `standard_date` into Y/M/D;
    for each field present on both sides the values must be equal; a field
    missing on either side is compatible. So `1900` ≈ `1900-01-10`.
  - *Places compatible* (`placesMatch` 1195): compares the **`standard_place`**
    hierarchical name (falling back to free-text `place`) by normalized **chain
    containment** — one place is a prefix of the other root-first
    (`Utah, United States` ≈ `Provo, Utah, United States`) or equal after
    normalization. Weaker than MobMergeUtil's standardized-place-**id** check
    (§12), but the standardized *name* is what skills now pass everywhere.
- **Merge** equivalents → take the **most-complete date** (completeness score
  from `standard_date`: year=100, month=10, day=1; then most common; then
  longest display text) and the **most-specific place** (longest normalized
  chain; then most common). Preserve `value`; preserve `primary` if any input in
  the group had it. Union the group's source refs.
- **Distinct** (non-equivalent) facts are **all kept**.
- **Primary marking** — for `type ∈ {Birth, Death, Christening, Burial}` (the
  single-occurrence types, `SINGLE_ALLOWED_FACT_TYPES` 41–42), after merging,
  mark the single **best** surviving fact of that type `primary: true` (most
  complete, then most common). Other types are not given a primary.
- **Marriage / couple facts** live on the relationship and are grouped per
  other-person (one merged couple-fact per spouse, `combineAndFilterFacts` 1005).

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
| An id appears in more than one pair, or forms a chain | throw `"invalid merges: <id> appears in multiple pairs"` |
| `merges` empty | throw (nothing to merge) |
| `targetGedcomx` missing/empty `persons` | throw a clear input error |

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

---

## 10. Boundary — what the caller still does

After `merge_gedcomx` returns, the `tree-edit` caller still:
- updates `research.json` references (`subject_person_ids`,
  `person_evidence.person_id`, `timelines.person_ids`) from each collapsed id →
  its survivor id,
- calls `validate_research_schema`,
- relies on `check-warnings` (`relationship-accuracy.md`) to catch impossible
  configurations introduced by the merge.

---

## 11. Remaining clarification (non-blocking for the core)

Dallan said **util only** and "the tree-edit **tool** calls this tool." Today
`tree-edit` is a **Markdown skill**, which can only call MCP tools, not import a
TS util. So the core util can be built now exactly to §5, but the *wiring step*
(Task: "tree-edit calls merge_gedcomx") needs the integration mechanism settled:
either tree-edit becomes/has a tool that imports the util directly (consistent
with the "tree-edit tool" phrasing and the weekend client-server restructure),
or a thin boundary is added. **This does not block implementing or testing the
util.** Confirm at wiring time, against the post-restructure tree.

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
