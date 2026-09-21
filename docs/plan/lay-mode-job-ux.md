# Research as a job — the agent runs, you watch and steer

> **Status:** NOT BUILT. Plan of 2026-09-21, written against `8039b23ed`. Replaces the
> lay-mode job UX plan of 2026-09-20 (same path), which specified a `hand_back` MCP tool,
> a seven-arm server turn router and a refusing lay-language validator. All three are
> dropped — the mechanism they were building already exists in the prototype worker, and
> the identifier problem is a rendering problem. The board changes that plan applied on
> 2026-09-20 stand and are recorded at the end.
>
> Supersedes the hand-back literal ruled 2026-09-07 (issues #2292, #1104 and #2328) and the
> regex auto-continue of PR #2667.

## What changes, in one paragraph

Today a `/research` run is a conversation with consent gates: the agent finishes a step,
writes a fixed closing line, and waits for a click. Under this plan the agent works
continuously until the job is done or it needs something only the user has — exactly what
`research/SKILL.md`'s autonomous-mode section already tells it to do, and exactly what
the prototype's D18 Stop hook already enforces. The user reads a feed, watches the plan
tick over, can type at any time, and reviews what changed. The human is in the loop once,
at the plan, rather than nine times at "Continue?".

## The shape, and why

**Model it on Claude Code, because that is the product both audiences already accept.**
Claude Code's loop is: you state a goal, you approve a plan, the agent works in one
continuous turn narrating as it goes, and you review the diff. Three of those four are
missing here. This plan adds them and deletes the machinery that stands in for them.

**One mode for everyone, and it has to be earned rather than declared.** The previous
plan claimed one mode while hardcoding `experience_level: "novice"` and a
`narration_guidance` string that forbids identifiers. That is lay mode with the dial
welded. A single mode works the way Claude Code's does: identifiers are **additive, not
forbidden**. `src/tools/foo.ts:42` next to "I made the tool check the status first" reads
fine to both audiences — the novice reads the sentence, the engineer clicks the path. The
rule is *every paragraph must make sense with the identifiers deleted*, which no regex can
check. So the identifiers get **linked**, not refused.

---

## 1. The agent already runs continuously — turn it on

**The mechanism is built and live on `main`.** PR #2695 shipped the prototype's autonomous
arm: `make_stop_hook` in `apps/server/proto/worker/options.py` binds a `Stop` hook that
vetoes the model's voluntary yield, and `should_continue_run` allows the stop only when
`project.status == "completed"`, the nudge cap is spent, or the previous nudge produced no
tool call. It reads `research.json` off the `documents` row at each stop.

That is both halves of what the previous plan was going to build: continuous work, and a
completion gate that reads real state instead of trusting a claim. No new MCP tool, no
server-side arms, no injected "Continue the research…" message, no transitional literal
arm, no per-turn bubble boundary.

**The prototype's unit of work is already the patron turn, not the step** — "one patron
turn per queue message, not one model call," with SDK resume as the checkpoint. A
per-step-turn design inverts that and makes every research step a fresh queue message,
claim and resume. Do not build it.

What is left is configuration and two exceptions:

- **`AUTONOMOUS_MAX_NUDGES` defaults to 0 in compose** — with the variable unset there is
  no `Stop` key at all. Default it on for the hosted browser path.
- **A waiting user message must allow the stop** (below).
- **A pending decision must allow the stop** (below).

### The two yield exceptions

`make_stop_hook` already takes injectable callables — `research()`, `tool_count()`,
`on_nudge()` — all reading Postgres on the turn's connection. Both exceptions are one more
callable and one more clause in `should_continue_run`:

1. **`pending_user_message()`** — a message the user has posted is waiting. Allow the stop;
   their message becomes the next turn. This is the whole answer to typed-input latency:
   it costs time-to-next-yield rather than time-to-job-end. The same row read by a `hold`
   flag is the pause control, and it is what the interrupt endpoint (currently answering
   501) should do.
2. **`pending_decision()`** — the agent has written an unanswered decision record. Allow
   the stop. See "The loop" below.

Both conditions are decidable by reading the documents alone, which is ADR-0011's first
question, and both sit in a predicate that already does exactly this for completion.

## 2. Making continuous work sound — three defects, and they are the real work

Under per-step turns these are rare. Under one continuous turn they are on every run.

**2a. Resume after a ceiling kill is unsound.** This is the blocker. PR #2695's own
acceptance run on `bagley-father-1884`, 2026-09-20: attempt 1 was killed by the shim at
1,800,092 ms with two `record-extractor` agents mid-persist; attempt 2 resumed and
"completed" in 10 ms with **0 model turns**, because the CLI answered the orphaned agents
with a synthetic no-response reply and `run_turn` took the result as the turn's
completion. `worker.py` raises only on `result.is_error`, and a synthetic result is not an
error.

So "progress is monotone, so the ceiling is a forced checkpoint, not a failure" is false in
the case that matters, and continuous turns make that case routine — the measured fixture
took 1,804 s and still had `project.status: active`.

- Minimum fix: on a redelivered attempt (`receive_count > 1`), a `ResultMessage` with
  `num_turns == 0` is a **resume failure, not a completion**. Retry it; do not mark the
  turn done.
- Then probe the kill-with-background-agents case. D14's kill landed on a main-thread
  `place_search`; this one did not, and the plan already records the gap.
- Note what this says about completion gating: the one observed false completion happened
  **below any tool**. A `hand_back(state: "done")` precondition would not have caught it.
  The gate belongs where the hook already reads the document, plus this worker-level guard.

**2b. Do not raise the ceiling again.** It went to 7,200 s for the arm on 2026-09-20, with
elasticmq visibility at 7,500 s. Either resume is sound and 1,800 s is a real checkpoint,
or it is not and no ceiling is high enough. Fix 2a instead.

**2c. The `/v1` lock defect moves onto the critical path.** It claims a bare timestamp with
no turn identity, a 600 s stale TTL and no heartbeat, against a measured p99 segment of
1,488 s — so a healthy long turn already has its lock reclaimed while running. The
prototype plan files this as someone else's `nothing-checks` issue because at p99 it is
rare. Every turn is long now. It needs turn identity and a heartbeat.

## 3. Identifiers become links, not refusals

**Drop the lay-language validator entirely** — `lay-language.ts`, the vocabulary table, the
`tool-names.ts` cycle-breaker, the replay script, the two-population corpus measurement,
the guardrail register rows, the harness drift pin and the fails-six-ways lint. By its own
numbers it would refuse 22% of paragraphs, catch none of the inter-action narration that
supplies all three of issue #2493's verbatim examples, and catch none of the ~150 tool
chips per run. It gated the smallest leak at the highest cost, and nobody measured what
the model does when refused — the one adjacent measurement (issue #2683) found that
applying the narration string verbatim made violations go **up**.

**The viewer already resolves ids.** `ResearchDataState.getById(id)` returns
`{ item, section }`; `buildIndex` indexes every `research.json` section item by `id` plus
GedcomX persons, relationships and sources. `CrossLink` already does
`getById` → `setActiveSection` → `scrollIntoView` and takes a display label.
`resolveFamilySearchTarget` resolves arks, bare prefixed ids and `/tree/person/<pid>`
behind the constrained `openFamilySearch` channel (issue #1018). `Linkify` is already the
component for agent-authored prose — its own docstring says so. `SessionView` puts
`ChatPane` and the viewer side by side.

So the identifier work is three small pieces, and **the model emits nothing new**: it
writes the id plainly, the renderer resolves it. Same regex the validator would have used,
pointed at rendering instead of refusal — it costs nothing, fails soft (an unresolvable id
renders as today's plain text), and cannot fabricate a target the way a model-authored
link can.

### Three classes, three treatments

| Class | Examples | Treatment |
|---|---|---|
| Resolvable, useful | `I2`, `F15`, `S1`, `q_001`, `ps_003`, `LCZ8-949`, arks, image group ids | **Link**, rendering the referent's label with the id on hover |
| No referent, no value | `research.json`, `tree.gedcomx.json`, `record_read`, `mcp__genealogy__…` | **Remove** — the user has no filesystem and no tool list. Narration guidance, not a gate |
| No referent, wanted | skill names — `person-evidence`, `research-plan` | **Translate**: "linking the evidence to the people". Narration guidance for prose, the summariser for chips |

The first class is essentially the whole of issue #2493's main-thread tally (~44 local tree
ids plus ~10 schema ids). The third is the largest class in the corpus — 517 of 2,332
paragraphs, led by `person-evidence` at 126 — and it was never a validator problem: a link
cannot help and a ban leaves the sentence saying nothing.

### The work

- **`localities` is missing from `buildIndex`.** It is a real `research.json` section, so
  `loc_003` is the one schema-id class that will not resolve. One line.
- **A CrossLink-aware `Linkify` in the chat pane**, resolving the display label through
  `getById`. Two mechanical prerequisites: neither `Linkify` nor `CrossLink` is on
  `viewer-ui`'s public surface (`src/index.ts` exports `App`, the provider, the context
  and the external-link helpers), and the chat pane must sit inside the data provider.
  Both components stay in `viewer-ui` — shared workspace features live there, only chat
  chrome in `apps/web`.
- **The chips become useful rather than hidden.** `map_message()` already emits `tool_use`
  with a human-readable summary. Give it a lay verb per tool and make the chip resolve
  through the same path — a `record_read` chip opens the source card. This resolves the
  chip-row decision by making the chips navigation instead of noise, and it keeps the only
  main-thread liveness signal the product has.

## 4. The loop: plan, watch, correct

This is the half of Claude Code the product does not have.

### 4a. Plan mode — one gate, in the right place

`research-plan` already writes a structured plan: each `plan_item` carries `sequence`,
`record_type`, `jurisdiction`, `date_range`, `repository`, `rationale` and `fallback_for`.
That renders as a checklist a genealogist reads in ten seconds:

> 3. **1880 US Census** — Cook County, Illinois, 1875–1885, FamilySearch. *We need to place
>    the family before the move.* If she is not there → the parish register.

Show it, let them strike items, reorder, or add one, then run. One gate replaces nine.

Two things fall out for free:

- **`plan_item.status` ticking over is the progress bar.** Far better liveness than a
  spinner, because it says what is happening and what is left. This is most of what the
  old plan's liveness item was for.
- **A plan of known length makes the forecast real** — "about 40 minutes, about $5" before
  the run, "two items left" during it. The cost chip shows spend; nobody can see the end.

No enum change: approval is a decision record (below) referencing the plan id, so
`plan_status` stays `active | completed | superseded`.

### 4b. Decision records — the pause, and the question card

The agent needs one structured way to say *I need you*. One new `research.json` section
serves plan approval, person disambiguation and "which of these leads should I follow":

- a prompt in plain language
- optional structured options, each with a label, a rationale, and an optional `ref` id the
  viewer resolves through `getById`
- an answer field

Unanswered record ⇒ the Stop hook allows the yield ⇒ the server renders a **card**, not a
paragraph. The pause moments are where the user's unique knowledge enters the research —
*which of these two John Smiths is yours* — and they are the highest-value interaction in
the product. Rendering them as prose the user answers by typing wastes them. Build the card
from the existing `PersonCard` and `SidecarResultCard`.

This also routes around the open question on `AskUserQuestion`: whether the built-in works
in a headless hosted turn is unmeasured, and a decision record in our own envelope does not
depend on finding out.

**Blast radius, per CLAUDE.md's new-section list:** `docs/specs/schemas/research.schema.json`,
the prose table in `research-schema-spec.md`, `validate_research_schema`, the web mirror
(`packages/schema/schemas/research.schema.json` + the `interface` in `packages/schema/src/index.ts`),
a row in `docs/specs/schemas/ownership.json`, and — if it becomes a `research_append`
section — the `section` enum. It is not `required`, so fixtures do not need backfilling.

### 4c. Change review and reject

The agent writes into `tree.gedcomx.json` and `research.json`; the viewer shows current
state and never **what this session changed**. For genealogists a wrong person-link is the
thing they care most about, and `tree_correct` and `tree_forget` exist as tools with no UI
at all.

A "changes this session" view — persons added, facts attached, relationships made, sources
cited — with a reject on each row routing to the correction tool. The diff comes from the
session's turns and the store's document versions.

Continuous work without a review surface is the part of Claude Code people would refuse to
use. This ranks with plan mode, above everything in section 5.

### 4d. Dead ends become next actions

A genuine blocker — "the parish registers for that town are not digitised" — is a real
research finding and currently the moment a user churns. The locality-guide and wiki tools
hold what makes it actionable: write to this archive, order this film, visit this
repository. Render a blocker as a card with next actions, not as an apology.

## 5. The reading experience

- **The feed and the research log are the same artifact.** `research.json` has a `log`
  section; a research log is a GPS requirement and a thing genealogists already keep.
  Anchor each step's paragraph to the log entry it produced. Catching up after an hour
  becomes *reading the log*, the transcript becomes a deliverable rather than scrollback,
  and durability solves itself — the log is project state in Postgres, not an event buffer.
  (`session_events` is already append-only in Postgres, ~470 rows per run, so the alpha's
  in-memory replay buffer is not a constraint here either.)
- **Negative results are the differentiator and they are buried.** "We searched the 1880
  census for that parish and she is not there" is reasonably-exhaustive evidence and the
  thing that separates this from a search box. `log_outcome` already has a `negative`
  value. Show those entries in the feed as first-class, not as absence.
- **Show the scans.** Seeing the actual census page with the family's line is the
  credibility moment and the reason forty minutes of watching is worth it. `getSourceImage`
  exists in the Electron transport and is **absent in the web client** — that gap is on the
  surface that matters.
- **Show a queued message as queued.** "Queued — picked up at the next step" answers the
  entire typed-input latency complaint with a label.
- **Provenance on hover.** Every tree fact came from a source and `person_evidence` already
  links them. A fact that shows its source on hover is the difference between a tree the
  user believes and one they audit.

## 6. The cold start

`init-project` asks one open question — the research objective — and a novice does not know
what one is. The highest-traffic screen in the product is a blank text box.

Replace it: *who do you want to learn about?* → name and rough birth year → candidate
person cards from `person_search` → pick one. Then **read the tree and offer the gaps you
can see** — no parents, no death date, no marriage — as three concrete objectives with
"something else" as the escape. The agent knows what is missing; asking the user to name it
asks them for the one thing they cannot supply.

## 7. The prose changes

Each of these burns its skill's eval slot. Re-check slot holders at start — the table below
was true on 2026-09-20.

**The narration guidance is one line and it is the highest-leverage line in the product.**
`init-project` writes this string verbatim, and 27 of 28 skills read it from
`research.json` at runtime rather than carrying a copy — so one skill's slot changes
narration plugin-wide. It currently says:

> Plain language for someone who has never done genealogy. No identifiers, file names, tool
> names or field names. **Do not narrate between actions**; report once when the step is
> done…

In this architecture the `text` events between tool calls **are** the feed. Delete that
clause. Replace the blanket identifier ban with the three-class rule: name people and
records in plain words, never name an internal step or a file, and let ids through where
they denote something the reader can open.

**`--autonomous` stops being a flag.** Production now runs the regime the e2e corpus
already measures, which ends the mismatch the old plan accepted. Two cautions:

- Injecting `--autonomous` into the session opening is the zero-slot transitional move,
  **but it inherits `research/SKILL.md`'s rule to suppress per-entry preambles and "narrate
  only at phase boundaries (or not at all)"** — the opposite of what the feed needs. So the
  `research` slot PR lands *before* the arm is defaulted on, or the first window ships a
  silent feed.
- The router's three no-yield sites — the autonomous-mode section, step 3's "Iterate —
  without yielding", and the closing paragraph of "When to stop" — are now **correct and
  stay**. The old plan rewrote all three. Do not.

| PR | Skill slot | What |
|---|---|---|
| S1 | `init-project` | The narration string; the cold-start flow |
| S2 | `research` | Delete the `--autonomous` narration suppression; make the branches unconditional; apply the `proof-conclusion`-writes-status ruling |
| S3 | `question-selection` | Drop the literal; the `q_001` gloss mandate stays (ruled 2026-09-20, and links now make the gloss useful rather than a courtesy) |
| S4 | `research-plan` | The execution offer becomes the plan-approval decision record |
| S5 | `record-extraction` | A batch is one step; re-key or retire the relay-leak validator |

**The `proof-conclusion` status ruling still applies** (lead, 2026-09-01). The router's
`allowed-tools` grants two read tools while a routing row mandates the write, so the file
contradicts itself; three planes already encode the ruling. S2 deletes the router's claim.
Grep `project.status` **and** `research_append` across the plugin and the architecture
guide — two further live sites sit inside `research/SKILL.md` itself. The one path the
ruling does not settle: `question-selection` returning "objective answered" on an
already-resolved question. Raise it, do not invent a mechanism.

## 8. Sequencing

Nothing here needs a new MCP tool, and only the last phase costs eval slots.

**Phase 0 — soundness (no UX, no slots).** 2a the resume guard, then 2c the `/v1` lock,
then the two yield exceptions and the hold flag. Nothing else can be trusted until 2a
lands.

**Phase 1 — the reading experience (renderer only).** `localities` in `buildIndex`;
CrossLink-aware `Linkify` in the chat pane; lay verbs and clickable chips in
`map_message()`; feed-to-log anchoring; negative results; scans on web; the queued-message
label. Independent of each other and of phase 0.

**Phase 2 — the loop.** The decision-record section, then plan mode, the question card, and
change review. Change review is independent of the rest and can go first.

**Phase 3 — the prose.** S1 through S5, one slot at a time. S2 before the arm is defaulted
on.

**Phase 4 — the shell.** Notification on job end, latched once per project, fired from the
turn-end state the server already computes rather than a poller. Project-first navigation:
lead with "your research on Jennie Bagley" and a history of runs, which is probably why
users start new sessions instead of resuming.

**Retire the Continue button and the literal** with S1 and S3; delete the regex, the parity
test and the stripper once no shipped skill emits the literal.
`test_every_shipped_hand_back_literal_classifies` ends on `assert seen >= 2`, and exactly
two skills carry the literal, so **the first of S1/S3 to land reds it**. Relax the floor to
zero in phase 0 and keep the per-literal assertion inside the loop — relaxing the floor
does not save that, and it is the half that still has work to do while one skill is
converted and the other is not.

## 9. What this plan does not do

- **It does not build proof export.** The proof goes to FamilySearch by upload, later.
- **It does not add a confidence meter.** Building one from the GPS evidence
  classifications is the same additive pattern as the links and is tempting. Hold it until
  change review exists: a confidence score on conclusions the user cannot inspect or reject
  is worse than none.
- **It does not touch leaf skills' own offers.** `translation` has a gating validator on
  two literal consent offers and `search-external-sites` asks for repository access. Both
  are correct when the skill is invoked directly, and the Stop hook only vetoes a yield
  when the project is unfinished and progress is being made.
- **It does not bind the reassigned status write.** After S2, `proof-conclusion` owns it by
  prose alone — the plugin hook's owned-sections map has no `project` row. Worth a card.
- **It does not build a cost ceiling.** The nudge cap is the only bound on an unattended
  chain. The forecast in 4a makes the spend legible; it does not cap it.
- **It changes nothing for Cowork, and that is the point.** Unlinked identifiers there
  render as plain text — today's behaviour exactly. The validator this plan drops would
  have fired in Cowork too, constraining what the model may say everywhere to buy a
  rendering benefit only the web gets. Cowork keeps one turn per click, and under
  continuous turns that turn is now the whole job, which is strictly better than today.

## 10. The board, as of 2026-09-20

Applied under the previous plan and still correct, except as noted.

| Card | State |
|---|---|
| issue #2292 | Retitled to "retire the literal from the router and the setup skills"; becomes S1/S3/S4's wording card. Its 2026-09-09 first-delegation ruling survives. |
| issue #1104 | Closed not planned. The hosted stop is structural. |
| issue #2328 | Closed completed by PR #2675. |
| issue #2088 | `high-priority` and the UX framing dropped; the census survives for ADR-0003. |
| issue #2493 | **Answer changes.** No longer the vocabulary source for a validator — it becomes the acceptance corpus for the linkifier. Its "should the rule bind the writer tools" question is answered **no**. |
| issue #1998 | Merge with S5 or sequence it; the plan-item progress bar in 4a is what answers a silent extraction batch. |
| issue #2660 | Its not-planned closure cited the Continue button, which phase 1 deletes. Comment when it lands. |
| PR #2695 | Its mechanism is now this plan's mechanism, not a competing one. The two findings under D18 are phase 0's 2a. |
| **new** | File the `/v1` lock defect (2c) as `nothing-checks`, and a second for emission: nothing on any plane can prove a paragraph reached the reader. |

## 11. Decisions for the lead

1. **This re-decides the 2026-09-07 literal ruling and the 2026-09-18 "every turn is
   separate; no auto-continue" ruling**, as the previous plan also did. The other
   2026-09-18 rulings survive: the relayed summary, per-step granularity, and the fixed
   house style with no interview.
2. **Brian asked for "a paragraph per step, then ask whether to continue."** This keeps the
   paragraph and moves the ask to the plan. Cowork users keep one turn per click.
3. **One new `research.json` section** for decision records, with the blast radius in 4b.
   The alternative is three ad-hoc mechanisms for plan approval, disambiguation and
   blockers.
4. **Phase 2 versus phase 3 ordering.** Change review and plan mode are the two items that
   change what the product *is*; the prose PRs are five paid slots. If slots are the
   constraint, phase 2 first.

## 12. What would show it worked

- A hosted session whose only input is one person and one chosen objective runs to a proof
  conclusion with one approval click, and the chat shows one plain paragraph per step and
  no consent prompts.
- A run whose worker is killed at the ceiling resumes and finishes, and a `num_turns == 0`
  resume is never recorded as a completion.
- A typed message is answered at the next step boundary, not at job end, and shows as
  queued until then.
- Every identifier in the feed is either a working link or absent; a paragraph naming an
  internal step name is a bug with a named owner.
- A two-step run renders two log entries, two feed paragraphs, and two ticked plan items.
- A wrong person-link can be rejected from the viewer in one click.
