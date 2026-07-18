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
2. **Fact-less sibling stubs are never enriched.** `add_household_children`
   (record-extraction §5d) mints name-only stubs; a later record carrying
   facts about that sibling never lands them.
3. **The §5d trigger can't fire on a family's first record** — it needs the
   parents already in the tree. (This symptom **dissolves** under §4:
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
| **record-extraction** *(unchanged)* | Extract classified assertions onto `record_id`+`record_role` (personas); create the per-record S-entry. **Never touches the tree.** | `research_append` (assertions + composite `sourceDescription`), `research_log_append` |
| **person-evidence** *(grows — the fix)* | Decide identity (link persona→person, or mint a new person); **write the linked persona's assertions as sourced facts/names onto the tree person** via `materialize_facts`. Match later personas to fact-less stubs to enrich them. **Never sets `primary`/`preferred`.** | **`materialize_facts`** (new), `research_append` (`pe_` links), `same_person`; `tree_edit` `add_household_children`/`add_relationship` for household skeleton + edges |
| **conflict-resolution** *(unchanged role, now fed by materialization)* | Resolve the coexisting-conflict facts materialization surfaces; write `conflicts`. | `research_append` (conflicts) |
| **proof-conclusion** *(narrows)* | Weigh already-materialized evidence, set **`primary`/`preferred`** on the concluded value, write `proof_summary`+`proof_tier`; at upload copy ESM citations onto S-entries and gate upload to concluded facts; collapse duplicate tree persons. | `tree_correct` (`update_fact` → set `primary`), `research_append` (`proof_summaries`), `merge_tree_persons`, `merge_warnings` |

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
3. **Upsert onto the person:**
   - fact of `(type, value)` already present → **union** the new ref into its
     `sources[]` (ref-set dedup). Corroboration accumulates as refs.
   - `(type, new value)` → **add** a new fact carrying the ref. A competing
     value is *surfaced* (see §4.4), not overwritten.
   - **`primary` is never set here.** Names get the same treatment;
     `preferred` is never set here.

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
  common) duplicates neither facts nor refs — upsert by `(type, value)` +
  ref-set union. Mirrors the `add_household_children` idempotent-skip
  ratified as correct in `#711`.
- **Conflicts surfaced, not resolved.** When a competing value is added, the
  return lists it (`conflicts_surfaced: [{ personId, factType, values }]`).
  `materialize_facts` **does not** write `conflicts` entries — that stays
  `conflict-resolution`'s job. The tool reports; the skill routes.

### 4.5 What it never does

Never sets `primary`/`preferred`; never resolves conflicts; never collapses
or merges persons; never writes relationships (those are `tree_edit`
`add_relationship`/`add_household_children`, see §8).

---

## 5. Tool roster

