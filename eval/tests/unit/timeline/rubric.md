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

## Deferral of logical-impossibility detection

Did the skill correctly leave single-person logical-impossibility detection (event after death, birth after death, impossible age) to check-warnings rather than doing it itself? This skill arranges events; judging whether one person's data is logically possible is check-warnings' job.

- **pass:** `impossibilities[]` is empty. When the chronology surfaces a possible vital-limit contradiction (e.g. a record dated after the recorded death), the skill notes it in its reply and recommends a data-integrity / warnings check, rather than flagging it as an impossibility itself or silently folding it in as a normal event.
- **partial:** Noted the anomaly but either wrote it into `impossibilities[]` anyway, or folded it in silently without recommending a warnings check.
- **fail:** Wrote a logical impossibility into `impossibilities[]` (re-doing check-warnings' job), or ignored an out-of-lifespan record entirely.

## Geographic feasibility

When two place-bound events sit close together in time, did the skill use `place_distance` and the era's travel speed to judge whether one person could have been at both? **A "distance-sensitive pair" means two events close in TIME but far in DISTANCE — so little time that travel between them is questionable.** When consecutive events are far apart in distance but have ample time between them (e.g. an Ireland birth and a U.S. census five years later), the pair is NOT distance-sensitive: mark this dimension **N/A** and do not require a `place_distance` call. (Only graded when the scenario contains a genuinely distance-sensitive pair; mark N/A otherwise.)

- **pass:** Resolved both places, called `place_distance`, compared the distance against the elapsed time and period travel speed, and flagged a genuinely infeasible pair as a coherence signal **in its reply** (e.g., an Atlantic crossing in 7 days in 1850). Did not flag pairs that are feasible given the time available. (Geographic feasibility is this skill's own check — reported in the reply, not written to `impossibilities[]`.)
- **partial:** Noticed the places are far apart but did not call `place_distance` or did not quantify the conclusion (no distance, or no travel-time reasoning).
- **fail:** Missed an infeasible pair entirely, computed no distance when one was needed, or called a feasible pair infeasible (distant places with years between them).

## Identity coherence (hypothesis-testing timelines)

For a candidate (Mode-B) timeline built to test whether records describe one person, did the skill reach a correct, well-supported coherence verdict?

- **pass:** Aggregated both candidates' assertions under the hypothesis and reported an explicit one-life (Pass/supporting) or two-people (Fail/against) conclusion, naming the deciding signals — age progression, birthplace stability, geographic plausibility.
- **partial:** Reached a verdict but hedged or supported it weakly (named the conclusion without the deciding signals, or treated a clear contradiction as merely "uncertain").
- **fail:** Wrong verdict (called incoherent records one life, or coherent records two people), or no coherence conclusion at all.
