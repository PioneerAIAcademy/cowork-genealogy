# `merge_gedcomx` — Spec (DRAFT for review)

> **Status:** Draft for Dallan / Richard review (Issue #250). Implementation
> is gated on sign-off of the **Open questions** in §9 — the issue is four
> lines and several merge semantics need a decision before coding.

A function that merges two GedcomX records — given the primary person id in
each — into a single GedcomX record, collapsing the two primary persons into
one keyed by the **target** person id.

```
merge_gedcomx(target_gedcomx, target_person_id, candidate_gedcomx, candidate_person_id) -> merged_gedcomx
```

Source issue: <https://github.com/PioneerAIAcademy/cowork-genealogy/issues/250>.

---

## 1. Why this exists

Today the `tree-edit` skill (`plugin/skills/tree-edit/SKILL.md`, "Person
merging") performs a merge **by hand** — the LLM is instructed to dedup
names, dedup facts, repoint relationships, and delete the deprecated person
(Steps 1–5). That is error-prone (ID collisions, missed references). #250
replaces the hand-done merge with one **deterministic function** so the
result is reliable and testable. Per Issue #250: *"Make sure that the
tree-edit tool calls that function."*

The function does the **data merge only**. It deliberately does NOT:
- update `research.json` references (stays with the caller — see §8),
- run warning checks (`check-warnings` does that after a merge — see
  `tree-edit/references/relationship-accuracy.md`),
- make the analytical "are these the same person?" decision
  (`proof-conclusion` does that first).

---

## 2. Evidence base (what's already in the repo)

| Fact | Source (seen directly) |
|------|------------------------|
| Closest sibling is `match_two_examples` — same `(gedcomx1, primaryId1, gedcomx2, primaryId2)` shape, operates on **SimplifiedGedcomX** | `mcp-server/src/tools/match-two-examples.ts` |
| GedcomX data shapes (`SimplifiedGedcomX`, `SimplifiedPerson`, …) | `mcp-server/src/types/gedcomx.ts` |
| Simplified format contract; IDs `I/N/F/R/S` unique within their array | `docs/specs/simplified-gedcomx-spec.md` |
| Local (non-network) MCP tool wrapping a pure util — the pattern for "skill calls a function" | `validate_research_schema` → `validateProject` (`src/tools/validate-research-schema.ts`, `src/validation/`) |
| The merge semantics the team already documented (dedup names/facts, keep-both on conflict, repoint relationships) | `plugin/skills/tree-edit/SKILL.md` §"Person merging" |
| Convert util exposes only `toSimplified` / `toGedcomX` — **no existing ID-allocation or dedup helper** | `mcp-server/src/utils/gedcomx-convert.ts` |

There is **no Java source for merge in this repo** (grep: zero `.java`
files). Dallan's "port from `Warnings.java`" guidance applies to the
*warnings* work, which reads a merged GedcomX — not to this function.

---

## 3. Input / Output

Operates on **SimplifiedGedcomX** (the format `tree.gedcomx.json`,
`person_read`, and `match_two_examples` all use). See §9 Q1.

```typescript
function mergeGedcomx(
  targetGedcomx: SimplifiedGedcomX,
  targetPersonId: string,
  candidateGedcomx: SimplifiedGedcomX,
  candidatePersonId: string,
): SimplifiedGedcomX
```

- `targetGedcomx` / `candidateGedcomx` — two simplified GedcomX documents
  (`{ persons[], relationships[], sources[] }`).
- `targetPersonId` — `persons[].id` of the focus person in `targetGedcomx`.
  **This id survives** as the focus person's id in the result.
- `candidatePersonId` — `persons[].id` of the focus person in
  `candidateGedcomx`. This person is collapsed into the target focus person.

Returns a new `SimplifiedGedcomX` (pure — inputs are not mutated).

---

## 4. Where it lives & how `tree-edit` calls it

Recommendation (mirrors `validate_research_schema`):

1. **Pure function** in `mcp-server/src/utils/merge-gedcomx.ts` — exports
   `mergeGedcomx(...)`. Lives next to `gedcomx-convert.ts`.
2. **Thin MCP tool wrapper** `merge_gedcomx` in `mcp-server/src/tools/` so the
   `tree-edit` *skill* can invoke it (a skill can only call MCP tools, not TS
   functions). Registered in `tool-schemas.ts`, `index.ts`, `manifest.json`.
   Precedent: `validate_research_schema` is a local, non-network MCP tool.
3. `tree-edit/SKILL.md` "Person merging" Steps 1–5 are replaced by: call
   `merge_gedcomx`, then update `research.json` references and run validation.

See §9 Q2 — confirm whether the MCP-tool wrapper is wanted now, or just the
util for a future `tree_edit` tool.

---

## 5. The merge algorithm

### 5.1 ID remapping (the core problem)
Both documents use `I/N/F/R/S` IDs starting at 1, so candidate IDs collide
with target IDs. Procedure:
1. `targetGedcomx` keeps **all** its IDs unchanged.
2. For each prefix (`I`,`N`,`F`,`R`,`S`), find the highest number used in
   `targetGedcomx` and allocate candidate IDs **above** it.
3. Build a `candidateId → newId` map (per entity kind) so every cross-
   reference (relationship person refs, source `ref`s) can be rewritten.
   - Exception: `candidatePersonId` maps to `targetPersonId` (the collapse).

> N and F IDs are nested inside persons; the spec says "unique within their
> array." To be safe the function remaps **globally** so no collision is
> possible regardless of whether N/F are per-person or per-document unique.

### 5.2 Collapse the two focus persons (`candidatePersonId` → `targetPersonId`)
Merge the candidate focus person **into** the target focus person (mirrors
`tree-edit/SKILL.md` Step 1):
- **Names:** add candidate names not already present (dedup key:
  `given|surname|type`, case-insensitive). Keep target's `preferred`.
- **Facts:** add candidate facts that aren't duplicates (dedup key:
  `type|date|place|value`). On a **same-type conflict with differing
  value/date** keep **both** facts (per tree-edit "Decision rules" — the
  conflict is flagged in `research.json`, not here).
- **Source refs** on the person: union, dedup by `ref|page`.
- **`ark`:** keep target's. If target has none and candidate does → see §9 Q5.

### 5.3 Other (non-focus) candidate persons
Carried into the result with **remapped** IDs. (Optional dedup against target
persons by shared `ark` — §9 Q4; default: do NOT auto-dedup, only the two
named focus persons collapse.)

### 5.4 Relationships
Every candidate relationship is carried over with:
- its `id` remapped,
- `parent`/`child`/`person1`/`person2` rewritten through the person-id map
  (so `candidatePersonId` → `targetPersonId`, others → remapped),
- source `ref`s remapped.
Then **dedup**: drop a relationship whose `type` + endpoint pair already
exists (e.g. the same ParentChild pair from both docs).

### 5.5 Sources
Candidate `sources[]` merged into target `sources[]`:
- **Dedup** a candidate source against a target source by `title` (see §9 Q3
  for the key). A deduped candidate source's id maps to the matching target
  source id; a surviving candidate source gets a remapped id.
- All candidate source `ref`s (on names/facts/relationships) rewritten to the
  resulting source ids.

### 5.6 Result
`{ persons, relationships, sources }` where the focus person has
`id == targetPersonId` and carries the union of both focus persons' data,
all candidate IDs are collision-free, and every cross-reference resolves.

---

## 6. Errors

| Condition | Behavior |
|-----------|----------|
| `targetPersonId` not found in `targetGedcomx.persons` | throw `"target_person_id <id> not found in target_gedcomx"` |
| `candidatePersonId` not found in `candidateGedcomx.persons` | throw `"candidate_person_id <id> not found in candidate_gedcomx"` |
| Either gedcomx missing `persons` or empty | throw a clear input error |

---

## 7. Test plan (vitest, mirroring `match-two-examples.test.ts`)

- ID remap with **no** collision (disjoint id ranges) — refs still resolve.
- ID remap **with** collision (both use `I1/F1/S1/R1`) — candidate side fully
  renumbered, every ref rewritten, no dangling refs.
- Focus-person collapse: duplicate name dropped; non-dup name added.
- Fact dedup vs. **same-type conflict** → both kept.
- Relationship repoint (`candidatePersonId` → `targetPersonId`) + duplicate
  ParentChild dropped.
- Source dedup by title + every `ref` rewritten.
- `ark` retention on focus person.
- Errors: missing target / candidate person id.
- Purity: inputs not mutated.

---

## 8. Boundary — what the caller still does

`merge_gedcomx` only returns merged GedcomX. After calling it, the
`tree-edit` skill still:
- updates `research.json` references (`subject_person_ids`,
  `person_evidence.person_id`, `timelines.person_ids`) from
  `candidate_person_id` → `target_person_id`,
- calls `validate_research_schema`,
- (per `relationship-accuracy.md`) relies on `check-warnings` to catch
  impossible configurations introduced by the merge.

---

## 9. Open questions for review (decide before coding)

1. **Simplified vs full GedcomX?** Evidence says Simplified (≈95% confident).
   Confirm.
2. **Util only, or also an MCP tool wrapper?** A skill can only call a tool.
   Recommend util + thin `merge_gedcomx` MCP tool (validate_research_schema
   precedent). Confirm.
3. **Source dedup key** — `title`? `url`? `citation`? Or don't dedup (just
   remap all candidate sources)? Recommend `title`.
4. **Non-focus persons** — auto-dedup against target by shared `ark`, or only
   collapse the two named focus persons? Recommend: only the two named.
5. **`ark` conflict** on the focus person (target and candidate each have a
   different ark) — keep target's? Recommend keep target's (it's the surviving id).
6. **Integration shape** — the issue's signature is **cross-document** (two
   separate gedcomx). The tree-edit skill's existing protocol is **in-tree**
   (two persons in one `tree.gedcomx.json`). How should tree-edit call this —
   pass the whole tree as `target_gedcomx` and a single-person `candidate`
   doc? Or is merge_gedcomx for the "import a matched record/person into the
   tree" flow specifically? This is the biggest one.
