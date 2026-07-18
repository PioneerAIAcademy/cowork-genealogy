# Tree Materialization — Ownership Spec

> **Status:** Draft v1 (2026-07-18). Owns the decision `#701` asks for:
> **who promotes extracted record facts onto tree persons, and how
> provenance rides along.** Introduces one new MCP tool
> (`materialize_facts`), reassigns ownership across the record→tree
> pipeline, rewrites the "tree carries only concluded data" doctrine in
> `research-schema-spec.md` §8, and **retires `merge_record_into_tree`**
> (dead code, removed in a phased pass within the implementing PR).
>
> This spec is the source of truth for the cross-skill materialization
> contract. For the internal behavior of the pieces it **references** the
> existing specs: `research-schema-spec.md`, `simplified-gedcomx-spec.md`,
> `research-append-tool-spec.md`, `merge-gedcomx-spec.md`, and the skill
> specs under `packages/engine/plugin/skills/`.
>
> Grounding evidence is the July record-extraction audit (theme T6) and
> the closing report §3.4 (`docs/plan/record-extraction-consolidation-closing-report.md`),
> plus a first-hand diagnosis of the `cruz-corona-ancestry` e2e runs
> (§1.2).

---

## 1. Why this exists

### 1.1 The gap

Extraction attaches assertions to a **persona** (`record_id` +
`record_role`) in `research.json`; nothing carries those facts onto the
**tree person**. Three symptoms, one hole (audit theme T6, 8/27 July
scenarios; judges penalize the thin tree):

1. **No skill promotes extracted facts onto tree persons.** Tree persons
   stay name-only shells while the evidence sits one file away.
2. **Fact-less sibling stubs are never enriched.** Today an
   `add_household_children` step mints name-only stubs; a later record
   carrying facts about that sibling never lands them. (Under §3, household
   stub-minting moves onto person-evidence's `materialize_facts`
   create-or-enrich — which mints each member *with* facts — and
   `add_household_children` retires; §9.)
3. **The stub-minting trigger can't fire on a family's first record** — it
   needs the parents already in the tree. (This symptom **dissolves** under §4:
   create-or-enrich is one path, so "first record" stops being special.)

### 1.2 What cruz actually proves (the provenance rider)

The closing report §3.4 flagged "citation-less tree sources (cruz 11/14)."
Reading the `cruz-corona-ancestry` run (`run-2026-07-13_04-12-41`)
first-hand shows the report **measured the wrong thing**:

| Layer | State |
|---|---|
| `research.json` assertions | **80/80 carry `source_id`**; 7/7 sources carry `gedcomx_source_description_id` **and** a `citation` |
| tree facts | **0 of ~13 carry any source-ref** (`sources[]` empty on every fact) |
| tree names | **0 of 19 carry a source-ref** |
| tree S-entries | 7/8 have no ESM `citation` string — **working as specified** (omit during research; `simplified-gedcomx-spec.md` §4.3) |

The defect is **not** absent ESM citation strings (those are deliberately
deferred to upload). It is that **every fact and name on the tree is a
provenance orphan** — the `fact → source` pointer is dropped wholesale —
*even though the complete chain
(`assertion.source_id → research source → S-entry id → citation`) is intact
in `research.json`.* This is **lost** provenance at the materialization
seam, not missing provenance.

Root cause: the intended materialization path
(`person-evidence` produces a merge set → `proof-conclusion` feeds
`merge_record_into_tree`, per `person-evidence/SKILL.md` §7) requires the
LLM to **hand-assemble a `candidateGedcomx`** with facts and refs on each
persona. That hand-assembly is the re-serialize anti-pattern the structured
persistence tools exist to kill (`merge-gedcomx-spec.md` §1). The LLM drops
the refs (and often the facts entirely). Across **every** e2e session log,
`merge_record_into_tree` has **zero actual tool calls** — the pipeline
routes around it.

### 1.3 The fix in one sentence

Move materialization onto an **assertion-driven** tool
(`materialize_facts`) that the LLM feeds *references*, not a serialized
document — so it reads the intact provenance chain from `research.json`
itself and **cannot** drop it.

---

## 2. The model: two layers, relaxed doctrine

