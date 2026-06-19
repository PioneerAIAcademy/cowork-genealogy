# Proof Conclusion Rubric

Grading dimensions for proof-conclusion unit tests. Evaluated by the LLM judge alongside the base rubric (correctness, completeness).

## Tier justification

Is the proof tier (proved/probable/possible/not_proved/disproved) justified by the evidence? The narrative must explain why this tier and not a higher or lower one. "Probable" should cite what's missing for "proved."

- **pass:** Tier matches evidence strength and the narrative explains why this tier specifically — for `probable`, it names what would be needed for `proved`; for `proved`, it explains why the search is reasonably exhaustive.
- **partial:** Tier is plausible but the narrative doesn't explicitly contrast with the adjacent tiers (no statement of what's missing for the next higher tier).
- **fail:** Tier is inconsistent with evidence (declares `proved` on one indirect source; declares `not_proved` despite multiple corroborating sources), or no tier justification at all.

## Narrative standalone

Does the narrative stand alone as a readable GPS conclusion without reference to the rest of the JSON? It must include inline citations, the evidence summary, conflict resolution, and the confidence declaration.

- **pass:** A reader with no access to research.json can follow the narrative — every assertion referenced is described in prose, citations are inline, conflict resolution rationale is included, the tier is declared.
- **partial:** Narrative is mostly self-contained but relies on the reader knowing what `a_004` or `c_001` refers to without describing them.
- **fail:** Narrative is a JSON summary rather than a prose conclusion, or omits citations / conflict resolution / tier declaration.

## Evidence completeness

Does the proof cite all relevant assertions and address all resolved conflicts? Omitting inconvenient evidence is a GPS violation.

- **pass:** Every relevant assertion and resolved conflict is cited; the narrative doesn't selectively present only supporting evidence.
- **partial:** Most evidence is cited but one relevant assertion or conflict is omitted (suggesting the skill didn't survey all of research.json).
- **fail:** Inconvenient evidence is omitted entirely, or contradicting assertions are present in research.json but ignored in the narrative.

## Proof-conclusion fit

Does the chosen proof conclusion — written as a Statement, Summary, or Argument — match the shape of the evidence? A proof statement suits a few cited sentences with no contradictions; a proof summary suits multiple correlated sources weighing clearly one way; a proof argument is required for competing candidates, only indirect evidence, significant conflicts, or any case where a competent researcher would disagree without seeing the full reasoning.

- **pass:** The form of the proof conclusion matches the evidence complexity — e.g. an Argument for two undistinguished candidate fathers or a refutation that turns on a reasoning chain; a Summary when multiple sources correlate cleanly; a Statement only when direct evidence settles it outright. The narrative's structure actually follows the chosen form.
- **partial:** The form is defensible but under- or over-built — e.g. a Summary used where competing candidates really warrant an Argument, or an Argument's heavy machinery applied to an open-and-shut Statement case — or the declared form doesn't match the narrative's actual structure.
- **fail:** The form is clearly wrong for the evidence — e.g. a bare Statement for a contested, indirect-evidence case, leaving the reader unable to evaluate the reasoning — or no recognizable proof-conclusion structure at all.
