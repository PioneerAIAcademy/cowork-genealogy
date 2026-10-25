# `tree_edit` — single-edit tree mutation tool — Spec

> **Status:** New (2026-06-19). The sibling of the merge tools
> (`merge-gedcomx-spec.md` §5b): where those collapse persons, this one does the
> **ad-hoc single-entity edits** the `tree-edit` skill performs today by hand —
> add/correct a fact or name, add a person or relationship, and the one permitted
> deletion (tier downgrade). It reuses the exact write layer shipped with the
> merge tools (`validate-project-refactor-spec.md` §10) so the last hand-edited-
> JSON path in `tree-edit` becomes a validated, atomic, id-assigning tool call.

```
tree_edit({ projectPath, operation, ...operationFields })    -> compact summary   (additive ops)
tree_correct({ projectPath, operation, ...operationFields }) -> compact summary   (correction/removal ops)
```

Two advertised tools over one shared core, each with an `operation`
discriminator (see § "The tree_edit / tree_correct split"). The LLM supplies
the **content judgment** (which fact, what value, which relationship); the tool
does the error-prone clerical work — id allocation, the primary/preferred flag
swaps, `standard_place` resolution, array mutation, validate-before-persist,
and the atomic write.

---

## 1. Why this exists

`tree-edit/SKILL.md` §"Ad-hoc edits" at `d0915210` was hand-done JSON surgery on
`tree.gedcomx.json`, and the skill itself warns the cost of getting it wrong:
*"Get this right on the first write — validation failures cost turns"* and *"Ad-hoc
edits should be rare."* The mechanical hazards are exactly the ones the merge tools
already removed for the collapse case:

- **Id allocation by hand** — "Generate the next available `F` prefix ID"
  (`tree-edit/SKILL.md` §"Adding a fact to a person" at `d0915210`), "Use synthetic IDs (`I` prefix + next number)" (`tree-edit/SKILL.md` §"Adding a person" at `d0915210`).
  A reused or skipped id corrupts the tree.
- **The primary-flag swap** — "add `primary: true` (and remove `primary` from any
  existing fact of the same type)" (`tree-edit/SKILL.md` §"Adding a fact to a person" at `d0915210`). Forgetting the second half
  leaves two primaries of one type.
- **`standard_place` re-resolution** — "Whenever you set a fact's `place`, also set
  `standard_place`: call `place_search` … use the first result's `standardPlace`"
  (`tree-edit/SKILL.md` §"Adding a fact to a person" at `d0915210`), repeated for corrections (`tree-edit/SKILL.md` §"Correcting a value" at `d0915210`). Easy to forget on
  a place edit, leaving a stale standardized place.
- **Re-serialize-and-revalidate** — every edit ends at "call
  `validate_research_schema` … fix errors" (`tree-edit/SKILL.md` §"Validation" at `d0915210`), the whole-file
  rewrite loop this whole tool direction exists to kill.

The merge work already built the machinery (atomic write, `validateParsed`);
a single-entity edit is a strict subset of it.

---

## 2. Scope

In scope — the `tree-edit` ad-hoc operations (`packages/engine/plugin/agents/tree-edit.md` §"Ad-hoc edits"):

| Operation | Tool | Replaces (`tree-edit/SKILL.md` §, at `d0915210`) |
|-----------|------|---------------------|
| `add_fact` | `tree_edit` | "Adding a fact to a person" |
| `update_fact` | `tree_correct` | "Correcting a value" (fact date/place/value) |
| `add_name` / `update_name` | `tree_edit` / `tree_correct` | "Correcting a value" (name given/surname) |
| `update_person` | `tree_correct` | gender/ark correction |
| `add_person` | `tree_edit` | "Adding a person" |
| `add_relationship` | `tree_edit` | "Adding a relationship" |
| `update_relationship` | `tree_correct` | retype a ParentChild edge's subtype |
| `add_source` / `update_source` | `tree_edit` / `tree_correct` | source-description (`S` entry) add/correct — ad-hoc/manual source work and proof-conclusion step 6. (Record-extraction's per-record `S` entry is created by `research_append`'s composite `sourceDescription` instead — see §4.3 cross-tool ordering.) |
| `remove` | `tree_correct` | "Removing concluded data (tier downgrade)" — facts/relationships only |

### 2.1 The `tree_edit` / `tree_correct` split

The eleven operations are advertised as **two tools** over one shared
implementation core (`src/tools/tree-edit.ts` `executeTreeOps`;
`src/tools/tree-correct.ts` is a thin gate module over it):

| Tool | Admitted ops |
|------|--------------|
| `tree_edit` | `add_fact`, `add_name`, `add_person`, `add_relationship`, `add_source` — **additive only** |
| `tree_correct` | `update_fact`, `update_name`, `update_person`, `update_source`, `update_relationship`, `remove` — **corrections/removals only** |

**Rationale:** extraction must be **structurally unable to rewrite identity**.
The record-extractor agent (since retired) held `tree_edit` to write sibling stubs and
alternate names, and in the ut_013 rename incident (2026-07-12 runlog) it used
`update_name` to rename an existing tree person it judged misnamed — an
identity-resolution act that belongs to person-evidence, hypothesis-tracking,
and the tree-edit skill. Prose prohibitions do not hold when the model
believes it is correcting an error; a whole-tool allowlist does. With the op
set split by mutability, granting a context `tree_edit` but not `tree_correct`
denies every rename/rewrite/delete at the tool boundary — enforcement is
allowlist-level everywhere (Cowork `allowed-tools`, agent `tools:`
frontmatter, the eval harness), not per-run validator prose.

