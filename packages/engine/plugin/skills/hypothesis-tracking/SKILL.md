---
name: hypothesis-tracking
model: claude-sonnet-4-6
description: Creates, updates, and reviews hypotheses about person identity,
  parentage, and relationships. Links supporting and contradicting
  assertions, manages status transitions (active → supported → ruled_out),
  tracks competing candidates, and summarizes hypothesis status. GPS
  Step 3-4 — Analysis, Correlation, and Resolution (hypothesis management).
  Use when the user says "I think [claim]", "track this hypothesis",
  "could this be [candidate]?", "are there competing candidates?", "update
  the hypothesis", "rule this out", "where do hypotheses stand?", "review
  the hypotheses", "summarize hypothesis status", "add [person] as a
  candidate", "add a third candidate", when competing identity candidates
  exist, when a conflict suggests multiple possible explanations, or when
  the user wants to organize or review evidence for and against a claim. Do NOT use when the user wants to resolve a specific fact conflict
  (use conflict-resolution), wants to build a timeline (use timeline), or
  wants to write a final conclusion (use proof-conclusion).
allowed-tools:
  - validate_research_schema
---

## Step 0 — Scope gate (MANDATORY, before any file reads)

Classify the user's request into exactly one category:

| Request pattern | Classification | Action |
|---|---|---|
| "resolve this conflict", "weigh these assertions", "choose between", "which is correct" | **conflict-resolution** | Reply: "This is a conflict-resolution task — please use the conflict-resolution skill." Then STOP. |
| "build a timeline", "create a timeline" | **timeline** | Reply: "This is a timeline task — please use the timeline skill." Then STOP. |
| "write a proof", "proof conclusion", "write the conclusion" | **proof-conclusion** | Reply: "This requires proof-conclusion — please use the proof-conclusion skill." Then STOP. |
| Anything about creating, updating, reviewing, or tracking hypotheses | **in scope** | Proceed to Step 1 below. |

If the classification is NOT "in scope": output the one-sentence reply shown above and **produce no other output** — no file reads, no tool calls, no analysis. This is a hard constraint, not a suggestion.

# Hypothesis Tracking

**Narration:** Read `researcher_profile.narration_guidance` from `research.json` and apply it as your narration style for this invocation. If absent, default to a one-line preamble per action.

**After completing every task (including read-only status reviews), call `validate_research_schema` on the project directory before presenting results.**

**Read-only detection:** If the user asks for a summary, review, or
status check without requesting changes ("where do things stand?",
"give me a quick summary", "I just want to see the current state"),
this is a **read-only review**. Present the hypothesis states, note
any issues you see (e.g., evidence that could rule out a hypothesis),
but do NOT modify `research.json` or `tree.gedcomx.json`. Identify
needed changes in your text response and let the user decide whether
to proceed. Only modify files when the user asks you to create,
update, rule out, or link evidence to a hypothesis.

Creates and manages hypotheses — testable claims about identity,
parentage, or relationships that the research is trying to prove or
disprove. Hypotheses organize the evidence into for/against columns
and track progress toward a conclusion.

**Read `references/hypothesis-gps-guidance.md` before creating or
evaluating any hypothesis.** It covers the distinction between leads
and hypotheses, the three categories of assumptions, evidence integrity
requirements, and the compiled-source verification pattern.

## When to use hypotheses

Hypotheses are most valuable when:
- **Multiple candidates exist.** "Patrick Flynn's father could be
  Thomas Flynn of Schuylkill County OR Thomas Flynn of Luzerne County."
- **Identity is uncertain.** "The Patrick Flynn in the 1870 census
  may or may not be our subject."
