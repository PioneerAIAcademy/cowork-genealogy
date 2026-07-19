---
name: person-evidence
model: claude-sonnet-4-6
description: >-
  Links assertions to GedcomX persons — identity resolution. Evaluates whether
  a record's person is the same as a GedcomX person, creates person_evidence
  entries with confidence and rationale, and creates stub persons when none
  match. Also reviews and audits existing person_evidence links. GPS Step 3 —
  Analysis and Correlation. Use when the user says "is this the same person?",
  "link this to [person]", "link all roles in this record", "review/confirm
  this identity link", "audit the person_evidence entries", after assertions
  are extracted and need person assignment, or to evaluate whether two records
  refer to the same individual using records already in hand — never searching
  for new ones. Do NOT use to find or gather more records, including to
  confirm or disprove an identity (use search-records); to extract assertions
  (use record-extraction); to resolve a genuine conflict where multiple
  candidates compete (use conflict-resolution); or to merge
  confirmed-identical persons (use tree-edit after proof-conclusion).
allowed-tools:
  - research_append
  - tree_edit
  - same_person
  - materialize_facts
  - merge_warnings
---

# Person Evidence

**Narration:** Read `researcher_profile.narration_guidance` from `research.json` and apply it as your narration style for this invocation. If absent, default to a one-line preamble per action.

Links assertions (attached to records and roles) to persons (in
tree.gedcomx.json). This is the identity-resolution step — the bridge
between "what the record says" and "who the record is about."

## GPS Grounding

This skill implements GPS Element 3 (Analysis and Correlation) for
identity resolution. Three rules always apply:

1. "This record is about my person" is an **unsound assumption** until
   corroborated. Never treat a name match alone as identification.
2. Related information items (same informant or derivation chain) count
   as **one evidence unit**, not multiple confirmations.
3. Identity conclusions may rest on direct, indirect, or negative
   evidence in any combination.

Load `references/evidence-standards.md` for the full assumptions
framework and evidence independence rules.

## Why this is a separate skill

Most genealogy research is about deciding whether two records refer
to the same person. If assertions were attached to a person ID at
extraction time, you'd either force premature identity decisions or
corrupt data when persons get merged. Instead:

1. **record-extraction** attaches assertions to `record_id` +
   `record_role` (the persona)
2. **person-evidence** (this skill) evaluates whether each persona
   is the same as a known GedcomX person, and creates a revisable
   link

This mirrors GedcomX's Persona vs. Person distinction.

## Cardinality

**One assertion can link to multiple persons.** This is the expected
pattern for relationship assertions. Example:

- Assertion a_004: "Listed in household of Thomas Flynn, position
  consistent with child"
- This assertion bears on BOTH Patrick Flynn (I1, the child) AND
  Thomas Flynn (I2, the head)
- Create two `pe_` entries: one linking a_004 → I1, another
  linking a_004 → I2

Create one `pe_` entry per person the assertion bears on.

**Do this proactively, in the same pass.** When an assertion implies a
relationship (a census household, a will naming a child, a marriage record),
create the `pe_` entry for **every** person it bears on — both the focus
person *and* the implied relative(s) — without first stopping to ask the user
whether to link the other side. Linking only the focus person and then asking
"should I also link the parent/spouse/child?" is **incomplete** and scores as
such. (This is separate from the match-threshold policy in Step 3: you still
pause for a *weak identity match* on any single link — but recognizing that a
relationship assertion bears on multiple people is automatic, not something to
ask permission for.)

## Building a Person Profile Before Matching

Before evaluating candidate matches, build or update the profile of
the person you are trying to identify. At minimum you need: name
(with variants), age/birth year, and residences. Additional elements
(occupation, relatives, associates, religion) strengthen confidence.

Load `references/person-profiles.md` for the full framework.

## Correlation Techniques

When evaluating whether a record persona matches a known person,
use structured comparison. The two most relevant techniques:

1. **Side-by-side chart** — When multiple candidates exist, place
   data points in columns to see which candidate fits. Compare
   residence, spouse, occupation, children's names/ages.
2. **Bullet-point list** — Enumerate points of agreement and
   disagreement. This format maps directly to the `rationale` field.

