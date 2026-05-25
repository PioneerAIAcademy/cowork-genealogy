---
name: hypothesis-tracking
model: claude-sonnet-4-6
description: Creates and updates hypotheses about person identity,
  parentage, and relationships. Links supporting and contradicting
  assertions, manages status transitions (active → supported → ruled_out),
  and tracks competing candidates. GPS Step 3-4 — Analysis, Correlation,
  and Resolution (hypothesis management). Use when the user says "I think
  [claim]", "track this hypothesis", "could this be [candidate]?", "are
  there competing candidates?", "update the hypothesis", "rule this out",
  when competing identity candidates exist, when a conflict suggests
  multiple possible explanations, or when the user wants to organize
  evidence for and against a claim. Do NOT use when the user wants to
  resolve a specific fact conflict (use conflict-resolution), wants to
  build a timeline (use timeline), or wants to write a final conclusion
  (use proof-conclusion).
allowed-tools:
  - validate_research_schema
---

# Hypothesis Tracking

**Narration:** Read `researcher_profile.narration_guidance` from `research.json` and apply it as your narration style for this invocation. If absent, default to a one-line preamble per action.

**After completing every task (including read-only status reviews), call `validate_research_schema` on the project directory before presenting results.**

**STOP IMMEDIATELY if this is an out-of-scope request.** If the user is asking to *resolve* a conflict (apply evidence-weighing or source-independence analysis to choose between competing assertions), respond with exactly one sentence: "This is a conflict-resolution task — please use the conflict-resolution skill." Then stop. Do NOT read any files, do NOT invoke conflict-resolution or any other skill, do NOT proceed with any hypothesis work.

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
- 1860 census lists Patrick as Thomas's "son" (a_010)
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

**`ruled_out`** — Transition when ANY of these are true:
- Evidence affirmatively refutes the claim (e.g., a will names all
  children and Patrick is absent — negative evidence)
- Exhaustive elimination logic excludes the candidate (all other
  possibilities have been investigated and eliminated; this one
  doesn't fit)
- A chronological impossibility makes the hypothesis untenable
  (the candidate was dead before Patrick was born)

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
  + a_010  1860 census: Patrick listed as Thomas's "son" (direct)
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

When you determine that a request falls outside your scope (e.g., the user is asking to resolve a specific fact conflict, build a timeline, or write a proof conclusion), respond with ONE brief sentence naming the correct skill and stop. Do NOT invoke the other skill from within hypothesis-tracking. Example: "This is a conflict-resolution task — please use the conflict-resolution skill to apply the evidence-weighing analysis."

## Important rules

- **Never modify the `conflicts` section.** The `conflicts` section in `research.json` is owned exclusively by the conflict-resolution skill. When framing a conflict's alternatives as competing hypotheses, create entries in `hypotheses` only. Do NOT update, annotate, or add fields to any conflict entry — not its `description`, `independence_analysis`, `competing_assertion_ids`, or any other field.

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
