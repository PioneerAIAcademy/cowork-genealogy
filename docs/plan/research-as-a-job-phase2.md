# Research as a job — phase 2 (router re-entry and the turn's finish line)

**Status:** NOT BUILT. Written 2026-09-29 against the code as it stands on
`research-as-a-job-phase2`, after the *Before phase 2* sweep. Supersedes nothing;
the parent is `research-as-a-job-later-REVISED.md`, whose R1 and R4 this executes.

## What the sweep established, and what it cost

Three findings bind this plan, each measured rather than assumed:

1. **An offer at the end of a body can be a load-bearing STOP.** Removing the
   question in `search-full-text` and `conflict-resolution` let each skill run on into
   the next skill's work — an ownership-validator failure writing `assertions`,
   `sources` and tree `persons`/`sources` (record-extraction's), a negative test
   performing question-selection's task, and a fabricated-and-resolved conflict on a
   fixture that has none. Two wordings were tried; the second failed the same way.
   **Removing an offer requires a replacement stop, and is a design change, not a
   wording change.**
2. **`sdk_stream_silence` tracks test duration.** It is 100% `research-plan`
   corpus-wide, and every test that has hit it is in that suite's top five by median
   duration (`wzk` 424s rank 1, `005` rank 2, `014` rank 3, `002` rank 5). It is
   exposure, not a body defect and not CPU starvation.
3. **A negative test's routing verdict missed agent spawns.** Fixed
   (`agents_spawned_all`), but it says something about where this is going: four
   callees ship as both a skill and an agent, and conversion deletes the skill.

## R1 — re-enter the router from `PreToolUse`

**The problem, restated against the code.** `CONTINUE_REASON`
(`app/agent/continue_policy.py:170`) says *"invoke the next GPS sub-skill now"*. It
never names the router, so the router's contracts — the second question, completion
routing — hold only when the model happens to pick it. And it rides `make_stop_hook`,
which fires only at a voluntary yield.

**[Derived 2026-09-29, `make e2e-narration-figures`.]** The never-yield figure was a bare
code comment (`worker.py:184`) — the exact class R7 rules unusable, and R7's own pass
killed two of three such figures. Derived, this one **holds**: **31.6% of runs never
yield** (61 of 193), and the median is **1.0** nudge per run. 193 of 194 committed e2e
runs carry `usage.continue_nudges`, so "no counter" and "zero nudges" do not blur —
they are counted separately and both denominators are printed. A contract on the Stop
hook is therefore undelivered in **a derived** third of runs, not a remembered one.

**The carrier that exists.** `make_pretool_hook` already has four exits, and they are
not interchangeable:

| Exit | Shape | Effect |
|---|---|---|
| `_halt(reason)` | `{"continue_": False, "stopReason": …}` | ends the turn |
| `_deny(reason)` | deny one call, reason shown to the model | the model reads it and may argue |
| `_foregrounded(...)` | rewrites a backgrounded delegation | — |
| `{}` | allow | — |

**The carrier is a per-turn SYSTEM-PROMPT append, not the turn's user text.**
Round 2 found the better seam: `build_worker_options` already appends a standing
platform instruction to the system prompt (`project_note`, `options.py:722-731`, bound
at `:750`), and `run_turn` rebuilds options on **every attempt**
(`worker.py:1000-1015`). So it is delivered on the same 100% of turns — never-yield
runs included — and beats the user-text seam (`attempt_prompts`, `worker.py:776-789`)
on four axes:

| | user text | system-prompt append |
|---|---|---|
| Collides with the web tier's `OPENING_TURN` prefix | yes | no |
| Existing tests broken | **7** (named below) | **0** (one substring assert, `test_proto_worker.py:792`) |
| Accumulates in the transcript | **one copy per turn, forever** — it is persisted in `session_entries` and re-fed on every resume | exactly one |
| Covers the D17 re-query attempt | no (`RESUME_CONTINUE_TEXT` uninstructed) | yes |

The accumulation row is the decisive one: a 53-minute continuous job would carry one
copy of the instruction per turn in its own context for the rest of its life.

**The instruction is the artifact — so it is specified here, not left to the build.**

- **Text** (verbatim): *"If this message asks for research work, enter it through the
  `research` skill so the run's routing contracts hold. A status question, or a request
  bounded to one deliverable, is answered directly and is not re-routed."*
- **Position**: appended to `project_note`'s existing standing text, after it.
- **Condition**: **not** on a session's first turn. The web tier prepends `OPENING_TURN`
  so `init-project` runs and consumes the objective
  (`apps/web/src/components/chatEvents.ts:108-112`, `ChatPane.tsx:296-299`;
  `proto/drive.py:68`). On that turn there is no project to route, and an unconditional
  instruction is a second competing "what to do first" on turn 1 of every web session.
  `resume is None` (`worker.py:878`) is the fresh-session discriminator already in hand.
- **Why a scope clause and not a bare "enter the router"**: the parent plan pins it —
  *"'Where are we?' is a bounded request whose deliverable is the answer. Whatever
  re-enters the router must respect this, or every question becomes a job"*
  (`later-REVISED.md:153-155`). Deferring the *enforcement* arm does not defer the
  wording, because the wording ships to 100% of turns now.

**Acceptance, made falsifiable.** "Assert the router entered" is not checkable today:
the ledger row carries `tool_name`, `input_path`, `decision`, `tool_use_id`
(`options.py:511-520`), and `input_path()` extracts only
`file_path`/`path`/`notebook_path` (`options.py:320-331`), so every skill invocation is
an indistinguishable `tool_name = "Skill"` row.

1. **Record the callee.** Extend `input_path()` — **not** a new column: no SQL
   migration, and every consumer is path-safe (`proto/audit.py:25-26,62` filters to
   `READ_TOOLS` first; `demo.py`, `turn.py`, `compare.py`, `web/app.py` do not select
   the column). Keys: `skill` then `name` for `Skill`, `subagent_type` for
   `Task`/`Agent` — the fallback shape `eval/harness/harness/skill_runner.py:201-220`
   already codifies. Update the docstring in the same edit, and have the test pin the
   key: a moved SDK key silently yielding `None` is the invisible failure that file
   documents.
2. **The scripted test** in `apps/server/tests/test_proto_worker.py` (`TwoPassClient`
   already fires the pretool hook, `:1280-1306`), with **both arms**: a research
   message carries the instruction, and an **opening turn does not**.
3. **Two corpus predicates, not one.** Compliance: a `Skill` row naming `research`.
   **Over-reach**: a status-question turn shows **no** such row — the compliance
   predicate alone counts routing successes and is blind to over-routing, which is the
   failure this instruction's scope clause exists to prevent.
4. **Read from the worker plane, not e2e.** `eval/harness/e2e/orchestrator.py` never
   calls the worker, so no e2e run can ever receive this injection. The measurable
   population is proto-worker runs read from Postgres (`tool_calls` + `turns.nudges`,
   `004_worker.sql:23`), i.e. `make proto-demo` / `drive.py`.

## R4 — the `delivered` outcome

Pinned in the parent plan: a NEW enum value, labelled so it does not read like
`completed`, with `ok` left unlabelled. **Clause position pinned to a single slot:**
"after `stopped`, before `project_completed`" spans three clauses —
`mcp_unavailable`, `queued`, `decision` (`continue_policy.py:142-154`) — and the
lockstep truth-table and AST parity tests need a total order. It goes **immediately
before `project_completed`**, i.e. after `pending_decision`. That placement decides a
real case: a delivery signal arriving with a patron message already queued reads as
`queued`, which is right — the researcher has already moved the conversation on.

**Blast radius of the recommended second dedicated tool**, so the gating ruling is
informed rather than taken blind. As an **MCP tool** the documented new-tool site list
applies (`tool-schemas.ts`, `server.ts` dispatch, `manifest.json` `tools`,
`dev/smoke-calls.ts`, a spec) and both Cowork and the 27 unit-harness skills would see
it **un-intercepted**. As a **worker/SDK-side** signal, Cowork never gets `delivered` at
all. Either way the new flag edits `apps/server/tests/test_continue_policy_parity.py`
(`test_the_shared_copy_is_the_one_with_the_new_clauses` enumerates the flags) and the
outcome-table comment at `continue_policy.py:29-42`; the harness's `stop_checker.py`
copy is untouched only because extra flags default False — which the ruling should say
out loud rather than discover. **Its carrier is the open item** and is explicitly not `AskUserQuestion`:
an ask waits for an answer and a delivery waits for nothing, so one tool carrying both
leaves the hook with no discriminator. Recommendation is a second dedicated tool, on
the decision exit's own evidence — a tool name is an exact match a hook can read, not a
sentence a model may honour.

**The finish line this serves.** The hook vetoes every stop until `project.status` is
`completed`, so "create a plan but leave it at that" (#2932), a single christening
lookup (#2921) and "where are we?" each run to the proof, the nudge cap or $35. The
finish line belongs to the request that named it, lasts one turn, and is void on the
next message.

## Also in scope, named rather than left implicit

- **The nudge text.** Parent R1 says `CONTINUE_REASON` still changes. Three sites move
  together and a verbatim test pins them: `continue_policy.py:170`, the harness copy in
  `eval/harness/e2e/orchestrator.py`, and
  `test_the_stop_hook_blocks_a_vetoable_stop_with_the_harness_reason_verbatim`
  (`apps/server/tests/test_proto_worker.py`). **Deferred** to the enforcement decision:
  rewording the nudge changes what the Stop hook says in the 68% of runs that do yield,
  and there is no reason to spend that edit before knowing whether prompt injection
  alone carries the contract.
- **Whom the routing instruction must NOT interrupt.** The hook fires on subagent calls
  too (`record()` reads `agent_id`, `options.py:451`), so any enforcement arm must
  exempt delegated-agent calls, `Skill` itself, and `DECISION_TOOL` — or it fires
  mid-delegation. Cheap to state now, expensive to find in a run log.
- **Tests the rejected user-text seam would have broken**, kept so the choice is not
  silently re-made: `test_the_re_query_bound_is_the_length_of_the_prompt_tuple`
  (`:1342-1348`) asserts the tuple verbatim, and six more assert
  `client.queried == ["hello", …]` verbatim (`:1231`, `:1245`, `:1359`, `:1384`,
  `:1401`, `:1416`). The system-prompt seam breaks none of them.
- **`sdk_stream_silence` is a work item here, not someone else's.** The Sequencing note
  below bars validation on `research-plan` until it is addressed, so this plan owns it:
  it tracks test duration (top five by median), and the first question is whether the
  retry budget or the per-test cap should differ for a suite whose tests run 400s+.

## Sequencing

R4's carrier decision gates the finish line; R1 is independent and cheaper. Build R1's
prompt-injection half first — it is decidable from the code today. **Nothing here may
be validated by a `research-plan` eval run until the stall item above is addressed**:
five consecutive runs failed to produce a red-free log there, and that cost belongs to
the plan, not to the change under test.
