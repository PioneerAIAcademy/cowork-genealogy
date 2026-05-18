---
name: conflict-resolution
model: claude-sonnet-4-6
description: Identifies and resolves conflicting genealogical evidence —
  both fact-level conflicts (three different birthplaces) and identity-level
  conflicts (is this census record our subject?). Performs source
  independence analysis, applies the GPS preponderance hierarchy, and
  writes defensible resolution rationale. GPS Step 4 — Resolution of
  Conflicting Evidence. Use when the user says "these sources disagree",
  "resolve this conflict", "which source is right?", "why do these
  records conflict?", "compare these assertions", when conflicting
  assertions exist in research.json, or when timeline impossibilities
  suggest an identity conflict. Do NOT use when the user wants to classify
  evidence (use assertion-classification), wants to build a timeline (use
  timeline), or wants to write a conclusion (use proof-conclusion).
---

# Conflict Resolution

Identifies, analyzes, and resolves conflicts in the evidence. GPS
Element 4 requires ALL conflicting evidence to be resolved before a
conclusion can be proved. An unresolved conflict acknowledged honestly
is acceptable; an unacknowledged conflict is a GPS violation.

The intellectual process for every conflict: (1) Acknowledge what the
contradictory evidence says, (2) Analyze the reliability of each source
and informant, (3) Explain which version is most likely correct and why
the other exists.

Reference files in `references/`:
- `weighing-evidence.md` — Seven factors, four defensible rationales,
  independence assessment
- `historical-contradictions.md` — Common historical reasons for
  discrepancies (calendar changes, boundary changes, term meanings)
- `resolution-writing.md` — Four-part structure for written resolutions,
  informant analysis protocol

## Two types of conflicts

### Fact-level conflicts

Two or more assertions disagree about a specific fact:
- Birthplace: Ireland (1850 census) vs. Pennsylvania (death certificate)
- Birth year: 1845 (census age) vs. 1843 (delayed birth certificate)
- Surname spelling: Flynn vs. Flyn vs. Flinn

These use `conflict_type: "fact"` and require `disputed_attribute`
(e.g., `birthplace`, `birth_year`, `surname_spelling`).

### Identity-level conflicts

Uncertainty about whether a record refers to the research subject:
- "Is the Patrick Flynn in the 1870 Allegheny County census our
  Patrick Flynn from Schuylkill County?"
- "Are there two Thomas Flynns in this county, or one?"

These use `conflict_type: "identity"` and require `identity_question`.
May have only one assertion in `competing_assertion_ids` (unlike
fact conflicts which require at least two).

## Steps

### 1. Identify conflicts

Read `research.json` assertions, person_evidence, and timelines.
Look for:

**Fact conflicts:**
- Same person, same fact_type, different values. Compare assertions
  linked to the same person_id via person_evidence.
- Use `structured_value` for programmatic comparison where available
  (birth year as number, place as string).

**Identity conflicts:**
- Timeline impossibilities (from the timeline skill) — two events
  that can't belong to the same person
- Same name appearing in multiple records with ambiguous ages or
  locations
- person_evidence entries with `speculative` confidence — these
  are unresolved identity questions

**Already-identified conflicts:**
- Check existing `conflicts[]` for `status: "unresolved"` — these
  need attention

### 2. Create the conflict entry

For each new conflict identified:

```json
{
  "id": "c_002",
  "conflict_type": "fact",
  "description": "Patrick Flynn's birth year: 1845 (1850 census, age 5) vs. 1843 (delayed birth certificate)",
  "disputed_attribute": "birth_year",
  "identity_question": null,
  "competing_assertion_ids": ["a_002", "a_025"],
  "independence_analysis": null,
  "weighing_analysis": null,
  "preferred_assertion_id": null,
  "resolution_rationale": null,
  "status": "unresolved",
  "blocks_question_ids": []
}
```

For identity conflicts:

```json
{
  "id": "c_003",
  "conflict_type": "identity",
  "description": "Is the Patrick Flynn in the 1870 Allegheny County census (a_030) our subject from Schuylkill County?",
  "disputed_attribute": null,
  "identity_question": "Is the Patrick Flynn in the 1870 Allegheny County census the same as Patrick Flynn (KWCJ-RN4) from Schuylkill County?",
  "competing_assertion_ids": ["a_030"],
  "independence_analysis": null,
  "weighing_analysis": null,
  "preferred_assertion_id": null,
  "resolution_rationale": null,
  "status": "unresolved",
  "blocks_question_ids": ["q_004"]
}
```

Set `blocks_question_ids` when the unresolved conflict prevents
safe downstream work — e.g., you can't conclude parentage if you
don't know which census records belong to the subject.

### 3. Analyze source independence (GPS Standard 46)

This is a SEPARATE analytical step from weighing. Write the
`independence_analysis` first.

**The question:** Are the competing sources truly independent, or
do they derive from the same underlying information? Related
information items must be grouped into a unit that gets no more
credibility than its strongest single member.

**Write the analysis as prose.** Independence depends on context —
the same two sources may be independent for one fact but not for
another. Analyze per-conflict, not per-source-pair.

See `references/weighing-evidence.md` for the full independence
checklist and examples.

### 4. Apply the seven weighing factors (GPS Standard 47-48)

Write the `weighing_analysis`. Load `references/weighing-evidence.md`
for the full list of factors and rationales.

Evaluate the seven factors (relevance, record category, format,
informant proximity, directness, consistency, plausibility) for each
side. Focus on the factors that create meaningful differentiation —
not all apply to every conflict.

**After weighing, articulate a defensible rationale (Standard 48).**
The GPS recognizes four defensible rationales for setting aside
evidence on the losing side. If none applies convincingly, the
conflict cannot be resolved (Standard 49).

