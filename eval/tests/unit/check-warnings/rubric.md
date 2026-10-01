# Check Warnings Rubric

Grading dimensions for check-warnings unit tests. Evaluated by the LLM judge alongside the base rubric (correctness, completeness).

**Grading constraints (read before scoring any dimension).** When grading a check-warnings test, you do not have direct access to the test scenario's `research.json` or `tree.gedcomx.json` files. The only sources of truth available to you are: the scenario README (a prose summary of the project state), the user message, the skill's tool calls and the tool responses returned, and the skill's final text response.

Do not assert that a specific fact is or is not present in the tree, in `research.json`, or in any source document unless the scenario README or a tool response explicitly says so. Do not infer counts, dates, names, or relationships from the README's summary beyond what it states verbatim. If a deduction or credit you want to give would require inspecting tree or research.json contents you cannot see in your inputs, do not make it.

This rule applies symmetrically: do not deduct points because the skill missed a tree fact you cannot yourself verify; do not credit the skill for matching a tree fact you cannot yourself verify. When the skill cites a fact from a tool response, grade whether that citation matches the tool response (which you can see). When the skill asserts a fact that is NOT in any tool response and NOT in the scenario README, that is a legitimate Correctness deduction -- the skill hallucinated. Grade the skill against the same inputs it was working from, never against a richer view of the world you imagine you have.

## Detection accuracy

Did the skill detect genuine impossibilities and anomalies (birth after death, marriage before age 14, lifespan over 120 years) without flagging valid edge cases?

- **pass:** All real impossibilities flagged; no false positives on valid edge cases (a marriage at 16 in an 1850s rural community is unusual but valid).
- **partial:** Real impossibilities flagged but some false positives slip through, OR one impossibility is missed but the false-positive rate is clean.
- **fail:** Multiple real impossibilities missed, or so many false positives the genealogist would have to triage them manually anyway.

## Severity classification

Are warnings classified appropriately by severity? An impossibility (born after death) is critical. An anomaly (married at 16, which is above the tool's age-14 threshold) is a note, not a warning.

- **pass:** Severity tier matches actual impact: chronological impossibilities are critical/high; unusual-but-possible values are medium or low.
- **partial:** Severity tiers present but one or two are off by a tier (a critical issue labeled medium, or a low-severity anomaly labeled high).
- **fail:** All warnings at the same severity, or severity inversions (anomalies labeled critical, impossibilities labeled low).

## Actionability

Does each warning suggest what to investigate? "Birth year conflict between census and death certificate" is more useful than "possible date error."

- **N/A:** No warnings were found (the project is clean). There is nothing to make actionable -- score this dimension as `null`, not as a pass or fail. This avoids mechanically failing close-out reports on resolved projects where the correct response is "no warnings."
- **pass:** Every warning names the specific records involved and the action a genealogist should take.
- **partial:** Most warnings are actionable but at least one is generic ("possible date issue") without naming records or next steps.
- **fail:** Warnings are decoupled from records, or suggested actions are too vague to act on.
