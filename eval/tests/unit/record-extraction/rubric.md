# Record Extraction Rubric

Grading dimensions for record-extraction unit tests, scored by the LLM judge alongside the base dimensions (Correctness, Completeness, Tool Arguments). Scores: `3` = pass, `2` = partial, `1` = fail.

**How to grade.** Grade the *persisted* assertion/source fields (tool-call arguments and final files), never the chat narrative. Never dock a value that matches this rubric or the test's `judge_context`. Credit any classification a competent genealogist would defend; dock only a clearly-wrong one. Base `Correctness` grades factual values and required actions, not classification (that lives in the dimensions below).

### Classification rules (strictly graded: a wrong call is always a deduction)

1. **Pre-1880 census** (1850/1860/1870): a relationship is inferred from household position, so it is **indirect**, never direct. Informant for that inferred relationship is "none / researcher".
2. **1880-onward census**: relationship-to-head is a stated column, so it is **direct**.
3. **Census stated name / age / birthplace**: **direct** (a household member reports on their own household with firsthand knowledge). Informant is that **household member** ("unknown household member" if unnamed), not the enumerator (recorder). Do not mark these `indirect` because "they didn't witness the birth"; that is an information-quality matter, not evidence type. (This is the single most common judge error.)
4. **Census stated residence**: **direct**; here the **enumerator is the informant**, proximity `witness` (he observed the dwelling). Census-specific: a parish/register residence is `self` / `household_member`.
5. **Stated age**: direct; a **birth year computed from it**: **indirect**, informant = the same household member. Never compute an exact birth date from age arithmetic.
6. **Death certificate**: the family informant's report of the decedent's birth / birthplace / parents / age is **indirect** (secondhand), proximity `family_not_present`. Physician = the death event (date/place/cause), `official_duty` (or `witness` for date/place); funeral director = burial, `official_duty`.
7. **Marriage record**: each party is the **informant for their own facts, proximity `self`**; parents they name are **direct**; the clerk/officiant is the **recorder**, not the informant.
8. **Burial / cemetery index**: no informant is identified, so **informant `unknown`, information quality `indeterminate`** (not the index compiler, not `official_duty`).
9. **Negative evidence** (an absence is the finding): `evidence_type: negative`, `record_role: absent`, informant = **researcher**. Do not invent negative assertions the scenario or `judge_context` did not ask for.
10. **Source classification**: a FamilySearch index or transcript is **derivative**; only the original register/certificate image itself is `original`.
11. A **stated fact whose transcription is doubted** stays **direct**; the doubt is an information-quality / `[?]` matter, not `indirect`.

### Do not penalize (schema facts)

12. Dual ids by design: `research.json` uses `src_NNN`, `tree.gedcomx.json` uses `S` ids, linked via `gedcomx_source_description_id`.
13. A blank record field means **no assertion** (compliance, not incompleteness). Extraction writes assertions plus the source only, never tree persons/edges, so do not reward or penalize a missing tree stub.
14. A single clean tool retry (one validation error, corrected, retry succeeds with right args) scores Tool Arguments **3**. Reserve **2** for thrashing or a still-wrong arg.

## Assertion atomicity

One fact per assertion; compound source info is split into separate `a_` entries. A single event assertion carrying both its `date` and `place` is one event by design, not compound.

- **pass:** every assertion is a single fact.
- **partial:** one or two compound assertions (a `value` mixing two facts, or a fact plus justification).
- **fail:** assertions are systematically compound.

## Informant identification

The `informant` names the actual reporter and `informant_proximity` fits (closed enum: `self | witness | household_member | family_not_present | researcher | official_duty | unknown`). Record-type specifics are in classification rules 3, 4, 6, 7, 8.

- **pass:** informant is the actual reporter with a fitting proximity.
- **partial:** informant identified but proximity generic (e.g. `unknown` where a household member clearly reported it).
- **fail:** informant is the recorder (e.g. census enumerator listed as informant for a name/age fact), or blank when the record identifies it.

## Evidence type accuracy

`direct` when the source states the fact, `indirect` when it must be inferred, `negative` when the finding is an absence. Record-type specifics are in classification rules 1, 2, 5, 6, 9, 10, 11.

- **pass:** evidence types match the source.
- **partial:** one is off (e.g. an 1850 co-residence marked direct).
- **fail:** multiple mis-assigned.
