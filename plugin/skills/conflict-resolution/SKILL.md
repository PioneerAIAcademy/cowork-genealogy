---
name: conflict-resolution
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

Identifies, analyzes, and resolves conflicts in the evidence. The GPS
requires that ALL conflicting evidence be addressed — ignoring or
dismissing contradictions out of hand violates the standard. A
conclusion cannot be "Proved" if conflicts remain unresolved.

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

### 3. Analyze source independence

This is a SEPARATE analytical step from weighing. Write the
`independence_analysis` first.

**The question:** Are the competing sources truly independent, or
do they derive from the same underlying information?

**Independence checklist:**

| Check | Independent? | Example |
|-------|-------------|---------|
| Different creators, different informants | Yes | 1850 census (enumerator A) vs. death certificate (physician B) |
| Same household informant across censuses | Maybe not | 1850 and 1860 censuses may share Thomas Flynn as informant — the source records are independent but the informant for specific facts may be the same person |
| Derivative index of the same original | No | Ancestry index and FamilySearch index of the same census page are ONE source, not two |
| Two online trees citing the same record | No | "Multiple sources agree" — but they're copies of one source |
| Same informant, different occasions | Partially | Son-in-law on death certificate and same son-in-law in a pension affidavit — same person's knowledge, but independently recorded |

**Write the analysis as prose.** Independence depends on context —
the same two sources may be independent for one fact but not for
another. Analyze per-conflict, not per-source-pair.

Example:
```
"The two census records (1850, 1860) are independent original
sources with different enumerators. The death certificate is a
third independent original source. However, the census informants
are likely the same household member (Thomas Flynn or wife), so
the two census assertions may share a single informant —
potentially not fully independent for birth facts."
```

### 4. Apply the preponderance hierarchy

Write the `weighing_analysis`. Apply these rules in order:

**Rank 1: Source strength**
- Original sources over derivative sources (when information
  quality is equal)
- Derivative sources over authored works

**Rank 2: Information reliability**
- Primary information (eyewitness/participant) over secondary
  (secondhand)
- Important exception: A delayed birth certificate is an original
  source, but if created 50 years later, its information is a
  "later recollection" — weaker than a contemporary recording

**Rank 3: Temporal proximity**
- Contemporary recordings (made at or near the time of the event)
  over later recollections
- A census record made during the subject's lifetime outweighs a
  death certificate created decades later for birth facts

**Rank 4: Formality and purpose**
- Official/formal records (probate, land deeds, vital records) over
  casual/informal (letters, family bibles, online trees)
- Records created for legal purposes tend to be more accurate —
  perjury has consequences

**Rank 5: Informant objectivity**
- Unbiased informants over biased ones
- Watch for: age fraud (military enlistment, pension), ethnicity
  concealment (wartime prejudice), social pressure

**Rank 6: Quantity and independence**
- Multiple independent sources agreeing over a single source
- But ONLY if truly independent (see step 3). Two derivative copies
  of the same original count as ONE source.

Example:
```
"The census records are contemporary recordings made near the time
of Patrick's birth, while the death certificate was created 63
years later. The census informant was likely a household member
with firsthand knowledge (primary or indeterminate), while the
death certificate informant (son-in-law) is clearly secondary
for birth facts. Two contemporary sources outweigh one later
recollection by a secondary informant."
```

### 5. Resolve or defer

**If the preponderance is clear:** Set `preferred_assertion_id` and
write `resolution_rationale`. Set `status: "resolved"`.

The `resolution_rationale` must be a defensible explanation that
another researcher could evaluate. Template:

> "[Preferred source] is accepted because [reason based on
> preponderance hierarchy]. [Rejected source] is set aside because
> [specific weakness — secondary informant, later recollection,
> derivative, biased informant, etc.]. [If applicable: the conflict
> is explained by informant error / boundary changes / transcription
> error / cultural factors / etc.]"

**Common conflict explanations:**

| Pattern | Explanation |
|---------|-------------|
| Birth state varies across records | Informant confusion between place of birth and place of residence; or boundary changes (Virginia → West Virginia 1863) |
| Age varies ±2 years across censuses | Normal variation — census informants estimated ages, especially for children. "Age heaping" on round numbers (30, 40, 50) is well-documented |
| Name spelling varies | Pre-standardized spelling; enumerator's phonetic interpretation; literacy levels; Americanization (Müller → Miller) |
| Birth year on death cert differs from census | Death certificate informant (often a child or in-law) reporting secondhand, decades after the event |
| Person missing from one census | Temporary travel, enumerator error, or the person was genuinely elsewhere. Not necessarily an identity conflict |
| "Junior"/"Senior" confusion | Historical "Junior" often meant "younger man of same name in the community," not necessarily a son |

**If more evidence is needed:** Keep `status: "unresolved"`. Write
what evidence would resolve it. Recommend returning to
question-selection to create a question targeting that evidence.

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

- **Never ignore a conflict.** GPS Step 4 requires ALL conflicts
  to be addressed. An unresolved conflict is acceptable (with
  explanation); an unacknowledged conflict is a GPS violation.
- **Independence analysis and weighing are separate steps.** Don't
  skip the independence analysis. Two sources that appear to agree
  may not be independent — and one independent source outweighs
  ten dependent copies.
- **The resolution rationale must be defensible.** "I think source A
  is better" is not sufficient. Cite the specific preponderance
  hierarchy rank that applies.
- **Don't merge persons to resolve identity conflicts.** This skill
  identifies and analyzes the conflict. Merging is a conclusion
  (proof-conclusion) and a data operation (tree-edit).
- **Err on the side of leaving conflicts unresolved.** An honest
  "unresolved" is better than a premature resolution. The GPS
  allows "Probable" conclusions with acknowledged conflicts.
