# Phase 5 — the remaining prose (detailed pass)

**Status:** BUILT, 2026-09-30 — every step below carries what landed. Written 2026-09-30 on the `research-as-a-job-phase2` branch
(unmerged), after phase 4 landed. **Revised the same day** after a plan review found
three blocking defects in the first draft — including one in its central finding — and
after the product owner answered the two questions it escalated. Parent:
`docs/plan/research-as-a-job-later-REVISED.md`, "## Phase 5 — the remaining prose".

**The name is now wrong and is kept only because the parent uses it.** After the review,
phase 5 contains **no prose change at all**. What is left is one measurement fix, one
stale figure, and three UX defects in TypeScript and Python.

## What the parent leaves for this phase

| PR | Slot | What | State after review |
|---|---|---|---|
| S1 | `init-project` | The between-actions clause; the cold start's wording; identifier clause | **No change. No paid slot.** See "The clause is coherent" |
| S5 | `record-extraction` | Probably no prose change | **No change. No paid slot.** See "S5" |

Plus **[R7]** one figure still `NOT MEASURED`, and **[R8]** three UX findings.

## Verified against the tree, 2026-09-30

Every line reference below was checked, and independently re-checked by the plan review:

| Claim | State |
|---|---|
| S2 (PR #2870), S3, S4 | done / moved — nothing here |
| R10 bounded-request subject | already applied in the parent |
| The cold start's wording | **done in phase 4**, `init-project/SKILL.md:117` |
| The identifier clause | phase 2's |
| The between-actions clause | live, `init-project/SKILL.md:46` |
| `record-extraction` "a batch is one step" | gone from the whole plugin |

## The clause is coherent — the first draft's central finding was wrong

The first draft claimed the stored `narration_guidance` string contains a prohibition and
a mandate that contradict each other, and escalated an either/or to the product owner.
**That reading was wrong.** Read whole (`SKILL.md:46`):

> Plain language for someone who has never done genealogy. No identifiers, file names,
> tool names or field names. Do not narrate between actions; **report once when the step
> is done**: what was found, in one paragraph, and what happens next in one sentence.

The semicolon carves the once-per-step report **out of** the prohibition. "Between
actions" bans *interim* paragraphs; the single sanctioned report may close with one
forward sentence. There is no contradiction, and the draft refuted itself three
paragraphs on by calling the observed behaviour "compliance, not violation" — a genuine
contradiction admits no compliant behaviour.

**Decided (owner, 2026-09-30): the researcher should see what was found AND what happens
next.** That is what the string already specifies and what the agent already does, so the
decision resolves to **keep the string unchanged**. Dropping "do not narrate between
actions" — what the draft proposed — would have *newly permitted* the interim chatter the
clause exists to ban.

**Consequences of no string change**, each of which the review priced and the draft had
missed entirely:

- `eval/harness/validators/test_init_project.py:352` pins the string **verbatim** as
  `_HOUSE_STYLE`, asserted equal at `:780`, and
  `eval/harness/tests/unit/test_init_project_provenance_validators.py:27` imports it. A
  rewrite would have redded **every** `ut_init_project_*` run — including the paid one
  the draft's own acceptance proposed spending on.
- Five further verbatim copies would have gone stale:
  `eval/harness/e2e/templates/starting-research.json:13` (seeds e2e projects, so every
  future e2e narration figure would measure the *old* string),
  `apps/server/app/agent/mock_agent.py:33`, `README.md:332`,
  `docs/specs/e2e-test-spec.md:185`, and
  `eval/fixtures/scenarios/brady-multiple-warnings/research.json:15`.
- A rewritten string reaches **new projects only**. It is persisted verbatim into each
  `research.json` at init and there is no heal path, so every existing project keeps the
  old one.

None of that has to be paid for now. It is recorded because it is the price of *any*
future change to this string, and the next person to propose one should see it first.

## The measurement defect that is worth fixing — and it is mine

The draft's headline figures were read off the **feed**, not the **screen**. The capture's
own README (`docs/captures/2026-09-29-mcandrew-children/README.md:71`) forbids exactly
that: *"Anyone deriving figures from this file must say which of the two they mean.
Counting the feed and calling it the screen is the same error that put 18% in the parent
plan."* That README was corrected on 2026-09-30; the draft was written the same day and
repeated the error anyway.

`foldChatEvent` drops all sub-agent prose, so 190 of the 282 paragraphs render:

| Figure | Feed (what the draft reported) | **Screen (what a reader sees)** |
|---|---|---|
| Paragraphs | 282 | **190** |
| Opens `Now…`/`Let me…` (the report's own regex) | 26 = 9.2% | **7 = 3.7%** |
| Paragraphs per writer call | 1.97 | **1.33** |

Nineteen of the twenty-six openers are sub-agent prose. Some of it is not even governed by
the string: `packages/engine/plugin/agents/record-extractor.md:62` says that agent does not
apply the researcher profile.

**The corpus figure has the same defect, and that is the finding worth acting on.** The
e2e narration capture appends every `AssistantMessage` TextBlock with **no thread tag**
(`eval/harness/e2e/orchestrator.py:2445-2449` writes `{tool_calls_before, kind, text}`),
even though the SDK tags the thread exactly and the orchestrator already reads
`parent_tool_use_id` for usage at `:2483`. So the corpus's **8.8%** mixes main-thread and
sub-agent paragraphs exactly as the draft's 9.2% did, and the true on-screen figure is
unknown and probably much lower.

That is a live figure in the parent's R7 table, used to decide a product rule. It needs
the population stated before it is used again.

## Order of work

### 1. Tag the narration capture by thread, and report the populations separately

`orchestrator.py:2445` gains `parent_tool_use_id` on each narration entry — the value is
already in hand at `:2483`. `narration_figures_report.py` (`OPENER` at `:37`, counted in
`derive()` at `:87`) then reports main-thread and sub-agent shares separately, with
denominators, keeping the report's existing discipline: exit 2 on a zero-paragraph scan
rather than a cheerful 0%.

**Committed run logs carry no tag and cannot be re-split.** The report must say so for
those runs rather than silently lumping them in — a figure derived from an untagged run is
reported as untagged, not as main-thread. This is the honest half of the fix and the part
most likely to be skipped.

Pure analysis plus one capture field. No API, no eval slot, no cost.

**Acceptance:** the report prints main-thread, sub-agent and untagged counts with n for
each; a deliberately broken regex moves exactly one number and not the others; and a
*legitimate* variant — a reflowed paragraph, a run with zero sub-agents — still reports
correctly. Both directions, per CLAUDE.md.

### 2. Correct the live 18% claim in the parent

`research-as-a-job-later-REVISED.md:561` still reads *"'Now…' and 'Let me…' open about
18% of corpus paragraphs"* — inside the very section this phase executes, and contradicted
by the same document's own table at `:530` ("does not hold — about half").
`research-as-a-job-later.md:370` repeats it but is headed "Do not build from this file."

The draft claimed there was "no live claim to fix". There is, and it is the one place it
matters most.

### 3. [R8] Build all three UX items

**Decided (owner, 2026-09-30): build them here, not file them.** The draft proposed filing;
the review separately found the retry indicator fails the ladder's size test for filing
anyway (two files, one language, one plane), so the owner's answer and the review agree.

1. **Retry exhaustion carries no diagnosis.** The draft overstated this: the *server*
   already classifies (`apps/server/app/sandbox_server.py:167` sends `classify(exc)`, since
   #1126). The diagnosis-free path is the **client's** retry exhaustion —
   `apps/web/src/transport/SessionConnection.ts:218` — which surfaces through
   `ChatPane.tsx:396` as a bare `Chat unavailable: …`. A dead sandbox and a healthy one
   that is unreachable from here arrive identically.
2. **Local sandboxes are never reaped.** No reap, terminate or cleanup path exists in
   `sandbox_server.py`. Nine were found running, one 17 days old.
3. **The retry indicator shows no attempt count.** `SessionConnection.ts` exports
   `MAX_RETRIES = 20` (`:36`) and `retryDelayMs` (`:37`) and tracks `private attempts`
   (`:90`), and `ChatPane` renders "Reconnecting…" — with no count or elapsed, so a retry
   that will succeed looks like one that will not.

### 4. Record the two no-ops in the parent's table

S1 and S5 need no prose change and no paid slot. Write the reason into the parent so the
next reader does not re-price them.

**S5 specifically**: the draft said `record-extraction` "carries only the standard
`**Narration:**` pointer". That is false — `:157` carries **"Announce before delegating,
not only after"**, a forward-announcement rule of its own. It is a deliberate local
override for per-record batches, where progress is exactly what a reader needs, and it
stands. The parent asks that such rules be "reconciled with the string in the same
change"; there is no string change, so there is nothing to reconcile, and that is the
reason S5 closes rather than an absence of rules.

## Not in this pass

- **Any change to `narration_guidance`.** Decided above.
- **[R7]'s unmeasured 22% identifier-validator refusal rate.** A measurement-design task,
  left where the parent put it. Nothing in phase 5 depends on it.
- **Re-splitting committed e2e run logs by thread.** They carry no tag. Step 1 reports
  them as untagged rather than inventing an attribution.

## What landed

| Step | State | Where |
|---|---|---|
| 1. Tag the narration capture by thread | **done** | `orchestrator.py:2445` records `thread`; `narration_figures_report.py` splits main / sub / **untagged**, and reports the main-thread share as **NOT MEASURED** for every committed run, because they all predate the tag. New unit suite: `eval/harness/tests/unit/test_narration_figures_report.py` |
| 2. Correct the live 18% | **done** | `research-as-a-job-later-REVISED.md` — the claim is struck and replaced with the derivation, including the feed/screen split |
| 3. [R8] three UX items | **done** | see below |
| 4. Record the two no-ops | **done** | the parent's table now carries `CLOSED, no change, no slot` with the reason for each |

**[R8], all three built** (decided with the owner: build, not file):

- **Attempt count.** `SessionConnection.emitConn` now carries `attempt`/`maxAttempts`;
  `ChatPane` renders "Reconnecting (attempt 3 of 20)…", and falls back to the bare label
  when the SSE transport sends no count.
- **Terminal diagnosis.** `scheduleRetry`'s exhaustion message now names the attempt
  count, the elapsed seconds and the last cause — and the WebSocket close code separates
  the two faults that used to read identically: `1006` (never reached the server — network
  or sandbox down) from a real code (the server closed it, so it was reachable).
- **Orphan reaping.** `LocalProvider` records each WS server's pid beside its sandbox and
  reaps what it can **prove** is ours at startup (`factory.py`). The proof matters more
  than the reaping: pids are reused, so an unverifiable pid is left alone — leaking a
  process is untidy, killing a stranger's is not recoverable.

## Acceptance

1. `make e2e-narration-figures` reports main-thread, sub-agent and untagged paragraph
   counts separately, each with its denominator. Broken-regex and legitimate-variant
   breaks both demonstrated.
2. `REVISED.md:561` no longer states a figure its own table refutes.
3. All three [R8] items are built, each with a test that is shown to fail before it passes.
4. The parent's table records S1 and S5 as closed with no slot, with the reason.
5. `narration_guidance` is byte-identical to what ships today, and `_HOUSE_STYLE` still
   matches it — the no-op is asserted, not assumed.

## What the review changed, kept for the record

Nine findings, all accepted; the three blocking ones are folded in above. The two that
cost the most had the same shape — **a claim I could have checked and did not**: the
string's syntax (checked by reading it whole) and the feed/screen population (checked by
one line of the capture's own README). The third, the `_HOUSE_STYLE` pin, would have
turned a paid eval run red.