Evidence-based genealogy runs **Source → Information (persona) → Evidence →
Conclusion**. This repo maps it onto two files:

- **`research.json` assertions = the evidence layer.** Each assertion is
  one source's classified claim about one persona (`evidence_type`,
  `information_quality`, `informant_proximity`, `date_certainty`). The GPS
  audit trail. **Unchanged.**
- **`tree.gedcomx.json` = the conclusion layer.** Today, deliberately thin:
  `research-schema-spec.md` §8 says the tree is updated *only when a proof
  summary reaches `probable` or higher*, and `simplified-gedcomx-spec.md`
  dropped `confidence` on conclusions ("use `research.json` proof tiers
  instead").

**The doctrine change (§10):** relax "tree = concluded ≥ probable" so that
**sourced evidence facts materialize onto tree persons as research
proceeds** (at identity-link time), while **which value is *concluded*
stays a separate, later act**. This is how competent genealogists actually
work — attach evidence to a person as you find it, layer the conclusion on
top — and it is the whole point of the GedcomX evidence/conclusion split.

Two invariants keep the relaxation safe:

- **Conflicting values coexist; never suppress.** Agreeing values collapse
  to one fact accumulating multiple source-refs; disagreeing values coexist
  as separate facts. At materialization time you often do not yet know which
  value is wrong, and GPS *requires resolving* conflicts, which requires
  *keeping* them.
- **Upload stays conclusion-gated (§7).** The working tree carries
  evidence; only `primary`/proof-backed facts upload to FamilySearch. The
  original doctrine's intent — FamilySearch receives conclusions, not raw
  evidence — is preserved.

### 2.1 Belief lives where it already lives

No new tree field. The schema already carries everything the belief model
needs (`simplified-gedcomx-spec.md` §4.2, §4.4):

- A fact carries **`sources[]`** — an **array**, so multiple source-refs per
  fact is already legal.
- **`primary: true`** on a fact (and **`preferred: true`** on a name) marks
  "the concluded/preferred value of this type" — the concluded-value marker.
- Belief **level** stays in **`proof_summaries.proof_tier`**
  (`proved`/`probable`/`possible`/…).

A new belief-level enum or free-text field on the tree fact is **rejected**:
it duplicates `proof_tier` and re-creates the very "confidence on
conclusions" the schema removed, giving two sources of truth that drift.
The `quality` (QUAY) integer on a source-ref is a quick-scan signal only —
the spec itself notes it is "insufficient for analytical decisions" and that
real GPS weighing must read the `research.json` assertions. **Evidence is
weighed, not counted:** the count of source-refs on a fact must never be
read as its confidence.

---

## 3. Ownership: four skills, disjoint jobs

| Skill | Responsibility | Tools |
|---|---|---|
| **record-extraction** *(narrows — assertion-only)* | Extract classified assertions onto `record_id`+`record_role` (personas), **including relationship-type assertions** (parent-child, spouse); create the per-record S-entry. Emits **assertions only** — `mcp__genealogy__tree_edit` is dropped from its frontmatter and it no longer writes household stubs or names. **Writes only the source S-entry** (via `research_append`'s composite `sourceDescription`); it writes no persons, facts, names, or relationships. | `research_append` (assertions + composite `sourceDescription`), `research_log_append` |
| **person-evidence** *(grows — the fix)* | Decide identity (link persona→person, or mint a new person); **write the linked persona's assertions as sourced facts/names onto the tree person** via `materialize_facts`; own the **household skeleton** — mint each member (sibling stubs included) via `materialize_facts` create-or-enrich, and write parent-child + spouse-spouse **edges** via `tree_edit` `add_relationship`, each edge carrying a source-ref resolved from the relationship assertion's `source_id` (same resolver as `materialize_facts`). Match later personas to fact-less stubs to enrich them. Before committing a household's materialization, **dry-run `merge_warnings`** as a coherence gate (§9). **Never sets `primary`/`preferred`.** | **`materialize_facts`** (new), `research_append` (`pe_` links), `same_person`, `tree_edit` (`add_relationship`), `merge_warnings` |
| **conflict-resolution** *(unchanged role, now fed by materialization)* | Resolve the coexisting-conflict facts materialization surfaces; write `conflicts`. | `research_append` (conflicts) |
| **proof-conclusion** *(narrows)* | Weigh already-materialized evidence, set **`primary`/`preferred`** on the concluded value — via `tree_correct` `update_fact` when the value matches an existing evidence fact, or via `tree_edit` `add_fact` (`primary:true` + multi-refs) when the conclusion is **synthesized** and matches no single record (§7.1); write `proof_summary`+`proof_tier`; at upload copy ESM citations onto S-entries and gate upload to concluded facts; collapse duplicate tree persons. | `tree_correct` (`update_fact` → set `primary`), `tree_edit` (`add_fact`), `research_append` (`proof_summaries`), `merge_tree_persons`, `merge_warnings` |

The seam that makes this un-guessable is **substrate + operation**:

- **Changing WHO is in the tree** (a node exists, or two nodes are the same
  individual) → a **merge/structure** op (reads *nodes*).
- **Recording WHAT a source says about a person whose identity is settled**
  → **`materialize_facts`** (reads *assertions*).

`materialize_facts` is the **only** tool that reads `research.json`
assertions and writes new tree facts. The merge tools only ever *union facts
that are already on nodes and already carry refs*. Neither can do the
other's job.

---

## 4. The `materialize_facts` tool

### 4.1 Contract

```
materialize_facts({ projectPath, personId, recordId, recordRole })
  -> compact summary
```

- The caller passes **references**, not data. The tool reads the persona's
  assertions (all assertions matching `recordId`+`recordRole`) from
  `research.json`, resolves each one's provenance, and writes to
  `tree.gedcomx.json`. (`personId` may be an id that does not yet exist —
  see create-or-enrich.)
- Reads the tree fresh from disk, validates the would-be project
  (`validate_research_schema` / `validateParsed`), writes atomically with a
  backup, and returns a **compact** summary (person id, facts
  added/enriched, refs attached, conflicts surfaced) — never an echo of the
  written JSON.

### 4.2 Behavior, per assertion

1. **Map** `fact_type` → tree fact type, honoring the structured-fact model
   (`#711`): an event's `place`/`date` are attributes of the event fact, not
   their own types.
2. **Resolve the source-ref** —
   `assertion.source_id → research.json source → gedcomx_source_description_id
   → tree S-entry id` — and build `{ ref, page?, quality? }`. If the S-entry
   does not exist, **error** (do not silently null; the S-entry is an
   upstream `research_append` responsibility, and a missing one is a gate
   failure to surface, not to paper over).
3. **Upsert onto the person** — fact identity is **not** `(fact_type, value)`.
   The GedcomX `value` field is a qualifier that is **null for event facts**
   (Birth/Death/Marriage/Residence), so keying on `(type, value)` collapses
   *every* birth into one fact and silently drops conflicting dates/places.
   Two facts are the **same fact** (union their source-refs) **iff
   `factsEquivalent(a, b)` AND `a.value === b.value`**, where `factsEquivalent`
   is the **existing** helper in
   `packages/engine/mcp-server/src/utils/merge-gedcomx.ts` (`type` +
   `datesCompatible` + `placesCompatible`). Reuse it (CLAUDE.md code-reuse
   rule) — lift only `factsEquivalent` and its date/place-compat helpers; do
   **not** reuse `mergeFacts` wholesale, which sets `primary` on
   `VITAL_PRIMARY_TYPES` and would violate "materialization never sets
   `primary`."
   - **Same fact** (`factsEquivalent` **and** equal `value`) → **union** the
     new ref into its `sources[]` (ref-set dedup). Corroboration accumulates
     as refs.
   - **Incompatible date/place, OR a different `value`** → the facts
     **coexist** as separate facts; the new one carries its ref. A competing
     value is *surfaced* (see §4.4), never overwritten.
   - **`primary` is never set here.** Names get the same treatment
     (equivalence + value); `preferred` is never set here.

### 4.3 Create-or-enrich (dissolves the "first record" symptom)

If `personId` does not exist, `materialize_facts` **mints** the person from
the persona's name/gender assertions, then writes its facts — all in one
validated call. "Create a new person from a record" and "enrich an existing
person from a record" are the **same** operation. Because facts are the
*input*, a person created this way **cannot** be fact-less — which is the
structural cure for symptoms (1) and (2).

> Reading assertions to *instantiate* a person is still an evidence-driven
> act (it reads assertions, not nodes), so it stays on the correct side of
> the §3 seam. It is not a merge — nothing is collapsed.

### 4.4 Idempotency and conflict surfacing

- **Idempotent.** Re-running the same persona's materialization (retries are
  common) duplicates neither facts nor refs — the §4.2 fact-identity test
  (`factsEquivalent` + equal `value`) plus ref-set union makes a re-run a
  no-op. Mirrors the idempotent-skip ratified as correct in `#711`.
- **Conflicts surfaced, not resolved — and only for single-valued types.**
  Conflict surfacing is **gated to single-valued / vital fact types**: reuse
  the existing `VITAL_PRIMARY_TYPES` set (`Birth`, `Death`, `Christening`,
  `Burial` — `Marriage` is a couple-relationship fact and is **not** in the
  set; leave it out unless a later need proves otherwise). For those types, an
  incompatible competing value is listed on return
  (`conflicts_surfaced: [{ personId, factType, values }]`). **Multi-valued
  types** — `Occupation`, `Citizenship`, and the `RESIDENCELIKE_FACT_TYPES`
  family (`Census`, `MunicipalCensus`, `Residence`) — legitimately hold many
  concurrent values; they **coexist as separate sourced facts and are NOT
  reported in `conflicts_surfaced`.** `VITAL_PRIMARY_TYPES` currently lives in
  two copies (`merge-shared.ts`, `merge-gedcomx.ts`); lift it to a shared
  module so this gate and the merge core read one definition.
- `materialize_facts` **does not** write `conflicts` entries — that stays
  `conflict-resolution`'s job. The tool reports; the skill routes.

### 4.5 What it never does

Never sets `primary`/`preferred`; never resolves conflicts; never collapses
or merges persons; never writes relationships (those are `tree_edit`
`add_relationship`, see §8).

---

## 5. Tool roster

| Tool | Role | Status |
|---|---|---|
| **`materialize_facts`** | Assertion-driven: create-or-enrich a person with **sourced** facts/names; auto-carries refs; mandatory non-null ref on every fact/name it authors; never sets `primary`. | **NEW — the record→tree workhorse** |
| **`merge_tree_persons`** | Collapse two duplicate **tree nodes**; union their facts, carrying each fact's existing refs through untouched. Legacy ref-less facts are **tolerated** — the Mode-2 fold neither requires nor fabricates a ref (Cluster B / §6). | **Keep** (needs a trigger — e.g. cruz's unmerged grandparents — but the tool is right) |
| **`merge_record_into_tree`** | Fold a candidate GedcomX *document*. | **Retire** (§9) — 0 live calls; its hand-assembled-candidate input is the re-serialize anti-pattern that dropped cruz's refs; its niche does not occur in the assertion pipeline |
| `tree_edit` / `tree_correct` | Structure (`add_person`, `add_relationship`) / corrections + `primary`. `add_household_children` **retires** (§9) — superseded by `materialize_facts` create-or-enrich (stubs, now with facts) + `add_relationship` (edges). | Keep; refs mandatory on **newly-authored** facts/names/edges only (add-ops); `tree_correct` may not null an existing ref (§6, §8) |

