# Port the `delivered` exit to `main`, standalone

**Status:** BUILT 2026-10-05 on branch `delivered-exit-on-main`. Delete this file once the PR merges; its durable half is `docs/specs/research-delivered-tool-spec.md`.

**Throughout this plan, `main` means `origin/main`.** The local `main` ref in this
checkout is **281 commits behind** it and has 48 tools, no `008_*.sql`, and a different
README. Every claim below is true of `origin/main` and false of the local ref — verify
against `origin/main` or you will file false findings.

## Why this plan exists, separate from issue #2813

Issue #2813 ("one-shot quick tasks") asks the router to decide, on the first message,
whether a request is *bounded* (one deliverable) or a *job* (open-ended), and to end a
bounded turn at its deliverable using "the plan's `delivered` exit."

That exit already exists — built, tested, and proven live — but only on the unmerged
`research-as-a-job-phase2` branch (78 commits ahead of `main`, deliberately held without a
PR). `main` has none of it: no `TERMINAL_DELIVERED`, no `research_delivered` tool, no hook
arm. Building issue #2813's new routing logic on top of that branch would mean adding to an
already-large unreviewed pile; rebuilding the exit from scratch on `main` would create a
second, divergent implementation that has to be reconciled when the branch eventually lands.

This plan splits the difference: port **only** the already-built `delivered` exit to `main`
as its own small, independently reviewable PR. Issue #2813's actual new work (the
bounded-vs-job router decision, lightweight `init-project`, saving findings, candidates not
verdicts, the viewer) is **not** part of this plan — it is planned and built separately, on
`main`, once this lands.

**This alone ships real value**, independent of #2813: `DELIVERY_GUIDANCE` (below) already
tells the hosted agent to call `research_delivered` for a plan-only request, a single
lookup, or a status question like "where are we?" — cases named in alpha
feedback issues #2921 (a single christening lookup) and #2932 ("create a research plan...
but leave it at that"). **#2922 is deliberately NOT cited** — an earlier draft listed it;
it is a generic feedback bundle about conflicting census birthplaces and a screen-lock
session question, nothing to do with bounded requests. #2921+#2922 are cited together
elsewhere in `research-as-a-job-later.md` for a *different* feature (the job outliving the
tab), which is where that miscitation came from. Both were captured working end to end on 2026-09-29
(`docs/captures/2026-09-29-bounded-requests/`, on the branch). This plan ships that, now,
without waiting on #2813's router work to classify anything.

## What is being ported, and from where

