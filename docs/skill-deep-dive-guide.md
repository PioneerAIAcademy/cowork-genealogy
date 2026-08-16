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

## Step 6 — Turn every finding you can into a validator

**This is the highest-value half hour of the whole deep dive.** A finding you fix
by hand comes back on the next run and costs a genealogist again. A finding that
becomes a validator is decided for free, on every run, forever — including on
tests written next year by someone who never read your write-up.

Walk your findings one at a time and ask: *could a program decide this by
looking at the run log?* If yes, write a **validator request** and hand it to a
developer. You do not write the Python. You supply the genealogical rule, which
is the half a developer cannot invent.

### What converts

| Shape | Example |
|---|---|
| A field must hold one of a fixed set of values | a first-question-from-objective must record `selection_basis: objective_decomposition` |
| A count — exactly one, at most one, none | at most one new `q_` per invocation; **zero** writes when the skill should have declined |
| A field pinned at creation | a new hypothesis starts `active`; a new question's `exhaustive_declaration` is unstarted |
| A cross-field rule that must always hold | `status: supported` requires at least one supporting assertion whose `evidence_type` is `direct` |
| An identifier that must trace to something real | a collection id in a plan rationale must appear in a tool response from that same run |
| A literal phrase that must never appear | a disqualified namesake must not be offered extraction "not even as a question" |
| Content that must land in a persisted field, not just the chat | a locality fact cited in narration but absent from `plan_items[].rationale` never reaches the next skill |

### What does not convert

Anything about whether the reasoning was *good* — whether a plan was
well-sequenced, whether a narrative reads well, whether an inference was sound.
Leave those with the judge. Trying to mechanise judgment is how a rubric ends up
with a dimension that scores 3 forever.

### Write the request like this

> **Rule:** every new assertion carrying `evidence_type: direct` must cite a
> `source_id` whose source is `original`, not `derivative`.
> **Where to look:** `research.json` `assertions[]` and `sources[]` in the
> after-state.
> **Why it is not judgment:** both fields are closed enums already in the file;
> nothing needs interpreting.
> **What a violation looks like:** `ut_record_extraction_014`, run
> `v1_2026-08-07`, `as_031` cites `src_004` (derivative).

Three sentences and one example is enough. A developer turns that into a
validator in an afternoon, and the rule then holds for every skill run after it.

**If a finding converts, say so even when you also fixed it by hand.** The fix
closes today's instance; the validator closes the class.

---

## What to hand back

- The prohibition list from Step 1, saved for the next auditor
- Each finding in Did / Should / Gap form, with its lane
- **A validator request for every finding that converts** (Step 6) — this is the
  part that stops the finding recurring, and the part only you can write
- For lane 2 findings you own: the fix, made
- For everything else: one issue, or a comment on the issue that already covers it

**The measure of a deep dive is validator requests per session, not findings per
session.** A finding is worth one fix; a validator is worth every future run.

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
- **Do not skip Step 6 because you already fixed it.** A hand fix closes today's
  instance; the validator closes the class. Findings that recur are the ones
  nobody converted.
