# Tree Materialization — Ownership Spec

> **Status:** Shipped 2026-07-18 (batching extended in a later PR).
> Owns the ownership decision it was written to settle:
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
> the closing report §3.4 (`docs/record-extraction-consolidation-closing-report.md`),
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
  one source's classified claim about one persona (`record_basis`,
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
| **extraction** — `extraction_append` *(assertion-only; replaced the record-extraction skill and record-extractor agent, since retired)* | Extract classified assertions onto `record_id`+`record_role` (personas), **including relationship-type assertions** (parent-child, spouse), with roles and classifications decided in code; create the per-record S-entry. FamilySearch records come in as `recordIds`; any other source is structured by the record-structurer agent and sent as `documents`. **Writes only the source S-entry** (through `researchAppend`'s composite `sourceDescription`); it writes no persons, facts, names, or relationships. | `extraction_append` (sources + assertions + composite `sourceDescription`; logs its own `record_read` entry per record) |
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
  -> compact summary                        // persona form

materialize_facts({ projectPath, assertionId, relatedRole,
                    name: { given, surname }, gender?, nameType?, personId? })
  -> compact summary                        // named-party form (§4.6)

materialize_facts({ projectPath, ops: [ <either form>, ... ] })
  -> { results: [compact summary, ...] }   // batch form, arms may be mixed
```

- **Two arms, one guarantee.** The persona form takes references; the
  named-party form (§4.6) takes one piece of caller-supplied data, a name,
  because the party it mints has no persona to reference. What is structural in
  both is the **source-ref**, which the tool resolves itself and refuses to
  write without — not the input shape. An op supplying both forms is rejected
  as ambiguous rather than merged.
- In the persona form, the caller passes **references**, not data. The tool reads the persona's
  assertions (all assertions matching `recordId`+`recordRole`) from
  `research.json`, resolves each one's provenance, and writes to
  `tree.gedcomx.json`. (`personId` may be an id that does not yet exist —
  see create-or-enrich.)
- Reads the tree fresh from disk, validates the would-be project through
  `validateIntroduced` (which wraps `validateParsed`) so it blocks only on a
  **call-introduced** error while pre-existing drift rides as a warning (the authority `match-merge-workflow-spec.md` cites here), writes atomically
  with a backup, and returns a **compact** summary (person id, facts
  added/enriched, refs attached, conflicts surfaced) — never an echo of the
  written JSON.
- **Batch form.** Pass `ops: [{ personId?, recordId, recordRole }, ...]`
  instead of the top-level fields to materialize several personas — a
  household's members, typically — in one validate-once/write-once call:
  one `sanitizeTree` + `research.json` read, every op applied to the same
  in-memory tree (an id an earlier op mints is visible to later ops, since
  the allocator rescans the live document), one `validateParsed`, one
  atomic write. All-or-nothing: any op's failure writes nothing, identified
  as `ops[i]: <msg>`. Mirrors the `ops[]` convention `research_append` and
  `tree_edit` already have — added 2026-07-26 after per-persona calls were
  measured as a driver of e2e wall-clock regressions on fixtures
  materializing many personas per research question. Simpler than
  `tree_edit`'s batching: since `materialize_facts` never writes
  relationships (§4.5), ops in a batch have no cross-op *data* dependency —
  only the shared mutable tree + id-allocator state.

### 4.2 Behavior, per assertion

1. **Map** `fact_type` → tree fact type, honoring the structured-fact model
   (the structured-fact model): an event's `place`/`date` are attributes of the event fact, not
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
*input*, a person created **from a persona** this way **cannot** be fact-less —
which is the structural cure for symptoms (1) and (2).

The named-party arm (§4.6) does not reopen symptom (1) either, and it takes two
routes to avoid it. A name-only shell is a defect when the record *had* facts
for that person and they were dropped. Where the record names her inside someone
else's assertion and states nothing else about her, a name plus its resolved ref
is the whole of what the evidence supports, so that is what is written. Where the
record DOES give her a persona but never names it, §4.6 mints her name and then
writes that persona's facts through the persona arm in the same op, so her facts
are not dropped by the one route that will take her. §4.6 backs that with a check rather than an assumption: it refuses
when the named role has a persona the persona arm could mint instead, which is
the case in which facts exist and would be dropped. The check is a steer and
not a proof, for the reasons given there. The event that *does* concern her — the marriage — stays on the
Couple edge per §4.5, rather than being invented onto her as a person-level
fact. She is a sourced name because that is all there is, not because
something was lost.

**Enriching an existing person needs a link.** When `personId` names a person
already in the tree, both arms refuse unless a live `probable` or `confident`
`person_evidence` entry links that person through an assertion that is about
them. A `speculative` link is a candidate, not an identity, so it does not
qualify.

- **Persona arm (`personaTargetRefusal`):** one of the persona's own one-party
  assertions (`record_id` + `record_role`). An assertion that names a second
  person does not count: a `marriage`, `relationship`, `parentage` or
  `parentchild` assertion, a couple event in any spelling (`marriage_bann`,
  `marriage_intention`, `marriage_date`, a divorce), or a fact about another
  person filed on this persona (a father, mother, parents, spouse, couple,
  filiation or informant, or a parent's birthplace). The person-evidence agent
  links such an assertion to that person too, so its link says nothing about
  which of them this persona is: counting it let the groom's name and birth be
  copied onto the bride. The agent also links a one-party assertion to every
  person it bears on, so the wife's own name can be linked to her husband. When
  another persona of the record holds the target through one of its own
  one-party assertions linked to them alone, the target is that persona, and
  only an assertion of this persona's linked to them alone counts. A persona
  whose assertions write nothing onto a person is not checked.
- **Named-party arm (`namedPartyTargetRefusal`, §4.6):** judged on the tree as it
  stood before the op, because the op's own name write attaches this record's
  ref, after which a person the run added, not shaped like a FamilySearch id,
  whose refs reach no other record reads as the record's stub. In order:
  1. A target that one of the own persona's one-party assertions is linked to
     is that persona, never the party the assertion names, so it is refused.
     That persona is read at its strongest level: a `speculative` link marks a
     candidate only while no `probable` or `confident` one names someone, so a
     same-named father stays writable when the groom's name is probable to the
     son.
  2. A target whose resolved `Male` or `Female` contradicts the `gender` the op
     passes is refused.
  3. Otherwise the link rule above, through the naming assertion or one of the
     related role's own one-party assertions on the record. Once those own
     assertions carry a `probable` or `confident` link to anyone, only they
     qualify: they say who she is, and the naming assertion's link may be about
     either party.

- **Under a recorded namesake** (`research.json` `namesakes`; the cap is
  research-append-tool-spec §5): a person with a row takes a record's facts
  only through a qualifying `probable` or `confident` link that
  `namesakeVerdicts` allows, with relatives read from the tree as it stood
  before the call, so op order inside a batch cannot change the answer (M6
  and M7 in `materialize-facts-namesake.test.ts`). A stub the exemption below
  covers is a re-copy and is not judged. An explicit `personId` that fails is
  refused: "'<id>' has a recorded namesake ('<ns>'), so a record's facts
  reach '<id>' only through a link the namesake cap allows. '<pe>' ties
  assertion '<a>' to '<id>' at '<confidence>', but nothing in source '<src>'
  ties it to '<id>' (<reason>).[ Nothing ties '<pe2>', … either.] Route that
  link to person-evidence, which ties
  it (links another party of this record to a spouse, parent or child of
  '<id>' already in the tree; one made from this record alone does not count)
  or lowers it to 'speculative' naming the namesake.", followed by
  the arm's own suffix. When `personId` is omitted, a person the lookup would
  otherwise reuse is skipped, and the op takes the next eligible person or
  mints one, with a warning: "persona '<role>' of record '<record>' would
  have reused '<id>', but '<id>' has a recorded namesake and its link '<pe>'
  from this record is not tied; '<new>' was created instead. Route '<pe>' to
  person-evidence to tie or lower it.", or "'<other>' was used instead" when
  the lookup takes another eligible person. Measured at `20ad24872` by
  `dev/measure-namesake-cap.ts` §5 over the committed runs' persona ops, on
  each run's final state: with rows on every person holding a live strong
  link, 162 of the 967 explicit ops onto a row holder admitted without the row
  are refused, and of the 116 row holders an implicit op's persona facts reach
  that are admitted without the row, 7 are refused with it, so the lookup
  passes them over; with rows on the subject alone, 35 of 260 (7 in fixtures
  whose hint is the subject's own record, 8 a namesake's, 20 unlabelled) and 0
  of 1.

Known let-throughs, none with an executed op in the corpus:

- On the persona arm, a one-party assertion the agent linked to both people
  still carries the persona onto the other one when no other persona of the
  record holds that person through an assertion linked to them alone, for
  instance before the groom's own assertions are linked.
- On the named-party arm, a party still lands on the naming assertion's own
  party when no one-party assertion of the own persona is linked to the target
  at its strongest level (it has none, or they are linked to no one or only to
  someone else), the named role's own one-party assertions carry no `probable`
  or `confident` link, and the gender check cannot tell them apart: the op
  passes no gender, the target's gender is `Unknown` (which the op's gender then
  fills), or the two match. Nothing in the documents says which party the
  naming assertion's link to the target is about.
- A same-named father's persona still lands on his son's name-only stub made
  from the same record: the stub's name equals the father's, so it traces to
  the father's party, and nothing else on it tells them apart.

Minting needs no link (the link to a new person is written after it exists),
and neither does re-running a record onto the stub it minted
(`mintedFromThisRecord`: a person the run added, not shaped like a FamilySearch
id, whose refs reach only this record), judged against the write-once starting
tree so that a person the project began with is never taken for a stub, even
when their only refs reach this record. A ref reaches every research source that
cites its `S` entry (`refsReach`), not only the last one, so a person made from
one persona of a document is not read as minted from another persona's record of
the same document (pinned by C9r in `materialize-facts.test.ts`). Within one
record the exemption holds only for the party the person was made from
(`partyTrace`): a fact backlinked to, or a live `probable` or `confident` link
from, one of that party's one-party assertions, or a name equal to one of its
names, and no such fact or link from another role's one-party assertion. A
party is a role on the record in every spelling that normalizes equal, as the
named-party arm writes them (`personaParty`). Names do not count for another
role, since two people on one record can share one; a `speculative` link is a
candidate, not an identity, so it traces no party; and a two-party assertion
is no party's trace, since its link may be about either. On the named-party
arm the caller's `name` counts as one of the party's names only when the op
writes nothing but that name (it is not corroborated, or the named role has no
assertion that writes onto a person), so a caller-supplied name never carries
facts onto a stub. A stub that fails it
falls to the link rule, and its refusal opens "'<id>' was created from record
'<record>', but it carries that record's '<role>' party (fact '<F>')" (or "(link
'<pe>')"), or "but
nothing on it (a fact, a link from a one-party assertion, or a name) comes from
this party", then "so it is not this party's stub." Measured at `20ad24872` by
the replay (`dev/replay-materialize-link.ts`, its exempt bucket): 121 committed
(op, person) pairs land on a stub of the op's own record, an implicit op counted
once per person its persona's facts reach, and the party test withholds the
exemption from none. Persons are checked as the
tree stands at each op, so a batch that mints a person from one record cannot
copy a second record onto them without a link. Both arms rest on one decision,
`existingPersonLinkRefusal`. The refusals read:

- Persona arm: "'<id>' was already in the tree, and no 'probable' or 'confident'
  person_evidence link ties one of record '<record>' role '<role>''s own
  assertions (not one that names a second person too, such as a marriage,
  relationship or parentage, a parent or a spouse, whose link may be about that
  person) to them. Write that link with research_append first; a 'speculative'
  link does not qualify. If this persona is someone else, omit personId: the
  tool then reuses the person this persona was already materialized onto, or
  mints a new one." When another persona holds the target, the parenthesis
  names it instead: "one of record '<record>' role '<role>''s own assertions
  linked to them alone (an assertion of role '<other role>' on that record is
  linked to them alone, so they are that persona, and a link of this one's that
  also reaches someone else does not count)".
- Named-party arm, no link: the same first two sentences, naming "assertion
  '<id>' or one of the '<role>' persona's own one-party assertions on record
  '<record>'", or once those are linked "one of the '<role>' persona's own
  assertions on record '<record>' (they are linked to '<ids>', so assertion
  '<id>', whose link may be about either party, no longer counts)", and ending
  "If this party is someone else, omit personId to mint a new person."
- Named-party arm, own party: "'<id>' is linked to record '<record>' role
  '<own role>', the persona assertion '<assertion>' belongs to, so it is not the
  '<role>' that assertion names. Pass the person who is that party, or omit
  personId to mint them; if that link is wrong, supersede it with
  research_append first."
- Named-party arm, gender: "'<id>' is <gender>, but the '<role>' this op names is
  <gender>, so it is someone else. Pass the person who is that party, omit
  personId to mint them, or omit gender if the record does not state it."

Replayed over the committed e2e run logs (2026-10-12), 52 writes onto existing
persons lacked such a link; about 30 came from links `research_append` had
wrongly capped on a birthplace written without its country, which no longer
happens. Replayed again against each run's final state, the persona arm refuses
29 of the 509 persona ops onto a `personId` in calls recorded as successful, in
9 of 208 runs, all dated 2026-09-16 to 2026-10-05, before the rule shipped on
2026-10-12. Read one by one: 16 copy onto a person whose link the writer's old
birthplace cap held at `speculative` (their rationales say so), so today's writer
would store that link `probable` and the copy would pass; 7 onto a person the
agent itself linked only `speculative` (a surname that differs, an 8 year gap,
an unreadable name, a birthplace that still differs); and 6 onto a person the
persona has no link to. Calls whose outcome the run log did not record carry
491 more such ops, of which 29 are refused: 22 repeat 11 of the copies above in
two further calls, and 7 are July copies, 5 with no link and 2 linked only
`speculative` on the agent's own doubt. The one-party rule and the starting-tree
baseline add none of these refusals, and no named-party op in the corpus carries
a `personId`, so that arm has no executed population (measured at 0985737d3
by `packages/engine/mcp-server/dev/replay-materialize-link.ts`). A final state
stands in for the state at call time, so any of these figures can be off in
either direction.

**Reuse when re-materializing without `personId`.** When `personId` is omitted,
the persona arm scans `tree.persons` for any person whose facts carry an
`assertion_id` matching one of this persona's assertions (same `record_id` +
`record_role`). A candidate is reusable only where the explicit-personId gate
would accept it (`existingPersonLinkRefusal` on the assertions the persona arm
counts, above): it was minted from this record (`mintedFromThisRecord`), or a
live `probable`/`confident` `person_evidence` entry links one of those
assertions to it. Among eligible candidates, one with a link from the persona's
own one-party assertions is preferred; a link through an assertion that names a
second person does not count, since it may be to that person. Remaining ties
break by lowest numeric ID. Only when no eligible
candidate exists does the tool allocate a fresh `I` via `nextId`. This prevents
duplicate persons when the same persona is materialized more than once without an
explicit `personId`.

Three alternatives were rejected. Matching on backlinks alone: backlinks are
also stamped onto an existing FamilySearch person when a persona is
materialized onto them under a confident link. Once that link is superseded, a
no-`personId` call would put the facts straight back on that person, past the
link gate. Plain lowest id: in an already-duplicated project it picks the
unlinked orphan stub over the person `research.json` links to. Refusing when
several candidates match: that costs an error round-trip on every re-run in an
already-duplicated project, and hands the agent a choice with no rule.

> Reading assertions to *instantiate* a person is still an evidence-driven
> act (it reads assertions, not nodes), so it stays on the correct side of
> the §3 seam. It is not a merge — nothing is collapsed.

### 4.4 Idempotency and conflict surfacing

- **Idempotent.** Re-running the same persona's materialization (retries are
  common) duplicates neither facts, refs, nor persons — when `personId` is
  omitted, `assertion_id` backlinks on existing facts identify the person the
  same persona was previously materialized onto (§4.3), and the §4.2
  fact-identity test (`factsEquivalent` + equal `value`) plus ref-set union
  makes the content a no-op. Mirrors the idempotent-skip ratified as correct
  in the structured-fact model. One exception: under a recorded namesake, an
  omitted `personId` skips a person whose link from this persona the cap does
  not tie and goes to another eligible person or makes a new one, with a
  warning (§4.3), so a re-run made after
  the row was recorded can add a person.
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
- **One exception rides the warning gate, not this list.** When filling in a
  person's gender gives a child two biological parents of one sex, the gate's
  refusal carries a `factType: "ParentChild"` entry under the same
  `conflicts_surfaced` key (`tree-edit-tool-spec.md` §6). It appears only on that
  refusal and on a justified re-call, never in the vital-type list above.
- `materialize_facts` **does not** write `conflicts` entries — that stays
  `conflict-resolution`'s job. The tool reports; the skill routes.

#### The `assertion_id` backlink — corrections reach the fact

A minted fact carries `assertion_id`: the id of the assertion it was minted
from. `research_append`'s assertion `update` op then rewrites the linked fact's
`place`, `standard_place`, `date` and `value` in the same atomic composite
persist, so a place corrected on an assertion reaches the fact instead of
leaving the earlier reading on it. The op lives in the shared
`research-append.ts`, so this fires for `extraction_append` too.

**Stamped on the mint branch only** (§4.2's coexist arm). Not on the
corroboration arm above, and never filled in when absent there.
`factsEquivalent` is a deliberately *loose* **dedupe** predicate — an absent
date or place counts as compatible, and a place chain that is a prefix of the
other counts as compatible — not an identity one. A fill-when-absent rule would
therefore attach a backlink to a bare `tree_edit add_fact` conclusion a
researcher entered by hand, and a later assertion update would then silently
rewrite it. The backlink means "this fact was minted from this assertion"; it is
set once and never inferred.

**Why this is a write and not a refusal.** ADR-0011 makes a refusal at the
write boundary the default shape for a new gate, and this is deliberately not
one. The write being made — correcting an assertion — is the legitimate write,
so there is nothing for the boundary to refuse; and ADR-0009 constraint 6 is
the test it fails, because there is no call shape the agent could produce
instead. In the run that produced this card the agent had *already* corrected
the assertion and still did not touch the fact, so a refusal would report the
divergence and leave the repair unverified. This also beat a `validateCrossFile`
error, which blocks nothing: writers block on call-introduced errors only
(commit `7cd6a19b9`), so a divergence created by an earlier call is pre-existing
drift. And it beat a heuristic join on (person, fact type, source ref), which is
ambiguous wherever one source yields two facts of the same type — two residences
in one census, a second marriage. The backlink makes the join exact, and a fact
with no backlink is **warned about, never guessed at**.

**What it knowingly does not fix.** A correction made on a *corroborating*
assertion does not reach the fact: the fact carries the minting assertion's id,
not the corroborator's. That is the narrower residue of the same bug and it is
accepted. It bounds at **204 of 7635 person facts** in the committed e2e trees
carrying more than one source ref (re-measured 2026-09-21 by the method this
sentence already gave, over tracked files only; it read 175 of 7225 on
2026-09-14 and 202 of 7603 earlier the same day this was written, so treat the
series as a growth rate rather than a constant and recount by counting facts with `len(sources) > 1` across
`eval/runlogs/e2e/*/*final-tree.gedcomx.json`), and a multi-source fact is only
*potentially* affected — the corroborators usually agree.

**The backlink is dropped, or refused, in four places**, because a fact that no
longer answers to its assertion must stop claiming to:

- `tree_edit` / `tree_correct` `update_fact`, when the op **changes** any of the
  fact's own fields — `date`, `standard_date`, `place`, `standard_place`, `value`
  or `type`. A human correcting the fact directly is recording their own
  conclusion, exactly as `add_fact` does. It warns when it detaches, because the
  cost is real: that fact is now outside the automatic update, which re-opens
  this bug for it. **31 of 114 `update_fact` ops** in the committed e2e run logs
  SET one of those fields; those 31 are 26 `tree_correct` and 5 `tree_edit`
  across 21 calls, out of 114 ops across 80 calls in total (measured
  2026-09-14). That is an upper bound on how many would actually detach, not a
  count of them: the trigger keys on a real change, and a run log records the op
  but not the fact's value at the time, so the detaching subset is not derivable
  from the corpus. Three details it turns on: it keys on a real change rather than on
  the key being present (7 of those 31 also carry `primary`, the conclude-a-fact
  shape, where an unchanged echo rides along); it runs after `standard_place`
  re-resolution, so a sidecar the resolver rewrites counts; and `type` is in the
  trigger although it is not a string field, because a re-classification moves
  the fact across the event / value-bearing line that decides whether an
  assertion's `value` may be written to it at all.
- a fact merge (`mergeFactGroup`), unless every member carries the same
  backlink. The merged fact takes its best date and best place from possibly
  different members, so keeping the first member's id would leave it claiming an
  assertion whose place it no longer carries. **This is deliberately conservative
  and drops the link when one member simply has none**, not only when two
  disagree: narrowing it to "two different non-empty backlinks" would keep the
  link on a fact whose winning place came from the *unbacklinked* member, which
  is the drift the agreement check reports. The merge is tree-only and cannot
  consult `research.json` to tell the benign case apart, so it drops rather than
  guesses. Unlike the `update_fact` detach it does **not** warn: `mergeGedcomx`
  returns a document and has no warnings channel, and adding one changes a
  signature shared with `merge_warnings`' dry run. The drop is always safe, so
  the cost is a lost automatic update rather than a wrong value.
- `tree_edit` refuses a caller-supplied `assertion_id` outright, on every fact
  write path. Admitting the field to the tree schema also made it settable by a
  model, and a forged backlink is one `research_append` would later rewrite.

**The rewrite only ever changes what this assertion put there.** The
corroboration arm fills an attribute the fact lacks from a *different* assertion,
and the fact keeps that source's ref — so a fact holding a value the corrected
assertion never asserted is carrying someone else's evidence. Rewriting it would
destroy that evidence silently, which is the over-reach mirror of the residue
above and lands on the same multi-source population. Each attribute is therefore
compared against the assertion's **pre-call** value: equal, or absent on the
fact, and it is rewritten; anything else is left alone with a warning pointing at
conflict-resolution.

**A malformed value is not a withdrawn one.** `validator.ts` type-checks an
assertion's `date`/`place`/`standard_place` but not its `value`, so a
`value: 1924` reaches the rewrite. Read as "the researcher withdrew this" it
deletes the fact's value; it is reported instead, and the fact is left alone.

**A concluded fact is rewritten, loudly.** `primary` is not a detach trigger, so
a fact proof-conclusion concluded keeps its backlink. The correction still has to
reach it — a known-wrong concluded value on the upload target is worse than a
moved one — but it carries a warning naming the fact, because the proof summary
citing it was written against the earlier reading.

**A `place` corrected without its `standard_place` warns.** The update path
cannot re-resolve the sidecar (the geocode lever is append-only), and the
assertion is equally stale, so the agreement check below cannot see it. That is
this card's own harm one level down — the display string reads corrected while
the place-authority value still names the old jurisdiction — and it is surfaced
rather than left silent.

**The rewrite never fails the call it rides on.** A fact rewrite is
call-introduced, so a rewritten fact that failed validation would refuse the
assertion correction itself. The rewrite is rolled back, validation re-run, and
the dropped rewrite degrades to a warning. It also never writes a
country-contradicting `standard_place`: on a contradiction it clears the fact's
`standard_place` and warns, the same as `tree_edit` does on the same object
(`research_append`'s append arm errors, `gedcomx-convert` omits — no path
fabricates one).

**What makes this checkable at all.** Before the backlink there was no
machine-readable link from a fact to the assertion it came from, so "this fact
disagrees with its source" could not be computed and no writer tool, validator
or CI job surfaced it. With `assertion_id` present it is a property, and
`eval/harness/validators/test_universal.py::test_tree_facts_agree_with_linked_assertions`
asserts it: for every backlinked fact, where both the fact and its assertion
hold a value for `place`/`standard_place`/`date`/`value`, the two must agree.

Two limits on that check were stated here because a `nothing-checks` register
entry turned on them. **The plane limit is now closed; the unit-corpus one
stands** — and it stands as a property of the corpus rather than as a missing
guard, which is why closing that entry leaves nothing unrecorded.

**One predicate, three call sites, two behaviours.** The rule is
`find_tree_facts_disagreeing_with_assertions`, a plain function over
(research, tree) returning one finding per diverging attribute. The unit plane
ASSERTS on it — `test_tree_facts_agree_with_linked_assertions` fails a test when
the returned list is non-empty. The e2e plane REPORTS it twice over, both in
shadow mode: `collect_post_hoc_shadow` emits into `guardrail_shadow_violations`
under the tree-fact/assertion kind while a run happens, and `replay_post_hoc`
recomputes the same findings from committed sidecars, which is the only thing
that reaches runs made before this shipped. Do not write a second copy of the
rule for a fourth. Two copies of a rule agree only
until the first correction to either, and the correction that matters here is a
false-positive exemption: there are five, each admitting a legitimate operation,
and a copy that loses one turns red forever on correct work.

**Reported on e2e, not gated.** That is what every other post-hoc detector in
that bucket does, and promoting one to something that fails a run is a separate
step with its own evidence bar in `guardrail-enforcement-spec.md`'s
shadow-to-graduate pipeline. It matters more for this check than for its
neighbours: in shadow mode an over-firing predicate never reds a run, so it
surfaces only as a number somebody later quotes — which is why the accept
direction is break-tested as hard as the fail direction.

**Closed does not mean observed.** Replayed over every committed e2e run pair
the check reads zero, and that zero is measured rather than structural: the
population is real but young rather than thin. Of the committed runs made since
the backlink shipped (2026-09-15), most carry one: the facts are there, the
large majority are single-ref and so comparable at all, and the check performs
real attribute comparisons on them rather than skipping through. What it has not
had is TIME. The run the gap was filed off predates the backlink and carries
none, so it can never reproduce the defect on replay. Read a zero here as "not yet seen", never as
"cannot happen".

**The population SIZE is deliberately not pinned here**, though the zero is: the
fire count is what `make e2e-guardrail-shadow REPLAY=1 SINCE=all` prints, with
its denominator, and it will still read zero long after any population figure
written on this page has gone stale. To size the population, count facts
carrying an `assertion_id` across `eval/runlogs/e2e/*/*final-tree.gedcomx.json`
and take those with at most one `sources` ref; that is the comparable subset,
and it is the same shape the multi-ref bound above is measured with.

**The unit-corpus limit stands: green by construction.** No unit run both mints
a backlinked fact and later corrects the assertion it was minted from, so the
two populations remain disjoint and nothing on that plane can make the check
fire. The minting is overwhelmingly `person-evidence`'s and every four-field
assertion `update` was `record-extraction`'s (since retired), through `extraction_append`; today `extraction_append` takes no updates and `research_append` refuses every assertions write except an `informant_bias_notes`-only update, so nothing on that plane issues one.

An earlier form of this paragraph pinned that with an exact call count and the
claim that **all** of those calls were `person-evidence`'s. Both had drifted
within weeks, the all-clause outright, while the conclusion they were offered as
evidence for stayed true — so the shape is stated here and the counts are not.
To recount, walk `tests[].runs[].output.tool_calls[]` in the tracked run logs
under `eval/runlogs/unit/`, count the calls whose tool name ends in
`materialize_facts`, and separately the `research_append`/`extraction_append`
ops with `section: "assertions"` and `op: "update"` touching any of
`place`/`standard_place`/`date`/`value`; the claim is that no single run does
both. Count tracked files only: a working tree also holds `scratch_` and
`.partial_` logs, and including them is how the superseded figures were got
wrong in the first place.

The unit-corpus limit's
falsifiable half is still the direct unit test at
`eval/harness/tests/unit/test_tree_fact_assertion_agreement_validator.py`;
`validators/` is outside the harness's own `testpaths`, so without that file the
check would ship unexecuted. The live-path twin at
`eval/harness/tests/unit/test_post_hoc_shadow.py` does the same job for the e2e
caller, whose own zero is likewise green by construction until a run fires.

**Who may perform this write.** No skill or agent is added
to the `tree.gedcomx.json`/`persons` row's `callers`: a skill-granular grant
would also authorize adding an unsourced person and setting `primary`, which that
row's `failure` line ("this file is the upload target") is precisely about.
`research_append`/`extraction_append` are authorized as **tools** instead, and
only when the whole persons delta is this rewrite — mirrored attributes on facts
that already carried the same backlink, nothing added or removed. Same shape as
the `merge_tree_persons` authorization on the research side: anything the
substitution does not explain still fails.

### 4.5 What it never does

Never sets `primary`/`preferred`; never resolves conflicts; never collapses
or merges persons; never writes relationships (those are `tree_edit`
`add_relationship`, see §8); never materializes a **couple event** as a
person-level fact (added 2026-07-27 as `marriage` alone, `SKIP_TYPES` in
`materialize-facts.ts`; widened to every couple event in any spelling by
`COUPLE_EVENT_FACT_KEYS` in `record-persona.ts`). `fact_type` is an open enum,
so one event arrives spelled several ways — `marriage_bann`, `Marriage Banns`
and `MarriageBanns` are one event — and the key is matched folded (lowercased,
non-alphanumerics stripped) rather than raw. Matching the raw string skipped
only `marriage`: three live e2e runs wrote `marriage_intention`,
`marriage_bann` and `marriage_date` onto a person, and no fixture carries any of
them. A marriage is a Couple-relationship event — per `tree_edit`'s own convention
("a Marriage/Divorce fact lives on the Couple, never duplicated onto each
spouse"), it can never be a correct person-level write, not just usually a
wrong one, so the tool silently skips it rather than relying on caller
discipline. Guards the exact mistake a person-evidence regression test
(`ut_person_evidence_022`) caught live: an already-existing spouse's persona
whose only assertion was `marriage` got materialized straight onto that
person, leaving the Couple relationship itself factless. The marriage's
date/place belongs on the Couple via `tree_edit` `add_relationship`'s
`facts`, sourced with that same `marriage` assertion through
`sourceAssertionId` (§8). That instruction was unfollowable until
`add_relationship` accepted a `marriage` assertion — it took only
`relationship`. The two tools contradicted each other across the seam rather
than either being internally wrong: `tree_edit`'s own description said
`relationship`-type and matched its guard, while this sentence and
`materialize_facts`'s description named the marriage assertion. The accepted
set is now the shared `RELATIONSHIP_ESTABLISHING_TYPES` in
`utils/source-ref-resolver.ts`.

What §4.5 does **not** say is that the party the skipped assertion *names* has
nowhere to go. She is minted by §4.6 — as a sourced name, plus that persona's
own facts where the record gives her a persona it never names and the
assertion's `related_person_role` corroborates the role. Every clause above
still holds: the second pass runs through the persona arm, so `SKIP_TYPES`
drops the `marriage` assertion there exactly as it would on any other persona,
and no Marriage fact reaches a person.

---

### 4.6 The named party (a person the record names but gives no persona)

A person the record names inside another persona's `relationship` or `marriage`
assertion — the bride named in the groom's marriage register is the canonical
case — has no name assertion the persona arm can mint her from: either she has
no `record_role` of her own, so the arm has nothing to select on and
`SKIP_TYPES` drops the only assertion that names her, or the persona that role
does have is never named by the record.

**Which shapes actually reach this arm, measured rather than assumed.** Running
the arm against the corpus fixtures: the bride in `flynn-spouse-stub-marriage`
and `flynn-couple-marriage` **mints**, and `flynn-baptism-names-mother` — the
only corpus instance of a parent named in a child's baptism — is **refused**,
because extraction gave Bridget her own `mother` persona with a name assertion,
so the persona arm is the correct call and writes her facts too. Take the
marriage register as the canonical case. A baptism naming a parent the record
gives no persona is a legitimate use, but it is not what the corpus contains
today, so do not reach for this arm on a parentage assertion without checking
first: the refusal will name the `{ recordId, recordRole }` to use instead.

Until this arm existed she could be written only by `tree_edit add_person`,
whose **name** path is ref-tolerant by the §6 exemption. That exemption is
reserved for hypothesis, oral and manual stubs, and its safety argument is
"those names come through `materialize_facts`, which enforces a resolved ref."
A bride in a marriage register is **record-derived**, so she travelled through
an exemption whose own justification did not cover her, and landed with no
provenance. This arm closes that.

```
materialize_facts({ projectPath, assertionId, relatedRole,
                    name: { given, surname }, gender?, nameType?, personId? })
```

- **The caller supplies the name; the tool supplies and enforces the ref.** The
  ref is resolved from `assertion.source_id` through the same shared resolver
  (`utils/source-ref-resolver.ts`) every other name this tool authors uses, and
  a hop that will not resolve is an **error, never a null** (§4.2 step 2). The
  name is *remembered*; the ref is *enforced* — and the ref is the thing that
  leaked.
- **`assertionId` must name an assertion that establishes a link between two
  parties** — the shared `RELATIONSHIP_ESTABLISHING_TYPES`: `relationship`,
  `marriage`, `parentage` and `parentchild`, matched case-insensitively. `age`,
  the third `SKIP_TYPES` member, is out: it is indirect evidence about one
  person and names nobody. So are the rarer link-ish spellings the corpus also
  shows — `marriage_intention` (3), `Father`/`Mother` (3 each), `marriage_bann`
  (2), `spouse` (2), `parent_name` (2), and a tail of single occurrences. Read
  that as a sample, not an enumeration: `fact_type` is open, so no set here can
  be complete, and one of the seven refusals this change was measured against
  was a `marriage_bann` that stays refused. The set is a ruling on the spellings the corpus
  actually shows, not an attempt to enumerate an open enum — `parentage` and
  its variants total 45 occurrences in agent output against `Marriage`'s 27, so
  refusing them while accepting `Marriage` was not a defensible line. Widen it
  the same way: measure first, then decide.
- **`relatedRole` should name a party that has no persona on that record**, and
  the tool refuses when it can see that it does *and* that the persona arm could
  actually MINT her: it scans the record's assertions for one carrying
  `record_role == relatedRole`, and refuses only when that persona carries a
  non-negative **`name`** assertion. The condition is the name specifically, not
  any materializable assertion, because the persona arm refuses to mint a person
  it cannot name: steering a gender-only or birth-only persona there errors, and
  this arm refusing would hand the caller back to the call that just failed.
  **Having a `record_role` does not imply having facts, or being mintable at
  all**: in a mirrored marriage register both parties have a persona and neither
  carries anything but the `marriage` assertion, so an unconditional refusal left
  the bride writable by *neither* arm, which is worse than the name-only shell it
  was trying to prevent.

  **What the narrowing owes, and pays here.** Letting a nameless persona through
  means this arm now receives parties whose records DO state facts about them, so
  minting a bare name would drop exactly what symptom (1) is about. It does not:
  when the role has such a persona, the arm mints her name and then applies the
  persona arm to that `{ recordId, recordRole }` with the id it just allocated,
  merging the counts. The persona arm enriches rather than mints at that point,
  and by construction there is no positive `name` assertion for it to
  double-write. A ref it cannot resolve throws and the whole op is abandoned
  before anything persists, which is §4.2 step 2 applied to the second pass as
  well as the first.
  Measured over `eval/**/research.json` (99 files, re-derived 2026-09-13), 90 of
  311 personas carry no usable `name` assertion, and 29 carry nothing but
  `relationship`/`marriage`.

  **"Or the target person already exists" is NOT part of the condition, and
  adding it was a bug worth recording.** It reads plausibly — the persona arm
  would enrich rather than mint — but an existing person gives that persona
  nothing to write, so it recreated the same dead end, and it made the
  idempotency guarantee below false: the first call mints the person, so the
  second call refused itself. Both regressions are pinned by tests. When the guard does fire, the refusal names the exact
  `{ recordId, recordRole }` to call instead.

  **This guard is best-effort, and it is worth being exact about why.** It
  compares the caller's free-text `relatedRole` against extraction's free-text
  `record_role`, and that vocabulary is open: the corpus spells the same party
  `bride` (16) and `wife` (3), and head-of-household as `head_of_household`
  (63), `head` (5), `self` (2) and `principal` (13). A spelling disagreement
  makes the guard **miss**, and the result is worse than the name-only shell it
  was written for: a paraphrased `relatedRole` (`"birth mother"` for a record
  that says `mother`) mints a **duplicate person**, sourced and plausible.
  Callers are instructed to spell the role exactly as the record does, which is
  what makes the check fire; the check cannot enforce that itself, because both
  sides are free text. What makes that acceptable is the direction of the failure: a miss
  degrades to exactly the behaviour this arm would have had without the guard,
  and the write still carries an enforced ref, whereas a false refusal blocks
  correct work outright. The arm's **guarantee** is the ref (§4.6's opening);
  the role check is a steer, not a proof, and nothing downstream can detect a
  miss because `relatedRole` is never persisted.

  Comparing `relatedRole` only against the *assertion's own* `record_role` is
  not enough and was the first version of this guard. Measured over
  `eval/**/research.json`, the role a relationship/marriage assertion names
  already has its own persona on the same record in **93 of 167 cases (55.7%)**,
  including `flynn-baptism-names-mother` — the "father named in a child's
  baptism" shape this section leads with. The narrow check missed every one.

  `relatedRole` is never persisted, but it is not otherwise unused: it selects the
  `siblings` set whose facts the second pass writes, and the corroboration gate is
  `related_person_role` normalized against it. Nothing on a tree
  person holds a role and this tool never writes `research.json`. It is required
  rather than optional because a guard a caller can skip by omitting it is not a
  guard.
- **Negative evidence cannot mint anyone.** An assertion with
  `record_basis: "absent"` records what a source does **not** say
  (`"Father: not recorded (informant reported 'unknown')"` is live in the
  corpus), so minting a father from it would assert the opposite of the
  evidence. The persona arm already skips negative assertions per §7.1 (4);
  here there is only one assertion, so the call is refused rather than
  silently emptied.
- **Writes a sourced name and the gender scalar, plus that persona's own facts
  where the role does have a persona the record never names AND the assertion
  corroborates the role.** Never a relationship edge, never `preferred`. Two
  conditions on that fact pass, each for a failure it was measured causing.
  (1) It runs only when `structured_value.related_person_role` normalizes equal
  to `relatedRole`. `relatedRole` is free text the tool cannot otherwise check,
  and a wrong one that happens to name a real OTHER role on the record selects a
  different individual's persona: executed, a `testator` parentage assertion
  naming a daughter with `relatedRole: "heir"` wrote Ann Weller carrying the
  male heir's Birth 1802 and Death 1871, three resolved refs, no conflict
  surfaced. That breaks this section's own acceptance of a guard miss below
  ("a miss degrades to exactly the behaviour this arm would have had without
  the guard"), which was written when the arm wrote a name. 146 of 167 corpus
  relationship/marriage assertions carry the key, so corroboration is the common
  case; without it the arm writes the name alone, because a missing fact is
  recoverable by a later persona-arm call and a fact on the wrong person is not.
  That call needs a `probable` or `confident` link from the persona to the
  stub: a name-only stub traces to no party (§4.3), so it is not exempt.
  (2) It runs one `applyMaterializeOp` per distinct `record_role` spelling the
  guard matched, not one for the first: the guard selects case- and
  space-insensitively while the persona arm filters exactly, so a single
  spelling would hand it a subset and drop the rest silently. The pre-op fact
  ids are snapshotted once and shared across those passes, so a later pass
  cannot report a fact an earlier one just created as `factsEnriched`.
- **The caller's `gender` wins.** `gender` on the op is applied before the fact
  pass, and the persona arm only fills an absent or `Unknown` one, so a supplied
  `gender` overrides the persona's own `gender`/`sex` assertions. Omit it to
  take the record's.
- **No name type is invented.** `nameType` is optional and the field is
  **omitted** when the caller does not supply one. This differs from the persona
  arm, which records `BirthName`, and the difference is deliberate: a persona's
  `name` assertion is that person's own recorded name, whereas a party named
  inside someone *else's* assertion is often named by a surname that is not her
  birth surname — *"survived by his wife Mary Smith"* gives the husband's. A
  `BirthName` on that node would be a claim the record never made, carried under
  a resolved ref that says the record made it, which is the precise failure this
  spec exists to prevent. Omitting is legal (the tree schema requires only
  `id`/`given`/`surname`) and is what most of the corpus does; the caller names
  the type when the record settles it, as a marriage register does for a bride's
  maiden name. §4.5 therefore holds in full: a
  `marriage` assertion still never becomes a person-level fact, and the Couple
  event stays on the edge.
- **Idempotent for a given `personId`** — a re-run unions the ref onto the
  matching name rather than duplicating it. An omitted `personId` allocates a
  fresh `I` on every call; the named-party arm has no `assertion_id` backlinks
  to search for, so the persona arm's reuse rule (§4.3) does not apply here.

**Why the caller supplies the name — and the alternatives this beat.** Recorded
here so it is not re-derived. Measured 2026-09-07 by walking
`assertions[].structured_value` over `eval/**/research.json`, keyed on
`fact_type in {relationship, marriage}`:

| | |
|---|---|
| relationship + marriage assertions in the corpus | **167** |
| carrying the other party's **name** in `structured_value` | **8 (4.8%)**, under five distinct key *shapes* (nine distinct key strings), **7 of the 8 assertions distinct** |
| carrying `related_person_role` | **146 (87.4%)** |
| …of those, where `related_person_role` holds the **persona's own** `record_role` | 40 raw, but only **5 distinct** `(record_role, fact_type, value)` shapes, 7 compared byte for byte |

The last row needs its caveat stated or it misleads: 34 of those 40 are one
byte-identical assertion cloned across 34 scenario fixtures, 17 named `flynn-*`
and 17 named `mid-research-flynn*`, which a `flynn-*` glob does not match.
Counted
over the wider `eval/**/*research.json` set (which adds the agent-produced
`final-research` run logs; the 137 `starting-research.json` files all carry
`assertions: []` and widen nothing) the raw rate falls to 50 of 1730, across 17
distinct shapes and ten different role values. **The rate is a fixture-cloning artifact; the
phenomenon is not.** The name row survives the same widening and strengthens
(31 name-carrying of 1989, 29 of them distinct), which is why it, and not the
rate, carries the argument below.

- **Rejected: have the tool read a standardized `structured_value` name key.**
  The name is there 4.8% of the time under five distinct key shapes, and the shape
  this repo's own schema spec recommends (`spouse_given`/`spouse_surname`)
  occurs in 1 of 167. Standardizing one would have meant changing record-extraction's (since retired)
  prose — a second paid eval run and a second reviewer — and every project
  written before that change would stay unmintable. `structured_value` is
  `type: object` with no properties, is deliberately not deep-checked by the
  validator, and the schema spec calls its shape guidance rather than a
  contract, so **no lint would report a key that had gone missing.**
- **Rejected: cross-check the caller's `relatedRole` against
  `structured_value.related_person_role`.** That key is present often enough to
  look tempting (87.4%), but it holds the persona's **own** role rather than the
  other party's in eleven distinct assertion shapes spanning ten role values
  (`baptized_child`, `child`, `child_1`, `child_2`, `deceased`, `father`,
  `head_of_household`, `mother`, `testator`, `wife`). A refusal keyed on it
  would therefore reject correct calls — not
  at some headline rate, which fixture cloning inflates in either direction, but
  reliably and on shapes that recur. Measured before it was built, not after,
  and re-measured after a reviewer showed the first rate was inflated.

  **Re-openable, with a residue.** The convention this
  rejection needed was never stated, which is why the shapes looked
  contradictory: `relationship_type` is the record subject's own role and
  `related_person_role` is the other party's. That convention was pinned on
  2026-09-20 and is now stated
  (`research-schema-spec.md` §5.6.1); it enforces the `relationship_type`
  half at the write boundary, refusing 21 of 2586 (0.8%) across the run
  logs, fixtures and hosted seed, measured at 1d5656fe3 by
  `eval/harness/scripts/measure_relationship_direction.py`.

  **This cross-check's own rate, which is not the one above.** A
  `related_person_role` cross-check would carry **14 of 1844 (0.8%)** — the
  denominator being relationship and marriage assertions that actually carry
  the field, since a guard cannot run where it is absent — across 6 recurring
  `(record_role, fact_type)` shapes once `child_N` and `grantor_N` collapse:
  father 4, mother 3, child 3, grantor 2, head_of_household 1, wife 1.
  Measured 2026-09-19 over `eval/**/*final-research.json`, measured at
  1d5656fe3, and emitted by `measure_relationship_direction.py
  --self-referential` so it is re-derivable rather than pasted. The rate
  recorded beside the `relationship_type` guard is a **different guard's**
  number over a **different denominator** — both round to 0.8%, which is
  a coincidence of this corpus and not a reason to read either as the
  other's.

  What is NOT settled, and why this stays rejected rather than becoming
  buildable: those 14 are the failure the 2026-09-07 note describes, and they
  are a **content** defect — the field populated with the persona's own role —
  not a consequence of the unstated convention. Stating the convention does
  not repair them. The spec's own worked example encoded the same shape
  (`relationship_type: "father"` with `related_person_role: "deceased"` under
  `record_role: "deceased"`), and it is cloned into 40 files: 38 scenario
  fixtures, the hosted seed and the electron fixture. The example is corrected
  and the clones left, because neither guard shipped alongside refuses any of
  them — 0 refusals in `eval/fixtures/**` and 0 in the seed, asserted by the
  script above rather than assumed. So the population this cross-check would
  run over is mixed, and whether those rows get healed or tolerated is a
  decision nobody has taken. Re-open when it is; the convention being stated
  does not clear this.
- **Rejected as the answer, though it is the smaller diff: teach `tree_edit`
  `add_person`/`add_name` a `sourceAssertionId`.** It leaves the omission path
  open — a caller who passes nothing still gets a ref-less name — so it makes
  the ref easier to supply without making it impossible to skip. This arm
  refuses the write instead.

**What this deliberately does not enforce.** The tool cannot know the name the
record gives, so it does not pretend to check it. The write target it does check,
by the persona arm's link rule and two checks of its own: a `personId` already in
the tree needs a `probable` or `confident` link first (§4.3). It does **not**
refuse a name matching the persona's own: a same-named father and son is
ordinary genealogy, and refusing there would block correct mints far more often
than it would catch a duplicate. The guarantee this arm makes is about
provenance, and it is exact — a person minted here always carries a resolved
source-ref, or was never written.

Nor does it guess a name apart. A multi-token `given` with no `surname` **key**
is refused as ambiguous rather than split: *"Mary Doyle"* is a full name and
*"Anna Maria"* is a compound given name a register may supply with no surname,
and splitting the second fabricates a surname that then rides an enforced ref,
which is the shape that makes a fabrication look provenanced. Passing
`surname: ""` states that the record gives none.

**One downstream interaction to know about.** `person_warnings` reports a person
with no facts and no relatives as `missingFactsAndRelatives` at severity
`implausible` ("likely an unfinished stub record"), which is this arm's
documented output verbatim, so a party minted here is flagged until her edge and
the record's other facts land. That is not a defect in either tool: she *is*
incomplete at that moment, and the writers' own warning gate runs on every
write to surface what is still owed. What the warning cannot see is that she carries a
resolved ref where a hypothesis stub does not. Do not answer it by writing her a
fact the record does not support.

---

## 5. Tool roster

| Tool | Role | Status |
|---|---|---|
| **`materialize_facts`** | Assertion-driven: create-or-enrich a person with **sourced** facts/names; auto-carries refs; mandatory non-null ref on every fact/name it authors; never sets `primary`. Its named-party arm (§4.6) additionally mints the party a relationship/marriage assertion names but cannot name from a persona — a sourced **name**, plus that persona's facts where the record gives her one, under the same mandatory ref. Either arm writes onto an existing person only on a `probable` or `confident` link (§4.3). | **NEW — the record→tree workhorse** |
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
- **`tree_edit` add-ops** — `add_fact`, `add_person` inline **facts**, and
  `add_relationship` edges must carry a ref on the content they introduce
  (§8). Ad-hoc **name** authoring (`add_name`, `add_person` names) is a
  reasoned exemption — see below.
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
- **`tree_edit` `add_name` / `add_person` names are ref-tolerant** (a
  deliberate, reasoned exemption, like the two above). The leak this spec
  closes is *record-derived* evidence losing its provenance — and those names
  come through `materialize_facts`, which enforces a resolved ref on every
  name it authors. `tree_edit`'s name path serves **hypothesis, oral, and
  manual** stubs — the init-project subject built from *"grandma said her
  mother was Mary Donovan"*, or a name added by hand — which legitimately have
  **no documentary source yet**. A name is not evidence that lost its source;
  it is a working conclusion whose source may not exist. Requiring a ref here
  would forbid the "start from what the family told you" workflow, and it is
  safe: **upload is conclusion-gated (§7)**, so a ref-less hypothesis name
  never reaches FamilySearch until it is proof-backed.

  **One class travelled this exemption without qualifying for it**, and the
  argument above is why it mattered: a person named inside another persona's
  relationship or marriage assertion is *record-derived*, but before §4.6 she
  had no `materialize_facts` path at all, so "those names come through
  `materialize_facts`" was simply not true of her. §4.6 gives her one, and it
  enforces the ref.

  **The exemption's safety argument is restored.** A record-derived person
  named inside another persona's assertion now has a ref-enforcing path, and
  `person-evidence` uses it: it mints such a party through `materialize_facts`
  (the persona form when that role has its own persona on the record, the
  named-party form when it does not) and no longer reaches for `tree_edit
  add_person`. So the sentence above holds as written again: the names this
  exemption tolerates are hypothesis, oral and manual stubs, and the
  record-derived ones come through `materialize_facts`, which enforces a
  resolved ref on every name it authors. An eval-harness validator asserts the
  minting CALL was `materialize_facts` on the two `stub-creation` fixtures, so
  the routing is checked deterministically rather than only by a judge; that is
  a harness check over two fixtures, not an engine-side guard, and `tree_edit`'s
  name path stays ref-tolerant by the exemption above.

Consequences:

- The cruz leak (100% of *newly written* facts ref-less) becomes
  **unrepresentable** at the writing seam — every fact and edge a writer
  *authors*, and every *record-derived* name (via `materialize_facts`),
  carries a ref (ad-hoc hypothesis names excepted above).
- **Provenance-nulling-as-error-recovery** (closing report §3.4) becomes
  unrepresentable on the write path — a writer cannot null a ref to escape
  validation.

A **golden anti-regression test** asserts that written content carries a
non-null ref — scoped to **written content**, not "every node in the whole
tree" (which would fail on tolerated legacy nodes). `materialize_facts`'s
golden covers every **fact and name** it authors (the record→tree path, where
the cruz names leaked); `tree_edit`'s golden covers every **fact and edge** it
authors (its ad-hoc names are exempt above). `merge-tree-persons.test.ts` is
**not** in either golden writer list — the Mode-2 fold authors nothing.

**The ESM citation string is out of scope here.** The tree S-entry's
`citation` stays populated by `proof-conclusion` at upload time (copied from
`research.json` `sources[].citation`), per existing doctrine. This spec owns
the **source-ref (pointer)**; the `citation` agent / proof-conclusion own the
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
   `record_basis: inferred` and `date_certainty: calculated` (per the structured-fact model,
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
provenance leak. **The tool does this resolution itself**: pass
`sourceAssertionId` (the research.json assertion the edge comes from — a
`relationship` **or** `marriage` type, the shared
`RELATIONSHIP_ESTABLISHING_TYPES`; a marriage register is precisely what
establishes a Couple, and accepting only `relationship` made §4.5's own
instruction unfollowable for the commonest Couple edge there is) rather than a
hand-walked literal ref — `tree_edit` resolves
`assertion.source_id → research source → tree S-entry` via the shared
`utils/source-ref-resolver.ts` (`docs/specs/tree-edit-tool-spec.md`, the
`add_relationship` entry). Added 2026-07-26 after the model was observed
getting the hand-walked chain wrong on its first attempt, costing a retry
(`docs/specs/tree-edit-tool-spec.md` §4.1, `add_relationship`) — a literal
`relationship.sources` remains available but is no longer how person-evidence
supplies it. `add_household_children` **retires** (§9); person-evidence
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
(`src/tools/merge-warnings.ts`) calls `mergeGedcomx(tree, candidate, merges)` with a
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
deferred to Open Questions or a follow-up issue. The
`match-merge-workflow-spec.md` edit and its integration-test coherence
assertions (`hasSameCensus`, `hasEventsOutsideLifespanFar`) are preserved and
carried by that phase.

**Verification gate for the phase:** `grep` for any surviving
`merge_record_into_tree` / `mergeRecordIntoTree` reference returns nothing
unintended; the full `vitest` suite and the manifest-drift test
(`tests/packaging/manifest.test.ts`) pass.

> Any item this PR ends up **deferring** (rather than removing) gets a GitHub
> issue in the same PR (`gh issue create --label developer` — see `CLAUDE.md`
> § "Work you find along the way") — e.g. wiring a duplicate-node trigger
> for `merge_tree_persons`, if that is not done here.

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
   **golden anti-regression test** (written content carries a ref: fact +
   name for `materialize_facts`, fact + edge for `tree_edit` — ad-hoc names
   exempt per §6; scoped to written content; `merge-tree-persons.test.ts`
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
  tree persons are the same" detector). If not addressed in the PR, → its own
  GitHub issue (§9).
- **`materialize_facts` input shape — RESOLVED (batch axis).**
  `(personId, recordId, recordRole)` per persona, as recommended, plus a
  batch `ops[]` form added 2026-07-26 once a real need arrived: e2e runlogs
  showed 8-44 unbatched `materialize_facts` calls per run on
  marriage/vitals/family-reconstitution fixtures, correlating with wall-clock
  regressions up to +92% (see §4.1). This is a **different axis** from
  the `assertionIds[]` variant floated here originally — that would narrow
  *one* persona's assertions; the real need was batching *many* personas in
  one call. `assertionIds[]` remains unbuilt, still deferred until its own
  real need shows up.
- **Synthesized-conclusion facts — DECIDED (additive path).** A
  `proof-conclusion` value that no single record asserts (a calculated/inferred
  conclusion, e.g. three census ages → "abt 1805") materializes via `tree_edit`
  `add_fact` with `primary: true`, carrying **multiple** source-refs to all the
  correlated evidence S-entries (§7.1). `tree_edit` `add_fact` is in
  proof-conclusion's roster (§3). Resolved — no longer open.
