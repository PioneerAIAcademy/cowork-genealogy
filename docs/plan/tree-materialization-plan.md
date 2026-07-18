# Tree Materialization — Implementation Plan

> **Status:** DRAFT for eng review · 2026-07-18 · worktree
> `materialization-ownership-spec` · branch off `main`. Tracks issue
> **#701**.
>
> **Read with:** `docs/specs/tree-materialization-spec.md` (the *what* — this
> plan is the *how*). Also `research-schema-spec.md` §8, `simplified-gedcomx-spec.md`
> §4.2/§4.4, `merge-gedcomx-spec.md`, `match-merge-workflow-spec.md`, and the
> four skill bodies under `packages/engine/plugin/skills/{person-evidence,
> proof-conclusion,conflict-resolution,tree-edit}/`.
> **Reviewers:** Dallan + eng reviewer.
>
> The spec owns behavior and the settled decisions; this plan owns ordering,
> file-level changes, commit boundaries, tests, and risk. No design is
> re-opened here. All five phases land in **one PR** — the phase labels are
> commit boundaries within it, and the `vitest` suite stays green at every
> boundary.

---

## Overview / goal

Materialization is the seam where extracted record evidence should land on
tree persons — and today nothing does it, so tree persons stay name-only
shells while their evidence sits one file away in `research.json`, and the
provenance chain (intact in `research.json`: `assertion.source_id → research
source → S-entry`) is dropped wholesale at the tree (cruz: 0/13 facts, 0/19
names carried a source-ref). This plan builds one new assertion-driven MCP
tool, **`materialize_facts`**, that the LLM feeds *references* (not a
serialized document) so it reads the intact chain from disk and **cannot**
drop it; makes a **non-null source-ref structurally mandatory on every
fact/name/edge a tree-writer newly authors** (delta-scoped — legacy ref-less
nodes carried through a merge are tolerated, never re-authored); reassigns
ownership across the four record→tree
skills; relaxes the "tree = concluded ≥ probable" doctrine to a two-layer
rule; and retires the dead `merge_record_into_tree`.

---

## Inherited design decisions (from the spec — not re-opened)

Honored verbatim; see the cited spec sections for rationale:

1. **`materialize_facts` writes evidence facts/names** onto tree persons;
   input is references only (`personId`, `recordId`, `recordRole`); the tool
   reads the matching assertions itself. **record-extraction narrows to
   assertion-only** — `mcp__genealogy__tree_edit` is dropped from its
   frontmatter and its household-stub/name writes move onto person-evidence, so
   it truly never touches the tree; **person-evidence owns the household
   skeleton** (member stubs via `materialize_facts` create-or-enrich, edges via
   `tree_edit` `add_relationship`). — spec §1.3, §3, §4.
2. **`proof-conclusion` alone sets `primary`/`preferred`** and writes
   `proof_summary`+`proof_tier`. Materialization never sets them. It sets
   `primary` via `tree_correct` `update_fact` when the concluded value matches
   an existing evidence fact, or via `tree_edit` `add_fact` (`primary:true` +
   multi-refs) for a **synthesized** conclusion matching no single record (§7.1)
   — so `tree_edit add_fact` is in its roster. — §4.5, §7, §7.1.
3. **Provenance is structural, delta-scoped:** every fact/name/relationship a
   writer *newly authors* carries a non-null source-ref, enforced at each **add-op**
   writer boundary (`materialize_facts`, `tree_edit` add-ops, and `tree_correct`
   may not *remove* a ref). The **`merge_tree_persons` fold is excluded** — it
   only relocates already-persisted facts, and legacy ref-less trees are
   tolerated (no backfill/heal). The ref auto-resolves `assertion.source_id →
   research source `gedcomx_source_description_id` → tree S-entry id`. The ESM
   **citation string** stays proof-conclusion upload-time work (out of scope). — §6.
4. **Conflicting values coexist** as separate facts; agreeing values union
   refs onto one fact. `materialize_facts` **surfaces** conflicts —
   **only for single-valued / vital types** (`VITAL_PRIMARY_TYPES`); multi-valued
   types (`Occupation`, `Residence`, `Census`, `Citizenship`, the
   `RESIDENCELIKE_FACT_TYPES` family) coexist as separate sourced facts and are
   **not** reported in `conflicts_surfaced`. conflict-resolution writes the
   `conflicts` entries. — §2, §4.4.
5. **Create-or-enrich:** `materialize_facts` mints the person if `personId` is
   absent (from persona name/gender assertions). Idempotent upsert keyed on
   **`factsEquivalent(a,b)` AND equal `value`** — reusing the existing
   `factsEquivalent` (type + date/place-compat) from `merge-gedcomx.ts`, never
   `(fact_type, value)` alone (`value` is null for event facts, so that key
   would collapse every Birth into one fact) — plus ref-set union. — §4.2, §4.3, §4.4.
6. **Doctrine relax:** `research-schema-spec.md` §8 rewritten to a two-layer
   rule (evidence materializes at link time; `primary`+`proof_tier` govern
   conclusion; upload stays conclusion-gated). Spec claims **no** new
   field/enum/tree-shape change — **verified below** (Blast-radius §). — §10.
7. **Tool roster:** `materialize_facts` NEW; `merge_tree_persons` KEEP;
   `merge_record_into_tree` RETIRE (0 live calls) and `add_household_children`
   RETIRE (superseded by create-or-enrich + `add_relationship`) — both sequenced
   **last** (dead-code phase). match-merge-workflow is **rewired** to
   `materialize_facts`; its coherence gate (`merge_warnings`) is kept and its
   **invocation owner moves from proof-conclusion to person-evidence**,
   re-anchored to the pre-materialization household set. — §3, §5, §9.
8. **person-evidence enrichment trigger:** a strong relationship-fit is
   sufficient to match a fact-less stub — a craft fix in the skill prose, not
   a new matching mechanism. — §11.