---

## 6. Provenance: structural, not disciplinary

The mandatory-ref guard is **delta-scoped** — it enforces a non-null
source-ref only on content a writer **newly authors or introduces**, never on
pre-existing nodes merely carried through. A write is **rejected** when it
*introduces* a ref-less fact, name, or edge; it is **not** rejected for a
ref-less node it did not create.

Where the guard fires:

- **`materialize_facts`** — every fact and name it authors (new or the
  enriching ref on an existing fact) must carry a resolved non-null ref, or
  the call errors (§4.2 step 2).
- **`tree_edit` add-ops** — `add_fact`, `add_person` inline facts,
  `add_relationship`, and any other new-node op must carry a ref on the
  content they introduce (§8).
- **`tree_correct`** — the guard is "**the op did not remove an existing
  ref**": clearing a populated `sources[]` to null is rejected. It is **not**
  "the result has a ref," so touching an already-ref-less legacy fact without
  removing anything is allowed.

Where the guard does **not** fire:

- **`merge_tree_persons` (Mode 2 / `mergeSameDocument`) carries no
  mandatory-ref guard.** Mode 2 only relocates already-persisted facts
  between nodes; a result-state guard here is either vacuous or **bricks every
  merge of a legacy ref-less tree** — 98% of the 52 e2e starting trees (cruz
  0/13) — and would reject the §5-style merge of cruz's grandparents.
