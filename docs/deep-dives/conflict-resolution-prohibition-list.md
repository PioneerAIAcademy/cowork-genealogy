# conflict-resolution — prohibition list (Step 1 of the deep-dive guide)

Built from `packages/engine/plugin/skills/conflict-resolution/SKILL.md` as this PR
leaves it, plus the four reference files SKILL.md actually loads:
`references/weighing-evidence.md`, `references/historical-contradictions.md`,
`references/resolution-writing.md`, and `references/places-guidance.md` (loaded via
SKILL.md's separate "Places:" line at :30, not the reference table at :42 — easy to
miss on a first read).

A fifth file, `references/validation-protocol.md`, ships in this skill's `references/`
and is **never loaded from anywhere in SKILL.md**. Its rules are deliberately excluded
below: they contradict the body (see finding F10). Do not audit against it.

Every line below is checkable by eye against a run-log transcript
(`output.text_response`, `output.tool_calls`, `output.file_changes`). Judgement calls
("was the weighing persuasive", "is the narrative well-written") are excluded — they
belong to the judge, per the guide.

**Save this file. The next auditor of `conflict-resolution` starts here instead of
rebuilding it.**

---

## A. Scope — what this skill may touch

1. Write **only** the `conflicts` section. Never `assertions`, `person_evidence`,
   `sources`, or `tree.gedcomx.json` (:451).
2. Never modify `proof_summaries` — including `resolved_conflict_ids`. Recommend
   `proof-conclusion` instead (:444).
3. Do not re-classify assertions inline. Trust `evidence_type`, directness and
   `informant` **as recorded**; if a classification looks wrong, note it, recommend
   `record-extraction`, and proceed with what is on file (:78–83).
4. Do not invoke `record-extraction` or `check-warnings` from here (:80).
5. Do not merge persons, and do not create or separate GedcomX persons — recommend
   `person-evidence` (:386, :487).
6. No separate validation pass after a successful `research_append` (:394).

## B. What is and is not a conflict

7. A `birth` place-claim and a `birth` date-claim are **not** a conflict. Compare place
   with place and date with date (:90–95).
8. Compare on `place` / `standard_place`, `date`, `structured_value` — never the
   free-text `value` (:96).
9. Multi-valued fact types (`Occupation`, `Residence`, `Census`, `Citizenship`) are
   never conflicts. Do not manufacture a conflict entry for differing occupations or
   residences (:119–124).
10. Never a second `c_` for a conflict between the same set of assertion ids — update
    the existing entry in place (:504).
11. A fact conflict carries `disputed_attribute` and **≥2** `competing_assertion_ids`;
    an identity conflict carries `identity_question` and may carry **1** (:59–71, :158).
12. Append a new conflict **without an id** — the tool assigns the `c_` (:133).
13. On `{ ok: false, errors }` nothing was written: read the errors, fix the shape, call
    again. Never retry blindly (:166, :252).

## C. Analysis

14. Never skip the independence analysis; it is a separate step from weighing (:455).
15. Independence is analysed **per conflict**, not per source pair, and written as prose
    (:176–179).
16. `weighing_analysis` ≤ **~200 words**, and only the **2–3 decisive** factors — do not
    tabulate all seven (:191–193).
17. No mechanical factor scoring, no point total (:200).
18. For an identity conflict turning on location: resolve each place with `place_search`,
    then call `place_distance` with the two `standardPlace` names. Asserting "these are
    far apart" without the call is prohibited (:204–213).
19. For a date conflict a calendar transition might explain: call `convert_calendar` and
    read `applied[].offsetDays`. Do not compute the 10/11/12/13-day offset by hand
    (:215–226).
20. An unsound assumption carries zero weight and **must not be used to tip a
    resolution** (:478).
21. A nil search result is not negative evidence unless the search was reasonably
    exhaustive and the record should exist (:473).
22. Do not trim, tailor, or ignore evidence to fit a preconception (:287).

## D. Resolving vs. deferring

23. `status: "resolved"` requires **all four** of `independence_analysis`,
    `weighing_analysis`, `preferred_assertion_id`, `resolution_rationale` non-null **on
    the same write** (:457).