9. **No-primary-yet fallback:** viewer shows the sole/first fact of a type;
   upload sends only `primary`/proof-backed facts. — §7.

**One correction the plan makes to the spec.** Spec §9 lists
`sanitizeCandidate` / `validateCandidateGedcomx` and the whole **Mode 1
(cross-document)** merge path for deletion while *also* preserving
`merge_warnings`. That is internally inconsistent: `merge_warnings`
(`merge-warnings.ts:64`) calls `mergeGedcomx(tree, candidate, merges)` with a
**non-null candidate** — it independently exercises Mode 1 and both helpers.
Because decision (7) **keeps** `merge_warnings`, **Mode 1 and those two
helpers must stay.** The deletable set in phase 5 shrinks accordingly (see
that phase). This is a finding, not a deviation from the ledger.

---

## Build & verify (commands for the implementing agent)

- MCP unit tests: `make engine-test` (or `cd packages/engine/mcp-server &&
  npm test`; single file: `npx vitest run tests/tools/materialize-facts.test.ts`).
- Package + manifest-drift test: `make mcpb` (runs `tests/packaging/manifest.test.ts`).
- New-tool wiring (CLAUDE.md): schema import + `allToolSchemas` entry in
  `tool-schemas.ts`; dispatch `if`-block in `index.ts`; name in `manifest.json`.
  The drift test enforces the schemas↔manifest pair but **not** the `index.ts`
  dispatch — a missing dispatch block is a runtime `Unknown tool`, so verify
  it with `dev/try-materialize-facts.ts`.
- Skill evals: `DEVELOPMENT.md` §"Running the eval test suite" (`eval/`).

All paths below are relative to the worktree root
`/Users/dallan/pioneeradademy/cowork-genealogy/.claude/worktrees/materialization-ownership-spec`.
MCP source paths omit the `packages/engine/mcp-server/` prefix where
unambiguous.

---

## Phase 1 — the `materialize_facts` tool (greenfield)

**Scope.** Build and wire the workhorse; enforce §4 (per-assertion upsert
keyed on `factsEquivalent` + equal `value`, create-or-enrich, idempotency,
conflict surfacing **gated to `VITAL_PRIMARY_TYPES`**) and §6 (mandatory
non-null ref on newly-authored content) *within the new tool*. Nothing else
changes yet — the old writers stay loose, so the suite stays green.

**Files (new).**
- `src/types/materialize-facts.ts` — `MaterializeFactsInput` (`{ projectPath,
  personId, recordId, recordRole }`, all camelCase per the API-surface
  convention) and `MaterializeFactsResult` (compact summary — see return
  shape below).
- `src/tools/materialize-facts.ts` — exports `materializeFacts(input)` and
  `materializeFactsSchema` (`{ name, description, inputSchema }`). Scaffold
  after `wikipedia.ts` for the *shape*, but copy the **test** scaffold from
  `tests/tools/merge-record-into-tree.test.ts` (wikipedia ships no test).
- `dev/try-materialize-facts.ts` — ~6-line CLI (import fn, read `process.argv`,
  `console.log` JSON) — the manual dispatch check.
- `tests/tools/materialize-facts.test.ts` — see Tests.

**Files (wire — 3 mechanical edits).**
- `src/tool-schemas.ts` — add `import { materializeFactsSchema } from
  './tools/materialize-facts.js'` and add `materializeFactsSchema,` to
  `allToolSchemas` (array at lines ~54-97).
- `src/index.ts` — add the import next to the other tool imports (~7-92) and an
  `if (request.params.name === 'materialize_facts') { … }` dispatch block in
  the flat chain (~105-652).
- `manifest.json` — add `{ "name": "materialize_facts" }` to `tools` (~59-62).

**Concrete internal design.** Reuse the *tail* of `tree_edit`'s
`executeTreeOps` (`tree-edit.ts:701-833`) verbatim in structure — only the
middle "apply" differs:

1. `sanitizeTree(read tree)` + read `research.json` (assertions live here).
2. Select the persona's assertions: all assertions matching `recordId` +
   `recordRole` (schema: `research.schema.json:393-443` — `source_id`,
   `record_id`, `record_role`, `record_persona_id`, `fact_type`, `value`,
   `date`, `place`, `standard_place`).
3. Apply per-assertion (new helpers, below).
4. `validateParsed(research, tree, { projectPath })`.
5. `backupIfExists(treePath)` → `atomicWriteJson(treePath, tree)`.
   **Single-file write** — `materialize_facts` reads `research.json` but
   writes **only** `tree.gedcomx.json`. Use `atomicWriteJson`, **not**
   `atomicWriteBoth` (the latter is only for `research_append`'s composite
   both-files path; using it here would needlessly rewrite `research.json` and
   skip the tree `.bak`).

New helpers (net-new for the assertion→S→ref resolve and the create-or-enrich
mint; the **fact-identity test reuses the existing `factsEquivalent`** from
`merge-gedcomx.ts` — do **not** re-invent a key, and do **not** claim "no
existing code upserts by type": `factsEquivalent` already encodes fact
identity):

- **`resolveSourceRef(assertion, research, tree) → SimplifiedSourceReference`**
  — walk `assertion.source_id → research.sources[].id →
  .gedcomx_source_description_id → tree.sources[].id`; build `{ ref, page?,
  quality? }`. If any hop is missing (esp. no tree S-entry), **throw** — §4.2
  step 2 is "error, never null". The cross-file link this produces is exactly
  what `validateCrossFile` (`validator.ts:1264-1287`) already checks, so no
  new validator rule is needed.