- **Legacy ref-less trees are tolerated** on the merge and correct paths. We
  deliberately do **not** fabricate, backfill, or heal refs for pre-existing
  ref-less content — a fabricated ref is a worse lie than an honest null.

Consequences:

- The cruz leak (100% of *newly written* facts ref-less) becomes
  **unrepresentable** at the writing seam — every fact/name/edge a writer
  *authors* carries a ref.
- **Provenance-nulling-as-error-recovery** (closing report §3.4) becomes
  unrepresentable on the write path — a writer cannot null a ref to escape
  validation.

A **golden anti-regression test** asserts that every fact, name, and edge a
**writer wrote** carries a non-null ref — scoped to **written content**, not
"every node in the whole tree" (which would fail on tolerated legacy nodes).
`merge-tree-persons.test.ts` is **not** in the golden writer list — the Mode-2
fold authors nothing.

**The ESM citation string is out of scope here.** The tree S-entry's
`citation` stays populated by `proof-conclusion` at upload time (copied from
`research.json` `sources[].citation`), per existing doctrine. This spec owns
the **source-ref (pointer)**; the `citation` skill / proof-conclusion own the
**ESM string**. The two must not be conflated (the §1.2 mis-framing).

---

## 7. `primary` / `preferred` semantics

- **Only `proof-conclusion` sets `primary` (facts) / `preferred` (names).**
  Materialization always lands them absent. This removes the set/unset/reset
  churn that would arise if materialization guessed a preferred value and
  later facts forced a change.
