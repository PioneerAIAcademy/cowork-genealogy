# Proof Conclusion Rubric

Grading dimensions for proof-conclusion unit tests. Evaluated by the LLM judge alongside the base rubric (correctness, completeness).

**Two modes — write vs. review.** Most tests are *write-mode*: the skill produces a new `proof_summaries` entry. A subset is *review-mode* (tagged `no-new-proof-expected`): the skill assesses an EXISTING proof against the GPS without writing a new narrative. Each dimension's pass criterion below covers both modes — the (write) branch applies when a new narrative is being produced; the (review) branch applies when the test carries the `no-new-proof-expected` tag. Judges MUST apply the review branch on tagged tests; applying the write criteria to a review-mode test is incorrect because no new narrative exists to grade.

## Tier justification

Is the proof tier (proved/probable/possible/not_proved/disproved) justified by the evidence? In write-mode the new narrative explains why this tier and not a higher or lower one; in review-mode the assessment explains whether the existing `ps_NNN`'s tier is justified by ps_NNN's cited evidence.

- **pass:** (write) Tier matches evidence strength and the narrative explains why this tier specifically — for `probable`, it names what would be needed for `proved`; for `proved`, it explains why the search is reasonably exhaustive. OR (review, `no-new-proof-expected`) The assessment correctly identifies the existing `ps_NNN`'s tier, explains whether the cited evidence supports it, and names what would be required to advance to the next tier (or what would force it down).
- **partial:** Tier is plausible but the assessment doesn't explicitly contrast with the adjacent tiers (no statement of what's missing for the next higher tier).
- **fail:** Tier is inconsistent with evidence (declares `proved` on one indirect source; declares `not_proved` despite multiple corroborating sources), or no tier justification at all.

## Narrative standalone

Does the narrative read as a self-contained GPS conclusion without reference to the rest of the JSON? It must include inline citations, the evidence summary, conflict resolution, and the confidence declaration.

- **pass:** (write) A reader with no access to research.json can follow the narrative — every assertion referenced is described in prose, citations are inline, conflict resolution rationale is included, the tier is declared. OR (review, `no-new-proof-expected`) The skill correctly assesses whether the EXISTING `ps_NNN.narrative_markdown` is self-contained — flagging any reliance on unexplained `a_NNN` / `c_NNN` references and noting any missing prose explanations. The review itself need not be a publication-shape narrative; it's a structured assessment of an existing one.
- **partial:** In write-mode, narrative relies on reader knowing what `a_004` or `c_001` refers to without describing them. In review-mode, the assessment misses one self-containment issue in the existing narrative.
- **fail:** In write-mode, narrative is a JSON summary rather than a prose conclusion, or omits citations / conflict resolution / tier declaration. In review-mode, the assessment doesn't actually evaluate the narrative's standalone readability.

## Evidence completeness

Does the proof cite all relevant assertions and address all resolved conflicts? Omitting inconvenient evidence is a GPS violation.

- **pass:** (write) Every relevant assertion and resolved conflict is cited in the NEW narrative; the narrative doesn't selectively present only supporting evidence. OR (review, `no-new-proof-expected`) The review surveys every assertion and conflict CITED IN `ps_NNN`, and additionally flags any assertions/sources that exist in research.json but are NOT in ps_NNN — clearly labeled as evidence GAPS that may change the tier when incorporated, NOT as defects of ps_NNN itself. The skill is NOT required to render in-depth three-layer analysis of each unincorporated source; flagging them and stating whether they would change the tier is sufficient (deep analysis is the next-round proof-conclusion call, after those assertions are extracted/classified).
- **partial:** Most evidence is cited but one relevant assertion or conflict is omitted; in review-mode, an unincorporated source is omitted entirely (not even flagged as a gap).
- **fail:** Inconvenient evidence is omitted entirely, or contradicting assertions are present in research.json but ignored in the narrative/assessment.

## Proof-conclusion fit

Does the chosen proof conclusion — written as a Statement, Summary, or Argument — match the shape of the evidence? A proof statement suits a few cited sentences with no contradictions; a proof summary suits multiple correlated sources weighing clearly one way; a proof argument is required for competing candidates, only indirect evidence, significant conflicts, or any case where a competent researcher would disagree without seeing the full reasoning.

- **pass:** (write) The form of the proof conclusion matches the evidence complexity — e.g. an Argument for two undistinguished candidate fathers or a refutation that turns on a reasoning chain; a Summary when multiple sources correlate cleanly; a Statement only when direct evidence settles it outright. The narrative's structure actually follows the chosen form. OR (review, `no-new-proof-expected`) The review correctly identifies which form the existing `ps_NNN` was written in AND states whether that form still fits the evidence shape (e.g., "Summary was defensible at the time; if newer sources surface a competing candidate, the next conclusion may need to be an Argument"). The skill is not expected to choose a new form here — the review just judges fit.
- **partial:** In write-mode, the form is defensible but under- or over-built — e.g. a Summary used where competing candidates really warrant an Argument, or an Argument's heavy machinery applied to an open-and-shut Statement case — or the declared form doesn't match the narrative's actual structure. In review-mode, the assessment doesn't explicitly judge whether the existing form still fits.
- **fail:** In write-mode, the form is clearly wrong for the evidence — e.g. a bare Statement for a contested, indirect-evidence case, leaving the reader unable to evaluate the reasoning — or no recognizable proof-conclusion structure at all. In review-mode, the assessment doesn't identify or judge the existing form at all.
