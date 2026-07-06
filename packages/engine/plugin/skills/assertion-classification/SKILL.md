---
name: assertion-classification
description: Refines GPS three-layer evidence classifications on assertions in research.json —
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
allowed-tools:
  - research_append
  - person_warnings
---

# Assertion Classification

**Narration:** Read `researcher_profile.narration_guidance` from `research.json` and apply it as your narration style for this invocation. If absent, default to a one-line preamble per action.

Refines the three-layer GPS evidence classifications on existing
assertions. record-extraction creates assertions with best-effort
classifications; this skill applies rigorous taxonomic reasoning to
upgrade or correct them.

Load `references/three-layer-model.md` for the full classification
framework, BCG standards, and special cases.

## Core Principles

The three layers (source, information, evidence) are INDEPENDENT.
An original source can contain secondary information. A derivative
source can provide direct evidence. Classify each layer on its own
terms. Never let one layer's classification influence another.

**This skill classifies Layer 2 (information quality) and Layer 3
(evidence type).** Layer 1 (source classification) is set by
record-extraction and is read-only here.

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

For each assertion, answer three questions:

**A. Who is the informant?** Not who created the record -- who
provided THIS specific fact. Indexers and transcribers are never
the informant; look through derivatives to the original provider.

**B. What is their proximity to the event?**

- `self` -- The informant IS the subject (testator naming heirs)
- `witness` -- Directly witnessed the event (physician at death)
- `household_member` -- Household member reporting family facts
- `family_not_present` -- Family member reporting events they did
  not witness (son-in-law reporting birth date on death cert)
- `official_duty` -- Official whose job produced the record but is
  not the informant for the specific fact
- `unknown` -- Cannot determine who provided this information

**C. Is there potential bias?** Document in `informant_bias_notes`:
- Motive to misreport (age fraud, hiding ethnicity, pension claims)
- Decades between event and reporting (memory degradation)
- Secondhand reporting (told by someone else)
- Cultural/social pressure on reporting
- Stress or duress at time of reporting

### 3. Classify information quality

Apply the two-question decision tree:

1. **Do we know the informant?**
   - NO --> **Indeterminate**
   - YES --> proceed to question 2

2. **Did the informant witness/participate/have first-hand knowledge?**
   - YES --> **Primary**
   - NO --> **Secondary**
   - CANNOT TELL --> **Indeterminate**

Key rules:
- **Primary does NOT mean accurate.** An eyewitness can lie or err.
  Classification is about proximity, not reliability.
- **A person cannot provide primary information about their own
  birth** (not cognitively aware). Their mother or the physician can.
- **A single source can contain BOTH primary and secondary
  information.** Classify each assertion independently.
- **Delayed birth certificates** filed decades later are secondary
  even though the source is original -- the information is recollection.
- **Pre-1940 census**: the enumerator did not record who answered, so
  the respondent is unknown and most facts — including the subject's own
  **age/birth year** — are **indeterminate**. Do NOT mark a subject's own
  age `secondary` on the reasoning that "a person can't witness their own
  birth": you don't know the subject was the respondent, so you can't say
  the informant lacked first-hand knowledge — `indeterminate` is the
  correct conservative value. Exception: a fact no household member could
  possibly have witnessed — e.g. a **parent's or grandparent's
  birthplace** — is **secondary** regardless of who answered (no one in
  the household saw that birth).

### 4. Classify evidence type

For each assertion, evaluate against the **open** research questions
in `research.json`. A question is "open" only when its `status` is
`open` or `in_progress`. A question whose `status` is `resolved` or
`exhaustive_declared` is **closed** and does NOT count as open here.

