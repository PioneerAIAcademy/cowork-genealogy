# proof-conclusion — prohibition list (Step 1 of the deep-dive guide)

Built from **`packages/engine/plugin/agents/proof-conclusion.md`** (644 lines), which is
where the doctrine lives after the 2026-08-21 skill-agent pair conversion (PR #1819).

**Pinned to `94292657d`** — 2026-08-23, PR #1832, the agent body's latest revision at the
time of this dive and the text every rule below was read from. Note that is *after* the
#1819 conversion, so the 2026-08-21 date above says when the doctrine moved, not what this
list was built against. Before relying on a rule, run
`git diff 94292657d -- packages/engine/plugin/agents/proof-conclusion.md`; if it returns
anything, re-read the affected sections, because a rule quoted here may no longer be in the
body.
`packages/engine/plugin/skills/proof-conclusion/SKILL.md` is a 63-line routing stub and
contributes only section R below. Drafted from the two bodies **before** reading any
transcript, per Step 2 of the guide.

Every line below is checkable by eye against a run-log entry — `output.text_response`,
`output.tool_calls` (note: the per-call keys are **`tool`** and **`args`**, not
`name`/`input`), `output.builtin_tool_calls`, and `output.file_changes`. The artifact to
grade is mostly **not** `text_response`: the narrative lives in
`file_changes → research.json → diff.proof_summaries.added[].narrative_markdown` (or
`.modified[].changed_fields.narrative_markdown.after` on a re-invocation).

Judgement calls — was the correlation sound, does the narrative read well, was this
really the strongest evidence — are deliberately excluded. They belong to the judge.

**Save this file. The next auditor of `proof-conclusion` starts here instead of
rebuilding it.**

---

## A. The preconditions gate (runs before Step 1)

1. The gate is **exactly three** checks — classification, `person_evidence` identity
   links, conflicts. "Do not invent a fourth check, and do not restate a tier judgement
   as a gate failure."
2. Must **not** decline on thin evidence. "Thin evidence is not a gate failure: a single
   source, indirect-only evidence, an undeclared exhaustiveness or a high overturn risk
   are reasons to conclude at a lower tier, never reasons to withhold the conclusion."
3. Must run the gate even when the delegation message says "write a proof conclusion" —
   "a destination, exactly like the user requests above."
4. Must **show its work** on the gate, and list the failing IDs by id.
5. Check 2 (classification) failing, or check 3 leaving a relied-upon *person* with no
   linked identity assertion → **stop, no `proof_summaries` write at all**, report the
   failing IDs and route.
6. Check 3: the gate is satisfied **per person**, not per persona or per assertion.
   Unlinked *fact*/*negative* assertions, and extra personas of an already-identified
   person, are **advisory** — must not block.
7. Check 4 (identity-bearing unresolved conflict) → write a `not_proved` summary that
   names the conflict and the disputed attribute and says what would settle it; do
   **not** resolve the question; do **not** write the tree; route to
   `conflict-resolution`.
8. In `--autonomous` mode, route to the missing skill automatically rather than asking.

## B. Gathering evidence (§1)

9. "**Use `research_query`, not a raw `Read` of research.json.**" A `Read`, `Grep` or
   whole-file load of `research.json` in `builtin_tool_calls` is a violation.
10. Every lookup is **scoped** — `questionId` or `personId` — never an unscoped section
    dump, and never offset/pagination guessing.

## C. Tier selection (§2)

11. The `tier` value stored in `research.json` is **lowercase**: `proved` / `probable` /
    `possible` / `not_proved` / `disproved`.
12. An unresolved conflict is a **hard block on `proved`**.
13. An unresolved conflict *disputing the concluded fact or relationship itself* caps
    the tier at `possible`.
14. Hedging language ("suggests", "appears to be") **blocks `proved`**. Conversely,
    definitive phrasing ("conclusively establishes", "[X] IS the [Y] of [Z]") is
    permitted **only** at `proved`. Never mix tier and phrasing.
15. Must **not** collapse a well-supported **bounded** claim ("died after 1870 and
    before 1911") or a **documented negative** ("no record of type X exists, and here is
    why") to `not_proved`. Tier the finding on what CAN be established.
16. An unsearched, named, reachable record that would **narrow the answer itself** (not
    merely corroborate it) caps the tier at `possible` — a Component 1 failure.

## D. Form selection (§3, and "Selecting the Proof Conclusion Form")

17. Two or more candidates the evidence does not separate, with no direct evidence to
    settle it, is an **Argument** — not a Summary.
18. "If the narrative has to explain why you did *not* conclude something, it is an
    Argument."
19. Declared budgets: **Statement ≤~150 words** ("a few cited sentences, no explanation
    needed"); **Summary ~300–500**; **Argument ≤~800**.
20. A Statement is permitted only when "at least two independent citations support the
    claim without requiring further explanation."
21. Must not restate evidence already quoted verbatim elsewhere — cite it.

## E. The narrative (§4)

22. **Self-contained** — readable with no access to `research.json`, uploadable to
    FamilySearch as a Memory/Document. Evidence named **only** by bare id (`a_004`,
    `src_001`) is a failure; an id beside a full prose description is not.
23. Citations **copied verbatim** from the source entry's `citation` /
    `citation_detail`. "Do not write collection names, repository names, or URLs from
    memory." A paraphrase that differs even slightly is a citation error.
24. **Never claim a digital image exists** — "accessible", "digitized", "viewable" —
    unless the tool data carries an `imageId`/`artifacts` field or a nonzero image count.
    A source-description ARK or citation URL is not proof of an image.
25. A tree fact with no `sources[]` entry must be described as **"a tree fact carrying
    no source entry in this project"** — **not** as a record that "was not formally
    searched." The two point at different next steps. **Checking the phrasing is not
    enough:** the rule is also violated by getting the wording right and then weighing the
    missing citation as evidentiary weakness that sets the tier. See F7 in the findings —
    a phrase-matching scan misses that shape entirely.
26. Organize by **significance**, not research chronology.
27. State source classifications (original/derivative/authored,
    primary/secondary/undetermined, direct/indirect/negative) explicitly.
28. Name informants when their identity affects weighing.
29. A **sensitive finding** — unknown/non-paternity parentage, institutionalization, a
    criminal record, a traumatic death, Indigenous data sovereignty — opens with a brief
    **content note and plain-language summary before the detailed account**. Center the
    people the record is about, not the institution that produced it. Honor CARE where
    Indigenous records are involved.

## F. Persisting the summary (§5)

30. **ONE `research_append` call, ONE `ops[]` batch, carrying BOTH the summary and the
    question resolve — summary op first.** Never split them across two calls.
31. Required `entry` fields, all present: `question_id`, `tier`, `vehicle`,
    `supporting_assertion_ids`, `resolved_conflict_ids`, `exhaustive_search_summary`
    (populated even at probable/possible), `narrative_markdown`.
32. `vehicle` is lowercase: `statement` / `summary` / `argument`.
33. Re-invocation → `op: "update"` with the existing `ps_NNN` and a `fields` object
    carrying **only what changed**. Must not re-emit `narrative_markdown` unchanged, and
    must **never append a second summary for the same `question_id`**.
34. On `{ ok: false, errors }`, surface the errors and fix — do not retry blindly.

## G. Encoding the conclusion in the tree (§6)

35. `tree_edit` is **batched into ONE call** via its `ops[]` array. Likewise one
    `tree_correct` call for the ops that live there.
36. The concluded **relationship(s) come FIRST** in the batch.
37. `add_relationship` must carry a **non-null `sources[]` ref**; a ref-less new edge
    fails the Phase-2 guard and takes the whole batch down.
38. `ParentChild` uses `parent`/`child`, **never** `person1`/`person2`. `Couple` uses
    `person1`/`person2`.
39. Relationship endpoints are **existing** person ids — do not re-add persons already
    in the tree.
40. Common case (concluded value equals a materialized evidence fact): set
    `primary: true` on **that** fact via `tree_correct` `update_fact` — **do not add a
    second fact.**
41. Synthesized case (value in no single record): `tree_edit` `add_fact`,
    `primary: true`, with **multiple** source-refs to all correlated S-entries.
42. Bounded / documented-negative: `add_fact` with `primary: true` and the **bracket
    verbatim in `date`**, encoded even at `possible`.
43. An inferred value is encoded honestly — `abt`/`cal`/`est` — **never a bare stated
    year**. Purely argumentative/negative evidence materializes only its *conclusion*.
44. A tree `source` accepts only `title`, `citation`, `author`, `url`. **Never put
    citation text in a `description` field.**
45. `update_source` and every `remove` live in **`tree_correct`**, not `tree_edit`.
46. Merge order: `source_attachments` first (stop if the record is already in the tree),
    then `merge_warnings` dry-run (`contradiction` blocks), then confirmation, then
    `merge_tree_persons`.
47. `check-warnings` is invoked **once**, after the tree writes — not after each op.
48. Must **verify** the concluded relationship is actually linked before presenting.
49. A `possible` **parentage** stays off the tree; the below-`probable` carve-out is only
    the bounded/documented-negative vital case.

## H. Resolving the question (§7)

50. Resolution fields (`status: "resolved"`, `resolved`, `resolution_assertion_ids`) are
    written **in the §5 batch**, never as a second call.
51. The question is resolved **only when the agent concluded it**. Gate-blocked
    `not_proved` → question stays **open**. Exhaustive-search-came-back-empty
    `not_proved` → question **closes**.
52. `resolution_assertion_ids` are the same `a_` ids as `supporting_assertion_ids`.
53. Must **never** write `exhaustive_declaration`, and never mint a question.
54. Must not evaluate exhaustiveness — "reference the existing declaration and tier
    accordingly."

## I. Project status (§8)

55. **Never pass `updated` in `fields`** — the tool stamps it.
56. All questions resolved → `fields: { status: "completed" }`. Otherwise
    `fields: {}` to stamp `updated` alone.

## J. Presenting (§9)

57. Must **not** reproduce the persisted narrative, the full argument, or a
    per-assertion walkthrough in chat.
58. "What was written" **names the concluded relationship(s) first**, then facts/sources
    with ids/counts.
59. The named next-advance record must be **reasonably obtainable** — never a
    privacy-restricted or sealed one.
60. Assessing an **existing** summary: cover all seven checks and say something about
    each — tier, self-containment, citations, conflicts, exhaustiveness,
    unresolvability claims, tree.
61. Review/assessment mode (no new summary written): give the **full** assessment, not a
    terse summary — the output-economy rule applies only to already-persisted content.

## K. Unresolvability restraint ("Important rules")

62. Forbidden about the **fact**: "cannot be established", "cannot be inferred, assumed,
    or assigned", "indeterminable", "unobtainable" — while any relevant record type is
    unsearched.
63. Permitted about the **current record set**: "is not established by the evidence
    gathered so far", "remains unresolved pending [named record types]".
64. "Every sentence that states so **must**, in the same breath, name at least one
    specific unsearched record type that could still establish it. A bare 'cannot be
    determined from the record' with no such pairing is a fail, even when the tier is
    otherwise correct." *(See F5 in the findings — this per-sentence rule is graded
    per-narrative by the one test that covers it.)*
65. A "record not found" result must (1) name the repository and its coverage
    limitation, and (2) tier on the available indirect evidence. Must not write "cannot
    prove or disprove."
66. Must not resolve a conflict here — recommend `conflict-resolution`.

## R. The routing stub (`SKILL.md`) — checkable at the skill layer

67. Resolve the request to ONE `q_` id via `project_context`; ask which if several are
    open and none is named.
68. **Read nothing else and judge nothing** — no `research_query` on assertions,
    conflicts, `person_evidence`, or existing summaries; no view on readiness.
69. The delegation asks the agent to "run its preconditions gate and then conclude the
    question at whatever tier the evidence supports." Must **not** say "write a proof
    conclusion" (overrides the gate) and must **not** say "evaluate whether the question
    can be concluded" (invites a decline on thin evidence).
70. Never write `proof_summaries` inline; on delegation failure, report and stop.
71. Relay the agent's return as-is — no re-generated narrative, no per-assertion
    walkthrough.
