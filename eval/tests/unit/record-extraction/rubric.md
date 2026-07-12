# Record Extraction Rubric

Grading dimensions for record-extraction unit tests. Evaluated by the LLM judge alongside the base rubric (correctness, completeness).

**Scoring calibration.** These dimensions are scored on the PERSISTED assertion/source fields — the tool-call arguments and final files — not on how the chat response narrates them. If the persisted fields are correct, the dimension scores 3, regardless of how tersely or verbosely the response describes them. A score of 2 requires the rationale to name a concrete wrong field value on a concrete assertion (e.g., "a_007 has `evidence_type: direct` for a birth year computed from age"). Narrative style, verbosity, and presentation are never grounds for a deduction in these dimensions. A deduction is never justified by calling a fixture-correct value "imprecise" or naming a hypothetically-better value — if the persisted value matches this rubric or the test's judge context, the dimension scores 3.

## Assertion atomicity

Is each assertion a single extractable fact, not a compound claim? "Patrick Flynn, age 5, born Ireland" should produce separate assertions for name, age/birth, and birthplace.

- **pass:** Every assertion is one fact; compound information from the source is decomposed into separate `a_` entries with their own `fact_type`.
- **partial:** Most assertions are atomic but one or two are compound (e.g., a single assertion whose `value` mixes two distinct facts — "age 5, born Ireland" — or mixes a fact with justification narrative).
- **fail:** Assertions are systematically compound; multiple facts crammed into one `value` field; downstream skills can't query individual facts.

**What is NOT compound:** a single event assertion carrying both its
`date` and `place` fields (e.g., one death assertion with the death date
and the death place) — the assertion schema holds both attributes of one
event by design. Atomicity separates distinct *facts* (age vs
birthplace), not attributes of one event. Do not penalize date+place on
one event assertion.

## Informant identification

Did the skill identify the actual informant (not just "census") and assess their proximity to the event? For facts a household member reported (name/age/birthplace/occupation), the census enumerator is the recorder — the household member who provided the information is the informant. This recorder-vs-informant split does NOT apply to residence, where the enumerator is a true witness (see the residence bullet below).

- **pass:** `informant` field names a specific informant (or "unknown household member" with reasoning) and `informant_proximity` distinguishes the recorder from the actual reporter.
- **partial:** Informant is identified but proximity is generic — using `unknown` when the assertion type (e.g., age, birthplace) implies a household member must have reported it.
- **fail:** Informant is the recorder (census enumerator listed as informant for birth/age facts), or informant is blank when the source has enough context to identify it.

- For Residence facts, `informant: "census enumerator"` with proximity `witness` is CORRECT — the enumerator personally observed the household at the dwelling. This has been graded both ways; enumerator/witness is the doctrine.

`informant_proximity` is a **closed enum**: `self | witness | household_member | family_not_present | researcher | official_duty | unknown`. Grade only against these values — do not require or reward values outside the set (there is no `analyst` or `inferred_from_structure`). `researcher` is the **correct** value, not a partial, whenever the asserted value is the researcher's own conclusion rather than something a record informant reported:

- **Negative evidence** (person absent): no record informant exists — `informant: "the researcher"` (or equivalent), `informant_proximity: "researcher"`. Naming a record party (e.g. the enumerator) as informant for an absence is a fail-level error.
- **Relationships inferred from household structure** (e.g., a pre-1880 census with no relationship column): nobody stated the relationship — informant "none — inferred from household position", proximity `researcher`.

`unknown` means a record informant exists but cannot be identified. It is a *partial* when a specific reporter clearly exists and should have been named (age/birthplace facts a household member must have supplied), and wrong where `researcher` applies (researcher conclusions).

**Death certificates — informant by fact (matches SKILL.md doctrine; grade against this, not intuition):**

- **Attending physician** is the informant for the death event itself — death date, place of death, cause, duration of illness — with proximity `official_duty` (the medical-certification side of the certificate is the physician's attestation).
- **The named personal informant** (spouse, family member) is the informant for the decedent's biographical facts — name, birth date/place, parents, occupation — with proximity `family_not_present` for events they did not witness.
- **The funeral director** is the informant for burial facts, proximity `official_duty`.

Do not score the skill down for attributing death date/place to the physician rather than the named personal informant — that attribution is the intended doctrine.

## Evidence type accuracy

Were direct, indirect, and negative evidence types assigned correctly? A relationship inferred from household position in the 1850 or 1860 census (no relationship column — explicit relationship columns were not introduced until 1880) is indirect evidence. A relationship stated in an 1880+ census (explicit column) is direct evidence.

- **pass:** `evidence_type` matches the source's actual content: direct when the fact is explicitly stated; indirect when inferred from context; negative when the absence is the finding (with `record_role: "absent"`).
- **partial:** Most evidence types are correct but one is off — e.g., a 1850 census co-residence labeled direct when the relationship isn't stated.
- **fail:** Evidence types are mis-assigned across multiple assertions; the genealogist couldn't trust the classifications for downstream conflict resolution.

Applying this correctly:

- **A stated age is `direct` evidence of age.** "Age 32" in a census column is an explicitly stated fact → `direct`. Only the *birth year computed from* that age (a separate `~1818` assertion) is `indirect`. Do not mark the `age` assertion itself indirect — that conflates the stated age with the birth-date inference derived from it.
- **An inferred birth *year* is fine when labeled `indirect`.** Deriving `~1845` from a stated age and marking it `indirect` is correct behavior, not a violation. What is disallowed is computing an exact birth *date* (a specific day/month) from age/death-date arithmetic. Do not penalize an approximate year as if it were a fabricated exact date.
- **A fact explicitly stated but reported by an informant who did not witness it is `indirect`.** On a derivative record (e.g., a death certificate), the birth date, birthplace, and parents' names the informant supplies about the deceased are secondhand — `indirect` even though stated. This is distinct from a census, where a household member reporting facts about their own household has primary knowledge → `direct`.
- **A stated residence is `direct`.** The census enumerator recorded the household at that dwelling; the residence column contains the value. Do not mark residence `indirect` — this dimension has been graded both ways in past runs and `direct` is the doctrine.

### Judge context — schema facts (do not penalize these)

- **Dual-id scheme is by design:** `research.json` sources carry `src_NNN` ids while `tree.gedcomx.json` source descriptions carry `S` ids, and a source entry's `gedcomx_source_description_id` points from one to the other. Seeing both id families for one record is correct, not an inconsistency.
- **Blank columns produce no assertions — required behavior:** if a record's field is blank for a person (e.g., no occupation listed), the skill must NOT create an assertion for it. Absent assertions for blank fields are compliance, not incompleteness. Only penalize a missing assertion when the record actually contains the value.
- **Recovered validation retries:** a tool call rejected by validation that the skill corrected in an immediate retry scores Tool Arguments at most 2 (partial) — the error was real, the recovery is credited (mirrors the base Tool Arguments policy).