**Granularity ceiling — splitting the tool is the only lever.** Authorization
here is whole-tool. There is no `allowedOperations` caller contract, so a
context can be granted `tree_edit` or denied it, but cannot be granted a
*subset* of its ops. A finer split — say `add_name` but not `add_person` — has
no mechanism today except splitting the tool a second time, the way
`tree_correct` was split out of `tree_edit`. That ceiling is deliberate rather
than an oversight: the guarantee holds precisely because it is enforced at
allowlist level on all three binding surfaces named above, and a per-op contract
would have to be re-implemented and re-verified in each of them. Reach for
another tool split before reaching for per-op authorization.

Both tools keep identical batched `ops`, id rules, and validate-on-write
semantics (everything in §4–§7). An op sent to the wrong tool is
rejected before anything is applied, with a redirect naming the sibling tool
(`tree_edit only adds — 'update_name' is a correction/removal op; corrections
and removals live in tree_correct`, and the mirror-image message on
`tree_correct`); in a batch the rejection is indexed `ops[i]: …` and nothing
is written. Each tool's description cross-references the other. Everywhere
this spec says `tree_edit` about the shared pipeline (§4.1–§7), the behavior
applies to whichever tool admits the op.

In scope for sources: the lightweight **tree** `sources[]` entry (the `S`
description in `tree.gedcomx.json`, `simplified-gedcomx-spec.md` §4.3) — `title`,
optional `author`/`url`/`citation`. Out of scope: the rich `research.json`
`sources[]` (citation, repository, classification, …), which `research_append`
owns; the two are linked by `gedcomx_source_description_id`.

Out of scope: **person merging / person removal** — that is the merge tools'
job (`merge_tree_persons` removes a collapsed person and remaps `research.json`);
`tree_edit` never deletes a person. Also out of scope: `research.json` edits
(those are `research_append`), and `check-warnings` (a separate agent,
invoked to review a person rather than after every edit — see §8).

---

## 3. Evidence base (seen directly)