- **A person may legitimately carry facts with no `primary` yet** (before
  proof runs). Defined fallback:
  - **Viewer:** display the sole fact of a type; if several coexist and none
    is `primary`, show them as un-ranked evidence (surface the conflict).
  - **Upload:** send **only** `primary`/proof-backed facts. Un-concluded
    evidence stays out of FamilySearch.
- A `primary` fact is a *concluded display value*, **not** a proof claim.
  Strength always lives in the `proof_summary`'s `proof_tier`; a lone
  `primary` fact from one source is `possible` at best.

### 7.1 Indirect evidence and synthesized conclusions

Two conclusion paths for `proof-conclusion`, both of which set `primary` (§7):

- **Value matches an existing evidence fact** (the common case) — the
  concluded value equals a fact already materialized from a record. Set
  `primary` on it via `tree_correct` `update_fact`; **no fact is added.**
- **Synthesized conclusion** — the correlated value matches **no single
  record** (e.g. three census ages → a computed "abt 1805"). `proof-conclusion`
  **adds** a fact with `primary: true` carrying **multiple source-refs to all
  the correlated evidence S-entries** (multi-ref `sources[]` is already
  supported — §2.1). This is why `tree_edit` `add_fact` is in
  proof-conclusion's roster (§3).

How indirect evidence flows through materialization:

1. **Extraction already classifies it.** An indirect claim lands with
   `evidence_type: indirect` and `date_certainty: calculated` (per `#711`,
   which splits a census into a *direct* birthplace assertion and an
   *indirect* computed birth-year). Materialization does not re-derive the
   class; it reads it.
2. **Value-bearing indirect evidence materializes** as a fact/edge, but the
   inference is encoded **honestly in the value/date** — a GEDCOM
   `abt`/`cal`/`est` qualifier, never a bare stated year — and the source-ref
   **quality reflects the weaker evidence class**. The full classification
   stays in `research.json`, reachable through the ref; the tree fact is the
   honest summary, not the audit trail.
3. **Indirect evidence never self-concludes.** It reaches a *concluded*
   (`primary`) value only through `proof-conclusion` correlation plus a
   written argument — which is exactly **why only `proof-conclusion` sets
   `primary`** (§7). A materialized indirect fact sits un-`primary` until then.