- **`upsertFact(person, {type, value, date, place, standard_place}, ref)`**
  (Cluster A — the fact-identity fix) — a candidate fact is the **same fact**
  (union `ref` into its `sources[]`, dedup on `ref`) **iff
  `factsEquivalent(existing, candidate)` AND `existing.value === candidate.value`**. Reuse `factsEquivalent` (type + `datesCompatible` +
  `placesCompatible`) from `merge-gedcomx.ts` (CLAUDE.md code-reuse rule) — lift
  **only** `factsEquivalent` and its date/place-compat helpers; do **not** reuse
  `mergeFacts` wholesale (it sets `primary` on `VITAL_PRIMARY_TYPES`, violating
  "materialization never sets `primary`"). An **incompatible date/place OR a
  different `value`** → the facts **coexist**: mint `{ id: nextId(tree,'F'),
  type, value, …, sources: [ref] }`. **Never set `primary`.** Honor the
  structured-fact model (#711): an event's `place`/`date` are attributes of the
  event fact, not their own fact types — which is exactly why `(type, value)` is
  the wrong key (`value` is null for Birth/Death/Marriage/Residence, collapsing
  all births into one fact and dropping conflicting dates).
- **`upsertName(person, name, ref)`** — same pattern with `nextId(tree,'N')`;
  **never set `preferred`.**
- **create-or-enrich** — if no `tree.persons[]` entry matches `personId`, mint
  `{ id: personId ?? nextId(tree,'I'), gender, names: [] }` from the persona's
  name/gender assertions, then upsert its facts. A person minted this way
  **cannot** be fact-less (facts are the input) — the structural cure for
  symptoms (1)/(2).
- **conflict detection** — when a coexisting (incompatible-date/place **or**
  different-`value`) fact of a **`VITAL_PRIMARY_TYPES`** type is added while a
  competing value of that type already exists, record `{ personId, factType,
  values }` for the return. **Gate to `VITAL_PRIMARY_TYPES`** (Cluster F):
  multi-valued types (`Occupation`, `Citizenship`, the `RESIDENCELIKE_FACT_TYPES`
  family) coexist as separate sourced facts and are **not** reported in
  `conflicts_surfaced`. Lift `VITAL_PRIMARY_TYPES` (today duplicated in
  `merge-gedcomx.ts` + `merge-shared.ts`) to a shared module so this gate and
  the merge core read one definition.

**Return shape (compact — never echo the JSON):** `{ personId, created:
boolean, factsAdded, factsEnriched, namesAdded, refsAttached, conflicts_surfaced:
[{ personId, factType, values }] }`.

**DoD / exit criteria.**
- Tool builds; `make mcpb` manifest-drift test passes; `dev/try-materialize-facts.ts`
  round-trips a fixture project.
- Every code path that writes a fact/name resolves and attaches a non-null
  ref, or errors; `primary`/`preferred` are never written.
- All unit cases below pass; the GOLDEN invariant holds.

**Tests (`tests/tools/materialize-facts.test.ts`).**
- create-or-enrich mints a person **with** facts (never fact-less).
- enrich an existing (name-only stub) person.
- **idempotency:** re-running the same persona adds no duplicate facts/refs
  (`factsEquivalent` + equal `value` makes the re-run a no-op).
- agreeing value → one fact, refs unioned.
- **conflicting vital → two coexisting facts + one surfaced conflict:** two
  `Birth` assertions with **different dates/places** yield **two** coexisting
  facts (each keeping its ref) **and** `conflicts_surfaced` lists it — proving
  the value is not lost to a `(type, value)` collapse. Use a **vital (`Birth`)**,
  not `Occupation`.
- **multi-valued coexists silently:** two differing `Occupation` (or
  `Residence`) assertions coexist as separate sourced facts and are **NOT** in
  `conflicts_surfaced` (Cluster F gate).
- missing S-entry → throws (not a silent null).
- **GOLDEN:** every fact and name the run **wrote** carries a non-empty
  `sources[]` with a non-null `ref` that points at an existing tree S-entry
  (written-content scope — see Test strategy for the shared helper).

**Risks.** `fact_type→tree-type` mapping edge cases under the #711 structured
model (event place/date as attributes); mis-using `atomicWriteBoth`;
accidentally setting `primary`. All caught by the unit cases above.

---

## Phase 2 — mandatory-ref enforcement on the other writers

**Scope.** Make §6 structural on the **delta** everywhere else: `tree_edit`
add-ops (`add_fact`, `add_person` inline facts, `add_relationship` edges — §8)
reject **newly-authored** ref-less content, and `tree_correct` rejects an op
that **removes** an existing ref. **`merge_tree_persons` is deliberately NOT in
this list** — its Mode-2 fold only relocates already-persisted facts, so a guard
there is vacuous or bricks every merge of a legacy ref-less tree (Cluster B /
§6). `add_household_children` is **not grown** here — it is **retired** in phase
5 (Cluster C). Sequenced **after** phase 1 so `materialize_facts` (the
ref-correct path) is already proven.

**Where the check goes — and where it must NOT go.** The enforcement is a
**delta-scoped, per-tool boundary check on the node being newly authored**, not
a rule added to the shared `validateGedcomx`/`checkTreeFact`, and not a
result-state check on the whole tree. Every persistence tool validates the
**whole project** before any write (`validator.ts:130-218`); existing legacy
trees have ref-less facts (cruz: 0/13) and the sanitizer never back-fills a ref
(`tree-sanitize.ts:138-146`) — and we **deliberately do not** fabricate,
backfill, or heal refs for that legacy content (a fabricated ref is a worse lie
than an honest null). A required-`sources` rule in the validator would fail
validation on every legacy project's *next* write — bricking even a
`research_log` append. Keep schema `sources` **optional** and the validator
tolerant; add a small `assertNodeHasRef(node)` guard at each writer boundary,
firing **only on content that op introduces**.

**Files & concrete changes (`src/tools/tree-edit.ts`, `applyOperation`).**
- `add_fact` (~385-398): reject if the new fact has no non-null `sources[].ref`.
- `update_fact` (~399-416): reject an update that **removes** an existing ref
  (e.g. clearing a populated `sources`). Not "the result has a ref" — touching
  an already-ref-less legacy fact without removing anything is allowed (§6).
- `add_person` inline facts loop (486-496): each inline fact needs a ref.
- `add_relationship` Couple facts (511-526) **and the edge itself**: the
  relationship object carries `sources[]` (`TREE_COUPLE_FIELDS`,
  `tree-shape.ts:25-28`) — require a ref on the **newly-authored** edge,
  resolved from the relationship assertion's `source_id` (the same resolver
  `materialize_facts` uses). May need a ref param if callers don't already pass
  `sources`. Pre-existing legacy edges are tolerated (not re-authored).
