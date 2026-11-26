# Research step mode spec

`/research` runs one step per turn. A step is one agent spawn (or one `Skill` call),
plus the tool calls it needs and any repeat of the same step. After it returns, the
router reports what the step found and ends the turn with "Continue with <label>?". The
researcher answers with a reply phrase ("Continue.", "Wrap it up.", "Search more."), a
question, a steer or an upload. The router prose is the same on every plane, and every
plane also enforces the boundary in code. The FamilySearch prototype worker and the web
app (the hosted alpha) run a `PreToolUse` gate that denies a second step and halts the
turn if the model tries again; the eval harnesses apply the same gate. On the connector
(Claude's chat) and in Cowork a plugin hook denies a second step and never halts. Before
any search, a job stops three times: after setting up the project, after choosing the
question, and after planning the searches. The motive is that a researcher must get a
response after each step, not after many silent minutes, and must be asked wherever
their judgment matters.

**Status:** Shipped. Phase 0-2 complete, 2026-11-09.

Related contracts:
- `docs/specs/completion-halt-spec.md`: the halt that ends a turn when proof-conclusion
  completes the project. Not repeated here.
- `docs/specs/guardrail-enforcement-spec.md`: the step boundary's row in the guardrail
  table.
- `docs/adrs/ADR-0005-ship-the-write-lockdown-as-a-plugin-hook.md`: phase 0's
  measurements of Cowork and the hosted planes.
- `docs/architecture.md` §9.4, gap 4: only a live session proves the connector and Cowork
  step hook binds.

## Decisions

Each decision is stated in its current form. Where a later decision changed it, the
entry says so.

### Taken 2026-10-16 (lead)

1. **Step mode on every production plane** (Cowork, the connector, the hosted alpha, the
   FS prototype). Each turn does one step, reports it in plain language, and ends with
   "Continue with X?". How the code enforces it differs by plane (decision 25).
2. **Steps may be long.** Nothing happens mid-step: no time budgets, no progress
   check-ins, no splitting a step. Making steps short is separate work.
3. **Pause only where the researcher's judgment matters.** About 5 prompts in a typical
   run.
4. **One question per run.** A message holding two questions gets a reply asking for one
   (section E).
5. **"Execute the plan" is one step, run in parallel.** The searches fan out one level
   down from the router, at most 4 spawns per assistant message (section D).
6. **At "not exhaustive", the researcher chooses** between concluding and searching
   more. research-exhaustiveness's overturn-risk verdict sets the default (section B).
7. **"Continue." is the only way forward** (lead, 2026-11-23 and 2026-11-24). It
   replaced "Keep going is an option", which ran the rest of the flow without stopping to
   ask. A typed "Keep going." reads as "Continue." and runs one step, and no button offers
   it (section A2).
8. **"Wrap it up" is available at any boundary** (widened by decision 15). It stops
   further research and writes the conclusion from what was found. That may fall short of
   the GPS's reasonably exhaustive search, and the conclusion says so.
9. **Losing the early stop on easy questions is accepted.** Fallback chains in the plan
   recover most of it (section D).
10. **e2e continues on its own:** a simulated researcher answers each boundary the way a
    researcher would, "Continue." at each offer, carrying the opener's `--autonomous`
    flag (section F).
11. **The reply phrases may change** on user feedback.
12. **A conflict that cannot be settled stays `unresolved`,** rather than being recorded
    as `resolved` with kind `tree`. The run ends on the conclusion it leaves open
    (section E).
13. **SUPERSEDED by decision 7.** It made "Keep going" the host replying for the
    researcher at the end of each one-step turn. No plane sends a reply for the researcher
    now. No hosted turn binds a Stop veto (section A).

### Taken 2026-10-18 (lead)

14. **Show only the replies that apply.** The host works out which buttons a turn gets
    (`reply_options`) and sends them on `turn_done.options` (section A).
15. **"Wrap it up" works before any evidence exists,** and closes the question at the tier
    reached, `not_proved` included. A different question mid-run is answered with an offer
    to wrap the current one up first (section E). No question is left unconcluded without
    the researcher saying so, and there is no parked state.
16. **Errands are steps.** An external-site search ends its step naming what to fetch, and
    the researcher can carry on without waiting for the upload (section I).
17. **A question about the findings gets an answer, not a step** (section J).
18. **New top-level tasks are agents,** entered through the router, each with a step
    group. An all-code task is the exception: a bounded-list line naming its tool calls,
    with no step group (section K).
19. **The prose shipped as small PRs,** one eval slot each (see History).
20. **Helper work becomes plan items on the current question,** not new questions: a
    conflict that needs new evidence, a FAN pivot, an objective-level sub-question
    (section E).
21. **`deferred` is a closed-enum value** of `not_reached`, not prose (section B).
22. **`--autonomous` stays as e2e's opening. Rescinded by the lead on 2026-11-10;** it was
    to be retired once e2e ran on the host's replies. The e2e orchestrator opens every run
    with `/research --autonomous <question>` (`_render_user_message` in
    `eval/harness/e2e/orchestrator.py`), and that flag gives search-external-sites
    `userPresent: no` in e2e. The orchestrator writes no delegation, so it
    cannot pass `userPresent: no` itself, and production routing is measured by the
    single-ask panel (`make e2e-single-ask`), not e2e. The ruling also rests on the routing
    failures recorded from alpha feedback: all but one began from a single ask, not an
    e2e-shaped question. The two other options lost: renaming the flag keeps it under
    another name, and opening e2e on production routing would mix routing misses into
    e2e's research-quality score and break comparisons across the corpus.
23. **The `AskUserQuestion` decision carrier is kept.** Taken as "drop the carrier", then
    REVERSED by the lead on 2026-10-19: phase 0 measured that a `PreToolUse` deny does not
    end a turn on the alpha, and that `AskUserQuestion` waits in Cowork but does not end
    the turn either (ADR-0005 item 10). `DecisionCard` remains the web's home for a
    decision.

### Taken 2026-10-19 (lead)

24. **SUPERSEDED by decision 25.** It said the boundary is `AskUserQuestion` and nothing
    else ("no halt"). Its premise, that `AskUserQuestion` ends the turn, was measured
    false in Cowork (ADR-0005 item 10).
25. **Enforce the boundary in code on every plane.** Taken for the FS prototype on
    2026-10-19, widened to the web app on 2026-11-19 and to the connector and Cowork on
    2026-11-24 (lead). The model's own report and end of turn is the normal path; the gate
    is the backstop.
    - **Prototype and web app.** A first out-of-group step is **denied** with an
      instruction to report and end the turn; a second attempt in the same turn **halts**
      it, and the halt also denies the call it stops (`StepGate` in `step_boundary.py`).
    - **Connector and Cowork.** A plugin hook, `step_gate_hook.py`, **denies** every
      out-of-group step and never halts. It gates only this plugin's research steps, so
      Claude Code's own agents and skills, where the plugin also loads, pass untouched.
      A deny makes the model report and end its turn;
      a halt ends a Cowork turn with nothing on screen (ADR-0005).
    - **Rider 1:** the rule is "no new step until the researcher has answered since the
      last one", not "one step per turn". In Cowork the answer to `AskUserQuestion`
      returns inside the same turn.
    - **Rider 2:** every deny and halt on the prototype and the web app is logged
      (`ev=step_boundary`). The router prose is identical on all planes, so that rate
      estimates how often a run tries to cross a boundary it was told to stop at.
    - **Rider 3:** the eval harnesses load the library in process, not the plugin hook,
      so no eval proves the connector and Cowork hook binds. Only a live session does.
      Recorded as `docs/architecture.md` §9.4, gap 4.
    - **Amended 2026-11-24 (lead):** `step_boundary.py` stays a library, and
      `step_gate_hook.py` beside it imports it (section A). This replaces the 2026-10-21
      amendment that it is never a registered plugin hook.

### Taken 2026-10-25 (lead)

26. **`foreground_rewrite` stays.** Claude Code runs an `Agent` call with no
    `run_in_background` key in the background, and the turn can end while its agents
    still run. The prototype worker reads a turn only to its first result and then kills
    the CLI (`_run_turn` in `worker.py`: `client.disconnect()`, then
    `turn_users.kill_uid`), so a background agent dies mid-search. `foreground_rewrite`
    (`apps/server/app/agent/continue_policy.py`, with `DELEGATION_TOOLS`) rewrites every
    such call to `run_in_background: false`. It is applied by `real_agent.py`,
    `proto/worker/options.py`, and the harness copy `eval/harness/harness/delegation.py`
    (pinned by `test_foreground_rewrite_parity.py`). The step check runs ahead of it and
    only denies or halts, so an allowed step's spawns are still foregrounded.
27. **Agents run in the foreground by the router's wording first.** The router's spawn
    rule passes `run_in_background: false` on every `@plugin:` spawn. Measured in Cowork
    on 2026-10-29 (Claude Code 2.1.312): its `Agent` tool offers no `run_in_background`
    key, a plugin hook's `updatedInput` is applied, and a 154.5 s agent stayed in the
    foreground. So every Cowork agent already runs in the foreground; the wording matters
    on the hosted planes and is harmless in Cowork. No plugin hook arm. On the prototype
    the worker's `ev=foregrounded` line fires only on a spawn the wording missed, which
    estimates the miss rate on every plane.
28. **Step mode measures cost as well as wait:** spend per step, and the reply each
    boundary got ("Measuring respond sooner").

### Taken 2026-11-24 (lead)

29. **A job stops three times before searching:** after setting up the project
    (init-project alone, before any attached record is read), after choosing the question,
    and after planning the searches (locality-guide when the place is unsurveyed, then
    research-plan, in one turn). The setup stop always asks what the researcher wants to
    verify or research, and whether anything shown is wrong or missing. A reply that asks
    to verify a relationship or fact, or names one or a source as wrong, removes it first,
    as a clean slate: forget-and-rederive's verify mode, `tree_forget` with `cleanSlate`
    (`tree-forget-tool-spec.md`). The research rebuilds it from records ("What the
    researcher sees", section A). The request is the reply, or with no reply the
    project's objective (a first message asking to verify a person's facts or
    relationships is a research job, so it becomes the objective). It is narrow when it
    names a particular relationship, fact or source, and only a narrow request removes
    anything. A broad one ("are his facts and relationships correct?") is its project's
    whole work: the attached-records baseline, then source-evaluation and check-warnings
    in one turn, removing nothing. The turn ends with no offer, and gives each finding as
    its own next project: a new project from the same person ID whose setup reply is the
    narrow request (lead, 2026-11-24: an audit, broad or narrow, is its own project, as a
    chat is).

## Evidence

Alpha feedback, November 2026. A tester read "linking the records" as attaching records
to the FamilySearch Family Tree, so the label now names the project. In another session
the main thread ended 8 turns with the link offer, and each time the tester answered with another search request ("I was asked
whether the records found should be linked, when the research was still quite
incomplete"). The tester was passing over the offer, not refusing the step, so a search
step opened by a steer keeps the same offer. The sentence before it says linking can wait
and another search can be named. Keeping the offer leaves the last-line format that
`offered_step` parses unchanged.

Alpha feedback, October 2026: after question selection, one run cost $49.84 over about 361 live
minutes. Each "not exhaustive" verdict auto-produced a new plan, in three passes
($22.65, $5.73, $20.15). No one was asked, and the second verdict named the best
remaining leads as manual film browses. In the e2e corpus at the time, 35 of 207
committed runs (17%) gave one question two or more plans.

Web app feedback, 18 November 2026: one turn answering "Yes, can you search all of them?"
ran 36 agent spawns across every step for 49 minutes with no stop, ran out of context 25
minutes in, and read three researcher messages only between spawns. That produced the web
app's gate (decision 25).

Feedback bundles from 27 October to 23 November 2026 (about 28 project openings) and the
November e2e runs: the plan was never shown before the searches in 4 of the 4 openings
read in full (6–14 November); the router condensed about 1,800 characters of agent
summaries to a median of about 470; 0 of 12 openings (16–23 November) asked what the
researcher knew, and testers corrected tree facts after a plan built on them in five
sessions; the main thread chose a person ID from a name search twice; and locality-guide
took about 75% of the first turn (median 167 s, up to 15 minutes). That produced the three
stops (decision 29) and the main thread's `person_search` deny
(`guardrail-enforcement-spec.md`).

## What the researcher sees

| Step | Runs | Ends with |
|---|---|---|
| Setup: init-project alone | a new project, on a job | the subject's birth and death as the tree gives them, the relatives, the attached sources as `S<n>: <title>`, "What do you want to verify or research? Is anything here you think is wrong, or do you know or have anything that isn't here?", then "Continue with choosing the question?" |
| Question: forget-and-rederive's verify mode when the reply disputes a conclusion or source, the attached-records baseline (`extraction_append` with `personId`, then `timeline_build`: tool calls, not steps; `research-append-tool-spec.md` §11.8), then question-selection | always | what was removed (counts), the timeline, the question in full with its place and period, then "Continue with planning the searches?" |
| Plan: locality-guide if the place is unsurveyed, then research-plan | always | locality-guide's findings and the plan, each in full, then "Continue with running the searches?" |
| Search: every plan item in parallel, then extraction | always | what was found, any searches only the researcher can run (section I), then "Continue with linking the records to people in this project?"; when a steer opened the step and the previous turn offered linking, the sentence before that line says linking can wait and another search can be named |
| Link: person-evidence | always | what attaches to whom |
| Conflict resolution | only on a conflict | its own step; when the evidence in hand cannot settle it, the record that could, then "Continue with planning the searches?" (section E) |
| Hypothesis tracking | only on competing identities | its own step |
| Assess: research-exhaustiveness | always | "exhaustive", or the choice (section B) |
| Conclude: proof-conclusion | always; the last step | the full output, no offer |

The replies:
- **"Continue."** Run the offered step. A typed "Keep going." reads the same (section A2).
- **"Wrap it up."** Stop searching and write the conclusion now (section B2).
- **"Search more."** Only at the exhaustiveness choice: plan the sources left unsearched.
- **An upload.** A capture for an external-site search handed out earlier (section I).
- **A question about the findings.** Answered from the project, with no step run
  (section J).
- **Free text.** A steer: a new plan item on the current question, or at the plan step a
  plan edit (section G).

The prototype's web app shows one button per reply that applies and nothing else; each
sends its exact phrase. Cowork, the connector and the alpha show no buttons; the reply
names the phrases.

## Design

### A. The step boundary

**The library.** `packages/engine/plugin/hooks/step_boundary.py` is stdlib-only and does
no I/O. It lives in `plugin/hooks/` and is a library, not a registered hook (lead,
2026-11-24). Both hosted planes (`load_step_boundary` in `apps/server/app/agent/plugin_lib.py`,
re-exported by `apps/server/proto/worker/options.py`) and both harnesses load it with
`importlib.util.spec_from_file_location`, the way
`eval/harness/harness/context_policy.py` loads `guard_project_files.py`, and the
registered hook beside it, `step_gate_hook.py`, imports it for the connector and Cowork.
One copy, so no parity test.

**The predicate.** `step_allowed(turn_steps, candidate, mode, ctx)` allows the turn's
first step and the members of that step's group:

| Group | Members |
|---|---|
| setup | `init-project` |
| question | `question-selection` |
| plan | `research-plan`, `locality-guide` |
| search | `search-records`, `search-images`, `search-full-text`, `search-external-sites`, `record-structurer` |
| link | `person-evidence` |
| conflict | `conflict-resolution` |
| hypothesis | `hypothesis-tracking` |
| assess | `research-exhaustiveness`, `research-plan` |
| conclude | `proof-conclusion` |
| forget | `forget-and-rederive`, `init-project`, `record-structurer`, `question-selection` |
| one member each (`_SOLO`) | `tree-survey`, `search-hints`, `source-evaluation`, `survey-surname`, `timeline`, `gps-mentor`, `citation`, `translation`, `historical-context`, `check-warnings`, `tree-edit`, `convert-dates`, `search-familysearch-wiki`, `search-wikipedia`, `validate-schema`, `where-else-to-search`, `evaluate-search-results` |

- **A step may always repeat itself** (a fan-out), and the router `research` is always
  allowed.
- **Names are compared after the last `:`** (`bare_name`), so a plugin-prefixed spawn
  matches.
- **Every shipped agent and skill has a group.**
  `test_every_shipped_agent_and_skill_has_a_group` in
  `eval/harness/tests/unit/test_step_boundary.py` fails when one is in none, so a new
  agent cannot ship without a decision about what may follow it. The router is exempt by
  name. The same file fails on a group member that no longer ships, and on a group with
  no `STEP_LABELS` entry.
- **A step that opens a turn uses its home group** (`HOME_GROUP`): research-plan → plan,
  locality-guide → plan, question-selection → question, record-structurer → search.
  **init-project fixes no group** (`UNGROUPED_OPENER`, `opening_step()`): the step after it
  does, so a bounded first message runs its deliverable in the turn that created the
  project. **A turn init-project opens never admits question-selection or research-plan**
  (`_NOT_AFTER_SETUP`), at any point in the turn, so a job stops after setup; after
  init-project and then locality-guide, only locality-guide may repeat. The gate keys
  this on spawn order, not on there being no project, so a wasted init-project spawn on an
  existing project lets a second group through. The overlaps only admit a follower:
  - `locality-guide` after research-plan, because research-plan stops for an unsurveyed
    place;
  - research-plan after research-exhaustiveness, **only while `ctx` shows an open item**
    (dispose's precondition), so a decline turn cannot start a new plan;
  - `search-hints` after a search-group step, because a hints plan item runs in the search
    step. Its home group stays its own, so a turn it opens admits no search;
  - `question-selection` after forget-and-rederive, so a verify reply's removal and the
    question it leads to run in one turn.
- **An `Agent`/`Task` call that names no agent** is read as `general-purpose`
  (`UNNAMED_SPAWN`), which is in no group: it may open a turn and may follow nothing.
- **A subagent's call is never a step.** The gate checks main-thread calls only.

**`ctx`** carries what the turn's steps cannot show. `step_ctx(research)` computes it from
`research.json`:
- **The current question** is `current_question(research)`: the last entry in
  `questions[]` whose status is not `resolved`. This includes a concluded question whose
  conflict is getting its evidence round.
- **`open_items`:** whether that question's active plan has a `planned` or `in_progress`
  item, not counting one waiting only on an upload (`awaiting_upload_item_ids`, section
  I).
- `ctx` is read lazily, only when research-plan is the candidate. A host that cannot read
  it passes nothing, and the follower is denied: the cost is one needless pause, never an
  unasked plan.

**Modes.** `step_mode(text)` maps the message, by exact phrase with case and trailing
punctuation ignored (`normalize_reply`): "wrap it up" → `wrapup`, anything else, "Keep
going." included → `step`. One normalizer serves every plane, so a typed "Wrap it up!"
starts the same thing everywhere.
- **`wrapup`** allows only `WRAPUP_ORDER`, in order, skipping ahead but never going back:
  1. `research-plan` (dispose), only while `ctx` shows an open item;
  2. `person-evidence`;
  3. `conflict-resolution`;
  4. `research-exhaustiveness`;
  5. `proof-conclusion`.

  Router prose says when a member is skipped: person-evidence runs only for unlinked
  assertions (or when `project_context`'s `nextStep` names it), and conflict-resolution
  only when an unresolved conflict blocks the question.

**The deny reason** (`deny_reason`): "Step complete. Give the researcher your report on
the step that just finished, end with "Continue with <label>?", and end your turn." The
label is the `STEP_LABELS` entry for the denied step's home group. In a wrap-up turn
still under way it offers `wrap-up`. A record-structurer stopped in a turn that
`evaluate-search-results` opened offers `extract-matches`. A step stopped in a turn
init-project opened offers `question` ("choosing the question") when init-project ran
alone or the step is question-selection or research-plan.

**`StepGate`** carries one turn's boundary:
- **Deny first, halt on a second attempt** (decision 25). The halt also denies the call
  it stops.
- **`halt_offer`.** Two spawns in one message both reach the gate before the model reads
  a deny, so the second halts a turn that never wrote its offer line. The gate keeps the
  offer the halt named, and the worker, the web app and the e2e host read it in place of
  the turn's last line.
- **The step that fixed the turn's group is persisted the moment it is allowed**
  (`on_first_step`): the first step, or the one after init-project. It goes to
  `turns.step` and `turns.mode`, so a redelivered attempt seeds `steps` from the row and
  cannot start a second step. Redelivery is the normal resume path, and an interrupted
  attempt never reaches `complete()`.
- **Every deny and halt is logged** as `ev=step_boundary` (rider 2).

**Where it is enforced:**

| Plane | Where | Notes |
|---|---|---|
| Prototype worker | `_run_turn` in `apps/server/proto/worker/worker.py` builds the `StepGate`; `proto/worker/options.py`'s `PreToolUse` consults it after the halt arm | `turns.step`/`turns.mode` from `apps/server/proto/sql/015_turn_step.sql`; a gate that cannot be built logs `ev=step_gate_unavailable` and the turn runs ungated |
| Web app (alpha) | `apps/server/app/agent/real_agent.py`: `_begin_turn_hook_state` builds the turn's `StepGate` from its text before the query; a `PreToolUse` matcher on `Agent`, `Skill` and `Task` consults it on the main thread | deny, then halt on a second attempt; a halted turn whose last line offers nothing ends on the halt's offer line (`_halt_offer_line`); a gate that cannot be built is logged and the turn runs ungated |
| Connector and Cowork | `packages/engine/plugin/hooks/step_gate_hook.py`, registered in `hooks.json`: a second `PreToolUse` entry on `Agent\|Task\|Skill` and a second `UserPromptSubmit` entry | denies every out-of-group step and never halts. The turn's `{prompt_id, mode, steps, denials}` lives in a per-session state file under the temp directory, updated under an `O_CREAT\|O_EXCL` lockfile (a lock held past 2 s allows the call; one older than 20 s is broken). Only a researcher's `UserPromptSubmit` starts a turn, read after the runtime's leading `<system-reminder>` blocks; a hand-back (`<agent-message`) or a message carrying the stored `prompt_id` does not, nor does a `PreToolUse` carrying an unseen `prompt_id`. It gates only this plugin's steps. It reads no `research.json` (ADR-0005 item 7), so `ctx` is `{"open_items": true}` in `wrapup` mode and none in `step` mode: a dispose after an exhaustiveness decline waits one turn. Silent under `GENEALOGY_HOSTED_PLANE`; any failure allows the call. Measured in a claude.ai connector chat (2026-11-25, n=1, claude-code cloud session): the hook binds and its state file persists across calls; every hook call carries `prompt_id`; each researcher prompt opens with a `<system-reminder>` block; a hand-back is a `UserPromptSubmit` beginning `<agent-message` with its own new `prompt_id`, which the main thread's next calls carry; a message sent mid-turn keeps the turn's `prompt_id`; `transcript_path` is empty; the spawn tool is `Agent` with `subagent_type` `genealogy-research:<agent>`, and the router a `Skill` `genealogy-research:research`. Whether the model ends its turn after a deny was not exercised: that run tried no second step |
| Unit harness | `eval/harness/harness/skill_runner.py` | opt-in per test through `execution.step_mode`; the check runs before the stubs |
| e2e harness | `eval/harness/e2e/orchestrator.py` with `turn_loop.py` | every run since phase 2 |

**No Stop veto.** No hosted plane binds a `Stop` hook. `apps/server/tests/test_no_stop_veto.py`
pins that. `turns.nudges` and `turn_costs.continuations` remain and are always 0.

**Outcomes.**
- A step turn ends `ok`, which renders no label.
- The worker sets `completed` at turn close on the first `ok` turn that sees a completed
  project (`project_completed`), when no other turn of the project already carries the
  label (`completed_already_labelled`). It cannot know whether the project became
  complete during the turn without reading `research.json` at turn start, which a down
  store must not be asked for. Consequences:
  - when the completing turn closed `stopped`, `budget` or `delivered`, the next ordinary
    turn carries the label, which is right: the project is complete;
  - **known gap:** a project completed a second time (a follow-up question wrapped up
    after the first completion) is not labelled again, unless the completion halt fired,
    which sets `completed` itself. The fix is to stamp the project's completeness on the
    turn row at close and compare with the previous closed turn: one column, one small
    query, no extra `research.json` read, and a migration. Not built; the lead's call.

**The router** (`packages/engine/plugin/skills/research/SKILL.md`, "One step per turn"):
- runs one step, relays its report, ends with "Continue with `<label>`?" using the exact
  label from its table, and ends the turn;
- says what the step will act on in the sentence before the line;
- writes no "Continue with …?" line after a step that ends on a question only the
  researcher can answer, after a final conclusion, or after a step that found nothing
  further to do;
- has no "continuous work" orders and no instruction not to yield.

**Web (prototype).** `reply_options(offered_step, research)` decides the buttons, keyed
on the turn's **offer line**, never on the step it ran:
- nothing when the turn makes no offer;
- only "Wrap it up." when the offer is `wrap-up`;
- otherwise "Continue.", plus:
  - "Wrap it up." when there is a current question and the offer is neither the conclude
    step (Continue already concludes) nor setup or choosing the question (the offers after
    setup and after a wrap-up);
  - "Search more." when the offer is the conclude step at a low-risk choice: a
    `resources_spent` stop whose `justification` opens "Overturn risk: low", and no proof
    summary. Read from the state, so a question between steps that repeats the offer keeps
    the button.

The worker reads `research.json` once at close for `completed` and `options`, puts the list on `turn_done` as `options` (absent when empty), and the
browser (`replyOptions` in `apps/web/src/components/chatEvents.ts`, `ChatPane.tsx`) shows
exactly those. The router keeps a one-line decline for a typed "Search more" away from the
choice. The alpha sends no `options`.

### A2. "Keep going" is retired

- **"Keep going." reads as "Continue."** (decision 7). `step_mode` gives `step`, the
  router runs the offered step, and `reply_options` offers no "Keep going." button. No
  plane sends a reply for the researcher.
- **Every offer line uses its step's exact `STEP_LABELS` entry,** so a host can read
  which step is offered. `offered_step(text)` reads the turn's **last** line; a line that
  names no entry is no offer. `offer_line` and `offer_key` are the write side.
- **Prototype.** The host's automatic reply chain is gone. Migration
  `apps/server/proto/sql/020_retire_auto_reply.sql` closes `superseded` any reply the
  chain queued that nothing claimed, so it is never released ahead of the researcher's
  next message, then drops `sessions.auto_reply` and `turns_session_step_idx`.
- **The resume prompt** (`RESUME_CONTINUE_TEXT`, `options.py`) tells a redelivered attempt
  to finish the step and end with its "Continue with …?" line.
- **e2e** answers each boundary with a simulated researcher (section F).

### B. The choice at "not exhaustive"

- **research-exhaustiveness on a decline** (every active-plan item closed or waiting only
  on an upload, a genuinely unsearched source remaining) writes `search_stop` with:
  - `stopped_because: "resources_spent"`, `stop_criteria: null`;
  - `log_entry_ids` listing the log entries of every plan of the question;
  - `justification` opening with the verdict, "Overturn risk: low" or "Overturn risk:
    high" followed by the sources;
  - `not_reached` with one `deferred` entry per never-planned unsearched source (film,
    image or URL in `description`, which the validator requires), and one
    `handed_to_user` entry per item waiting on an upload;
  - `status` stays `in_progress`.
- **The router recommends from the verdict:** low → "Continue with writing the
  conclusion?", naming "search more"; high → "Continue with planning the searches?",
  naming "wrap it up".
- **Searched items close before a decline.** An item whose search ran is `completed`,
  even when it found nothing, never `skipped`. FamilySearch items with an extracted record
  complete in code; the router's dispose row names `in_progress` items too, and Dispose
  completes each whose search ran. An external-site item stays with the researcher.
- **Conclude:** proof-conclusion writes at the tier reached, with `shortfall: "gap"`.
  **Search more:** research-plan's add-new mode plans from the `deferred` entries.
- **No writer-tool loop rule.** A new plan follows only a researcher's reply.
- **Also routed to the choice:** `premise_invalidated`, and the tentative-value sweep's
  (b) path.
- **The ladder** (`questionStatus` in
  `packages/engine/mcp-server/src/utils/question-state.ts`) reports "researcher's choice:
  research-plan or proof-conclusion (default …)" when all four hold:
  - `stopped_because` is `resources_spent`;
  - there is no proof summary;
  - no plan item is open, not counting one waiting only on an upload;
  - every log entry of the question is in `search_stop.log_entry_ids`. The question's
    entries are those on its plans' items plus each later entry that closes one of its
    hand-offs, matched by URL with `closesHandOff`.

  The default comes from `lowOverturnRisk`; a `justification` with no "Overturn risk:"
  prefix defaults to research-plan. Otherwise the next step stays
  research-exhaustiveness, which covers an out-of-date stop after "Search more".
- **The contract.** Non-gate stops keep the question `in_progress`, and the engine allows
  `probable`, `possible` and `not_proved` without a gate. A non-gate stop does not forbid
  a conclusion.
- **`deferred`** is a value of the `not_reached` kind enum in both `enums.schema.json`
  trees and `CLOSED_ENUMS` (`validator.ts`).
- **The viewer** (`QuestionsSection.tsx`) labels `resources_spent` "Stopped — sources left
  unsearched".

### B2. Wrap it up

- **Offered at any boundary,** before any evidence exists too (decision 15).
- **One turn, mode `wrapup`:**
  1. research-plan's dispose completes every open item whose search ran and skips the
     rest with `skip_category: "user_declined"`. It leaves an item waiting on an upload
     hand-off alone.
  2. person-evidence links the question's unlinked assertions, when there are any. The
     router passes `userPresent: no`, which the agent does not read: a weak match gets no
     link on every run, so nothing pauses. Both research-exhaustiveness and
     proof-conclusion refuse while a relied-upon person is unidentified.
  3. conflict-resolution settles any blocking unresolved conflict it can from the evidence
     in hand.
  4. research-exhaustiveness, with `wrapUp: yes`, records the stop: `resources_spent`,
     items skipped `user_declined`, `no_coverage` or `inaccessible` as `skipped_plan_item`
     (the rule research-exhaustiveness's "Build `not_reached`" applies to every stop it
     writes), waiting items as `handed_to_user`, never-planned
     gaps (including the tentative-value (b) path's alternative) as `deferred`. Under
     `wrapUp` it skips its scope check and the blocks that would refuse, but keeps the
     "already declared" stop.
  5. proof-conclusion, with `wrapUp: yes`, concludes at the tier reached and resolves the
     question, `not_proved` included.
     - A relied-upon person with no linked identity assertion yields `not_proved` with
       `shortfall: "gap"`, naming who is unidentified.
     - **A blocking conflict still holds the question open** (decision 12). It gets its
       summary and has no open item, so section E's rule admits a new question beside it.
       Only project completion waits on the conflict.
     - With `newQuestion: yes` it does not write `project.status: completed`.
- **Before any search has run,** the same turn ends with `not_proved`, `shortfall: "gap"`,
  naming the searches not run. That is the way out for a researcher who wants a different
  question before any search.
- **Coming back to a wrapped-up question** is a new question on the same fact.
  question-selection's step 1b, which stops new questions once the objective is answered,
  has one exception: a question the researcher asked for is written.
- **On a completed project,** a message carrying a new question routes to
  question-selection.

### C. Concluding without an exhaustive search

- proof-conclusion has no exhaustiveness precondition.
- When the stop record lists unsearched sources, its closing line reads "This research is
  finished for now", and the summary names the unsearched records. The two closing
  sentences are the ones the completion halt keys on (`completion-halt-spec.md`).
- The web's `completed` label (`chatEvents.ts`) reads "Research finished for now — see the
  summary for anything left unsearched. Send a message to research further."

### D. Executing the plan in parallel

- **The router dispatches one search agent per plan item, one level down,** at most 4 per
  assistant message, each with `run_in_background: false` (decisions 26, 27). They are one
  step; the router does not report between them.
- **Items with `fallback_for`** run only after their primary finds nothing; otherwise they
  are skipped as `fallback_not_triggered`.
- **Then extraction:** one `extraction_append({ recordIds })` call covers the FamilySearch
  hits, which completes every item whose search lists an extracted record, and one
  record-structurer spawn covers other sources.
- **Handed state.** A search-records spawn receives its plan item (with `planId`) and the
  subject, so it skips its own reads.
- **The early stop comes back through the plan.** A plan for an easy question leads with
  one or two decisive primaries and puts broader sweeps behind them as fallbacks.
- **Why not an executor agent that spawns the searches.** Agents can spawn agents one
  level down (`make probe-agent-nesting`), but the SDK streams nothing from the second
  level, so neither the feed nor e2e could see the searches, and `SPAWN_ALLOWED` is empty
  by ruling (`docs/architecture.md`, the agent-nesting section).
- **External-site items join the same fan-out,** one `search-external-sites` spawn per
  item (section I).
- **A hints plan item** (`record_type: "fs_hints"`) runs through `search-hints` as an
  errand: search-hints decides the hints, logs its decisions and completes the item, and
  its decisions go in the step report. A researcher who disagrees overrules a hint in a
  later reply. The router dispatches it after the
  step's first search-group spawn, because a turn that search-hints opens admits no
  search.
- **An agent's `Hand-back:` line is routed by step group** (lead-accepted
  2026-11-09). Measured on the 7 step-mode e2e logs: of 12 same-group hand-backs from
  `search-records`, 3 were spawned in the step, 3 only in a later step and 6 never; none was
  offered in the reply.
  - Same group as the returning agent (`search-external-sites`, `record-structurer`,
    `search-full-text`, `search-images` after `search-records`): `step_boundary.GROUPS` admits
    it, so it joins the step's fan-out in the same turn.
  - Another group (`research-plan`, `research-exhaustiveness`, `person-evidence`):
    `step_allowed` refuses the spawn mid-turn, so the report says what it asks for and leaves the next step to the
    `project_context` ladder. Offering every hand-back as the next step
    was rejected: it adds a turn the group rule does not require.
  - Not a spawnable agent (`image-reader`, `extraction_append`, `image_transcribe`,
    "to caller", "none"): ignored.

### E. One question per run

- **The writer rule.** `research_append` refuses a `questions` append while another
  question is still open, unless that question has a proof summary and no `planned` or
  `in_progress` item on an active plan (an item waiting only on an upload aside)
  (`newQuestionWhileAnotherIsOpenInvariants`, `research-append.ts`).
  `secondQuestionInOneCallInvariants` applies the same rule inside one `ops` batch.
  - **Why the exemption:** a question proof-conclusion concluded but had to leave open
    (an identity conflict at `not_proved`) must not lock the project.
  - **A `resources_spent` stop does not unlock the project.** The refusal sends that case
    to the wrap-up offer.
  - A wrap-up unlocks it, because dispose closes every open item and proof-conclusion
    writes the summary.
- **A follow-up on the current question is a steer,** not a new question: "did you check
  the 1850 census?" becomes a plan item (research-plan's edit or add-new mode).
- **A different question mid-run,** at any boundary:
  - when the current question has a proof summary and no open item, question-selection
    writes the new one with no offer;
  - otherwise the reply names the current question, says the new one can start once it is
    wrapped up, and ends "Continue with wrapping up?" (the `wrap-up` label). Its only
    button is "Wrap it up.". In Cowork the reply names the phrase "wrap it up";
  - "Wrap it up." runs B2's turn with `newQuestion: yes`, then offers the new question
    ("Continue with choosing the question?").
- **Helper work becomes plan items on the main question:** a conflict that needs new
  evidence, a FAN pivot, an objective-level sub-question. research-plan writes them from
  the record types conflict-resolution records in `resolution_rationale`.
  conflict-resolution, hypothesis-tracking, timeline and proof-conclusion route a needed
  search to research-plan, not question-selection. The conflict step names the record
  that could settle it and ends "Continue with planning the searches?".
- **Given more than one fact to research,** question-selection writes no question and asks
  the researcher to pick one. With `userPresent: no`, which the router sends only on an
  autonomous run, it writes one question, for the fact the objective names first, and
  says so in that question's `rationale`. Nobody is there to answer, and the objective's
  order is a basis the agent can state and the same project picks the same way every
  run; "the highest-value fact" is neither. One question, not one per fact:
  `newQuestionWhileAnotherIsOpenInvariants` refuses a second open question written in a
  later call, and `secondQuestionInOneCallInvariants` one written in the same call. A run
  that did not open with `--autonomous` leaves the field out, because a researcher is
  there to answer.
- **The objective row.** When every question is resolved, the router names any uncovered
  part of the objective as a suggested next question and offers choosing the question.
- **Ladder: a conflict's evidence round.** When every conflict in `openConflictIds`
  carries `independence_analysis` and the active plan has open items, the next step is
  extraction for a found record not yet extracted, otherwise the next item's search. A
  conflict not yet analysed still goes to conflict-resolution first.
- **Ladder: after the round settles the conflict,** the concluded-but-open arm routes to
  proof-conclusion ("concluded while blocked: re-conclude this question's proof summary").
- **Ending on an unsettled conflict.**
  - **`weighed_log_entry_ids`** (optional, on a conflict): conflict-resolution sends it
    on an analysis that finds nothing left to search. `research_append` fills the value
    itself from `conflictCoverageLogIds` (the question's coverage set, including uploads
    matched to their hand-off by URL), refuses it when that set is empty, and clears it on
    any other analysis write or a settle. ADR-0011: the value is decidable from the
    documents, the declaration is not.
  - **The ladder arm,** above the conflict arm, applies when every open conflict is
    analysed and has weighed every log entry of the question, and no plan item is open.
    If the question has a summary with `shortfall: "conflict"` no older than its latest
    log entry, there is no next step: the research ended on an unsettled conflict.
    Otherwise the next step is proof-conclusion, which writes or refreshes that summary
    and leaves the question open.
  - **The summary is the terminal marker, not `search_stop`.** proof-conclusion may not
    write `search_stop`; the plugin hook routes every non-null `stopped_because` to
    research-exhaustiveness.
  - A later upload or steer adds an uncovered log entry, so the conflict goes back to
    conflict-resolution.
  - **The router** follows the ladder's `nextStep`, not the bare presence of a conflict.
    When `project_context` reports a null `nextStep` with open conflicts, it runs nothing,
    names the conflict, and ends with no "Continue with …?" line; the ways on are "Wrap it
    up." and a different question.
- **Decision 12's contract:** an unsettleable conflict is not recorded as `resolved` with
  kind `tree`; the completion gate, `research-append-tool-spec.md` and
  `guardrail-enforcement-spec.md` say so.
- `docs/specs/project-context-tool-spec.md` documents the ladder's order, including B's
  choice and these arms.

### F. e2e continues on its own

- **`eval/harness/e2e/orchestrator.py` keeps one SDK session open** and answers each
  turn as a researcher would, with `next_reply` in `eval/harness/e2e/turn_loop.py`: the
  simulated researcher. No production plane sends a reply; this picker exists because an
  e2e run is unattended. A halted turn's `halt_offer` stands in for its offer line, as on
  the prototype and the web app.
- **`next_reply(boundary, state, turn_mode, prev_step, turn_step, offered_step, outcome,
  *, research=None)`** returns `{"reply", "state"}`. Its state is
  `{replies, planning_rounds, answered, touched_items}`, one dict for the run.
  - Any offer gets `/research --autonomous Continue.` (`UNATTENDED_CONTINUE`): each reply
    carries the opener's `--autonomous` flag, so the router keeps passing `userPresent:
    no` on later turns, and `step_mode` still reads it as a step turn. The plan offer
    after a planning round gets a bare "Wrap it up." instead.
  - **A planning round** is a research-plan turn whose `prev_step` is outside setup,
    question and plan (`_planning_exempt`). The first is allowed; a second ends the run.
    That bounds a second "not exhaustive" round and a conflict's second evidence round.
  - **It returns no reply, ending the run,** after a wrap-up turn; when the outcome is not
    `ok` or `completed`; the turn has no offer; the offer is `wrap-up`; the turn ran
    proof-conclusion and the question it worked already has a proof summary (or
    `research` could not be read); the (`turn_step`, `offered_step`) pair was already
    answered since the last planning round or since the CURRENT question's active-plan
    items last grew in count (`touched_items`, the items no longer `planned`); or
    `MAX_REPLIES` (30) replies were sent.
  - The proof-conclusion check finds the question it worked with `_last_question_id`
    (creation order), deliberately **not** `current_question`: a successful conclusion
    resolves its own question in the same batch as the summary, so by the time this reads
    `research.json` back, `current_question` has already moved past it. Known gap: creation
    order names the wrong question when an EARLIER question is re-concluded in place while
    a LATER one sits open and unresolved.
  - **`prev_step`** is the step of the run's last turn that ran one, so a turn that ran no
    step (section J) does not reset the planning-round count.
- **It answers the fixture's own question once** when a step ends asking the researcher
  for a single question. A second ask ends the run: a run that asks twice has not
  understood the answer, which is a finding.
- **The run ends** when the function stops: no offer line, a finished wrap-up, or the
  reply cap. A no-progress stop remains. Both caps are runaway guards.
- **`--step-mode`** (`eval/harness/e2e/run_e2e.py`): `unattended`, the default, answers
  each boundary with `next_reply`; `step` runs one turn and stops. Recorded as
  `usage.step_mode`. Run logs made before 2026-11-24 record `job`, the unattended run
  under its old name, and still load.
- **`--wrap-up-after <step>`** swaps the reply after that step for "Wrap it up.", which
  exercises B2's link-then-conclude path. It overrides a reply and never invents one, so
  `next_reply` has no test-only branch. Refused unless `--step-mode unattended`.
- **Per-turn records:** `usage.per_turn` holds each turn's step, wall time, reply and cost
  (`docs/specs/e2e-test-spec.md`).
- No Stop hook is bound; a stall ends a run rather than resuming it.

### G. Editing the plan at the plan step

A free-text reply after the plan step is a plan edit, applied by research-plan's **edit
mode**:
- a struck item → `skipped` with `user_declined` when no search has run for it, or when
  its latest entry is an upload hand-off still waiting; an item whose search ran →
  `completed`;
- an added item → a new plan item.

The turn then ends "Continue with running the searches?".

### H. One-shot asks

A one-shot ask ("find her christening record", "evaluate the sources on L71G-4YG") is one
step:
- The router's bounded-request list sends it to the step that owns the deliverable.
  Nothing runs after that step. The reply says what was found and saved, then offers the
  next step.
- A misclassified ask costs one step, not a research cycle.
- A compound one-shot ask runs its first deliverable and offers the second as the next
  step.
- On a new folder with a person ID, project creation runs inside the one-shot's turn:
  init-project, then the deliverable's agent, then its offer (the gate groups an
  init-project turn by the step after it, section A). That turn never admits
  question-selection or research-plan, so a bounded plan with no project runs init-project
  alone and offers choosing the question.
- `research` is the only front door, so the router is always entered.

### I. External-site searches (errands)

`search-external-sites` builds the URL, logs it with `capture_received: false` (the row
`project_context` reports in `awaitingUser`), sets the item `in_progress`, hands the link
over and returns. The wait is a step boundary.
- **In the search step,** external items run in the same fan-out (section D). The report
  gives the FamilySearch findings, then each external search: the link, what to look for,
  and "save the results page as a PDF and upload it". It still ends "Continue with linking
  the records?".
- **"Waiting only on an upload"** means an `in_progress` item with an open hand-off: an
  `external_site` entry with `outcome: "partial"` and `capture_received: false` that no
  later entry for the same URL closes. One helper,
  `packages/engine/mcp-server/src/utils/awaiting-hand-offs.ts` (`awaitingUserHandOffs`,
  `awaitingUploadItemIds`, `closesHandOff`), serves `project_context`, `question-state.ts`
  and `research-append.ts`. `step_boundary.py`'s `awaiting_hand_offs` mirrors it row for
  row (the hosted planes post each new row's link, project-context spec §2.3);
  `step_ctx`'s `awaiting_upload_item_ids` is read off it; and
  `eval/harness/tests/unit/test_awaiting_hand_offs_parity.py` holds the two to one
  fixture. Such an item is not open for the ladder, E's writer rule, or `open_items`.
- **Other `in_progress` external items stay open:** a capture that arrived unusable, a nil
  reported without a capture, an inaccessible site with no decision.
- **research-exhaustiveness** never declares exhaustive while an item waits. It declines,
  lists each waiting search as `handed_to_user` with its URL, and offers upload or
  conclude.
- **An upload is its own turn.** The router matches it to the `awaitingUser` row and spawns
  `search-external-sites` to triage it, then offers linking.
- **An upload after a stop or a conclusion** adds a closing entry the stop does not list,
  so B's choice no longer fires and the question runs through link and assess again.
- **Wrap it up** leaves a waiting item `in_progress` and lists it as `handed_to_user`.
- **Prototype uploads** go through `POST /api/projects/{id}/files`, behind
  `UPLOADS_ENABLED`.

### J. Questions between steps

- **A message that asks about the findings** ("why do you think that's the same John?")
  is answered from the project (`project_context`, `research_query`, `sidecar_read`) and
  no step runs. The gate checks only step calls, so nothing blocks the turn.
- **The answer repeats the pending "Continue with …?" line,** so the buttons come back.
- **A correction** ("that's the wrong John") is a steer, and goes to the step that owns
  it.
- **A turn that ran no step leaves `prev_step` as it was,** so it does not reset e2e's
  planning-round count (section F).

### K. Adding a top-level task

A new top-level task is built the way `where-else-to-search` and
`evaluate-search-results` were:
1. **An agent,** not a skill (lead, 2026-09-22), copied from `agents/search-images.md`.
2. **A line in the router's bounded-request list,** naming the deliverable and routing to
   the agent, so `research` stays the only front door (section H).
3. **A group in `step_boundary.py`,** usually its own in `_SOLO`, and a `STEP_LABELS`
   entry if a step can offer it next. The coverage test fails until it has a group.

Before building one, check whether an existing step already does it and needs only a new
phrase in the bounded list.

**An all-code task is a bounded-list line naming its tool calls,** with no agent and no
step group. "Create a timeline for <PID>" (`extraction_append`, then `timeline_build`) is
one. On an existing project its turn runs no step (section J).

## Measuring "respond sooner"

A turn's duration is its step's duration, so production records the measure.
- **The headline is the researcher's wait,** `completed_at − enqueued_at` on the
  prototype's `turns` table, p50 and p90 per step. Not `completed_at − claimed_at`:
  `claimed_at` is reset on every claim and redelivery is the normal resume path.
- **Spend per step** is priced from the turn's token columns (`input_tokens`,
  `cache_creation_tokens`, `cache_read_tokens`, `output_tokens`), not `turns.cost_usd`,
  which covers only the completing attempt.
- **The reply at each boundary:** the next turn's message against the step its
  predecessor ran (Continue, Wrap it up, Search more, typed, or none). A typed "Keep
  going." counts as typed.
- **Wrap-up turns** (`turns.mode = 'wrapup'`) run several steps and are reported apart. A
  turn init-project opens is
  filed under the step after it, so that step's figures include project creation.
- **Where:** `apps/server/proto/steps.py` prints the three tables over `turns` (read-only,
  run with `uv run python proto/steps.py`). e2e reports per-step wait and spend with
  `make e2e-latency BY_STEP=1`, from `usage.per_turn`. The halt rate is the
  `ev=step_boundary` log line, and the foreground miss rate `ev=foregrounded`.
- **Baseline** (alpha feedback, October 2026): person-evidence took 5–56 minutes, locality-guide
  6–9, and a plan item's searches about 9.

## Relation to research-as-a-job

Step mode replaced research-as-a-job's continuous-job core: a job is now the researcher's
sequence of one-step turns. Against that design's rulings
(`docs/research-as-a-job-decisions.md`):
- **Reversed:** "No plan-approval gate, Stop is the control surface" (2026-09-21). Each
  step ends waiting on the researcher.
- **Superseded:** the Stop veto on every browser turn and its nudge cap; the
  `research_delivered` finish line (deleted); the alpha's `auto_continue` chain
  (deleted). The bounded routing list and "name what was saved" stay.
- **Kept, loosened:** an errand pauses the job (2026-09-27). It is now a step that names
  what to fetch, and the researcher may carry on (decision 16).
- **Kept:** `research` as the only front door; the `AskUserQuestion` carrier and
  `DecisionCard` (decision 23); `q_`/`ps_` ids in user-facing text; the spend bound; the
  reading-experience work. Phase 4's person pick is dropped (lead, 2026-10-19): a project
  starts from a FamilySearch person ID, and a researcher without one is asked for it.

## History

- **Phase 0, probe (2026-10-19).** Measured Cowork's and the hosted planes' hook behaviour
  with no product change. Results in ADR-0005; they produced decisions 23 to 25.
- **Phase 1, build (merged by 2026-10-30).** In order: the research-plan and
  proof-conclusion prep; PR 1 (the step library, the worker gate, the engine rules); the
  route changes (conflict-resolution, hypothesis-tracking and timeline hand evidence work to
  research-plan, section E); PR 2 (the router switch-on); ending on an unsettled conflict
  (section E). The two-question e2e fixtures
  were re-scoped to one question. Prerequisite: PR B of
  the attached-records baseline (searched FamilySearch items close in code;
  `research-append-tool-spec.md` §8 and §11.6).
- **Phase 2, cleanup (complete 2026-11-09).** The Stop veto was deleted on the hosted
  planes and in e2e, where `--step-mode job` became the default; `research_delivered` was
  deleted; the same-turn hand-off lines in research-plan and search-records were deleted.
  The alpha's dormant auto-continue chain was deleted afterwards.
- **2026-11-24.** "Keep going" retired, and `--step-mode job` renamed `unattended`; the
  web app gates in process, and the connector and Cowork through `step_gate_hook.py`; a
  job stops at setup, the question and the plan (decisions 7, 25, 29).
