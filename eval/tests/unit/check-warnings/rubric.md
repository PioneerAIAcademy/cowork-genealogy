# Check Warnings Rubric

Grading dimensions for check-warnings unit tests. Evaluated by the LLM judge alongside the base rubric (correctness, completeness).

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
