# flynn-research-complete-no-proof

Patrick Flynn parentage research — all planned searches completed, exhaustive declaration in place, but no proof_summary has been written yet. Used by proof-conclusion tests that need the skill to write a new `proved`-tier proof from scratch.

Differs from `flynn-resolved` in these ways:

- **`proof_summaries`:** `[]` — `ps_001` removed so the skill must produce a new entry.
- **Added an Irish Catholic baptism (1845):** `src_005` provides direct + primary evidence of the father-child relationship, recorded by the priest who witnessed Patrick's baptism. The 1860 census does not provide primary information on relationships (the explicit relationship column was not introduced until 1880).
- **Added a contemporaneous family Bible (1845):** `src_006` is a family Bible birth entry recorded by the father, Thomas Flynn — a **second** independent original source with *primary* information on the parent-child relationship, alongside the baptism. This is the key to a defensible `proved`: the skill's own tier table defines `proved` as "2+ independent original sources with primary information," so a single primary source (baptism alone) correctly tier-downs to `probable` (see the senior-review note below). With the baptism **and** the family Bible, the scenario genuinely clears the `proved` bar, corroborated by the indirect census co-residence and the direct-but-secondary death certificate.
- **`q_001` rescoped to the father only:** Original wording asked about "parents" (plural). The fixture's existing evidence (1850/1860 census and 1908 death cert) only names Thomas. When the baptism was added, it also named the mother (Mary Brennan) as Catholic baptismal records always do — and a careful LLM correctly tier-downed the whole question because the mother's identification had only one corroborating source. Rescoping the question to "Who was the father?" matches the actual evidence scope and aligns with the test's intent (verifying `proved`-tier for paternal identification). Maternal identification would be a separate downstream question.

Everything else (project.status, q_001.exhaustive_declaration shape, plans, log entries 1–6 including negative probate log_006, conflict c_001, etc.) matches `flynn-resolved`. The exhaustive_declaration text references five sources, two of them with primary information on the relationship.

## Items added vs. flynn-resolved

- `sources[src_005]` — St. Mary's Catholic baptismal register, County Tipperary, Ireland (1845)
- `sources[src_006]` — Flynn family Bible birth entry (imprint 1840), recorded by the father — second primary-information source
- `assertions[a_014]` — parent-child relationship, direct + primary, from src_005 (baptism)
- `assertions[a_015]` — parent-child relationship, direct + primary, from src_006 (family Bible)
- `log[log_007]` — search of NLI Catholic Parish Registers
- `log[log_008]` — examination of the descendant-held family Bible (`pli_007`)
- `person_evidence[pe_007, pe_008]` — links a_014 to I1 (Patrick) and I2 (Thomas)
- `person_evidence[pe_009, pe_010]` — links a_015 to I1 (Patrick) and I2 (Thomas)
- `questions[q_001].resolution_assertion_ids` — appends `a_014`, `a_015`
- `questions[q_001].exhaustive_declaration` — log_entry_ids appends `log_007`, `log_008`; justification/stop_criteria text updated for the five-source, two-primary picture
- `tree.gedcomx.json.sources[S5, S6]` — NLI catalog entry and the family Bible
- `tree.gedcomx.json.relationships[R1].sources` — appends `S5` and `S6` references

## Used by

- `proof-conclusion` positive test for the `proved` tier — the skill must write a new `proof_summaries` entry with `tier: "proved"`, justifying exhaustiveness from the populated `q_001.exhaustive_declaration` and reasoning across all five sources, anchored by the two primary-information sources (1845 baptism and family Bible) and including the negative probate result (`log_006`).

## Note on the probate negative result

The negative probate (`log_006`) doesn't contradict the parentage conclusion. It does affect what "reasonably exhaustive" looks like: with no estate proceedings to consult, the conclusion rests on four other independent sources. The `exhaustive_declaration.stop_criteria` reflects this explicitly.

## Note on the `proved` bar (resolved here)

This scenario originally carried only **one** primary-information source on the relationship (the baptism), which a strict reading of the skill's own `proved = 2+ independent original sources with primary information` rule correctly tier-downs to `probable` — making the `proved` test flaky run-to-run. The **family Bible (`src_006`/`a_015`)** was added as the second independent primary-information source so the scenario genuinely meets the `proved` bar and the test is deterministic.

**Still open for senior review:** `flynn-resolved` (the base scenario this was forked from) carries the same single-primary-source shape but is described as `proved`. If other tests depend on `flynn-resolved` being `proved`-eligible, they may need the same second-primary-source treatment.