For chronological analysis, hand off to the **timeline** skill.

Load `references/correlation-techniques.md` for full examples and
format templates.

## Steps

### 0. Identify the request mode

Before any linking work, decide which mode the user has invoked:

**Guard — wrong skill (decline):** If the user is asking to **find, search
for, or pull new records** — even to *confirm*, *strengthen*, or *disprove* an
identity (e.g. "find more records confirming X is the same person", "search for
additional sources on this person") — this is **not** a person-evidence task.
Do **not** create, re-evaluate, or audit any `person_evidence` links. Briefly
tell the user this belongs to **search-records** (it finds new records; this
skill only evaluates records already gathered) and stop. Only proceed below
when the request is about evaluating or linking records already in hand.

**Linking mode (default):** The user wants new `person_evidence`
entries — to link unlinked assertions to persons, process roles in a
multi-person record, or add a missing other-side link. Triggers
include: "is this the same person?", "link this to [person]",
"who is this?", "match this person", "link all roles in this record",
"this record mentions multiple people", "should this assertion also
link to [other person]". Proceed to Step 1.

**Review-only mode:** The user wants you to *evaluate* one or more
*existing* `person_evidence` entries — checking whether the confidence
is calibrated appropriately, whether the rationale is sound, whether
the link should still stand given the current evidence. Triggers
include: "is the confidence on pe_NNN appropriate?",
"review/confirm this identity link", "is pe_NNN still warranted?",
"audit pe_NNN", "audit the person_evidence entries". In this mode:

- Read the named `pe_` entry (or the entries the user pointed to),
  its assertion(s), its person(s), and the immediate corroborating
  context (other pe entries for the same assertion or person; the
  source the assertion came from).
- Apply the same evaluation criteria you would use during linking:
  match threshold policy, rationale quality, multi-attribute
  corroboration. Look for daylight between the recorded confidence
  and what the evidence actually supports.
- **Produce a written analysis only.** Do NOT write to `research.json`
  or `tree.gedcomx.json`. Do NOT create new `pe_` entries. Do NOT
  modify the entry under review (not its `confidence`, not its
  `rationale`, not any other field). No writes are made in this mode,
  so no persistence call is needed.
- If the review **confirms** the existing entry: state that, citing
  the specific attributes that support the recorded confidence.
- If the review **surfaces a concern** (calibration off, rationale
  thin, link should be superseded, etc.): describe the concern and
  the corrective action you'd recommend, then **stop and ask the user
  to authorize the action** before doing it. Don't expand scope from a
  review request into a write.

The two modes are mutually exclusive for a single invocation. If a
review legitimately reveals that *new* linking work is needed — a
missing other-side link, an unlinked assertion the user wasn't asking
about — close the review by noting the observation, then ask the user
whether they want to do that linking work next. Don't roll it into
the same response.

### 1. Identify unlinked assertions

Find the assertions that have no corresponding `person_evidence` entry
(or whose existing links need revision). If record-extraction just ran
in this same continuous run and you already hold the new `a_` ids and the
current `person_evidence` set in context, work from that — don't re-read
`research.json` "to be safe"; the writer tools validate the whole project
on every write, so the in-context view can't be silently stale. Re-read
`research.json` when you're entering this skill cold, or when a sub-skill
or the user changed assertions/links since you last saw them.

An assertion is "unlinked" if no `pe_` entry references its `a_` ID.
Group unlinked assertions by `record_id` + `record_role` — all
assertions from the same persona should be linked together.

### 2. Identify candidate persons

For each unlinked persona (record_id + record_role group), determine
which GedcomX person(s) it might be:

**Check tree.gedcomx.json persons:**
- Name match (exact, phonetic variant, abbreviation)
- Age/birth year compatibility (±5 years)
- Location compatibility (same county/state)
- Gender match
- Relationship fit (is this persona in the right position relative
  to known family members?)

**Assess match strength.** Weigh the data points above by reasoning
directly — correlation analysis is the spine of every identity
decision. A match is *strong* when name, age, place, and relationship
fit all agree; *moderate* when the core identifiers agree but some are
missing or only approximate; *weak* when only the name matches or a
core identifier conflicts. Make the assessment auditable with the
correlation techniques above (side-by-side chart,
agreement/disagreement list).

**Score the match with `same_person`** when the assertion is
`record_search`-sourced — i.e. it has a non-null `record_persona_id`.
The tool returns a name + date + place similarity score (0.0–1.0) that
*informs* the correlation analysis; it never replaces it (see step 3).
For each serious candidate tree person:

1. **Resolve the record.** The assertion carries `log_entry_id`,
   `record_id`, and `record_persona_id`. Open the log entry's sidecar
   (`results/<log_id>.json`, from the log entry's `results_ref`) and
   find the `RecordSearchResult` in `payload.results` whose `recordId`
   (the canonical ARK) matches `record_id`. That result's `gedcomx` is
   `gedcomx1`; the assertion's `record_persona_id` is `primaryId1`.
2. **Build the tree side (the matching mob).** Construct a *subset*
   simplified-GedcomX of `tree.gedcomx.json` containing the candidate
   person plus its **matching mob** — focus + parents + spouses +
   children + **siblings** — and the relationships connecting them.
   **Not** the whole tree: `same_person` expects a record-sized
   document; passing a months-long project's full tree may be slow or
   rejected. That subset is `gedcomx2`; the candidate's tree id is
   `primaryId2`.
   - **Siblings** = children of any of the candidate's parents, minus
     the candidate itself. Gather them by walking `tree.gedcomx.json`:
     find the candidate's parents (ParentChild rels where `child` is the
     candidate), then the children of those parents. The simplified
     format can't always tell half- from full-siblings, so include all
     children of all parents — the match algorithm tolerates this.
   - **Cap the mob at 40 people** (mirrors the FS
     `MAX_CHILDREN_TO_COMPARE` limit) so a very large family doesn't
     bloat the `same_person` payload. If a family exceeds 40, keep the
     closest relatives (focus, parents, spouses) and trim the children/
     siblings to stay under the cap.
   - **Mirror the same membership on the record side** (`gedcomx1`) when
     the record carries it — the record persona plus its co-enumerated
     household — so both sides of `same_person` compare like-for-like
     relatives. Pass the record's relatives through verbatim; don't
     hand-build them.
3. **Call** `same_person({ gedcomx1, primaryId1, gedcomx2, primaryId2 })`.
   For the focus match the tool is a pass-through — it forwards whatever
   persons and relationships you include and the FS algorithm uses the
   relatives; assembling the mob is this skill's job, not a tool change.
4. **For a household record, pair the relatives in one shot.** When the
   record is a household (multiple co-enumerated personas — head + spouse
   + children), after the focus call above, call
   `same_person({ gedcomx1, primaryId1, gedcomx2, primaryId2, matchRelatives: true })`
   **once**. Instead of re-deriving each child/spouse/parent pairing by
   hand, this returns a `matches` array of `{ role, targetId, candidateId,
   score, confidence?, preScore }` triples — the FS-scored pairing of the
   record's relatives to the tree person's relatives, computed with local
   name/date heuristics so only plausible pairs cost an API call.
   `targetId` is a `persons[].id` on the record side (`gedcomx1`),
   `candidateId` on the tree side (`gedcomx2`). This is **optional** —
   only reach for `matchRelatives: true` when there's a household to pair;
   a single-person match needs only the focus call (the default
   `matchRelatives: false`). Feed each relative `score`/`confidence` into
   the threshold policy (step 3) exactly as you do the focus score, and
   carry the `matches` into the cross-person consistency check (step 7).

Match scoring works **only** for `record_search`-sourced assertions.
FTS-, image-, and PDF-sourced assertions have a null
`record_persona_id`, and a search that predates result retention has
`results_ref: null` — in all those cases no score is available and
correlation analysis stands alone.

### 3. Apply the match threshold policy

**This policy is non-negotiable.** Identity resolution is the
highest-risk step in the system — a false-positive merge costs years of
wasted research.

**Correlation analysis sets the confidence.** The match-strength
assessment from step 2 — name, dates, places, relationship fit,
household composition, and the independence of the evidence —
determines the allowed confidence:

| Match strength | Allowed confidence | Action |
|------------|-------------------|--------|
| **Weak** — only the name matches, or a core identifier conflicts. **Not Weak: a strong household relationship-fit** — a member positioned under known parents or beside a known spouse — even when the persona is a fact-less stub (see the note below the table). | `speculative` only | **Pause for user confirmation.** Present the evidence and ask: "This is a weak match. The name/age/place similarities are [details]. Do you want to create a speculative link, or is this a different person?" Never auto-link. |
| **Moderate** — core identifiers agree but some are missing or only approximate | `probable` | Present the evidence to the user before linking. Explain what matches and what doesn't. Create the link with `probable` confidence if the user agrees. |
| **Strong** — name, age, place, and relationship fit all agree | `confident` | May create the link without explicit user confirmation, but still present the rationale. |
| **Obvious** — same record already linked for another role, or the person was found by searching for this specific individual | `confident` or `probable`, based on reasoning | No separate analysis needed. State the rationale clearly. |

**Stub match on relationship-fit alone (household enrichment).** A
fact-less stub is still matchable — by its name, gender, and parent-child
edge — and a **strong relationship-fit is the strongest household
signal.** When a persona sits in the right position under known parents
(or beside a known spouse), that fit is a **sufficient** stub match on
its own: treat it as **Moderate** (link at `probable`) and materialize
the facts onto the stub. Do **not** down-rate it to Weak purely because
the stub lacks vitals — you match *to add* facts, so demanding vitals
first would deadlock enrichment (you'd need the facts to confirm the
identity that would let you add them).

**The `same_person` score is an input, never a substitute.**
When a score is available it *modulates* confidence within what
correlation supports — a high score can firm up a Moderate match; a low
score should pull a tentative Strong back to Moderate. But:

- A **qualitative conflict caps confidence regardless of score.** A
  0.85 score paired with a contradicting birthplace, an impossible age,
  or a relationship that cannot hold does **not** authorize a link —
  the conflict caps it at `speculative` and a pause for the user. A
  high score never auto-links past a conflict.
- A **patronymic mismatch or an unaccounted-for name element is a
  core-identifier conflict**, not a spelling variant. In patronymic
  cultures a differing patronymic names a *different father*; a name
  element with no source (an extra middle initial, an added byname)
  stays unexplained until a record accounts for it. Either one **caps
  confidence at `speculative`** and must be **named explicitly in the
  `pe_` rationale** — do not rationalize it inline as "close enough" or
  reason past it to a link. Refuse the confident link and surface the
  mismatch; adjudicating a hard patronymic conflict is
  conflict-resolution's job, not something to smooth over in the match.
- When **no score is available** (FTS-, image-, PDF-sourced
  assertions, or a search with no sidecar), correlation analysis stands
  alone — the table above applies unchanged.

For reference, `same_person` scores broadly track the strength
tiers — `>0.7` strong, `0.4–0.7` moderate, `<0.4` weak, the same bands
search-records uses for triage. Treat that as corroboration of the
correlation assessment, not a replacement for it.

**Never auto-merge persons.** person-evidence creates LINKS (pe_
entries), not merges. If two GedcomX persons are determined to be
the same individual, that's a conclusion for proof-conclusion to
reach and tree-edit to execute.

### 4. Create person_evidence entries

Persist all assertion → person links in ONE batched `research_append({
ops: [...] })` call — one `append` op per assertion-person pair (still one
`pe_` entry per pair; batching changes the call count, not the links).
Omit each entry's `id`, `created`, and `superseded_by`: the tool assigns
the ids and validates the whole batch, writing NOTHING on a per-op failure
(`{ ok: false, errors: ["ops[i]: <msg>"] }`) — fix the offending op rather
than retrying blindly.

**Field guidance:**

- `assertion_id`: The `a_` ID of the assertion being linked
- `person_id`: The GedcomX person ID in tree.gedcomx.json
- `confidence`: `confident`, `probable`, or `speculative` — governed
  by the match threshold policy (Step 3)
- `rationale`: WHY this assertion's record_role is believed to be
  this person. Must include the specific evidence that supports the
  identification: name match, age compatibility, location match,
  household composition, relationship fit. This is the audit trail
  for identity resolution.
- `match_score`: The `same_person` `score` (0.0–1.0) when the
  assertion was `record_search`-sourced and scored; null for FTS-,
  image-, and PDF-sourced assertions, searches with no sidecar, and any
  link where no score was obtained (an input to Step 3, not the verdict).

### 5. Handle new persons (stub creation)

When an assertion's persona doesn't match any existing GedcomX person,
**materialize the persona onto a new person** via `materialize_facts`'s
create-or-enrich path — do **not** hand-build a name-only stub with
`tree_edit add_person`. Call `materialize_facts({ personId, recordId,
recordRole })` with a `personId` that doesn't yet exist (or omit it): the
tool mints the person from the persona's name/gender assertions **and
writes its assertions as sourced facts/names in the same validated
call**, so the new person arrives WITH its facts, never as a name-only
shell that a later step fills in. The tool allocates the synthetic
`I`/`N` ids, resolves and attaches each fact's source-ref, and never sets
`primary`/`preferred` (concluding the preferred value stays
proof-conclusion's job). **Never use FamilySearch IDs for a new person** —
those belong to persons already in the tree.

**Stub person rules:**
- Then create the `pe_` entry (Step 4) linking the assertion to the
  new person, using the `personId` that `materialize_facts` returned in
  its compact summary
- **Confidence:** a stub rests on the single record that introduced the
  person, with no independent corroboration yet, so its `pe_` link is
  `probable` at most — `speculative` when the persona is only
  circumstantially named. Do not use `confident` for a brand-new stub;
  reserve it for after other records corroborate the person.

**When to create a stub vs. skip:**
- Create a stub for persons who are likely relevant to the research
  (subject's family, associates, witnesses on key documents)
- Don't create stubs for every person in every record — a census
  page may list 50 households, but only the subject's household and
  immediate neighbors warrant person entries

### 6. Handle link revisions

When new evidence shows an assertion was linked to the wrong person,
**never delete the old entry** — it is the audit trail. Instead:
**append** the corrected link (Step 4) to get its new `pe_` id, then
**update** the old entry's `superseded_by` to point at it via
`research_append({ op: "update", entryId, fields: { superseded_by } })`.

### 7. Systematic record linking

When processing a multi-person record (census household, probate
will naming heirs), link ALL relevant roles systematically:

**Census household example:**
1. head_of_household → Thomas Flynn (I2)
2. wife → Mary Flynn (I6, create stub if new)
3. child_1 → Patrick Flynn (I1)
4. child_2 → James Flynn (I5, create stub if new)

**Probate will example:**
1. testator → Thomas Flynn (I2)
2. heir_1 ("my son Patrick") → Patrick Flynn (I1)
3. heir_2 ("my daughter Margaret") → Margaret Flynn (I7, create stub)
4. witness_1 → may or may not warrant a person entry (FAN research)

For each role, evaluate the match independently. The testator may
be a `confident` match while an heir may be `speculative`.

**Cross-person consistency check (household records).** After every
persona is *tentatively* paired, step back and check the pairing as a
**set**, not just persona-by-persona. A family can fail to cohere — e.g.
you matched the census of John to John's tree *and* the census of John's
wife to a *different* woman from a different tree who is not John's wife.
Verify that a matched person's spouse/parent/child maps to the
counterpart's spouse/parent/child, and **flag** any pairing where they
don't.

When you ran `same_person` with `matchRelatives: true` for this
household (step 2.4), its `matches` array **is** this evidence: each
`{ role, targetId, candidateId, score }` triple is a household pair the
tool already scored, so read coherence off it directly instead of
re-reasoning each pair by hand. A focus-person relative that pairs to
nothing, or pairs only at a low `score`, is exactly the flag this check
looks for. (For a household where you couldn't run `matchRelatives` —
e.g. the record side carries no relatives — fall back to checking the
pairing by hand as above.)

In v1 this is a **confidence input, not a hard reject**: an incoherent
family assignment pulls the affected `pe_` link(s) down a tier (and
toward a user pause), the same way a qualitative conflict does — it does
not silently block the link. Note the inconsistency in the link
rationale so proof-conclusion sees it.

**person-evidence owns the household skeleton.** Building the household
structure — the member persons and the edges between them — is now this
skill's job, not record-extraction's (which emits assertions only).
person-evidence materializes the household **directly**; it no longer
hands a merge set to proof-conclusion to fold. For a household record:

1. **Tolerantly match the parents against the tree.** Find the
   head/spouse among existing tree persons by name + place +
   relationship position, allowing transcription and name variants. If
   **no household parent is in the tree**, surface that gap plainly and
   do **not** fabricate a parent to anchor the household on. The
   `matchRelatives` triples from step 2.4 give the persona→tree-person
   pairings; a new member (no tree match) pairs to a fresh id you mint in
   step 3.
2. **Dry-run `merge_warnings` as the coherence gate — before any write.**
   On the **pre-materialization** household set (the matched tree persons
   plus the record personas you are about to pair), dry-run
   `merge_warnings` and apply its tiers **before** materializing anything:
   - **Error tier blocks.** A hard coherence failure (an event outside a
     lifespan, a relationship that cannot hold) stops the materialization —
     resolve it before writing.
   - **Warning tier is advisory.** A softer flag (e.g. a shared-census
     signal that doesn't fully cohere) does not block; note it in the
     affected `pe_` rationale and proceed.
3. **Materialize every member, per persona.** Only after the gate clears
   the error tier: for each persona — the subject *and* each
   sibling/spouse — call
   `materialize_facts({ personId, recordId, recordRole })` to write that
   persona's assertions as sourced facts/names onto its tree person, and
   create the `pe_` link (Step 4). For a persona **matched** to an
   existing tree person you already have the `personId`; for a **new**
   member, create-or-enrich mints it WITH its facts (never a name-only
   stub) — pass a not-yet-existing `personId`, or omit it and the tool
   allocates one, then link to the id it returns.
4. **Write the edges.** Write the parent-child and spouse-spouse
   relationships this record establishes via `tree_edit`
   `add_relationship`, each edge carrying a source-ref resolved from the
   relationship assertion's `source_id`. A pre-1880 census parent-child
   edge is *indirect* evidence (a headship/co-residence inference, not a
   stated relationship); it still carries a ref, at a **lower ref
   quality** reflecting the weaker evidence class.

Every household persona ends up **paired** — matched to an existing tree
person, or minted via create-or-enrich — with none left dangling.
Present the materialized household plainly.

### 8. Check warnings and present

The persistence tools validate before writing, so no separate
`validate_research_schema` pass is needed. After creating links and any
stub persons, invoke `check-warnings` on the affected persons to catch
genealogical impossibilities (married before 12, died after 120, child
born after a parent's death, etc.) — plausibility the persistence step
does not check. Surface any warnings to the user.

Present the results:
- Each link created, with the assertion, the person, and the
  confidence level
- Any new stub persons created
- Any links where user confirmation was required (weak matches)
- Suggest next steps:
  - "Would you like me to build a timeline for [person]?" (timeline)
  - "There are unlinked assertions remaining — shall I continue?"
  - "These assertions may reveal a conflict — shall I check?"
    (conflict-resolution)

## Example: Linking probate record assertions

**Context:** Thomas Flynn's 1881 will names "my son Patrick Flynn"
and "my daughter Margaret Flynn." Three assertions were extracted by
record-extraction:

- a_020: testator name "Thomas Flynn" (record_role: testator)
- a_021: bequest naming "my son Patrick" (record_role: heir_1)
- a_022: bequest naming "my daughter Margaret" (record_role: heir_2)

**Linking:**

| Assertion | Person | Confidence | Rationale |
|-----------|--------|-----------|-----------|
| a_020 → I2 | Thomas Flynn | confident | Same name, same county, death date matches — strong match on all identifiers. |
| a_021 → I1 | Patrick Flynn | confident | Will explicitly names "my son Patrick." Patrick is known to reside in same county. |
| a_022 → I7 (new stub) | Margaret Flynn | probable | New person — no Margaret Flynn in tree. Created stub with gender Female. Will context ("my daughter") establishes relationship. |

**Person evidence entries created:** pe_007, pe_008, pe_009
**New stub person created:** I7 (Margaret Flynn)

## Differentiating Multiple Individuals with the Same Name

When multiple candidates share the same name in the same area:

1. **Build a profile** for each known individual (load
   `references/person-profiles.md`)
2. **Create a side-by-side chart** comparing distinguishing data
   (spouse, children, occupation, specific residence, age, birthplace,
   associates)
3. **Assign each new record** to the correct profile based on which
   data points match
4. **Flag ambiguous records** — mark as `speculative` and present
   evidence to the user when a record matches multiple profiles or
   none clearly
5. If candidates need chronological testing, hand off to **timeline**
   or **hypothesis-tracking**

## Edge cases and decision rules

- **Uncertain dates (no birth year):** Widen the age-compatibility
  window. Use occupational and life-stage cues instead (e.g., "listed
  as head of household suggests adult"). Mark confidence no higher
  than `probable` without age corroboration.
- **Name variants across languages:** Treat Johannes/John/Johann,
  Marguerite/Margaret, etc. as potential matches. Note the variant
  mapping in the rationale.
- **Multiple records, same repository session:** When a single search
  returns multiple records about the same person, link them in one
  batch but evaluate each independently. Do not let one record's
  strong match inflate confidence for a weaker one.
- **Person already linked by another assertion:** When a new assertion
  from a different record matches the same person, still evaluate it
  independently. Consistency across records strengthens the case, but
  each link needs its own rationale.
- **Degenerate `same_person` score on an unresolvable id:** When the tree
  candidate is a local stub, or a tree id `same_person` cannot resolve to a
  full FamilySearch ARK, the tool may return a near-zero score (e.g. `0.005`)
  that reflects the missing ARK, not a real mismatch. Treat that as **no
  score available** — fall back to qualitative correlation (Step 3), and do
  not let the degenerate number drop a match the identifiers otherwise
  support. Note in the rationale that the score was uninformative and why.

## Important rules

- **Never auto-merge.** Links are provisional. Merging is a
  conclusion (proof-conclusion) and a data operation (tree-edit).
- **Enforce the threshold policy.** Weak matches require user
  confirmation. No exceptions.
- **The match score is an input, not a verdict** — record it in
  `match_score` when one was obtained; the full rule is in Step 3.
- **Transcription variants do not downgrade strength.** When the
  qualitative correlation is strong — age, year, place, household
  composition, and relationships all agree — a low
  `same_person` score caused by a surname variant (Flynn/
  Flinn, Smith/Smyth, Mueller/Miller, etc.) does NOT make the match
  Weak. The strength tier is set by the qualitative correlation
  chart in Step 2; the score modulates within that tier but cannot
  by itself drop a match below what the non-name identifiers
  support. Reclassify as Moderate or Strong, create the link, and
  document the variant explanation in `rationale`.
- **One pe_ entry per assertion-person pair.** Don't create duplicate
  links for the same assertion-person combination.
- **Rationale is mandatory.** Every link must explain WHY. "Name
  matches" is insufficient — include age, place, household context,
  relationship fit.
- **Relationship assertions link to multiple persons — but "link" means
  the `pe_` entries, not a tree relationship.** Create a `pe_` link for
  each party a relationship assertion names (a marriage record → one `pe_`
  for each spouse; a will naming an heir → one for the testator and one for
  the heir). Do **not** create the `Couple`/`ParentChild` relationship
  itself, and do **not** write the couple-event fact (Marriage, Divorce)
  here — person-evidence owns stub `persons` and `pe_` links only. The
  relationship and its facts are written later by proof-conclusion →
  tree-edit, which own the `relationships` section (see also "proof-conclusion
  populates them later" under stub creation).

## Re-invocation behavior

**Writes** `person_evidence` entries (`pe_` links plus their `confidence`,
`rationale`, `superseded_by`) in `research.json`, and stub `persons` in
`tree.gedcomx.json`. **On re-invocation,** refine `confidence`/`rationale`
in place or mark an entry `superseded_by` a correction — never delete, and
never add a second `pe_` for an assertion-person pair already linked.
