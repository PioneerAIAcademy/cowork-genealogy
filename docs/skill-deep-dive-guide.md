# Deep-dive skill review — how to audit one skill and come back with findings

A deep dive starts with **no known failure**. You pick one skill, read what it
actually did across its committed runs, and come back with a list of things it
got wrong that nothing caught.

This is different from [`skill-lifecycle.md`](./skill-lifecycle.md), which starts
from a failure someone already found and walks you through fixing it. Use that
one when you have a bug. Use this one to *find* the bugs.

**Grade nothing here.** You are not reviewing the judge's scores, and you are not
filling in a `.ann.json`. You are reading transcripts against the skill's own
written rules.

---

## Before you start

Pick one skill and give yourself a fixed block of time — half a day is a normal
deep dive. You will not finish the skill; you will finish the time. Findings per
hour is the measure, not coverage.

You need three things open:

| What | Where |
|---|---|
| The skill body | `packages/engine/plugin/skills/<skill>/SKILL.md` |
| Its committed run logs | `eval/runlogs/unit/<skill>/v*.json` |
| Its tests | `eval/tests/unit/<skill>/*.json` |

If the skill delegates to an agent (record-extraction does), open the agent body
too: `packages/engine/plugin/agents/<agent>.md`.

---

## Step 1 — Build the prohibition list

Read the skill body once, start to finish, and write down every rule that is
**checkable against a transcript**. You are looking for sentences shaped like:

- "Never …", "Do not …", "not even as a question"
- "Always …", "Every … must …"
- "Exactly one …", "At most one …", "Stop and return …"
- "Write it into `<field>`" — as opposed to saying it in chat
- "Ground any statement about X in the tool response, never in memory"

Write each as a line you could check by eye, with the wording from the body:

```
1. Must not offer extraction as a next step — "not even as a question"
2. Must not use warm framing — "strong candidate", "very likely ours", "promising"
3. Must not explain away a birth-year conflict of more than a year or two
4. Every search must be logged, including nil results
5. A place written to a fact must come from a place_search response
```

Ten to twenty lines is normal. This list is the deliverable of Step 1 — save it,
because the next person auditing this skill starts from it instead of rebuilding
it.

**Rules that are not checkable from a transcript are out of scope.** "Apply
topical breadth" is judgement; "must include a plan item for the parents'
marriage" is checkable. Only write down the second kind.

---

## Step 2 — Read the transcripts, not the scores

Open the newest run log for the skill. For each test, read
`tests[].runs[].output.text_response` — the actual response — and check it
against your list.

**Do not read `outcome_summary` first.** Once you have seen the judge's score you
cannot un-see it, and you will start confirming instead of looking. Read the
response, decide, then look at the score if you want to.

Two places to look beyond the response text:

- `output.tool_calls` — what it actually called, with arguments. Check any
  identifier it passed (a place, a collection id, a person id) traces back to
  something a previous call returned or something the starting state already
  held.
- `output.file_changes` — what it actually persisted, per section. This is where
  you catch a skill that *said* the right thing and *wrote* something else.

---

## Step 3 — Spend most of your time on the quiet passes

This is the point of the whole exercise.

A test that failed has already been looked at. A test that passed with a clean
rationale has not — and that is where the defects live. The judge and the
annotator both agreed on a `search-records` test five runs in a row while every
one of those runs offered extraction as a next step and three called a
weak match a "strong candidate". Both moves are prohibited by name in the skill
body. Nothing caught it because nothing was looking.

So work the list in this order:

1. Tests that **passed** with all-3 scores — most of your time
2. Tests whose deterministic validators passed but whose behaviour looks off
3. Tests that failed — least of your time, someone already has notes

---

## Step 4 — Place every finding before you propose a fix

Use the same four lanes as the lifecycle guide's lane rule, because most findings
are not skill-prose problems:

1. **Tool defect** — the tool rejected a valid payload or lost data. Goes to an
   MCP tool fix. Prose never compensates for a tool bug.
2. **Grading defect** — the skill did the right thing and got marked down, or did
   the wrong thing and got marked up. Goes to the test's `judge_context` or the
   skill's `rubric.md`, both of which are yours.
3. **Record-type craft gap** — a nuance specific to one record type. Goes to that
   type's reference document, or inline into the agent body if it is an agent's
   gap.
4. **Core doctrine** — a genuine cross-record-type behaviour change. Goes to the
   skill body, and only this lane touches it.

If the skill **followed** its written instruction and still looks wrong, it is
lane 2, not lane 4. Adding more prose to a rule the skill already obeyed makes
the prompt longer and changes nothing.

---

## Step 5 — Write each finding so someone can act on it

Three parts, every time:

> **Did:** what the skill actually did, quoted from the response.
> **Should:** what the rule says it should have done, quoted from the body.
> **Gap:** which lane it is, and what specifically to change.

Example:

> **Did:** "Would you like me to run record-extraction on this record" —
> `ut_search_records_013`, run `v1_2026-08-13_17-42-37`.
> **Should:** the skill body prohibits offering extraction as a next step,
> "not even as a question".
> **Gap:** lane 2. The test's `judge_context` tells the judge the age gap is
> "not a genuine mismatch", so the judge grades the one failure mode this test
> cannot produce. Strike that clause and add the symmetric guard.

A finding without a quote from the transcript and a quote from the body is not a
finding yet — it is a suspicion. Go back and get both.

---

## Step 6 — Turn what you can into a permanent check

A finding you fix by hand comes back. A finding that becomes a check does not.

Before you close out, look at each finding and ask whether it could be decided
mechanically — by counting, by matching a fixed list of values, or by comparing
two things already in the run log. If it can, say so in the write-up and name
what would be compared. A developer can turn that into a validator; they cannot
invent the genealogical rule themselves.

Findings that convert well:

- A field that must hold one of a fixed set of values
- A count — exactly one, at most one, none
- A field that must be set at creation and never changed here
- An identifier that must trace back to a tool response
- A literal phrase that must never appear

Findings that do not convert: anything about whether the reasoning was good.
Leave those with the judge.

---

## What to hand back

- The prohibition list from Step 1, saved for the next auditor
- Each finding in Did / Should / Gap form, with its lane
- For lane 2 findings you own: the fix, made
- For everything else: one issue, or a comment on the issue that already covers it

**Do not open one issue per finding.** Group them by lane and by which paid eval
run they would ride on — two findings on the same skill land on one run and one
annotation pass, and splitting them buys a second run for nothing.

---

## What not to do

- **Do not grade dimensions.** That is a different job with a different output.
- **Do not read the judge's rationale before forming your own view.**
- **Do not edit the base rubric or the global judge prompt.** Those are global —
  post the problem and your proposed wording, and let the lead call it.
- **Do not add prose to a skill body for a rule it already contains.** Check the
  transcript first: if the rule was there and was ignored, restating it is not
  the fix.
- **Do not chase coverage.** You are not trying to see every test. You are trying
  to come back with findings.
