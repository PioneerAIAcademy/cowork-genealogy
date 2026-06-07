---
name: person-evidence
model: claude-sonnet-4-6
description: Links assertions to GedcomX persons — the identity-resolution
  step. Evaluates whether the person in role X of record Y is the same as
  GedcomX person Z. Creates person_evidence entries with confidence and
  rationale, enforces match threshold policy, and creates stub persons when
  no existing person matches. Also reviews and audits existing
  person_evidence entries — confirming confidence calibration on a link, or
  checking whether other roles in a record need their own person_evidence.
  GPS Step 3 — Analysis and Correlation (identity resolution). Use when
  the user says "is this the same person?", "link this to [person]", "who
  is this?", "this record mentions multiple people", "link all roles in
  this record", "match this person", "review/confirm this identity link",
  "is the confidence on pe_NNN appropriate?", "should this assertion also
  link to [other person]", "audit the person_evidence entries", after
  assertions are extracted and need person assignment, or when the user
  wants to evaluate whether two records refer to the same individual. Do
  NOT use when the user wants to search for records (use search-records),
  wants to extract assertions from a record (use record-extraction), wants
  to resolve a genuine identity conflict where multiple candidate persons
  compete (use conflict-resolution), or wants to merge two
  confirmed-identical persons (use tree-edit after proof-conclusion).
allowed-tools:
  - validate_research_schema
  - same_person
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
  `rationale`, not any other field). Do NOT call
  `validate_research_schema` — no writes were made.
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

Read `research.json` and find assertions that have no corresponding
`person_evidence` entry (or whose existing links need revision).

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
2. **Build the tree side.** Construct a *subset* simplified-GedcomX of
   `tree.gedcomx.json` containing only the candidate person plus
   immediate family (parents, spouse, children) and the relationships
   connecting them — **not** the whole tree. `same_person`
   expects a record-sized document; passing a months-long project's
   full tree may be slow or rejected. That subset is `gedcomx2`; the
   candidate's tree id is `primaryId2`.
3. **Call** `same_person({ gedcomx1, primaryId1, gedcomx2, primaryId2 })`.

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
| **Weak** — only the name matches, or a core identifier conflicts | `speculative` only | **Pause for user confirmation.** Present the evidence and ask: "This is a weak match. The name/age/place similarities are [details]. Do you want to create a speculative link, or is this a different person?" Never auto-link. |
| **Moderate** — core identifiers agree but some are missing or only approximate | `probable` | Present the evidence to the user before linking. Explain what matches and what doesn't. Create the link with `probable` confidence if the user agrees. |
| **Strong** — name, age, place, and relationship fit all agree | `confident` | May create the link without explicit user confirmation, but still present the rationale. |
| **Obvious** — same record already linked for another role, or the person was found by searching for this specific individual | `confident` or `probable`, based on reasoning | No separate analysis needed. State the rationale clearly. |

**The `same_person` score is an input, never a substitute.**
When a score is available it *modulates* confidence within what
correlation supports — a high score can firm up a Moderate match; a low
score should pull a tentative Strong back to Moderate. But:

- A **qualitative conflict caps confidence regardless of score.** A
  0.85 score paired with a contradicting birthplace, an impossible age,
  or a relationship that cannot hold does **not** authorize a link —
  the conflict caps it at `speculative` and a pause for the user. A
  high score never auto-links past a conflict.
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

For each assertion → person link:

```json
{
  "id": "pe_007",
  "assertion_id": "a_015",
  "person_id": "KWCJ-RN4",
  "confidence": "probable",
  "rationale": "Thomas Flynn, will dated 1881, Schuylkill County. Names match. Location matches (same county as census records). Death date consistent with disappearance from tax records after 1880. Will names 'my son Patrick' — this assertion links the testator role to the Thomas Flynn (I2) in the tree.",
  "match_score": 0.64,
  "created": "2026-05-04",
  "superseded_by": null
}
```

**Field guidance:**