24. `preferred_assertion_id` ∈ `competing_assertion_ids` (:233).
25. **Gate before any `resolved` write:** when every competing assertion traces to a
    single source or a single informant, weighing cannot resolve it — keep
    `unresolved`. "Completing a strong analysis is not, by itself, grounds to resolve"
    (:294–300).
26. A deferral is persisted to the conflict record, not left only in the chat reply
    (:291–294).
27. On a deferral, `independence_analysis` and `weighing_analysis` are filled anyway —
    they are required regardless of outcome (:300).
28. On a deferral, `resolution_rationale` names **which specific record types would be
    decisive**. "We can't know" without the decisive-evidence path is under-delivering
    (:305–308).
29. An identity conflict concluding "these are different people" has no assertion to
    prefer: `unresolved` / `preferred_assertion_id: null` (:380–384, :469).
30. Err on the side of leaving a conflict unresolved (:490).

## E. Resolution rationale

31. Four-part structure, ≤ **~250 words** for the common two-way conflict. The cap is
    outranked **only** by three-or-more-way completeness — never a licence to run long
    on a one- or two-assertion conflict (:257–263).
32. Part 2 must **not** use classification jargon — "original", "derivative", "primary",
    "secondary" — in the narrative. Explain reliability in plain language (:267–269,
    `resolution-writing.md` §2).
33. Part 4 must cite a **named pattern** from `historical-contradictions.md` (calendar
    changes, boundary shifts, census age estimation, memory degradation, deliberate
    misstatement, jurisdictional confusion, immigration-origin confusion,
    relationship-term confusion, derivative errors, multiple informants per record,
    missing persons in records). "Informants make mistakes" is prohibited by name
    (:272–285).
34. Part 4 must tie the error to the informant's epistemic position — who provided it,
    whether they could have known it firsthand, elapsed time, what they were likely
    reporting instead (:279–285).

## F. Identity conflicts

35. Same-named individuals are **DISTINCT until proven otherwise** (:325).
36. Co-enumeration rule: two same-named persons on one census page or tax list is
    definitive evidence of two distinct persons (:326–329).
37. A patronymic mismatch is a different-person signal, **never** a spelling variant in
    a true patronymic system. The Americanized/farm surname is separate from and does
    not resolve the patronymic. Iberian two-surname naming is the stated exception —
    reorder, drop, or maternal-surname-to-middle-name on emigration (:334–339).
38. Never confirm identity by the **absence of an alternative**. Confirm by positively
    placing the subject; if you cannot, the conflict is unresolved and you name the
    record that would decide it (:341–351).
39. An inherited surname is parentage evidence — name the convention being applied and
    confirm it held in that place and era; weigh it hardest against **indexed** parent
    fields (:353–367).

## G. One conflict per turn

40. When several conflicts are open, address **one per turn**. Do the full
    independence/weighing/resolution work on that one only and leave the others' fields
    untouched (:432–443).
41. When asked what to work on first: briefly enumerate the open conflicts, then state
    which one and **why**, from the body's own criteria — most foundational (an identity
    question that determines whose records the others even compare), blocks the most
    downstream questions, or has evidence actually available (:433–437).

## H. Presentation

42. Do **not** reproduce `independence_analysis`, `weighing_analysis` or
    `resolution_rationale` in chat — the full prose lives in the persisted entry
    (:398–405).
43. Per conflict, the chat summary is: the `c_` id and its status, **2–4 sentences**,
    and what it means for the research. Not a paragraph of re-argued analysis
    (:405–414).
44. Suggest next steps by outcome — resolved → hypothesis-tracking / proof-conclusion;
    unresolved → question-selection; identity → timeline (:416–425).
45. Narration: read `researcher_profile.narration_guidance`; when it is absent (it is
    `null` in every Flynn scenario) the default is **a one-line preamble per action**
    (:28).

## I. Places

46. Places are resolved with `place_search` / `place_search_all` and carried as the
    `standardPlace` name — never an id, above the tool layer (:30,
    `places-guidance.md`).

---

`judge_context` grep for score-branch spoilers
(`grep -l -iE '"[^"]*\bscore [123]\b' eval/tests/unit/conflict-resolution/*.json`):
**0 hits, confirmed 2026-08-27.** A second, looser shape does occur — a `judge_context`
bullet that prescribes *which conflict* is the right answer and the reason for it. See
finding F4.