| Fact | Source |
|------|--------|
| Ad-hoc fact/name/person/relationship payload shapes + id rules + primary swap + standard_place resolution | `tree-edit/SKILL.md` §"Ad-hoc edits" at `d0915210` |
| Deletion is permitted ONLY for facts/relationships on a tier downgrade | `packages/engine/plugin/agents/tree-edit.md` §"Ad-hoc edits" |
| Simplified ids are `I/N/F/R/S`, "unique within their array, immutable once created" | [`simplified-gedcomx-spec.md` §3](simplified-gedcomx-spec.md#3-id-conventions) |
| `SimplifiedFact.primary?`, `SimplifiedName.preferred?`, relationship `parent/child` vs `person1/person2` | the `SimplifiedGedcomX` interface family (`SimplifiedFact`, `SimplifiedName`, `SimplifiedRelationship`) in `src/types/gedcomx.ts` |
| Shared write layer: `atomicWriteJson`, `assertInsideProject`, `validateParsed`, exported `validateGedcomx` | `src/utils/project-io.ts`, `src/validation/validator.ts` (shipped) |
| compact-return + validate-before-persist pattern | `src/tools/merge-tree-persons.ts` + `src/utils/project-io.ts` (`atomicWriteJson`) |
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
    | "add_person" | "add_relationship" | "update_relationship"
    | "add_source" | "update_source" | "remove",

  // ── targeting (per operation) ──
  personId?: string,          // add_fact/update_fact (person-held facts — exactly one of
                              //   personId | relationshipId), add_name, update_name, update_person,
                              //   remove (scopes a shared factId to this person's copy)
  factId?: string,            // update_fact, remove
  nameId?: string,            // update_name
  relationshipId?: string,    // add_fact/update_fact (Couple-held facts — exactly one of
                              //   personId | relationshipId), update_relationship,
                              //   remove (the edge itself, or scopes a shared factId to it)
  sourceId?: string,          // update_source

  // ── payloads (snake_case, NO id — the tool assigns) ──
  fact?: SimplifiedFact,            // add_fact (full) / update_fact (fields to set)
  name?: SimplifiedName,            // add_name (full) / update_name (fields to set)
  person?: SimplifiedPerson,        // add_person (full; nested names get N ids too)
  relationship?: SimplifiedRelationship, // add_relationship (full)
  source?: SimplifiedSourceDescription,  // add_source (full) / update_source (fields to set)
  gender?: string, ark?: string,    // update_person
  subtype?: string,                 // update_relationship

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
  `primary` on every other fact of the **same `type`** on that holder.
  `primary: false` means "add this without a primary" — the key is deleted
  before the write and any existing primary of the type is left alone. Any
  other spelling (`"false"`, `null`, `0`) is an input error. If
  `fact.place` is set and `resolveStandardPlace !== false` and no
  `fact.standard_place` was supplied, resolve it via `resolveStandardPlace` (null
  when nothing resolves), passing the places of the holder's other facts as
  context for a bare single-segment place (see research-append-tool-spec
  §3.6, lever B). A `personId` target whose `fact.type` is a couple event
  (`isCoupleEventFactType`) is refused, naming the Couple route (§7).
- **`update_fact`** `{ personId | relationshipId, factId, fact }` — shallow-merge
  the provided `fact` fields onto the existing fact (id immutable) on the same
  exactly-one-target contract as `add_fact`; the `factId` must live on the named
  holder. If `place` changed (and not explicitly accompanied by
  `standard_place`), re-resolve `standard_place`. If `primary: true` set, run the
  same-type swap on that holder. `primary: false` deletes the key on **that fact
  only**, leaving other facts of the type untouched — so a vital type may end
  with no primary at all, which is the point: it is the only way to retire a
  concluded value while a conflict is open. A `personId` target that retypes a
  fact into a couple event is refused (§7); editing one already there is not.
  `add_person` and `add_relationship` apply the same `primary: false` deletion
  to each inline fact they author.
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
  from `place` when unset. `person.facts` must be an array, and an inline couple
  event is refused as on `add_fact`. Synthesized stubs omit `ark`
  (`simplified-gedcomx-spec.md` §4.6). **Name-shape tolerance:** a caller that
  supplies a singular `name: { given, surname, preferred? }` object where the
  schema expects a `names: [...]` array (a common model slip — observed on ~15% of
  `add_person` calls) has it lifted into a single-element `names` array before
  validation. This is pure shape normalization (the object already matches a
  `names[]` element; no name content is parsed or invented). Supplying **both**
  `name` and `names` is rejected as ambiguous.
- **`add_relationship`** `{ relationship }` — append, assign next `R`, **or
  corroborate an edge that already says this.** Facts
  supplied on a new **Couple** relationship (e.g. its Marriage) get the same
  treatment as `add_fact`: tool-assigned `F` ids (caller-supplied ids rejected),
  `standard_place` resolution, `assignedIds.facts`. Facts on a `ParentChild` are an
  input error. Endpoint
  integrity (`parent`/`child` for `ParentChild`, `person1`/`person2` for `Couple`
  reference existing persons — tree persons or FS ids already present) and shape (no
  `person1` on a `ParentChild`) are enforced by the final whole-tree validation pass
  (§4.3, §5), not by an inline check in the apply step — so within a batch an endpoint
  added by an earlier op is accepted.
  - **A matching edge is corroborated, not duplicated.** When the tree already
    holds an edge `relationshipMatches` accepts — same `type` and endpoints (a
    Couple's two persons in either order), and subtypes that agree or either
    absent — the new `sources`, `notes` and any inline Couple facts land on **that** edge
    and `assignedIds.relationship` returns **its** id. The first match in tree
    order wins. A refusal was considered and rejected: it leaves the writer to
    re-route the same evidence by hand through `add_fact` with a
    `relationshipId`, which drops the new edge's own sources, and a retried call
    would leave two edges.
    - An inline Couple fact **equal to one already on the edge** in type, date,
      place and value is not added again; its sources merge into the fact
      already there, so a retried call is idempotent, and `assignedIds.facts`
      reports **that** fact's id — the same way the corroborated edge reports
      its own. Equality compares **type, date, place and value**: strict, not
      the merge tool's `factsEquivalent` compatibility test, which treats an
      absent date as matching any date and would silently discard the date a new
      record supplied. `standard_place` is deliberately NOT compared — the twin
      lookup runs before place resolution, so the stored fact carries a resolved
      value and the retried one does not, and comparing it wrote a second fact
      on exactly the retry this exists to absorb.
    - **The matched edge's subtype never changes.** Retyping is
      `update_relationship`'s job. When the new edge carries a subtype the
      matched one does not share, the result warns and names
      `update_relationship`; silently adopting it would turn an untyped import
      into a biological claim with nothing behind it.
    - A **Step** edge added beside a **Biological** one on the same pair is a
      second edge, not a corroboration: two different explicit subtypes are two
      relationships.
  - **A self-Couple is refused** — a person cannot be their own spouse, and the
    pair would survive every downstream rule that reads the two endpoints as
    different people.
  - **`sourceAssertionId` (source-ref resolution).** The edge requires a
    non-null source-ref (§6/§8 of `tree-materialization-spec.md`). Rather than
    the caller hand-walking `assertion.source_id → research source → tree
    S-entry` and supplying a literal `relationship.sources`, pass
    `sourceAssertionId` naming the research.json assertion this edge comes
    from; the tool resolves the ref itself via the same resolver
    `materialize_facts` uses (`utils/source-ref-resolver.ts`), including the
    direct/indirect quality distinction (§7.1). The accepted `fact_type`s are
    the shared `RELATIONSHIP_ESTABLISHING_TYPES` — `relationship`, `marriage`,
    `parentage` and `parentchild`, matched case-insensitively because the enum
    is open and models emit PascalCase for it. `marriage` was added because a marriage register is exactly
    the assertion that establishes the links a marriage record records: the
    Couple, and — where the record names them, as `father_of_bride` and
    `father_of_groom` in the `record_role` vocabulary attest — the parents. The
    check is on the assertion type, not the edge type, so a `marriage` assertion
    may source a `ParentChild` edge; that is deliberate and matches how a
    `relationship` assertion has always been accepted for any edge type. Which
    edge an assertion truly supports is the caller's judgement, as it was before. While it was refused, the two tools
    contradicted each other across the seam: this tool's own description said
    `relationship`-type and matched its guard, so it read as self-consistent,
    while `materialize_facts`'s description and `tree-materialization-spec.md`
    §4.5 both told callers to put the marriage on the Couple "sourced with the
    same assertion via `sourceAssertionId`" — a call this tool then rejected.
    Each side was internally consistent, which is why the contradiction went
    unnoticed. Models attempted the refused call anyway: the refusal appears
    seven times in committed run logs, five of them on a `marriage` assertion,
    across two unit runs and three e2e runs. Rejected if: the assertion id doesn't
    exist; its `fact_type` is none of those; its source has no matching
    tree S-entry (mirrors `materialize_facts`'s missing-S-entry error); or a
    literal `relationship.sources` is *also* supplied (ambiguous — pick one). A Couple fact (e.g. Marriage) with no
    `sources` of its own inherits the resolved ref — but only when it came
    from `sourceAssertionId`; a literal edge ref is never auto-propagated onto
    facts (unchanged: each still needs its own ref). Added 2026-07-26 to
    close the retry tax observed when the model hand-resolved the chain and
    got it wrong on the first attempt — two independent e2e runs (spriggs,
    reese-children) each burned a full retry on the session's first
    `add_relationship` for exactly this.
- **`add_source`** `{ source }` — append `source` to the tree's `sources`, assigning
  the next `S` id above the tree max (top-level, like `add_relationship` — no person
  scope, no place resolution, no primary swap). A caller-supplied `id` is rejected.
  `title` is required, enforced by the shared validation pass (`validator.ts`
  requires `[id, title]` on each tree source), so a titleless source writes nothing.
- **`update_source`** `{ sourceId, source }` — shallow-merge the provided `source`
  fields onto the existing source (`id` immutable). Errors if `sourceId` is not found
  in the on-disk tree.
- **`update_relationship`** `{ relationshipId, subtype }` — set the subtype of an
  existing ParentChild edge. It sets **only** the subtype, never the endpoints:
  re-pointing an edge makes it a different relationship (remove it and add the
  right one). Refuses an empty or whitespace `subtype` (it would match an
  untyped edge but no typed one); refuses a Couple, which carries no `subtype`
  (`TREE_COUPLE_FIELDS`; the simplified-GedcomX `parent_subtype` enum is
  ParentChild's); and refuses a retype that would make the edge match another
  edge already on the pair (`relationshipMatches`), naming that edge. This is the
  op `add_relationship`'s corroboration warning names, so a subtype only ever
  moves on an explicit correction.
- **`remove`** `{ factId }` **or** `{ relationshipId }` — delete that entry. **Only
  facts and relationships** — a `personId` **on its own** is an error (person
  removal is `merge_tree_persons`).
  - **A `factId` names a fact, not a holder, and holders share ids.** FamilySearch
    reuses fact ids across the persons an import touches: 65 of the 136 committed
    e2e starting trees carry one id on two or more holders, one of them on 15. An
    unscoped remove of a shared id is **refused**, naming every holder, because
    deleting one person's disproved imported Birth would otherwise delete it for
    all fifteen.
  - **`personId` or `relationshipId` beside a `factId` scopes the removal** to that
    holder's copy; the other holders keep theirs. Both together is an error. A
    `factId` whose id only one holder carries needs no scope.
  - `{ relationshipId }` with no `factId` still removes the edge itself.

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

**`assertion_id` is refused outright on every fact write path.** It is the
backlink `materialize_facts` stamps on a fact it mints from an assertion
(`tree-materialization-spec.md` §4.4), and it is never supplied by a caller: a
forged one would make `research_append`'s assertion-`update` rewrite silently
overwrite a hand-entered fact from an assertion it never came from. A hard
refusal rather than a silent strip, because nothing legitimate sends it, so there
is no correct call it can deny. Its one cost is that echoing a whole fact back
from a read is now rejected; no shipped skill does that, and the error says what
to remove.

**`update_fact` DETACHES a fact from its assertion when it changes one of the
fact's own fields** — any of `date`, `standard_date`, `place`, `standard_place`,
`value`, or `type`. A researcher correcting the fact directly is recording their
own conclusion, exactly as `add_fact` does, and a fact left attached would
permanently disagree with its assertion while the next assertion correction
silently reverted the human's edit. Three details the contract turns on:

- It keys on an actual **change**, not on the key being present: re-stating a
  field at the value it already holds is not a correction, and the
  conclude-a-fact shape (`primary` alongside an echoed date) is where that rides.
- It runs **after** `standard_place` re-resolution, so a sidecar the resolver
  rewrites counts as a change even when the caller never named the field.
- `type` is in the trigger although it is not a string-shape field: a
  re-classification moves the fact across the event / value-bearing line that
  decides whether an assertion's `value` may be written to it at all.

It **warns** when it detaches, naming the fields that changed, because that fact
then leaves the automatic-update set. 31 of 114 `update_fact` ops in the
committed e2e corpus set one of those fields.

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

A write that gives a child two or more **biological** parents of one sex,
where that set grew, is refused (§7) with a `competingParentage` warning and a
`conflicts_surfaced` entry. It is refused whether or not
`tooManyFathers2`/`tooManyMothers2` is new to the child, and whether the second
parent arrives by a new edge, a merge, or a parent's gender being set. No
`warningJustifications` entry passes it: the refusal leads with the route, and
asks for justifications only for any other warnings the same write introduces.
An adoptive, step, foster or guardian parent is written with that subtype and is
never counted. Each value names one parent as
`"<personId> <name> (<evidence>)"`. The evidence is the call's
`sourceAssertionId` for the proposed edge; else the parentage assertions
`person_evidence` links to that parent on the edge's sources, plus
`source <S-id>` for any source those do not cover; else `no source`. An
assertion linked only to the child is never cited, because it may name the
other parent. It is the same `ConflictSurfaced` shape `materialize_facts`
returns for vital facts.

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

Semantics (decision from the e2e research-runtime speedup review, §6 Q1):

- **All-or-nothing.** Every op applies to one in-memory tree; the whole tree is
  **validated once** and written **once** (a single atomic write, no `.bak`). Any
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
- **Cross-tool ordering.** `tree_edit` and `research_append` remain two separate
  tools/calls; an `add_person` here assigns the `I` id that a later
  `research_append` `person_evidence` op references, so a `tree_edit` batch must
  commit before a `research_append` batch that references its new ids. The one
  exception is the extraction **source** flow: `extraction_append` writes through
  `research_append`'s composite persist (`sourceDescription`, research-append spec
  §3.4), which creates the tree `S` entry itself via the shared write layer, so there is **no
  tree_edit-first step for a new record's source description** — `add_source`
  here remains for ad-hoc/manual source work and proof-conclusion's own
  source-writing path, not for the extraction persist.

The persisted tree shape is unchanged — `ops` changes only the number of write calls.

**Relationship batching needs no tool change — if a caller issues one
`add_relationship` per edge, that is a SKILL.md gap, not a missing capability.**
Worth stating because it was mis-filed as tool work for a month: `ops` has always
accepted several `add_relationship` edges in one validated, atomic call, including
an edge whose endpoint is a person another op in the same batch just minted (see
the intra-batch id-assignment rule above; exercised by the `intra-batch cross-op:
add_person then add_relationship referencing the predicted I id validates` test in
`tests/tools/tree-edit.test.ts`). What was actually missing was
that `person-evidence/SKILL.md` §7 never told the caller to *collect* a household's
edges — it issued ~7–9 separate calls for one census household, which showed up as
an e2e wall-clock regression. Fixed on the skill side (2026-07-26). Before adding a
batch axis to any tool here, check whether the caller is simply not using the one
that exists.

### 4.4 Stringified-argument tolerance

The model occasionally serializes a large or
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

**Singular `name` → `names[]` lift (`add_person`).** The same category of shape
slip, and it was the single largest driver of recovered validation retries
(observed on ~15% of `add_person` calls, ut_001/ut_003): the model supplies
`name: {given, surname, preferred?}` where the schema wants `names: [{…}]`. The
tool lifts the object into a single-element array before validation. **Shape
only** — object → one-element array; no flat-string parsing, no name content
inferred or invented. Supplying **both** `name` and `names` is rejected loudly
(`add_person: supply `names` (an array) OR a single `name`, not both`) rather
than silently resolving one, because the downstream one-preferred normalizer
would otherwise receive ambiguous input.

### 4.5 Citations onto a person with a recorded namesake

When `research.json` records a namesake row (`namesakes`) for a person, a fact
or name may cite a record onto that person only when the record ties to them.
After the ops apply in memory, each op's **introduced citations** onto a row
holder's facts and names are judged (`introducedCitations`: every ref of a node
the op makes, and the refs an existing node gains, compared without a leading
`#`; a node is matched by id on the same person). A batch is charged with what
the call adds as a whole (`netIntroducedCitations`): a ref one op drops and a
later op restores, or one op adds and a later op drops, is not charged, and a
ref several ops add is charged once, on the last of them. Each ref passes when
one of the research sources it reaches (`refsReach`) has a live `probable` or
`confident` link from one of its assertions to the person that the namesake cap
allows (`namesakeCitationRefusals`, on `namesakeVerdicts`). An S entry can back
several research sources, one per persona of a record, so one that ties is
enough; when none does, each is named. A ref that reaches no research source is
not judged. Relationships, and facts on them, are left to
Rule T, and a person-level `sources` ref is not judged: the lead's ruling of
2026-10-18 names facts and names. The cap reads relatives from the tree as it
stood **before the call**, as `materialize_facts`' copy gate does, so a
relationship the same call adds does not tie the record; one committed call has
that shape (`spriggs-parents-1898` 2026-06-24, call 89; unmeasured, its captures
stripped). The starting tree is read for the cap's starting-person ids; a missing
or unreadable one reads as none, so a relative it held whose only refs reach the
cited record reads as made from it, and does not tie it.

A finding refuses the whole call and nothing is written, `ops[i]: <text>` in the
batch form:

> `'<P>' has a recorded namesake ('<ns>'), so a record goes onto '<P>''s facts and names only when something in it ties it to '<P>'. The <fact '<F>' (<type>) | name '<N>' (<given surname>)> this op <adds | changes> cites <S> (research source '<src>'), and <it has no probable or confident link to '<P>' | its link '<pe>' to '<P>' is not tied: <the cap's first reason> | its only link to '<P>' rests on an assertion that records an absence, which ties nothing>. Nothing was written. Cite only records that tie to '<P>', or tie the record first through person-evidence; a relationship added in this same call does not count, so add it in an earlier call.`

**Measured** at `bb8af9a54` by `dev/measure-namesake-cap.ts` §6 over the committed
e2e runs, with a row planted on every person holding a live `probable` or
`confident` link: 39 calls cite a record onto such a person's fact or name, 14
onto the subject. At call time, where the replay has the run's links (15 calls;
the other 24 had their captures stripped), it refuses 5 of the 10 it judges, 3
only because the run linked the record after writing the fact. On each run's
final state it refuses 14 of the 34 calls whose citations reach a research
source, 11 of the 13 onto the subject: every refused citation but one is a link
the cap refuses, and that one rests on an assertion that records an absence
(`wilkins-death-kentucky` 2026-07-25, call 118). The replay keeps no tree, so it
rebuilds the refs a fact or name carried before an update from the starting tree
and the run's earlier citing writes; it also judges every update charged none
and every one of its refs, and the ten updates that move a count between those
two are read from their run logs instead (`TRACED_PRIOR_REFS`; a floor fails on
one that is not). Known let throughs: a ref cited
before its record is registered as a research source is never judged, even when
a later call restates it (committed instance: `antonio-lucas-spouse` 2026-08-04,
S5 on I12 since `add_person` at call 184, restated at call 214); and one `S` entry
backing both the row holder's own tied record and the namesake's passes on the
tied one, so a fact copied from the namesake's record gets through (no committed
instance; T16c). Labelled cases: `tests/tools/tree-edit-namesake.test.ts`.

