---
name: check-warnings
model: claude-sonnet-4-6
description: Checks genealogical data for impossibilities and anomalies --
  married before age 14, died after 120, child born after parent's death,
  events on impossible dates, conflicting birth or death dates,
  burial dated before death. Surfaces warnings to the user without
  modifying project files; a guardrail skill invoked after
  assertions or person_evidence are added. Use when
  another skill's validation-protocol says "invoke check-warnings", when
  the user says "check for warnings", "are there any problems with this
  data?", "sanity check", or when reviewing assertions before writing a
  proof conclusion. Do NOT use for schema validation (use validate-schema)
  or for resolving conflicts between sources (use conflict-resolution).
allowed-tools:
  - person_warnings
---

# Check Warnings

**Narration:** Read `researcher_profile.narration_guidance` from `research.json` and apply it as your narration style for this invocation. If absent, default to a one-line preamble per action.

Checks genealogical data for impossible or improbable conditions by
invoking the `person_warnings` MCP tool. The tool does the math
deterministically -- same person, same warnings, every time. Your job
is to decide *whom* to check, present the results clearly, and
interpret what they mean for the research.

**Warnings vs. conflicts:** These are fundamentally different things.
Warnings are logical impossibilities -- a single person's data
violates biological, physical, or temporal constraints. Conflicts
are disagreements between two or more sources about the same fact.
This skill handles warnings only. Use `conflict-resolution` for
source disagreements.

## Assumption framework

All warning conditions are grounded in assumption categories. Load
`references/assumption-categories.md` for the full framework.

- **Fundamental** (physical laws) -> tool emits `severity: "error"`
- **Valid** (biological/social norms) -> tool emits `severity: "warning"`
- **Unsound** (unproven premises) -> tool does not fire -- these are
  not warnings, by design

## Quick reference -- common warning tags

So you have a fallback if `references/warning-checks.md` isn't
loaded. Full catalog is in that reference.

**Fundamental (`severity: "error"`):**
- `hasEventBeforeBirth365_2` -- event > 2 years before birth
- `hasEventAfterDeath1` -- event > 1 year after death
- `hasAgeRangeGreaterThan120` -- lifespan > 120 years
- `hasBurialBeforeDeath` -- burial before death
- `hasChristeningBeforeBirth` -- christening before birth
- `hasDeathBeforeChildBirth30_10` / `hasDeathBeforeChildBirth365_2`
  / `hasDeathBeforeChildBirthFemale365` / `hasDeathBeforeChildBirthFemale2`
  -- parent died before a child's birth

**Valid (`severity: "warning"`):**
- `hasEarlyMarriage14` -- married before age 14
- `hasLateMarriage90` -- married > 90 years after birth
- `earliestChildBirthToBirth12` / `earliestChildBirthToBirthMale14`
  -- parent very young at a child's birth
- `tooManyBirthDates2` / `tooManyDeathDates2` /
  `deathRangeGreaterThan2` -- multiple unreconciled vital dates
- `missingFactsAndRelatives` -- empty stub record
- `hasDiffSurnameMale` -- male anchor with conflicting surnames

**Relative-mob variants:**
Any of the above prefixed with `relatives<CheckName>` /
`maleRelatives<CheckName>` / `femaleRelatives<CheckName>` -- same
condition detected on a parent, spouse, or child. The warning's
`personId` is the relative's id, not the focal person's.

## What triggers this skill

Per the validation-protocol embedded in every writing skill:
- After adding assertions to research.json
- After creating person_evidence links
- After proof-conclusion updates tree.gedcomx.json

It can also be invoked directly by the user.

## Steps

### 1. Identify the person(s) to check

The `person_warnings` tool checks one person at a time. Decide which
person(s) to check based on the trigger:

- **Triggered by a writing skill** -- check every person whose
  assertions or person_evidence changed in that skill's run.
- **User-directed** -- use the person id from the request. If the
  user gave a name like "Patrick Flynn" instead of an id, read
  `tree.gedcomx.json` and find the person whose `names[*].given`
  + `names[*].surname` matches. Use that person's `id` field. If
  multiple persons match the name, ask the user which one before
  calling the tool.
- **Batch review before a proof conclusion** -- check the subject
  person and every person whose evidence is cited in the proof.

The person's `personId` is the simplified GedcomX id from
`tree.gedcomx.json` (e.g. `I1`, or a FamilySearch tree id like
`KWCJ-RN4`).

### 2. Call the `person_warnings` tool

For each person identified in Step 1, call:

```
person_warnings({
  projectPath: <absolute path of the current working directory>,
  personId: "<the GedcomX id>"
})
```

`projectPath` is the project folder you are already operating in
(the directory that contains `research.json` and
`tree.gedcomx.json`). Pass its absolute path.

