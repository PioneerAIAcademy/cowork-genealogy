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

**A third carrier, and it settles the delivery half.** The worker composes every prompt
it sends: `attempt_prompts(text, resume)` (`worker.py:776-789`) already appends
`RESUME_CONTINUE_TEXT` on a resumed session, and the web tier already prefixes the first
message. **A routing instruction placed in the turn's own prompt is delivered on 100% of
turns**, never-yield runs included, with no deny-argument dynamics. This is strictly
better than both candidates the first draft weighed, and it was in the file that draft
already cited. (`SessionStart` was mis-aimed twice: it is per-*session* where this needs
per-*turn*, and it is unneeded on the hosted plane, the only one this carrier runs on.)

**So the open question is enforcement, not delivery — and they need different carriers.**

| | Delivery | Enforcement |
|---|---|---|
| Prompt injection (`attempt_prompts`) | 100% of turns | none — prose the model may ignore |
| `_deny` with a reason | only when the tool fires | the call does not happen, but the model reads the reason and may pick another tool (`options.py:344-346`) |
| `_halt` | — | absolute, but ends the turn (what the decision exit uses, `options.py:494`) |

#2927 measured prose triggering flipping about half the time, and that applies to a
turn-start instruction as much as to a nudge. **Build the prompt-injection half first**
— it is decidable now, cheap, and strictly dominates on delivery — then measure
compliance before deciding whether an enforcement arm is needed at all. Do not build the
enforcement arm on an assumption about compliance the corpus can answer.

**Acceptance, made falsifiable.** "Assert the router entered" is not checkable today:
the ledger row the hook writes carries `tool_name`, `input_path`, `decision`,
`tool_use_id` (`options.py:511-520`), and `input_path()` extracts only
`file_path`/`path`/`notebook_path` (`options.py:320-331`) — so every skill invocation is
an indistinguishable `tool_name = "Skill"` row and the discriminating datum is never
recorded. Two edit sites follow, and they are part of this work, not prerequisites
someone else owns:

1. **Record which skill/agent was invoked** for `Skill`/`Task`/`Agent` calls — one more
   key in `input_path()` or a dedicated column.
2. **The runnable check**: a scripted hook sequence in
   `apps/server/tests/test_proto_worker.py` (which already fakes call sequences), plus a
   corpus predicate — `turns.nudges == 0` AND a `Skill` row naming `research`. "A run
   whose Stop hook never fires" is a population condition, not a test input, so the
   scripted test is what makes this falsifiable; the predicate is the corpus evidence.

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