---

## 5. Persistence — validate-before-persist, atomic, tree-only

Sequence (validate-before-persist, tree-only):

1. Read `tree.gedcomx.json` fresh from disk (ids checked against current state;
   a stale `factId`/`personId`/`relationshipId` is a clear error, not a silent
   no-op), then **heal legacy shapes** (`src/validation/tree-sanitize.ts`):
   trees written before the validator tightening — `preferred:/primary: false`
   from the old merge core, top-level `places[]`, unknown keys, missing ids,
   string quality, a person-level ref that names no source — are repaired in memory with one
   warning per healed class, so a pre-tightening project is never bricked. A
   successful edit persists the healed document (a one-shot migration).
   Ambiguous problems (dangling refs, swapped endpoint keys, duplicate ids)
   are NOT healed and still fail validation. Read `research.json` too — needed
   for the cross-file validation pass.
2. Apply the operation **in memory**: allocate ids, run the primary/preferred
   swaps, resolve `standard_place`.
3. **Judge citations onto a person with a recorded namesake** (§4.5): when the
   project records a namesake row, the citations the call as a whole introduces
   onto a row holder's facts and names. A finding writes nothing and returns
   `{ ok: false, errors }`.
4. **Validate** the would-be tree with `validateParsed(research, tree, { projectPath })`
   before any write. If the call introduces an error → write nothing, return
   `{ ok: false, errors }`; a pre-existing error the call did not introduce rides
   as a warning.
