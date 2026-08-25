# historical-context — prohibition list (Step 1 of the deep-dive guide)

Built from `packages/engine/plugin/skills/historical-context/SKILL.md` as this PR
leaves it, plus all four of its reference files: `references/historical-broad-context.md`,
`references/historical-terminology.md`, `references/boundary-and-calendar-changes.md`,
and `references/places-guidance.md` (loaded via SKILL.md's separate "Places:" line,
not the main reference table — easy to miss on a first read).

Every line below is checkable by eye against a run-log transcript
(`output.text_response`, `output.tool_calls`).

Judgement calls ("is this historical framing insightful", "was the connection to
research well-argued") are deliberately excluded — they belong to the judge, per the
guide.

**Save this file. The next auditor of `historical-context` starts here instead of
rebuilding it.**

---

## A. Routing (before any tool call or file read)

1. Routing check runs first — record-availability questions hand off to
   locality-guide with at most one short sentence, no tool calls, no file reads.
2. Record-search / translation / convert-dates questions get one short sentence
   naming the right skill and stop.
3. Defining or glossing a non-English word, even one line, is translation —
   redirect, do not do it here even briefly.

## B. Setup

4. Always load `historical-broad-context.md`; load the terminology and
   boundary/calendar references when those topics are involved.
5. Output only — no file writes. This is a read-only skill.

## C. Content quality

6. Connect context to action, not just history — explain how it affects the user's
   specific research, not just narrate background.
7. Consider multiple factor categories before settling on one explanation.
8. Every response that called a wiki/Wikipedia tool must end with a "Sources
   consulted" list, title linked to its real URL.
9. A claim with no returned URL to trace is not a finding — flag the gap rather than
   asserting from memory.
10. Never present training-knowledge claims in the same register as tool-verified
    facts.
11. When a tool call returns no results or an error, do not continue elaborating that
    topic as if the search succeeded — narrow the response or flag the gap explicitly.
    (SKILL.md, Important rules, ~line 200. Had zero test coverage before this PR —
    see Finding 3 in the findings doc.)
12. Do not speculate beyond evidence — present possibilities, not conclusions.

## D. Record-type / era specifics (`historical-broad-context.md`, `historical-terminology.md`)

13. Never say a child "may not appear," "was rarely listed separately," or "traveled
    under a parent's entry" on a US passenger manifest from 1820 on — every passenger
    has their own line.
14. Do not read a guardianship appointment as evidence a child was orphaned or
    unrelated to the petitioner without checking whether an estate or inheritance was
    involved.
15. Do not treat "base born" as a permanent illegitimacy status without checking
    jurisdiction and era.
16. Do not infer illiteracy from a signature mark alone.
17. Do not assume a Junior/Senior/II/III designation is a parent-child relationship
    without independent evidence.
18. Do not assume "Mrs." indicates a married woman in pre-1900 records.

## E. Boundaries and calendars (`boundary-and-calendar-changes.md`)

19. Always address county-level boundaries, not just state-level.
20. When dates disagree by exactly 10-13 days or by one year in Jan-March, consider
    the calendar transition before treating it as a true conflict.

---

`judge_context` grep for score-branch spoilers: 0 hits, confirmed.