4. **Purely-argumentative / negative evidence does not materialize as a
   fact** — there is no positive value to write. It stays a `research.json`
   assertion feeding the argument; only its *conclusion* (e.g. a death
   "bef 1870" established by absence) materializes, and that is
   `proof-conclusion`'s additive write.

---

## 8. Relationships carry refs

A census (etc.) establishes parent-child and spousal edges — evidence from
that record. **Newly written** relationship edges (`tree_edit`
`add_relationship`) **carry a non-null source-ref** under the delta-scoped §6
rule, resolved from the relationship assertion's `source_id` (the same
resolver `materialize_facts` uses), or relationships become the next
provenance leak. `add_household_children` **retires** (§9); person-evidence
mints household members via `materialize_facts` create-or-enrich and writes
their edges via `add_relationship`. Pre-existing legacy edges are tolerated
(they are not re-authored). `materialize_facts` writes facts/names only;
relationship provenance rides the edge-writing op. Note: a **pre-1880 census
parent-child edge is *indirect* evidence** (a headship/co-residence inference,
not a stated relationship) — it still carries a ref, at a **lower ref
quality** reflecting the weaker evidence class (§7.1).

---

## 9. Retiring `merge_record_into_tree` (dead-code removal phase)

`merge_record_into_tree` is superseded by `materialize_facts` and is dead
(0 live calls; re-serialize input model). It is removed in a **dedicated,
verified phase inside the implementing PR** — not deferred. Scope:

**Remove:**
- `packages/engine/mcp-server/src/tools/merge-record-into-tree.ts`
- Its schema entry in `src/tool-schemas.ts`, dispatch in `src/index.ts`, and
  entry in `manifest.json` (the manifest-drift test enforces sync).
- `tests/tools/merge-record-into-tree.test.ts`.
- `merge_record_into_tree` prose in `person-evidence/SKILL.md` §7,
  `proof-conclusion/SKILL.md` (+ `references/validation-protocol.md`), and
  `tree-edit/SKILL.md` (+ `references/relationship-accuracy.md`) — replaced by
  the `materialize_facts` flow (§3).

**Retiring `merge_record_into_tree` frees zero shared code.** It deletes no
`merge-gedcomx.ts` mode and no `merge-shared.ts` helper: `merge_warnings`
(`merge-warnings.ts:64`) calls `mergeGedcomx(tree, candidate, merges)` with a
**non-null candidate**, so it independently exercises **Mode 1
(cross-document)** and `sanitizeCandidate` / `validateCandidateGedcomx`. All
three **stay**. The deletable set is exactly the tool file, its test, and the
four wiring/prose sites above.

**Preserve (verify still live):** `merge_tree_persons`, `merge_warnings`
(pre-merge coherence for `merge_tree_persons`, **and now** person-evidence's
pre-materialization household coherence gate — Cluster D), the shared
`merge-shared.ts` core (including `sanitizeCandidate` /
`validateCandidateGedcomx`), and **Mode 1** of `merge-gedcomx.ts` — the last two
independently required by `merge_warnings`.

**Also retire in this phase — `add_household_children` (recommend retire):**
- The `add_household_children` op in
  `packages/engine/mcp-server/src/tools/tree-edit.ts` (op handler, helpers,
  schema/checklist copy) — its name-only-stub role is superseded by
  `materialize_facts` create-or-enrich (stubs now arrive *with* facts) and its
  edges by `add_relationship`. **Scope note (reshape-vs-retire):** the op
  *could* be reshaped to write refs, but with both of its jobs already owned by
  other tools it has no remaining caller — **recommend retire**, not reshape.
- `packages/engine/plugin/agents/record-extractor.md` — **drop
  `mcp__genealogy__tree_edit` from its frontmatter**, remove the Step-5
  `add_household_children` call and the `add_name` call, and **reword the
  `description` frontmatter** to strike the "sibling person stubs when the
  subject is a child on a household record" clause (the auto-delegation trigger
  must reflect assertion-only extraction). record-extraction emits **assertions
  only** (including relationship-type assertions); person-evidence owns the
  household skeleton (§3, Cluster C).
- `tests/tools/tree-edit.test.ts` `add_household_children` cases and any
  fixture asserting extraction writes stubs/names.