5. Persist: `atomicWriteJson` the new tree. **Only `tree.gedcomx.json` is written** —
   `research.json` is untouched (ad-hoc adds create ids nothing references yet;
   corrections change values, not ids; `remove` deletes facts/relationships, not
   persons — so no person-id reference can dangle). This is the Mode-1 write shape.

> **Tree-writer closure.** The tree's writers are the merge tools, `tree_edit`,
> and — for the one composite case — `research_append`, whose `sourceDescription`
> input appends an `S` entry through the same shared layer (`nextId`,
> `atomicWriteBoth`, `validateParsed`; research-append spec
> §3.4/§4). No other tool writes `tree.gedcomx.json`; all of them share the id
> allocator and validate-before-persist, so the closure holds.

> **Reuse, don't reinvent.** Id allocation needs the per-prefix max that
> `merge-gedcomx.ts` already computes privately as `maxIdNum`; with a second
> consumer now, lift it to a shared `src/utils/gedcomx-ids.ts` (the repo's
> "second concrete need → factor it out" rule) and have both call it. The persist
> half is `atomicWriteJson` + `validateParsed`, all shipped.

> **Recovery, not undo** (same caveat as the merge tools): validate-before-persist
> guarantees schema-valid, not *correct*. There is no `.bak` and no undo for a
> wrong-but-valid edit; recovery is to correct it with a further edit.
>
> **No `.bak`.** The tree writers no longer copy `tree.gedcomx.json` →
> `tree.gedcomx.json.bak` before an overwrite — nothing read it and the feedback
> bundler shipped it unredacted. Any `.bak` already sitting in an existing project
> folder is accepted, not drained.