- `add_household_children` — **NOT grown to carry refs here.** It is **retired**
  in phase 5 (Cluster C / §9): its name-only-stub role is superseded by
  `materialize_facts` create-or-enrich and its edges by `add_relationship`, so it
  has no remaining caller. Do not add a ref param to a doomed op.
- `tree_correct` (`tree-correct.ts`): inherits `executeTreeOps` via
  `CORRECT_GATE`; its update ops reject an op that **clears an existing ref to
  null** (the delta rule), not one that merely leaves a legacy fact ref-less.
- **`merge_tree_persons` fold — no guard.** The Mode-2 `mergeSameDocument` fold
  is **excluded** from mandatory-ref (Cluster B): it only relocates
  already-persisted facts, so a guard is vacuous or bricks every merge of a
  legacy ref-less tree (98% of the 52 e2e starting trees; cruz 0/13) and would
  reject the §5 merge of cruz's grandparents. Legacy ref-less content folds
  through untouched.

**The ordering hazard (explicit).** Turning on delta-scoped mandatory-ref will
break **existing `tree_edit`/`tree_correct` unit tests and eval fixtures that
legitimately write ref-less facts** through an add-op. **`merge-tree-persons`
tests are NOT affected** — the fold carries no guard (Cluster B), so they keep
their legacy ref-less fixtures. Mitigations, all inside this phase's commit:
- **Update every affected `tree_edit`/`tree_correct` unit test** to supply a
  `sources: [{ ref: "S…" }]` on the facts/names/edges its add-ops write. This is
  the bulk of phase-2 test churn.
- **init-project is already compliant** — it seeds the FamilySearch tree with
  one `S1` source and attaches `{ ref: "S1", quality: 1 }` to *every* fact and
  relationship (`init-project/SKILL.md:139-146`). So init-project — the one
  *pre-existing* skill that seeds ref-carrying tree facts outside person-evidence
  — does **not** need doctrine relief. (proof-conclusion's new additive path
  (§7.1 / Cluster E) also authors tree facts outside person-evidence, but is
  compliant by construction: its `add_fact` carries mandatory multi-refs.) The
  invariant matches existing seeding doctrine.
- **Skill callers of the grown signatures** (person-evidence's
  `add_relationship`) are **prose**, updated in phase 3;
  **record-extraction stops calling `add_household_children` entirely** (Cluster
  C, phase 3 + phase-5 retire). `vitest` does not exercise skills, so the unit
  suite stays green between phase 2 and phase 3 as long as the *tests* are
  updated here. Eval fixtures that drive ref-less writes are updated in phase 3
  (they are not part of `vitest`).
- **Grep all callers** of `add_relationship` before landing, so no writer
  silently starts rejecting.

**DoD / exit criteria.**
- Each **delta-scoped** writer (`tree_edit` add-ops; `tree_correct` no-remove)
  rejects ref-less newly-authored content / a ref-removing op; a matching
  reject-test exists per writer. `merge_tree_persons` is **not** guarded and its
  legacy fold still passes.
- The **golden anti-regression test** (written-content scope; excludes
  `merge-tree-persons.test.ts`) is added and green.
- `tree-shape.ts`, `validator.ts` `CLOSED_ENUMS`/required-lists, and the
  schema JSON are **unchanged** (confirm — the invariant is tool-boundary and
  delta-scoped, not schema).
- Full `vitest` green with updated fixtures.

**Tests.** Extend `tests/tools/tree-edit.test.ts` and `tree-correct.test.ts`
with (a) reject cases (add-op with a ref-less new node; `tree_correct` op that
removes an existing ref) and (b) updated existing cases that now supply refs on
newly-authored content; new test for the `add_relationship` ref param.
**`merge-tree-persons.test.ts` gets NO reject-when-ref-less case** — the fold is
unguarded (Cluster B) — and keeps its legacy ref-less fixtures. No
`add_household_children` ref-param test (the op is retired, not grown).

**Risks.** The `add_relationship` ref-param growth ripples to phase-3 skills and
eval fixtures — a missed caller yields a runtime reject, not a test failure.
Mitigation: the caller grep + the phase-3 skill edits in the same PR. (No
`add_household_children` growth risk — it is retired, not grown.)

---

## Phase 3 — skill rewrites, match-merge rewire, eval updates

**Scope.** Point the four skills at the new ownership; rewire the
match-merge workflow's fold to `materialize_facts` while keeping its coherence
gate; update eval briefs/rubrics/fixtures. Sequenced after the tool + writers
exist so no skill references a tool that isn't wired.

**person-evidence** (`skills/person-evidence/SKILL.md`).
- allowed-tools (19-23): **add `materialize_facts` AND `merge_warnings`**
  (Cluster D — person-evidence now owns the coherence gate) (keep
  `research_append`, `same_person`, `tree_edit`).
- §5 stub doctrine (359-360): flip "`facts` may be omitted — proof-conclusion
  populates them later" → **materialize facts at link time** (create-or-enrich).
  Grep for the same "proof-conclusion populates/adds facts later" phrasing
  elsewhere and fix — leaving it creates cross-skill doctrine drift.
