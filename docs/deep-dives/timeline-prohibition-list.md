# timeline — prohibition list (Step 1 of the deep-dive guide)

Built from `packages/engine/plugin/skills/timeline/SKILL.md`, plus
`references/places-guidance.md`, `references/timeline-analysis-guide.md` and
`references/validation-protocol.md`. Drafted from the body **before** reading any
transcript (Step 1) and refreshed against the body **as this PR leaves it**, so the
next auditor starts from the shipped rules rather than the pre-dive ones. Three lines
are new in this PR and were not available to grade the committed runs against: the
1890 prohibition in F31, the wholesale-regeneration rule in B8, and the
identity-scoped coherence verdict in I39. Every line below is checkable by eye against a
run-log transcript (`output.text_response`, `output.tool_calls`,
`output.file_changes`).

Judgement calls ("was the gap severity well chosen", "does the narrative read well")
are deliberately excluded — they belong to the judge, per the guide.

**Save this file. The next auditor of `timeline` starts here instead of rebuilding it.**

---

## A. Routing (before any tool call)

1. "Resolve this conflict between two sources" → hand off to `conflict-resolution`.
   Must NOT weigh evidence: "Do not attempt weighing evidence within this skill."
2. "Which of these same-name persons does this record belong to?" / "attach this
   record" → hand off to `person-evidence`.
3. "Write a proof argument" → hand off to `proof-conclusion`.
4. Must read `researcher_profile.narration_guidance` from `research.json` and apply it.
5. On a negative-routing turn the skill must call **no** tools at all — in
   particular no `research_append`.

## B. Writes

6. `research_append` is the only writer, and `section` is only ever `"timelines"`.
   "Writes only `timelines[]`."
7. New timeline → `op: "append"`, and `id` / `generated` are **omitted** ("The tool
   assigns the `t_` id and stamps `generated`").
8. Regeneration → `op: "update"` with `entryId`, the **full** recomputed `events` and
   `gaps` arrays, and `generated` supplied by the skill ("`update` does **not**
   re-stamp `generated`").
9. Pass **only the timeline object** — never read and re-serialize the whole
   `research.json`.
10. Never leave a stale duplicate timeline for the same person/hypothesis.
11. Only schema fields on the entry — `label`, `hypothesis_id`, `person_ids`,
    `generated`, `events[]`, `gaps[]`. "Do not invent or attach additional fields."
12. There is **no `impossibilities` field**. Never write one.
13. On `{ ok: false, errors }` the skill must surface the errors and fix the input —
    not retry blindly.
14. No separate `validate_research_schema` pass ("a successful write means the
    timeline … are valid"). Calling it is not required; claiming a validation that
    never ran is a fabrication.

## C. Gathering (Step 2)

15. Events come from `person_evidence` entries for the target person(s) **where
    `superseded_by` is null**, and from the assertions those entries name.
16. Assertions with neither date nor place don't become events ("may be noted").

## D. Event construction (Step 3)

17. Events are sorted chronologically; `~1845` sorts on the year, `1840-1850` on the
    start year.
18. Multiple assertions **from the same record about the same event** collapse into
    ONE event. Corollary, checkable: an event must not cite an assertion whose own
    `date` is a different year from the event's `date`.
19. `event_type` comes from the closed list (birth, baptism, marriage, death, burial,
    residence, census, military, immigration, emigration, land_transaction, probate,
    other).
20. `date_certainty` is one of `exact`, `approximate`, `estimated`, `calculated` —
    a `~`-prefixed date is never `exact`.
21. Directional qualifiers are converted, not copied: `before 1850` → `estimated`
    with date `1849` **and a note**; `after 1840` → `estimated` with `1841` and a note.

## E. Place resolution and distance (Step 3.5)

22. Each **unique** place string gets **exactly one** `place_search` call. Never
    re-resolve a string already resolved.
23. All the `place_search` calls go out **in a single turn**; likewise all the
    `place_distance` calls.
24. `standard_place` is the first match's `standardPlace` from the tool response —
    never a name the skill composed. No results → leave `standard_place` null, and
    **do not retry**.
25. `distance_from_previous_km` is `place_distance`'s `kilometers`. The only value the
    skill may supply without a call is `0`, and only when both events share the same
    `standard_place`. **Computing a distance from coordinates (Haversine or
    otherwise) is prohibited** — the number must trace to a tool response.
26. Each unordered place pair is computed once; `place_distance(A,B)` is never
    re-called as `(B,A)`.
27. Either event lacking `standard_place` → `distance_from_previous_km` stays null.

## F. Gaps (Step 4)

28. `start` / `end` are the **actual boundary values, copied verbatim** — the bounding
    event's `date` in whatever format it uses, or the bare year of the expected record.
29. Never pad a year to `YYYY-01-01` / `YYYY-12-31`.
30. `expected_events` names specific record types, not "more records needed".
31. The 1890 US census "was mostly destroyed by fire" — it is not a record that can
    fill a gap, so it does not belong in `expected_events`. Saying so in chat while
    listing it in the field does not satisfy the rule.

## G. What this skill must NOT judge (Step 5)

32. Must NOT decide a single person's data is logically impossible — event after
    death, birth after death, impossible age. That is `check-warnings`'.
33. Must NOT silently fold an out-of-lifespan record in as a normal late-life event
    either. Required behaviour: state it plainly in the reply ("the 1912 deed
    postdates the recorded 1908 death") **and** recommend `check-warnings`.
34. Geographic / travel feasibility **is** this skill's. An infeasible pair is
    reported **in the reply** as a coherence signal (no persisted field exists).
35. Identity uncertainty and source disagreement belong in `conflicts[]`, referenced
    from the event via `conflict_ids` / `conflict_note`. Never re-derived here.

## H. Conflict references (Step 7)

36. For a **resolved** conflict, `assertion_ids` lists only the **preferred**
    assertions.
37. `conflict_ids` holds the `c_*` id — never the rejected assertion's `a_*` id.
38. The rejected `a_*` id **never** appears in `assertion_ids` or `conflict_ids`.
    It may appear in the free-text `conflict_note`.

## I. Identity-coherence verdict (Step 6)

39. Only a hypothesis-testing (Mode B) timeline gets a Pass / Fail / Inconclusive
    verdict, and the question it answers is whether records "cohere into one
    plausible life". A parentage or other non-identity hypothesis is not what this
    verdict is for.
40. The verdict must **name the deciding signals** — the actual age progression,
    birthplace stability or drift, geographic plausibility, family consistency. "A
    bare label without the deciding signals is an incomplete finding."
41. `Inconclusive` is reserved for a genuinely thin profile (one or two records
    matching on little more than a name and an approximate age). It must not be used
    as a hedge when several records agree on age progression plus a stable
    birthplace or residence.
42. A common or high-frequency name is **not** grounds to downgrade a coherent set to
    Inconclusive.
43. Fail or Inconclusive → suggest `hypothesis-tracking`.

## J. Output economy (Step 8)

44. The final reply must NOT reproduce the persisted content: no full event table, no
    distance ladder, no per-event walkthrough. "Do NOT re-render every event row or
    the distance ladder in chat."
45. The reply carries only: **Written** (`t_` id + label + event/gap counts),
    **Gaps** (one line each, span + severity), **Anomalies**, **Coherence** (Mode B),
    **Recommended next step**. "Reserve one short line per finding, not a paragraph."
46. After writing → suggest `check-warnings`. High-severity gaps → suggest
    `question-selection`.
