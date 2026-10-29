# Research one step at a time

**Status:** **Phase 0 complete (2026-10-19). Phase 1 in flight:** the research-plan prep PR (#3682) is merged, proof-conclusion's (#3889) is open, PR 1 is #3883, the route PRs are #3914-#3916, PR 2 is #3917, and the conflict PR follows them. Its answers are in
ADR-0005 and decisions 23 and 24 below carry what they changed. For Praise to fold into the
research-as-a-job work
(`docs/plan/research-as-a-job-later.md`, PR #3262); see "Integrating with research-as-a-job".
Phase 0 (a probe) comes first and changes no product code. This merges two drafts: a
single-pass plan drawn from feedback issue #3475, and a one-step-per-turn draft. plan-critic
has reviewed this merged version six times, and its findings are folded in. After round 4,
"Keep going" was simplified to replies the host sends for the researcher (decision 13).
Decisions 14–23 were added on 2026-10-18. A set-aside design reviewed in three plan-critic
rounds was dropped for decision 15, which reuses the wrap-up path. Rounds 4 and 5 reviewed
the replacement and the unsettled-conflict ending; their findings are folded in.

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
7. **"Keep going" stays as an option.** It runs the rest of the flow without stopping to ask.
8. **"Wrap it up" is available at any boundary** (widened by decision 15). It stops further
   research and writes the conclusion from what was found. That may fall short of the GPS's
   reasonably exhaustive search, and the conclusion says so. For many researchers it is good
   enough.
9. **Losing the early stop on easy questions is accepted.** Fallback chains recover most of it
   (section D).
10. **e2e continues on its own by auto-answering.** A recalibration period is accepted.
11. **The reply phrases can change** after implementation, on user feedback.
12. **A conflict that cannot be settled stays `unresolved`,** rather than being recorded as
    `resolved` with kind `tree`. A run ends on the conclusion it leaves open.
13. **"Keep going" is the host replying for the researcher** at the end of each one-step turn,
    not one long turn. e2e uses the same replies, and no hosted turn needs the Stop veto
    (section A2).

## Decisions taken (lead, 2026-10-18)
14. **Show only the replies that apply.** The host works out which buttons a turn gets, and
    sends them on `turn_done` (section A).
15. **"Wrap it up" works before any evidence exists,** and it closes the question at the tier
    reached, `not_proved` included. A different question mid-run is answered with an offer to
    wrap the current one up first (section E). No question is left unconcluded without the
    researcher saying so, and no parked state is needed.
16. **Errands are steps.** An external-site search ends its step naming what to fetch, and
    the researcher can carry on without waiting for the upload (section I).
17. **A question about the findings gets an answer, not a step** (section J).
18. **New top-level tasks are agents,** entered through the router, each with a step group
    (section K). An all-code task is the exception: a bounded-list line naming its tool calls,
    with no step group (section K).
19. **The prose ships as small PRs.** The parts that work under today's behaviour land first,
    one eval slot each. The router, research-exhaustiveness, person-evidence and
    question-selection land in PR 2, right after PR 1 (Phases).
20. **Helper work becomes plan items on the current question,** not new questions: a conflict
    that needs new evidence, a FAN pivot and an objective-level sub-question (section E).
21. **`deferred` is a closed-enum value** of `not_reached`, not prose (section B).
22. **`--autonomous` is retired** once e2e runs on the host's "Keep going." replies (section
    F). The e2e orchestrator then passes search-external-sites `userPresent: no` itself.
23. ~~**The `AskUserQuestion` decision carrier is dropped.**~~ **REVERSED by the lead,
    2026-10-19.** The carrier STAYS, and is the mechanism rather than something made
    redundant by one. Its premise -- "every step ends at a boundary, so a question for the
    researcher is a step's ending" -- was falsified by phase 0: a `PreToolUse` deny does not
    end a turn **on the alpha** (`probe_step_deny.py` run 2; in Cowork a plain deny did end
    the turn, ADR-0005 message 3 -- one run each, and decision 25 does not rest on it), and `AskUserQuestion` itself waits in Cowork but
    does not end the turn either (ADR-0005 item 10). `DecisionCard` still becomes the home for
    the reply buttons, which is unchanged.

## Decisions taken (lead, 2026-10-19)
24. **The boundary is `AskUserQuestion`, and nothing else.** Option 1 of the four put to the
    lead after phase 0. Asked because a `PreToolUse` deny was measured NOT to end a turn: the
    model reports the refusal and carries on with whatever else the turn had queued
    (`apps/server/dev/probe_step_deny.py`, alpha, 2026-10-19). The lead's words: *"Just go with
    option 1 (AskUserQuestion is the main path). No need for anything else (no halt)."*

    **One premise of that choice is since measured false, and the question is back with the
    lead.** It was chosen on the understanding that `AskUserQuestion` ends the turn. It does
    not: in Cowork it genuinely WAITS (93s, no call until answered) but the answer returns
    inside the same turn, and the run carried on for ~5.5 minutes afterwards (ADR-0005 item
    10). So the researcher is reliably asked, which is what decisions 1-3 are for, but a step
    is bounded only by router prose, not by a turn boundary. That is the cost-and-latency half
    of the motivation, and prose failing to bind is the failure this whole plan exists to fix.
    Until the lead answers, treat "no halt" as the standing instruction and this as the open
    risk against it.

25. **ANSWERED, and 24 is superseded: build the halt, on the FS prototype only** (lead,
    2026-10-19). The reasoning is that the real cost and latency exposure is the prototype,
    not Cowork, where the researcher can always press stop.

    - **Prototype.** `AskUserQuestion` is the normal path and the halt is the BACKSTOP, not
      the first move. When the model starts a new step without having asked, **deny** it
      first ("report the step and ask with `AskUserQuestion` first"); **halt** only if it
      tries again. That keeps the report and the question as what the researcher normally
      sees and makes a silent stop rare, which is the answer to the "a halt ends the turn
      with no reply" finding (ADR-0005 item 10). The halt also DENIES the call it stops, as
      `_halt` already does, so the next step never starts.
    - **Cowork.** No hook. `AskUserQuestion` plus router prose. If the model forgets to ask
      it runs on, which is what Cowork does today, and the researcher can stop it. Not worth
      a stateful hook yet.
    - **Alpha.** Nothing. It is retired within months.

    Three riders the lead attached:

    1. **The rule is "no new step until the researcher has answered since the last one",**
       NOT "one step per turn". In Cowork the answer returns inside the same turn (ADR-0005
       item 10), so a per-turn rule would be wrong there.
    2. **Log every halt on the prototype.** The router prose is identical on both planes, so
       the halt rate measures how often Cowork runs past a boundary. A high rate is what
       would buy the Cowork hook, with numbers rather than a guess.
    3. **The eval harnesses will enforce a boundary Cowork does not have,** so no eval can
       catch a Cowork miss. Recorded on the `nothing-checks` register as an ARCHITECTURE gap rather than a
       backlog issue, because it changes how a correct change is made: see
       `docs/architecture.md` §9.4, gap 4.

    Decision 23 stays reversed: the `AskUserQuestion` carrier is kept.

## Decisions taken (lead, 2026-10-25)
26. **`foreground_rewrite` stays, through PR 1 and phase 2.** Claude Code still runs an `Agent`
    call with no `run_in_background` key in the background: its own tool text says so through
    2.1.308 ("Agents run in the background by default"), and all 111 such launches that started
    on the alpha's Sep 21 and Oct 5 builds did. The turn then ends while its agents run. The
    prototype worker reads a turn only to its first result and then kills the CLI (`_run_turn`
    in `worker.py`: `client.disconnect()`, then `kill_uid` on the slot), so an agent still
    running dies mid-search: D17 lost both background extractors that way (the
    `DELEGATION_TOOLS` comment in `continue_policy.py`). The Stop veto never covered this,
    because it cannot see a background agent, and from PR 1 no hosted turn binds it (cap 0,
    section A). So PR 1 keeps the rewrite bound in the hook it edits (section A's host table),
    and phase 2 keeps it when it deletes the veto.
27. **Cowork's agents run in the foreground too, by the router's wording first.** Cowork ships
    no step hook (decision 25). Its plugin hook sees every `Agent` call, to deny forks (PR
    #3762), but does not rewrite it, and nothing in the plugin sets the key. On the hosted alpha
    the model left the key out or set it true on 26–72% of its spawns, so a Cowork step can
    report and offer "Continue with …?" before its agents return.
    - **The wording:** the router's spawn rule (`skills/research/SKILL.md:215`) passes
      `run_in_background: false` on every `@plugin:` spawn, with a test (PR 2).
      forget-and-rederive's two spawns stay as they are: the skill is alpha-only and goes at the
      end of 2026.
    - **One Cowork session first** (Praise, as in phase 0), before PR 2's paid router run. It
      records Cowork's Claude Code version (from the transcript), whether its `Agent` tool offers
      `run_in_background`, whether it applies a plugin hook's `updatedInput` (a probe plugin that
      rewrites the key), and whether it moves an agent running over about two minutes to the
      background (`CLAUDE_AUTO_BACKGROUND_TASKS`). If the tool does not offer the key, neither the
      wording nor a hook can work, and this decision goes back to the lead.
    - **The miss rate:** after PR 2 the worker's `ev=foregrounded` log line fires only on a spawn
      the wording did not mark `false`, and the wording is the same on every plane, so that rate
      stands for Cowork's, as rider 2's halt count does.
    - **A hook arm only if needed:** a stateless rewrite in `guard_project_files.py`, built only if
      the Cowork session shows Cowork applies a plugin hook's `updatedInput` and the miss rate is
      high. It must then stand aside on the hosted planes, through a variable they set: when two
      hooks rewrite one call, the last to finish replaces the whole input (measured 2026-10-25 on
      2.1.215 to 2.1.308), so a plugin arm would drop the alpha's `effort`.
28. **Step mode measures cost as well as wait:** spend per step, and the reply each boundary
    got (Measuring "respond sooner").

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
| Setup: init-project (new project), the attached-records baseline for each subject (`extraction_append` with `personId`, then `timeline_build`: tool calls, not steps; `docs/plan/attached-records-baseline.md`), question selection, locality guide (if the place is unsurveyed) | always | what the attached records show (events, how many are unverified, the high gaps), then "Here's the question I'll research … Continue with planning the searches?" |
| Plan: research-plan | always | the plan, then "Continue with running the searches?" |
| Search: every plan item in parallel, then extraction | always | what was found, any searches only the researcher can run (section I), then "Continue with linking the records?" |
| Link: person-evidence | always | what attaches to whom |
| Conflict resolution | only on a conflict | its own step; when the evidence in hand cannot settle it, the record that could, then "Continue with planning the searches?" (section E) |
| Hypothesis tracking | only on competing identities | its own step |
| Assess: research-exhaustiveness | always | "exhaustive", or the choice (section B) |
| Conclude: proof-conclusion | always; the last step | the full output, no prompt |

**What the researcher can reply.** The hosted app shows a button for each reply that applies
to the turn, and nothing else; each sends its exact phrase. Cowork's reply lists the phrases
that apply:
- **"Continue."** Run the next step.
- **"Keep going."** Run the rest of the flow without stopping to ask: the host replies for
  the researcher at the end of each step (section A2). Typing anything stops it.
- **"Wrap it up."** Stop searching and write the conclusion now, from whatever was found
  (section B2).
- **"Search more."** Only at the exhaustiveness choice. Plan searches for the sources left
  unsearched.
- **An upload.** A capture for an external-site search handed out earlier (section I).
- **A question about the findings.** Answered from the project, with no step run (section J).
- **Free text.** A steer the router acts on: a new plan item on the current question, or at
  the plan step a plan edit (section G).

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
    | one member each | every other agent the router can spawn: `tree-survey`, `search-hints`, `source-evaluation`, `survey-surname`, `timeline`, `gps-mentor`, `citation`, `translation`, `historical-context`, `check-warnings`, `tree-edit`, `convert-dates`, `search-familysearch-wiki`, `search-wikipedia`, `validate-schema` |

    A step may always repeat itself (a fan-out), and the router `research` is always allowed.
  - **Every agent and skill has a listed group.** A test reads `agents/*.md` and `skills/*/`
    and fails when one is in no group, so a new agent cannot ship without a decision about what
    may follow it in a turn (section K). The router `research` is exempted by name. Prove it
    fails by adding an unlisted agent file.
  - **A step that opens a turn uses its home group:** research-plan → plan, locality-guide →
    setup, init-project → setup, record-structurer → search. The overlaps only admit a
    follower:
    - **`locality-guide` after research-plan,** because research-plan stops for an unsurveyed
      place (`agents/research-plan.md:270-275`).
    - **research-plan after research-exhaustiveness, only while the active plan has open
      items.** That is dispose's precondition (`skills/research/SKILL.md:226`). So a decline
      turn cannot start a new plan.
    - **`search-hints` after a search-group step,** because a hints plan item runs in the
      search step (section D, issue #3153). Its home group stays its own, so a turn it opens,
      such as a verdict on a hint, admits no search.
  - **`ctx` carries what the turn's steps cannot show,** computed from `research.json` by
    `step_ctx(research)` in `step_boundary.py` when a research-plan call is checked.
    - **The current question** is the last unresolved entry in `questions[]`, from one
      function, `current_question(research)`, which `reply_options` uses too. Entries are
      appended in order, so array order is creation order.
      It includes a concluded question whose conflict is getting its evidence round, since E's
      rule refuses a new question while that round's items are open.
    - **`open_items`:** whether the current question's active plan has a `planned` or
      `in_progress` item, not counting an item waiting only on the researcher's upload
      (section I).
    - **Each host reads the file** with what it already holds: the prototype worker with
      `read_research` (`worker.py`), the alpha with `read_research_json(project_dir)`, both
      harnesses from the workspace. Cowork was to read it from the hook's working
      directory, but ADR-0005 item 7 measured that it is NOT readable (the cwd is
      `/home/claude`), and under decision 25 Cowork ships no hook, so that arm
      is moot. The alpha's `count_only` hook does no I/O today (`real_agent.py`),
      so it reads `ctx` only for a research-plan call.
    - **A host that cannot read it passes nothing, and the follower is denied.** The cost is one
      needless pause, never an unasked plan.
  - **Mode `job`** allows every step. Only Cowork uses it, for its one-turn "Keep going"
    (section A2), and e2e's interim fallback (section F). **Mode `wrapup`** allows, in order:
    1. `research-plan` (dispose), only while `ctx` shows an open item;
    2. `person-evidence`;
    3. `conflict-resolution`;
    4. `research-exhaustiveness`;
    5. `proof-conclusion`.

    Apart from that `ctx` check, the predicate checks membership and order only. Router
    prose says when a member is skipped:
    - person-evidence runs only for a question's assertions with no live link, or for a
      question whose `project_context` `nextStep` names person-evidence, as one resting on
      attachment links does (`docs/plan/attached-records-baseline.md`, decision 17);
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
  | Prototype worker | `PreToolUse` in `apps/server/proto/worker/options.py` (sees every call) | the claimed turn | The hook is rebuilt per attempt, and redelivery is the normal resume path. So the worker stores the turn's first step and mode in `turns.step` and `turns.mode`, and a redelivered attempt (`receive_count > 1`) seeds from them. The check sits in `_pretool` ahead of the `foreground_rewrite` return and only denies or halts, so an allowed step's `Agent` calls are still foregrounded (decision 26) |
  | Alpha | `apps/server/app/agent/real_agent.py` | `handle_turn(text)`, reset in `_begin_turn_hook_state` | The main hook's matcher omits `Skill`. Put the step check in the `count_only` hook, or widen the matcher and update `test_write_lockdown.py`. No redelivery **SUPERSEDED by decision 25**. The alpha gets nothing under decision 25. |
  | Unit harness | `eval/harness/harness/skill_runner.py`'s `pretool_hook` | the one turn | Run the step check **before** the stub, so a stub's canned reply never replaces the step denial, and ahead of the `foreground_rewrite` return (decision 26) |
  | e2e harness | `eval/harness/e2e/orchestrator.py`'s `PreToolUse` | the user messages it sends (section F) | The resume-on-stall prompt is not a new turn. The check goes ahead of the non-MCP `foreground_rewrite` return (decision 26) |
  | Cowork | the plugin hook's own entry point (phase 0 picks the signal) | its prompt text | The hook is a fresh process per call, so the entry point keeps the turn's steps in a session state file, or reads them from the transcript (phase 0) **SUPERSEDED by decision 25**. Cowork ships no hook under decision 25. |

  - **There is no plugin step hook** (lead, 2026-10-21). The prototype worker
    enforces with its own `PreToolUse`, and neither harness loads the plugin's
    `hooks.json`, so the only plane a plugin step hook could run on is Cowork --
    which decision 25 gives no hook. Nothing to step aside from, so no
    `GENEALOGY_STEP_HOST`.
    - `step_boundary.py` still lives in `plugin/hooks/`, as a **library**: the
      worker and both harnesses load it with `importlib`, the way
      `context_policy.py` loads `guard_project_files.py`. It is not registered as
      a hook anywhere.
  - **Mode detection is exact-phrase only:** "keep going." → `job`, "wrap it up." → `wrapup`,
    case and trailing punctuation ignored. Anything else is `step`. **One normalizer,**
    `step_mode(text)` in `step_boundary.py`, is used by every plane, so a typed "Keep going!"
    starts the same thing everywhere. On the hosted planes a `job` message runs as a step turn
    and starts the host's replies (section A2); only Cowork runs it in mode `job`.
  - **A host reply under "Keep going" is a new turn,** like the researcher's own reply. A
    resume or stall prompt is not.
- **No hosted turn arms the Stop veto.** Every turn is one step, so a turn that stops has  **SUPERSEDED by decision 25**: rider 1 keeps the rule as one step per *boundary*, not one per turn
  finished its step.
  - **Prototype:** `turn_max_nudges` (`worker.py`) returns 0 for every turn, so the worker binds
    no Stop hook. The web tier never needs the plugin.
    - **`proto-demo-auto`** posts the fixture prompt, then "keep going." after its turn. It waits
      until the session has no open or held turn, and it queries the session's turns rather than
      the one it posted (`apps/server/proto/demo.py`).
      `proto-bounds CASE=probe_resume` and `proto-kill` run on one step turn. `turn.py`'s
      docstring and `bounds.py`'s reading of a 0 cap change with them.
    - **Other sites:** `test_proto_config.py`'s p99 test; the `turn_max_nudges` cases in
      `test_proto_worker.py` and the test after them; `apps/server/proto/demo.py`, which reports
      the stamped `max_nudges` as the cap the worker ran under; `test_proto_target.py`; and
      U13's figures in `docs/plan/familysearch-handoff.md`.
  - **Alpha:** the Stop hook binds per session in `_build_hooks` whenever its cap is above 0
    (`real_agent.py`). Set `Settings.autonomous_max_nudges` (`config.py`, passed in by
    `sandbox/e2b.py` and `sandbox/local.py`) and `_DEFAULT_MAX_NUDGES` to 0. A test pins the two
    equal (`test_alpha_stop_hook.py`), and that file's `>= 26` floor and `== 30` pins change with
    them. Existing alpha sandboxes keep their creation-time code until the 72-hour cutoff
    (`app/sessions.py`), so step mode reaches the alpha over about three days.
  - **Deviation recorded (PR 1, review of aa48f22e):** `turn_max_nudges` keeps returning the
    queue body's stamped value rather than a hardcoded 0. The switch is the WEB tier's
    `DEFAULT_MAX_NUDGES`, now 0, which is what every real turn carries; the worker honouring
    what was stamped is the layering the field exists for, and hardcoding 0 would remove the
    only way to exercise the veto/deny/halt path deliberately. `max_nudges()`'s docstring
    says so.
  - **`proto-demo-auto` and `proto-probe-resume` keep exporting 40, deliberately.** That
    export is what keeps the Stop hook under a live test at all, and `test_proto_demo.py`
    pins it on purpose. Under step mode such a turn gets veto, deny, then halt, so the
    recipe does not reach its verdict today. Lowering it to 0 would not fix that: without
    the keep-going driver below the run is one step, and the verdict wants a completed
    project either way. Both paths need the driver, so the export stays where its own
    tests put it.
  - **Still owed, and NOT in PR 1:** `demo.py`'s keep-going driver — posting "keep going."
    after each turn and waiting until the session has no open or held turn — with the
    `bounds.py`, `turn.py` and `test_proto_target.py` changes beside it. Until it lands,
    `make proto-demo-auto` runs one step and its verdict, which wants a completed project,
    is not reachable under step mode. It is a live billed recipe, so it is built and run
    together rather than built blind here.
  - **Phase 2 deletes the veto** (see Phases).
- **Outcomes:**
  - A step turn ends `ok`, which renders no label: at cap 0 no plane binds the Stop hook.
  - A turn whose step completed the project has no Stop verdict to report that, so the worker
    sets `completed` at turn close from `project_completed(read_research(...))` when no Stop
    verdict was recorded. The honest `completed` label (section C) then shows on step turns
    too.
    - **Amended to the implemented rule (review of aa48f22e).** This said "only when the
      project became completed DURING the turn". The worker cannot know that without reading
      `research.json` at the turn's START — a read every turn would pay and a down store must
      not be asked twice — so it labels the first `ok` turn that SEES a completed project
      when no other turn of the project carries the label. Two consequences follow, and the
      first is the better behaviour: when the completing turn closed `stopped`, `budget` or
      `delivered`, the next ordinary turn carries the label, which is right — the project IS
      complete and the researcher should be told, and labelling a turn they stopped would
      not say that.
    - **The second is a real gap, and it is the lead's call.** A project completed a SECOND
      time — a follow-up question wrapped up after the first completion — is never labelled
      again, so the researcher never sees "Research complete" for it. Fixing it properly
      means stamping the project's completeness on the turn row at close and comparing with
      the previous closed turn: one column, one small query, no extra `research.json` read,
      but a migration. Worth doing, and sized here rather than guessed at. The completion
      halt (#3542 lead 1) already labels the turn whose proof-conclusion call completed the
      project, a second completion included; the gap is left only where that halt did not
      fire.
- **The router stops ordering the model not to yield.** `skills/research/SKILL.md` deletes:
  - the "Continuous work" orders;
  - "Iterate — without yielding";
  - "these four are the only stop conditions";
  - "a run that no longer stops to ask".

  It gains the step-report rule (the step's `summary_for_user`, then "Continue with X?" and
  the reply options), the wrap-up behaviour, and Cowork's one-turn "Keep going" (section A2).
  A step that ends on a question only the researcher can answer writes no "Continue with …?"
  line, and a "Keep going." turn starts from the step the last turn offered.
  `docs/architecture.md:859-860` says finishing a sub-skill is mid-loop; it changes with it.
- **No `hooks.json` entry.** `step_boundary.py` ships in `plugin/hooks/` as a library the
  worker and both harnesses import; it is never registered as a plugin hook, so there is no
  `plugin-hooks.test.ts` case, no matcher-coverage test and no `make hook-smoke` step arm.
  Still add a row for the guardrail to `docs/specs/guardrail-enforcement-spec.md`'s table
  (`docs/architecture.md`, "Restrain something"), saying it binds in the prototype worker and
  both harnesses, **not** Cowork.
- **Web:**
  - `ChatPane.tsx`, `chatEvents.ts`, its test and `styles.css` get Continue, Keep going, Wrap
    it up and Search more buttons. A turn shows exactly the ones named in its
    `turn_done.options`, and each sends its exact phrase.
  - **The host decides which apply,** with one pure function in `step_boundary.py`,
    `reply_options(offered_step, research)`, called where the host already reads the
    offer line for `next_auto_reply` (section A2). It returns:
    - **nothing** when the turn makes no offer, such as a step that ended on a question for the
      researcher or a final conclusion. The test is the offer line, never the step the turn
      ran, so a wrap-up turn that ends offering the next question still gets its buttons;
    - **only Wrap it up** when the offer is `wrap-up` (section E);
    - otherwise **Continue** and **Keep going**, plus:
      - **Wrap it up** when `current_question(research)` exists and the offered step is
        neither proof-conclusion (Continue already concludes) nor question-selection (the offer
        after a wrap-up, where the current question may be one a conflict held open);
      - **Search more** at the choice with a low-risk default: the offer is proof-conclusion,
        and the question has a `resources_spent` stop and no proof summary. At a high-risk
        choice the offer is already planning, and Wrap it up is the alternative. Reading the
        state rather than the turn's step keeps the button when a question between steps
        repeats the offer (section J).
  - **"The current question"** is `current_question(research)` (`ctx` above).
  - **Both hosted planes** put the list on `turn_done` as `options`, and leave the field out
    when it is empty, as they do `reply_follows`. The prototype's `complete()` (`worker.py`)
    does not read `research.json` today; PR 1 adds one read there, shared with the turn-close
    `completed` check. The alpha computes it in `_run_turn`'s tail.
  - **A typed phrase can still not apply,** so the router keeps a one-line decline for "Search
    more" away from the choice.
  - **A host reply** shows in the chat as an automatic "Keep going.", and the buttons stay
    hidden while "Keep going" runs.
  - Plus `hosted-web-workbench-spec.md`.
- **Cowork runs on router prose alone** (decision 25). This was written as a fallback for
  "if phase 0 shows Cowork's hook cannot find turns or keep state". Phase 0 showed it CAN
  (ADR-0005), and the lead chose prose anyway: the cost exposure is the prototype, and a
  Cowork researcher can press stop. Rider 2's halt rate on the prototype is what would buy
  the hook later, with numbers rather than a guess.

### A2. "Keep going": the host replies for the researcher
- **"Keep going" is a run of ordinary step turns.** After each one, the host sends the next
  message itself, as if the researcher had pressed a button. The researcher sees each step's
  report as it lands, and typing anything or pressing Stop ends the run.
- **Every "Continue with …?" line uses its step's exact `STEP_LABELS` entry,** so a host can
  read which step is offered. What the step will act on goes in the sentence before: the
  sources still unsearched (section B), or the record that could settle a conflict (section E).
- **One pure function picks the reply:** `next_auto_reply(state, turn_mode, prev_step,
  turn_step, offered_step, outcome)` in `step_boundary.py`. The worker, the alpha and the e2e
  harness load it as they load the predicate, and the alpha's `ends_with_hand_back` uses its
  line parser.
  - **`turn_mode`** is `step_mode` of the turn's message. Only a `job` turn, the researcher's
    "keep going." or a host reply, gets a reply, so a "Continue." or "Wrap it up." turn ends the
    run.
  - **`prev_step` and `turn_step`** are the steps the previous turn and this turn ran, which
    every host already tracks for the step check. The prototype reads `prev_step` from the
    session's last closed turn with a non-null `turns.step`, so a turn that ran no step
    (section J) is skipped.
  - **`offered_step`** is the step whose `STEP_LABELS` entry the turn's last line names; a line
    that names no entry counts as no offer. The prototype reads the line from `result.result`
    at the `complete()` call.
  - **A planning round** is a research-plan turn whose `prev_step` is outside setup and the plan
    step. That includes a run's first turn when "Keep going" answered B's high-risk choice or
    E's conflict offer. The first round is allowed. After it, a research-plan offer gets "Wrap it
    up.", and a second round, if one happens anyway, ends the run. That bounds both loops, a
    second "not exhaustive" round and a conflict's second evidence round.
  - **It replies "Keep going."** to any other offer. In a "Keep going." turn the router runs the
    step the last turn offered, and passes person-evidence `userPresent: no` (section B2).
  - **It returns nothing, ending the run,** when:
    - the turn's outcome is anything but `ok` or `completed`, such as `stopped`;
    - the turn has no offer, including a step that ended on a question for the researcher;
    - the offer is `wrap-up`, which only the researcher can answer;
    - the turn ran proof-conclusion;
    - the turn repeats a (`turn_step`, `offered_step`) pair already answered since the run's
      last planning round, which ends a link-and-assess cycle that never plans;
    - the run has sent `MAX_AUTO_REPLIES` replies (30, today's alpha `auto_continue_max_steps`,
      which this constant replaces).
- **Per plane:**
  - **Prototype:** the reply is queued inside `complete()`'s transaction (`worker.py`), under
    `grants.QUEUE_LOCK_SQL`, as a held turn row (`outcome='queued'`, `message.auto=true`), and
    only when no held row exists and Stop is unset. The existing `release_next_held` sends it.
    - **Lock order:** whenever a reply may be due, `complete()` runs `QUEUE_LOCK_TIMEOUT_SQL` and
      `QUEUE_LOCK_SQL` as its first statements, before the row's `FOR UPDATE`, because
      `admit_message` takes the queue lock before `session_seq` and `sessions`. A lock timeout
      closes the turn without a reply rather than failing the close. A `test_proto_queue_pg.py`
      case races `admit_message` against `complete()`.
    - **That inherits** the web tier's guard against a researcher's message posted at the same
      moment, the recovery of a stranded held row after a crash, and the put-back after a
      failed send. A put-back reply waits for the researcher's next message or the closed
      turn's redelivery, so a failed send stalls the run until one of those.
    - **The worker builds the queue body** with code lifted out of `proto/web/app.py` into a
      module both images copy, as `grants.py` is, since the worker image has no `proto/web/`. It
      goes in both Dockerfiles, `scripts/eb_bundles/build.py` and `verify.py`, and the
      `test_eb_bundles.py` fixtures; `test_proto_config.py`'s module-carriage test covers only
      the Dockerfiles.
    - **The run's state** (replies sent, planning rounds, answered pairs) lives on the
      `sessions` row. The worker clears it when it claims an open turn (`completed_at IS NULL`)
      not marked `auto`, so a duplicate delivery of a closed turn leaves it alone.
    - **Stop and typing win over a held reply.** `take_queued_turn` and the web tier's
      `_claim_held` never release an `auto` row while Stop is set, and never clear Stop for one.
      `admit_message` drops a held `auto` row when the researcher's message arrives.
    - **The SSE stream's `has_queued`** leaves out `auto` rows, so a held reply does not show "A
      message is waiting…"; `admit_message`'s own count keeps them.
    - **The reply shows** as an `auto_continue` `session_events` row, which `row_to_wire` passes
      through and `chatEvents.ts` already renders as automatic.
    - **The resume prompt** (`RESUME_CONTINUE_TEXT`, `options.py`) says "do not ask the user
      anything", so a redelivered step would end without its line. It becomes "finish the step
      and end with its 'Continue with …?' line".
    - Update U4's comment that a real turn's row is the web tier's (`worker.py`).
  - **Alpha:** the runner already answers a turn that ends with a hand-back line itself
    (`runner.py`, `ends_with_hand_back`). The pattern becomes "Continue with …?", the reply
    comes from `next_auto_reply` instead of the fixed "Yes.", and the chain runs only while
    "Keep going" is on. `real_agent` exposes `turn_step` to the runner, as `pending_user_message`
    is wired the other way, and `MockAgent` and the test stand-ins tolerate its absence. `serve`
    keeps the previous turn's step across a researcher's message. Update
    `test_runner_auto_continue.py`.
  - **Both hosted planes** set `reply_follows: true` on `turn_done` when a reply will follow, and
    leave the field out otherwise, so the exact `turn_done` assertions in the alpha's tests
    stand. On such a `turn_done` the buttons stay hidden and ChatPane stays busy. On the alpha
    the decision moves into `_run_turn`'s tail (`runner.py`), since `_run_turn` emits `turn_done`
    before `serve` decides today.
  - **e2e:** the orchestrator replies with the same function (section F).
  - **Cowork** has no host to reply. There, "keep going." is one turn in mode `job`, bounded by
    one router sentence: plan at most one extra round, then wrap up.

### B. The choice at "not exhaustive"
- **research-exhaustiveness on a decline** (every active-plan item closed or waiting only on
  an upload, a genuinely unsearched source remaining) writes `search_stop`:
  - `stopped_because: "resources_spent"`
  - `stop_criteria: null`
  - `log_entry_ids` listing the log entries of **every** plan of the question. After "Search
    more" a question has two plans by design, and the ladder's coverage check reads both.
  - `justification`, opening with the verdict, "Overturn risk: low" or "Overturn risk: high —
    <sources>". Non-gate stops force `stop_criteria: null`, so this is where the default is
    saved for a later session.
  - `not_reached`, with one `deferred` entry per unsearched source that was never planned
    (film, image or URL go in `description`), and one entry of the existing `handed_to_user`
    kind per item waiting on an upload (section I)
  - `status` stays `in_progress`

  The reply recommends from that verdict:
  - **low:** "Continue with writing the conclusion?", after a sentence naming what was left
    unsearched, with "search more" named;
  - **high:** "Continue with planning the searches?", after a sentence naming the sources that
    could change the answer and why, with "wrap it up" named.
- **Searched items close before a decline.** An item whose search ran is `completed`, even
  when every search found nothing. It is never `skipped`: `research_append` refuses that
  (`docs/plan/attached-records-baseline.md`, decision 9).
  - FamilySearch items with an extracted record complete in code (that plan's PR B, a
    prerequisite below).
  - The rest go through Dispose. After a refused declaration, the router's dispose row names
    the `in_progress` items too, and Dispose completes each FamilySearch, full-text or image
    item whose search ran. An external-site item stays with the researcher (section I). Today
    both act on `planned` items only (`agents/research-plan.md:95-101`,
    `skills/research/SKILL.md:226`).
  - research-plan's change is in its prep PR, and the router's is in PR 2.
- **Conclude:** proof-conclusion writes at the tier reached, with `shortfall: "gap"`.
  **Search more:** research-plan's add-new mode (`agents/research-plan.md:229-233`) plans
  from the `deferred` entries.
- **No writer-tool loop rule is needed.** A new plan can only follow a researcher's reply, or
  the one extra round "Keep going" allows (section A2).
- **Also routed to the choice:** `premise_invalidated` (`agents/research-exhaustiveness.md:195-196`)
  and the tentative-value sweep's (b) path (`:127-135`). Step 0 refusals are unchanged.
- **The ladder:** `questionStatus` in `src/utils/question-state.ts` gains one arm.
  - **The choice** sits above the concluded arm (`summaries.length > 0 && !resolved`). **It fires
    only when all four hold:**
    - `stopped_because` is `resources_spent`;
    - there is no summary;
    - no plan item is open, not counting one waiting only on an upload;
    - every log entry of the question is listed in `search_stop.log_entry_ids`. Those are the
      entries on its plans' items, plus each later entry that closes one of its hand-offs. A
      closing entry carries no `plan_item_id`, so it is matched by URL with the same
      `closesHandOff` rule `awaitingUserHandOffs` uses, from the one helper section I moves
      into `src/utils`. Today `questionStatus` filters the log by `plan_item_id` alone, so an
      upload would never undo the choice.
  - **It then reports** "researcher's choice: research-plan or proof-conclusion", with the
    default read from `justification`. A `justification` with no "Overturn risk:" prefix, such
    as an older stop, defaults to research-plan.
  - **Otherwise the next step stays research-exhaustiveness.** That covers an out-of-date stop
    after "Search more", which nothing clears. A `blocked_by_conflict` stop still routes to
    conflict-resolution until E's conflict rule applies.
- **The contract wording.** The 2026-09-30 ruling keeps non-gate values `in_progress`; this plan
  keeps that, and the engine already allows `probable`, `possible` and `not_proved` without a
  gate (`research-append.ts`). What changes is only the docs' claim that
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
- **Offered at any boundary,** before any evidence exists too (decision 15).
- **In one turn** (mode `wrapup`):
  1. research-plan's dispose mode completes every open item whose search ran, and skips the
     rest with `skip_category: "user_declined"`. It leaves alone an item whose latest entry is
     an upload hand-off still waiting, whether or not a FamilySearch search also ran under it
     (section I). A searched item cannot be skipped (B, "Searched items close before a
     decline"). The tool already allows `user_declined` on an open item (`research-append.ts`,
     `CAPTURE_PENDING_SKIP_EXEMPT`).
  2. person-evidence links the question's unlinked assertions (as defined in A), when there
     are any.
     - **Why it must run:** both research-exhaustiveness (`agents/research-exhaustiveness.md:116-122`)
       and proof-conclusion (`agents/proof-conclusion.md:101-113`) refuse while a person the
       question depends on is unidentified.
     - **In a wrap-up it resolves weak matches downward.** Its pause rows resolve downward only
       in an autonomous run (`agents/person-evidence.md:547-558`), and it learns that from its
       delegation, which today carries only assertion ids.
       - **The router passes `userPresent: no`** to person-evidence in a turn whose message is
         "Keep going." or "Wrap it up.", as it already does for search-external-sites
         (`skills/research/SKILL.md:282`). e2e replies "Keep going." (section F), so it gets
         the same.
       - **`person-evidence.md:547-552` and `:483-485` are reworded** to key on that field, and
         an absent field means a researcher is present. Today they say the rule applies "only …
         where no user can ever confirm", and a wrap-up has the researcher present.
       - **Tests:** `ut_person_evidence_023` signals autonomy in prose today and gains
         `userPresent: no`; `ut_person_evidence_012`, with no field, stays a pause.
  3. conflict-resolution settles any unresolved conflict that blocks the question from the
     evidence in hand. Otherwise proof-conclusion's conflict check (`:122-150`) would stop at
     `not_proved`.
  4. research-exhaustiveness records the stop, using its existing "user wants to stop early"
     case (`:352`). The router passes it `wrapUp: yes` too. Under it, the agent skips its
     scope check (`agents/research-exhaustiveness.md:76-83`), Step 0's person_evidence and
     tentative-value blocks, and the active-plan check when there is no plan, but keeps the
     "already declared" stop (`:87`), which writes nothing. It writes `resources_spent`, the skipped items as `skipped_plan_item`, items waiting
     on an upload as `handed_to_user`, and any never-planned gaps as `deferred`. Its
     tentative-value (b) path records the alternative source as `deferred` here, never routing
     to research-plan.
  5. proof-conclusion concludes at the tier reached and resolves the question, `not_proved`
     included. The router's delegation says it is a wrap-up (`wrapUp: yes`, as it passes
     `userPresent`), and §7's "only when you concluded it" (`agents/proof-conclusion.md:317`)
     counts a wrap-up as concluding.
     - **Under `wrapUp: yes`, a relied-upon person with no linked identity assertion** (zero
       assertions included) does not stop the gate (`:139-142`). It yields `not_proved` with
       `shortfall: "gap"`, naming who is unidentified, and the question resolves. That covers
       a wrap-up before any evidence, and one where person-evidence left the subject
       unidentified.
     - **An identity conflict, or any blocking conflict, still holds the question open**
       (decision 12). It still gets its `not_proved` summary and dispose has closed its items,
       so E's rule admits a different question beside it. Only the project's completion waits
       on that conflict, as the completion gate already requires.
     - **When the router says a new question is waiting** (`newQuestion: yes`), §8 does not
       write `completed`, even if every question is now resolved.
- **Before any search has run,** the same turn runs: dispose skips the open items, person-
  evidence and conflict-resolution have nothing to do, research-exhaustiveness records the
  stop, and proof-conclusion writes `not_proved` with `shortfall: "gap"`, naming the searches
  not run. That is the way out for a researcher who wants a different question before any
  search has run. When searches ran and found nothing, dispose completes those items instead
  (step 1), and proof-conclusion's `not_proved` names them as searched with nothing found.
- **Coming back to a wrapped-up question** is a new question on the same fact. question-
  selection's step 1b (`agents/question-selection.md:103`) stops new questions once the
  objective is answered, so it gains one exception: a question the researcher asked for is
  written, including one on the same fact as a resolved `not_proved` question.
- **On a completed project,** a message carrying a new question routes to question-selection,
  not to the router's "all resolved and `completed` → Stop" row
  (`skills/research/SKILL.md:230`).

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
  assistant message, each in the foreground (decisions 26 and 27). **The spawn-width
  test belongs in #2243's PR** (or the first PR after it), because it needs search-records to
  be an agent. PR 2 (the router) ships the interim parallel tool calls below.
  - **Items with `fallback_for`** run only after their primary finds nothing; otherwise they
    are skipped as `fallback_not_triggered`.
  - **Then** one `extraction_append({ recordIds })` call covers the FamilySearch hits, and one
    record-structurer spawn covers other sources. That call completes every item whose search
    lists an extracted record, including a record two items both found
    (`docs/plan/attached-records-baseline.md`, PR B).
- **Handing each agent its state is half done.** Issue #3581 delivered the plan item (with
  its `planId`) and the subject (`subjectId`, names, birth, death) to `search-records`; the
  router's "read nothing beyond the ids you are passing" now allows exactly those two for
  search spawns, and the agent skips its `research_query` and the tree `Read` when they
  arrive. What D still owes is the person's attached records and the locality facts, as
  the 10x plan advises, and the same handing for the other agents.
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
- **External-site items join the same fan-out,** one `search-external-sites` spawn per item,
  with `userPresent: yes` (section I).
- **A hints plan item joins it too** (issue #3153), through `search-hints`. It is an errand
  like an external-site search (section I):
  - triage's recommendations go in the step report as statements;
  - the step still ends "Continue with linking the records?";
  - the researcher's verdicts come back as a later reply, which runs search-hints' record mode;
  - when hints cannot be read (every e2e run blocks `person_record_matches`), the item is
    `skipped` with `skip_category: "inaccessible"`;
  - a hints item that is `in_progress` with no log entry naming it is waiting on the
    researcher's verdicts. Section I's waiting rules apply to it: it is not open for the
    ladder, E's rule or `step_ctx` (the shared waiting helper gains this arm, keyed on issue
    #3153's marker). research-exhaustiveness lists it as `handed_to_user`, and Dispose and
    wrap-up leave it `in_progress`;
  - the router dispatches it after the step's first search-group spawn, because a turn that
    search-hints opens admits no search.

### E. One question per run
- **One writer rule replaces the existing in-flight gate.** `newQuestionWhileSearchInFlightInvariants`
  (`research-append.ts`) becomes: `research_append` refuses a `questions` append while
  another question is `open`, `in_progress` or `exhaustive_declared`, **unless that question
  has a proof summary and no `planned` or `in_progress` item on an active plan** (not counting
  an item waiting only on an upload, section I). `activePlanItems` (`research-append.ts`)
  already computes the open items.
  - **Why the exemption:** a question that proof-conclusion concluded but had to leave open (an
    identity conflict at `not_proved`, `agents/proof-conclusion.md:144-150`) must not lock the
    project against every new question.
  - **A `resources_spent` stop does not unlock the project.** The "not exhaustive" choice
    writes one, and a new question there would leave the old one unconcluded without the
    researcher being asked. The refusal sends that case through the wrap-up offer below.
  - **Why it needs both halves:** E's own route can give that concluded question new searches
    (conflict-resolution, then research-plan). While they are open, a second question waits, as
    today's gate already requires for an `in_progress` item. A wrap-up still unlocks the
    project, because dispose closes every open item.
  - **`agents/question-selection.md:80-91`** states today's gate. Rewrite it to this rule.
  - **Test blast radius:** 11 tests in `research-append.test.ts`, measured with the rule
    patched in. They are all nine in-flight tests, "(Phase 2) appends a question and stamps
    created", and "the 'questions' example validates". Rewrite them, plus the spec line and
    the `questions` worked example in `research-append-examples.ts`.
- **A follow-up on the current question is a steer,** not a new question: "did you check the
  1850 census?" becomes a plan item on the current question (research-plan's edit or add-new
  mode), at any boundary.
- **A different question mid-run,** at any boundary including the "not exhaustive" choice.
  The router remembers the new question from the conversation.
  - **When the current question has a proof summary and no open item,** E's rule already admits
    the new question, so question-selection writes it with no offer.
  - **Otherwise** the reply names the current question, says the new one can start once it is
    wrapped up, and ends "Continue with wrapping up this question?" (`STEP_LABELS` gains
    `wrap-up`). Its only button is Wrap it up (section A). Cowork's reply names the phrase "wrap
    it up", and a typed "continue" to this offer gets a one-line pointer to it.
  - **"Wrap it up."** runs B2's turn, from any state: a question one step from concluded, one in
    a conflict's evidence round, or one with no evidence yet. The router passes proof-conclusion
    `newQuestion: yes`, so the project is not marked complete. The turn ends by offering the new
    question ("Continue with choosing the next question?"), and question-selection writes it
    next turn under step 1b's exception (section B2).
  - **When a blocking conflict holds the question open** (decision 12), the new question
    still starts: the wrapped-up question has a summary and no open item.
- **Work that used to open a helper question becomes plan items on the main question:**
  - a conflict that needs new evidence;
  - a FAN pivot;
  - an objective-level sub-question.
- **research-plan writes those items** (its edit or add-new mode), from the record types
  conflict-resolution records in `resolution_rationale` (`agents/conflict-resolution.md:353-357`).
- **Five sites that route this work to question-selection now route it to research-plan:**
  - `agents/conflict-resolution.md:358-359` and `:495-497`;
  - `agents/hypothesis-tracking.md:451`;
  - `agents/timeline.md:822-823` (high-severity timeline gaps; timeline is reachable from
    `agents/conflict-resolution.md:498-500`);
  - `agents/proof-conclusion.md:343` ("tier could advance → question-selection or
    research-plan").

  The conflict step names the record that could settle it, then ends "Continue with planning
  the searches?". No unit test or validator pins the old route. The route PRs (Phases) add one
  test for the new route in each of conflict-resolution, hypothesis-tracking and timeline.
- **The ladder needs one more rule** (`question-state.ts`), or its unresolved-conflict arm
  (`:417-418`) sends every pass back to conflict-resolution before the new items can run. It
  ships in the first route PR, not PR 1, because the new route loops without it.
  - **The rule:** when every conflict in `openConflictIds` already carries
    `independence_analysis` and the question's active plan has open items, the next step is
    extraction if a record found by an item still open is not yet extracted, and otherwise
    the next item's search: search-records, or search-external-sites for an item on another
    repository. It sits above that arm. A conflict not yet analysed still goes to
    conflict-resolution first, even beside an analysed one.
  - **Why that marker:** conflict-resolution fills `independence_analysis` on every analysis,
    resolved or not (`agents/conflict-resolution.md:348-352`).
  - **Once the items close,** the arm fires again and conflict-resolution weighs the new
    evidence.
- **Ending on an unsettled conflict.** Today the conflict arm (`questionStatus`,
  `question-state.ts`) and the router's "Evidence conflicts present" row
  (`skills/research/SKILL.md:220`) send any unresolved conflict to conflict-resolution. Once a
  conflict cannot be settled and nothing is left to search, every "Continue" re-runs it on the
  same evidence. Nothing in the documents tells "new evidence to weigh" from "already weighed",
  because conflict-resolution fills both analysis fields on every pass and conflicts carry no
  timestamp. So:
  - **A new optional conflict field, `weighed_log_entry_ids`:** the question's log entries
    conflict-resolution has weighed, written on every analysis. It mirrors
    `search_stop.log_entry_ids`. "The question's log entries" is B's coverage set: entries on
    its plans' items plus closing entries matched by `closesHandOff`.
  - **The ladder gains one arm, above the conflict arm.** It applies when there is at least
    one open conflict, every open conflict carries `independence_analysis` and a
    `weighed_log_entry_ids` that covers every log entry of the question, and no plan item is
    open (an item waiting only on an upload aside). Then:
    - if the question has a `not_proved` summary with `shortfall: "conflict"`, there is no next
      step: "the research ended on an unsettled conflict";
    - otherwise the next step is proof-conclusion, which writes or refreshes that summary and
      leaves the question open (decision 12).
  - **The summary is the terminal marker, not `search_stop`.** proof-conclusion may not write
    `search_stop`: the plugin hook routes every non-null `stopped_because` to
    research-exhaustiveness (`guard_project_files.py`, `OWNED_DECLARATIONS`, pinned in
    `plugin-hooks.test.ts`), and its body says so (`agents/proof-conclusion.md:319`). A non-gate
    stop would also be refused on an `exhaustive_declared` question
    (`declarationStatusInvariants`), and would overwrite a gate stop a later `proved` needs.
    `ownership.json`'s `search_stop` note, which says non-gate values are not routed, is stale;
    PR 1 corrects it.
  - **A later upload or steer** adds a log entry the weighed list does not cover, so the
    conflict goes back to conflict-resolution. If that pass still settles nothing, the arm
    finds the old `not_proved`/`conflict` summary and stops without refreshing it; the
    conflict's own analysis records the new evidence. That is the accepted cost of using the
    summary as the marker.
  - **The router's conflict row** follows the ladder's `nextStep` for the question, not the
    bare presence of a conflict. A new row above it (`skills/research/SKILL.md:220`): when
    `project_context` reports no next step for an unresolved question, run nothing and name
    Wrap it up and a different question. Without it the "plausibly answers" and "all plan items
    completed" rows (`:223-224`) still match and run research-exhaustiveness.
  - **Step reports:** conflict-resolution's report on a pass that cannot settle anything and
    names no record left to search, and proof-conclusion's report in this state, end without
    a "Continue with …?" line. The researcher's buttons are then empty, and the reply names
    Wrap it up and a different question as the ways on.
  - **Schema sites** (a new optional field): both `research.schema.json` trees' conflict
    entry, `research-schema-spec.md`'s conflicts table, `RESEARCH_SHAPES.conflict`'s allowed
    keys and a type check in `validator.ts`'s conflicts block, and the `Conflict` interface
    in `packages/schema/src/index.ts` (optional, not nullable).
- **After the round settles the conflict,** the ladder's concluded-but-open arm routes the
  question to proof-conclusion ("concluded while blocked: re-conclude <ps_id>"), which refreshes
  the summary in place and resolves. **Done in issue #3689; nothing left here.**
- **`docs/specs/project-context-tool-spec.md`** documents the ladder's order (`:187-189`, "an
  unresolved conflict outranks…") and the concluded arm (`:252-257`). Update both for B's
  branch, E's rule and this arm.
- **Decision 12 changes the contract in three places,** which today record an unsettleable
  conflict as `resolved` with kind `tree`: the completion gate's refusal text
  (`research-append.ts`, the `project.status = "completed"` gate), `docs/specs/research-append-tool-spec.md:908` and
  `:911`, and `docs/specs/guardrail-enforcement-spec.md:1298-1310`.
- **question-selection changes** (`agents/question-selection.md`):
  - delete or rewrite priorities 1, 3, 6 and 7 (the priority table and its detail paragraphs).
    Priority 3 (`timeline_gap`) becomes plan work: a `high` gap in the current question's
    subject's timeline is a search for research-plan to add. `timeline_build` writes that
    timeline at setup (`docs/plan/attached-records-baseline.md`), and research-plan, which
    reads no timeline today, gains that read in its prep PR;
  - delete or rewrite the conflict-unblocking question (`:95-101`) and the sub-question
    paragraph (`:155-160`);
  - **given more than one fact to research,** it writes no question and asks the researcher
    to pick one;
  - **tests:** rewrite `ut_question_selection_003`, `_005`, `_006`, `_008` and `_d03`, and add
    a test with a two-fact objective (no questions → no write, and an ask). Once the
    attached-records plan's PR D has landed, keep its test passing: on a project with no
    questions and a `high` gap, the first question still restates the objective.
- **The router:** delete "New evidence may reveal new questions — return to question-selection"
  (`skills/research/SKILL.md:364-365`). The objective row (the row beginning *"All questions are `resolved` and `project.status` still `active`"*; `:263` on `main`), after the tree-encoding gate,
  names any uncovered part of the objective as a suggested next question, as a statement. The
  `compound-objective-*` router tests point at that statement.
- **research-plan's FAN-pivot hand-off** (`agents/research-plan.md:751`) becomes a plan
  item.

### F. e2e continues on its own
- **`eval/harness/e2e/orchestrator.py` keeps one `ClaudeSDKClient` session open** with streaming
  input, and replies to each turn as production's "Keep going" does, with `next_auto_reply`
  (section A2). It also answers the fixture's own question when asked for a single one.
  **Built:** a step that ends on a question for the researcher makes no offer, so the run
  would end there with the fixture's own question already on file. The host answers it once —
  a second time would be a loop, and a run that asks twice has not understood the answer,
  which is a finding rather than something to paper over.
- **The run ends** when the function stops: a turn with no "Continue with …?" line, a finished
  wrap-up turn, or the reply cap, which replaces `max_continue_nudges` (a Stop-veto counter
  today). The no-progress stop remains. Both caps are runaway guards only.
- **Production's mechanism runs unchanged** inside the harness, so e2e tests exactly what
  "Keep going" does.
- **Also:**
  - `classify_hand_back` and `nudge_report.py` learn the new line;
  - per-turn step and wall time are recorded, and `make e2e-latency` reports per-step
    p50/p90;
  - `e2e-test-spec.md` is updated;
  - two-question fixtures are re-scoped (genealogist work). maria-bracero-marriage's parents
    finding is already non-required (`docs/plan/attached-records-baseline.md`, decision 13).
- **A separate e2e arm** answers "Wrap it up." right after the search step, which exercises
  B2's link-then-conclude path. **Built** as `--wrap-up-after <step>`: an override of the
  REPLY, not a session mode, so `next_auto_reply` keeps no test-only branch. It swaps a reply
  and never invents one, and the run ends after it because the turn that reply opens reads
  `wrapup`. Refused without `--step-mode`, where no host reply is sent at all.
- **Interim, if the persistent session slips:** the harness runs each fixture as one turn in
  mode `job`, as Cowork does, a stopgap that measures the old continuous flow. It keeps
  `stop_checker.py`'s veto and `max_continue_nudges`, so a conflict that cannot be settled runs
  to that cap there.

### G. Editing the plan at the plan step
A free-text reply after the plan step is a plan edit. Today research-plan's review mode forbids
modifying items, and it defaults to review whenever an active plan has open items
(`agents/research-plan.md:219-227`, `:253-256`). So research-plan gains an **edit mode**:
- a struck item → `skipped` with `user_declined` when no search has run for it, or when its latest
  entry is an upload hand-off still waiting (the exemption to decision 9 of
  `docs/plan/attached-records-baseline.md`); otherwise, one whose search ran → `completed` (B,
  "Searched items close before a decline");
- an added item → a new plan item.

The turn then ends with "Continue with running the searches?". The edit mode and B2's dispose
wording are research-plan prose. They land in the research-plan prep PR **after** PR #3479
(which converts research-plan to an agent) merges, never inside that PR.

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

### I. External-site searches (errands)
Today `search-external-sites` builds the URL, logs it with `capture_received: false` (the row
`project_context` reports in `awaitingUser`), sets the plan item `in_progress`, hands the link
over and returns. It never waits inside a call. A capture that comes back later is triaged by a
new spawn. That already fits step mode: the wait is a step boundary.
- **In the search step,** external items run in the same fan-out as the FamilySearch ones
  (section D). The step's report gives the FamilySearch findings, then each external search:
  the link, what to look for, and "save the results page as a PDF and upload it". It still
  ends "Continue with linking the records?", so the researcher can carry on and upload
  whenever they like.
- **"Waiting only on an upload"** means an `in_progress` item with an open hand-off: an
  `external_site` entry with `outcome: "partial"` and `capture_received: false` that no later
  entry closes (`closesHandOff`). That is exactly `awaitingUserHandOffs` (`project-context.ts`), which moves into
  `src/utils` so `project_context`, `question-state.ts` and `research-append.ts` share it.
  `step_ctx` mirrors it in Python, and both suites read one shared fixture. The capture-pending
  rule (`planItemCapturePendingInvariants`) is unchanged. Such an item does not count as open
  for:
  - the ladder (B's branch, and the route to research-exhaustiveness);
  - E's writer rule;
  - `step_ctx`'s `open_items`.
- **Other `in_progress` external items stay open,** as today: a capture that arrived unusable,
  a nil the researcher reported without a capture, and an inaccessible site with no decision
  (`agents/search-external-sites.md`, step 7's table). research-exhaustiveness refuses on them,
  and the dispose row leaves them to the researcher rather than to Dispose (B).
  search-external-sites keeps them open, and a received capture cannot be skipped
  (`docs/plan/attached-records-baseline.md`, decision 9).
- **research-exhaustiveness** never declares exhaustive while an item waits. It declines, lists
  each waiting search under the existing `handed_to_user` kind with its URL, and says so: "2 searches are still waiting on
  your upload. Upload them, or conclude without them." Its refusal on `in_progress` items
  (`agents/research-exhaustiveness.md:97`, `:354-355`) leaves waiting items out.
- **An upload is its own turn.** The router matches it to the `awaitingUser` row and spawns
  `search-external-sites` to triage it (`skills/research/SKILL.md:289-291`). That is the search
  group, so record-structurer may follow. The turn ends "Continue with linking the records?".
- **An upload after a stop or a conclusion** adds a closing entry the stop does not list. B's
  coverage counts closing entries matched to the question's hand-offs (section B), so the
  branch no longer fires. The ladder routes through link and assess again, and
  proof-conclusion refreshes the summary in place.
- **Wrap it up** leaves a waiting item `in_progress`, because a capture can still come, and
  lists it as `handed_to_user`. Dispose closes only the other open items, completing those whose
  search ran (section B2).
- **Under "Keep going",** the links are handed out and the run continues. The waiting items
  end as `handed_to_user` in the stop, and a later upload reopens the question as above.
  `search-external-sites` still gets `userPresent: yes`, so it hands the link over rather than
  deferring silently. Only e2e passes `no`: an autonomous run today, and the e2e orchestrator
  once `--autonomous` is retired (decision 22).
- **Uploads on the prototype are a prerequisite.** The alpha has them (`upload_session_file`,
  into `<project>/uploads/`). The prototype returns 501 today. research-as-a-job's "let
  documents in" item (`docs/plan/research-as-a-job-later.md`) moves ahead of the rest of its
  phase, staffed separately. Until it lands, an external search on the prototype can only be
  handed out, never triaged.

### J. Questions between steps
- **A message that asks about the findings** ("why do you think that's the same John?",
  "what did the 1860 census say?") gets an answer from the project (`project_context`,
  `research_query`, `sidecar_read`), and no step runs. The step check gates only step agents,
  so nothing blocks this turn.
- **The answer ends by repeating the pending "Continue with X?" line,** the last offer made,
  so the turn's buttons come back (section A).
- **A message that carries a correction** ("that's the wrong John") is a steer, and goes to
  the step that owns it, such as person-evidence.
- **A turn that ran no step leaves `prev_step` as it was,** so a question between steps does
  not reset the planning-round count (section A2). Under "Keep going", typing a question stops
  the run, as any typing does. The researcher presses Keep going again afterwards.
- **Router prose,** and one paid test: a question after the search step answers it, spawns no
  agent, and ends with the same "Continue with linking the records?" line.

### K. Adding a top-level task
A new top-level task, such as "Where else should I search?" or "Evaluate these full-text
search results", is built the same way as `source-evaluation` and `tree-survey`:
1. **An agent,** not a skill (lead, 2026-09-22), copied from `agents/search-images.md`.
2. **A line in the router's bounded-request list,** naming the deliverable and routing to the
   agent, so `research` stays the only front door (section H).
3. **A group in `step_boundary.py`'s table,** usually its own, and a `STEP_LABELS` entry if a
   step can offer it next. The coverage test (section A) fails until it has a group.

Before building one, check whether an existing step already does it and only needs a new
phrase in the bounded list. For example, "Where else should I search?" overlaps three things
that already exist: research-plan's add-new mode, research-exhaustiveness's `deferred` list,
and the bounded item "where the records are for a place and period".

**An all-code task is a line in the bounded list naming the tool calls,** with no agent and no
step group. "Create a timeline for <PID>" (`extraction_append`, then `timeline_build`) is one.
On an existing project its turn runs no step (section J) and ends like any bounded ask. On a new
folder `init-project` runs first, which is a setup step, so until issue #3384 the timeline comes
on the next turn (section H).

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
- **Leave out of the per-step figures** wrap-up turns, which run several steps (`turns.mode`).
  A host reply under "Keep going" is a one-step turn and counts.
- **To break it down by step,** PR 1 adds nullable `turns.step` and `turns.mode` columns, and the
  "Keep going" state on `sessions`, in a new migration, `apps/server/proto/sql/015_turn_step.sql`
  (014 went to #3794 while this was in flight). The worker fills them, and they also seed a redelivered attempt (section A). "p90
  by step" becomes one `GROUP BY`.
- **Cost per step and the reply at each boundary** (decision 28), from the same columns:
  - spend per step, priced from each turn's token columns (`input_tokens`,
    `cache_creation_tokens`, `cache_read_tokens`, `output_tokens`), not `turns.cost_usd`, which
    covers only the completing attempt (`004_worker.sql`);
  - which reply each boundary got: the next turn's `turns.message` against the step its
    predecessor offered (Continue, Keep going, Wrap it up, Search more, or none). That shows
    whether researchers stop at the "not exhaustive" choice, which is the whole offset in
    Costs.
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
| Ruling: "No plan-approval gate — Stop is the control surface" (2026-09-21) | **Reversed** (lead, 2026-10-16): each step ends waiting on the researcher, or on the host's reply under "Keep going" |
| Ruling: `q_`/`ps_` allowed in user-facing text (2026-09-20) | **Unaffected** |
| Ruling: the prototype is production; the alpha is backported to and retired; Cowork may be degraded | **Unaffected.** Cowork's enforcement waits on phase 0 |
| Ruling: the spend bound continues in a new session | **Unaffected;** it matters most under "Keep going" |
| Ruling: an errand pauses the job and waits (2026-09-27) | **Kept, loosened** (decision 16): an errand is a step that ends naming what to fetch, and the researcher may carry on without waiting (section I) |
| "The Stop hook binds on every browser turn"; nudge cap 60; the alpha's `auto_continue` | **Superseded:** no turn arms the veto, and phase 2 deletes it. "Keep going" is the host's replies (section A2), which the alpha's `auto_continue` chain carries |
| `turns.outcome` values | **Mostly unchanged.** A step turn ends `ok` (no label); the worker sets `completed` at turn close when the step finished the project; `delivered` goes in phase 2 (pending the "Open, for Praise" question there) |
| "`decision` and `mcp_unavailable` cannot fire" | **Unaffected;** step mode needs no `decision` exit |
| person-evidence's weak-match pause and its autonomous-only resolve-downward rule | **The pause becomes the link step's closing question,** asked with the researcher present. Resolve-downward applies in "Keep going." and "Wrap it up." turns, from the router's `userPresent: no` (section B2) |

**"Before phase 2 — what continuous work changed"**

| Item | Under step mode |
|---|---|
| "The default web path never enters the router"; re-entry through the nudge text (PR #3262) | **Router entry comes from the front door below** on every message, the host's replies included. No nudge text remains |
| `research` as the only front door (PR #3262's frontmatter) | **Keep:** section H depends on it |
| "Not every turn is a job"; the `research_delivered` finish line (PR #3187, PR #3286, PR #3235) | **Superseded:** every turn is one step. Keep the bounded routing list and "name what was saved"; delete `research_delivered` in phase 2 (pending the "Open, for Praise" question there) |  **SUPERSEDED by decision 25**: rider 1 keeps one step per boundary, not one per turn.
| "Never ask a question you will not wait for" | **Keep, applied to every step.** Offers at the **end** of a step become its "Continue with X?". Offers **mid-step** become statements, because nothing stops mid-step: for example search-records' "Let the user confirm before extraction", now that extraction is inside the search step |
| "Give 'I need you' an exit" (`AskUserQuestion` carrier, `pending_decision`, `DecisionCard`) | **Keep** (decision 24, reversing 23). The carrier IS the boundary. The premise this row carried -- "the step boundary already ends every turn" -- was measured false in phase 0: a deny does not end a turn, and `AskUserQuestion` waits without ending one either. `DecisionCard` still becomes the home for the reply buttons |
| The fourth stop's clauses: unreachable records end `completed`; a blocking conflict "is a decision" | **Unreachable records:** unchanged (the proof at the tier reached, `completed`). **A blocking conflict:** the conflict step names the record that could settle it and offers the planning step (section E), no `decision` exit needed |
| "Capture a real feed before specifying phase 2" | **Keep:** it now shows the step reports |
| *Before phase 2*'s acceptance list | **Replaced** by this plan's acceptance items 8–9 (a fresh session ends after one step) and item 7 (one-shot and plan-only asks end after their step) |

**Phase 2 — the reading experience**

| Item | Under step mode |
|---|---|
| The step as the chat's unit; one view of job state; chips in FamilySearch's words; identifiers as links | **Keep.** The session list's "needs you" state is a step waiting on a reply |
| Three kinds of nothing (`not_searched`) | **Keep;** align its naming with the `deferred` kind |
| Show the scans, and let documents in | **Keep, and move uploads ahead of the rest of the phase:** an errand closes only when the document comes back, and the prototype cannot take one today (section I) |
| The job outlives the tab | **Changes:** a job pauses between steps; "Keep going" replies come from the server, so they outlive the tab |

**Phase 3 — the loop**

| Item | Under step mode |
|---|---|
| Decisions: one card kind | **Keep,** as the reply UI |
| Handed to you (errands; blocked on issue #1830) | **An errand is a step that ends naming what to fetch** (section I) |
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
| S1 (`init-project`) | **Unchanged in scope** |
| S5 (`record-extraction`) | **Gone:** the skill was retired; extraction runs in code through `extraction_append` and the record-structurer agent |
| The narration guidance's "do not narrate between actions" | **Becomes the step-report rule:** one paragraph per step, what was found and what comes next |
| "The literal is gone from every body"; the web Continue button removed | **A new literal and buttons return:** "Continue with …?", distinct from the retired "Next: <step>. Continue?". `hand_back.py` now matches the new line, for the alpha's "Keep going" replies (section A2) |

**"What this design does not do, at any phase"**

| Item | Under step mode |
|---|---|
| No proof export; nothing writes to the FamilySearch tree; no numeric confidence meter | **Unaffected** |
| No leaf-skill changes beyond the listed ones | **Plus** this plan's research-exhaustiveness, proof-conclusion, question-selection, research-plan, conflict-resolution, hypothesis-tracking, person-evidence and timeline changes |
| No further cost bounding | **Step mode bounds every turn to one step.** "Keep going" is bounded by its reply cap, and on the prototype by the $35 spend bound |
| Nothing Cowork-specific | **Except** Cowork's one-turn "Keep going" (section A2). The plugin hook's Cowork entry point was removed by decision 25: Cowork ships no hook |

**Suggested order:**
1. Split PR #3262. Land what survives (the front door, `rejected_links`, phase 2's reading
   experience, the cold start) apart from the continuous-job finish lines that step mode
   replaces.
2. Run phase 0.
3. Land the prep PRs (the research-plan one after PR #3479, proof-conclusion after PR #3476),
   then PR 1, then PR 2 right after it. The conflict PR follows PR 1 in parallel with PR 2.
4. Fold this file into `research-as-a-job-later.md`, or retire that file's superseded sections.

## Phases
**Phase 0 — probe, no product change. Run by Praise, on macOS.**
- **In live Cowork, check:**
  1. `PreToolUse` fires on `Agent|Task|Skill` main-thread calls;
  2. **`UserPromptSubmit` fires and carries the prompt text.** If it does, it is the clean
     turn-and-mode signal, with no transcript parsing. `SessionStart` is no help: it did not
     fire in Cowork on 2026-07-30 and did on 2026-10-19 (ADR-0005), so nothing can rely on it.
  3. `prompt_id` presence and semantics;
  4. `transcript_path` readability;
  5. denies are honoured, after which the model reports and ends;
  6. sibling calls are visible;
  7. the hook can read the project's `research.json` from its working directory (for `ctx`);
  8. a file the hook writes is readable on its next call (for the turn's steps).
- **On both hosted planes:** a host-side deny binds alongside `continue_policy.foreground_rewrite`.
- **Record the results** in ADR-0005. **Cowork half recorded 2026-10-19,** all items. Item 7
  is a NO. A plugin `PreToolUse` hook returning `"continue": false` ends a Cowork turn.
  `AskUserQuestion` waits for the researcher, but it pauses the turn rather than ending it:
  the answer resumes the same turn — which is why rider 1 makes the rule "no new step until
  the researcher has answered since the last one", not "one step per turn". `UserPromptSubmit`
  also fires for agent hand-backs, which would have made the Cowork entry point key turns on
  `prompt_id`; decision 25 removed that entry point, so the finding is recorded in ADR-0005
  rather than owed as work.

**Phase 1.** The prose ships as small PRs, so a failed eval holds up only the PR it is in. The
prep PRs work under today's behaviour, so they land first. PR 1 is code only. PR 2 switches
step mode on with the four skills that cannot land apart, and merges right after PR 1. Until it  **SUPERSEDED by decision 25**: a deny alone does not make a turn stop; `dev/probe_step_deny.py` run 2
does, PR 1's deny reason alone makes each turn report and stop. The conflict PR follows PR 1
in parallel with PR 2.

- **Prep PRs — prose that works today, one paid run each, in parallel except where an order is
  named:**
  1. **research-plan,** after PR #3479 merges: the edit mode (G), the dispose wording for
     wrap-up, and the FAN pivot and a conflict's decisive records as plan items
     (E). Dispose also completes named `in_progress` items whose search ran (B), and
     Termination completes an `in_progress` item whose search ran instead of skipping it.
     research-plan reads the subject's timeline for `high` gaps (E). Until PR 2 rewrites
     priority 3, question-selection still turns the same gap into a question, so expect
     duplicate searches in that window. Tests: `ut_research_plan_q7m`, which calls ending on an
     execution question non-compliant; a plan edit is applied; and Dispose, named one
     `in_progress` item with a nil search entry and one `planned` item never searched,
     completes the first and skips the second (B).
  2. **The route PRs,** after the research-plan PR: conflict-resolution, hypothesis-tracking
     and timeline each route a needed search to research-plan (E). One PR per agent, in any
     order, each with its route test. The first to merge carries the ladder's conflict-evidence
     rule (E), its `question-state.test.ts` cases and the `project-context-tool-spec.md` line,
     because the new route loops without it.
  3. **proof-conclusion,** after PR #3476 merges, independent of the others: C, E's route line
     (`:343`) with its route test, and B2's wrap-up rules: under `wrapUp: yes` an unidentified
     person yields `not_proved` and the conclusion resolves the question at any tier; under
     `newQuestion: yes` §8 does not complete the project. Both are no-ops until PR 2's router
     passes the fields. A zero-assertion wrap-up test.
- **PR 1 — code and CI tests:**
  - `step_boundary.py` (the predicate with mode `wrapup`, `step_ctx`, `current_question`,
    `next_auto_reply`, `reply_options`, and `STEP_LABELS` with `wrap-up`), the step-table
    coverage test, and the guardrail-spec row saying it binds in the prototype worker and
    both harnesses, not Cowork.
    **It ships as a LIBRARY, not a plugin hook** (lead, 2026-10-21). The worker and both
    harnesses load it with `importlib`, the way `context_policy.py` loads
    `guard_project_files.py`. So: no `hooks.json` entry, no `plugin-hooks.test.ts` case, no
    matcher-coverage test, no `make hook-smoke` step arm, and no `GENEALOGY_STEP_HOST`
    anywhere — the only plane a plugin step hook could run on is Cowork, which gets none.
    Phase 0's `prompt_id`, `Agent`-vs-`Task` and prefixed-name findings were for the Cowork
    entry point decision 25 removed; they stay recorded in ADR-0005 and are not work this PR
    owes.
  - **"waiting only on an upload"** (section I): `awaitingUserHandOffs` and its closing-entry
    match moved into `src/utils`, used by `project-context.ts`, `question-state.ts` and
    `research-append.ts`; its `step_ctx` mirror; and the shared fixture;
  - **the host integrations** (decision 25: the FS prototype is the only plane that
    enforces the boundary, so this list is the prototype plus the harnesses):
    - the worker's `PreToolUse`, with `turns.step`, `turns.mode` and the redelivery seed.
      **Deny first, halt only on a second attempt** — the halt is the BACKSTOP, not the first
      move, and it denies the call it stops (decision 25). Rider 2: log every halt, because
      the router prose is identical on both planes, so the rate measures how often Cowork
      runs past a boundary;
    - ~~the alpha's hooks, with the `Skill` coverage~~ — **removed by decision 25: the alpha
      gets nothing, it is retired within months;**
    - the unit harness, with the check before the stubs and the mode mapping set per test;
    - the e2e orchestrator, which gets the step check (rider 3). It tracks `real_agent`,
      so the harnesses enforce a boundary neither Cowork nor the alpha has, and no eval can
      catch a miss on either (`docs/architecture.md` §9.4, gap 4);
    - the `ctx` read for the prototype and both harnesses. **Not Cowork:** ADR-0005 item 7
      measured that a hook cannot read `research.json` from its working directory, and under
      decision 25 Cowork has no hook to read it from;
  - **no Stop veto:** `turn_max_nudges` returning 0, the alpha's `autonomous_max_nudges` and
    `_DEFAULT_MAX_NUDGES` at cap 0 with the tests that pin them, the alpha arming no turn, and
    the recipe, docstring and test sites (A). The cap-0 change stays here deliberately: the
    lead accepts a few days of uneven stopping on the alpha between the PR 1 and PR 2 deploys
    (2026-10-21);
  - **"Keep going":** `next_auto_reply` and its unit tests; the worker's held-row reply inside
    `complete()` with its lock order and race test, the lifted queue-body module, the state on
    `sessions`, the `auto_continue` event and the resume prompt; the web tier's held-`auto`
    handling and `has_queued`; ChatPane's busy state (A2); a turn that ran no step leaving
    `prev_step` as it was (J).
    **Not on the alpha** (lead, 2026-10-21): it runs the way Cowork does — router prose plus
    `AskUserQuestion`, no hook, "keep going" as Cowork's single bounded turn, no reply
    buttons. So its runner chain and `turn_step`, `reply_follows` and `options`, its loading
    of `next_auto_reply`, its `ctx` read, and its host-hook and chain tests are all out of
    this PR. Only the cap-0 Stop-veto change above touches it;
  - decision 12's three contract sites (E);
  - the worker's turn-close `completed`, set on the first `ok` turn that SEES a completed
    project when no other turn of the project carries the label (amended from "became
    completed during the turn" -- see Outcomes above for why, and for the one gap it
    leaves);
  - `ownership.json`'s stale `search_stop` note (E);
  - **writer and ladder rules:** E's rule replacing `newQuestionWhileSearchInFlightInvariants`,
    with its exemption (a proof summary and no open item) and the 11 rewritten tests; two
    `question-state.ts` changes (B's choice with its closing-entry coverage, the concluded
    arm routing to proof-conclusion, and the unsettled-conflict arm), with
    `question-state.test.ts`. E's conflict-evidence rule ships in the first route PR;
  - **`weighed_log_entry_ids`** on conflicts: the schema sites in section E;
  - **web:** the buttons from `turn_done.options`, `options` on both hosted planes (with the
    prototype's new `research.json` read in `complete()`), host replies shown as automatic, and
    the `completed` string;
  - **viewer:** the `resources_spent` label;
  - **schema and docs:** the `deferred` enum value and the contract docs; `docs/architecture.md:859-860`; `docs/specs/project-context-tool-spec.md`;
  - **the e2e harness** per F.
- **The conflict PR — paid `conflict-resolution` and `proof-conclusion` runs, any time after
  PR 1, independent of PR 2.** It needs PR 1's `weighed_log_entry_ids` field; until it lands no
  conflict carries the field, so PR 1's unsettled-conflict arm never fires and routing is
  today's.
  - **conflict-resolution:** writes `weighed_log_entry_ids` on every analysis, and ends a pass
    that settles nothing and names nothing to search without a Continue line (E);
  - **proof-conclusion:** in that state, writes or refreshes `not_proved` with
    `shortfall: "conflict"`, leaves the question open, and its report ends without a Continue
    line (E);
  - **tests:** the conflict-resolution and proof-conclusion cases for the unsettled conflict in
    acceptance item 7. The "a following continue runs no step" case needs PR 2's router rows
    and ships with PR 2's tests.
- **PR 2 — the switch-on; paid `research`, `research-exhaustiveness`, `person-evidence` and
  `question-selection` runs.** These four cannot land earlier:
  - the router's step report and the choice need PR 1's step check, ladder branch and
    `deferred` value;
  - person-evidence's rewording would turn off its downward resolution until the router passes
    `userPresent`;
  - question-selection's two-fact ask would end a hosted turn the Stop veto still re-opens, and
    e2e's two-question fixtures are re-scoped only in PR 1; its gate text states PR 1's rule.
  - **the router:** A's deletions; the step report and only the replies that apply; the search
    fan-out, external items included (D, I); the spawn rule passing `run_in_background: false`
    on every `@plugin:` spawn (decision 27); the choice replacing the loop row (the row beginning *"`research-exhaustiveness` returned \"not yet exhaustive\""*; `:258` on `main`);
    wrap-up from any state (B2), with `userPresent` for person-evidence and `wrapUp` for
    proof-conclusion; the different-question reply and its wrap-up offer, and the conflict row
    following the ladder's `nextStep` with the no-next-step row above it (E); the upload turn
    (I); questions between
    steps (J); Cowork's one-turn "Keep going" sentence (A2); the objective row (E) and the
    deleted "return to question-selection" line; the refused-declaration dispose row naming
    `in_progress` items too (B); the hints item sent to search-hints as an errand (D), when issue
    #3153 has landed (otherwise issue #3153 carries this row and its test);
  - **research-exhaustiveness:** B, B2 and its `wrapUp` exemptions (with a zero-assertion,
    no-plan test), and waiting items (I);
  - **person-evidence:** B2's reworded autonomy rule;
  - **question-selection:** E's changes, including its gate text, and step 1b's exception for
    a question the researcher asked for (B2);
  - **tests:**
    - the five research-exhaustiveness tests (`ut_research_exhaustiveness_001`, `_014`, `_015`,
      `_016`, `_d9i`);
    - three `research` tests (`autonomous-handoff`, `autonomous-is-always-a-job`,
      `open-ask-still-a-job`);
    - `ut_research_c1k` and its validator;
    - the `ut_research_004` and `ut_research_001` judge contexts (they expect several steps);
    - the `compound-objective-*` tests;
    - `ut_person_evidence_023` gains `userPresent: no` (B2), and a new test of person-evidence
      resolving downward under `userPresent: no`;
    - a turn whose message is "Keep going." runs one step and passes person-evidence
      `userPresent: no`;
    - the five question-selection tests and the two-fact test (E);
    - the new tests for B2's wrap-up before evidence, E's different-question reply, I and J in
      acceptance item 7, and the unsettled-conflict "continue runs no step" case;
    - a search step with a hints item reports triage's recommendations as statements and still
      ends "Continue with linking the records?" (D), when issue #3153 has landed;
    - a `test_research.py` validator: every main-thread `Agent` spawn in `builtin_tool_calls`
      carries `run_in_background` `"False"` (the unit harness records the model's own input
      before its rewrite), shown failing on today's router (decision 27).
  - **Before PR 2's paid router run, one Cowork session** (Praise; decision 27's four checks).
  - **After deploy, one manual check on the alpha** (lead, 2026-10-21): open a session and
    confirm a step ends at its question and WAITS for the researcher. Nobody has measured
    `AskUserQuestion` on the alpha — ADR-0005 item 10 measured it in Cowork, where it waits
    but resumes the same turn. The alpha has no hook and no Stop veto after PR 1, so if its
    `AskUserQuestion` does not wait, nothing stops a step there and the fix is a follow-on.
- **Prerequisites, staffed separately:**
  - issue #2243 for the fan-out, and its handed-state follow-up for D's handed state;
  - prototype uploads (research-as-a-job's "let documents in") for external-site searches on
    the prototype (section I);
  - **issue #3516's PR B** (`docs/plan/attached-records-baseline.md`): FamilySearch plan items
    close in code, and a searched item cannot be skipped. B's choice, B2's dispose, E's rule
    and `step_ctx`'s `open_items` all count those items as open until they do. It lands before
    PR 2's paid research run.

**Phase 2 — cleanup, once step mode is live.**
- **Delete `research_delivered` everywhere.** About 24 files, including:
  - `manifest.json`, `tool-schemas.ts`, `server.ts` and `dev/smoke-calls.ts`;
  - the delivered arms in `options.py`, `worker.py` and `real_agent.py`;
  - the web `delivered` label;
  - `mock_mcp.py`, `instrument.py` and the tests;
  - `DELIVERY_GUIDANCE`;
  - the bounded-ask section's `research_delivered` close. Keep its routing list.
  - **Open, for Praise:** decision 25's prototype halt reuses `_halt`, which a main-thread
    `research_delivered` triggers today (`apps/server/proto/worker/options.py`). Say whether
    this bullet still stands under decision 25, and if it does, what ends a bounded ask.
- **Delete the Stop veto:** `should_continue_run`'s nudge path, `CONTINUE_REASON`, the nudge
  counters, `stop_checker.py`'s veto, and `AUTONOMOUS_MAX_NUDGES` with its compose, Beanstalk
  and bundle settings, and the alpha's `autonomous_max_nudges` and `auto_continue_max_steps`.
  `hand_back.py` and the runner's chain stay; they carry "Keep going". `foreground_rewrite` and
  `DELEGATION_TOOLS` stay too (decision 26), with every hook that applies them (`real_agent.py`,
  `proto/worker/options.py`, and the harness copy `eval/harness/harness/delegation.py` with its
  calls in `skill_runner.py` and `e2e/orchestrator.py`) and every test that pins them
  (`test_step_boundary_premises.py`, `test_effort_settings.py`, `test_proto_worker.py`,
  `test_write_lockdown.py`, and the harness's `test_foreground_rewrite_parity.py`,
  `test_skill_runner.py` and `test_e2e_context_block.py`). Re-point the comments that give the
  veto as their reason: `delegation.py`'s docstring, `real_agent.py`'s comment above the
  rewrite, and `test_write_lockdown.py`'s section on it.
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
   - job mode, used by Cowork and e2e's interim, allows everything;
   - wrap-up allows only dispose → person-evidence → conflict-resolution → exhaustiveness →
     conclusion, and denies research-plan when `ctx` shows no open item;
   - `step_mode` maps "Keep going!", "keep going" and "KEEP GOING." to `job`, and "keep going
     but skip the census" to `step`;
   - `current_question` returns the last unresolved entry in `questions[]`;
   - a resume prompt does not open a turn;
   - a corrupt input is allowed;
   - the step-table coverage test fails on an agent file in no group, and passes once it is
     listed;
   - `step_ctx` and the engine agree, on the shared fixture, which items are waiting only on an
     upload.
2. **Host tests** on the worker (including the redelivery seed from `turns.step`), the unit
   harness and the e2e paths. Not the alpha and not Cowork: neither enforces the boundary, so
   neither has a hook to test. There is no plugin hook entry point and no
   `GENEALOGY_STEP_HOST`, so nothing steps aside for anything. On the worker and both harness
   hooks, with a turn's first step recorded, an allowed same-group `Agent` call still comes
   back with `run_in_background: false`, and an out-of-group one gets the deny, not the
   rewrite (decision 26).
3. **No Stop veto, and "Keep going":**
   - no hosted turn binds a Stop hook: `turn_max_nudges` returns 0, and the alpha's
     `_build_hooks` binds no `Stop`;
   - `next_auto_reply`: "Keep going." for an ordinary offer; "Wrap it up." for a research-plan
     offer after one planning round, including B's high-risk line and E's conflict line; nothing
     for a paraphrased label, a turn closed `stopped`, `budget` or `queued`, a proof-conclusion
     turn, a `wrap-up` offer, a repeated (`turn_step`, `offered_step`) pair, a second planning
     round, and the cap;
   - a run's first turn counts as a planning round when it is research-plan after
     research-exhaustiveness or conflict-resolution, and not after setup; a "Continue." or
     "Wrap it up." turn gets no reply;
   - the worker never queues a reply beside an open or held turn, or after Stop; a close
     followed by a crash still delivers the reply; the run's state survives a redelivery,
     including one of the run's closed first turn; a typed message clears it and drops a held
     reply, and no held reply is released while Stop is set;
   - the alpha's chain replies to "Continue with …?" only while "Keep going" is on;
   - `turn_done` carries `reply_follows` on both hosted planes when a reply will follow;
   - the worker sets `completed` at turn close on the first `ok` turn that sees a completed
     project, and not again on any later turn of that project;
   - a turn that ran no step leaves `prev_step` unchanged, on the prototype by reading the last
     closed turn with a non-null `turns.step`;
   - `reply_options`: nothing for no offer; Continue, Keep going and Wrap it up for an ordinary
     offer, with or without evidence; no Wrap it up when there is no unresolved question (such
     as init-project's offer) or beside a proof-conclusion or question-selection offer; buttons
     on a wrap-up turn that
     ends offering the next question; Search more only at a low-risk choice; only Wrap it up
     for a `wrap-up` offer. `turn_done.options` carries the list on both hosted planes, and is
     absent when empty.
4. **`research_append`:**
   - it refuses a second open question, and refuses it while a concluded question still has a
     `planned` item;
   - it accepts one while a concluded question's only open item waits on an upload;
   - it refuses one while the other has a `resources_spent` stop (the "not exhaustive" choice)
     and no open item;
   - the 11 old-gate tests are rewritten;
   - **regression guards, which pass today:** it accepts one while the other has a proof
     summary and no open item, and refuses it while that question has an `in_progress` item.
5. **The `question-state` changes:**
   - B's branch fires with `resources_spent`, no summary, no open item and full log coverage;
   - a `justification` with no "Overturn risk:" prefix defaults to research-plan;
   - E's rule: when every open conflict carries `independence_analysis` and a plan item is
     open, the next step is extraction for a record found by an open item and not yet
     extracted, otherwise the next item's search (search-records for FamilySearch);
   - a concluded, unresolved question with no open conflict routes to proof-conclusion;
   - an analysed, unresolved conflict that has weighed every log entry, with no open item,
     routes to proof-conclusion; once the question has a `not_proved` summary with
     `shortfall: "conflict"`, there is no next step; one more log entry sends it back to
     conflict-resolution; the same holds for a question already `exhaustive_declared`;
   - the arm does not fire with no open conflict, or for a conflict-blocked question with no log
     entries whose conflict carries no `weighed_log_entry_ids`; that question goes to
     conflict-resolution;
   - `weighed_log_entry_ids` validates on a conflict, and an unknown sibling key is still
     refused;
   - B's branch fires beside an item waiting only on an upload, and stops firing once the
     capture's closing entry is logged with no `plan_item_id`;
   - **regression guards, which pass today:** B's branch does not fire when the stop lists only
     the first plan's log entries; an out-of-date stop after "Search more" routes to
     research-exhaustiveness; a conflict without `independence_analysis`, alone or beside an
     analysed one, routes to conflict-resolution; a `blocked_by_conflict` stop with no open item
     routes to conflict-resolution.
6. **Web:** a turn shows exactly the buttons in its `turn_done.options`, none when the field is
   absent, and each sends its phrase; the prototype's `auto_continue` event renders as
   automatic; `completed` renders the new string.
7. **Unit (paid):**
   - one step, then "Continue with";
   - a turn whose message is "Keep going." runs one step and passes person-evidence
     `userPresent: no`;
   - with Cowork's mapping, "keep going." plans at most one extra round, then wraps up and
     concludes;
   - regression guard, which passes today: a step that ends on a question for the researcher
     writes no "Continue with …?" line;
   - "Wrap it up." from a post-search, pre-link scenario links, records `resources_spent` and
     concludes;
   - a decline writes the overturn-risk verdict and offers its default;
   - a plan of five or more items runs its independent searches as parallel tool calls. The
     4-spawn width test moves to issue #2243's PR (section D);
   - every main-thread `Agent` spawn in a research test passes `run_in_background: false`
     (decision 27);
   - an unresolved conflict that needs new evidence ends offering a research-plan step, not a
     new question, and hypothesis-tracking, timeline and proof-conclusion route
     a needed search the same way;
   - in a wrap-up, research-exhaustiveness records the (b) path's alternative as `deferred`, and
     person-evidence resolves a weak match downward;
   - the router declines "Search more" away from the choice;
   - a two-question message gets the ask;
   - a plan edit is applied;
   - a different question mid-run ends "Continue with wrapping up this question?", at the "not
     exhaustive" choice too; while the current question has a summary and no open item,
     question-selection writes the new question with no offer;
   - "Wrap it up." right after the plan step, before any search, writes a `not_proved` summary
     with `shortfall: "gap"` naming the unrun searches, resolves the question, and then a new
     question is accepted;
   - "Wrap it up." on an `exhaustive_declared` question with no summary, and on a concluded
     question in a conflict's evidence round, each end with a refreshed summary and the new
     question offered;
   - a conflict-resolution pass that cannot settle the conflict and names nothing to search
     writes `weighed_log_entry_ids` and ends without a "Continue with …?" line; proof-conclusion
     then writes `not_proved` with `shortfall: "conflict"` and no `search_stop`, and a following
     "continue" runs no step (with PR 2's router rows);
   - with one wrapped-up `not_proved` question with no open conflict, and one proved question,
     the project completes;
   - a one-question project, a different question mid-run, then "Wrap it up.": the question
     resolves, `project.status` stays `active`, and the new question is written next turn, also
     when it is on the same fact;
   - a wrap-up with zero assertions and no plan resolves the question at `not_proved`; a
     wrap-up on a question with an identity conflict leaves it open, and a new question is
     still accepted beside it;
   - a question after the search step is answered, spawns no agent, and ends with the same
     "Continue with linking the records?" line;
   - a search step with an external item hands out the link and still offers linking; an
     upload turn triages it and offers linking;
   - after a refused declaration, an `in_progress` item whose search found nothing ends
     `completed`, never `skipped`, and the choice then fires (B, with the router's dispose row);
   - research-exhaustiveness beside an item waiting on an upload declines, lists it as
     `handed_to_user` with its URL, and offers upload or conclude.
8. **Phase 0's hosted arm on the phase 1 build:** the second step is denied on both planes.  **SUPERSEDED by decision 25**: the boundary is a halt, on the FS prototype only
9. **A fresh hosted session** on the Benz and Haist feedback openers
   (`feedback-2026-10-08T12-32-23-007161Z.zip`, `feedback-2026-10-05T17-53-26-347549Z.zip`)
   ends after one step with "Continue with …?".
10. **One e2e panel fixture runs to a proof on the host's replies.** Its runlog carries per-turn
    steps, times and the reply count, and `make e2e-latency` reports per-step p50/p90. On a
    fixture with a conflict that cannot be settled, the run ends after one evidence round with a
    `not_proved` summary, well under the reply cap.
11. **The prototype's `turns.step` and `turns.mode`** are filled for every turn and survive
    redelivery, and per-step p50/p90, per-step spend and reply-per-boundary queries over
    `turns` return figures.

## Coordinates with
- **PR #3262 and `research-as-a-job-later.md` (Praise):** see "Integrating with
  research-as-a-job".
- **Issue #2813 (Praise):** phase 2 replaces its `research_delivered` exit (pending the "Open, for
  Praise" question in phase 2); H keeps its routing.
- **PR #3479 (clack391):** it rewrites the router rows this plan edits. research-plan's prose
  changes land in this plan's research-plan prep PR after it merges.
- **PR #3494** (`question-state.ts`, the router) and **PR #3476** (`proof-conclusion.md`).
- **Issue #2539:** the same enum and agent slot. It does not stop the loop.
- **Issue #1830:** plan-time breadth for completeness questions.
- **Issue #2243 and its handed-state follow-up:** the parallel prerequisites.
- **Issue #3384:** fast project creation, so a PID one-shot needs no extra prompt.
- **Issue #3516 (`docs/plan/attached-records-baseline.md`):** its PR B is a prerequisite
  (Phases). Its setup baseline is tool calls, so it adds no step boundary. It writes the
  subject's timeline that E's priority-3 rewrite and research-plan read.
  - Its PR D edits `agents/timeline.md`, `person-evidence.md`, `question-selection.md` and
    `research/SKILL.md`, bodies the prep PRs and PR 2 also edit, so whichever lands second
    re-runs those four suites.
  - Its PR D and PR 2 land in either order. If PR D is first, E's rewrite, which moves
    Priority 3 to research-plan, also deletes PR D's Priority 3 gate and the timeline
    sentence PR D adds to the "Fresh project" edge case, and keeps PR D's first-question
    test passing. If PR 2 is first, PR D drops its question-selection.md edit, keeps the
    test, and adds the setup report's attached-records line.
- **PR #3583** (merged): added a "none linked → person-evidence" rung to the ladder. B's choice
  arm sits below it, so a declined question with unlinked evidence is linked first.
- **Issue #3153:** the hints plan item, an errand in the search step (D). It creates the hints
  item, its marker and its router row. Whichever of issue #3153 and PR 2 lands second adds the
  errand form: the router row dispatching the hints item after the step's first search-group
  spawn, and the waiting arm for the hints marker in the shared helper and its `step_ctx`
  mirror.
- **Issue #3568 (option D, adopted 2026-10-20):** once built, a callee no research test runs
  live stops staling the research suite, which removes most of the extra research runs in
  Costs.

## Costs
- **About +20–30% model calls** per run, roughly two per step boundary. "Keep going" runs pay
  it too, since each step is its own turn.
- **A reply after more than 5 minutes rewrites the main-thread cache:** about $0.11 per 30k
  tokens. At the first boundary that is more than $0.18, since the main thread's first call
  alone holds about 48k tokens on current builds. Late in a run the alpha's main thread holds
  100–160k (it compacts near 164k; the Oct 5 sessions averaged about 118k a call), so a slow
  reply there costs $0.40–0.60. The prototype's model runs a 1M window (`GATEWAY_MODEL`), so
  a late slow reply there can cost more.
- **Offset:** a researcher who concludes at the "not exhaustive" choice skips passes like the
  two automatic extra ones in issue #3475, $26 of its $50. Under "Keep going" one extra round
  still runs, so the saving there is the third pass, about $20.
- **Paid eval runs, one per skill:** `research-plan`, `conflict-resolution`,
  `hypothesis-tracking`, `timeline` and `proof-conclusion` in the prep PRs; `research`,
  `research-exhaustiveness`, `person-evidence` and `question-selection` in PR 2; second runs of
  `conflict-resolution` and `proof-conclusion` in the conflict PR; `search-records` in phase 2.
    **Not `make hook-smoke`:** there is no plugin step hook for it to bind (lead, 2026-10-21).
- **Plus the suites a callee edit stales, until issue #3568's option D is built:**
  - each of the research-plan, conflict-resolution, hypothesis-tracking and proof-conclusion
    prep PRs also stales `research`: four more runs, and a fifth if the conflict PR lands
    after PR 2's research run;
  - the research-plan prep PR and PR 2's research-exhaustiveness edit each stale
    `search-records` until PR #3567 makes it an agent: two more runs;
  - at the last runs' prices that is about $23–29 for research and $25 for search-records,
    before annotation.
- **The biggest single build** is the e2e persistent session.
