# Init Project Rubric

Grading dimensions for init-project unit tests. Evaluated by the LLM judge alongside the base rubric (correctness, completeness).

## File initialization

Did the skill create both research.json and tree.gedcomx.json with all required sections? research.json should have empty arrays for all 11 sections. tree.gedcomx.json should have the stub person.

- **pass:** Both files are created, validate against their schemas, and contain the required structure (research.json with all 11 sections; tree.gedcomx.json with persons/relationships/sources arrays).
- **partial:** Both files exist but one is missing a required section (e.g., research.json without `proof_summaries`), even if empty.
- **fail:** One file missing entirely, or a file is created that doesn't validate against its schema.

## Objective decomposition

Did the skill create at least one initial research question derived from the objective? The question should be specific and actionable, not a restatement of the objective.

- **pass:** At least one `q_` question exists with `selection_basis: "objective_decomposition"`, populated with a specific, answerable formulation that advances the objective.
- **partial:** A question is created but it restates the objective verbatim, or is too broad to be the first concrete step.
- **fail:** No initial question is created, or the question's `selection_basis` is mis-set (e.g., `user_directed` when it was derived from the objective).

## Stub person quality

Does the GedcomX stub person contain whatever facts are known (name, approximate dates, places) without fabricating information? Unknown fields should be omitted, not guessed.

- **pass:** Stub person has known fields populated (name, gender if known, an approximate birth/death fact if the objective implies one) and omits unknown fields rather than filling them with placeholders.
- **partial:** Stub is populated correctly but fabricates one detail (a specific birth year when only "ca. 1840s" was implied) or omits a field that was clearly stated.
- **fail:** Stub fabricates names, dates, or places not implied by the objective, OR is so sparse it can't function as a research subject.