**Do not mechanically score factors.** Write a narrative argument
that another researcher could evaluate. The goal is a reasoned
explanation, not a point total.

### 5. Resolve or defer

**If the preponderance is clear:** Set `preferred_assertion_id` and
write `resolution_rationale`. Set `status: "resolved"`.

The `resolution_rationale` must follow the **four-part structure**
(see `references/resolution-writing.md` for full guidance):

1. **State the problem** — What fact is in dispute and why it matters
2. **Lay out the conflicting evidence** — Present each side with its
   source, informant, and plain-language reliability assessment (do
   NOT use technical jargon like "original" or "secondary" — explain
   in terms any reader can evaluate)
3. **Explain which version is more reliable and why** — Cite the
   specific weighing factors and defensible rationale that apply
4. **Explain why the less reliable evidence exists** — Provide a
   historically grounded reason for the error. Load
   `references/historical-contradictions.md` for common patterns
   (calendar changes, boundary shifts, age estimation, relationship
   term confusion, derivative transcription errors)

**Informant analysis is central to part 4.** For each competing
assertion, determine: Who was the informant? What was their proximity
to the event? How much time elapsed? Did they have a motive to
misstate? Could they have known the fact firsthand? See
`references/resolution-writing.md` for the full informant checklist.

**Evidence integrity (Standard 43):** Do not trim, tailor, or ignore
evidence to fit a preconception. If the evidence points away from a
preferred answer, the resolution must follow the evidence.

**If more evidence is needed (Standard 49):** Keep `status:
"unresolved"`. Write what specific evidence would resolve it.
Recommend returning to question-selection to create a question
targeting that evidence. A conclusion depending on this conflict
cannot be proved until it is resolved — this is acceptable and
honest.

**If the conflict is moot:** Set `status: "moot"` when subsequent
evidence makes the conflict irrelevant (e.g., the disputed person
turned out to be a different individual entirely).

### 6. Handle identity conflicts

Identity conflicts follow the same analysis but with different
resolution patterns:

**Same-name disambiguation protocol:**
1. Treat individuals with the same name as DISTINCT until proven
   otherwise
2. The co-enumeration rule: two persons with the same name on the
   same census page or tax list is definitive evidence of two
   distinct persons
3. Build candidate timelines (use the timeline skill) to test
   whether events cohere into one life
4. Check: do the ages fit? Do the locations make sense? Are there
   impossibilities?

**Resolution of identity conflicts:**
- "These are the same person" → update person_evidence links,
  suggest hypothesis-tracking record the conclusion
- "These are different persons" → create separate GedcomX persons
  if needed (via person-evidence stub creation), update links
- "Insufficient evidence" → keep unresolved, note what evidence
  would decide it

### 7. Validate and present

Invoke `validate-schema`. Present each conflict with:
- The competing assertions and their classifications
- The independence analysis
- The weighing analysis
- The resolution (or why it remains unresolved)
- What this means for the research (does it change any hypothesis?
  does it unblock any questions?)

Suggest next steps:
- Resolved conflict → "This conflict is resolved. Would you like
  me to update the hypothesis?" (hypothesis-tracking) or "Ready
  for a proof conclusion?" (proof-conclusion)
- Unresolved → "More evidence is needed to resolve this. Would
  you like me to create a research question targeting [specific
  evidence]?" (question-selection)
- Identity conflict → "Would you like me to build candidate
  timelines to test whether these records are the same person?"
  (timeline)

## Important rules

- **Never ignore a conflict.** GPS Element 4 requires ALL conflicts
  to be addressed. An unresolved conflict is acceptable (with
  explanation); an unacknowledged conflict is a GPS violation.
- **Independence analysis and weighing are separate steps.** Do not
  skip the independence analysis (Standard 46).
- **The resolution rationale must be defensible.** "I think source A
  is better" is not sufficient. Cite the specific weighing factor(s)
  and defensible rationale (Standard 48). Another researcher should
  reach the same conclusion or acknowledge the reasoning is sound.
- **Use the four-part structure.** State the problem, lay out
  conflicting evidence, explain which is more reliable and why,
  explain why the less reliable version exists.
- **Perform informant analysis.** For every competing assertion,
  identify who provided the information, their proximity, time
  elapsed, and possible motives. This is often the key to resolution.
- **Consider negative evidence.** The absence of expected information
  can be evidence in a conflict. A will that names all children but
  omits one is negative evidence against that person's membership in
  the family. But a nil search result is NOT negative evidence unless
  the search was reasonably exhaustive and the record should exist.
- **Check assumptions.** When resolving a conflict, distinguish
  fundamental assumptions (people cannot act after death),
  valid-until-contradicted assumptions (mothers conceive between ages
  12 and 49), and unsound assumptions (a man's widow was the mother
  of his children). Unsound assumptions carry zero weight without
  supporting evidence and must not be used to tip a resolution.
- **Evidence integrity (Standard 43).** Do not trim or ignore
  evidence to fit a preconception or to harmonize with other evidence.
  If the losing side has evidence you cannot explain, the conflict
  may be unresolvable — say so.
- **Consider historical context.** Spelling variation, calendar
  changes, boundary changes, and historical term meanings explain
  many apparent conflicts. See `references/historical-contradictions.md`.
- **Don't merge persons to resolve identity conflicts.** This skill
  identifies and analyzes the conflict. Merging is a conclusion
  (proof-conclusion) and a data operation (tree-edit).
- **Err on the side of leaving conflicts unresolved.** An honest
  "unresolved" is better than a premature resolution (Standard 49).
