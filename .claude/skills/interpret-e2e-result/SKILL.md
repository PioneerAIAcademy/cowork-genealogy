---
name: interpret-e2e-result
model: claude-sonnet-4-6
description: Reads an e2e benchmark run log and explains what happened — which expected findings the agent recovered and which it missed (read from its final tree, not the judge's grade), what proof conclusion it wrote, why it stopped, and the most likely cause (agent reasoning regression, /research routing regression, sub-skill regression, FamilySearch data drift, or single-run jitter). Points the user at the right transcript section to read next. Use when the user says "what happened in this e2e run", "interpret this e2e result", "why did this fixture fail", or "read the latest e2e runlog". Do NOT use to author or modify a fixture (use author-e2e-fixture), to interpret a unit-test scratch run (those are developer-facing — read the run log directly), to grade a single research question in a live project (use the relevant analysis skills like timeline or conflict-resolution), or to grade this run into its calibration annotation (use grade-e2e-run — this skill only explains the result and never writes the .ann.json).
---

# Interpret E2E Result

**Narration:** Read `researcher_profile.narration_guidance` from `research.json` if one exists in the working folder; otherwise default to concise narration.

Reads the files an e2e run produces and tells the user what happened in
plain language, with pointers to the relevant transcript section.

Each run writes four files to `eval/runlogs/e2e/<test-id>/`:

| File | Content |
|------|---------|
| `run-<ts>.json` | Structured result. **Read only the harness facts from it — `stop_reason`, `tool_calls[]`, `usage`, `blocked_tree_reads[]`, `error`. Do NOT read `judge_output` (see "Stay blind to the judge").** |
| `run-<ts>.transcript.md` | Readable transcript of the agent's turns |
| `run-<ts>.final-tree.gedcomx.json` | The agent's final tree — the ground truth for what it recovered |
| `run-<ts>.final-research.json` | The agent's final `research.json`, including the proof conclusion it wrote |

This skill reads files; it does not call any MCP tools.

## Stay blind to the judge

**Do not read or report `judge_output` — the judge's `verdict`, `per_finding`
labels, or `proof_quality` score.** Those are the judge's *grades*: the thing
the maintainer calibrates, and unnecessary for explaining what the agent did.
The user runs `/grade-e2e-run` right after this to grade the run **blind**; if
you surface the judge's labels here, that grade is no longer independent and the
calibration number is corrupted.

You have everything the user needs without the judge:

- **What the agent recovered / missed** — compare the final tree to
  `expected-findings.json` yourself. The tree is ground truth; report presence
  or absence as *facts*, not as a verdict.
- **The proof conclusion** — read what the agent *wrote* in `final-research.json`
  (`proof_summaries`). That's the agent's own claim, not a grade.
- **Why it stopped, what it did** — `stop_reason`, `tool_calls`,
  `blocked_tree_reads`, `usage` are harness facts, not judge output.

## What to do

**Ground every claim in the run-log files — do not invent specifics.** You are
reporting what happened, not reconstructing a plausible story. `stop_reason`,
tool counts, and cost come from `run-<ts>.json` (harness fields only). What the
agent found / missed comes from the final tree vs `expected-findings.json`.
Anything more specific — *which* collections were searched, *which* records were
found, *which* index confirmed a date — must come from
`tool_calls[].args`/`response_summary`, the transcript, or `final-research.json`
(the agent's proof summaries and log entries name the actual sources, with ARKs
— quote/cite those). If a specific source name isn't in any of those files,
don't assert it; a plausible-sounding collection name you didn't actually read
is a fabrication.

### Step 1 — Locate the run log

If the user pointed at a specific `run-<ts>.json`, use it. Otherwise
ask which fixture and which timestamp, or take the most recent if
only one is present.

The fixture's `expected-findings.json` lives in `eval/tests/e2e/<id>/`.
Read it alongside the run so you can compare expected vs found yourself.

### Step 2 — Summarize what the agent recovered

Compare the final tree to each `required: true` finding in
`expected-findings.json` and state, as facts, which the tree contains and which
it doesn't. This is recall — *did the tree end up with the stripped facts?* Do
not quote a judge verdict; describe the outcome:

- **All required findings present** — the run recovered the answer. Say so in a
  sentence, then describe the proof conclusion (Step 2b): a recovered answer
  with a thin or missing proof is worth flagging.
- **Some present** — name which it recovered and which it missed; the misses
  are what to investigate (Step 4).
- **None present** — the run recovered nothing. The agent stalled or went
  sideways; `stop_reason` usually explains.
- **No tree at all** (`run-<ts>.final-tree.gedcomx.json` missing) — the agent
  crashed before producing tree state. Read the transcript for the crash.

For a fixture with **negative findings** (`polarity: "avoid"` in
`expected-findings.json`), the correct outcome is the tree **not** asserting the
wrong candidate — absent, or present only as a rejected hypothesis. If the tree
asserts it, the agent over-claimed; call that out specifically — it's the
failure that matters most.

### Step 2b — Describe the agent's proof conclusion

Read the agent's `proof_summaries` from `final-research.json` and summarize the
conclusion it *wrote* — the claim, the evidence it cites, and the
confidence/tier it asserted. Report observable characteristics as facts (e.g.
"rests on a single 1910 census entry," "notes an unresolved date conflict,"
"claims a `proof_argument` tier"). **Do not score its soundness** (1 / 2 / 3) —
that's what the user grades blind next. If no proof summary was written, say so;
it's not itself a failure, just nothing to describe.

### Step 2c — Note any blocked tree-reads

Check `blocked_tree_reads` in `run-<ts>.json`. The harness blocks
`person_read` / `person_search` / `person_ancestors` during a run so the
agent can't read the stripped answer off the live tree (it must research
from records). Each entry is a denied attempt.