---

## 6. Decisions recorded

- **Generic tools with an `operation` discriminator, not one tool per edit.**
  Follows this repo's "don't create one MCP tool per endpoint — use generic
  tools with parameters" rule (CLAUDE.md) and keeps Claude's tool list lean.
  The eleven operations share the entire read → apply → validate → backup → write
  pipeline; only the in-memory mutation differs. *Rejected:* `tree_add_fact`,
  `tree_add_person`, … (ten near-identical tools, ten schema entries, more
  context for no behavioral gain). The merge tools are two tools only because they
  have **different side effects** (one writes one file, the other two + a remap);
  every operation here has the *same* side effect (write the tree), so that
  argument for splitting does not apply. The one split that did land —
  `tree_edit` (add) vs `tree_correct` (update/remove), §2.1 — is not per
  endpoint but per **authority level**: it exists so a caller's tool allowlist
  can grant additive writes without granting identity rewrites/removals.
- **`standard_place` resolution is internal and on by default.** Removes the
  "call `place_search`, copy the first result's `standardPlace`" hand-step
  (`tree-edit/SKILL.md` §"Adding a fact to a person" at `d0915210`) and makes `place`/`standard_place` atomic. Overridable:
  pass `standard_place` explicitly, or `resolveStandardPlace: false`, to skip the
  network call.