- **The same name appears in two places at once.** Two same-name,
  similar-age individuals recorded in *different households on the
  same census* may be one person counted twice, not two people.
  Enumeration ran over days or weeks, and a person was recorded both
  at home and wherever they were staying (visiting kin, working
  away), so a single child could land in two dwellings. Don't assume
  they're two distinct people — form a hypothesis that they are the
  same person and plan research to confirm or refute it (a later
  census showing one individual vs. two, a record naming both,
  distinguishing details such as different parents or birthplaces).
  This is a lead to test, not a conclusion: same-name proximity is
  not proof of identity, and the two could equally turn out distinct.
- **A relationship is claimed but not proven.** "Patrick Flynn's
  father was Thomas Flynn" — this is a hypothesis until the evidence
  reaches GPS proof standards.
- **A compiled source names a relationship.** A family tree on
  FamilySearch or Ancestry says "Phoebe's father was Daniel" — this
  is a lead, not a fact. Create a hypothesis and plan targeted
  research to verify or refute it.

Simple, uncontested facts don't need hypotheses — they go directly
from assertions to proof-conclusion.

**Decision rule — hypothesis vs. direct conclusion:** Create a
hypothesis when (a) multiple candidates compete, (b) the claim rests
on a compiled source needing verification, or (c) evidence exists on
both sides. If all known evidence points one direction with no
competition or conflict, skip hypothesis-tracking and go to
proof-conclusion directly.

## Leads vs. hypotheses vs. conclusions

- **Lead:** A clue from a compiled source — not evidence, just a
  starting point. Convert to a hypothesis before testing.
- **Hypothesis:** A testable claim, specific enough to verify or
  refute. Creating one commits you to test it, not accept it.
- **Conclusion:** A hypothesis that survived testing (→ proof-conclusion).

## Steps

### 1. Create a hypothesis

**Source awareness:** Before creating, identify WHERE the claim
originated. If from a compiled source (family tree, online genealogy,
published narrative), mark it as needing verification. Compiled sources
contain claims by other researchers — they are leads, not evidence.
The hypothesis exists specifically to drive targeted research that
will confirm or refute the compiled claim against original records.

**New hypotheses always start as `active`.** Even if existing
evidence strongly favors the hypothesis, set `status: "active"` at
creation time. The status reflects whether the hypothesis has been
formally evaluated, not how strong the evidence looks at a glance.
Promotion to `supported` happens in a separate evaluation step after
the evidence has been explicitly reviewed against the criteria in
Step 3.

When new evidence suggests a testable claim:

```json
{
  "id": "h_002",
  "claim": "Patrick Flynn's father was Thomas Flynn of Luzerne County, not Thomas Flynn of Schuylkill County",
  "status": "active",
  "supporting_assertion_ids": [],
  "contradicting_assertion_ids": [],
  "ruled_out": false,
  "ruled_out_reason": null,
  "notes": "Alternative candidate to h_001. Luzerne County Thomas Flynn appears in the 1850 census with a Patrick of the right age. Needs investigation.",
  "related_question_ids": ["q_001"]
}
```

**Claim requirements:**
- State the claim positively and specifically
- Include enough detail to distinguish from competing hypotheses
- Reference the person(s) involved

**related_question_ids:** Link the hypothesis to the research
questions it helps answer. This lets question-selection see which
hypotheses are active when choosing the next question.

### 2. Link evidence to hypotheses

As assertions are extracted, classified, and linked to persons,
evaluate whether they support or contradict each active hypothesis.

**Design research to refute, not just confirm.** For each active
hypothesis, ask: "What evidence would DISPROVE this?" Then prioritize
searching for that evidence. A hypothesis that survives deliberate
refutation attempts is far stronger than one supported only by
confirmatory searches.

**Supporting evidence:** Assertions that make the claim more likely.
Add their IDs to `supporting_assertion_ids`.

Examples of supporting evidence for "Patrick's father was Thomas
Flynn of Schuylkill County":
- Patrick enumerated in Thomas's household (a_004)
- 1860 census shows Patrick in Thomas's household (a_010)
- Death certificate names Thomas as father (a_013)
- Witness on Thomas's land deed is Patrick's known associate