Everything below is read from the **current tip** of `research-as-a-job-phase2`, not from
the original commits (`ed159989c`, `beeb69742`) — the branch has iterated since those
landed (e.g. the hook's `record()` call gained a `"wrote"` field in a later commit). A
literal `git cherry-pick` of either commit does **not** apply cleanly against current
`main` (verified: `continue_policy.py` applies clean; `options.py`, `worker.py`,
`test_proto_worker.py`, and `apps/web/src/components/chatEvents.ts` conflict, mostly from
unrelated drift in the surrounding code, not from this feature). Every file below is a
hand-written port against `main`'s current shape, not a mechanical merge.

### 1. `apps/server/app/agent/continue_policy.py`

- Add `TERMINAL_DELIVERED = "delivered"` beside the other seven terminal constants
  (`COMPLETED, STOPPED, QUEUED, BUDGET, NO_PROGRESS, DECISION, MCP_UNAVAILABLE`).
- Add `delivered: bool = False` to `should_continue_run(...)` and `terminal_reason(...)`.
- Clause position, pinned by test: **after** `pending_decision`, **before**
  `project_completed`. A delivery arriving under a queued message reads `queued`; one
  arriving under a pending decision reads `decision`; one arriving on an otherwise-complete
  project still reads `delivered`, because the bounded ask was met first.

This file's shape on `main` already matches the branch's for every existing clause
(verified: a dry-run cherry-pick of this file alone produced no conflict), so this is a
direct, low-risk addition.

### 2. `apps/server/proto/worker/options.py`

- Import `TERMINAL_DELIVERED` alongside the other terminal imports.
- Add three constants, verbatim from the branch tip: `DELIVERED_TOOL =
  "mcp__genealogy__research_delivered"`, `DELIVERY_GUIDANCE` (the per-turn system-prompt
  sentence), `DELIVERED_REASON` (the SDK stop reason string).
- Add `on_delivered: Callable[[], None] | None = None` to `make_pretool_hook`'s signature.
- Add a `DELIVERED_TOOL` arm inside `_pretool`, structurally parallel to nothing currently
  on `main` (see note below) — it records the tool call, invokes `on_delivered()` if given,
  logs `ev="delivered"`, and halts with `DELIVERED_REASON`.

  **DO NOT port the branch's `record({...})` dict verbatim.** The branch tip's version
  includes `"wrote": writer_record(tool_name, tool_input)`, and `writer_record` exists
  **only on the branch** (`apps/server/proto/web/writer_record.py`, with its own migration
  `008_writer_record.sql` and tests) as part of an unrelated, un-ported phase-3
  change-review feature. `main` has no such module, no such import, and no `wrote` column —
  `main`'s migrations carry a *different* `008_auth_owner.sql`, and `main`'s
  `insert_tool_call()` inserts 8 named columns with no `wrote`. Porting it verbatim raises
  `NameError: name 'writer_record' is not defined` on the first live `research_delivered`
  call. **Omit the `"wrote"` key and do not import `writer_record`**; match the shape of
  `main`'s existing `halt` arm's `record({...})` call, which has no `wrote` key.
- Wire `DELIVERY_GUIDANCE` into the per-turn `project_note` construction, next to wherever
  `main` builds that string today (read the current call site before editing; do not
  assume the branch's surrounding line numbers apply).

**Important scoping note, checked during planning:** `main` does **not** have the
`decision` exit (`AskUserQuestion`/`DECISION_TOOL`) wired into `make_pretool_hook` at all —
`on_decision`, `DECISION_TOOL`, and `DECISION_REASON` do not exist anywhere in `main`'s
`options.py` or `worker.py`, even though `TERMINAL_DECISION` and the `pending_decision`
parameter already exist as pure-function plumbing in `continue_policy.py`. **Do not port
the decision exit as a prerequisite.** The two arms are structurally independent
`if tool_name == ...` blocks in `_pretool`; `delivered` does not need `decision`'s wiring
to exist. Porting `decision` is out of scope for this plan and not this engineer's call to
make unprompted (CLAUDE.md's ladder: this is either already-known and deferred on purpose,
or worth a one-line note to the lead, not a silent scope expansion here).

### 3. `apps/server/proto/worker/worker.py`

- Add an `on_delivered()` closure next to wherever the decision closure would go — on
  `main` there is no `on_decision` to sit beside, so place it near the `on_halt`/spend-cap
  closures already in that scope, immediately before the `hook = make_pretool_hook(...)`
  call.
- Add `on_delivered=on_delivered` to that call's keyword arguments.
- Import `TERMINAL_DELIVERED`.

### 4. `apps/web/src/components/chatEvents.ts`

- Add one entry to `TURN_OUTCOME_LABELS`: `delivered: "Done — that's what you asked for.
  Send a message to carry on."` — `main` already has **nine** labels (including
  `retries_exhausted` and `transcript_lost`, added since the branch forked); this is a
  **tenth**, not a conflict. The quoted text matches the branch byte for byte, and no test
  enumerates the map's size.

### 5. MCP server: the `research_delivered` tool

- New file `packages/engine/mcp-server/src/tools/research-delivered.ts` — port verbatim
  from the branch tip (`researchDelivered()`, `ResearchDeliveredInput`,
  `ResearchDeliveredResult`, `researchDeliveredSchema`). It is a pure signal: no network,
  no project write, and the file's own docstring already explains why it must return a
  harmless, truthful acknowledgement in Cowork and the unit harness, where no hook binds
  to it.
- `src/tool-schemas.ts`: import `researchDeliveredSchema`, add to `allToolSchemas`.
- `src/server.ts`: add the dispatch arm (`if (request.params.name === "research_delivered")`).
- `manifest.json`: add one `{ "name": "research_delivered" }` entry to the `tools` array,
  **in `main`'s current single-line-per-entry style** — the branch's own diff for this file
  is almost entirely reformatting — 214 of 217 changed lines are pretty-printing noise from
  whatever formatter ran when that commit was made; verified by reading the raw diff), not
  real content. Do not port that reformatting.
- `dev/smoke-calls.ts`: add the one entry, verbatim from the branch
  (`{ tool: "research_delivered", args: () => ({ summary: "..." }), expect: noError }`).
- `docs/specs/research-delivered-tool-spec.md`: new file, ported from the branch
  essentially verbatim (it is a tool-behavior spec, not branch-specific). **But its Status
  line cites `docs/plan/research-as-a-job-phase2.md`, which does not exist on `main`** (only
  `research-as-a-job-later.md` does). `doc-links.test.ts` does not lint `docs/specs/`, so
  this will not red CI — it would just be a dead pointer for every reader on `main`. Reword
  the Status line to cite the 2026-09-29 ruling **by date, without the path**.
- `tests/packaging/prompt-sizes.json`: regenerate (`UPDATE_PROMPT_SIZES=1 npx vitest run
  tests/packaging/prompt-budget.test.ts`), do not hand-edit — it is a generated baseline.
- `README.md`: the tool-catalog table gets one new row, and the count goes from **51 to
  52** at **both** sites — the plain sentence at line 57 ("The MCP server exposes 51
  tools.") *and* the bolded "What's shipped" bullet at line ~464 ("**51 MCP tools.**").
  Not 48→49 as on the branch; `main` has grown independently since the fork — recompute,
  do not copy the branch's delta. `tests/packaging/doc-links.test.ts`'s `stated("MCP
  tools")` regex catches only the bulleted site, so the line-57 sentence can go stale
  silently if only one is updated.

### 6. Tests

**`apps/server/tests/test_proto_worker.py`** — `main`'s existing suite for this module
already walks terminal-outcome flags *generically*, which the branch (written earlier)
does not do. Prefer extending the generic coverage over copying the branch's bespoke
pure-function tests:

- `test_each_new_clause_allows_the_stop_and_names_itself`'s `@pytest.mark.parametrize`
  list gains one row: `("delivered", "delivered")`.
- `test_stopped_is_the_first_clause_ahead_of_every_other`'s `every` dict gains
  `delivered=True`, proving a researcher's own stop still outranks a delivery at the
  pure-function level.
- `test_terminal_reason_and_should_continue_run_walk_in_lockstep`'s `flags` tuple gains
  `"delivered"`.

**The generic tests do NOT substitute for the precedence test — measured, not assumed.**
An earlier draft of this plan claimed extending the lockstep test "alone proves delivered
outranks `project_completed`." **That is false.** The lockstep assertion only checks the
*boolean* (`cont`), never the specific reason string in the terminal case, so it passes
identically whether the clause order is right or wrong. Verified by reimplementing both
functions with `project_completed` deliberately checked *before* `delivered` and running
the exact 128-combination loop the extended test would run: **zero failures in both
directions.** The break-test proposed below does not rescue it either — removing the
`delivered=` parameter raises `TypeError` regardless of clause order, proving only that the
parameter is wired, not that it sits in the right place.

So **port these two pure-function tests from the branch tip verbatim** (neither needs a
fixture), in addition to the three generic edits above:

- `test_a_delivered_turn_does_not_continue` — `should_continue_run(..., delivered=True)` is
  `False`.
- `test_delivered_is_the_reason_and_sits_after_decision_before_completed` — the one test
  that actually pins the semantics this port turns on: `queued` and `decision` outrank a
  delivery, and a delivery on an already-`completed` project still reads `delivered`.

Keep the generic edits too — they are cheap and they do cover the wiring — but the
precedence guarantee rests on the bespoke test, not on them.

What the generic tests cannot reach — the **hook and worker-level** wiring — still needs
its own tests, hand-ported from the branch tip and adjusted only for whatever local
fixtures (`turn_env`, `_run`, `_init`, `ToolCall`, `_result`) look like on `main` today
(these are generic test helpers already used throughout the file, not branch-specific):

- `test_the_delivered_tool_name_is_pinned` — one-line, `options.DELIVERED_TOOL ==
  "mcp__genealogy__research_delivered"`.
- `test_a_turn_that_delivers_is_recorded_as_delivered(turn_env)` — end to end through the
  real hook: a tool sequence ending in `DELIVERED_TOOL` must produce `summary["outcome"]
  == TERMINAL_DELIVERED` and the same value written to the `turns` row.
- `test_a_turn_that_never_delivers_is_untouched_by_the_exit(turn_env)` — the arm that is
  easy to skip: an ordinary tool sequence must not be re-routed through it.
- `test_a_stop_outranks_a_delivery` — drives `make_pretool_hook` directly with `halt`
  armed, asserts the halt reason wins over `DELIVERED_REASON`.

**The `DELIVERY_GUIDANCE` wiring needs its own tests — without them the prose half ships
inert.** None of the tests listed above touches `build_worker_options`; the hook tests drive
`make_pretool_hook` directly. So step 2's last bullet (wiring the guidance into
`project_note`) could be dropped or half-applied and **every test above still passes**,
leaving `research_delivered` advertised but with nothing ever instructing the model to call
it — the exact half this plan calls "ships real value", caught only by the paid live
capture. Port these three verbatim from the branch tip; the `_options(**overrides)` helper
they need already exists on `main` (`apps/server/tests/test_proto_worker.py:788`) and calls
`options.build_worker_options`, so no adaptation is needed:

- `test_the_delivery_instruction_rides_the_same_turn_prompt` — **the load-bearing one**: the
  only check anywhere that `DELIVERY_GUIDANCE` reaches `system_prompt["append"]`.
- `test_the_instruction_names_the_tool_it_is_about` — the prose names the bare tool name and
  `DELIVERED_TOOL` ends with it, so prompt and hook cannot drift apart.
- `test_the_instruction_draws_both_boundaries` — the text itself must exclude both
  misfires (objective-complete, and asking-instead-of-delivering).

`test_an_ordinary_turn_is_untouched_by_the_new_clause` is covered by the generic
parametrized edits above and needs no separate port.

**Deliberately NOT ported, with the reason stated:**
`test_the_delivery_instruction_is_on_the_opening_turn_TOO` guards a bug that cannot
currently recur on `main` — it exists because the branch wraps `project_note` in a
`resume is not None` conditional (exempting `ROUTER_REENTRY` on turn 1) and
`DELIVERY_GUIDANCE` was initially caught by that same conditional. `main`'s `project_note`
is a single unconditional string with no `resume` branching, so there is no conditional for
the guidance to be wrongly exempted from. **If this port adds any `resume`-conditional
branching around `project_note`, port that test with it** — it is cheap insurance and the
bug it describes was found by trying to test the scenario, not by reading the code.

**Engine side:** no dedicated unit test exists for `research-delivered.ts` even on the
branch; coverage is the `smoke-calls.ts` entry plus the existing packaging/manifest drift
tests (`manifest.test.ts`), which fail automatically if the tool is advertised without a
manifest entry or vice versa.

## Verification

- `cd apps/server && uv run pytest tests/test_proto_worker.py -q` — must stay green, and
  the new/extended tests must fail on the pre-port code. **Break it TWO ways — one break
  is not a proof (CLAUDE.md):**
  1. Remove the `delivered=` parameter: everything reds, proving the parameter is wired.
     This proves *only* wiring — it raises `TypeError` under either clause order.
  2. **Move the `if delivered:` clause BELOW `if project_completed(research):`** in both
     functions. `test_delivered_is_the_reason_and_sits_after_decision_before_completed`
     must red while the parametrized and lockstep tests stay **green**. This is the only
     break that tests the semantics this port turns on, and it is simultaneously the proof
     that the bespoke test is load-bearing rather than redundant.
- `cd packages/engine/mcp-server && npm run build && npx vitest run` — full suite,
  including `tests/packaging/manifest.test.ts` and the regenerated `prompt-sizes.json`.
- `make engine-smoke-http` — the new tool must appear in `smoke-calls.ts`'s coverage or the
  smoke test's own drift check fails it.
- A fresh capture against this port, re-running the two 2026-09-29 scenarios
  (`docs/captures/2026-09-29-bounded-requests/`) against `main`-plus-this-port, to confirm
  the exit still fires end to end outside the branch's own tree. This is the one piece of
  evidence that most needs re-measuring rather than trusted from the branch, since it is
  the only live/paid check in this list.

### 7. `docs/plan/research-as-a-job-later.md` — mark the delivered exit landed

That plan exists on `main` today and its "Before phase 2" section describes this exact
exit at intent level, using the same two examples this plan uses as acceptance ("Mary
Hales... leave it at that", "where are we?"). Once this PR lands, that paragraph describes
as pending something that has shipped. CLAUDE.md's `docs/plan/` convention requires a
plan's `**Status:**` line to be updated when the work lands, so this PR marks that
paragraph landed (or trims it) rather than leaving it to read as not-yet-built.

**Two specific sentences in that file go false the moment this lands, and both need
editing — not just the one paragraph:**
- `:77-78` says the agent says it delivered "**with the same call that carries *I need
  you***". This port ships a *separate* tool. Correct it to name `research_delivered` and
  point at `docs/specs/research-delivered-tool-spec.md`.
- The *Give "I need you" an exit* paragraph (`:120`) says the carrier is either
  `AskUserQuestion` intercepted or one `hand_back`-shaped tool — "**Pick one; it also
  carries *delivered what was asked***." Amend it to record that the 2026-09-29 ruling
  split the carriers: a delivery waits for nothing, an ask waits for an answer.

## Explicitly not in this plan

- Issue #2813's bounded-vs-job router classification (`research/SKILL.md`) — separate plan,
  built on `main` once this lands.
- The `decision`/`AskUserQuestion` exit — not on `main`, not a prerequisite, not ported
  here. If it turns out to matter, that is a question for the lead, not a silent addition.
- Any change to `research-as-a-job-phase2` itself. That branch keeps its own copy of this
  code until it is rebased onto a `main` that already carries this plan's commits (ideally
  as the *same* commits, so the rebase treats them as already-applied rather than as a
  fresh conflict).

## Done when

- A fresh hosted session, given "create a research plan for Mary E. McAndrew
  (G13G-P68), wife of John Mogan of Detroit, but leave it at that," ends with
  `turns.outcome = "delivered"` and the browser shows "Done — that's what you asked for.
  Send a message to carry on." — re-measured on `main`-plus-this-port, not assumed from the
  branch's prior capture.
- A second hosted message, "where are we?", on an active project, likewise ends
  `delivered`.
- An ordinary continuous-research turn that never calls `research_delivered` is provably
  unaffected (existing + new tests green, the break-test above passes in both directions).
- Cowork and the unit harness both still see `research_delivered` as an ordinary tool that
  returns an acknowledgement and does not end the turn (no hook binds there).
