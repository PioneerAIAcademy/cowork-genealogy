# Assertion Classification Rubric

Grading dimensions for assertion-classification unit tests. Evaluated by the LLM judge alongside the base rubric (correctness, completeness).

## Three-layer accuracy

Did the skill correctly apply all three GPS classification layers: source classification (original/derivative/authored), information quality (primary/secondary/indeterminate), and evidence type (direct/indirect/negative)?

- **pass:** All three layers are populated and values match the source/informant facts as a knowledgeable genealogist would classify them.
- **partial:** All three layers populated but at least one is debatable — an indeterminate informant marked primary, or an indirect inference labeled direct — though defensible.
- **fail:** A layer is missing, or values are clearly wrong (derivative index marked original; son-in-law's report of birth labeled primary).

## Informant analysis

Did the skill identify the actual informant and assess their proximity to the event? The recorder (e.g., census enumerator) is not the informant — the person who provided the information is.

- **pass:** Informant is named or characterized specifically, distinguished from the recorder, and `informant_proximity` matches the GPS proximity scale (self / witness / household_member / family_not_present / official_duty / unknown).
- **partial:** Informant is identified but proximity is mis-coded by one tier (household_member when family_not_present is more accurate), or recorder vs informant distinction is partially blurred.
- **fail:** Recorder is named as the informant (census enumerator as informant for birth facts), or proximity is left blank/unknown when evidence supports a specific value.

## Classification justification

Did the skill explain why each classification was chosen, citing specific characteristics of the source and informant? Classifications without reasoning are not useful.

- **pass:** Each classification has a rationale referencing specific facts (when the record was created, who provided the information, whether it's original or a copy).
- **partial:** Rationale exists but is generic ("primary because the informant was close") rather than citing specific source/informant attributes.
- **fail:** No rationale, or rationale contradicts the chosen classification.