**Contradicting evidence:** Assertions that make the claim less
likely. Add their IDs to `contradicting_assertion_ids`.

Examples of contradicting evidence:
- A different Thomas Flynn's will names a son Patrick of the right
  age in an adjacent county
- Patrick's death certificate names a birthplace inconsistent with
  Thomas's residence
- Timeline impossibilities between Patrick's events and Thomas's
  documented life

**FAN evidence is regular assertions.** Witness patterns, neighbor
correlations, godparent relationships — these are assertions about
the subject's associates. Link them to hypotheses via
`supporting_assertion_ids` like any other evidence. There is no
special FAN entity.

### 3. Manage status transitions

```
active ──► supported ──► (to proof-conclusion)
  │
  └──► ruled_out
```

**`active`** — The hypothesis has evidence accumulating but hasn't
crossed a threshold in either direction. This is the starting state.

**`supported`** — Transition when ALL of these are true:
- At least one line of direct evidence supports the claim (an
  assertion with `evidence_type: "direct"` in the supporting list)
- No unresolved contradictions remain (contradicting assertions have
  been explained, resolved via conflict-resolution, or outweighed)
- The evidence is consistent — no timeline impossibilities when
  testing this hypothesis

**Do NOT downgrade from `supported` to `active` for minor
discrepancies.** Census age rounding (e.g., a 5-year birth year
difference between two sources for the same person) is normal in
19th-century records and does not constitute an "unresolved
contradiction" warranting a status change. Adding contradicting
evidence to the list does not automatically require a status
downgrade — only link the evidence and leave the status unchanged
unless the contradiction is material enough to undermine the core
claim. When the user explicitly tells you a discrepancy "doesn't
disprove anything," respect that assessment if it is genealogically
reasonable.

**`ruled_out`** — Transition when ANY of these are true:
- Evidence affirmatively refutes the claim (e.g., a will names all
  children and Patrick is absent — negative evidence)
