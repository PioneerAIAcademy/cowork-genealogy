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

## Tree encoding

At tier `probable` or higher, does the skill actually *encode the conclusion in `tree.gedcomx.json`* — marking the concluded value as `primary` (facts) / `preferred` (names) on the right person, not merely narrating it in the proof summary? Evidence facts already sit on the tree — materialized continuously at identity-link time by person-evidence, un-`primary` and carrying their source-refs — so proof-conclusion's tree act is to declare which value is the *conclusion*, not to first populate the tree. A conclusion that lives only in `narrative_markdown` while the tree carries no `primary`/concluded value is a **found-but-lost** result (proof-conclusion SKILL.md §6).

**Two write paths (spec §7.1) — grade whichever the evidence shape calls for:**
- **Common case — value matches an existing evidence fact.** The concluded value equals a fact already materialized from a record (e.g. the 1908 death-cert father-name, the 1786 marriage date). Set `primary` on that fact via `tree_correct` `update_fact` — **no new fact is added.**
- **Synthesized case — value matches no single record.** The correlated value is computed and appears verbatim in no source (e.g. three census ages → "abt 1805"). The skill **adds** a fact via `tree_edit` `add_fact` with `primary: true` carrying **multiple source-refs** to all the correlated evidence S-entries. An inferred value is encoded honestly (`abt`/`cal`/`est`, not a bare stated year); purely-argumentative / negative evidence materializes only its *conclusion* (e.g. a death "bef 1870" established by absence) through this additive write, never a stated fact.

**The concluded relationship edge is usually already present.** For a parentage/marriage the `ParentChild` / `Couple` edge was typically minted by person-evidence at identity-link time and already carries a source-ref — so grade **"set `primary` / add the conclusion fact,"** NOT "first create the edge." If the concluded edge does not yet exist (the conclusion establishes a relationship no record materialized), writing it via `add_relationship` **carrying a non-null source-ref** (spec §8) is correct; a ref-less new edge is a fail. **Upload is conclusion-gated (spec §7):** only `primary`/proof-backed facts upload to FamilySearch — pushing un-concluded evidence upstream is wrong.

**N/A (score null) when:** the concluded tier is `possible` / `not_proved` / `disproved` (the skill reaches no conclusion, so it sets no `primary` and makes no tree write *during its run* — the already-materialized evidence facts stay un-`primary`; this "no `primary` set below probable" is graded mechanically by the validator instead); the test is review-mode / `no-new-proof-expected` (no new conclusion is being written); or the test is a negative routing test.

- **pass:** At `probable`/`proved`, the skill encodes the conclusion on the tree — sets `primary` on the matching evidence fact via `tree_correct` `update_fact`, or adds the synthesized fact via `tree_edit` `add_fact` (`primary: true`, multi-ref) — and the concluded relationship edge is present and sourced (already-materialized, or newly written with a ref). The researcher's tree now reflects the conclusion, not just the narrative.
- **partial:** The conclusion is encoded but incompletely — e.g. `primary` is set on the fact but a genuinely-synthesized value is written as a bare stated year instead of `abt`/`cal`; a newly-written edge lacks its source-ref; or only one side of a two-part conclusion (e.g. a marriage) is set.
- **fail:** The skill concludes a parentage/marriage at `probable`+ in the proof summary but the tree carries **no** `primary`/concluded value (no fact marked, none added) — the conclusion never reaches the tree; or it uploads un-concluded evidence.
