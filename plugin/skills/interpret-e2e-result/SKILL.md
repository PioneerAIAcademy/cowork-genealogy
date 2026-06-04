---
name: interpret-e2e-result
model: claude-sonnet-4-6
description: Reads an e2e benchmark run log and explains what happened — verdict, stop reason, which expected findings the agent did and didn't recover, and the most likely failure cause (agent reasoning regression, /research routing regression, sub-skill regression, FamilySearch data drift, or single-run jitter). Points the user at the right transcript section to read next. Use when the user says "what happened in this e2e run", "interpret this e2e result", "why did this fixture fail", or "read the latest e2e runlog". Do NOT use to author or modify a fixture (use author-e2e-fixture), to interpret a unit-test scratch run (those are developer-facing — read the run log directly), or to grade a single research question in a live project (use the relevant analysis skills like timeline or conflict-resolution).
---

# Interpret E2E Result

**Narration:** Read `researcher_profile.narration_guidance` from `research.json` if one exists in the working folder; otherwise default to concise narration.

Reads the four files an e2e run produces and tells the user what
happened in plain language, with pointers to the relevant transcript
section.

Each run writes four files to `eval/runlogs/e2e/<test-id>/`:

| File | Content |
|------|---------|
| `run-<ts>.json` | Structured result: `verdict`, `stop_reason`, `judge_output`, `usage`, `tool_calls[]` |
| `run-<ts>.transcript.md` | Readable transcript of the agent's turns |
| `run-<ts>.final-tree.gedcomx.json` | The agent's final tree (what the judge graded) |
| `run-<ts>.final-research.json` | The agent's final `research.json` |

This skill reads files; it does not call any MCP tools.

## What to do

### Step 1 — Locate the run log

If the user pointed at a specific `run-<ts>.json`, use it. Otherwise
ask which fixture and which timestamp, or take the most recent if
only one is present.

The fixture's `expected-findings.json` lives in `eval/tests/e2e/<id>/`.
Read it alongside the run log so you can compare expected vs found.

### Step 2 — Explain the verdict in one sentence

Read `verdict` from `run-<ts>.json` and translate:

- `pass` — the agent recovered every `required: true` finding. No
  further interpretation needed unless the user asks "how cleanly".
- `partial` — the agent recovered some but not all required findings.
  Worth investigating which ones it missed.
- `fail` — the agent recovered no required findings. The run is
  probably uninformative on agent capability — the agent stalled or
  went sideways. Stop reason usually explains.
- `skipped` — the judge didn't run. Agent crashed before producing a
  tree, or `--skip-judge` was passed. Read the transcript for the
  crash; the result file has no judge output.

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

### Step 4 — Compare expected vs found (when verdict is partial / fail)

For each entry in the fixture's `expected-findings.json`, look at the
agent's `run-<ts>.final-tree.gedcomx.json` and decide:

- **Matched** — the agent's tree contains the expected person /
  relationship / fact, possibly with different wording or a different
  source path.
- **Missed** — the agent didn't surface the finding at all. Worth
  asking why: did it search the right collections? Did it find the
  right candidate and then dismiss it? Did it never reach the right
  step?
- **Recorded elsewhere** — the agent found the right answer but put
  it in a place the judge didn't read (e.g., wrote it to a stub
  person rather than the principal). Diagnosis: judge prompt or
  finding shape, not agent capability.

For each `missed` finding, search the transcript for the relevant
person name or place. The agent often *touched* the right evidence
but didn't conclude from it; that turn is the diagnostic moment.

### Step 5 — Identify the most likely cause

Based on the verdict, stop reason, and expected-vs-found analysis,
name one likely cause and point at the evidence:

- **Agent reasoning regression** — the agent took different decisions
  on the same evidence than a prior passing run. Pointer: diff
  `tool_calls[]` against the last passing run for the same fixture.
- **`/research` skill regression** — the agent skipped a GPS step or
  picked the wrong sub-skill. Pointer: `skills_invoked` order in the
  transcript. If `proof-conclusion` never fires, that's the smoking
  gun; if `question-selection` skips a gap, that's another.
- **Sub-skill regression** — the right sub-skill ran but produced
  worse output than before. Pointer: the relevant `tool_calls` block
  compared to the prior run.
- **FamilySearch data drift** — same tool calls, different results.
  FS may have reindexed or a contributor may have edited the live
  tree. Pointer: `tool_calls[].response` shape differs from the prior
  run. The agent isn't at fault.
- **Single-run jitter** — Anthropic models are non-deterministic and
  this harness can't pin `temperature=0`. A single finding flipping
  matched/partial may just be variance. Recommend a re-run before
  drawing conclusions.

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

## What you do not do

- Do not edit fixtures or skills — interpretation only. If the
  diagnosis points at a fixture problem (e.g., the judge can't match
  a finding because the description is too literal), tell the user
  and suggest `/author-e2e-fixture` to revise.
- Do not run the e2e harness yourself. The user runs the harness
  on the host where FS credentials and the compiled MCP server live;
  you only read the artifacts it produces.
- Do not pad the output. A passing run gets a one-line summary; a
  failing run gets the analysis above. Skip sections that don't apply.

## Example

User: "Why did the smith-parents-1850 run fail?"

You should:
1. Read `eval/runlogs/e2e/smith-parents-1850/run-<latest>.json`.
2. Read `eval/tests/e2e/smith-parents-1850/expected-findings.json`.
3. See `verdict: fail`, `stop_reason: tool_cap`.
4. Skim the last 30 tool calls in the transcript — agent is looping
   on `place_search` for "Augusta County" with three near-duplicate
   queries.
5. Tell the user: "Failed at the tool cap (200 calls). Agent looped on
   `place_search` from turn 47 onward — three near-duplicate queries
   for Augusta County. Likely cause: `/research` skill regression
   (place-disambiguation guidance is weaker than the last passing
   run). Recommend diffing `tool_calls[]` against the previous green
   run for this fixture before changing the skill."
