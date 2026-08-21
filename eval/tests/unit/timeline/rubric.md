# Timeline Rubric

Grading dimensions for timeline unit tests. Evaluated by the LLM judge alongside the base rubric (correctness, completeness).

**Grade the persisted timeline, not the narration about it.** Every dimension below that names a `research.json` field is scored on the value actually written by `research_append`. A caveat, correction or qualification that appears only in the chat reply does not redeem a persisted field that says something else — the viewer and the next skill read the field, not the reply. Two findings here have no persisted field at all (geographic feasibility, the identity-coherence verdict); those dimensions say so and are scored on the reply.

## Tool usage — place resolution and distance

Does every place and distance in the persisted timeline trace back to a tool response in this run's tool ledger? `place_search` standardizes a place name; `place_distance` returns kilometers between two standard places. Neither value may be supplied by the skill's own knowledge or arithmetic.

- **pass:** every non-null `standard_place` matches a `standardPlace` returned by a `place_search` call in this run; every `distance_from_previous_km` is either `0` for two consecutive events sharing one `standard_place`, a `kilometers` value from a `place_distance` call in this run, or `null` — either because an event lacks a `standard_place`, or because the pair needed a distance and no `place_distance` response could be obtained, provided the reply says the distance is unavailable rather than supplying one. Each unique place string resolved exactly once, and independent calls issued together rather than one per turn.
- **partial:** the values all trace to tool responses but the calls are wasteful — a place string resolved twice, an unordered place pair called in both directions, or independent calls serialized one turn at a time.
- **fail:** a persisted `standard_place` or `distance_from_previous_km` that no tool response in this run produced — including a distance the skill derived itself from coordinates, estimated from geography, or recalled from memory, and including the case where the tool was unavailable and a number was written anyway. Also fail when the reply presents a distance or a standardized place as a tool result that the ledger does not contain.

## Gap detection

Did the skill identify meaningful gaps where records should exist but don't, and does `expected_events` name records a researcher could actually go and look for? A 48-year gap (1860-1908) is significant. A 1-year gap between census enumerations is not.

- **pass:** `gaps` array names the significant gaps (e.g., between the 1860 census and 1908 death) with `expected_events` populated with specific record types that survive and can be searched, and severity reflects the gap's impact on research.
- **partial:** significant gaps detected but `expected_events` is generic ("more records needed") without naming specific record types.
- **fail:** significant gaps missed; a trivial gap (between two adjacent censuses) flagged as significant; or `expected_events` names a record set that does not survive to be searched — the 1890 US federal census is the standing example, destroyed by fire and unrecoverable, so it can never fill a gap. A chat sentence acknowledging the destruction does not offset listing it in the field; grade what is in `expected_events`.

## Deferral of logical-impossibility detection

Did the skill correctly leave single-person logical-impossibility detection (event after death, birth after death, impossible age) to check-warnings rather than doing it itself? This skill arranges events; judging whether one person's data is logically possible is check-warnings' job. The timeline schema has no `impossibilities` field, so there is nowhere to persist such a contradiction.

- **pass:** When the chronology surfaces a possible vital-limit contradiction (e.g. a record dated after the recorded death), the skill notes it in its reply and recommends a data-integrity / warnings check, rather than judging it impossible itself or silently folding it in as a normal event.
- **partial:** Noted the anomaly but folded it in silently without recommending a warnings check, or hedged instead of pointing to check-warnings.
- **fail:** Adjudicated the logical impossibility itself as a settled finding (re-doing check-warnings' job), or ignored an out-of-lifespan record entirely.

## Geographic feasibility

When two place-bound events sit close together in time, did the skill use `place_distance` and the era's travel speed to judge whether one person could have been at both? **A "distance-sensitive pair" means two events close in TIME but far in DISTANCE — so little time that travel between them is questionable.** When consecutive events are far apart in distance but have ample time between them (e.g. an Ireland birth and a U.S. census five years later), the pair is NOT distance-sensitive: mark this dimension **N/A**. N/A is the required verdict there, not a pass — a scenario with no distance-sensitive pair gives this dimension nothing to grade, and scoring 3 for correctly calling a five-years-apart pair feasible reports coverage the run does not have.

- **pass:** Resolved both places, called `place_distance`, compared the distance against the elapsed time and the period's travel speed, and flagged a genuinely infeasible pair as a coherence signal **in its reply** (e.g., an Atlantic crossing in 7 days in 1850). Geographic feasibility is this skill's own check — reported in the reply, and not persisted, since the timeline has no field for it.
- **partial:** Noticed the places are far apart but did not call `place_distance` or did not quantify the conclusion (no distance, or no travel-time reasoning).
- **fail:** Missed an infeasible pair entirely, computed no distance when one was needed, or called a feasible pair infeasible.

## Identity coherence (hypothesis-testing timelines)

For a candidate (Mode-B) timeline built to test whether records describe **one person**, did the skill reach a correct, well-supported coherence verdict, and does the persisted timeline let a reader see what that verdict rests on?

**Scope first.** This dimension applies only where the hypothesis under test is an identity question — are these records one life, or two people? A hypothesis about parentage, a marriage, or any other relationship is not an identity question, and chronological coherence cannot settle it. Where the scenario's hypothesis is of that kind, mark this dimension **N/A**. Issuing a Pass / Fail / Inconclusive coherence verdict on a non-identity hypothesis is a **fail**, not an N/A: it hands the user a relationship conclusion (proof-conclusion's job) dressed as a chronology finding, and where its stated grounds include preferring one source's testimony over another's it is also the evidence weighing this skill is told not to do.

- **pass:** Aggregated both candidates' assertions under the hypothesis and reported an explicit one-life (Pass/supporting) or two-people (Fail/against) conclusion, naming the deciding signals — age progression, birthplace stability, geographic plausibility. For a Fail, the contradiction the verdict rests on occupies a **structured field** in the persisted timeline: the competing birth, age or place appears as its own event, or the affected event carries `conflict_ids` / `conflict_note`. That is what makes it part of the chronology — sortable, visible in the viewer's date column, and readable by the next skill without parsing prose.
- **partial:** Reached a verdict but hedged or supported it weakly (named the conclusion without the deciding signals, or treated a clear contradiction as merely "uncertain"). Also partial when the competing value appears **only inside an event `description`** — most often on a census row: a human reading the prose will find it, but it is not arranged chronologically, so the artefact this skill exists to produce does not carry the finding.
- **fail:** Wrong verdict (called incoherent records one life, or coherent records two people); no coherence conclusion at all; a coherence verdict issued on a hypothesis that is not an identity question; or a Fail verdict whose persisted `events[]` carry the competing value nowhere at all, leaving the finding only in chat.