- **Competing parentage is surfaced by the writer, not by a new tool.** A
  second biological parent of one sex is refused by the warning gate under a
  `competingParentage` id, so the refusal is the detector: it
  carries `conflicts_surfaced` and tells the caller to send the disagreement to
  `conflict-resolution` as an identity question, not to justify it, and, once
  it is resolved, to remove the rejected parent's edge with `tree_correct` before
  writing the chosen one: the gate refuses while both edges stand, resolved or
  not, because it reads the trees, not `conflicts`. The disputed edge stays out of the tree
  meanwhile; the entry names each parent's assertion so the conflict can be
  recorded without it. **It cannot be justified**: a re-call that justifies
  the warning is refused like the first call. Only a biological parent is
  counted, so the one edge this refuses is a second biological parent, which
  is exactly what conflict-resolution must see. *Rejected:* surfacing only on a
  successful write (it would fire only after the conflict had been justified
  away); keeping the warning justifiable (the writer agents are told to re-call
  with a justification for each warning id, so the route was advisory, and the
  reason once given, that it would block an adoptive or step parent, does not
  hold because those subtypes are never counted); routing in agent prose alone (a rule the model reads, not one the tool binds,
  ADR-0011). **Only biological parents count** (any subtype except Adoptive, Step, Foster or
  Guardian, in any case — `isNonBiologicalSubtype`), as `tooManyFathers2` / `tooManyMothers2` themselves count, so
  an adoptive or step father beside a biological one lands without a refusal. The finding is computed from the before and
  after trees and gated under its own id (`competingParentage|child|sex|parents`,
  which replaces the count warning for that child), not from the gate's
  introduced warnings. A `tooManyFathers2` id carries no related person, so a
  child who already held it would hide a new biological father, and a parent's
  gender change touches the parent while the warning sits on the child. Every
  gated writer runs it, `materialize_facts` included, since filling in an
  Unknown gender can make a second father. A merge renames parent ids through
  its collapse map, so folding one father into another is not reported, while
  folding two records of one child together is.
- **`remove` is fact/relationship-only.** The agent permits deletion only on a
  tier downgrade (`packages/engine/plugin/agents/tree-edit.md` §"Ad-hoc edits"); person removal is structurally reserved to
  the merge tools, so `tree_edit` cannot delete a person.

---

## 7. Errors / edge cases

| Condition | Behavior |
|-----------|----------|
| `projectPath` missing `tree.gedcomx.json` / invalid JSON | input error; write nothing |
| An op cites a record onto a fact or name of a person with a namesake row, and the record does not tie to them (§4.5) | refused; write nothing; the error names the record, why it does not tie, and the route |
| `personId` / `factId` / `nameId` / `relationshipId` / `sourceId` not found in the on-disk tree | staleness error; write nothing |
| `operation` requires a payload that is absent (e.g. `add_fact` with no `fact`, `add_source` with no `source`, `update_source` with no `sourceId`/`source`) | input error |
| `add_source` / `update_source` payload carries an `id` | rejected (add) / ignored (update — `id` is immutable) |
| `add_source` with a source missing `title` | validation failure; write nothing (the shared validate-before-persist pass requires `[id, title]`) |
| `add_relationship` endpoint references a non-existent person, or field shape mismatches the `type` | input error (also caught by validation) |
| `add_fact` / `update_fact` with both or neither of `personId` / `relationshipId` | input error — "requires exactly one of `personId` or `relationshipId`" |
| `add_fact` / `update_fact` targeting a `ParentChild` relationship, or `add_relationship` with facts on a `ParentChild` | input error — facts live only on Couple relationships |
| A fact payload (any write path) with a non-string `date` / `standard_date` / `place` / `standard_place` / `value` — e.g. a nested `{ original, formal }` date object | input error naming the field and expected shape; write nothing (§4.1 "Fact payload shape") |
| `add_person` inline fact / `add_relationship` fact carries an `id` | input error — the tool assigns `F` ids |
| `add_fact` with a `personId`, or an `add_person` inline fact, whose `type` is a couple event — any type `isCoupleEventFactType` (`record-persona.ts`) accepts | input error naming the Couple route; write nothing |
| `update_fact` with a `personId` that RETYPES a fact into a couple event | input error naming the Couple route. Editing a fact that is **already** a person-level couple event, by the same test, is admitted: legacy documents are read, never repaired |
| `add_person` whose `person.facts` is present and not an array | input error naming the op; write nothing |
| `remove` with a `personId` and no `factId` (attempt to delete a person) | input error — use `merge_tree_persons` |
| `remove` of a `factId` more than one holder carries, unscoped | input error naming every holder — pass `personId` or `relationshipId` |
| `remove` with both `personId` and `relationshipId` | input error — one or the other scopes a `factId` |
| `update_relationship` with no `relationshipId` or no `subtype` | input error |
| `update_relationship` with an empty or whitespace `subtype` | input error; write nothing |
| `update_relationship` on a `relationshipId` not in the tree | staleness error; write nothing |
| `update_relationship` on a Couple | input error — only a ParentChild edge carries a subtype |
| `update_relationship` retype that would duplicate an edge already on the pair | input error naming that edge; write nothing |
| `resolveStandardPlace` network call fails | best-effort: set `standard_place: null`, add a warning; never fail the edit on a place-resolution miss |
| `projectPath` is a real directory holding **neither** project file | write nothing; `{ ok: false, reason: "no_project", errors }` — the user is not in a research project, so this is an answer rather than a failure and is **not** marked `isError`. A directory holding exactly one of the two files is a *broken* project and stays loud. Applies to `tree_correct` identically. See the write-boundary invariants in `guardrail-enforcement-spec.md` |
| Resulting tree carries a **call-introduced** validation error | write nothing; return `{ ok: false, errors }`. A pre-existing error rides as a warning |
| Write introduces an **unjustified genealogical warning** | write nothing; return `{ ok: false, reason: "unjustified_warnings", errors: [message], message: "...", warnings: [{ warningId, issueType, severity, personId, personName, message, facts?, relatedPersonId? }], conflicts_surfaced? }`. Re-call with `warningJustifications: [{ warningId, justification }]` for each warning. A pre-existing warning needs no justification. A stale `warningId` is refused the same way, with `errors` naming it. When the warning is competing biological parentage, `conflicts_surfaced` names it and `message` routes it to `conflict-resolution` instead of a justification (§6). |

---

