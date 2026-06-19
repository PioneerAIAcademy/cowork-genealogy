# Assertion Classification Rubric

Grading dimensions for assertion-classification unit tests. Evaluated by
the LLM judge alongside the base rubric (Correctness, Completeness, Tool
Arguments).

assertion-classification is GPS Step 3 (Analysis and Correlation). It
refines the three-layer evidence classification on assertions that
**already exist** in `research.json` — Layer 2 (information quality, with
informant proximity + bias) and Layer 3 (evidence type, evaluated
against the active research questions). Layer 1 (source classification)
is set upstream and is read-only here. These dimensions grade how well it
does that; they do not re-grade the schema validator (that is the tool's
own test suite).

## Three-layer accuracy

Did the skill apply the GPS layers correctly and keep them **independent**
— never letting one layer's value pull another (an original source can
still carry secondary information; a derivative can give direct evidence)?
Layer 2 values are `primary` / `secondary` / `indeterminate`; Layer 3
values are `direct` / `indirect` / `negative`.

- **N/A:** The prompt should route to a different skill (negative tests) —
  there is no classification to grade; score `null`.
- **pass:** Layer 2 and Layer 3 match the informant/question facts as a
  knowledgeable genealogist would classify them, and Layer 1 is left
  untouched. Direct vs indirect is judged against the cited question
  (e.g. household composition implying a relationship = `indirect`; the
  subject's own name anchoring them in a dated/located record = `direct`
  even when the name assertion's `place` is null).
- **partial:** Layers populated but one value is debatable though
  defensible — an `indeterminate` informant nudged to `primary`, or an
  inference labeled `direct` — OR a layer was allowed to pull another but
  the final values happen to land right.
- **fail:** A value is clearly wrong (son-in-law's report of a birth
  labeled `primary`; a subject-identifying name downgraded to `indirect`
  because its place field is null; Layer 1 edited), or the three layers
  were conflated rather than classified independently.

## Informant analysis

Did the skill identify the actual **informant** (the person who supplied
*this specific fact*), distinguish them from the **recorder** (clerk,
enumerator, indexer), and code `informant_proximity` on the GPS scale
(self / witness / household_member / family_not_present / official_duty /
unknown)? Pre-1940 census special case: respondent is unknown so most
facts are `indeterminate`, **except** facts no household member could
witness (e.g. a grandparent's birthplace) which are forced to `secondary`.

- **N/A:** Negative/routing tests, or a test that exercises only Layer 3
  evidence-type and turns on no informant judgment; score `null`.
- **pass:** Informant is named or characterized specifically, kept
  distinct from the recorder, and proximity matches the scale. Where the
  honest answer is "we can't tell who answered" (e.g. a name on an 1850
  census), `unknown` / `indeterminate` is preserved rather than
  over-claimed.
- **partial:** Informant identified but proximity is mis-coded by one
  tier (`household_member` where `family_not_present` fits better), or the
  recorder-vs-informant line is partly blurred.
- **fail:** The recorder is named as the informant (census enumerator as
  the informant for birth facts), or a specific proximity is invented
  where the evidence supports only `unknown`.

## Evidence independence & scope guards

Did the skill respect the structural rules of GPS Step 3 that go beyond a
single assertion's value? Two: (a) **Evidence independence, Standard 46** —
two or more assertions sharing one informant (even across different
sources) are flagged as ONE evidence unit, given no more weight than the
strongest single item; (b) **scope guards** — when there are no open/active
research questions, evidence type cannot be classified and the skill says
so (suggesting question-selection) rather than inventing one.

- **N/A:** The test exercises neither a shared-informant cluster nor a
  no-open-questions state, and isn't a routing test; score `null`.
- **pass:** A shared informant across assertions is explicitly flagged as
  one evidence unit; OR, with no open questions, the skill declines to
  assign an evidence type and points the user to question-selection.
- **partial:** The shared informant is noticed but not framed as a single
  evidence unit (or the credibility-ceiling point is dropped); OR the
  no-questions case is hedged rather than a clear decline + handoff.
- **fail:** Two assertions from the same informant are counted as
  independent corroboration; OR an evidence type is invented against no
  open question.

## Invariant preservation

Did the skill stay in its lane — refine classification fields **in place**
on existing assertions, and never create assertions or alter the immutable
extraction fields (`value`, `structured_value`, `date`, `date_certainty`,
`place`, `fact_type`, `record_role`, `id`, `source_id`, `record_id`,
`log_entry_id`)? Creating assertions is record-extraction's job.

- **pass:** Only the five classification fields (`information_quality`,
  `informant`, `informant_proximity`, `informant_bias_notes`,
  `evidence_type`) are written; no new assertion is added and no immutable
  field is touched; `validate_research_schema` is called after writing.
- **partial:** Classifications are refined correctly but the validation
  call is skipped, or an immutable field is rewritten to an identical
  value (no data change, but out of lane).
- **fail:** A new assertion is created from the prompt's record data, or
  an immutable extraction field is changed, or a refinement is written
  that leaves research.json failing schema validation.

## Classification justification

Did the skill explain *why* each classification was chosen, citing the
specific source/informant facts (who supplied the fact, their proximity,
the time gap, any bias) rather than asserting a label with no reasoning?

- **N/A:** Negative/routing tests — no classification to justify; score
  `null`.
- **pass:** Each refined or preserved classification has a rationale that
  references concrete facts (e.g. "son-in-law, not present at a birth 63
  years earlier → secondary, family_not_present"). Bias is noted in
  `informant_bias_notes` where relevant.
- **partial:** Rationale exists but is generic ("primary because the
  informant was close") rather than citing the specific informant/source
  attributes, or it covers some assertions and not others.
- **fail:** No rationale given, or the rationale contradicts the chosen
  classification.