- **person-evidence now owns the household skeleton** (moved off record-extraction,
  Cluster C): mint each member (sibling stubs included) via `materialize_facts`
  create-or-enrich, and write parent-child + spouse-spouse **edges** via
  `tree_edit` `add_relationship`, each edge carrying a source-ref resolved from
  the relationship assertion's `source_id` (§8). Pre-1880 census parent-child
  edges are **indirect** → lower ref quality.
- §7 merge-set flow (431-443, load-bearing 439-440): rewrite the
  `merge_warnings`→`merge_record_into_tree` hand-off into the **per-persona**
  flow: link → `materialize_facts` → relationship edges via `tree_edit`
  `add_relationship`. **Before committing a household's materialization,
  dry-run `merge_warnings` as the coherence gate** on the pre-materialization
  household set, applying the error-block / warning-advisory tiers (Cluster D /
  §9).
- match-strength rubric (283-288; prose 200-207; relationship-fit signal 199):
  soften the **Weak** row (285) so a strong household relationship-fit is a
  **sufficient** stub match, not down-rated for missing vitals (§11).

**proof-conclusion** (`skills/proof-conclusion/SKILL.md` +
`references/validation-protocol.md`).
- allowed-tools (20-27): **remove `merge_record_into_tree`** (25); **keep
  `tree_edit`** for the additive path (Cluster E); keep `tree_correct` (23),
  `merge_tree_persons` (24), `merge_warnings` (26).
- §6 step 2 (133): make it the **two-path** conclusion write (Cluster E / §7.1),
  **not** a pure tool swap: **common case** — the concluded value equals an
  existing evidence fact → set `primary` via `tree_correct` `update_fact` (no
  add); **synthesized case** — an indirect conclusion whose correlated value
  matches **no single record** (e.g. three census ages → "abt 1805") → `tree_edit`
  `add_fact` with `primary: true` carrying **multiple source-refs** to all the
  correlated evidence S-entries. Add an **indirect-evidence** note: extraction
  already classifies it (`evidence_type: indirect`, `date_certainty: calculated`,
  #711); value-bearing indirect evidence materializes with the inference encoded
  honestly (GEDCOM `abt`/`cal`/`est`, not a bare year) at lower ref quality;
  indirect evidence **never self-concludes** (only proof-conclusion correlation
  sets `primary`); purely-argumentative / negative evidence does **not**
  materialize as a fact — only its conclusion (e.g. death "bef 1870") does, via
  this additive write.
- §6 step 3 (134-136): add an explicit **conclusion-gated upload** rule (send
  only `primary`/proof-backed facts) around the existing citation-copy prose.
- §6 merging sentence (138): drop the `merge_record_into_tree` branch.
- `references/validation-protocol.md:3-4`: remove `merge_record_into_tree`.
- frontmatter/description (4-8): reword the old "updates tree at probable or
  higher" doctrine (aligns with phase 4).

**conflict-resolution** (`skills/conflict-resolution/SKILL.md`).
- §1 intake (76-112): add **materialization-surfaced coexisting-tree-fact
  conflicts** as a new input source (fed by `materialize_facts`'
  `conflicts_surfaced` — **vital types only**, per the Cluster F gate; multi-valued
  facts coexist without surfacing). **No allowed-tools change** (still writes
  only `conflicts` via `research_append`).

**tree-edit** (`skills/tree-edit/SKILL.md` +
`references/evidence-grounded-edits.md` + `references/relationship-accuracy.md`).
- Relax the "proof ≥ probable gates a tree edit" doctrine **for evidence
  facts** (they materialize at link time) while **keeping** it for
  conclusion/upload. `evidence-grounded-edits.md:13` and
  `relationship-accuracy.md` are the source-of-truth prose the rubric mirrors.

**record-extractor** (`agents/record-extractor.md`) — **EDITED to assertion-only**
(Cluster C / spec §1.3, §3). **Drop `mcp__genealogy__tree_edit` from its
frontmatter `tools:`** (line 25), remove the **Step-5 `add_household_children`
call** (~615-652) and the **`add_name` call** (~652), and **reword the
`description` frontmatter** (lines 3-16) to strike the "sibling person stubs when
the subject is a child on a household record" clause so the auto-delegation
trigger reflects assertion-only extraction — it emits **assertions only**,
including relationship-type assertions (parent-child, spouse). Do **not**
add `materialize_facts` to it. The household stubs + edges it used to write now
belong to person-evidence (above); the `add_household_children` op itself retires
in phase 5.

**Match-merge rewire (decided; the edit is this phase).**
- `docs/specs/match-merge-workflow-spec.md`: rewire the "fold" step from
  `merge_record_into_tree` to the per-persona `materialize_facts` flow; move the
  coherence gate's **invocation owner from proof-conclusion to person-evidence**
  (Cluster D) and **re-anchor** `merge_warnings` (with `hasSameCensus` etc.) to
  run *before* person-evidence commits a household's materialization (it currently
  gates a fold that will no longer exist).
- `tests/integration/match-merge-workflow.test.ts`: rewire the chain
  (imports/calls at ~13-14, 149, 155) — **preserve** the coherence-gate
  assertions (`hasEventsOutsideLifespanFar` ~200, `hasSameCensus` ~223), which
  are the workflow's genuine, fold-orthogonal contribution.
- `eval/tests/e2e/census-household-merge/README.md:23`: rewire documented
  step 3 ("folds the census in with `merge_record_into_tree`") to the
  materialize flow.

**Eval briefs/rubrics/fixtures** (pull in opposite directions — nuanced, not a
blanket edit):
- `eval/tests/unit/person-evidence/rubric.md:33` + fixture
  `stub-creation-new-son.json`: stubs are now created **with** facts via
  `materialize_facts` (and their edges via `add_relationship`), not name-only —
  and person-evidence, not record-extraction, owns them.
