# mayfield-disputed-given-name

Synthetic scenario — no PII. Modelled on the case in issue #4579 (feedback #4493 and #4510), with every person, place and record renamed.

A first research plan for a question about a given name the records disagree on. The subject is a Black woman born about April 1852 in Virginia, a widowed laundress and head of household on the 1900 census of Byrd District, Goochland County, Virginia. The 1900 index entry gives her surname only (Mayfield). A transcription of the page image reads her given name as Ottilie, the researcher reads it as Tillie, and the 1880 census of her household indexes her as Atilla. No single spelling covers all three readings.

Her 1900 household holds two named members: a son, Isaac, and a granddaughter, Rosa. Isaac also appears in her 1880 household, that of her husband Henry Mayfield. No death is recorded.

- **Sources:** 2 sources (1900 census, 1880 census)
- **Assertions:** 14 assertions

Used by `ut_research_plan_c7m` (`eval/tests/unit/research-plan/disputed-name-lifetime-coverage.json`). The census years after the question's record (1910, 1920) and the record's year (1900) are keyed on the test id in `_DISPUTED_NAME_YEARS_BY_TEST_ID` in `eval/harness/validators/test_research_plan.py`.