The tool reads `tree.gedcomx.json` itself -- you do not need to load
or summarize facts first. It returns:

```
{
  warningCount: <number>,
  warnings: [
    {
      issueType: "<Java warning tag, e.g. hasEventBeforeBirth365_2>",
      severity: "error" | "warning",
      personId: "<id of the person the warning is about>",
      personName: "<resolved name for display>",
      message: "<one-sentence explanation>"
    },
    ...
  ]
}
```

Some warnings (`relatives*`, `male*Relatives*`, `femaleRelatives*`)
are attached to a relative of the requested person -- the `personId`
in the warning will be the relative's id, not the requested
person's. Treat the warning as "this relationship has a problem,"
not "this specific person has a problem."

### 3. Report warnings

Group the tool's output by person and present each warning with:

- An icon for severity (`severity: "error"` -> [!] Critical;
  `severity: "warning"` -> [!] Note)
- The `issueType` tag (for traceability -- they map 1-to-1 to Java's
  `MobWarnings` tags)
- The tool's `message` (already user-friendly)
- The assumption category it violates (Fundamental / Valid -- see
  `references/warning-checks.md` if the mapping isn't obvious from
  the tag)
- **The specific facts or sources involved.** When the warning's
  optional `factIds` field is populated, name those facts in your
  report (e.g. "fact F3 -- Birth dated 1850"). When it's not, look
  at the person's `facts` in `tree.gedcomx.json` and name the
  relevant ones by id and type plus the source they cite ("source
  S3 -- Death certificate"). Genealogists score actionability by
  whether they can find the record at a glance.
- A short interpretation (see Step 4) when the warning is severe
  enough to warrant one
- A concrete next-step ("Verify the death date against S3" beats
  "verify the source")

**Special case -- `missingFactsAndRelatives`:** This tag fires when
the person has no recorded facts (other than `GenderChange`) and
no relatives -- an empty stub record. Report it with Note severity
and add: "Note: this person has limited data, so most warning
checks need dates and relatives to fire. Adding more research may
surface additional issues currently hidden."

**Before listing individual warnings, count.** If 2 or more
`severity: "error"` warnings fire on the same person, open the
report with a one-line cluster verdict: "2 errors + N warnings on
one person -- a strong identity-confusion signal; see
`references/warnings-as-identity-signals.md`." Then recommend the
identity-split workflow (use `timeline` to find the chronological
split point, then `person-evidence` to audit every assertion and
reassign records that belong to a different individual) as the
primary next step. List the individual warnings *under* that
verdict, not above it. A reader who stops after the first paragraph
should still get the cluster diagnosis -- do not bury it in a
summary table at the end of the report.

**Example output:**

```
WARNINGS FOR: Patrick Flynn (I1)

[!]  Critical -- Event after death  [hasEventAfterDeath1]
    [Fundamental: people cannot act after their death.]
    An event is dated more than 1 year after this person's latest
    death-like fact (F2 -- Death 1908-03-12, source S3 Death
    certificate).

    Likely causes: the death date is wrong, or one of the
    later-dated records belongs to a same-name individual.
    Next: review the person_evidence links for the late event.

[!]  Note -- Long lifespan  [hasAgeRangeGreaterThan120]
    [Valid: people rarely live past 120.]
    This person's lifespan is greater than 120 years (F1 -- Birth
    ~1845, F2 -- Death 1908-03-12).
    Next: verify both vital dates against the cited sources.

(2 warnings total)
```

### 4. Interpret warnings as identity signals

Load `references/warnings-as-identity-signals.md` for the full
interpretive framework. Apply these rules:

- **`severity: "error"` warnings** -> Investigate immediately. These
  almost always indicate data errors or conflated identities
  (records from two different people merged into one profile).
- **`severity: "warning"` warnings** -> Note and recommend
  verification. May indicate twins, blended families, or
  transcription errors.
- **Clustered warnings on one person** -> Escalate. Multiple
  warnings on one person -- especially mixing error and warning
  severities -- strongly suggest identity confusion. See the
  escalation table in `references/warnings-as-identity-signals.md`.
- **Warnings on relatives (`relatives*` tags)** -> The problem is in
  the relationship, not the focal person. Investigate whether the
  relative is correctly linked before assuming the focal person's
  data is wrong.

### 5. Suggest next steps

Based on warning type, recommend a specific handoff:

- **Fundamental-assumption violation** (`severity: "error"`) ->
  "Review person_evidence links -- these records likely belong to
  two different individuals. Use `timeline` to find the identity
  split point."
- **Valid-assumption violation** (`severity: "warning"`) -> "Verify
  [specific assertion or fact] against the original source. If
  confirmed, document the exception."
- **Warnings on a relative** -> The first recommended action is
  always to verify the relationship link itself via
  `person-evidence` (for example: "Is Thomas actually Patrick's
  father, or was a same-name record linked here by mistake?").
  Only after the link is confirmed should you recommend any data
  fix on the relative (adding a missing death date, reconciling a
  vital date). A "fix the data" next-step on a `relatives*` warning
  with no link-verification step first is the wrong
  recommendation: it commits the user to research time on a
  relationship that may not be real, when the warning itself is
  most often a signal that the relationship is wrong.

Clustered-warning escalation is in Step 4; do not duplicate the
recommendation here.

## When NO warnings are found

When the tool returns `warningCount: 0`, simply report: "No
genealogical warnings found for [person]. The tool's checks all
passed."

(For the "limited data" case where the person has no facts and no
relatives, the tool returns `missingFactsAndRelatives` rather than
an empty list -- handle that in Step 3's "Special case" block.)

## Important rules

- **Warnings are informational, not gates.** They don't block
  further work. They surface conditions that MIGHT indicate
  problems.
- **Don't auto-correct.** Report the warning and let the user or
  other skills (conflict-resolution, person-evidence) investigate.
- **The tool is the arbiter. The tree is a dictionary.** The tool's
  output is ground truth for whether a warning fires and what it
  means. Read `tree.gedcomx.json` only to resolve references in the
  tool's output -- looking up a `factId` to name the specific record,
  citing a person's vital dates, identifying which relative a
  `relatives*` warning is about. Do not read the tree to verify
  whether the tool's verdict is correct. If a warning seems to
  conflict with what you see in the tree, the tool's verdict still
  wins: report it as real and surface the apparent conflict to the
  user rather than resolving it yourself.
- **Stay inside what the tool returned.** Do not invent a root cause
  the tool did not name. "The `~` prefix on the birth date is
  probably confusing the date parser," "the tool is calculating
  against the current year because the death date is missing,"
  "there is probably a hidden duplicate fact" -- these are
  speculations the tool did not produce, and they undermine the
  warning instead of acting on it. Do not perform your own date
  arithmetic to "explain" a warning the tool already explained: the
  number `208 years` was never in the tool's response; do not invent
  it. Cite only the `factIds`, sources, and persons the tool's
  response actually mentions.
- **Check after person linking, not just extraction.** An assertion
  in isolation can't trigger most warnings (they require comparing
  dates across persons). The warnings become meaningful after
  person_evidence links assertions to specific persons, which the
  writing skills then mirror into tree.gedcomx.json.
- **Historical exceptions exist.** A 13-year-old bride is unusual
  by modern standards but occurred historically. A 105-year-old
  death is rare but documented. Present warnings with appropriate
  context.

## Handoff rules

- **Warning involves two sources disagreeing** -> This is a
  conflict, not a warning. Hand off to `conflict-resolution`.
- **Warning suggests identity confusion** -> Suggest `timeline` to
  find the split point, then `person-evidence` to reassign records.
- **User asks to fix a warning** -> Do NOT fix it here. Hand off to
  the appropriate skill (person-evidence, conflict-resolution, or
  the user's manual correction).
- **Timeline skill invoked check-warnings** -> Return results to
  timeline's caller; do not start a new investigation.

## Edge cases

- **Approximate dates:** The tool handles imperfect dates internally
  (it widens the comparison window for year-only dates via an
  `imperfectDateFudgeDays` factor). You do not need to add your own
  tolerance. If a warning still fires on dates the user considers
  approximate, surface the warning -- the tool has already accounted
  for normal uncertainty.
- **Multiple persons to check:** When triggered after a batch of
  person_evidence updates, call the tool once per affected person.
  Report each person's warnings separately so the user can act on
  them in order.
- **Empty result:** When `warningCount` is 0, the person passed
  every check the tool currently runs. The tool covers the
  single-person final-warnings from Java's `MobWarnings`. It does
  NOT yet cover merge-mode comparisons (target vs. candidate
  before a tree merge) -- those land in a later release.
- **Tool error or missing data:** If the tool returns an error (for
  example, `personId` not found in `tree.gedcomx.json`), surface
  the error verbatim. Do not try to fall back to manual reasoning
  -- the whole point is determinism.

## Re-invocation behavior

**Writes:** nothing. This skill calls a read-only diagnostic tool
that reports data integrity warnings. It does not modify any
project file.

**On repeat invocation:** safe to run as often as needed. The tool
is deterministic -- the same person on the same tree returns the
same warnings every time. Re-run after fixing data to confirm a
warning is cleared.

**Do not duplicate:** N/A -- no writes.