- **record-extractor fixtures/rubric** (Cluster C): any fixture asserting
  extraction writes household stubs / names / edges is updated so extraction is
  **assertion-only**; the stub/edge assertions move to the person-evidence
  fixtures.
- `eval/tests/unit/tree-edit/rubric.md` (Evidence-grounding §43-58, esp. 47)
  and `eval/briefs/tree-edit.md` (10, 22) + `eval/briefs/shorten-tree-edit.md:113`:
  relax the proof≥probable gate for **evidence** facts; keep it for
  conclusion/upload.
- `eval/tests/unit/proof-conclusion/rubric.md:41`: narrow to `primary` +
  proof-summary + upload-gating; cover the **additive synthesized-conclusion**
  path (`tree_edit add_fact`, multi-ref — Cluster E).
- Keep **both** eval genres current per project convention (deep-dive brief
  `<skill>.md` **and** `shorten-<skill>.md`).

**DoD / exit criteria.**
- Skills call `materialize_facts`; no skill/reference names
  `merge_record_into_tree` except where phase 5 will finish removal.
- Integration test rewired and green with coherence assertions intact.
- Eval fixtures/rubrics updated; both brief genres reflect the new doctrine.

**Risks.** Cross-skill doctrine drift (grep for stale "proof-conclusion fills
facts later"); opposite-pulling rubric edits (person-evidence wants facts on
stubs; tree-edit relaxes the proof-gate only for evidence). (The
**`merge_warnings` ownership question** is now **decided** — person-evidence
gains it in allowed-tools and owns the dry-run gate, Cluster D — no longer a
risk.)

---

## Phase 4 — doctrine edit (schema-spec prose)

**Scope.** Rewrite the "tree = concluded ≥ probable" doctrine to the two-layer
rule. **Prose only — no schema-shape edit** (verified in Blast-radius).

**Files & changes.**
- `docs/specs/research-schema-spec.md` §8 "tree.gedcomx.json update timing"
  (657-664): from *"tree updated only at proof ≥ probable"* → *"evidence facts
  materialize at identity-link time with provenance; `primary`/`preferred` +
  `proof_tier` govern conclusion; upload is conclusion-gated."* Fix the worked
  example that ties a tree fact to a `probable` proof summary.
- `docs/specs/simplified-gedcomx-spec.md` §2/§4.3: reword the "updated when a
  proof summary reaches `probable`" note. The "omit `citation` during research"
  note **stays correct** — do not touch it (that would re-introduce the §1.2
  mis-framing).
- `docs/specs/research-append-tool-spec.md`: confirm the composite
  `sourceDescription` still owns S-entry creation (it does — no contract
  change), and cross-reference `materialize_facts` as the fact writer.

**DoD.** §8 states the two-layer rule; no field/enum/tree-shape edit is made;
`packages/schema/` confirmed unchanged (Blast-radius).

**Risks.** Prose getting ahead of code — sequenced after phases 1-3 so the
doctrine matches shipped behavior.

---

## Phase 5 — dead-code removal (`merge_record_into_tree`) — LAST

**Scope.** Remove the two retired artifacts — `merge_record_into_tree` **and**
`add_household_children` (Cluster C / §9) — behind a grep-clean verification
gate, only after the new path is proven. **Corrected deletable set** (see the
§Inherited correction): because `merge_warnings` is preserved and independently
exercises Mode 1 + `sanitizeCandidate`/`validateCandidateGedcomx`, **do NOT
delete Mode 1 or those helpers.** Retiring `merge_record_into_tree` frees
**zero** `merge-shared.ts` symbols and **zero** `merge-gedcomx.ts` functions.

**Delete (whole artifacts).**
- `src/tools/merge-record-into-tree.ts` (function `mergeRecordIntoTree`,
  interface `MergeRecordIntoTreeInput`, `mergeRecordIntoTreeSchema`).
- `tests/tools/merge-record-into-tree.test.ts`.

**Remove wiring (4 sites).**
- `src/index.ts`: import (66-68) and dispatch `if`-block (563-572).
- `src/tool-schemas.ts`: import (44) and `allToolSchemas` entry (88).
- `manifest.json`: `{ "name": "merge_record_into_tree" }` (61).

**Reword prose.**
- `src/tools/tree-edit.ts:846`: the tool-description mention of
  `merge_record_into_tree`.
- `src/tools/merge-shared.ts:1-6`: the stale "the two merge tools" header
  (already inaccurate — `merge_warnings` is a third consumer; after retirement,
  the survivors are `merge_tree_persons` + `merge_warnings`).
- `docs/specs/merge-gedcomx-spec.md`: add a Mode-1 note — Mode 1 is now
  reachable **only** via `merge_warnings`; `merge_record_into_tree` retired.
- Skill/reference prose was already removed in phase 3.

**Retire `add_household_children` (Cluster C / §9 — recommend retire).**
- `src/tools/tree-edit.ts`: remove the `add_household_children` op handler,
  helpers, and its schema/checklist copy (~549-652). Its name-only-stub role is
  superseded by `materialize_facts` create-or-enrich (stubs now arrive *with*
  facts) and its edges by `add_relationship`. **Scope note (reshape-vs-retire):**
  the op *could* be reshaped to write refs, but with both of its jobs already
  owned by other tools it has no remaining caller — **recommend retire**, not
  reshape.
- `tests/tools/tree-edit.test.ts`: remove the `add_household_children` cases and
  any fixture asserting extraction writes stubs/names.
- `docs/specs/tree-edit-tool-spec.md`: remove `add_household_children` from its
  op table, admitted-ops list, ops checklist, result-shape fields, and §4.4
  behavioral section (op retired, not reshaped — the `§5d` ownership row is
  deleted).
- `agents/record-extractor.md` frontmatter + Step-5 edits were already made in
  phase 3 (drop `tree_edit`; remove the `add_household_children`/`add_name`
  calls); confirm no surviving caller here.