- `docs/specs/tree-edit-tool-spec.md` — remove `add_household_children` from its
  op table, admitted-ops list, ops checklist, result-shape fields, and the §4.4
  behavioral section (op retired, not reshaped — its `record-extraction §5d`
  ownership row is deleted, not repointed).

**Rewire, do not supersede (decided):**
`docs/specs/match-merge-workflow-spec.md` and
`tests/integration/match-merge-workflow.test.ts` reference
`merge_record_into_tree` for their "fold" step. That workflow is **rewired
to `materialize_facts`**, not superseded — its genuine contribution, the
**coherence gate** (`merge_warnings` / the `hasSameCensus` and
`hasEventsOutsideLifespanFar` MobWarnings port), is orthogonal to the fold and
worth keeping. Under the rewire the monolithic household "fold" **dissolves**
into the per-persona flow (link → `materialize_facts` → relationship edges,
§3–§4). The coherence gate's **invocation owner moves from proof-conclusion to
person-evidence** (Cluster D): person-evidence runs `merge_warnings` as a
**dry-run on the household merge set *before* committing** the household's
materialization, applying the **error-block / warning-advisory** tiers, with
`hasSameCensus` etc. **re-anchored to the pre-materialization state** (they
currently gate a `merge_record_into_tree` fold that no longer exists). This is
**wired in this PR** (§12 phase 3, alongside the skill rewrites) — **not**
deferred to Open Questions or `docs/TODOs.md`. The
`match-merge-workflow-spec.md` edit and its integration-test coherence
assertions (`hasSameCensus`, `hasEventsOutsideLifespanFar`) are preserved and
carried by that phase.

**Verification gate for the phase:** `grep` for any surviving
`merge_record_into_tree` / `mergeRecordIntoTree` reference returns nothing
unintended; the full `vitest` suite and the manifest-drift test
(`tests/packaging/manifest.test.ts`) pass.

> Any item this PR ends up **deferring** (rather than removing) gets a
> `docs/TODOs.md` entry in the same PR — e.g. wiring a duplicate-node
> trigger for `merge_tree_persons`, if that is not done here.

---

## 10. Schema doctrine edit (blast radius)

