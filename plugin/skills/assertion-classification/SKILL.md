---
name: assertion-classification
description: Refines GPS three-layer evidence classifications on assertions —
  information quality (Primary/Secondary/Indeterminate) with informant
  analysis, and evidence type (Direct/Indirect/Negative). GPS Step 3 —
  Analysis and Correlation. Use when the user says "classify this evidence",
  "primary or secondary?", "what type of evidence is this?", "evaluate
  the informant", "analyze these assertions", after record-extraction
  produces assertions with best-effort classifications, or when the user
  questions an existing classification. Do NOT use when the user wants to
  extract assertions from a record (use record-extraction), wants to
  resolve conflicting evidence (use conflict-resolution), or wants to
  write a conclusion (use proof-conclusion).
---

# Assertion Classification

Refines the three-layer GPS evidence classifications on existing
assertions. record-extraction creates assertions with best-effort
classifications; this skill applies rigorous taxonomic reasoning to
upgrade or correct them.

## The Three-Layer Evidence Model

Every assertion must be classified on three independent axes:

### Layer 1: Source Classification (on the source, not the assertion)

Already set by record-extraction on the `src_` entry. This skill
reads but does not modify source classification.

- **Original:** First recording of an event (handwritten census page,
  death certificate, church register, original deed)
- **Derivative:** Copies, transcriptions, indexes, abstracts
  (Ancestry's index, published book of abstracts)
- **Authored:** Compiled works citing other sources (family histories,
  online trees, biographical sketches)

### Layer 2: Information Quality (on the assertion)

The `information_quality` field. Depends on the INFORMANT's
relationship to the event, not the source type.

- **Primary:** The informant was a direct witness or participant in
  the event
- **Secondary:** The informant was NOT a firsthand witness — reporting
  secondhand, from memory, or from hearsay
- **Indeterminate:** The informant's identity or relationship to the
  event cannot be determined

**Critical distinction:** A single source can contain BOTH primary
and secondary information. A death certificate is an original source
where:
- The death date (reported by attending physician) is **primary**
- The birth date (reported by a son-in-law decades later) is
  **secondary**

Never classify the entire source as "primary" — classify each
assertion independently.

### Layer 3: Evidence Type (on the assertion)

The `evidence_type` field. Depends on how the fact relates to the
research question.

- **Direct:** Explicitly answers a research question on its own.
  "Father: Thomas Flynn" on a death certificate is direct evidence
  of parentage.
- **Indirect:** Implies an answer but requires inference or
  correlation. A child listed in a household suggests parent-child
  relationship but doesn't state it.
- **Negative:** A meaningful absence of expected information. Patrick
  absent from the 1870 census where he should appear.

## Steps

### 1. Read the assertions

Read `research.json` and identify assertions needing classification
refinement. Focus on:
- Assertions with `indeterminate` information quality that might be
  upgradable with informant analysis
- Assertions where record-extraction's best-effort classification
  may be wrong
- Assertions the user specifically asks about

### 2. Analyze the informant for each assertion

For each assertion, determine:

**Who is the informant?** Not who created the record — who provided
THIS specific fact.

| Record type | Fact | Informant | Proximity |
|------------|------|-----------|-----------|
| Census (any year) | Name | Unknown household member | `unknown` (enumerator may have read a sign or heard from a neighbor) |
| Census (any year) | Age/birthplace | Household member (likely head or spouse) | `household_member` (these facts require active reporting) |
| Census (any year) | Residence | Census enumerator | `witness` (enumerator visited the dwelling) |
| Census (1850) | Relationship | No informant — inferred from position | `unknown` (1850 census has no relationship column) |
| Census (1860+) | Relationship | Household member who answered enumerator | `household_member` (1860+ census explicitly records relationships) |
| Death certificate | Death date/place/cause | Attending physician | `witness` |
| Death certificate | Birth date/place, parents | Family member informant (named on cert) | `family_not_present` (reporting facts they didn't witness) |
| Vital record (birth) | Birth facts | Physician or midwife | `witness` |
| Vital record (birth) | Parent names | Parent (usually mother) | `self` |
| Probate/will | Bequests, heirs named | Testator | `self` |
| Land deed | Grantee/grantor, property | Parties to the deed | `self` |
| Church register | Baptism/marriage | Clergyman | `witness` |
| Obituary | Death facts | Newspaper reporter (from family or funeral home) | `family_not_present` or `unknown` |
| Military pension | Service facts | Veteran | `self` |
| Military pension | Family details | Veteran or widow | `self` or `family_not_present` |

**What is their proximity to the event?**

- `self` — The informant IS the subject of the fact (testator naming
  heirs, mother reporting her own child's birth)
- `witness` — The informant directly witnessed the event (physician
  at death, enumerator visiting dwelling)
- `household_member` — A member of the household reporting facts
  about family members
- `family_not_present` — A family member reporting facts about events
  they didn't witness (son-in-law reporting birth date on death cert)
- `official_duty` — An official whose job produced the record but who
  is not the informant for the specific fact (county clerk recording
  a deed — the informant for the property facts is the grantor)
- `unknown` — Cannot determine who provided this information

**Is there potential bias?**

Document in `informant_bias_notes` when:
- The informant had a reason to misreport (age fraud for military
  enlistment, hiding ethnicity, pension eligibility)
- The informant is reporting events decades after they occurred
  (memory degradation)
- The informant is reporting secondhand (told by someone else)
- Cultural or social pressures may have influenced reporting
  (e.g., "Dutch" for "Deutsch/German" during WWI-era prejudice)

### 3. Classify information quality

Apply these rules in order:

1. **Primary** if the informant was present at or participated in
   the event AND the recording was contemporary (at or near the time):
   - Physician signing a death certificate → primary for death facts
   - Mother reporting at a birth registration → primary for birth facts
   - Census household member reporting own residence → primary for
     residence
   - 1860+ census household member reporting family relationships →
     primary (they're a witness to the relationship)

2. **Secondary** if the informant was NOT present at the event OR
   the recording was significantly delayed:
   - Son-in-law on death certificate → secondary for birth facts
   - Delayed birth certificate created 50 years after birth →
     secondary even if original source (the information is a "later
     recollection")
   - Obituary birth details → secondary (reporter got them from
     family)

3. **Indeterminate** if the informant cannot be identified:
   - Pre-1940 census records where the specific household respondent
     is unknown
   - Records with no named informant
   - Church registers where it's unclear if the clergyman or a family
     member provided the details

### 4. Classify evidence type

For each assertion, evaluate against the ACTIVE research questions
in `research.json`:

1. **Direct** if the fact explicitly answers a research question:
   - Question: "Who were Patrick's parents?"
   - Death certificate: "Father: Thomas Flynn" → **direct**

2. **Indirect** if the fact implies an answer but requires inference:
   - Question: "Who were Patrick's parents?"
   - 1850 census: Patrick listed in Thomas Flynn's household →
     **indirect** (household position suggests but doesn't state
     parentage)

3. **Negative** if the meaningful absence of expected information
   bears on the question:
   - Question: "Is Patrick the son of Thomas?"
   - Thomas's will names all children but omits Patrick → **negative**
     evidence against the hypothesis

**Important:** Evidence type can change when new questions are added.
An assertion classified as `indirect` for one question might be
`direct` for another. Classify against the most relevant open
question. Update `extracted_for_question_ids` to include any
questions the assertion bears on.

### 5. Update assertions

Write the refined classifications back to `research.json`. For each
assertion updated, change:
- `information_quality` — if the refined value differs from
  record-extraction's best-effort
- `informant` — if the analysis identifies a more specific informant
- `informant_proximity` — if the analysis changes the proximity
- `informant_bias_notes` — add bias analysis if relevant
- `evidence_type` — if the refined classification differs
- `extracted_for_question_ids` — add any newly relevant question IDs

Do NOT change: `id`, `source_id`, `record_id`, `record_role`,
`fact_type`, `value`, `structured_value`, `date`, `date_certainty`,
`place`, `log_entry_id`. These are set by record-extraction and are
immutable.

### 6. Validate

Invoke `validate-schema` after writing updates.

### 7. Present results

Show the user:
- Each assertion with its refined classification
- The reasoning for each classification (informant analysis,
  proximity, bias)
- Any assertions where the classification changed from
  record-extraction's initial value and why
- Suggest next steps: citation (if citations need refining) or
  person-evidence (if assertions need linking to persons)

## Example: Death certificate assertions

**a_011** — Death date: "Died 12 March 1908"
- Informant: Attending physician (signature on certificate)
- Proximity: `witness` (the physician was present at or shortly
  after death)
- Information quality: **`primary`** (direct witness)
- Evidence type: `direct` (explicitly states when he died)

**a_012** — Birth facts: "Born 1845, Pennsylvania"
- Informant: James Brown (son-in-law), named on the certificate
- Proximity: `family_not_present` (son-in-law was not present at
  Patrick's birth 63 years earlier)
- Information quality: **`secondary`** (reporting secondhand)
- Bias notes: "Son-in-law reporting birth facts decades after the
  event. Death cert says Pennsylvania, but census records say
  Ireland — son-in-law may not have known Patrick was born in
  Ireland."
- Evidence type: `direct` (explicitly states birthplace, even if
  the value conflicts with other sources)

**a_013** — Parentage: "Father: Thomas Flynn"
- Informant: James Brown (son-in-law)
- Proximity: `family_not_present`
- Information quality: **`secondary`** (reporting what he was told)
- Evidence type: `direct` (explicitly names the father)

Note: All three assertions come from the same original source (death
certificate) but have different information quality — primary for
death facts, secondary for birth/parentage facts. This is exactly
the distinction the GPS three-layer model is designed to capture.