| Tool | Role | Status |
|---|---|---|
| **`materialize_facts`** | Assertion-driven: create-or-enrich a person with **sourced** facts/names; auto-carries refs; mandatory non-null ref; never sets `primary`. | **NEW — the record→tree workhorse** |
| **`merge_tree_persons`** | Collapse two duplicate **tree nodes**; union their already-refed facts. | **Keep** (needs a trigger — e.g. cruz's unmerged grandparents — but the tool is right) |
| **`merge_record_into_tree`** | Fold a candidate GedcomX *document*. | **Retire** (§9) — 0 live calls; its hand-assembled-candidate input is the re-serialize anti-pattern that dropped cruz's refs; its niche does not occur in the assertion pipeline |
| `tree_edit` / `tree_correct` | Structure (`add_person`, `add_household_children`, `add_relationship`) / corrections + `primary`. | Keep; **refs mandatory** on names & edges too (§6, §8) |

---

## 6. Provenance: structural, not disciplinary

**Every fact, name, and relationship written to the tree carries a non-null
source-ref, enforced at every writer tool's boundary** (`materialize_facts`,
`tree_edit` add-ops, `tree_correct`, and the merge tools' fold path). A
write that would leave a fact/name/relationship ref-less is **rejected**.

Consequences:

- The cruz leak (100% of facts ref-less) becomes **unrepresentable**.
- **Provenance-nulling-as-error-recovery** (closing report §3.4) becomes
  unrepresentable — there is nothing nullable to escape validation through.
- A candidate node folded by a merge tool must likewise carry refs, so the
  leak cannot reappear through the merge path.

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

---

## 8. Relationships carry refs

A census (etc.) establishes parent-child and spousal edges — evidence from
that record. Relationship edges written to the tree
(`tree_edit` `add_relationship`, `add_household_children`) **carry a non-null
source-ref** under the same §6 rule, or relationships become the next
provenance leak. `materialize_facts` writes facts/names only; relationship
provenance rides the relationship-writing op.

---

## 9. Retiring `merge_record_into_tree` (dead-code removal phase)

`merge_record_into_tree` is superseded by `materialize_facts` and is dead
(0 live calls; re-serialize input model). It is removed in a **dedicated,
verified phase inside the implementing PR** — not deferred. Scope:

**Remove:**
- `packages/engine/mcp-server/src/tools/merge-record-into-tree.ts`
- Its **Mode 1 (cross-document)** path in
  `packages/engine/mcp-server/src/utils/merge-gedcomx.ts` — **keep Mode 2**
  (same-document), which `merge_tree_persons` uses.
- Its schema entry in `src/tool-schemas.ts`, dispatch in `src/index.ts`, and
  entry in `manifest.json` (the manifest-drift test enforces sync).
- `tests/tools/merge-record-into-tree.test.ts`.
- Mode-1-only helpers in `src/tools/merge-shared.ts` (e.g.
  `sanitizeCandidate`, `validateCandidateGedcomx`, `derivePairSummaries`) —
  **only** those not also used by `merge_tree_persons`; verify each before
  deleting.
- `merge_record_into_tree` prose in `person-evidence/SKILL.md` §7,
  `proof-conclusion/SKILL.md` (+ `references/validation-protocol.md`), and
  `tree-edit/SKILL.md` (+ `references/relationship-accuracy.md`) — replaced by
  the `materialize_facts` flow (§3).

**Preserve (verify still live):** `merge_tree_persons`, `merge_warnings`
(pre-merge coherence for `merge_tree_persons`), the shared `merge-shared.ts`
core used by `merge_tree_persons`.

**Rewire, do not supersede (decided):**
`docs/specs/match-merge-workflow-spec.md` and
`tests/integration/match-merge-workflow.test.ts` reference
`merge_record_into_tree` for their "fold" step. That workflow is **rewired
to `materialize_facts`**, not superseded — its genuine contribution, the
**coherence gate** (`merge_warnings` / the `hasSameCensus` MobWarnings port),
is orthogonal to the fold and worth keeping. Under the rewire the monolithic
household "fold" **dissolves** into the per-persona flow (link →
`materialize_facts` → relationship edges, §3–§4), and the coherence gate
**re-anchors** to run *before* person-evidence commits a household's
materialization — it currently gates a `merge_record_into_tree` fold that no
longer exists. The actual edit to `match-merge-workflow-spec.md` is a
follow-up within the implementing PR (§12 phase 3, alongside the skill
rewrites); this spec records the decision, not the rewrite.

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
   `dev/try-*`, unit tests. Enforces §4 + §6 (mandatory ref, create-or-enrich,
   idempotency, conflict surfacing). Follows the standard four-file scaffold.
2. **Mandatory-ref enforcement on the other writers** — `tree_edit` add-ops,
   `add_household_children`/`add_relationship` (§8), `tree_correct`, and the
   `merge_tree_persons` fold path reject ref-less facts/names/relationships.
3. **Skill rewrites** — person-evidence (call `materialize_facts` on link;
   §11 stub-match craft), proof-conclusion (narrow to `primary` + proof
   summary + upload citation/gating), conflict-resolution (consume surfaced
   conflicts). Update eval briefs/rubrics.
4. **Doctrine edit** — `research-schema-spec.md` §8 + the sites in §10.
5. **Dead-code removal** — §9, behind its verification gate. **Last**, so the
   new path is proven before the old one is deleted.

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
- **Synthesized-conclusion facts** — a `proof-conclusion` value that no single
  record asserts (a calculated/inferred conclusion) still needs a fact + a
  ref; it references the supporting assertions/proof. Confirm proof-conclusion
  can write such a fact with a valid ref under §6.
