# Record Extraction Rubric

Grading dimensions for record-extraction unit tests. Evaluated by the LLM judge alongside the base rubric (correctness, completeness).

**Scoring calibration.** These dimensions are scored on the PERSISTED assertion/source fields — the tool-call arguments and final files — not on how the chat response narrates them. If the persisted fields are correct, the dimension scores 3, regardless of how tersely or verbosely the response describes them. A score of 2 requires the rationale to name a concrete wrong field value on a concrete assertion (e.g., "a_007 has `evidence_type: direct` for a birth year computed from age"). Narrative style, verbosity, and presentation are never grounds for a deduction in these dimensions. A deduction is never justified by calling a fixture-correct value "imprecise" or naming a hypothetically-better value — if the persisted value matches this rubric or the test's judge context, the dimension scores 3.

**Defensible-classification rule.** The GPS classification dimensions grade whether a persisted value is **defensible under mainstream GPS doctrine** — not whether it matches one canonical answer. `direct` vs `indirect` turns on whether the source *states* the answer or requires *inference*; informant proximity is a separate layer where more than one value is often defensible (an attending physician who managed a terminal illness is reasonably `official_duty` *or* `witness`; a spouse of many years reasonably `family_not_present` or `household_member`). **Credit any classification a competent genealogist would defend; dock only a clearly-wrong one.** Guardrails so this never erodes the anchors:
- **Never dock a value that matches this rubric or the test's `judge_context`.**
- **These stay strictly graded — a wrong call is always a deduction:** a pre-1880 (1850/1860) census relationship inferred from household position is `indirect`, never `direct`; negative evidence is `evidence_type: negative` with a `researcher` informant; a census *stated* residence is `direct`/`witness`; a census *stated* age is `direct` while a *birth year computed from it* is `indirect`; a death certificate's family-reported *birth/birthplace/parents/age* are `indirect`.
- **Grade the persisted assertion, not the chat narrative** — an inaccurate or loose *narrative* self-description is never a deduction when the persisted classification is correct.
- **Do not read a `record_role` label** (e.g. `wife`, `child_1`, `deceased`) **as an `evidence_type`** — grade only the persisted `evidence_type` of an actual assertion.

**The base `Correctness` dimension does not grade classification.** `evidence_type`, `informant_proximity`, and `information_quality` are owned by the **Evidence type accuracy** and **Informant identification** dimensions — and are settled ground truth wherever the deterministic `expected_classifications` check verified them. Do not fail or dock **Correctness** for a classification call (a direct-vs-indirect choice, a proximity choice); a debatable classification is never a Correctness defect — grade it only in its own dimension. Correctness grades the factual accuracy of the extracted *values* and whether required *actions* were performed.

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

- For **census** Residence facts, `informant: "census enumerator"` with proximity `witness` is CORRECT — the enumerator personally observed the household at the dwelling. This has been graded both ways; enumerator/witness is the doctrine. **This rule is census-specific** — a parish/christening register has no enumerator and no dwelling visit, so a residence stated there is `self`/`household_member` (the party who supplied it), never `witness`. Do not import the census-enumerator rule onto a non-census record.

`informant_proximity` is a **closed enum**: `self | witness | household_member | family_not_present | researcher | official_duty | unknown`. Grade only against these values — do not require or reward values outside the set (there is no `analyst` or `inferred_from_structure`). `researcher` is the **correct** value, not a partial, whenever the asserted value is the researcher's own conclusion rather than something a record informant reported:

- **Negative evidence** (person absent): no record informant exists — `informant: "the researcher"` (or equivalent), `informant_proximity: "researcher"`. Naming a record party (e.g. the enumerator) as informant for an absence is a fail-level error.
- **Relationships inferred from household structure** (e.g., a pre-1880 census with no relationship column): nobody stated the relationship — informant "none — inferred from household position", proximity `researcher`.

`unknown` means a record informant exists but cannot be identified. It is a *partial* when a specific reporter clearly exists and should have been named (age/birthplace facts a household member must have supplied), and wrong where `researcher` applies (researcher conclusions).

`researcher` is reserved for facts with **no record informant** — negative evidence and structure-inferred relationships. A **birth year computed from a stated age** is a 1:1 transform of one household member's report, not a researcher conclusion with no informant: its informant is that **household member** (the computation itself is captured by `evidence_type: indirect`). Accept `household_member` on a computed birth-year assertion; do **not** require `researcher` there.

**Death certificates — informant by fact (matches SKILL.md doctrine; grade against this, not intuition):**