**If there are NO open research questions** (all `resolved` /
`exhaustive_declared`, or none exist), evidence type **cannot be
classified** — evidence only exists relative to an open question. Do
**not** assign or refine any `evidence_type`; stop the Layer-3 step. As
the **immediate** next step, recommend the user open or re-open a
question, phrased as a present-tense action ("Open a research question so
evidence types can be classified") — not a "next time" conditional, since
they may not know this is the unblocking step. You may still refine
Layer-2 (information quality / informant) fields, which don't depend on a
question.

`evidence_type` is a closed set of exactly three values: `direct` |
`indirect` | `negative` (source of truth
`docs/specs/research-schema-spec.md`). Decision rules:
- **Direct**: explicitly answers a question with no inference needed.
  A subject-identifying `name` assertion is **direct** for where/when
  questions about that subject — finding the subject in a dated, located
  record answers the question directly, even when the name's own `place`
  field is null (see the Hard rule below). Do not downgrade it to
  indirect.
- **Indirect**: implies an answer but requires inference or
  correlation with other facts. This does **not** cover a subject-id
  `name` assertion, whose correlation with its sibling assertions is how
  multi-fact records work — not an inference chain.
- **Negative**: meaningful absence of EXPECTED information. The record
  must be one where the fact SHOULD appear if true, and the absence
  must be meaningful given context.

**There is no `no_evidence` value.** "No evidence" describes a fact that
is irrelevant to every open question — it is **not** a fourth
`evidence_type`. Such a fact keeps its existing best-effort value (often
`indirect`); do not set `evidence_type: "no_evidence"` — the schema
rejects it and the write tool will refuse the entry.

> **Hard rule — do not break it.** If a subject's `name` assertion is
> already classified `evidence_type: direct` for a where/when question,
> **leave it `direct`.** Never rewrite a subject-identifying name
> assertion to `indirect`. A null/empty `place` on the name assertion is
> **expected** and is **not** grounds to downgrade — *even when the
> prompt invites that doubt* ("should this really be direct when the
> place field is empty?"). The answer to that question is "yes, it stays
> direct": the location lives on sibling residence/event assertions from
> the same record, and the name anchors the subject in it. A missing
> `place` on a name assertion is never, on its own, a reason to move it
> to `indirect`. (Example: a_001, "Patrick Flynn" on the 1850 census for
> "Where was Patrick in 1850?", stays `direct` — changing it to
> `indirect` is wrong.)

**Critical distinctions:**
- A nil search result is NOT negative evidence unless search was
  reasonably exhaustive
- Evidence type can change when new questions are added -- update
  `extracted_for_question_ids` accordingly

### 5. Flag evidence independence concerns (GPS Standard 4)

When two or more assertions share the SAME informant (even across
different sources), note this in the output. Related information items
from the same informant form a unit that gets no more credibility than
the strongest single item. Examples:
- Same son-in-law reported birth facts on both the death certificate
  and a pension affidavit -- these are ONE evidence unit for birth facts
- An Ancestry index and the census image it was indexed from are ONE
  source, not two

### 6. Update assertions

Write back any classification field that should change — even on an
assertion the user did not name, and even when the field the user asked
about is correct as-is. A question-shaped prompt ("should a_006's
evidence_type really be direct?") is not read-only just because the
answer is "leave it"; if the analysis surfaced a wrong `informant` or
`informant_bias_notes` on a sibling assertion, fix that too. Steps 6-7
run whenever any classification field changed, not only when the user
said "fix it."

For every classification field that changed, you MUST actually call
`research_append` to persist it — do not just describe the change in a
summary table or say "change made": an unexecuted update leaves
`research.json` unchanged and fails the task. Make it ONE batched call:
pass an `ops` array with one `update` op per assertion (never `append` —
this skill only refines existing assertions, it never creates them). Each
assertion is still its own op; batching changes only the number of
*calls*, not the data. The whole batch validates once and writes once; on
any per-op failure it returns `{ ok: false, errors: ["ops[i]: <msg>"] }`
and writes NOTHING — surface the errors and fix the offending op:

```
research_append({
  projectPath: "<absolute-path-to-project-directory>",
  ops: [
    {
      section: "assertions",
      op: "update",
      entryId: "<assertion id, e.g. a_012>",
      fields: {
        information_quality: "...",   // primary | secondary | indeterminate (closed set)
        informant: "...",             // if the analysis identifies a more specific informant
        informant_proximity: "...",   // self | witness | household_member | family_not_present | official_duty | unknown (closed set)
        informant_bias_notes: "...",  // add bias analysis if relevant
        evidence_type: "...",         // direct | indirect | negative (closed set — there is no no_evidence)
        extracted_for_question_ids: [ ... ]  // add any newly relevant question IDs
      }
    }
    /* …one update op per assertion whose classification changed… */
  ]
})
```

Pass only the classification fields that actually changed; the immutable
extraction fields (set by record-extraction) are not yours to pass, and
the tool rejects any attempt to mutate them. The tool validates every op
in the batch before persisting and writes nothing on `{ ok: false,
errors }` — surface those rather than retrying blindly.

### 7. Check warnings

After writing the refined classifications, invoke `check-warnings` on the
affected persons to catch genealogical impossibilities (married before 12,
died after 120, child born after a parent's death, etc.). This checks
plausibility, which the persistence step does not. Surface any warnings to
the user.

### 8. Present results

Show the user:
- Each assertion with its refined classification
- The reasoning for each classification (informant analysis,
  proximity, bias)
- Any assertions where the classification changed from
  record-extraction's initial value and why
- Any evidence independence concerns flagged in step 5
- Suggest next steps: citation (if citations need refining) or
  person-evidence (if assertions need linking to persons)

## Example: Death certificate (same source, different classifications)

**a_011** -- Death date: "Died 12 March 1908"
- Informant: Attending physician. Proximity: `witness`.
- Known? YES. First-hand? YES. --> **primary**
- Evidence type: `direct`

**a_012** -- Birth facts: "Born 1845, Pennsylvania"
- Informant: James Brown (son-in-law). Proximity: `family_not_present`.
- Known? YES. First-hand? NO. --> **secondary**
- Bias: "Son-in-law reporting 63 years after event. Census records
  say Ireland -- informant may not have known true birthplace."
- Evidence type: `direct` (explicitly states birthplace, even though
  it conflicts with other sources -- direct does not mean correct)

**a_013** -- Parentage: "Father: Thomas Flynn"
- Same informant (son-in-law). --> **secondary**
- Evidence type: `direct`

**Takeaway:** Same original source, three assertions, two different
information classifications. Classify per-assertion, never per-source.

## Example: Pre-1940 Census (indeterminate vs. forced secondary)

**a_022** -- Age: "35"
- Informant: Unknown (pre-1940). --> **indeterminate**

**a_023** -- Father's birthplace: "Ireland"
- Informant: Unknown. BUT: no one in the household could have
  witnessed the father's birth. Even if we knew the respondent, it
  would be secondary. --> **secondary**

**Takeaway:** When NO possible respondent could have first-hand
knowledge, classify as secondary regardless of informant identity.

## Re-invocation behavior

**Writes:** only the classification fields on existing `assertions` entries
in `research.json` (`information_quality`, `informant`,
`informant_proximity`, `informant_bias_notes`, `evidence_type`,
`extracted_for_question_ids`), via `research_append` with `op: "update"`.

**On repeat invocation:** re-evaluates the same assertions and refines their
classification fields in place by assertion `id`. Idempotent when the
source/extraction story is unchanged. **Never** creates a new assertion or
duplicates one for the same fact — creating assertions is record-extraction's
job; if an existing classification is wrong, update it in place.
