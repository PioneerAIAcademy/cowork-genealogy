# Lay-mode job UX — the run is a job with a status feed

> **Status:** NOT BUILT. Plan of 2026-09-20, written against HEAD `2fdaf32db`,
> revised nine times the same day under adversarial critique; the eighth round came back
> clean. Decisions 5 and 6 ruled 2026-09-20; six remain open for the lead.
> Supersedes the hand-back literal ruled on 2026-09-07 (recorded on issues #2292,
> #1104 and #2328) and the regex auto-continue built for issue #2653 by PR #2667.
> Nothing here is started; no issue has been edited and no board column moved.

## What changes, in one paragraph

A `/research` run is a conversation with consent gates: the agent finishes a step,
writes a fixed closing line, and waits. Under this plan the run is a job. The agent
finishes a step, calls a tool that validates and returns a plain-language paragraph,
prints it, and ends its turn. On the hosted web the server starts the next step by
itself; the user reads a feed, can type at any time, and can press Stop. The agent
pauses only when it needs something only the user has, and the job ends when the
project's own status says so. Cowork desktop still stops at every step, because there is
no server there to continue it — and it loses the prompt as well as the click, which is
the one place this plan takes something away. See the residual in "What this plan does
not do".

**What PR #2667 already delivered, and what is left.** That PR made the hosted server
answer the literal itself, so on the hosted web the clicks are already gone for the two
skills that emit the literal — `init-project` and `question-selection`, the only two in
the plugin. What it did not do, and what this plan is for: the other consent gates are
free prose that no regex matches, so the chain still stops at them; nothing validates
what the paragraph says; a completion claim is still taken on trust; and Cowork and the
public REST API get none of it. Do not repeat the "about nine times per run" figure —
it is unsourced, and the one case the plan cites counts three.

**One mode for everyone.** There is no lay/expert setting to self-identify into. The
same feed, the same paragraphs, the same pause rules. An experienced genealogist
redirects by typing; a novice reads and does nothing.

---

## 1. Why the literal is being retired

The 2026-09-07 ruling picked a fixed closing line because the only enforcement plane
available was a `Stop` hook, which sees text and nothing else. That constraint is
gone: the server and the worker both see tool results, and a tool can refuse a call
outright. Four things the literal cannot do and a tool can:

- **It cannot be enforced, and editing it has unpredictable blast radius.**
  `research-plan`'s copy of the literal was reverted on PR #2649 because adding that one
  closing line destabilised a *neighbouring* provenance validator — `ut_research_plan_007`
  passed all three committed runs on the unedited text, then failed the aggregate and
  went fail-then-pass on two re-runs against the edited text (issue #2510). Issue #2683
  is the sharper case: five paid `check-warnings` runs,
  $13.44, violations moving 4 → 5 → 7 → 6 → 8 against a 3-violation baseline, across
  five changes of which two were rewordings and three were fixture or field changes —
  and the last run applied production's own `narration_guidance` verbatim, the string
  that explicitly forbids identifiers, and violations went up.
- **It cannot check what the paragraph says.** The lay-language rule that Brian's
  direction rests on is prose in `init-project/SKILL.md` and in the record-extractor's
  return contract. Issue #2493's 2026-09-20 comment counted 60-plus identifier
  occurrences in one session's visible chat, one persisted into a research question
  where it re-renders forever.
- **It is one rule hand-written into four planes** — the web regex, the server regex,
  the e2e classifier's three constants, and two skills' prose — with a parity test
  binding only two of them. That is the shape issue #2476 exists to stop.
- **It cannot tell a finished job from a claim of one.** The one production false
  completion (issue #1976) was a turn that said it was done. A tool can read the
  store and refuse.

ADR-0011's first question decides the placement: *can this be decided by reading the
documents alone?* A summary carrying `q_001`, `LCZ8-949` or `research.json` is
decidable from the call's own arguments. Stated honestly: that ADR's writer-tool row
scopes itself to "a value or a state transition in research.json / tree.gedcomx.json",
and this tool writes nothing. The precondition test applies; the row does not
name this case, so the plan cites the test, not the row.

**What this does not fix, and the framing that has to stay honest.** Issue #2493's tally
was extracted from main-thread assistant text only, so it contains **no tool chips at
all**: roughly ten schema ids and about forty-four local tree ids like `I2`, `S1` and
`F15`. The vocabulary below catches the tree ids, which is the bulk of it. But its three
verbatim examples are *inter-action narration* — "I can see I2 starting. Let me read the
rest of Jennie's entry" — text the model emits between tool calls, which `hand_back` and
`hand_back` never sees, because it binds only the summary and the next-step line. So this
plan fixes the step summaries and leaves two residuals: inter-action narration, and the
tool chips rendered above every paragraph. Do not claim the tools answer that issue's
visible-chat half.

## 2. The mechanism

One MCP tool in the engine. It never waits, never blocks, never holds a session open.
It validates, then returns the text the model must print.

```
hand_back({ projectPath, summary_for_user, next_step, state? })
  -> { ok: true, state, reply, instruction }
   | { ok: false, reason: "not_lay_language" | "not_completed" | "no_project",
       errors: string[] }

  state: "working" (default) | "blocked" | "question" | "done"
```

**One tool, not two.** An earlier draft split this into `hand_back` and a separate
`ask_user`. They shared an envelope, a validator and a turn-ending semantic, which is
what CLAUDE.md forbids twice over — "use generic tools with parameters to keep the tool
count manageable". `research_append` is the precedent and it is a far harder case: one
tool, a sixteen-value `section` enum, and a payload shape that depends on the section.
Here nothing is conditional at all — both text slots are required in every state, and
`next_step` carries the question when there is one, because what happens next *is* the
user answering.

The merge is also a correctness win under tool-search deferral. Cowork defers tool
schemas above a size threshold, and a deferred tool the model never searches for produces
the silent degradation this plan warns about elsewhere: the boundary simply never
happens. One tool is loaded every step. A second tool would be one the model has to
remember exists and go find, on exactly the rare turn it needs it — the worst possible
distribution for a deferred schema. And the two states most likely to be confused,
`blocked` and `question`, are the two the server already treats identically, so a wrong
enum there costs nothing, where picking the wrong *tool* changed whether the run
continued.

**`state` is on the success envelope, not only on the call.** The server's arms branch
on it, and the tool-result event cannot recover the call's arguments: it carries the
tool name and a truncated summary with no correlation id back to the tool use. So the
tool echoes the state it accepted.

`projectPath` is **required**, matching every comparable reader: `writerToolResult`
leaves `isError` unset whenever the reason is exactly `no_project`, so a
`state: "done"` call outside a project would otherwise return a success-shaped envelope
with no `reply`. There is deliberately **no `missing_project_path` reason** — the
repo's convention for an absent path is a loud throw with no reason field, asserted for
all thirteen project-reading tools by `tests/tools/no-project.test.ts`, which PR A1 must
therefore edit. PR A1 states which `ok: false` reasons carry `isError`, and pins that
`hand_back({})` is a failure with `isError` set, because the mirror test invokes every
member of the failure list with empty arguments.

**`reply` composition is pinned in the spec, not left to the tool.** It is the summary
paragraph, a blank line, then the next-step sentence, with no heading, label or
identifier of its own, and it is what the lay-language rules were applied to. The
`instruction` string is pinned too, in the same place and for the same reason as the
server's injected text: a model reads it every step.

`state` is `working` (default), `blocked`, or `done`. `done` reads `project.status`
through the project store and refuses with `not_completed` unless it is `completed` —
so a false completion claim cannot be made, rather than being detected afterwards.
`blocked` is the third legitimate stop the router already has and the old three-class
taxonomy had no slot for.

`state: "question"` carries no default answer. An earlier draft gave one to a separate
ask tool and nothing in the design applied it: the pause arm waits for a human, and the
harness answers from its fixture, not from the argument.

### How the paragraph reaches the user

The model prints `reply`, because printed assistant text is the only channel that
exists on every surface: Cowork renders its own chat and we control nothing in it, and
the electron viewer has no chat at all.

**The echo is not load-bearing.** The closest in-repo analogue of "print exactly this
text" is measured non-compliant: `record-extraction/SKILL.md` tells the model to print
an agent's return verbatim, and the relay-leak test records 12 of 29 delegated runs
printing the paragraphs and then a table of assertion ids. The observed failure mode is
**addition, not omission**, which the control flow tolerates. But the plan does not
rest on it. On the hosted web:

- The tool is **exempt from the event-stream summarisers**, so `reply` travels
  whole instead of truncated to 160 characters of `k=v`.
- Their chips are **suppressed in the fold**.
- If the turn produced **no main-thread assistant text at all**, the web renders
  `reply` from the event as a **new assistant message**, not folded onto the tail,
  which may belong to the previous turn. Zero text is an unambiguous trigger; no fuzzy
  matching against what the model did print.

**The chip row is the other half of issue #2493 and PR B must answer it.** Every tool
use and tool result renders as `{tool}: {summary}` above the message text,
unconditionally — a fifteen-step run shows roughly 150 chips carrying MCP tool names,
field names and absolute paths directly above fifteen paragraphs from which those exact
classes were refused. PR B either collapses the chip row behind a toggle, as the
thinking pane already is, or replaces the summariser with a lay verb per tool. If it
does neither, strike the claim that this plan answers that issue's visible-chat half
and record the chips as the residual.

What no plane can enforce is **emission**. The Cowork hook's matcher covers writes
only, and the alpha's matcher is derived from its deny arms, which this plan does not
add to. The tool binds the paragraph's *content* everywhere and its *appearance*
nowhere. PR B files that as a `nothing-checks` issue: CI stays green while no paragraph
ever reaches the researcher.

### Why there is no hosted-versus-desktop branch

An earlier draft had the tool return "continue with the next step" on the desktop and
"end your turn" when hosted. Three problems killed it. Both eval harnesses run the
local principal and would have taken the desktop branch, so no harness turn would ever
end at a hand-back and the classifier would read every yield as a silent stop. The unit
harness would have been told to run past the skill under test, and the branch depends
on a file in the developer's home directory, so two machines could grade the same test
differently. And Cowork users click, which you already ruled.

So the tool always ends the turn. Who starts the next one is the server's business on
the hosted web, the harness's in an e2e run, and the user's in Cowork.

### What the server does at a turn end

**Arms key on the tool's own result, never on the call.** A tool-use event says only
that a call was attempted; the outcome arrives on the result. A `hand_back(state:
"done")` the tool *refused* with `not_completed` would otherwise set the done flag and
the server would render a final report and email the researcher — issue #1976
reproduced through the mechanism built to prevent it. The same hole on `working`: a
refused call would start the next step with no paragraph ever shown. **A flag is set
only on `ok: true`.** The server reads the tool's own `ok` field, not `isError`, which
is deliberately unset for one refusal reason.

1. A **user message is waiting** → start the user's turn. Nothing else applies. This
   arm wins over the suppressors below, as it does today.
2. The turn ended in an **error** → stop. The runner clears its continue signal on an
   error today for exactly this reason, and the web refuses Continue on an error bubble.
3. The turn was **interrupted** → stop.
4. **`hand_back` returned `ok: true` with `state: "question"` or `state: "blocked"`**
   → pause. The server does not distinguish the two, which is the clearest argument that
   they never needed separate tools.
5. **`hand_back` returned `ok: true` with `state: "done"`** → emit a job-done event and
   stop. The report and the notification are **PR K2's**, fired at most once per project.
   The once-per-project state cannot live in the runner: it runs inside the sandbox,
   speaks over stdio, holds no database handle, and every piece of its chain state resets
   per chain — so a flag there would be per-session and would re-notify on every reopen,
   which is the failure it exists to prevent. The control plane latches the event. There is **no
   separate store check here**: the tool's own store read is what produced the `ok`. An
   earlier draft instead fired this arm whenever the store said `completed`, which
   latches — the status enum has no reopen value and no skill writes it back. The
   once-per-project latch is what replaces that check, and it belongs to the control
   plane rather than to the router's prose because a resumed session on a finished
   project legitimately emits `done` again and the router cannot tell the two apart.
6. **`hand_back` returned `ok: true` with `state: "working"`** → start the next step
   immediately — **unless** the step budget is spent, auto-continue is off on the
   control plane, or the frame that started this chain opted out. Those two suppressors
   exist today and both must survive: the settings kill switch, and the per-frame
   opt-out the public REST API sets on every one of its messages. Without them an
   implementer starts a thirty-step chain behind every REST reply and misattributes
   every caller's next answer. They gate **this arm only** — a waiting user message
   still runs.
7. **No successful call to the tool** → **pause**. This is today's behaviour and it
   stays.

Arms 2 through 5 and arm 7 end the turn without starting another; arm 1 starts the
user's turn and arm 6 starts the next step.

Arm 7 is a pause, not a continue, and that is a deliberate correction. Continuing on
"neither fired" would have inverted the runner's default from stop to continue: an
errored turn would retry a dead credential up to the step budget, a Stopped turn would
restart itself, and a genuine question asked in plain prose — which every not-yet-
converted skill still asks — would be auto-answered. **Thirteen committed runner tests**
pin the current behaviour, including the two that pin the suppressors, and all thirteen
must pass unchanged, as must the eight in the turn-queue suite that pin arm 1 beating
them.

The transition is carried by a separate arm: **a turn whose text still ends with the
retired literal is treated as a successful `hand_back(state: "working")`.** That covers
the only two skills that emit the literal today and is deleted in PR J. An unconverted
skill simply pauses, exactly as it does now.

### The text that starts the next turn

The server injects a user message the user never sent and never sees. Today it is
"Yes.", which is coherent only because it answers the literal's "Continue?". This plan
retires the question, so the injected text must **re-enter the routing table on its own**
rather than answer anything — something of the shape *"Continue the research: re-derive
the current state from the project documents and run the next step."* PR B names the
exact string, matches it against the router's description so it triggers, and pins it in
a runner test the way the current constant is pinned. This is the whole control loop's
prompt; it does not get to be implicit.

### Matching the result

All three environments see tool results, and bare-tail matching over the three server
spellings is already implemented three times in the repo. Two constraints:

- **Main thread only, best-effort.** Delegated events are labelled by agent, and the
  runner already applies that guard to its text path. The labelling is keyed on a tool-use
  id the SDK types as optional, so a delegation without one goes unlabelled — the guard is
  best-effort, not a guarantee. The tool is granted in no agent's `tools:`
  frontmatter, which is the actual defence.
- The prototype's `PreToolUse` hook already matches every tool, so once `hand_back` has
  succeeded it denies every later call in that turn with "end your turn now". Arming
  happens in `PostToolUse` on a non-error result, so a refused call stays retryable.
  **The alpha gets no deny arm**: its matcher was deliberately narrowed after issue
  #1915 and three tests pin that narrowing. If the model keeps working after a hand-back
  there, the turn runs longer and the paragraph lands mid-turn; nothing breaks, because
  the server keys on "did the tool succeed in this turn", not on it being last.

PR B's file list therefore includes the event emitter: the tool-result event must carry a
**structured outcome** — the tool name, `ok`, and `state` read off the returned JSON —
not a 160-character string the server parses, and the SDK's own error flag on that block
is not emitted today.

**Typed input gets slower, and the plan should say so.** A message arriving mid-turn is
queued and started when the turn finishes. Today the agent is idle at a gate, so typing
is answered at once; under arm 6 it waits for the running step to finish — a median of
213 seconds over 442 skill-only episodes, per the prototype plan's own segment table.
"The user can type at any time" means the message is never lost, not that it is answered
immediately.

## 3. Sequencing, and the thing that actually binds

**Five skill eval slots, four of them held.** Editing any file under a skill directory
invalidates that skill's run log. `fill-ready`'s fourth gate: *"At most one item touching
a given skill's eval snapshot may be in an active column at a time — Ready, In Progress,
or Review. Only an open issue in one of those three columns holds a slot."* Column, not
assignment.

| Slot this plan needs | Holder | Column |
|---|---|---|
| `research` | issue #2075 / PR #2662 | In Progress |
| `research-plan` | issue #2075 / PR #2662 | In Progress |
| `init-project` | PR #2593 | open |
| `record-extraction` | issue #1998 | In Progress |
| `question-selection` | issue #2115 | Backlog — slot free |

PR #2662 also holds `hypothesis-tracking`, which this plan does not need. A skill's
snapshot also includes any agent body it references with `@plugin:`; for PR I that
fan-out is exactly one skill, so it costs no extra slot.

The plan is built so that **every unpaid piece lands first and the paid prose edits
trickle in one slot at a time**, with both signals accepted throughout.

| PR | What | Slot | Blocked by | Docs it owns |
|---|---|---|---|---|
| A1 | The tool, the envelope, dispatch, packaging, mock registration, the no-project test, smoke calls | none | nothing | new tool spec |
| A2 | The lay-language module, its vocabulary table, the replay script, the measurement | none | nothing (decision 6 ruled 2026-09-20) | two guardrail-register rows |
| B | Alpha server + web: arms 1–7, the injected text, event render, chips, bubble boundary, budget pause | none | A1 | hosted-web lay-mode paragraph; the REST opt-out paragraph |
| C | e2e harness: classify on the result, keep the text fallback, relax the literal floor, fix the no-progress guard | none | A1 | e2e hand-back class table and form paragraph |
| D | Prototype worker: replace the merged Stop-hook veto with per-step turns, per-session serialization, hold | none | A1 | prototype plan's step-model and D18–D19 entries |
| E | `research/SKILL.md`: call `hand_back` at each step boundary | `research` | PR #2662 | architecture orchestration items 3, 4 and 5, and the direction note blocking the matching unit-suite row |
| F | `init-project`: drop the literal, call the tool | `init-project` | PR #2593 | **both** alpha user guides' stops-mid-research rows |
| G | `question-selection`: same | free | nothing | — |
| H | `research-plan`: replace the execution offer | `research-plan` | PR #2662 | — |
| I | `record-extraction`: relay becomes the tool's arguments | `record-extraction` | issue #1998 | — |
| J | Delete the regex, the parity test, the literal constants and stripper; land the inverted lint | none | E–I | the pair-conversion recipe's step 7 |
| K1 | Liveness line | none | B | — |
| K2 | Final report, notification | none | B, E | — |

E through I are independent of each other. Each is one paid run plus one annotation
pass: **five runs, not six.** J is the only one that must wait for all of them.

**The literal-floor trap.** A harness test asserts at least two shipped skills carry the
literal, and exactly two do, so the **first** of PR F or G to land breaks it. PR C
relaxes that floor to zero but keeps the per-literal assertion inside the loop, which
relaxing the floor does not save. PR J then lands the inverted lint — no skill body
carries the retired literal — and proves it fails two ways and passes on a legitimate
paragraph naming a next step in prose.

**Rollback, and the limit of the kill switch.** The settings flag is read **once, at
sandbox start**, from an environment value baked in when the sandbox is created. E2B
sandboxes are persistent, so flipping it changes only sessions created afterwards and
rolls back nothing already running. PR B must either ship a live per-turn signal — the
shape of PR D's hold flag — or say plainly that the switch is new-sessions-only and name
what stops a running chain, which today is Stop. It must also say what the product
renders with the flag off **after PR J**, when neither the literal nor the Continue
button exists: the answer is arm 7's pause plus whatever control PR B adds.

The revert order is E–I before B, never B alone: reverting B after the prose has landed
restores a Continue button whose condition can never be true, because no shipped skill
ends on the literal any more. If B must be independently reversible it keeps the
ends-with predicate and the button until PR J.

**PR J's own blast radius includes the runner suite, and it is bigger than one test.**
That file imports the injected-text constant, the compiled regex and the ends-with
predicate at module level, so deleting the constants is a collection error across all
thirteen. Worse, its scripted agent yields only text events and the continue arm keys on
the literal, so once the transitional arm goes: one test is deliberately deleted (the
pattern assertion), **five go red**, and **six pass vacuously** — they assert an absence
the literal no longer produces, including the two that are supposed to prove the
suppressors.

So the sequence is: **PR B** gives the scripted agent a result-emitting variant and adds
arm tests keyed on the structured outcome, while the thirteen still pass unchanged
because the transitional arm survives. **PR J** then deletes the pattern test and the
literal-driven tests only that arm could satisfy, and its body names which test proves
each suppressor — the budget, the kill switch, the per-frame opt-out — once the literal
is gone. "Twelve after PR J" was a number this plan cannot make true.

## 4. The work, per PR

### PRs A1 and A2 — the tools

New: `src/tools/hand-back.ts`, `src/utils/lay-language.ts`, `src/tool-names.ts`,
`docs/specs/hand-back-tool-spec.md`, `tests/tools/hand-back.test.ts`,
`dev/try-hand-back.ts`, and a committed replay script under `eval/harness/scripts/`.

Edit: `src/tool-schemas.ts`, `src/server.ts` (one dispatch arm through
`writerToolResult`, taking `args` only, like every other project reader — a second
parameter would take `undefined` in every unit run, because the mock calls the compiled
export with one argument), `tests/tools/no-project.test.ts` (a mandatory site nothing
derives), `src/tool-result.ts`, `manifest.json` (50 tools becomes 51),
`dev/smoke-calls.ts` (two offline steps, one accepting and one rejecting), `README.md`
(one row and both tool counts), and two rows in the guardrail register naming each
precondition's binding environments and whether it ships enforcing or advisory.

**The mock harness registration is not optional.** The unit harness registers a tool only
if a fixture declares it or it is in the mock's live-tools set, and a call to an
unregistered tool aborts the run as an unmatched tool call. Without that edit, all five
paid runs in PRs E–I produce nothing. The mirror of the failure list must move with it,
because a test asserts the two sets intersect exactly.

**`src/tool-names.ts` exists to avoid a cycle.** The schema registry imports every tool
file, so a tool importing the registry for the tool-name vocabulary would close a loop.

**`lay-language.ts`** matches closed vocabularies only, never judgment, and validates
**both** `summary_for_user` and `next_step` — the next-step slot is exactly where a skill
name leaks today, which is why the web strips that line at render instead of showing it,
and this plan promotes it to permanent user-facing prose.

The vocabulary, with the local-tree-id class that the issue #2493 tally actually turns on:

| Class | Shape | Refuse | Pass |
|---|---|---|---|
| FamilySearch person id | `{4}-{3}`, word-bounded | `LCZ8-949` | `1850-1860` |
| Schema id, **except `q_` and `ps_`** | validator's exported prefixes + digits | `loc_003`, `pli_002` | `q_001`, `ps_003` |
| **Local tree id** | `I`/`F`/`S` + 1–4 digits, word-bounded | `I2`, `S1`, `F15`, `F1` | `WWII`, `US 1`, `Class III` |
| Image group, collection, batch | the elena-asmundsdotter narration's shapes | `004514823_00158`, `coll. 1974200`, `batch C41552-1` | — |
| File names | the two project files, the sidecar shape | `research.json` | — |
| Tool names | the `mcp__` prefix and the snake_case names from `tool-names.ts` | `mcp__genealogy__record_read`, `research_append` | — |
| **Hyphenated** skill names | the 24 skill directories containing a hyphen | `research-plan`, `check-warnings` | `research`, `citation`, `timeline`, `translation` |

**Why skill names are scoped to the hyphenated ones, and what that costs.** Measured over
the 2,332 assistant paragraphs in the committed run logs: matching all 28 directory names
refuses **639 (27.4%)**; the shipped hyphenated-24 rule refuses **517 (22.2%)**; the four
single-word directories add only **122 more (5.2 points)**, because most paragraphs
naming one also name a hyphenated skill. A packaging test already names those exact four
as the reason substring matching is not good enough, so they are scoped out cheaply.

**The 517 are true denies, not false ones.** Sampling them returns genuine leaks —
"Now routing to person-evidence to link the extracted assertions" — and the top drivers
are `person-evidence` at 126, `research-exhaustiveness` at 87, `proof-conclusion` at 86,
`research-plan` at 62 and `search-records` at 61. A paragraph naming a sub-skill is
exactly what this design exists to stop, so the gate is working, not misfiring. But 22%
is the refusal rate PR A2's guardrail row has to justify, and ADR-0011 wants that number
read before the gate ships. **My recommendation is to ship it enforcing on both slots**:
the cost is one extra tool call on about a fifth of steps, and the alternative — narrowing
the class to the `next_step` slot where the literal leak lives — leaves the summary free
to say "routing to person-evidence" forever. PR A2's replay decides; state the number
either way. The single-word four remain a stated gap, and any later single-word skill
joins them.

**`q_` and `ps_` pass — lead ruling, 2026-09-20.** `question-selection/SKILL.md` requires
the reply to say the question was saved as `q_001` with a gloss, and that mandate
**stays**: it came from a tester's own rewrite on 2026-08-03, who hit a bare "q_001
written." and asked to be taught what it meant rather than to have it removed. Three of
122 feedback bundles ever name a schema id, and refusing the prefix would have moved 3.9%
of paragraphs — not enough to reverse user-authored prose. The remaining thirteen
prefixes are refused. No skill body changes for this class.

The record-extractor is **not** a second such site, contrary to an earlier draft. Its
`check-warnings on I5/I6` is one of three `e.g.` examples, not a mandated form, and it
sits above the `---` that `record-extraction/SKILL.md` says nothing above reaches the
user. The agent's own return contract already specifies a lay paragraph with "no
identifiers, file names, tool names or field names" and a plain-language next sentence.
PR I maps those two paragraphs straight onto the tool's two arguments; the agent's
caller-facing lines are out of the vocabulary's scope.

**The viewer cannot resolve an id, and that is the standing caveat on this carve-out.**
Question cards are titled by question text, a proof-summary id is never printed, and
there is no search box, anchor or deep link. So `q_001` reads as a label the user can
repeat back, not one they can follow. If the viewer ever indexes by id, the gloss stops
being a courtesy and starts being useful; until then it is a courtesy.

Mechanics an earlier draft got wrong: the consonant alphabet used elsewhere in the repo
**contains the digits**, so it does not exclude a year range; the fixed segment lengths
plus word boundaries do. The existing id regex is anchored start-to-end and unexported,
so PR A2 writes a boundary-delimited variant. And `{4}-{3}` knowingly lets a four-four
persona id through — write that down, as ADR-0011 requires of a gate's known gaps.

**A drift pin** ties the module to the harness's advisory identifier detector, which has
already drifted from the validator's prefix set: it carries one prefix the validator does
not mint and omits four that it does, so a locality id passes it today.

**The measurement this PR owes**, and its honest limits. ADR-0011 requires a corpus
refusal measurement before a gate merges. Two problems to state rather than paper over.
The population that matters — 33 hosted sessions, **a quarter of all reply blocks
carrying an internal identifier** — was produced by a script that reads feedback bundles
from a developer's downloads folder; no bundle is in the repo, so the number cannot be
re-derived by anyone else, and an enforcing register row whose evidence cannot be
re-derived is not evidence. Commit the replay script, name whose machine holds the
bundles, and replay over the corpus that **is** in the repo: the assistant-kind entries
of `narration[]` across the committed run logs, 2,332 paragraphs at HEAD. Report the
refusal rate per vocabulary class against both populations. And say plainly that the 25%
baseline was produced by the detector that is blind to `I2` and `S1` exactly as the old
vocabulary was, so a low incremental refusal rate means both patterns share a blind spot,
not that the gate is well-targeted.

Prove the lint fails six ways and passes four: an id mid-sentence, a lowercased id, a
quoted file name, a next-step line naming a hyphenated skill, a local tree id, and
`Next: research-plan for q_001`; and "1850 census", a hyphenated surname, "WWII", and
"Next, I'll build a research plan for her parents".

### PR B — the alpha server and web

The turn-end decision becomes arms 1 through 7 plus the transitional literal arm, keyed on tool **results** with per-turn
flags set only on `ok: true`. Files: the runner and its hand-back module, the event
emitter (structured outcome on the tool-result event, plus the tool exempt from the
summarisers), the public REST module and the settings module for the two suppressors,
and the web.

`hand_back.py` loses its completion constant only. It **keeps** the pattern, the compiled
regex and the ends-with predicate through the transition: the parity test imports all
three at module level, so deleting them is a collection error on the very commit the plan
needs that test to survive, and the transitional arm is precisely what the predicate
computes. The **web half is pinned in the same direction** — that test reads the web
module's source and asserts the exported regex is present with no flags, so deleting the
now-unused export reds it on PR B's own commit. Both halves go in PR J.

The web: delete the Continue button; suppress the tool's chips; render `reply` as a
new assistant message when a turn produced no main-thread text. **Keep the
literal-stripper until PR J.** PR B already keeps the compiled regex, because the parity
test reads the web module's source, so the stripper costs one call site — and deleting it
renders `Next: plan which records to search. Continue?` verbatim to hosted users for the
whole window between PR B and PRs F and G, while the transitional arm auto-continues past
it. A question on screen with no control, shipped by the PR whose subject is the reading
experience. **Keep a per-turn bubble boundary** — the auto-continue event setting the
handed-back flag is the only thing that closes a bubble between two server-started turns,
and a committed five-test suite pins it. Without a replacement, fifteen steps fold into
one bubble and the first acceptance criterion fails on a two-step run. That suite is
updated, not deleted.

**The budget pause loses its only renderer.** Its state is read in exactly one place,
inside the Continue-button block this PR deletes, and the condition guarding that block
derives from the predicate PR J removes. Move the notice into the standing status line
and add a bare Resume control keyed on the pause **event**, not on message text. Without
it a run that spends its budget stops mid-job with no explanation and no control.

**Stop needs a decision.** Today Stop aborts the running turn and drops the queued
backlog. "The user can type at any time" wants a hold that lets the current step finish.
My recommendation is to add hold as a separate control and leave Stop as the hard abort,
because a half-finished step is exactly the state the agent is worst at resuming.

### PR C — the e2e harness

`classify_hand_back(tool_calls, text)` — the tool result first, the text as a transitional
fallback deleted with the literal in PR J. That signature resolves the contradiction in an
earlier draft, which said both "keep the literal arm" and "instead of its text", and it
keeps the four text call sites working. **Keep `completion_claim`**: it is the sole input
to the false-completion nudge, now fed by a refused `hand_back(state: "done")`.

Its docstring loses the "Half B lifts this verbatim" rationale, and the test asserting the
signature is exactly one text parameter is **deleted deliberately**, not left to fail.

Blast radius to list in the PR, not one deletion: four text-passing tests in the stop-checker
suite, the classifier call in the nudge report, the floor test's own per-literal call, the
`e2e-nudges` Makefile comment that a commit corrected two commits ago, and the stale
constant comment beside the classifier.

**One thing PR C does not touch.** The orchestrator's silent-stop block reason still tells
the agent to keep going until the status is completed, and its own comment says that wording
flips when the prose lands. That is **PR E's edit, not C's** — C lands first, and the current
wording is correct until a skill emits the tool.

Two hazards. The new tool must be excluded from the activity counter, or the no-progress
guard is defeated by a bare hand-back loop for the full 40-nudge budget; and from the
per-hundred-tool-calls denominator, or the pre-registered baseline on issue #1104 stops
being comparable.

The harness answers `state: "working"` with "Yes." as it does now, and a `question` or
`blocked` with the fixture's default, otherwise an instruction to decide and log the
assumption. **"Yes." is
correct here and the server's injected text is not**, for a reason worth one sentence in
the PR: the harness delivers its answer as a Stop-hook block reason to a model that never
left the skill, so it resumes a live turn; the server injects a fresh user message, which
has to re-enter the routing table on its own. The nudge
report's seam axis is re-keyed off the tool call **before** the hand-back, because the
precondition now forbids the identifiers it reads from prose. Its older transcript source
has no tool markers at all and loses its hand-back axis; say so rather than letting it
report a class it cannot see.

**An acceptance criterion, not an issue:** a converted run spends one nudge per step
against a 40-nudge cap. Nine to fifteen steps plus genuine stalls is comfortably inside
it, but it has never been run, and the cap is what would bind first.

### PR D — the prototype worker

**This is PR #2695's surface, and that PR merged to `main` on 2026-09-20.** It already
changes the worker's turn loop, its options, the demo and the proto tests, and it ships
an autonomous continue by a *different* mechanism: a Stop-hook veto porting the harness's
continue predicate into the worker. So the veto is live now, and two mechanisms for one
job is what CLAUDE.md's rule forbids. PR D either replaces it with per-step turns, or the
veto stays and this plan's hosted arms never reach the prototype. Decide before D starts.

**That PR's acceptance run refutes a claim an earlier draft made.** On
`bagley-father-1884`, 2026-09-20: attempt 1 never yielded and the shim's 1,800-second
per-attempt ceiling killed it with two record-extractor agents mid-write; attempt 2
resumed and "completed" in 10 ms with zero model turns, because the CLI acknowledged the
orphaned agents with a synthetic no-response reply and the worker took the result as
completion. A ceiling crossing did not cost a forced checkpoint — **it produced a false
completion below the level any tool precondition can reach**, because no tool fired at
all. Per-step turns make the crossing far less likely, but the resume-after-kill defect
is unfixed and is a prerequisite for trusting the prototype's completion signal. That PR
already proposes the probe and the worker rule; this plan depends on them.

Three further prerequisites, all verified:

- **Per-session serialization.** A message posted mid-turn is enqueued with no busy
  gate, the queue is not FIFO, the shim keeps two POSTs in flight, and the claim keys on
  turn id alone. Today a human types too slowly for it to bite; with an auto-continued
  chain it is reachable at one worker, and the prototype plan's own risk register calls
  this unreachable. An advisory lock on the session in the claim is the cheap fix.
- **A hold.** The interrupt endpoint answers 501. A session flag the worker reads before
  enqueuing holds the chain at the next boundary; stopping a running step has no
  mechanism and stays out of scope.
- **A queue client in the worker.** The follow-on enqueue has a crash window between the
  commit and the send: mint the follow-on turn row inside the same transaction and
  re-send it from the already-completed arm, or state the residual.

The demo and turn helpers wait for one turn-done, which under a chain is the end of step
one. They must wait for a pause, a question, or completion.

### PRs E–I — the prose

Each removes the consent gate its skill owns and calls the tool instead. The rules that
must survive verbatim:

- **The terminal producer goes on the row that matches when the job is finished, which
  is the one that reads the status as already `completed`.** This passage has now been
  wrong twice. The first draft named no terminal rule at all. The second named the row
  whose condition is "all questions are `resolved` and `project.status` still `active`"
  — but under the ruling below, `proof-conclusion` makes the write before returning, so
  by the time the router re-queries (which its own first step and the server's injected
  text both require) the status is already `completed` and that row no longer matches.
  The producer would never have fired on the turn the job finished, and the report and
  notification would have been unreachable code.

  So: **the row whose condition is "all questions are `resolved` and `project.status` is
  `completed`" — today a bare `Stop` — emits `hand_back(state: "done")` and stops.** The
  tool's `not_completed` refusal is then unreachable from that row by construction, which
  is the right shape: the refusal exists to catch a `done` claimed from anywhere else.
  The row above it keeps the two-gate verification and becomes the defect-and-resume
  path: when the gates hold but the status is still `active`, it re-invokes
  `proof-conclusion`, the only holder of the grant, rather than writing.

  **The re-announce latch moves to the server, not into prose.** A resumed session on a
  finished project also matches that row and also emits `done`; the router cannot tell
  "just finished" from "finished last week", and asking prose to make that distinction is
  the thing this plan exists to stop doing. Arm 5 renders and notifies **at most once per
  project**, on a stored flag.

  The genuine-blocker stop emits `hand_back(state: "blocked")`. A router that stops
  without either falls to arm 7: a pause, with no report and no notification.
- **PR E applies a ruling that already landed: `proof-conclusion` writes the status,
  not the router.** Lead ruling of 2026-09-01, on the card that merged into issue #2292
  on 2026-09-20 — so this is applying a decision, not taking one. Three planes already
  encode it (the ownership manifest's callers, the writer tool's own comment, and the
  plugin hook's agent-writable sections). The router's frontmatter declares only two read
  tools while its routing row mandates a third, so **the file contradicts itself** — but
  that is a self-contradiction, not an impediment: `allowed-tools` is a grant, not a
  restriction, and no skill declares a deny list, so the router holds the writer tool in
  every environment and the write is executable today. Nothing mechanical stops it; the
  ruling does. **PR E deletes the claim.**

  That fixes the order too: the agent's own step 8 makes the write when all questions
  are resolved, and the router's `hand_back(state: "done")` reads the status through the
  store and refuses `not_completed`, so the tool call necessarily comes after the write
  has landed. The router still evaluates both completion gates first, because the agent
  runs per question and finishes before either.

  The ruling names its own sites: the routing row, the "Writes:" section and
  `allowed-tools` in `research/SKILL.md`, the ownership manifest, the writer tool, and
  the architecture guide — with a grep showing they agree pasted into the PR body. Make
  that grep cover `project.status` **and** `research_append` across the plugin and the
  guide, not just the named rows: two more live sites sit inside `research/SKILL.md`
  itself, one forbidding the write while either gate fails and one in the very "When to
  stop" section PR E is already rewriting for the `blocked` producer.

  Three sites the plan adds: the architecture guide's orchestration **item 4**, which
  still calls this an open question and tells readers not to build a check assuming
  either answer; that guide's direction note keeping the matching unit-suite row blocked
  on the same question; and `question-selection/SKILL.md`'s line saying the router writes
  the status, which belongs to **PR G**, which already holds that slot.

  **One path the ruling does not settle**, and PR E must: `question-selection` returns an
  "objective answered" signal on a question that is already resolved, and nothing states
  who makes the write on that path. Do not invent a mechanism in the PR — raise it on the
  card.
- **The autonomous-mode section changes too — the call is in addition to it, not instead
  of it.** An earlier draft said the call goes outside that section and left it alone.
  That does not work: the section says "keep working in one continuous turn" and calls
  naming a next step and yielding a failure, in the strongest terms the file uses, and
  **every e2e run is autonomous**. Leaving it would mean the corpus can never exercise
  the new boundary, which is exactly what PR C's nudge budget and the hand-back class
  acceptance criterion both assume it will.

  **PR E rewrites all three no-yield sites in that file** — the autonomous-mode section,
  step 3's "Iterate — without yielding" heading and its two closing sentences, and the
  closing paragraph of "When to stop" — to route the yield through the tool rather than
  forbidding it. The plan already carries their mirrors, the architecture guide's
  orchestration items 3 and 5, on this PR's docs list; naming only the section would edit
  the copies and leave two originals standing.

  Paste a plugin-wide grep for the no-yield phrasings into the PR body and **classify**
  every hit outside the router rather than changing it: `record-extraction`'s is the
  batch-is-one-step rule and must not move; `research-plan`'s hand-off row is the
  execution offer PR H owns; `search-records`' three and `search-external-sites`' one are
  leaf-skill offers that "What this plan does not do" deliberately keeps. An unclassified
  sweep is how a PR on a paid slot grows.
- **A batch is one step.** `record-extraction` extracts every queued record in one turn.
  `hand_back` fires once per batch, not once per record. PR I also **re-keys or retires
  the relay-leak validator**: it finds the relayed tail by looking for a `---` separator
  and skips the test when there is none, and the pinned `reply` carries no separator — so
  after PR I it would skip on every run, green-by-skip, on the very PR that changes what
  the router may print. Either key it on the tool's two arguments, or retire it in writing
  because the precondition refuses the same classes at the tool boundary.
- **The first delegation does not ask** (your ruling of 2026-09-09).
- **`routes-to` still passes.** That validator populates its skill list from `Skill`
  calls only, so an MCP hand-back can never enter it. The call must not precede the first
  delegation.
- **Each converted skill declares the tool in its `allowed-tools`.** PR E's whole
  argument against the router writing the status is that its frontmatter grants only two
  read tools; shipping a body that calls `hand_back` while the frontmatter still lists
  two re-creates the contradiction the PR exists to remove, and the allow-list validator
  warns on every undeclared call in the run log the annotation pass reads. Bare names, no
  prefixes. If a paid run shows the schema was never fetched, add a bare-name ToolSearch
  line — never a qualified `select:`.
- **PR G does not touch the `q_001` gloss mandate.** The 2026-09-20 ruling lets `q_` and
  `ps_` pass, so that Present-section sentence stands as written.

**PR I collides with issue #1998**, In Progress on the same slot: its subject is that 23
minutes of silence inside an extraction batch looks like a hang, and this plan's
batch-is-one-step rule is the direct negation of a hand-back per record. They are
reconcilable — the liveness line in PR K1 is what answers a silent batch — but the cards
must be merged or sequenced with that written down.

### PRs K1 and K2 — liveness, the report, the notification

All three are unowned; their predecessor cards were closed not planned on 2026-09-11 and
2026-09-18 in favour of the prototype. **K2 waits for PR E**: arm 5 has no producer until
the router emits the terminal hand-back, so a report and a notification built before that
are unreachable code.

- **Liveness.** The status line is fed only by subagent task events; main-thread tool
  calls produce nothing but a bare elapsed counter. A tool call between steps should
  drive the line. This is also the answer to issue #1998.
- **The final report.** Nothing in the repo renders one. The `project-status` skill's
  user-facing summary is the obvious source.
- **Notification fires from turn-end state, not a poller.** The one existing snapshot
  reader is browser-driven and resumes the sandbox inline, so a timer over it would wake
  every sandbox on a schedule. The server already computes which arm fired; notify from
  there. Name which arms notify: the job ending on arm 5 certainly, and a decision on the
  four silent stops (error, interrupt, pause, no successful call) plus the budget pause,
  each of which leaves a user waiting for a feed that has stopped.

## 5. What this plan does not do

- **It does not touch leaf skills' own offers.** `translation` has a gating validator
  asserting two literal consent offers, and `search-external-sites` asks for repository
  access. Both are correct when the skill is invoked directly. Arm 7 pausing on "no
  successful call" is what keeps them working unchanged.
- **It does not bind the reassigned status write.** After PR E, `proof-conclusion` owns
  it by prose alone: the plugin hook's owned-sections map has no `project` row, and the
  writer tool's completion branch never checks the caller. That is the failure mode this
  plan's own first section is about, now applying to a rule the plan itself relies on.
  Worth a card, not this plan.
- **It does not make the pause ask on Cowork.** Today the ask *is* the literal, and both
  skills that carry it end on `Continue?`. PRs F and G delete it and PR J forbids it, and
  the tool's reply is a statement, not a question. So a Cowork user keeps the stop and
  loses the prompt: they must type unprompted to continue. That is precisely the half of
  Brian's request that survives only on the hosted web, and it is decision 2.
- **It does not add a tree-encoding precondition.** Of the two gates before `completed`,
  only the mentor gate is enforced at the write boundary.
- **It does not retire `--autonomous`.** The flag still branches in five skills and three
  agents, so the e2e corpus continues to measure a regime production never runs. Deleting
  it is five more paid slots on top of this plan's five. The two acceptance criteria below
  measure two different regimes and neither validates the other.
- **It does not build a cost ceiling.** The step budget and the two suppressors are the
  only bounds on an unattended chain; there is no dollar cap anywhere in the control
  plane, and removing the click removes today's brake. The step budget also **resets on
  every real user message**, so it bounds one chain, not a session. The cost chip is
  already shown to every user, not alpha-gated — alpha testers asked to see what they
  are spending.
- **It does not make the feed durable.** The replay buffer is in the sandbox process's
  memory and trimmed at a thousand events, so a long run evicts its earliest paragraphs
  and a restart loses all of them. PR K2's notification can invite a user back to a feed
  whose beginning is gone.
- **It does not change the 1,800-second ceiling or add a heartbeat.** What a crossing
  costs is not a clean checkpoint — see PR D.

## 6. What happens to the open cards

Proposed, not applied. Nothing is edited until you approve.

| Card | Proposal |
|---|---|
| issue #2292 | Retitle and rescope to "retire the literal from the router and the setup skills"; it becomes PRs E–H's wording card. Its 2026-09-09 first-delegation ruling survives intact. |
| issue #1104 | Close as not planned. Its whole subject is a plugin Stop hook enforcing the literal, and the hosted stop is now structural. Note that Cowork keeps prose-grade enforcement of emission. |
| issue #2328 | Already closed as completed on 2026-09-20, by PR #2675 the same day. No action. **Route PR C through its assignee** rather than having a second person rewrite an assigned card's deliverable hours after it landed. |
| issue #2088 | Drop `high-priority` and the UX framing; keep the census for the ADR-0003 injected-context question and the SubagentStop assumptions. Otherwise it silently spends a scarce genealogist sitting on a consumer this plan removes. |
| issue #2493 | Becomes the vocabulary source for `lay-language.ts`. Its 2026-09-20 comment asks whether the rule should bind the writer tools; this plan answers yes for these two and leaves `research_append` open. |
| issue #1998 | Merge with PR I, or sequence with the batch ruling written down. |
| issue #2660 | Its not-planned closure cited the Continue button, which this plan deletes. Worth a comment when PR B lands. |
| PR #2695 | Names PR D's mechanism choice. Not this plan's to change. |
| **new** | File a `nothing-checks` issue in PR B: nothing can prove a paragraph was ever emitted, on any plane. |

## 7. Decisions for the lead

1. **Retiring the literal re-decides your 2026-09-07 ruling and two of the 2026-09-18
   ones** — "the literal stays exactly as ruled", and "every turn is separate; no
   auto-continue", the latter being the Continue button PR B deletes. The other three
   2026-09-18 rulings survive untouched: the relayed summary, per-step granularity, and
   the fixed house style with no interview. The case is above; the ruling is yours.
2. **Brian asked for "a paragraph per step, then ask whether to continue."** This keeps
   the paragraph and replaces the ask with Stop-any-time plus a pause on real questions.
   On Cowork it removes the ask without replacing it, because there is no server to
   continue and the tool's reply is a statement: the user must type unprompted. That
   reading is yours to carry to him.
3. **Stop versus hold**, as in PR B.
4. **One continue mechanism in the prototype**, as in PR D.
5. **The chip row — RESOLVED 2026-09-20: leave it, record the residual.** It is both the
   product's worst lay-language leak and its only main-thread liveness signal, and the
   complaint users actually file is the opposite one — "Are you still working? I don't
   see any activity." Gating it behind the alpha flag that already exists is about twenty
   lines and should follow PR K1's liveness line, not precede it.
6. **`q_` and `ps_` in a user-facing paragraph — RESOLVED 2026-09-20: allow them.** The
   gloss mandate stays; the evidence and the standing caveat are in the vocabulary table.
   PR A2 is unblocked.
7. **`AskUserQuestion` already exists** as a built-in and is named in the packaging
   tests' built-in vocabulary. It appears in 14 committed run logs, 40 occurrences, and
   in two of them the call was **denied** — "Claude Code is running in don't ask mode" —
   with the denial telling the model to route around it. Those runs were not under the
   hosted permission mode, so they bound the question rather than settle it: its
   behaviour in a headless hosted turn is still unmeasured. The plan keeps its own
   `state: "question"` anyway, for the precondition — the built-in validates nothing. The
   server should treat a turn ending on either as a pause.
8. **Five paid runs, one at a time.** The alternative is bundling prose edits into the
   PRs that already hold those slots, which mixes two reviews.

## 8. What would show it worked

- A hosted session whose only input is one objective reaches a logged search, then a
  proof conclusion, with no further typing, and the chat shows one plain paragraph per
  step and no consent prompts.
- The thirteen committed runner tests and the eight turn-queue tests pass unchanged
  through PR I; PR B adds arm tests on the structured outcome; PR J deletes the pattern
  test and the transitional-arm tests and names the replacement that proves each
  suppressor. Breaking any arm or suppressor reds a test at every point in the sequence.
- A two-step run renders two bubbles, not one.
- The e2e nudge report shows silent stops at zero over a named window, with the hand-back
  class non-zero for the first time, and no run hitting the 40-nudge cap.
- The lay-language precondition's refusal rate is stated per vocabulary class over both
  populations — the 2,332 in-repo paragraphs and the 33 hosted sessions — with the 25%
  baseline's shared blind spot named, and every refusal read.
- The lint fails six ways and passes four.