- Exhaustive elimination logic excludes the candidate (all other
  possibilities have been investigated and eliminated; this one
  doesn't fit)
- A chronological or biological impossibility makes the hypothesis
  untenable (the candidate was dead before the subject was born, or
  the candidate was too young to be a biological parent)

**Act on impossibilities immediately — unless this is a read-only
review.** When the user asks you to update, check, or evaluate a
hypothesis and the age arithmetic shows a candidate was 10 years old
at the subject's birth, that is a biological impossibility — rule
out the hypothesis in this interaction. Do NOT defer to
conflict-resolution or hedge on person_evidence confidence when the
link is rated `confident`. If the person_evidence connecting the
contradicting assertion to the candidate is marked `confident`
(match_score >= 0.80), treat the identification as settled and
apply the ruling. **Exception:** if the user explicitly asks for a
read-only summary/review ("just want to see the current state",
"give me a summary", "where do things stand"), do NOT modify
research.json — identify the issue in your response text but defer
the actual file changes to a follow-up request.

When ruling out, `ruled_out_reason` is REQUIRED. Be specific:

```json
{
  "status": "ruled_out",
  "ruled_out": true,
  "ruled_out_reason": "Thomas Flynn of Luzerne County died in 1840, five years before Patrick's estimated birth in 1845. His will (probated 1840) names three children, none named Patrick. Timeline impossibility and negative evidence from probate."
}
```

### 4. Handle competing hypotheses

When multiple hypotheses compete for the same conclusion (e.g.,
two candidate fathers), manage them as a group:

1. **Create one hypothesis per candidate.** h_001 for Thomas of
   Schuylkill, h_002 for Thomas of Luzerne, h_003 for James Flynn
   of adjacent county.

2. **Share related_question_ids.** All competing hypotheses link to
   the same research question.

3. **Evidence can support one and contradict another.** The same
   assertion might appear in h_001's supporting list and h_002's
   contradicting list.

4. **Rule out candidates as evidence accumulates.** The GPS process
   of elimination: research each candidate thoroughly, rule out
   those that don't fit, and the remaining candidate is identified
   by preponderance of evidence.

5. **Track which candidates remain.** When presenting to the user,
   summarize: "Two of three candidate fathers have been ruled out.
   Thomas Flynn of Schuylkill County is the remaining candidate
   with three supporting assertions and no contradictions."

### 5. Update existing hypotheses

When new evidence arrives (new assertions extracted, conflicts
resolved, timelines updated):

- Check if the evidence supports or contradicts any active hypothesis
- Add assertion IDs to the appropriate list
- Re-evaluate the status transition criteria
- Update `notes` with the current state of reasoning

**Don't change assertion IDs retroactively.** If an assertion was
supporting and new analysis shows it's actually neutral, remove it
from `supporting_assertion_ids`. But don't add it to
`contradicting_assertion_ids` unless it actively contradicts the
claim.

### 6. Connect to downstream skills

**To timeline:** Request a hypothesis-testing timeline to check
whether events cohere. "Build a candidate timeline for h_002 —
test whether Patrick's events fit Thomas of Luzerne County's
documented life."

**To conflict-resolution:** When supporting and contradicting
evidence exist for the same hypothesis, specific conflicts may
need resolution. "Assertions a_010 and a_035 disagree about
Patrick's father — conflict-resolution should analyze them."

**To proof-conclusion:** When a hypothesis reaches `supported`
status, it's ready for a proof conclusion. "Hypothesis h_001 is
supported by three direct evidence assertions with no contradictions.
Ready for proof-conclusion."

### 7. Validate and present

**Always** call `validate_research_schema({ projectPath: "<absolute-path-to-project-directory>" })` at the end of every interaction — including read-only status reviews, not just when you made changes. Verify both research.json and tree.gedcomx.json are valid. If validation fails, fix the errors before presenting. Then present the hypothesis state:

```
Hypothesis: h_001 — Patrick Flynn's father was Thomas Flynn
            of Schuylkill County
Status:     SUPPORTED

Supporting evidence (3):
  + a_004  1850 census: Patrick in Thomas's household (indirect)
  + a_010  1860 census: Patrick in Thomas's household (indirect)
  + a_013  Death certificate: "Father: Thomas Flynn" (direct)

Contradicting evidence (0):
  (none)

Competing hypotheses:
  h_002  Thomas Flynn of Luzerne County — RULED OUT
         (died 1840, before Patrick's birth)
  h_003  James Flynn of Carbon County — ACTIVE
         (1 supporting, 0 contradicting — needs more research)

Next steps:
  - h_001 is ready for proof-conclusion
  - h_003 needs more evidence — suggest question-selection
```

## Example: Tracking the elimination process

**Research question:** q_001 — "Who were Patrick Flynn's parents?"

**Three candidates identified:**

| Hypothesis | Candidate | Status | Supporting | Contradicting |
|-----------|-----------|--------|-----------|---------------|
| h_001 | Thomas Flynn, Schuylkill Co. | supported | a_004, a_010, a_013 | (none) |
| h_002 | Thomas Flynn, Luzerne Co. | ruled_out | a_035 (same-name, right age) | a_036 (died 1840), a_037 (will excludes Patrick) |
| h_003 | James Flynn, Carbon Co. | active | a_040 (Patrick age match) | (none yet) |

**Process:**
1. h_002 ruled out first — death date impossibility + negative
   evidence from probate
2. h_003 still active — needs investigation (plan a search of
   Carbon County records)
3. h_001 supported — three direct/indirect evidence lines, no
   contradictions. Even without ruling out h_003, h_001 can proceed
   to proof-conclusion at `probable` tier. Reaching `proved` may
   require ruling out h_003 or gathering additional independent
   evidence.

## Out-of-scope requests

This repeats Step 0's scope gate for clarity: if the user asks to resolve a conflict, build a timeline, or write a proof conclusion, respond with ONE sentence naming the correct skill and stop. Do NOT invoke the other skill from within hypothesis-tracking. Do NOT perform any analysis, read any files, or produce any output beyond the redirect sentence.

## Important rules

- **Scope discipline — only modify what the user asked about.** If the
  user asks you to create h_003, only create h_003. If the user asks
  you to link evidence to h_001, only modify h_001. Do NOT proactively
  fix, update, or rule out other hypotheses you happen to notice have
  issues. If you see that h_002 should be ruled out based on evidence
  in its notes, mention it in your response text ("I noticed h_002
  may need to be ruled out — want me to handle that next?") but do
  NOT modify it unless the user explicitly asks. Each hypothesis
  modification should be a deliberate user-initiated action, not an
  opportunistic side-effect.

- **Never modify the `conflicts` section.** The `conflicts` section in `research.json` is owned exclusively by the conflict-resolution skill. When framing a conflict's alternatives as competing hypotheses, create entries in `hypotheses` only. Do NOT update, annotate, or add fields to any conflict entry — not its `description`, `independence_analysis`, `competing_assertion_ids`, or any other field.

- **Never create or modify the `questions` section.** Research questions are managed exclusively by the question-selection and research-exhaustiveness skills. If no questions exist yet, leave `related_question_ids` as an empty array `[]` — do NOT create `q_` entries to fill the reference.

- **Never modify `tree.gedcomx.json`.** This skill only writes to the `hypotheses` section of `research.json`. Adding persons, sources, or relationships to `tree.gedcomx.json` is owned by other skills (init-project, record-extraction, tree-edit). Even if you notice missing persons or sources in the tree, do NOT fix them — note the gap in your response and let the user invoke the appropriate skill.

- **Hypotheses are claims, not facts.** They're tested, not assumed.
  The status should reflect the actual evidence, not the researcher's
  preference.
- **ruled_out_reason is mandatory.** Never silently rule out a
  hypothesis. The reason is the audit trail — it prevents
  accidentally resurrecting a ruled-out candidate later.
- **FAN evidence is regular assertions.** No special treatment.
  Link FAN findings via supporting_assertion_ids like any other
  evidence.
- **Don't confuse hypothesis status with proof tier.** A `supported`
  hypothesis is ready for proof-conclusion, but the proof tier
  (Proved/Probable/Possible) depends on the full body of evidence,
  exhaustive search, and conflict resolution — not just the
  hypothesis status.
- **Competing hypotheses share questions.** Use related_question_ids
  to connect all candidates to the same research question. This
  lets question-selection see the full competitive landscape.

## Evidence integrity

- **Never ignore conflicting evidence.** Every assertion that
  conflicts with a hypothesis MUST go in `contradicting_assertion_ids`.
  Record it first, resolve it later via conflict-resolution.
- **Check for unstated assumptions.** When linking an assertion to a
  hypothesis, ask: "Does this evidence actually support the claim, or
  am I relying on an unstated assumption to connect them?" See the
  three assumption categories in `references/hypothesis-gps-guidance.md`.
  Unsound assumptions carry zero weight without independent evidence.

## Re-invocation behavior

**Writes:** entries in the `hypotheses` section of `research.json`
(`h_` ids), and their `status`, supporting/contradicting assertion
lists, `ruled_out_reason`, and `superseded_by` fields. Mutable in
place; superseded entries are marked, never deleted.

**On repeat invocation:** updates an existing hypothesis's `status`,
assertion lists, or ruled-out fields if new evidence has appeared.
Creates a new `h_` entry only for a genuinely new hypothesis.

**Do not duplicate:** if a hypothesis about the same person identity or
relationship already exists as an `h_` entry, update it in place
(or mark it superseded and link `superseded_by` to a new one). Do
not write a second `h_` covering the same claim.