**Explicitly KEEP (verify still imported).** `merge_tree_persons`,
`merge_warnings`, the whole `merge-shared.ts` core (`sanitizeCandidate`,
`validateCandidateGedcomx`, `derivePairSummaries`, `personMapByIds`,
`remapResearchPersonIds`, `readProjectJson`, `formatIssues`, `backupIfExists`,
`MergeInputError`, `MergeResult`), and **both** modes of `merge-gedcomx.ts`
(Mode 1 via `merge_warnings`, Mode 2 via `merge_tree_persons`).
`tests/utils/merge-gedcomx.test.ts` (incl. its Mode-1 blocks) stays.

**Verification gate.** `grep -rn 'merge_record_into_tree\|mergeRecordIntoTree\|add_household_children'`
returns nothing unintended; full `vitest` green; manifest-drift test green.

**DoD.** Grep-clean for **both** `merge_record_into_tree` and
`add_household_children`; suite + drift test green; Mode 1 still compiles and is
reached by `merge_warnings`.

**Risks.** The central gotcha — accidentally deleting Mode 1 or the two Mode-1
helpers breaks `merge_warnings`'s build. Mitigation: the corrected, minimal
deletable set above; do the grep gate before declaring done.

---

## Blast-radius / affected-sites checklist

Cross-checked against the CLAUDE.md schema-change site lists — the spec's "no
schema change" claim is **verified**, not assumed:

| Site | Change? | Note |
|---|---|---|
| `docs/specs/schemas/research.schema.json` | **No** | No new field/enum (references-only tool input; `sources[]`/`primary`/`preferred` already exist). |
| `packages/schema/schemas/research.schema.json` + `enums.schema.json` | **No** | Mirror unchanged — no enum/field. |
| `research-schema-spec.md` prose | **Yes (phase 4)** | §8 doctrine rewrite + worked example only. |
| `validator.ts` (`CLOSED_ENUMS`, required-lists, `validateGedcomx`) | **No** | Mandatory-ref is a **delta-scoped tool-boundary** guard (fires only on newly-authored content), not a validator rule — a whole-tree result-state rule would brick legacy ref-less projects on next write and would brick the `merge_tree_persons` fold (`validator.ts:130-218`; sanitizer never back-fills, `tree-sanitize.ts:138-146`; we do not fabricate/backfill legacy refs). |
| `merge_tree_persons` mandatory-ref guard | **No** | Cluster B: the Mode-2 fold is deliberately **unguarded** — legacy ref-less trees tolerated; excluded from the golden writer list. |
| `VITAL_PRIMARY_TYPES` shared module | **Yes (phase 1)** | Cluster F: lift the set (duplicated in `merge-gedcomx.ts` + `merge-shared.ts`) to a shared module; the conflict-surfacing gate reads it. |
| `packages/schema/src/index.ts` (TS types) | **No** | `GedcomxFact.primary?`/`preferred?` already optional; `getPrimaryFact` already does primary-or-first-of-type fallback. |
| `tree-shape.ts` allow-lists | **No** | `sources` already in `TREE_FACT_FIELDS`/`TREE_NAME_FIELDS`/rel field sets; `TREE_SOURCE_REF_FIELDS={ref,page,quality}`. No cardinality/uniqueness constraint exists → multi-fact-per-type + multi-ref-per-fact already legal. |
| viewer-ui (N-facts-per-type, no-primary) | **Confirm / optional** | `PersonCard.tsx:13-14` already uses `getPrimaryFact` (primary-or-first fallback) and shows a fact count — **tolerates** no-primary + multiple facts. §7's "show coexisting non-primary facts as **un-ranked evidence / surface the conflict**" is **not** implemented (it silently shows one). Optional viewer craft → TODO, not a blocker. |
| `gedcomx-convert.ts` (full-GedcomX upload conversion) | **No / confirm** | `simplifyFact`/`expandFact` (262-303, 525-543), `simplifyName`/`expandName` (185-220, 489-523), `simplifySourceRef`/`expandSourceRef` (362, 587) faithfully round-trip `sources[]`, `primary`, `preferred` in both directions — no per-type collapsing. Upload **gating** (send only primary/proof-backed) is proof-conclusion skill logic, not a convert change. |
| eval fixtures/rubrics/briefs | **Yes (phase 3)** | person-evidence rubric + `stub-creation-new-son.json`; tree-edit rubric/brief/shorten + `evidence-grounded-edits.md`; proof-conclusion rubric; both brief genres. |
| `manifest.json` / `tool-schemas.ts` / `index.ts` dispatch | **Yes (phase 1 add, phase 5 remove)** | Drift test guards schemas↔manifest, **not** the `index.ts` dispatch — verify dispatch manually. |
| `docs/specs/match-merge-workflow-spec.md` + integration test + e2e README | **Yes (phase 3)** | Rewire fold → `materialize_facts`; coherence-gate invocation owner → person-evidence (Cluster D); preserve coherence assertions. |
| `agents/record-extractor.md` | **Yes (phase 3)** | Cluster C: drop `mcp__genealogy__tree_edit` from frontmatter; remove Step-5 `add_household_children`/`add_name` calls; reword `description` to strike the "sibling person stubs" clause — assertion-only. |
| `add_household_children` op (`tree-edit.ts` + `tree-edit.test.ts` + `docs/specs/tree-edit-tool-spec.md`) | **Yes (phase 5)** | Cluster C: retired — superseded by `materialize_facts` create-or-enrich + `add_relationship`; remove from the tool spec's op table/checklist/§4.4. |
| person-evidence + proof-conclusion allowed-tools | **Yes (phase 3)** | Cluster D: add `merge_warnings` to person-evidence; Cluster E: add `tree_edit` to proof-conclusion (additive path). |
| `docs/TODOs.md` | **Yes** | Any deferral (duplicate-node trigger; viewer un-ranked rendering; `merge_warnings` re-anchoring if left to follow-up) gets an entry in this PR (project convention). |