- **Attending physician** is the informant for the death event itself — death date, place of death, cause, duration of illness — with proximity `official_duty` (the medical-certification side of the certificate is the physician's attestation). For the death **date and place**, `official_duty` (preferred) **or `witness`** are both acceptable — an attending physician is dual-capacity and may defensibly be read as a witness to the death; do not dock `witness`. This latitude is scoped to the death **event** facts and does **not** extend to `cause_of_death`/duration (a diagnosis is certified, not witnessed → `official_duty`), nor to the personal informant's biographical rows (which stay `family_not_present`).
- **The named personal informant** (spouse, family member) is the informant for the decedent's biographical facts — name, age, birth date/place, parents, occupation — with proximity `family_not_present` for events they did not witness.
- **The funeral director** is the informant for burial facts, proximity `official_duty`.

Do not score the skill down for attributing death date/place to the physician rather than the named personal informant — that attribution is the intended doctrine.

## Evidence type accuracy

Were direct, indirect, and negative evidence types assigned correctly? A relationship inferred from household position in the 1850 or 1860 census (no relationship column — explicit relationship columns were not introduced until 1880) is indirect evidence. A relationship stated in an 1880+ census (explicit column) is direct evidence.

> **⚠️ The #1 recurring judge error on this skill — do not make it.** Marking a **census** stated fact (name, age, birthplace) `indirect` on the reasoning that "the household member didn't personally witness the birth." That **inverts** the doctrine. `evidence_type` is *stated-vs-inferred*; a census **states** name/age/birthplace in its columns, so they are **`direct`**. A household member reporting on their own household has firsthand household knowledge. The informant's not-having-witnessed-the-birth is an **`information_quality`** matter (it may make the *information* secondary) — **never** an `evidence_type` downgrade. If you are about to score a census name/age/birthplace as needing `indirect`, STOP — you are making this exact error. The `expected_classifications` validator encodes the ground truth for these; when it passes, **do not contradict it** with this dimension.

- **pass:** `evidence_type` matches the source's actual content: direct when the fact is explicitly stated; indirect when inferred from context; negative when the absence is the finding (with `record_role: "absent"`).
- **partial:** Most evidence types are correct but one is off — e.g., a 1850 census co-residence labeled direct when the relationship isn't stated.
- **fail:** Evidence types are mis-assigned across multiple assertions; the genealogist couldn't trust the classifications for downstream conflict resolution.

Applying this correctly:

- **A stated age is `direct` evidence of age.** "Age 32" in a census column is an explicitly stated fact → `direct`. Only the *birth year computed from* that age (a separate `~1818` assertion) is `indirect`. Do not mark the `age` assertion itself indirect — that conflates the stated age with the birth-date inference derived from it.
- **An inferred birth *year* is fine when labeled `indirect`.** Deriving `~1845` from a stated age and marking it `indirect` is correct behavior, not a violation. What is disallowed is computing an exact birth *date* (a specific day/month) from age/death-date arithmetic. Do not penalize an approximate year as if it were a fabricated exact date.
- **Census stated facts are `direct`; the death-certificate exception is scoped by RECORD TYPE, not by "did they witness the birth."** On a **census**, a household member reports on their own household with firsthand knowledge → a stated name/age/birthplace/occupation is **`direct`**. The narrow exception is a **death certificate**, an ORIGINAL source whose *named personal informant* (spouse, in-law) relays the decedent's biographical facts (birth date, birthplace, parents, age) secondhand → those specific facts are **`indirect`** even though stated. Do **not** generalize the death-cert rule to a census: "the informant didn't witness the person's birth" does not make a census-stated fact indirect — applied to a census, that reasoning is the inversion in the ⚠️ callout above. The discriminator is the record type / informant relationship, not whether anyone witnessed the birth.
- **Two `birth` assertions per person is correct, not "inconsistent."** A birthplace is a `birth` assertion with `place` set; a computed birth year is a `birth` assertion with `date` set (same `fact_type` by design — they're facets of one event distinguished by which field is populated). On a census these carry **different** evidence_types on purpose: the stated birthplace (`place` set) is `direct`, the computed year (`date` set) is `indirect`. Grade each `birth` assertion by its populated attribute; do **not** read the two different evidence_types as a contradiction, and do not dock "inconsistency."
- **A stated residence is `direct`.** The census enumerator recorded the household at that dwelling; the residence column contains the value. Do not mark residence `indirect` — this dimension has been graded both ways in past runs and `direct` is the doctrine.
- **A stated fact whose *transcription* is doubted is still `direct` evidence.** `evidence_type` is stated-vs-inferred; a doubt about whether an index/transcript read a name correctly (e.g. a caller-flagged suspect patronymic, or a `[?]` reading) is an **accuracy** concern, captured at `information_quality` (`secondary`/`indeterminate`), `source_classification` (`derivative`), a `[?]` in `value`, and tree-deferral — **not** by downgrading `evidence_type` to `indirect`. A name the source *states* is `direct` even when its spelling is suspect. Do not dock `direct` here, and do not reward `indirect` — that conflates accuracy-doubt with inference. (This dimension has inverted across runs on exactly this case — `direct` is the doctrine.)

### Judge context — schema facts (do not penalize these)

- **Dual-id scheme is by design:** `research.json` sources carry `src_NNN` ids while `tree.gedcomx.json` source descriptions carry `S` ids, and a source entry's `gedcomx_source_description_id` points from one to the other. Seeing both id families for one record is correct, not an inconsistency.
- **Blank columns produce no assertions — required behavior:** if a record's field is blank for a person (e.g., no occupation listed), the skill must NOT create an assertion for it. Absent assertions for blank fields are compliance, not incompleteness. Only penalize a missing assertion when the record actually contains the value.
- **Recovered validation retries:** grade the final persisted state, not the rejected attempt. A **single clean recovery** (one validation rejection, immediately corrected, retry succeeded with correct args) scores Tool Arguments **3** — one competent course-correction on a clear tool error is not a defect. Reserve **2** for an *unclean* recovery (multiple retries/thrashing, or a retry still leaving a non-critical arg wrong); a wrong critical arg or an unrecovered error still fails. Mirrors the base Tool Arguments policy in `eval/harness/judge/prompt.md`.
- **Idempotent `add_household_children` skips are correct, not failures:** the record-extractor has **no tree-read tool** and is instructed to pass the FULL household roster (the subject included) to `add_household_children`, then relay the tool's checklist. The tool matches parents, dedups, and skips children already in the tree (`already_child_of_parent`). Listing an already-present child (e.g. the subject who is already a person) is the **intended idempotent contract** — never a Correctness or Tool Arguments deduction. Grade the final tree state (right stubs + edges, no duplicates), not which names appeared in the call.