- **Empty** — the agent didn't try to shortcut. Normal; say nothing.
- **Non-empty** — the agent *tried* to read the tree but was blocked, so the
  answer, if recovered, was still earned from records. But flag it: a healthy
  `/research` flow shouldn't reach for `person_read` on the subject during an
  autonomous run. Repeated attempts may indicate the skill is leaning on
  tree-reading instead of records, which is worth a look at the `/research` primer.

### Step 2d — Note whether the answer came from provided documents

If the fixture has a `provided-documents/` folder (bundled external
captures — Ancestry PDFs, Find A Grave pages the FS tools can't reach),
check the transcript / `tool_calls` for `Read` of those filenames. **How
the answer was obtained is part of the result**, so say it plainly:

- **A finding came from a provided PDF** — note it (e.g. "the burial
  came from the bundled Find A Grave capture, not a live FS record").
  That's the intended path for external-only evidence, not a problem —
  but a reviewer should know which findings rested on bundled docs vs.
  live research, because only the live-research part reflects agent
  capability against FamilySearch.
- **A provided doc the run needed was never read** — flag it: the agent
  may have missed the bundled evidence, which can explain a miss the
  transcript otherwise makes look like a search failure.

If the fixture has no `provided-documents/`, skip this step.

### Step 3 — Explain the stop_reason

Translate `stop_reason` into something a researcher can act on:

- `completed` — agent set `project.status == "completed"`. Happy path,
  proof-conclusion fired. Look at the final tree to judge quality.
- `natural_end` — SDK ended the conversation but the agent didn't
  declare done. Either the agent thought it was done without setting
  the flag (skill regression), or the conversation drifted to silence.
  Check the last few transcript turns.
- `inactivity` — agent went silent for the inactivity cap window
  (default ~10 min). It's stuck. Find the last tool call in the
  transcript; the issue is usually right after it.
- `timeout` — wall-clock cap fired (default 60 min). Either the
  question is too big for the cap or the agent looped. Skim the tail
  of the transcript for repeating tool-call patterns.
- `tool_cap` — agent hit the per-run tool-call cap (default 200).
  Almost always means looping. Read the last 20 tool calls; the loop
  shape is usually obvious.
- `cost_cap` — hit the per-run cost cap. Same diagnosis as `tool_cap`
  but the cap caught it first.
- `max_turns` — SDK turn limit fired. Rare; usually means a
  conversational loop rather than a tool loop.
- `error` — SDK or harness exception. Read `result.error` for the
  message and the transcript for the surrounding context.

### Step 4 — Compare expected vs found (when the tree is missing some findings)

For each entry in the fixture's `expected-findings.json`, look at the
agent's `run-<ts>.final-tree.gedcomx.json` and decide:

- **Found** — the agent's tree contains the expected person / relationship /
  fact, possibly with different wording or a different source path.
- **Missed** — the agent didn't surface the finding at all. Worth
  asking why: did it search the right collections? Did it find the
  right candidate and then dismiss it? Did it never reach the right
  step?
- **Recorded off-shape** — the agent found the right answer but put it
  somewhere the finding's shape doesn't expect (e.g. on a stub person
  rather than the principal). Diagnosis: finding shape, not agent capability.

For each `missed` finding, search the transcript for the relevant
person name or place. The agent often *touched* the right evidence
but didn't conclude from it; that turn is the diagnostic moment.

### Step 5 — Identify the most likely cause

First decide which situation you're in, because the causes differ:

**First run of this fixture (no prior passing run to compare against).**
"Regression / drift / jitter" don't apply — there's no baseline. The
useful questions are about *this* run:

- **It never researched** — the agent stopped after setup (e.g. wrote a
  question, then `stop_reason: natural_end` with no `record_search` /
  `fulltext_search` in `tool_calls`). The GPS loop didn't advance.
  Pointer: tool counts (no FS search tools) + the last transcript turn.
- **It ran out of budget** — `stop_reason` is `max_turns` / `timeout` /
  `tool_cap` / `cost_cap`. It researched but didn't finish. Pointer: high
  turn/tool counts; check whether `proof-conclusion` was ever reached.
- **The evidence wasn't recoverable** — it searched genuinely but the
  finding isn't findable from records (and isn't a `provided-documents/`
  case). The fixture may be unsolvable as authored — a fixture problem,
  not an agent one.
- **Recorded off-shape** — see Step 4 (finding-shape issue).

**A previously-passing fixture now failing (you have a prior run to diff).**
These are the regression causes:

- **Agent reasoning regression** — the agent took different decisions
  on the same evidence than a prior passing run. Pointer: diff
  `tool_calls[]` against the last passing run for the same fixture.
- **`/research` skill regression** — the agent skipped a GPS step or
  picked the wrong sub-skill. Read the ordered sub-skills the agent ran
  from `run-<ts>.json`'s `tool_calls` — the `Skill` entries' `args.skill`,
  in order (`[tc['args'].get('skill') for tc in tool_calls if tc['tool']=='Skill']`).
  If `proof-conclusion` never appears, that's the smoking gun; if
  `question-selection` is missing where a gap needed one, that's another.
- **Sub-skill regression** — the right sub-skill ran but produced
  worse output than before. Pointer: the relevant `tool_calls` block
  compared to the prior run.
- **FamilySearch data drift** — same tool calls, different results.
  FS may have reindexed or a contributor may have edited the live
  tree. Pointer: `tool_calls[].response_summary` differs from the prior
  run. The agent isn't at fault.
- **Single-run jitter** — Anthropic models are non-deterministic and
  this harness can't pin `temperature=0`. A single finding flipping
  recovered / not-recovered may just be variance. Recommend a re-run
  before drawing conclusions.

If the evidence isn't conclusive, say so — don't force a diagnosis.

### Step 6 — Recommend the next action

Pick the cheapest next step that would actually resolve the
ambiguity:

- Re-run the fixture (cheap and decisive if you suspect jitter).
- Diff against the last passing run log (cheap; commits make this
  easy).
- Open the transcript at a specific turn (point the user at the
  line number or the tool-call index).
- Update the fixture's `README.md` to record what shifted if it
  looks like FS data drift.
- File a regression issue if the cause looks like an agent or
  sub-skill regression.

**Then remind the user to grade this run.** Whatever the outcome — the run
recovered everything, some, or none — it's committed and owes a calibration
grade: tell the user to run `/grade-e2e-run` next to label the findings blind
and write `run-<ts>.ann.json`. Because you stayed blind to `judge_output`, that
grade is still independent. Grading is same-PR, and CI blocks committing a run
that produced a tree without its `.ann.json` (a treeless skip run is exempt).

## What you do not do

- Do not read or report `judge_output` (verdict / per_finding / proof_quality).
  Explain the run from the tree, the agent's proof conclusion, and the harness
  facts — never the judge's grades.
- Do not edit fixtures or skills — interpretation only. If the
  diagnosis points at a fixture problem (e.g. a finding's description is
  too literal to match the tree), tell the user and suggest
  `/author-e2e-fixture` to revise.
- Do not run the e2e harness yourself. The user runs the harness
  on the host where FS credentials and the compiled MCP server live;
  you only read the artifacts it produces.
- Do not pad the output. A clean recovery gets a one-line summary; a
  run with misses gets the analysis above. Skip sections that don't apply.

## Example

User: "Why did the smith-parents-1850 run fail?"

You should:
1. Read `eval/runlogs/e2e/smith-parents-1850/run-<latest>.json` (harness
   fields only — skip `judge_output`).
2. Read `eval/tests/e2e/smith-parents-1850/expected-findings.json` and the
   final tree; the tree contains **none** of the required findings.
3. See `stop_reason: tool_cap`.
4. Skim the last 30 tool calls in the transcript — agent is looping
   on `place_search` for "Augusta County" with three near-duplicate
   queries.
5. Tell the user: "Recovered none of the required findings; stopped at the
   tool cap (200 calls). Agent looped on `place_search` from turn 47 onward —
   three near-duplicate queries for Augusta County. Likely cause: `/research`
   skill regression (place-disambiguation guidance is weaker than the last
   passing run). Recommend diffing `tool_calls[]` against the previous green
   run for this fixture before changing the skill. Then grade this run blind
   with `/grade-e2e-run`."

## Re-invocation behavior

**Writes:** nothing. This skill is read-only — it reads an e2e run
log (harness fields only, never `judge_output`), the agent's final tree and
research files, and the fixture's `expected-findings.json`, and explains the
result in-session. It calls no MCP tools and edits no fixtures, skills, or
project files.

**On repeat invocation:** safe to run as often as needed. Each call is
a fresh read of the run-log artifacts.

**Do not duplicate:** N/A — no writes.