The core doctrine change is a rewrite of `research-schema-spec.md` §8 ("tree
update timing") from *"tree updated only at proof ≥ probable"* to *"evidence
facts materialize at identity-link time with provenance; `primary`/`preferred`
+ `proof_tier` govern conclusion; upload is conclusion-gated."* This is
**doctrine, not a new field or enum** — no closed-enum or tree-shape
allow-list change is required (the schema already permits `sources[]` arrays
and `primary`/`preferred`). Sites to touch:

- `docs/specs/research-schema-spec.md` §8 (the rule) and the worked example
  that currently ties tree facts to a `probable` proof summary.
- `docs/specs/simplified-gedcomx-spec.md` §2/§4.3 (the "updated when a proof
  summary reaches `probable`" note; the "omit `citation` during research"
  note stays correct).
- `docs/specs/research-append-tool-spec.md` — confirm the composite
  `sourceDescription` still owns S-entry creation (it does); no change to the
  S-entry contract, but cross-reference `materialize_facts` as the fact
  writer.
- The four skill bodies in §3, plus their eval briefs/rubrics where they
  assert the old thin-tree doctrine.
- `packages/engine/plugin/agents/record-extractor.md` — drop
  `mcp__genealogy__tree_edit`; assertion-only, no stub/name writes (Cluster C
  / §9).
- The **delta-scoped mandatory-ref guard** (§6) is enforced at the
  writer-tool boundaries (`materialize_facts`, `tree-edit.ts` add-ops,
  `tree-correct.ts`), **not** as a whole-tree `validator.ts` invariant — so no
  closed-enum or tree-shape allow-list change (Cluster B).
- The web mirror (`packages/schema/`) needs **no** change (no field/enum/
  tree-shape edit) — confirm during implementation.

---

## 11. person-evidence enrichment trigger (craft, not mechanism)

person-evidence already matches candidates on name / age / place / gender /
**relationship-fit** (`SKILL.md` §2), so a fact-less stub is **not**
invisible — its name, gender, and parent-child edge are matchable, and
relationship-fit is the strongest signal for a household stub. The gap is the
**strength rubric**: a stub match is rated "weak" because vitals are missing,
which stalls on a user pause and blocks enrichment (a chicken-and-egg — you
need facts to confirm identity, but you match to *add* facts). The spec's
person-evidence edit: **a strong relationship-fit (a child positioned under
known parents in a household) is sufficient evidence for a stub match; do not
down-rate it purely for the stub lacking vitals.** No new matching mechanism —
`materialize_facts` handles the write once the match fires.

---

## 12. Implementation phases (spec-then-implement)

1. **`materialize_facts` tool** — types, tool, schema/dispatch/manifest wiring,
   `dev/try-*`, unit tests. Enforces §4 + §6 (delta-scoped mandatory ref,
   create-or-enrich, idempotency, conflict surfacing). **Fact identity reuses
   `factsEquivalent` from `merge-gedcomx.ts`** (type + date/place-compat) AND
   equal `value` — never `(fact_type, value)` alone (§4.2). Conflict surfacing
   is **gated to `VITAL_PRIMARY_TYPES`** (§4.4 / Cluster F); lift that set to a
   shared module. Unit tests: two `Birth` assertions with different
   dates/places yield **two coexisting facts + one surfaced conflict** (not one
   fact with a lost value); the conflict test uses a **vital (`Birth`)**, not
   `Occupation`. Follows the standard four-file scaffold.
2. **Delta-scoped mandatory-ref enforcement on the other writers** —
   `tree_edit` add-ops (`add_fact`, `add_relationship` (§8), `add_person`
   inline facts) reject ref-less **newly-authored** content; `tree_correct`
   rejects an op that **removes** an existing ref (not "result lacks a ref").
   **`merge_tree_persons` is NOT in this list** — its Mode-2 fold carries no
   mandatory-ref guard and tolerates legacy ref-less trees (§6). Add the
   **golden anti-regression test** (every fact/name/edge a writer *wrote*
   carries a ref; scoped to written content; `merge-tree-persons.test.ts`
   excluded). Blast-radius: the delta guard lives at the writer-tool
   boundaries, **not** as a whole-tree `validator.ts` invariant.
3. **Skill rewrites** — record-extractor.md (**drop `mcp__genealogy__tree_edit`**;
   emit assertions only, incl. relationship-type — Cluster C); person-evidence
   (call `materialize_facts` on link; write parent-child/spouse **edges** via
   `add_relationship`; **dry-run `merge_warnings`** as the household coherence
   gate before committing — Cluster D; §11 stub-match craft); proof-conclusion
   (set `primary` via `tree_correct`; **additive path** — `tree_edit` `add_fact`
   with `primary:true` + multi-refs for synthesized conclusions, §7.1 /
   Cluster E; upload citation/gating); conflict-resolution (consume surfaced
   conflicts). Rewire `match-merge-workflow-spec.md` invocation owner to
   person-evidence. Update eval briefs/rubrics.
4. **Doctrine edit** — `research-schema-spec.md` §8 + the sites in §10.
5. **Dead-code removal** — §9, behind its verification gate: retire
   `merge_record_into_tree` **and** `add_household_children` (recommend
   retire). **Last**, so the new path is proven before the old one is deleted.

Each phase is independently reviewable; the suite stays green between them.

---

## 13. Open items for review

- **Duplicate-node trigger for `merge_tree_persons`** — out of scope here
  (this spec makes the tool's *inputs* clean but does not wire the "these two
  tree persons are the same" detector). If not addressed in the PR, → a
  `docs/TODOs.md` entry (§9).
- **`materialize_facts` input shape** — `(personId, recordId, recordRole)` is
  the recommendation (references only, tool reads assertions). An
  `assertionIds[]` variant is possible if a caller ever needs to materialize a
  strict subset of a persona's assertions; deferred until a real need.
- **Synthesized-conclusion facts — DECIDED (additive path).** A
  `proof-conclusion` value that no single record asserts (a calculated/inferred
  conclusion, e.g. three census ages → "abt 1805") materializes via `tree_edit`
  `add_fact` with `primary: true`, carrying **multiple** source-refs to all the
  correlated evidence S-entries (§7.1). `tree_edit` `add_fact` is in
  proof-conclusion's roster (§3). Resolved — no longer open.
