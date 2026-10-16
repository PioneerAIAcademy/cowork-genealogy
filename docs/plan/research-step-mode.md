# Research one step at a time

**Status:** Proposed, not started. For Praise to fold into the research-as-a-job work
(`docs/plan/research-as-a-job-later.md`, PR #3262); see "Integrating with research-as-a-job".
Phase 0 (a probe) comes first and changes no product code. This merges two drafts: a
single-pass plan drawn from feedback issue #3475, and a one-step-per-turn draft. plan-critic
has reviewed this merged version twice, and its findings are folded in.

## Decisions taken (lead, 2026-10-16)
1. **Step mode on every production plane:** Cowork, the hosted web app (the alpha) and the
   FamilySearch production plane (the prototype). Each turn does one step, reports it in plain
   language, and ends with "Continue with X?". The manager and others now want responses
   sooner; a run must not go quiet for many minutes. Cowork's enforcement depends on phase 0,
   and that is accepted.
2. **Steps may be long.** Nothing happens mid-step: no time budgets, no progress check-ins, no
   splitting a step. Making steps short is separate work (`docs/plan/cost-latency-10x.md`,
   issue #2243 and others).
3. **Pause only where the researcher's judgment matters.** About 5 prompts in a typical run.
4. **One question per run.** A message holding two questions gets a reply asking for one.
5. **"Execute the plan" is one step, run in parallel.** The searches fan out one level down
   from the router, at a capped width.
6. **At "not exhaustive", the researcher chooses** between concluding and searching more.
   research-exhaustiveness's overturn-risk check sets the default.
7. **"Keep going" stays as an option.** It runs the rest of the flow without stopping.
8. **"Wrap it up" is available at any boundary once evidence exists.** It stops further
   research and writes the conclusion from what was found. That may fall short of the GPS's
   reasonably exhaustive search, and the conclusion says so. For many researchers it is good
   enough.
9. **Losing the early stop on easy questions is accepted.** Fallback chains recover most of it
   (section D).
10. **e2e continues on its own by auto-answering.** A recalibration period is accepted.
11. **The reply phrases can change** after implementation, on user feedback.

## Evidence
**#3475.** Proxy-exact, after question selection: $49.84 over about 361 live minutes. Each
"not exhaustive" verdict auto-produced a new plan:

| | live min | cost |
|---|---|---|
| Pass 1 | 158 | $22.65 |
| Pass 2 | 35 | $5.73 |
| Pass 3 | 159 | $20.15 |

- **No one was asked.** The second verdict named the best remaining leads as manual film
  browses.
- **The e2e corpus:** in 35 of 207 committed runs (17%), one question got two or more plans.

## What the researcher sees

| Step | Runs | Ends with |
|---|---|---|
| Setup: init-project (new project), question selection, locality guide (if the place is unsurveyed) | always | "Here's the question I'll research … Continue with planning the searches?" |
| Plan: research-plan | always | the plan, then "Continue with running the searches?" |
| Search: every plan item in parallel, then extraction | always | what was found, then "Continue with linking the records?" |
| Link: person-evidence | always | what attaches to whom |
| Conflict resolution | only on a conflict | its own step; when the evidence in hand cannot settle it, "Continue with planning a search for the record that can?" (section E) |
| Hypothesis tracking | only on competing identities | its own step |
| Assess: research-exhaustiveness | always | "exhaustive", or the choice (section B) |
| Conclude: proof-conclusion | always; the last step | the full output, no prompt |

**What the researcher can reply at any boundary.** The hosted app shows these as buttons that
send the exact phrase; Cowork's reply lists the phrases:
- **"Continue."** Run the next step.
- **"Keep going."** Run the rest of the flow without stopping, in job mode for this turn.
- **"Wrap it up."** Only offered once evidence exists. Stop searching and write the
  conclusion now (section B2).
- **"Search more."** Only at the exhaustiveness choice. Plan searches for the sources left
  unsearched.
- **Free text.** A steer the router acts on. At the plan step, a steer is a plan edit
  (section G).

## Design

### A. The step boundary
- **One pure predicate,** `step_allowed(turn_steps, candidate, mode, ctx)`, defined once in
  `packages/engine/plugin/hooks/step_boundary.py` (stdlib-only).
  - **It allows** the turn's first step, and the members of that step's group:

    | Group | Members |
    |---|---|
    | setup | `init-project`, `question-selection`, `locality-guide` |
    | plan | `research-plan`, `locality-guide` |
    | search | `search-records`, `search-images`, `search-full-text`, `search-external-sites`, `record-structurer`, `image-reader` |
    | link | `person-evidence` |
    | conflict | `conflict-resolution` |
    | hypothesis | `hypothesis-tracking` |
    | assess | `research-exhaustiveness`, `research-plan` |
    | conclude | `proof-conclusion` |
    | forget | `forget-and-rederive`, `init-project`, `record-structurer` |

    A step may always repeat itself (a fan-out), and the router `research` is always allowed.
  - **A step that opens a turn uses its home group:** research-plan → plan, locality-guide →
    setup, init-project → setup, record-structurer → search. The overlaps only admit a
    follower:
    - **`locality-guide` after research-plan,** because research-plan stops for an unsurveyed
      place (`skills/research-plan/SKILL.md:182-187`).
    - **research-plan after research-exhaustiveness, only while the active plan has open
      items.** That is dispose's precondition (`skills/research/SKILL.md:226`). So a decline
      turn cannot start a new plan.
  - **`ctx` carries the one fact the turn's steps cannot show:** whether the open question's
    active plan still has an open item.
    - **Each host reads it from `research.json`** when it checks the call: the prototype worker
      with `read_research` (`worker.py`), the alpha and both harnesses from the project folder,
      and Cowork from the hook's working directory if phase 0 shows it is readable.
    - **A host that cannot read it passes nothing, and the follower is denied.** The cost is one
      needless pause, never an unasked plan.
  - **Mode `job`** allows every step. **Mode `wrapup`** allows, in order:
    1. `research-plan` (dispose), only while `ctx` shows an open item;
    2. `person-evidence`;
    3. `conflict-resolution`;
    4. `research-exhaustiveness`;
    5. `proof-conclusion`.

    Apart from that `ctx` check, the predicate checks membership and order only. Router
    prose says when a member is skipped:
    - person-evidence runs only for unlinked assertions;
    - conflict-resolution runs only when an unresolved conflict blocks the question.
  - **The worker and the alpha load `step_boundary.py` from the plugin directory** with
    `importlib.util.spec_from_file_location`, as `eval/harness/harness/context_policy.py`
    already loads `guard_project_files.py`. That keeps one copy, so no parity test is needed.
  - **Names** are compared after the last `:`.
  - **The deny reason:** "Step complete. Give the researcher your report on the step that just
    finished, end with 'Continue with <label>?', and end your turn." The label comes from
    `STEP_LABELS`.
- **Enforced where the turn is already known.** Each plane calls the predicate from its own hook:

  | Plane | Hook | Turn steps from | Notes |
  |---|---|---|---|
  | Prototype worker | `PreToolUse` in `apps/server/proto/worker/options.py` (sees every call) | the claimed turn | The hook is rebuilt per attempt, and redelivery is the normal resume path. So the turn's first step is stored in `turns.step`, and a redelivered attempt (`receive_count > 1`) seeds from it, as the Stop hook's count is seeded |
  | Alpha | `apps/server/app/agent/real_agent.py` | `handle_turn(text)`, reset in `_begin_turn_hook_state` | The main hook's matcher omits `Skill`. Put the step check in the `count_only` hook, or widen the matcher and update `test_write_lockdown.py`. No redelivery |
  | Unit harness | `eval/harness/harness/skill_runner.py`'s `pretool_hook` | the one turn | Run the step check **before** the stub, so a stub's canned reply never replaces the step denial |
  | e2e harness | `eval/harness/e2e/orchestrator.py`'s `PreToolUse` | the user messages it sends (section F) | The resume-on-stall prompt is not a new turn |
  | Cowork | the plugin hook's own entry point (phase 0 picks the signal) | its prompt text | |

  - **The plugin hook steps aside where a host enforces.** It does nothing when
    `GENEALOGY_STEP_HOST=1`, giving one guard per plane, each testable.
    - **Prototype:** `cli_env_blanks` blanks every inherited `GENEALOGY_*` variable
      (`options.py`), so the variable goes in `build_worker_options`' `env`.
    - **Alpha:** it goes in `_sdk_env()`.
    - Neither harness loads the plugin's `hooks.json`.
  - **Mode detection is exact-phrase only:** "keep going." → `job`, "wrap it up." → `wrapup`,
    case and trailing punctuation ignored. Anything else is `step`. **One normalizer,**
    `step_mode(text)` in `step_boundary.py`, is used by every plane, including the prototype's
    web tier when it stamps the job cap. So a typed "Keep going!" gets the same mode and the
    same Stop veto everywhere.
  - **A host-sent prompt is never a new turn.**
- **The Stop veto is armed only for a job-mode turn,** where each plane already sets its cap:
  - **Prototype:** the web tier already stamps `max_nudges` on each queue body in `_insert_turn`
    (`apps/server/proto/web/app.py`), with the message text in hand.
    - **The change is only what it stamps:** the existing `AUTONOMOUS_MAX_NUDGES` (default 60)
      when `step_mode(text)` is `job`, otherwise 0. The worker already takes the per-message
      cap (`turn_max_nudges` in `worker.py`) and binds no Stop hook at 0.
    - **No new environment variable,** so the compose, Beanstalk and bundle settings that carry
      `AUTONOMOUS_MAX_NUDGES` stay as they are; it now means the job cap.
    - **Recipes that send a fixture prompt** and rely on a nonzero cap send "keep going." or are
      documented as one-step runs: `proto-demo-auto`, `proto-bounds CASE=probe_resume` and
      `proto-kill` in the `Makefile`. So do `turn.py`'s docstring and `bounds.py`'s reading of
      a 0 cap.
    - **Other sites:** `test_proto_config.py`'s p99 test (onto the job cap) and U13's figures
      in `docs/plan/familysearch-handoff.md`.
  - **Alpha:** keep `auto_continue` on, so the sandbox cap stays above 0 and the Stop hook binds.
    Its "Yes." chain matches only the retired "Next: … Continue?" line (`hand_back.py`).
    - Add a per-turn **armed** flag and a nudge reset, set in `handle_turn` from the turn's
      mode. The hook vetoes only when armed.
    - Every `"block"` assertion in `test_alpha_stop_hook.py` gains an arming step (eight
      today), and its per-session-count and `auto_continue`-off cases are rewritten.
    - Existing alpha sandboxes keep their creation-time code until the 72-hour cutoff
      (`app/sessions.py`). So step mode reaches the alpha over about three days.
- **A job-mode turn at the exhaustiveness choice** takes the recommended default once. A second
  "not exhaustive" verdict in the same job concludes, so "Keep going" cannot loop the way #3475
  did. **The same bound holds for a conflict that needs new evidence** (section E): one
  research-plan round per conflict per job, and a second request concludes.
- **Outcomes:**
  - A step turn ends `ok`, which renders no label. No `continue_policy.py` change is needed:
    at cap 0 no plane binds the Stop hook.
  - A turn whose step completed the project has no Stop verdict to report that, so the worker
    sets `completed` at turn close from `project_completed(read_research(...))` when no Stop
    verdict was recorded. The honest `completed` label (section C) then shows on step turns
    too.
- **The router stops ordering the model not to yield.** `skills/research/SKILL.md` deletes:
  - the "Continuous work" orders;
  - "Iterate — without yielding";
  - "these four are the only stop conditions";
  - "a run that no longer stops to ask".

  It gains the step-report rule (the step's `summary_for_user`, then "Continue with X?" and
  the reply options) and the job and wrap-up behaviour. `docs/architecture.md:859-860` says
  finishing a sub-skill is mid-loop; it changes with it.
- **The plugin entry:** append the step entry to `hooks.json` **after** the existing guard, since
  `plugin-hooks.test.ts` reads `PreToolUse[0]`. Add a row for the new guardrail to
  `docs/specs/guardrail-enforcement-spec.md`'s guardrail table (`docs/architecture.md`,
  "Restrain something"). `make hook-smoke` gets a step arm that **unsets** `GENEALOGY_STEP_HOST`.
- **Web:**
  - `ChatPane.tsx`, `chatEvents.ts`, its test and `styles.css` get Continue, Keep going, Wrap
    up and Search more buttons. They show on every turn whose reply ends "Continue with …?",
    and each sends its exact phrase.
  - **The web cannot tell when an option applies,** so the router declines one that doesn't:
    "Wrap it up" before any evidence, or "Search more" away from the choice. Each gets a
    one-line reply. That avoids new `turn_done` fields.
  - Plus `hosted-web-workbench-spec.md`, and a test that `hand_back.py`'s regex never matches
    "Continue with X?".
- **Fallback:** if phase 0 shows Cowork's hook cannot find turns, Cowork runs on router prose
  alone.

### B. The choice at "not exhaustive"
- **research-exhaustiveness on a decline** (every active-plan item closed, a genuinely
  unsearched source remaining) writes `search_stop`:
  - `stopped_because: "resources_spent"`
  - `stop_criteria: null`
  - `log_entry_ids` listing the log entries of **every** plan of the question. After "Search
    more" a question has two plans by design, and the ladder's coverage check reads both.
  - `justification`, opening with the verdict, "Overturn risk: low" or "Overturn risk: high —
    <sources>". Non-gate stops force `stop_criteria: null`, so this is where the default is
    saved for a later session.
  - `not_reached`, with one `deferred` entry per unsearched source that was never planned;
    film, image or URL go in `description`
  - `status` stays `in_progress`

  The reply recommends from that verdict:
  - **low:** "Continue with writing the conclusion from what we found?", with "search more"
    named;
  - **high:** "Continue with searching <the sources that could change the answer>?", with the
    reason and "write it up" named.
- **Conclude:** proof-conclusion writes at the tier reached, with `shortfall: "gap"`.
  **Search more:** research-plan's add-new mode (`skills/research-plan/SKILL.md:144-148`) plans
  from the `deferred` entries.
- **No writer-tool loop rule is needed.** A new plan can only follow a researcher's reply, or
  job mode's one allowed round.
- **Also routed to the choice:** `premise_invalidated` (`agents/research-exhaustiveness.md:195-196`)
  and the tentative-value sweep's (b) path (`:127-135`). Step 0 refusals are unchanged.
- **The ladder:** `src/utils/question-state.ts` gains one branch, above `:428-434`.
  - **It fires only when all four hold:**
    - `stopped_because` is `resources_spent`;
    - there is no summary;
    - no plan item is open;
    - every log entry on the question's plans is listed in `search_stop.log_entry_ids`.
  - **It then reports** "researcher's choice: research-plan or proof-conclusion", with the
    default read from `justification`. A `justification` with no "Overturn risk:" prefix, such
    as an older stop, defaults to research-plan.
  - **Otherwise the next step stays research-exhaustiveness.** That covers an out-of-date stop
    after "Search more", which nothing clears. A `blocked_by_conflict` stop still routes to
    conflict-resolution until E's conflict rule applies.
- **The contract wording.** The 2026-09-30 ruling keeps non-gate values `in_progress`; this plan
  keeps that, and the engine already allows `probable`, `possible` and `not_proved` without a
  gate (`research-append.ts`, around `:2734-2780`). What changes is only the docs' claim that
  a non-gate stop permits no conclusion:
  - `docs/gps-research-flow.md:48-56` and `:336-343`;
  - `docs/specs/research-schema-spec.md:116`, `:118`, `:582`, and the plans section;
  - both `enums.schema.json` trees' `stopped_because` descriptions;
  - `src/utils/question-stop.ts:86-92`.
- **The `deferred` kind:** both `enums.schema.json` trees, `CLOSED_ENUMS`
  (`src/validation/validator.ts:72`), and `research-schema-spec.md:119` and `:604`. Reword the
  kind's "could not be reached" definition to cover it. The TS union is generated.
- **The viewer label:** `packages/viewer-ui/src/components/sections/QuestionsSection.tsx` labels
  `resources_spent` "Resources Spent". It becomes "Stopped — sources left unsearched", since it
  now appears on every declined question.

### B2. Wrap it up
- **Offered at any boundary once the question has evidence,** meaning at least one assertion
  extracted for it.
- **In one turn** (mode `wrapup`):
  1. research-plan's dispose mode skips every open item with `skip_category: "user_declined"`.
     The tool already allows that category on an open item (`research-append.ts`, near
     `:2602-2608`).
  2. person-evidence links the question's unlinked assertions, when there are any.
     - **Why it must run:** both research-exhaustiveness (`agents/research-exhaustiveness.md:116-122`)
       and proof-conclusion (`agents/proof-conclusion.md:101-113`) refuse while a person the
       question depends on is unidentified.
     - **In a wrap-up it resolves weak matches downward.** Its pause rows resolve downward only
       in an autonomous run (`agents/person-evidence.md:547-558`), so it gains one line: a
       "Keep going" or "Wrap it up" turn counts as autonomous, because the researcher chose not
       to be asked.
  3. conflict-resolution settles any unresolved conflict that blocks the question from the
     evidence in hand. Otherwise proof-conclusion's conflict check (`:122-150`) would stop at
     `not_proved`.
  4. research-exhaustiveness records the stop, using its existing "user wants to stop early"
     case (`:352`): `resources_spent`, the skipped items as `skipped_plan_item`, and any
     never-planned gaps as `deferred`. Its tentative-value (b) path records the alternative
     source as `deferred` here, never routing to research-plan.
  5. proof-conclusion concludes at the tier reached.
- **Before any evidence exists,** the reply says there is nothing to conclude yet.

### C. Concluding without an exhaustive search
- **`agents/proof-conclusion.md`:**
  - **`:215`:** remove both of its exhaustiveness preconditions: "an undeclared exhaustiveness",
    and "exhaustiveness declared" inside "(exhaustiveness declared, conflicts resolved)".
  - **`:716-719`:** when the stop record lists unsearched sources, "The research is finished"
    becomes "This research is finished for now". Summary paragraph 1 already names the
    unsearched records (`:707-711`). Keep "second opinion" for the validator
    (`test_proof_conclusion.py:763-790`).
- **`apps/web/src/components/chatEvents.ts:42`:** `completed` reads "Research finished for now —
  see the summary for anything left unsearched. Send a message to research further."

### D. Executing the plan in parallel
- **search-records becomes an agent** (issue #2243). That is the prerequisite for the fan-out.
- **The router dispatches one search agent per plan item, one level down,** at most 4 per
  assistant message. **The spawn-width test belongs in #2243's PR** (or the first PR after it),
  because it needs search-records to be an agent. PR 2 ships the interim parallel tool calls
  below.
  - **Items with `fallback_for`** run only after their primary finds nothing; otherwise they
    are skipped as `fallback_not_triggered`.
  - **Then** one `extraction_append({ recordIds })` call covers the FamilySearch hits, and one
    record-structurer spawn covers other sources.
- **Handing each agent its state comes later.** That means the item, the person's attached
  records and the locality facts, as the 10x plan advises. Issue #2243 is "ids only" by lead
  ruling (2026-10-06), and it files the handed-state follow-up. That follow-up also has to
  change the router's "read nothing beyond the ids you are passing"
  (`skills/research/SKILL.md:293-298`) for search spawns.
- **The early stop comes back through the plan.** A plan for an easy question leads with one or
  two decisive primaries and puts the broader sweeps behind them as fallbacks. A completeness
  question needs its enumerating sources as primaries (issue #1830, `question_kind`).
- **Why not an executor agent that spawns the searches.** Agents can spawn agents one level
  down: `make probe-agent-nesting` measured it on the hosted loader on 2026-09-23, and a local
  probe confirmed it on 2026-10-16. But:
  - the SDK streams nothing from the second level, so neither the feed nor e2e could see the
    searches;
  - Cowork is unmeasured;
  - `SPAWN_ALLOWED` is empty by ruling (`docs/architecture.md`, the agent-nesting section).
- **Concurrency is proven:** five extractors ran at once in #3475, and project writes are
  serialised on both stores. Until #2243 lands, the main thread issues the plan's independent
  searches as parallel tool calls.

### E. One question per run
- **One writer rule replaces the existing in-flight gate.** `newQuestionWhileSearchInFlightInvariants`
  (`research-append.ts:2455`) becomes: `research_append` refuses a `questions` append while
  another question is `open`, `in_progress` or `exhaustive_declared` **and has no proof
  summary**.
  - **Why the summary exemption:** a question that proof-conclusion concluded but had to leave
    open (an identity conflict at `not_proved`, `agents/proof-conclusion.md:144-150`) must not
    lock the project against every new question.
  - **Test blast radius:** 11 tests in `research-append.test.ts`, measured with the rule
    patched in. They are all nine in-flight tests, "(Phase 2) appends a question and stamps
    created", and "the 'questions' example validates". Rewrite them, plus the spec line and
    the `questions` worked example in `research-append-examples.ts`.
- **Work that used to open a helper question becomes plan items on the main question:**
  - a conflict that needs new evidence;
  - a FAN pivot;
  - an objective-level sub-question.
- **research-plan writes those items** (its edit or add-new mode), from the record types
  conflict-resolution records in `resolution_rationale` (`agents/conflict-resolution.md:353-357`).
- **Three bodies that route this work to question-selection now route it to research-plan:**
  `agents/conflict-resolution.md:358-359` and `:495-497`, and `agents/hypothesis-tracking.md:451`.
  - The conflict step then ends "Continue with planning a search for <the decisive record>?".
  - No unit test or validator pins the old route. PR 2 adds one test for the new route in each
    agent.
- **The ladder needs one more rule** (`question-state.ts`), or its unresolved-conflict arm
  (`:417-418`) sends every pass back to conflict-resolution before the new items can run.
  - **The rule:** an unresolved conflict that already carries `independence_analysis`, on a
    question whose active plan has open items, routes to search-records. It sits above that
    arm.
  - **Why that marker:** conflict-resolution fills `independence_analysis` on every analysis,
    resolved or not (`agents/conflict-resolution.md:348-352`). A conflict not yet analysed
    still goes to conflict-resolution first.
  - **Once the items close,** the arm fires again and conflict-resolution weighs the new
    evidence.
- **question-selection changes** (`agents/question-selection.md`):
  - delete or rewrite priorities 1, 3, 6 and 7 (`:169-175`, `:201-206`);
  - delete or rewrite the conflict-unblocking question (`:95-101`) and the sub-question
    paragraph (`:155-160`);
  - **given more than one fact to research,** it writes no question and asks the researcher
    to pick one;
  - **tests:** rewrite `ut_question_selection_003`, `_005`, `_006`, `_008` and `_d03`, and add
    a test with a two-fact objective (no questions → no write, and an ask).
- **The router:** delete "New evidence may reveal new questions — return to question-selection"
  (`skills/research/SKILL.md:361-362`). The objective row (`:229`), after the tree-encoding gate,
  names any uncovered part of the objective as a suggested next question, as a statement. The
  `compound-objective-*` router tests point at that statement.
- **research-plan's FAN-pivot hand-off** (`skills/research-plan/SKILL.md:655`) becomes a plan
  item.

### F. e2e continues on its own
- **`eval/harness/e2e/orchestrator.py` keeps one `ClaudeSDKClient` session open** with streaming
  input, and answers each yield with a real user message:
  - **"Continue."** to every prompt, which accepts the agent's own default;
  - **at the exhaustiveness choice,** the default once, then "Wrap it up." on a second decline
    for the same question (the same bound as job mode). A conflict's second request for new
    evidence gets "Wrap it up." too;
  - **the fixture's own question** when asked for a single one.
- **The run ends** when the question is `resolved`. A cap on harness answers replaces
  `max_continue_nudges` (a Stop-veto counter today), and the no-progress stop remains. Both are
  runaway guards only.
- **Production's mechanism runs unchanged** inside the harness.
- **Also:**
  - `classify_hand_back` and `nudge_report.py` learn the new line;
  - per-turn step and wall time are recorded, and `make e2e-latency` reports per-step
    p50/p90;
  - `e2e-test-spec.md` is updated;
  - two-question fixtures are re-scoped (genealogist work).
- **A separate e2e arm** answers "Keep going." once, and another answers "Wrap it up." right
  after the search step. The second exercises B2's link-then-conclude path.
- **Interim, if the persistent session slips:** the harness sets mode `job` for every turn, a
  stopgap that measures the old continuous flow.

### G. Editing the plan at the plan step
A free-text reply after the plan step is a plan edit. Today research-plan's review mode forbids
modifying items, and it defaults to review whenever an active plan has open items
(`skills/research-plan/SKILL.md:134-142`, `:165-168`). So research-plan gains an **edit mode**:
- a struck item → `skipped` with `user_declined`;
- an added item → a new plan item.

The turn then ends with "Continue with running the searches?". The edit mode and B2's dispose
wording are research-plan prose. They land in this plan's PR 2 **after** PR #3479 (which converts
research-plan to an agent) merges, never inside that PR.

### H. One-shot asks (issue #2813's problem)
Today a one-shot ask can run a whole research cycle, for example "find her christening
record" or "evaluate the sources on L71G-4YG". The Stop veto keeps every hosted turn going
until `project.status` is `completed`, so everything rests on the model classifying the ask as
bounded and calling `research_delivered`. Feedback shows where that fails:
- issue #2921: "Why is it building a tree when I simply asked…";
- #3473's "going above and beyond what was asked";
- #3446's skipped project setup.

Step mode removes the runaway structurally:
- **A one-shot ask is one step.** The router's existing bounded routing (PR #3187, PR #3286)
  sends it to the step that owns the deliverable. Nothing runs after that step. The reply says
  what was found and saved (PR #3235), then offers "Continue with X?".
- **A misclassified ask costs one step, not a cycle.**
- **A compound one-shot ask** runs its first deliverable, and offers the second as the next
  step. That reverses `ut_research_c1k` and its validator
  `test_every_bounded_deliverable_is_handed_off` (`eval/harness/validators/test_research.py`),
  which require both in one turn.
- **A one-shot ask with a PID on a new folder** needs the project first. Once issue #3384 makes
  project creation a single `project_create` tool call, that runs inside the one-shot's turn.
  Until then, it costs one extra prompt.
- **Cowork routing depends on the router being entered.** PR #3262 makes `research` the only
  front door.

## Measuring "respond sooner"
With one step per turn, **a turn's duration is its step's duration**, so production already
records the measure.
- **On the prototype,** the `turns` table (`apps/server/proto/sql/001_schema.sql`) holds
  `enqueued_at`, `claimed_at` and `completed_at` for every turn.
- **The headline is the researcher's wait,** `completed_at − enqueued_at`. Report its p50 and
  p90 per step once step mode is live. The manager should read this figure: it says how long a
  researcher waits for each response, and it falls as `docs/plan/cost-latency-10x.md` and
  issue #2243 make steps shorter.
- **Step run time needs care.** `claimed_at` is reset on every claim (`worker.py`), and
  redelivery is the normal resume path, so `completed_at − claimed_at` measures only the last
  attempt. Either record a first-claim timestamp or leave redelivered turns out of run-time
  figures.
- **Leave out of the per-step figures** any turn that ran several steps: job-mode turns
  (`message->>'max_nudges' > 0`) and wrap-up turns.
- **To break it down by step,** PR 1 adds a nullable `turns.step` column in a new migration
  under `apps/server/proto/sql/`. The worker fills it with the turn's first step, and it also
  seeds a redelivered attempt (section A). "p90 by step" becomes one `GROUP BY`.
- **e2e reports the same figure** from per-turn timing (`make e2e-latency`, section F), so a
  change's effect on wait time is visible before it ships.
- **The baseline** comes from the #3475 and #3459 bundles: person-evidence took 5–56 minutes,
  locality-guide 6–9, and a plan item's searches about 9.

## Integrating with research-as-a-job
For Praise, and covering both `docs/plan/research-as-a-job-later.md` and PR #3262, which
built most of it. This plan replaces research-as-a-job's continuous-job core: a job becomes
the researcher's sequence of one-step turns. Most of the rest survives. The tables follow that
file's own sections, top to bottom.

**"What phases 0 and 1 leave for these phases"**

| Item | Under step mode |
|---|---|
| Ruling: "No plan-approval gate — Stop is the control surface" (2026-09-21) | **Reversed for step turns** (lead, 2026-10-16): each step ends waiting on the researcher. It still holds inside a "Keep going" turn |
| Ruling: `q_`/`ps_` allowed in user-facing text (2026-09-20) | **Unaffected** |
| Ruling: the prototype is production; the alpha is backported to and retired; Cowork may be degraded | **Unaffected.** Cowork's enforcement waits on phase 0 |
| Ruling: the spend bound continues in a new session | **Unaffected;** it matters only in "Keep going" turns |
| Ruling: an errand pauses the job and waits (2026-09-27) | **Kept by the open decision below:** an errand is a step that ends naming what to fetch |
| "The Stop hook binds on every browser turn"; nudge cap 60; the alpha's `auto_continue` | **Changes:** armed only for a "Keep going" turn. The prototype's web tier stamps the job cap per message; the alpha keeps `auto_continue` on and arms per turn |
| `turns.outcome` values | **Mostly unchanged.** A step turn ends `ok` (no label); the worker sets `completed` at turn close when the step finished the project; `delivered` goes in phase 2 |
| "`decision` and `mcp_unavailable` cannot fire" | **Unaffected;** step mode needs no `decision` exit |
| person-evidence's weak-match pause and its autonomous-only resolve-downward rule | **The pause becomes the link step's closing question,** asked with the researcher present. Resolve-downward still applies in "Keep going" and "Wrap it up" turns and e2e (section B2) |

**"Before phase 2 — what continuous work changed"**

| Item | Under step mode |
|---|---|
| "The default web path never enters the router"; re-entry through the nudge text (PR #3262) | **Router entry comes from two carriers:** the front door below on every researcher message, and the nudge text in "Keep going" turns |
| `research` as the only front door (PR #3262's frontmatter) | **Keep:** section H depends on it |
| "Not every turn is a job"; the `research_delivered` finish line (PR #3187, PR #3286, PR #3235) | **Superseded:** every turn is one step. Keep the bounded routing list and "name what was saved"; delete `research_delivered` in phase 2 |
| "Never ask a question you will not wait for" | **Keep, applied to every step.** Offers at the **end** of a step become its "Continue with X?". Offers **mid-step** become statements, because nothing stops mid-step: for example search-records' "Let the user confirm before extraction", now that extraction is inside the search step |
| "Give 'I need you' an exit" (`AskUserQuestion` carrier, `pending_decision`, `DecisionCard`) | **Change.** The step boundary already ends every turn, so a question is just a step's ending. `DecisionCard` becomes the home for the reply buttons. The carrier is needed only if a decision must interrupt a step, and none is planned |
| The fourth stop's clauses: unreachable records end `completed`; a blocking conflict "is a decision" | **Unreachable records:** unchanged (the proof at the tier reached, `completed`). **A blocking conflict:** ends the conflict step with the question to the researcher, no `decision` exit needed |
| "Capture a real feed before specifying phase 2" | **Keep:** it now shows the step reports |
| *Before phase 2*'s acceptance list | **Replaced** by this plan's acceptance items 8–9 (a fresh session ends after one step) and item 7 (one-shot and plan-only asks end after their step) |

**Phase 2 — the reading experience**

| Item | Under step mode |
|---|---|
| The step as the chat's unit; one view of job state; chips in FamilySearch's words; identifiers as links | **Keep.** The session list's "needs you" state is a step waiting on a reply |
| Three kinds of nothing (`not_searched`) | **Keep;** align its naming with the `deferred` kind |
| Show the scans, and let documents in | **Keep:** an errand closes when the document comes back |
| The job outlives the tab | **Changes:** a job pauses between steps; a "Keep going" turn still outlives the tab |

**Phase 3 — the loop**

| Item | Under step mode |
|---|---|
| Decisions: one card kind | **Keep,** as the reply UI |
| Handed to you (errands; blocked on issue #1830) | **An errand is a step that ends naming what to fetch** (open decision below) |
| Corrections as recorded state (`rejected_links`); change review | **Keep** |
| Dead ends become next actions | **Keep;** they match the deferred list and the choice (section B) |

**Phase 4 — the cold start**

| Item | Under step mode |
|---|---|
| The person pick, "a decision, so this phase follows phase 3" | **The pick is the setup step's report:** candidate cards, then the researcher's reply. It no longer waits on phase 3's exit |
| Offer the gaps; say what to expect | **Keep,** as part of the setup step's report |

**Phase 5 — the remaining prose**

| Item | Under step mode |
|---|---|
| S1 (`init-project`), S5 (`record-extraction`) | **Unchanged in scope** |
| The narration guidance's "do not narrate between actions" | **Becomes the step-report rule:** one paragraph per step, what was found and what comes next |
| "The literal is gone from every body"; the web Continue button removed | **A new literal and button return:** "Continue with …?", distinct from the retired "Next: <step>. Continue?". A test keeps `hand_back.py`'s regex from matching it (section A) |

**"What this design does not do, at any phase"**

| Item | Under step mode |
|---|---|
| No proof export; nothing writes to the FamilySearch tree; no numeric confidence meter | **Unaffected** |
| No leaf-skill changes beyond the listed ones | **Plus** this plan's research-exhaustiveness, proof-conclusion, question-selection, research-plan, conflict-resolution, hypothesis-tracking and person-evidence changes |
| No further cost bounding | **Step mode bounds every turn to one step.** The $35 spend bound remains for "Keep going" turns |
| Nothing Cowork-specific | **Except** the plugin hook's Cowork entry point (section A) |

**Suggested order:**
1. Split PR #3262. Land what survives (the front door, `rejected_links`, phase 2's reading
   experience, the cold start) apart from the continuous-job finish lines that step mode
   replaces.
2. Run phase 0.
3. Build PR 1, then PR 2. Sequence PR 2 after PR #3479 and PR #3476.
4. Fold this file into `research-as-a-job-later.md`, or retire that file's superseded sections.

## Phases
**Phase 0 — probe, no product change.**
- **In live Cowork, check:**
  1. `PreToolUse` fires on `Agent|Task|Skill` main-thread calls;
  2. **`UserPromptSubmit` fires and carries the prompt text.** If it does, it is the clean
     turn-and-mode signal, with no transcript parsing. `SessionStart` does not fire in Cowork
     (ADR-0005), so this needs measuring.
  3. `prompt_id` presence and semantics;
  4. `transcript_path` readability;
  5. denies are honoured, after which the model reports and ends;
  6. sibling calls are visible;
  7. the hook can read the project's `research.json` from its working directory (for `ctx`).
- **On both hosted planes:** a host-side deny binds alongside `continue_policy.foreground_rewrite`.
- **Record the results** in ADR-0005.

**Phase 1.**
- **PR 1 — code and CI tests:**
  - `step_boundary.py` (the predicate and the Cowork entry point), its `hooks.json` entry after
    the guard, `plugin-hooks.test.ts` cases, a matcher-coverage test, the guardrail-spec row,
    and `make hook-smoke` with the step arm;
  - **the host integrations:**
    - the worker's `PreToolUse`, with `turns.step` and the redelivery seed;
    - the alpha's hooks, with the `Skill` coverage;
    - the unit harness, with the check before the stubs;
    - the e2e orchestrator;
    - `GENEALOGY_STEP_HOST` in `build_worker_options` and `_sdk_env()`;
    - each host's `ctx` read;
  - **the per-message job cap:** the prototype web tier stamping `AUTONOMOUS_MAX_NUDGES` from
    `step_mode(text)`, with the recipe and docstring sites, and the alpha's per-turn armed flag;
  - the worker's turn-close `completed`;
  - **writer and ladder rules:** E's rule replacing `newQuestionWhileSearchInFlightInvariants`,
    with its proof-summary exemption and the 11 rewritten tests; the two `question-state.ts`
    branches (B's choice and E's conflict evidence);
  - **web:** the buttons and the `completed` string;
  - **viewer:** the `resources_spent` label;
  - **schema and docs:** the `deferred` enum and the contract docs; `docs/architecture.md:859-860`;
  - **the e2e harness** per F.
- **PR 2 — prose; paid `research`, `research-exhaustiveness`, `proof-conclusion`,
  `question-selection`, `research-plan`, `conflict-resolution`, `hypothesis-tracking` and
  `person-evidence` runs:**
  - **the router:** A's deletions; the step report and replies; the search fan-out (D); the
    choice replacing the loop row (`:225`); wrap-up (B2); the objective row (E) and the
    deleted "return to question-selection" line;
  - **the agents:** research-exhaustiveness (B, B2), proof-conclusion (C), question-selection
    (E), conflict-resolution and hypothesis-tracking (E's route to research-plan), and
    person-evidence (B2's autonomous line);
  - **research-plan:** the edit mode (G), the wrap-up dispose wording, and the FAN pivot and a
    conflict's decisive records as plan items (E). This lands after PR #3479 merges;
  - **tests:**
    - the five research-exhaustiveness tests (`ut_research_exhaustiveness_001`, `_014`, `_015`,
      `_016`, `_d9i`);
    - three `research` tests (`autonomous-handoff`, `autonomous-is-always-a-job`,
      `open-ask-still-a-job`);
    - `ut_research_c1k` and its validator;
    - the `ut_research_004` and `ut_research_001` judge contexts (they expect several steps);
    - the `compound-objective-*` tests;
    - the five question-selection tests (E);
    - `ut_research_plan_q7m`, which calls ending on an execution question non-compliant, and
      that is how step mode ends;
    - new tests: conflict-resolution's and hypothesis-tracking's route to research-plan, and
      person-evidence resolving downward in a wrap-up.
- **Prerequisites, staffed separately:** issue #2243 for the fan-out; its handed-state follow-up
  for D's handed state.

**Phase 2 — cleanup, once step mode is live.**
- **Delete `research_delivered` everywhere.** About 24 files, including:
  - `manifest.json`, `tool-schemas.ts`, `server.ts` and `dev/smoke-calls.ts`;
  - the delivered arms in `options.py`, `worker.py` and `real_agent.py`;
  - the web `delivered` label;
  - `mock_mcp.py`, `instrument.py` and the tests;
  - `DELIVERY_GUIDANCE`;
  - the bounded-ask section's `research_delivered` close. Keep its routing list.
- **Delete `CONTINUE_REASON` outside job mode,** `hand_back.py` and the runner's auto-continue
  chain.
- **Delete the same-turn hand-off lines** in research-plan and search-records. That makes
  search-records a paid run here.

## Acceptance (each fails today)
1. **Predicate unit tests:**
   - a second step from another group is denied, with "Continue with" and its label;
   - a same-group member is allowed, including `locality-guide` after research-plan;
   - research-plan after research-exhaustiveness is allowed only when `ctx` shows an open item,
     and denied when `ctx` is absent;
   - a turn opened by research-plan uses the plan group, so research-exhaustiveness after it is
     denied;
   - job mode allows everything;
   - wrap-up allows only dispose → person-evidence → conflict-resolution → exhaustiveness →
     conclusion;
   - `step_mode` maps "Keep going!", "keep going" and "KEEP GOING." to `job`, and "keep going
     but skip the census" to `step`;
   - a host-sent prompt does not open a turn;
   - a corrupt input is allowed.
2. **Host-hook tests** on the worker (including the redelivery seed from `turns.step`), the
   alpha (including `Skill`), the unit harness and the e2e paths. `GENEALOGY_STEP_HOST` is in
   each hosted plane's CLI environment, and the plugin entry point does nothing when it is set.
3. **The job cap:**
   - the prototype web tier stamps `AUTONOMOUS_MAX_NUDGES` for a typed "Keep going!" and 0 for
     any other message;
   - the alpha's hook vetoes only in an armed turn;
   - the worker sets `completed` at turn close when a step finished the project.
4. **`research_append`** refuses a second open question, but accepts one while the other open
   question has a proof summary. The 11 old-gate tests are rewritten.
5. **The two `question-state` branches:**
   - B's fires with `resources_spent`, no summary, no open item and full log coverage;
   - it does not fire when the stop lists only the first plan's log entries and a second plan
     has entries;
   - an out-of-date stop after "Search more" routes to research-exhaustiveness;
   - a `justification` with no "Overturn risk:" prefix defaults to research-plan;
   - E's: an unresolved conflict with `independence_analysis` and an open plan item routes to
     search-records, and one without `independence_analysis` still routes to
     conflict-resolution;
   - a `blocked_by_conflict` stop with no open item routes to conflict-resolution. This one is a
     regression guard and passes today.
6. **Web:** the buttons appear and send their phrases; `completed` renders the new string.
7. **Unit (paid):**
   - one step, then "Continue with";
   - "Keep going." runs past a boundary and concludes on a second decline, whose stop lists
     both plans' log entries;
   - "Wrap it up." from a post-search, pre-link scenario links, records `resources_spent` and
     concludes;
   - a decline writes the overturn-risk verdict and offers its default;
   - a plan of five or more items runs its independent searches as parallel tool calls. The
     4-spawn width test moves to issue #2243's PR (section D);
   - an unresolved conflict that needs new evidence ends offering a research-plan step, not a
     new question;
   - a two-question message gets the ask;
   - a plan edit is applied.
8. **Phase 0's hosted arm on the phase 1 build:** the second step is denied on both planes.
9. **A fresh hosted session** on the Benz and Haist feedback openers
   (`feedback-2026-10-08T12-32-23-007161Z.zip`, `feedback-2026-10-05T17-53-26-347549Z.zip`)
   ends after one step with "Continue with …?".
10. **One e2e panel fixture runs to a proof on auto-answer.** Its runlog carries per-turn steps,
    times and the Continue count, and `make e2e-latency` reports per-step p50/p90.
11. **The prototype's `turns.step`** is filled for every step turn and survives redelivery, and
    a per-step p50/p90 query over `turns` returns figures.

## Open decisions
- **Errands in step mode.** An errand is a step that ends naming what to fetch, which keeps the
  2026-09-27 and 2026-09-30 rulings. Recommended: yes.
- **Helper work under one question per run.** A conflict that needs new evidence, a FAN pivot
  and a sub-question become plan items on the main question instead of new questions (section
  E). Recommended: yes.
- **`deferred` as an enum value or prose.** Recommended: the enum value.
- **Retire `--autonomous`** once F is proven. Recommended: yes.
- **Whether the `AskUserQuestion` decision carrier is still needed** once step mode ends every
  turn (see the integration table).

## Coordinates with
- **PR #3262 and `research-as-a-job-later.md` (Praise):** see "Integrating with
  research-as-a-job".
- **Issue #2813 (Praise):** phase 2 replaces its `research_delivered` exit; H keeps its routing.
- **PR #3479 (clack391):** it rewrites the router rows this plan edits. research-plan's prose
  changes land in this plan's PR 2 after it merges.
- **PR #3494** (`question-state.ts`, the router) and **PR #3476** (`proof-conclusion.md`).
- **Issue #2539:** the same enum and agent slot. It does not stop the loop.
- **Issue #1830:** plan-time breadth for completeness questions.
- **Issue #2243 and its handed-state follow-up:** the parallel prerequisites.
- **Issue #3384:** fast project creation, so a PID one-shot needs no extra prompt.

## Costs
- **About +20–30% model calls** per run, roughly two per step boundary.
- **A reply after more than 5 minutes rewrites the main-thread cache:** about $0.11 per 30k
  tokens.
- **Offset:** the researcher stops passes like #3475's $26 of extra ones.
- **Paid eval runs:** `research`, `research-exhaustiveness`, `proof-conclusion`,
  `question-selection`, `research-plan`, `conflict-resolution`, `hypothesis-tracking` and
  `person-evidence` in PR 2, and `search-records` in phase 2, plus `make hook-smoke`.
- **The biggest single build** is the e2e persistent session.
