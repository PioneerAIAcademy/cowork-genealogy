# Research one step at a time

**Status:** Proposed, not started. For Praise to fold into the research-as-a-job work
(`docs/plan/research-as-a-job-later.md`, PR #3262); see "Integrating with research-as-a-job".
Phase 0 (a probe) comes first and changes no product code. This merges two drafts: a
single-pass plan drawn from feedback issue #3475, and a one-step-per-turn draft.

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
   from the router, with each agent handed its state, at a capped width.
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
| Conflict resolution | only on a conflict | its own step |
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
- **One pure predicate,** `step_allowed(turn_steps, candidate, mode)`, defined once in
  `packages/engine/plugin/hooks/step_boundary.py` (stdlib-only).
  - **It allows** the turn's first step, and the members of that step's group:

    | Group | Members |
    |---|---|
    | setup | `init-project`, `question-selection`, `locality-guide` |
    | plan | `research-plan` |
    | search | `search-records`, `search-images`, `search-full-text`, `search-external-sites`, `record-structurer`, `image-reader` |
    | link | `person-evidence` |
    | conflict | `conflict-resolution` |
    | hypothesis | `hypothesis-tracking` |
    | assess | `research-exhaustiveness` |
    | conclude | `proof-conclusion` |
    | forget | `forget-and-rederive`, `init-project`, `record-structurer` |

    A step may always repeat itself (a fan-out), and the router `research` is always allowed.
  - **Mode `job`** allows every step. **Mode `wrapup`** allows `research-plan` (dispose only),
    `research-exhaustiveness` and `proof-conclusion`, in that order.
  - **Names** are compared after the last `:`.
  - **The deny reason:** "Step complete. Give the researcher your report on the step that just
    finished, end with 'Continue with <label>?', and end your turn." The label comes from
    `STEP_LABELS`.
- **Enforced where the turn is already known.** Each plane calls the predicate from its own hook:

  | Plane | Turn steps from | Mode from |
  |---|---|---|
  | Prototype worker | its `PreToolUse` (`apps/server/proto/worker/options.py`), per `turn_id` | the turn's message |
  | Alpha | `apps/server/app/agent/real_agent.py`'s hooks, reset per user turn | the turn's message |
  | e2e harness | `eval/harness/e2e/orchestrator.py`, which sends each user message | the message it sent |
  | Unit harness | `eval/harness/harness/skill_runner.py` (one turn) | the test's message |
  | Cowork | the plugin hook's own entry point (phase 0 picks the signal) | its prompt text |

  - **The plugin hook steps aside where a host enforces.** It does nothing when the host sets
    `GENEALOGY_STEP_HOST=1`, giving one guard per plane, each testable.
  - **Mode detection is exact-phrase only:** "keep going." → `job`, "wrap it up." → `wrapup`,
    case and trailing punctuation ignored. Anything else is `step`.
  - **A host-sent prompt is never a new turn.** That covers a redelivery's continue prompt,
    Stop-hook feedback and compaction summaries.
- **The Stop veto is off in step and wrap-up turns,** and on in a job-mode turn:
  - **the alpha:** `Settings.auto_continue = False` in `apps/server/app/config.py`, with the
    hook re-armed for a job turn;
  - **the prototype:** nudges 0 by default (`apps/server/proto/docker-compose.yml`,
    `apps/server/proto/eb-web/.ebextensions/01-web.config`, `DEFAULT_MAX_NUDGES`), and the
    worker sets the usual cap for a job-mode turn;
  - **the cap tests:** `test_proto_config.py`;
  - **U13 figures:** `docs/plan/familysearch-handoff.md`.
- **A job-mode turn at the exhaustiveness choice** takes the recommended default once. A second
  "not exhaustive" verdict in the same job concludes, so "Keep going" cannot loop the way #3475
  did.
- **The outcome label:** with the veto off, `terminal_reason` would report `budget` ("Paused:
  this run reached its step budget") on every step. `apps/server/app/agent/continue_policy.py`
  treats `max_nudges == 0` as veto-off and reports `ok`, which renders no label.
- **The router stops ordering the model not to yield.** `skills/research/SKILL.md` deletes:
  - the "Continuous work" orders;
  - "Iterate — without yielding";
  - "these four are the only stop conditions";
  - "a run that no longer stops to ask".

  It gains the step-report rule (the step's `summary_for_user`, then "Continue with X?" and
  the reply options) and the job and wrap-up behaviour.
- **Web:**
  - `ChatPane.tsx`, `chatEvents.ts`, its test and `styles.css` get Continue, Keep going, Wrap
    up (only once evidence exists) and, at the choice, Search more buttons. Each sends its
    exact phrase.
  - Plus `hosted-web-workbench-spec.md`, and a test that `hand_back.py`'s regex never matches
    "Continue with X?".
- **Fallback:** if phase 0 shows Cowork's hook cannot find turns, Cowork runs on router prose
  alone.

### B. The choice at "not exhaustive"
- **research-exhaustiveness on a decline** (every active-plan item closed, a genuinely
  unsearched source remaining) writes `search_stop`:
  - `stopped_because: "resources_spent"`
  - `stop_criteria: null`
  - `justification`
  - `not_reached`, with one `deferred` entry per unsearched source; film, image or URL go in
    `description`
  - `status` stays `in_progress`

  It returns a recommendation from its `overturn_risk` criterion:
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
- **The ladder:** `src/utils/question-state.ts` gains one branch, above `:428-434`. When
  `stopped_because` is non-gate, there is no summary, and no plan item is open, the next step
  is "researcher's choice: research-plan or proof-conclusion".
- **The `resources_spent` contract is rewritten.** This reverses the 2026-09-30 lead ruling on
  issue #2539, which held that the value permits no conclusion. The sites:
  - `docs/gps-research-flow.md:48-56` and `:336-343`;
  - `docs/specs/research-schema-spec.md:116`, `:118`, `:582`, and the plans section;
  - both `enums.schema.json` trees' `stopped_because` descriptions;
  - `src/utils/question-stop.ts:86-92`.
- **The `deferred` kind:** both `enums.schema.json` trees, `CLOSED_ENUMS`
  (`src/validation/validator.ts:72`), and `research-schema-spec.md:119` and `:604`. The TS
  union is generated.

### B2. Wrap it up
- **Offered at any boundary once the question has evidence,** meaning at least one assertion
  extracted for it.
- **In one turn** (mode `wrapup`):
  1. research-plan's dispose mode skips every open item with
     `skip_category: "user_declined"`. The tool already allows that category on an open item
     (`research-append.ts`, near `:2602-2608`).
  2. research-exhaustiveness records the stop, using its existing "user wants to stop early"
     case (`agents/research-exhaustiveness.md:352`): `resources_spent`, with the skipped items
     and any other gaps as `deferred`.
  3. proof-conclusion concludes at the tier reached.
- **Before any evidence exists,** the reply says there is nothing to conclude yet.

### C. Concluding without an exhaustive search
- **`agents/proof-conclusion.md`:**
  - **`:215`:** drop "an undeclared exhaustiveness" from the clause that forbids a bounded or
    negative conclusion.
  - **`:716-719`:** the closing sentence names the unsearched sources when the stop record
    lists any, and keeps "second opinion" (`test_proof_conclusion.py:763-790`).
- **`apps/web/src/components/chatEvents.ts:42`:** `completed` reads "Research finished for now —
  see the summary for anything left unsearched. Send a message to research further."

### D. Executing the plan in parallel
- **search-records becomes an agent** (issue #2243). That is the prerequisite.
- **The router dispatches one search agent per plan item, one level down,** at most 4 at a time.
  - **Each agent is handed** its item, the person's attached records and the locality facts
    as arguments ("hand it the state, not a name to look it up by",
    `docs/plan/cost-latency-10x.md`).
  - **Items with `fallback_for`** run only after their primary finds nothing; otherwise they
    are skipped as `fallback_not_triggered`.
  - **Then** one `extraction_append({ recordIds })` call covers the FamilySearch hits, and one
    record-structurer spawn covers other sources.
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
  serialised. Until #2243 lands, the main thread issues the plan's independent searches as
  parallel tool calls.

### E. One question per run
- **`research_append` refuses a `questions` append** while another question is `open`,
  `in_progress` or `exhaustive_declared`. It is a writer precondition, with an engine test and
  a spec line.
- **The router's objective row** (`skills/research/SKILL.md:229`): after the tree-encoding gate,
  name any uncovered part of the objective as a suggested next question, as a statement.
- **question-selection, given more than one fact to research,** writes no question and asks the
  researcher to pick one. This makes `agents/question-selection.md` a paid slot; the
  `compound-objective-*` tests assert the ask.

### F. e2e continues on its own
- **`eval/harness/e2e/orchestrator.py` keeps one `ClaudeSDKClient` session open** with streaming
  input, and answers each yield with a real user message:
  - **"Continue."** to every prompt, which accepts the agent's own default, including at the
    choice;
  - **the fixture's own question** when asked for a single one.
- **The run ends** when the question is `resolved`. The 40-turn cap and the no-progress stop
  remain as runaway guards.
- **Production's mechanism runs unchanged** inside the harness.
- **Also:**
  - `classify_hand_back` and `nudge_report.py` learn the new line;
  - per-turn step and wall time are recorded, and `make e2e-latency` reports per-step
    p50/p90;
  - `e2e-test-spec.md` is updated;
  - two-question fixtures are re-scoped (genealogist work).
- **A separate e2e arm** answers "Keep going." once, and another answers "Wrap it up." after
  the search step, so both options are exercised.
- **Interim, if the persistent session slips:** the harness sets mode `job` for every turn, a
  stopgap that measures the old continuous flow.

### G. Editing the plan at the plan step
A free-text reply after the plan step is a plan edit. research-plan applies it in that turn:
- a struck item → `skipped` with `user_declined`;
- an added item → a new plan item.

The turn then ends with "Continue with running the searches?".

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
  step.
- **A one-shot ask with a PID on a new folder** needs the project first. Once issue #3384 makes
  project creation a single `project_create` tool call, that runs inside the one-shot's turn.
  Until then, it costs one extra prompt.
- **Cowork routing depends on the router being entered.** PR #3262 makes `research` the only
  front door.

## Measuring "respond sooner"
With one step per turn, **a turn's duration is its step's duration**, so production already
records the measure.
- **On the prototype,** the `turns` table (`apps/server/proto/sql/001_schema.sql`) holds
  `enqueued_at`, `claimed_at` and `completed_at` for every turn:
  - `completed_at − enqueued_at` is the researcher's wait;
  - `completed_at − claimed_at` is the step's own run time.
- **Report per-step p50 and p90** from those columns once step mode is live. The manager should
  read this figure: it says how long a researcher waits for each response, and it falls as
  `docs/plan/cost-latency-10x.md` and issue #2243 make steps shorter.
- **To break it down by step,** PR 1 adds a nullable `step` column to `turns`. The worker's step
  predicate fills it with the turn's first step, which turns "p90 by step" into one `GROUP BY`.
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
| "The Stop hook binds on every browser turn"; nudge cap 60; the alpha's `auto_continue` | **Changes:** the veto is off by default (nudges 0, `auto_continue` off) and re-armed only for a "Keep going" turn |
| `turns.outcome` values | **Mostly unchanged.** A step turn ends `ok` (no label); `completed` gets the honest label (section C); `delivered` goes in phase 2 |
| "`decision` and `mcp_unavailable` cannot fire" | **Unaffected;** step mode needs no `decision` exit |
| person-evidence's weak-match pause and its autonomous-only resolve-downward rule | **The pause becomes the link step's closing question,** asked with the researcher present. Resolve-downward still applies in "Keep going" turns and e2e |

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
| No leaf-skill changes beyond the listed ones | **Plus** this plan's research-exhaustiveness, proof-conclusion and question-selection changes |
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
  6. sibling calls are visible.
- **On both hosted planes:** a host-side deny binds alongside `continue_policy.foreground_rewrite`.
- **Record the results** in ADR-0005.

**Phase 1.**
- **PR 1 — code and CI tests:**
  - `step_boundary.py` (the predicate and the Cowork entry point), its `hooks.json` entry,
    `plugin-hooks.test.ts` cases and a matcher-coverage test, plus `make hook-smoke`;
  - **the host integrations:** the worker `PreToolUse`, the alpha hooks, the unit harness and
    the e2e orchestrator;
  - the job-mode Stop veto re-arm, and the veto-off outcome in `continue_policy.py`;
  - **writer and ladder rules:** the one-open-question rule and the `question-state.ts` branch;
  - **web:** the buttons and the `completed` string;
  - **schema and docs:** the `deferred` enum and the contract docs;
  - **telemetry:** the `turns.step` column;
  - **the e2e harness** per F.
- **PR 2 — prose; paid `research`, `research-exhaustiveness`, `proof-conclusion` and
  `question-selection` runs:**
  - **the router:** A's deletions; the step report and replies; the search fan-out (D); the
    choice replacing the loop row (`:225`); wrap-up (B2); plan edits (G); the objective row
    (E);
  - **the agents:** research-exhaustiveness (B), proof-conclusion (C), question-selection (E);
  - **tests:**
    - the five research-exhaustiveness unit tests that pin the old decline:
      `ut_research_exhaustiveness_001`, `_014`, `_015`, `_016` and `_d9i`;
    - three `research` tests (`autonomous-handoff`, `autonomous-is-always-a-job`,
      `open-ask-still-a-job`);
    - the `compound-objective-*` tests.
  - **research-plan's dispose mode** must accept "the researcher said wrap it up". That rides
    with PR #3479, which converts research-plan to an agent.
- **Prerequisite, staffed separately:** issue #2243.

**Phase 2 — cleanup.** Delete:
- `research_delivered` and its tests, `DELIVERY_GUIDANCE`, and the bounded-ask section's
  `research_delivered` close. Keep its routing list;
- `CONTINUE_REASON` outside job mode, `hand_back.py` and the runner's auto-continue chain;
- the same-turn hand-off lines in research-plan and search-records.

## Acceptance (each fails today)
1. **Predicate unit tests:**
   - a second step from another group is denied, with "Continue with" and its label;
   - a same-group member is allowed;
   - job mode allows everything;
   - wrap-up allows only dispose → exhaustiveness → conclusion;
   - a host-sent prompt does not open a turn;
   - a corrupt input is allowed.
2. **Host-hook tests** on the worker, alpha, unit harness and e2e paths. The plugin entry point
   does nothing when `GENEALOGY_STEP_HOST=1`.
3. **`continue_policy`:** veto off gives `ok`, not `budget`; a job-mode turn is nudged.
4. **`research_append`** refuses a second open question.
5. **The `question-state` choice branch.**
6. **Web:** the buttons appear and send their phrases; `completed` renders the new string.
7. **Unit (paid):**
   - one step, then "Continue with";
   - "Keep going." runs past a boundary and concludes on a second decline;
   - "Wrap it up." skips the open items, records `resources_spent` and concludes;
   - a decline offers the overturn-risk default;
   - a three-item plan is dispatched in one message at width ≤ 4;
   - a two-question message gets the ask;
   - a plan edit is applied.
8. **Phase 0's hosted arm on the phase 1 build:** the second step is denied on both planes.
9. **A fresh hosted session** on the Benz and Haist feedback openers
   (`feedback-2026-10-08T12-32-23-007161Z.zip`, `feedback-2026-10-05T17-53-26-347549Z.zip`)
   ends after one step with "Continue with …?".
10. **One e2e panel fixture runs to a proof on auto-answer.** Its runlog carries per-turn steps,
    times and the Continue count, and `make e2e-latency` reports per-step p50/p90.
11. **The prototype's `turns.step`** is filled for every step turn, and a per-step p50/p90 query
    over `turns` returns figures.

## Open decisions
- **Errands in step mode.** An errand is a step that ends naming what to fetch, which keeps the
  2026-09-27 and 2026-09-30 rulings. Recommended: yes.
- **`deferred` as an enum value or prose.** Recommended: the enum value.
- **Retire `--autonomous`** once F is proven. Recommended: yes.
- **Whether the `AskUserQuestion` decision carrier is still needed** once step mode ends every
  turn (see the integration table).

## Coordinates with
- **PR #3262 and `research-as-a-job-later.md` (Praise):** see "Integrating with
  research-as-a-job".
- **Issue #2813 (Praise):** phase 2 replaces its `research_delivered` exit; H keeps its routing.
- **PR #3479:** it rewrites the router rows this plan edits, and carries research-plan's
  dispose line.
- **PR #3494** (`question-state.ts`) and **PR #3476** (`proof-conclusion.md`).
- **Issue #2539:** the same enum and agent slot. It does not stop the loop.
- **Issue #1830:** plan-time breadth for completeness questions.
- **Issue #2243:** the parallel prerequisite.
- **Issue #3384:** fast project creation, so a PID one-shot needs no extra prompt.

## Costs
- **About +20–30% model calls** per run, roughly two per step boundary.
- **A reply after more than 5 minutes rewrites the main-thread cache:** about $0.11 per 30k
  tokens.
- **Offset:** the researcher stops passes like #3475's $26 of extra ones.
- **Paid eval runs:** `research`, `research-exhaustiveness`, `proof-conclusion` and
  `question-selection`, plus `make hook-smoke`.
- **The biggest single build** is the e2e persistent session.
