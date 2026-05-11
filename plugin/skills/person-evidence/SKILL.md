---
name: person-evidence
description: Links assertions to GedcomX persons — the identity-resolution
  step. Evaluates whether the person in role X of record Y is the same as
  GedcomX person Z. Creates person_evidence entries with confidence and
  rationale, enforces match threshold policy, and creates stub persons when
  no existing person matches. GPS Step 3 — Analysis and Correlation
  (identity resolution). Use when the user says "is this the same person?",
  "link this to [person]", "who is this?", "this record mentions multiple
  people", "link all roles in this record", "match this person", after
  assertions are extracted and need person assignment, or when the user
  wants to evaluate whether two records refer to the same individual. Do
  NOT use when the user wants to search for records (use search-records),
  wants to extract assertions from a record (use record-extraction), or
  wants to merge two confirmed-identical persons (use tree-edit after
  proof-conclusion).
---

# Person Evidence

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

**Use match_persons for quantitative scoring:**

```
match_persons({
  person1: {
    name: "Patrick Flynn",
    birthYear: 1845,
    birthPlace: "Ireland",
    residence: "Schuylkill County, Pennsylvania"
  },
  person2: {
    personId: "KWCJ-RN4"
  }
})
```

The tool returns a score (0.0–1.0) and feature breakdown.

### 3. Apply the match threshold policy

**This policy is non-negotiable.** The Match tool is the highest-risk
component in the system — a false-positive merge costs years of
wasted research.

| Match score | Allowed confidence | Action |
|------------|-------------------|--------|
| < 0.4 | `speculative` only | **Pause for user confirmation.** Present the evidence and ask: "This is a weak match (score: X). The name/age/place similarities are [details]. Do you want to create a speculative link, or is this a different person?" Never auto-link. |
| 0.4 – 0.7 | `probable` | Present the evidence to the user before linking. Explain what matches and what doesn't. Create the link with `probable` confidence if the user agrees. |
| > 0.7 | `confident` | May create the link without explicit user confirmation, but still present the rationale. |
| No score (match_persons not called) | Any, based on reasoning | When the match is obvious (same record already linked for another role, or the person was found by searching for this specific individual), the score may be omitted. State the rationale clearly. |

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
  "match_score": 0.85,
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
- `match_score`: The numerical score from `match_persons`, or null
  if the tool wasn't called. Always log the score when available.
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
  are for persons fetched from the tree via `tree_read`)
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
  "match_score": 0.35,
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

Invoke `validate-schema` after writing.

Present the results:
- Each link created, with the assertion, the person, and the
  confidence level
- Any new stub persons created
- Any links where user confirmation was required (low match scores)
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
| a_020 → I2 | Thomas Flynn | confident | Same name, same county, death date matches. match_score: 0.91 |
| a_021 → I1 | Patrick Flynn | confident | Will explicitly names "my son Patrick." Patrick is known to reside in same county. match_score: 0.88 |
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

- **match_persons unavailable or errors:** Fall back to manual
  reasoning. Use the "No score" row of the threshold policy. You
  MUST still write a detailed rationale and present it to the user.
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
- **Always log the match score.** When match_persons is called,
  record the score on every pe_ entry. This is the audit trail for
  identity decisions.
- **Enforce the threshold policy.** Low-score links require user
  confirmation. No exceptions.
- **One pe_ entry per assertion-person pair.** Don't create duplicate
  links for the same assertion-person combination.
- **Rationale is mandatory.** Every link must explain WHY. "Name
  matches" is insufficient — include age, place, household context,
  relationship fit.
- **Relationship assertions link to multiple persons.** Always
  create links for both parties in a relationship assertion.
