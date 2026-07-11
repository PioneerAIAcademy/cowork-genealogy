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

`informant_proximity` is a **closed enum**: `self | witness | household_member | family_not_present | official_duty | unknown`. Grade only against these values — do not require or reward values outside the set (there is no `researcher`, `analyst`, or `inferred_from_structure`). In particular, `unknown` is the **correct** value, not a partial, in these cases:

- **Negative evidence** (person absent): no record informant exists, so `informant_proximity: "unknown"` is correct. The researcher is named in the `informant` free-text field; proximity stays `unknown`.
- **Relationships inferred from household structure** (e.g., a pre-1880 census with no relationship column): no informant explicitly stated the relationship, so `unknown` (or an omitted proximity) is correct — do not penalize it for not naming a reporter.

`unknown` is only a *partial* when a specific reporter clearly exists and should have been named (e.g., age/birthplace facts that a household member must have supplied).

## Evidence type accuracy

Were direct, indirect, and negative evidence types assigned correctly? A relationship inferred from household position in the 1850 or 1860 census (no relationship column — explicit relationship columns were not introduced until 1880) is indirect evidence. A relationship stated in an 1880+ census (explicit column) is direct evidence.

- **pass:** `evidence_type` matches the source's actual content: direct when the fact is explicitly stated; indirect when inferred from context; negative when the absence is the finding (with `record_role: "absent"`).
- **partial:** Most evidence types are correct but one is off — e.g., a 1850 census co-residence labeled direct when the relationship isn't stated.
- **fail:** Evidence types are mis-assigned across multiple assertions; the genealogist couldn't trust the classifications for downstream conflict resolution.

Applying this correctly:

- **A stated age is `direct` evidence of age.** "Age 32" in a census column is an explicitly stated fact → `direct`. Only the *birth year computed from* that age (a separate `~1818` assertion) is `indirect`. Do not mark the `age` assertion itself indirect — that conflates the stated age with the birth-date inference derived from it.
- **An inferred birth *year* is fine when labeled `indirect`.** Deriving `~1845` from a stated age and marking it `indirect` is correct behavior, not a violation. What is disallowed is computing an exact birth *date* (a specific day/month) from age/death-date arithmetic. Do not penalize an approximate year as if it were a fabricated exact date.
- **A fact explicitly stated but reported by an informant who did not witness it is `indirect`.** On a derivative record (e.g., a death certificate), the birth date, birthplace, and parents' names the informant supplies about the deceased are secondhand — `indirect` even though stated. This is distinct from a census, where a household member reporting facts about their own household has primary knowledge → `direct`.
