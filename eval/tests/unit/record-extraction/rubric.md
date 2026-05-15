# Record Extraction Rubric

Grading dimensions for record-extraction unit tests. Evaluated by the LLM judge alongside the base rubric (correctness, completeness).

## Assertion atomicity

Is each assertion a single extractable fact, not a compound claim? "Patrick Flynn, age 5, born Ireland" should produce separate assertions for name, age/birth, and birthplace.

- **pass:** Every assertion is one fact; compound information from the source is decomposed into separate `a_` entries with their own `fact_type`.
- **partial:** Most assertions are atomic but one or two are compound (e.g., a single assertion with `fact_type: birth` containing both date and place in `value`, when a separate residence assertion would be cleaner).
- **fail:** Assertions are systematically compound; multiple facts crammed into one `value` field; downstream skills can't query individual facts.

## Informant identification

Did the skill identify the actual informant (not just "census") and assess their proximity to the event? The census enumerator is the recorder — the household member who provided the information is the informant.

- **pass:** `informant` field names a specific informant (or "unknown household member" with reasoning) and `informant_proximity` distinguishes the recorder from the actual reporter.
- **partial:** Informant is identified but proximity is generic — using `unknown` when the assertion type (e.g., age, birthplace) implies a household member must have reported it.
- **fail:** Informant is the recorder (census enumerator listed as informant for birth/age facts), or informant is blank when the source has enough context to identify it.

## Evidence type accuracy

Were direct, indirect, and negative evidence types assigned correctly? A relationship stated in the 1860 census (explicit column) is direct evidence. A relationship inferred from household position in 1850 (no relationship column) is indirect.

- **pass:** `evidence_type` matches the source's actual content: direct when the fact is explicitly stated; indirect when inferred from context; negative when the absence is the finding (with `record_role: "absent"`).
- **partial:** Most evidence types are correct but one is off — e.g., a 1850 census co-residence labeled direct when the relationship isn't stated.
- **fail:** Evidence types are mis-assigned across multiple assertions; the genealogist couldn't trust the classifications for downstream conflict resolution.