## 8. Boundary — tool vs. caller

The tool does the **structural** edit (id assignment, swaps, schema validation).
The caller (`tree-edit` skill) still:

- decides the content (which fact/value/relationship, justified by a source);
- no longer runs **`check-warnings`** after each edit to catch genealogical
  impossibilities. The tool itself refuses a write that introduces an
  unjustified warning, so the impossibility this bullet used to name — a
  parent younger than their child — is caught at the write boundary rather
  than by a pass the caller has to remember. `check-warnings` stays available
  as a review of a person already in the tree; it is not a post-edit step, and
  the agent bodies no longer instruct one;
- no longer hand-edits JSON, hand-allocates ids, or calls
  `validate_research_schema` itself — the tool does the structural validate.

---

## 9. Test plan (vitest, mirroring the merge tool tests)

- **add_fact** — appends with the next `F` id; `primary: true` clears the prior
  same-type primary; `primary: false` is deleted rather than stored, on
  `add_fact`, `update_fact`, `add_person` and `add_relationship` alike, and a
  non-boolean `primary` is refused; `place` set → `standard_place` resolved (mock the resolver);
  only `tree.gedcomx.json` written; no `.bak`; project validates.
  Relationship-targeted: `relationshipId` appends to the Couple's own `facts`
  (same F id / primary swap / place resolution; nothing lands on either spouse);
  both/neither of `personId`/`relationshipId` rejected; `ParentChild` target
  rejected; stale `relationshipId` rejected. A couple event on a `personId`
  is refused in every spelling the matcher folds, and accepted on the Couple.
- **update_fact** — field merge by `factId`; a place change re-resolves
  `standard_place`; id unchanged. Also merges by `relationshipId` + `factId` on a
  Couple-held fact; a `factId` not on the named holder errors. Retyping a
  person's fact into a couple event is refused; editing one already there, or
  retyping a Couple-held fact, is admitted.
- **add_name / update_name** — `N` id assigned; `preferred: true` clears other
  preferred; exactly one preferred remains.
- **update_person** — gender/ark set; nothing else changed.
- **add_person** — `I` id + `N` ids assigned; stub omits `ark`; inline facts get
  `F` ids (surfaced as `assignedIds.facts`) with `standard_place` resolution; an
  inline fact carrying an id is rejected; an inline couple event and a
  non-array `facts` are refused, single and batched.
- **add_relationship** — `R` id assigned; endpoints validated; `ParentChild` with
  `person1` rejected; Couple facts get `F` ids, caller-supplied fact ids rejected.
  A matching edge is corroborated: its id comes back, the caller's sources and
  notes land on it, and an inline primary fact takes `primary` from the edge's
  existing one of that type (no swap on a newly created edge).
- **update_relationship** — retypes a ParentChild edge; refuses an empty or
  whitespace subtype, a Couple, an unknown id, and a retype that would duplicate
  an edge already on the pair, writing nothing in each case.
- **fact payload shape** — a nested `{ original }` date (or non-string
  place/standard_date/…) is rejected on every fact write path (add_fact person +
  relationship, update_fact, add_person inline, add_relationship facts) with an
  error naming the field; nothing written, no `.bak`.
- **add_source / update_source** — `S` id assigned above the tree max (S-aware
  `nextId`, so `S1`→`S2`); a caller-supplied `id` is rejected on add; `author`/`url`
  round-trip into the written `S` entry; `update_source` merges by `sourceId` (id
  immutable), errors on an unknown `sourceId`; missing-payload guards return
  `{ ok: false }`; a titleless `add_source` fails validation and writes nothing.
- **remove** — fact/relationship deleted by id; `remove` with a bare `personId` rejected; a shared `factId` refused unscoped and removed from only the scoped holder.
- **staleness** — an unknown `factId` returns an error, writes nothing.
- **validate-before-persist** — an edit that would invalidate the project writes
  nothing and returns `{ ok: false, errors }`; no `.bak` written.
- **research.json untouched** — byte-unchanged after any operation.
- **Namesake citation check** (§4.5) — `tests/tools/tree-edit-namesake.test.ts`:
  a fact, name or update citing an untied record onto the row holder is refused
  with both files unchanged; a tied record, no row, a row on a relative only, a
  ref no research source cites, a fact on a relationship, an update restating or
  respelling a ref, and a relative the starting tree holds are all written; a
  relationship the same call adds does not tie the record. An S entry two
  research sources share passes on one that ties and names each when none does;
  a batch is judged as a whole, each ref charged once, to the last op adding it.

---

## 10. Wiring

Standard MCP tools: `src/tools/tree-edit.ts` (shared core + `tree_edit`) and
`src/tools/tree-correct.ts` (thin gate module exporting `tree_correct`),
schemas in `allToolSchemas` (`src/tool-schemas.ts`), dispatch in
`src/index.ts`, names in `manifest.json` (packaging drift test enforces
parity). camelCase params at the boundary; persisted tree stays snake_case
(the tool renames nothing — payload fields are already the snake_case
simplified-GedcomX shape the skill passes).

---

## 11. Consumers

- `tree-edit` skill — its "Ad-hoc edits" section is rewritten to call `tree_edit`
  (one call per edit) instead of hand-editing JSON + calling
  `validate_research_schema`. The "Person merging" section already routes to the
  merge tools (per `skill-rewrites-for-persistence-tools-spec.md`); this completes
  the migration of the skill's write paths. Together, `merge_*` + `tree_edit` +
  `research_append`'s composite `S`-entry write (research-append spec §3.4) cover
  every write to `tree.gedcomx.json`.
