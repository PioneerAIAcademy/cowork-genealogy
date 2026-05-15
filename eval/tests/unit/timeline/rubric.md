# Timeline Rubric

Grading dimensions for timeline unit tests. Evaluated by the LLM judge alongside the base rubric (correctness, completeness).

## Chronological ordering

Are events ordered correctly by date, with date certainty reflected? Approximate dates should be positioned reasonably, not treated as exact.

- **pass:** Events ordered by date; `date_certainty` reflects the source (e.g., `estimated` for census-derived birth dates, `exact` for documented vital records); approximate dates positioned with appropriate caveats.
- **partial:** Ordering is correct but `date_certainty` is mis-coded on one event (an estimated census-derived birth labeled `exact`).
- **fail:** Events out of chronological order, or `date_certainty` is systematically wrong across multiple events.

## Gap detection

Did the skill identify meaningful gaps where records should exist but don't? A 48-year gap (1860-1908) is significant. A 1-year gap between census enumerations is not.

- **pass:** `gaps` array names the significant gaps (e.g., between the 1860 census and 1908 death) with `expected_events` populated with what records should fill them, and severity reflects the gap's impact on research.
- **partial:** Significant gaps detected but `expected_events` is generic ("more records needed") without naming specific record types.
- **fail:** Significant gaps missed, or trivial gaps (between two adjacent censuses) flagged as significant.

## Impossibility detection

Did the skill flag chronological impossibilities (present in two distant locations on the same date, birth after death) as evidence of potential identity conflicts?

- **pass:** Real impossibilities flagged in `impossibilities` with the conflicting assertion IDs and a `description` that explains the impossibility.
- **partial:** Impossibility detected but the explanation is shallow ("dates don't line up") without specifying what's impossible about them.
- **fail:** Real impossibilities missed, or non-impossibilities flagged as impossible (a person present in two nearby places in different years is not impossible).
