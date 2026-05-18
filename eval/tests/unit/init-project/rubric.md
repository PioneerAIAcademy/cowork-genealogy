# Init Project Rubric

Grading dimensions for init-project unit tests. Evaluated by the LLM judge alongside the base rubric (correctness, completeness).

## Stub person quality

Does the GedcomX stub person contain whatever facts are known (name, approximate dates, places) without fabricating information? Unknown fields should be omitted, not guessed.

- **pass:** Stub person has known fields populated (name, gender if known, an approximate birth/death fact if the objective implies one) and omits unknown fields rather than filling them with placeholders.
- **partial:** Stub is populated correctly but fabricates one detail (a specific birth year when only "ca. 1840s" was implied) or omits a field that was clearly stated.
- **fail:** Stub fabricates names, dates, or places not implied by the objective, OR is so sparse it can't function as a research subject.