- `assertion_id`: The `a_` ID of the assertion being linked
- `person_id`: The GedcomX person ID in tree.gedcomx.json
- `confidence`: `confident`, `probable`, or `speculative` — governed
  by the match threshold policy
- `rationale`: WHY this assertion's record_role is believed to be
  this person. Must include the specific evidence that supports the
  identification: name match, age compatibility, location match,
  household composition, relationship fit. This is the audit trail
  for identity resolution.
- `match_score`: The `same_person` `score` (0.0–1.0) when the
  assertion was `record_search`-sourced and scored. Null for FTS-,
  image-, and PDF-sourced assertions, for searches with no sidecar, and
  for any link where no score was obtained. The score is an input to
  the confidence decision (step 3), not the decision itself.
- `superseded_by`: null for active links. Set to the new `pe_` ID
  when this link is revised.

### 5. Handle new persons (stub creation)

When an assertion's persona doesn't match any existing GedcomX
person, create a new **stub person** in tree.gedcomx.json:

```json
{
  "id": "I5",
  "gender": "Male",
  "names": [
    {
      "id": "N5",
      "preferred": true,
      "given": "James",
      "surname": "Flynn"
    }
  ]
}
```

**Stub person rules:**
- Use synthetic IDs (`I5`, `I6`, etc.) — not FamilySearch IDs (those
  belong to persons already in the tree)
- Minimum: `id`, `gender` (may be `Unknown`), one name with at
  least a `surname`. `given` may be empty string if unknown.
- `facts` may be omitted entirely — they'll be populated as
  proof-conclusion writes confirmed facts
- Add the person to `tree.gedcomx.json` `persons[]`
- Then create the `pe_` entry linking the assertion to the new person

**When to create a stub vs. skip:**
- Create a stub for persons who are likely relevant to the research
  (subject's family, associates, witnesses on key documents)
- Don't create stubs for every person in every record — a census
  page may list 50 households, but only the subject's household and
  immediate neighbors warrant person entries

### 6. Handle link revisions

When new evidence shows an assertion was linked to the wrong person:
1. Set `superseded_by` on the old `pe_` entry to the new entry's ID
2. Create a new `pe_` entry with the corrected `person_id`
3. Never delete the old entry — it's part of the audit trail

Example: You initially linked a_020 to I3 (speculative). New evidence
shows it's actually I7 (a different person with the same name).

```json
{
  "id": "pe_010",
  "assertion_id": "a_020",
  "person_id": "I3",
  "confidence": "speculative",
  "rationale": "Initial link based on name match only.",
  "match_score": null,
  "created": "2026-05-03",
  "superseded_by": "pe_015"
}
```

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

### 8. Validate and present

Call `validate_research_schema({ projectPath: "<absolute-path-to-project-directory>" })`
to verify both research.json and tree.gedcomx.json are valid. If validation
fails, fix the errors before presenting.

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

## Important rules

- **Never auto-merge.** Links are provisional. Merging is a
  conclusion (proof-conclusion) and a data operation (tree-edit).
- **Enforce the threshold policy.** Weak matches require user
  confirmation. No exceptions.
- **The match score is an input, not a verdict.** Record the
  `same_person` score in `match_score` when one was obtained;
  never let a high score override a qualitative conflict.
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
- **Relationship assertions link to multiple persons.** Always
  create links for both parties in a relationship assertion.

## Re-invocation behavior

**Writes:** entries in the `person_evidence` section of `research.json`
(`pev_` ids linking assertions to GedcomX persons), and their
`confidence`, `rationale`, and `superseded_by` fields. Mutable in
place; superseded by marking, never deleted.

**On repeat invocation:** revisits person-identity links. May refine
`confidence` or `rationale` on existing `pev_` entries as new
evidence becomes available, or mark old links `superseded_by` a
new corrected link.

**Do not duplicate:** if a `pev_` entry already links a given assertion to
a given GedcomX person id, update that entry in place rather than
adding a second link for the same pair.