---

## Test strategy

**GOLDEN anti-regression test (the cruz assertion).** A shared helper
`assertWrittenNodesHaveRefs(tree, writtenNodeIds)` that walks the nodes a writer
**authored in that call** and asserts each carries a non-empty `sources[]` with a
**non-null `ref`** pointing at an existing `tree.sources[].id`. Scope per writer:
`materialize_facts` covers **facts + names** (the record→tree path where the cruz
names leaked); `tree_edit` covers **facts + edges** (its ad-hoc `add_name` /
`add_person` names are a reasoned exemption — §6). It is **scoped to written
content**, **not** "every node in the whole tree" — a whole-tree assertion would
fail on tolerated legacy ref-less nodes (Cluster B). Assert the count of ref-less
**written** nodes is **0** (inverting the cruz "0/13 facts, 0/19 names carried a
ref" leak — the names half closed on the record path by `materialize_facts`).
Used by:
- `materialize-facts.test.ts` — after a create-or-enrich run (phase 1, the
  primary end-to-end assertion).
- `tree-edit.test.ts` / `tree-correct.test.ts` — after each add-op / update
  happy path (phase 2), so the leak cannot reappear through a writer.
- **NOT `merge-tree-persons.test.ts`** — the Mode-2 fold authors nothing new; it
  is excluded from the golden writer list (Cluster B).

**Unit.** Per phase 1/2 DoD: create-or-enrich, idempotency (`factsEquivalent` +
equal `value`), ref-union, conflict-surface (**vital-only**, Cluster F),
missing-S error, never-primary; reject-ref-less on the **delta-scoped** writers
(`tree_edit` add-ops, `tree_correct` no-remove — **not** `merge_tree_persons`);
`add_relationship` ref-param test.

**Integration.** `match-merge-workflow.test.ts` rewired to the per-persona
flow; coherence assertions (`hasSameCensus`, `hasEventsOutsideLifespanFar`)
preserved.

**Packaging.** `tests/packaging/manifest.test.ts` green after the phase-1 add
and the phase-5 remove.

**Eval.** Updated rubrics/fixtures (phase 3) run clean; both brief genres
current. An `init-project` regression check that seeded FS facts still validate
under the new mandatory-ref writers (they already carry `S1`).

---

## Risks + mitigations

- **`merge_warnings` / Mode-1 coupling (central).** Spec §9's deletion list is
  wrong given `merge_warnings` is kept. *Mitigation:* corrected minimal
  deletable set in phase 5; keep Mode 1 + `sanitizeCandidate`/
  `validateCandidateGedcomx`; grep gate before done.
- **Phase-2 mandatory-ref breaks existing ref-less add-op writers/tests.**
  *Mitigation:* the check is a **delta-scoped** per-node boundary guard (not a
  validator rule and not on the `merge_tree_persons` fold, so legacy projects
  don't brick); update all affected `tree_edit`/`tree_correct` unit tests in the
  same commit; init-project already sources every fact; grep all callers of the
  grown `add_relationship` signature.
- **`add_relationship` signature growth ripples to skills + eval fixtures.** A
  missed caller is a runtime reject, not a test fail. *Mitigation:* caller grep +
  phase-3 skill edits in the same PR. (`add_household_children` is retired, not
  grown — no growth ripple; its callers are removed in phase 3/5.)
- **fact_type → tree-type mapping under #711 structured facts.**
  *Mitigation:* explicit mapping tests (event place/date as attributes).
- **Cross-skill doctrine drift** (stale "proof-conclusion fills facts later").
  *Mitigation:* grep + fix in phase 3.
- **`match-merge-workflow` coherence gate silently stops matching the write
  path.** It depends on `merge_record_into_tree` only by a **spec invariant**
  (identical `mergeGedcomx` shape), not an import; if the write path moves and
  the gate isn't re-anchored, the dry-run diverges from what's persisted.
  *Mitigation:* re-anchor `merge_warnings` to pre-materialization in phase 3;
  preserve the coherence assertions in the integration test.

---

## Open questions

> **Resolved by the hardening (no longer open).** (a) **`merge_warnings`
> ownership / re-anchoring** — DECIDED (Cluster D / §9): person-evidence gains
> `merge_warnings` in allowed-tools and runs it as a **dry-run coherence gate on
> the pre-materialization household set** before committing; the invocation owner
> moves from proof-conclusion to person-evidence. Wired in **this PR** (phase 3),
> **not** deferred to `docs/TODOs.md`. (b) **Synthesized-conclusion facts** —
> DECIDED (Cluster E / §7.1, §13): a `proof-conclusion` value matching no single
> record materializes via `tree_edit` `add_fact` with `primary: true` +
> **multiple** source-refs to all correlated evidence S-entries; `tree_edit` is
> in proof-conclusion's roster. Indirect / purely-argumentative / negative
> evidence is handled per §7.1 (encode the inference honestly; only the
> conclusion sets `primary`).

1. **Duplicate-node trigger for `merge_tree_persons`** (spec §13). This PR
   makes the tool's *inputs* clean but does not wire the "these two tree
   persons are the same" detector. If not built here → `docs/TODOs.md`.
2. **Initial-subject provenance on non-FS projects.** The FS `init-project`
   path sources the seed to `S1`; confirm the PID-less path (research-doc /
   author-e2e) also seeds a source so its subject facts satisfy the phase-2
   **delta-scoped** mandatory-ref guard.
3. **Viewer un-ranked-evidence rendering** (spec §7). Build the "surface
   coexisting non-primary facts as un-ranked evidence" view now, or defer to a
   `docs/TODOs.md` entry (the helper-level no-primary fallback already works)?
