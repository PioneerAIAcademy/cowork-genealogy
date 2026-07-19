# Enforcing the `image_read` context boundary — plan

> **Status:** proposed (2026-07-16), branch `image-read-context-policy`, merged up
> to main `6829b087` (#715/#712/#714). **Premise probe-verified — see §3.1.** This
> supersedes the framing in `docs/TODOs.md:120-125`, whose central premise — *"no
> environment can currently deny a main session a tool an agent needs"* — is **false
> as written**. It is true of the *allowlist* layer and false of the *hook* layer.
> The consequence is large: this is not an open design question needing a
> per-context policy invention, it is a ~10-line change to a hook that already
> exists, following a denial pattern already shipped in the e2e orchestrator. §3
> records what that inverts, including two corrections to my own earlier framing
> that would have sent an implementer down a wrong path.
>
> **Not to be confused with** `docs/plan/record-extraction-tool-boundary-plan.md`.
> That plan's "tool boundary" is the *shape* seam (tolerant coercion of LLM-authored
> payloads). This plan's boundary is *context* scoping. Different problem, no overlap;
> that plan never mentions `image_read`. The branch name `rx-tool-boundary` refers
> to that one, not this.

## 1. The problem — a crash, not an eval score

`image_read` returns a page scan as inline base64. If it lands in the router's
context, the base64 accumulates and overflows the transport's ~1 MiB per-turn
buffer, **crashing the whole run**:

- `packages/engine/plugin/skills/record-extraction/SKILL.md:70-73` — the reader
  "absorbs the base64 scan in an isolated context… the raw image never enters your
  context (accumulated base64 overflows the transport's ~1 MiB buffer and crashes
  the run)."
- `packages/engine/plugin/agents/image-reader.md:13-16` — "the base64 accumulates
  and… overflows the transport's ~1 MiB per-turn buffer and crashes the whole run."

That is the entire reason the `image-reader` subagent exists. The rule is stated
three times in prose (`SKILL.md:67-73`, `SKILL.md:204`, `image-reader.md`), and
`image_read` is deliberately absent from the skill's `allowed-tools`
(`SKILL.md:21-24`, which declares only `record_read`, `volume_search`,
`research_log_append`).

**Nothing enforces any of it.** The router still calls `image_read` directly —
`eval/runlogs/unit/record-extraction/v1_2026-07-16_20-23-34.json`, post-merge:
"it invoked image_read directly in the main context (first MCP tool call) rather
than delegating to the image-reader subagent."

Prose has failed here repeatedly. Per `docs/skill-lifecycle.md` §5 this is a lane-1
finding: the fix is mechanical, not more prose.

## 2. Why the allowlist can never be the check

`eval/harness/harness/allowed_tools.py:65-68` unions every referenced plugin agent's
frontmatter `tools:` into the **session-wide** allowlist. The skill references
`@plugin:image-reader`; that agent declares `tools: [mcp__genealogy__image_read]`
(`image-reader.md:5-6`); so `image_read` lands in the router's own allowlist.

**This union is correct and must not be removed.** Per-agent `tools:` is
*subtractive*, not an additive grant — an agent's list narrows a set it inherits
from the session, so a tool must be in **both**. Evidence, strongest first:

- Spike-verified in `366a4acd`, the commit that introduced the union: *"agent
  frontmatter `tools:` must use qualified MCP names (`mcp__genealogy__<tool>`);
  bare names leave the subagent toolless."* The per-agent list is consulted and
  restrictive.
- The union's own docstring: *"a delegated agent's MCP calls go through the same
  session allow/deny lists, so they must be in the union or the SDK denies them."*
- Corroborating (provenance noted — read from a sibling TS install, this repo has
  no TS SDK dependency): `AgentDefinition.tools` is documented *"If omitted,
  inherits all tools from parent."*

So the session set is structurally a **superset** of every agent's set. The allowlist
layer cannot express "the agent may, the router may not." That much of the TODO is
correctly diagnosed.

Two further facts that correct the mental model in the TODO:

- On the **unit** path, `allowed_tools` is inert as a gate at all —
  `permission_mode="bypassPermissions"` (`skill_runner.py:239-247, 339`). Enforcement
  is `disallowed_tools = DISALLOWED_BACKSTOP + (all_mock_mcp - allowed_set)`.
- On the **e2e** path, the allowlist is a wildcard: `allowed_tools =
  BASELINE_ALLOWED_TOOLS + ["mcp__genealogy"]` (`e2e/orchestrator.py:620`). e2e
  never exercises the allowlist derivation at all. This matters in §5.

## 3. What is actually available today — the hook layer

`PreToolUseHookInput` carries the missing discriminator. Pinned SDK is
`claude-agent-sdk 0.1.81`; `claude_agent_sdk/types.py:288-305`:

> `agent_id`: Sub-agent identifier. **Present only when the hook fires from inside a
> Task-spawned sub-agent; absent on the main thread.** … When multiple sub-agents run
> in parallel their tool-lifecycle hooks interleave over the same control channel —
> this is the only reliable way to attribute each one to the correct sub-agent.

The comment immediately above that class settles the obvious worry — *"The four
tool-lifecycle types below are the only ones the CLI actually populates"* — and
PreToolUse is one of the four.

Everything needed is already wired:

- Both harnesses register a **catch-all** PreToolUse hook:
  `skill_runner.py:343` (`HookMatcher(matcher=None, hooks=[pretool_hook])`) and the
  equivalent in `e2e/orchestrator.py`. Every tool call already passes through.
- The e2e hook **already denies per-call**: `is_blocked_tree_tool` at
  `e2e/orchestrator.py:487-512`, returning a `hookSpecificOutput` denial. Its comment
  states the principle we need verbatim: *"the integrity block is enforced in the
  hook, not the allowlist, so it can deny per-call with arguments."*
- `agent_id` is used **nowhere**: `grep -rn "agent_id" eval/harness/` (excluding
  `.venv`) returns zero hits.

So the per-context policy the TODO asks us to design already exists one layer down.
The accurate framing: **unavailable in the allowlist layer (correctly diagnosed),
available in the hook layer (missed).**

### 3.1 Probe result — verified here, not inferred (2026-07-16)

The type comment claims the CLI populates tool-lifecycle hooks; a throwaway probe
confirms it in *this* repo, against the pinned CLI + SDK 0.1.81. The probe staged a
`probe-reader` subagent (`tools: [Read]`), had the router read a file itself, then
delegate the same read. Every PreToolUse firing:

| Tool call | `agent_id` | `agent_type` |
|---|---|---|
| `Read` — router | **absent from the key set** | — |
| `Agent` — the delegation itself | absent | — |
| `Read` — inside the subagent | `a0307acf2508a8c2d` | `probe-reader` |

Three findings that shape §4:

1. **`agent_id` discriminates cleanly.** Main-thread and subagent calls to the *same*
   tool are distinguishable with certainty.
2. **The field is omitted, not null.** On the main thread `agent_id` is absent from
   `input_data.keys()` entirely — so `"agent_id" not in input_data` is the correct
   predicate, not a truthiness check.
3. **The delegation tool surfaces as `Agent`, not `Task`,** and is itself a
   main-thread call (no `agent_id`). A predicate that keyed on tool name would have
   to know this; keying on `agent_id` presence sidesteps it.

The probe was a throwaway (deleted after), matching the precedent set by `366a4acd`.

### Corrections to the earlier framing

Recorded because both would have misdirected an implementer:

1. **"Fix the union so the harness mirrors production" — wrong.** The union is
   required (§2). Removing it makes the image-reader toolless, which `366a4acd`
   already demonstrated empirically.
2. **"Precedent: split tools again" (per `docs/TODOs.md:104-113`) — unnecessary.**
   Tool-splitting was the right lever for per-*op* authority within one tool. This is
   per-*context* authority over a whole tool, and the hook expresses it directly.

### Considered and rejected: `subagent_capture.py`

`43ec2480` (#710) added per-subagent capture and looks adjacent, but it is the wrong
lever: it is **e2e-only**, **best-effort by design** (`collect_subagents` returns `[]`
on any failure — a missing cache dir is indistinguishable from "the subagent never
called `image_read`", i.e. it fails **open**), records **tool names only**, and covers
**subagents only** — it can confirm the reader *did* call `image_read`, never that the
router *didn't*. It also reads the ephemeral SDK cache, which
`harness/orchestrator.py:634` `rmtree`s via `cleanup_session_store(workspace)`. The
hook is synchronous, fails **closed**, and works under parallel subagents.

## 4. The change — IMPLEMENTED

`eval/harness/harness/context_policy.py` is the shared home (e2e imports from
`harness.*`, never the reverse). It exposes `SUBAGENT_ONLY_TOOLS = {"image_read"}`,
`subagent_only_violation(input_data)`, and `subagent_only_denial(bare)`. Both existing
`pretool_hook`s call it before their budget counters — a denied call never runs, so it
must not consume the budget (the ordering the e2e tree-block already uses).

**Key on `agent_id` presence, not `agent_type`.** `agent_type` is *also* present on the
main thread of a session started with `--agent` (without `agent_id`), so an
`agent_type`-keyed predicate would misread such a session as a subagent. Presence, not
truthiness: the field is omitted on main rather than set to None (§3.1).

The denial carries **no `stopReason`** — a denied call is recoverable, and the run must
continue so the router can pivot to delegating (matching the tree-block). The reason
text is the model's only feedback, so it names the fix.

Recorded on `SkillRunResult.blocked_context_calls` and handed to validators. Because
the hook blocks the call, it never reaches `tool_calls` — nor the judge, which is fed
`result.tool_calls` (the mock's log). So the validator is the *only* thing that can see
a violation, which is exactly why routing moved out of the judge's scope.

The raw list is deliberately **not** added to the run-log JSON: a violation already
surfaces there through the validator's failure message (which names the offending
tools and call count) and hard-fails the run, so a new schema field on
`run-log.schema.json` and its `packages/schema` mirror would buy nothing.

**Verification — both directions exercised against the real SDK, not asserted:**

- **Positive control (does it deny?).** With the policy temporarily pointed at `Read`,
  a main-thread call was denied while the same tool succeeded inside the subagent, and
  the model read the refusal and pivoted to delegation on its own. This is what proves
  the denial payload actually blocks; the unit tests only cover the predicates, and
  ut_015 passes when the router behaves, so it never exercises the deny path.
- **Negative control (does it stay out of the way?).** `ut_record_extraction_015` with
  the guard live: **pass**, 10 turns, `image_read` reached the mock
  (`matched: predicate`) and `test_no_main_thread_subagent_only_calls` passed. Since
  record-extraction does not declare `image_read`, a main-thread call would have been
  denied and never reached the mock — so that call necessarily came from inside the
  subagent. The delegation path is unbroken.
- **Unit tests.** `eval/harness/tests/unit/test_context_policy.py` — including the
  traps: `agent_type`-without-`agent_id` must still be a violation; the `Agent`
  delegation call itself must NOT be; `declared_tools=None` must fail closed; and two
  tests pinned to the real SKILL.md files (§4.1).

**Drive-by consolidation.** `bare_tool_name` already had two copies
(`e2e/orchestrator.py`, `e2e/subagent_capture.py`) before this needed a third, so it
moved to `context_policy` and `e2e/orchestrator.py` re-exports it under its old private
name. Semantics preserved exactly — including the split on any `__` rather than only an
`mcp__` prefix — so existing callers and `tests/unit/test_e2e_tree_block.py` are
untouched. `subagent_capture.py`'s copy is left alone (different concern, out of scope).

### 4.1 The guard is per-skill, and unit-only — both forced by `search-images`

The first cut of this policy was **global**: deny `image_read` on the main thread,
always. That was wrong, and would have broken a shipping skill.

**`search-images` declares `image_read` in its own `allowed-tools`
(`search-images/SKILL.md:20`) and calls it directly** — "### 4. Browse with
`image_read`", paging through a volume one image at a time. It never references
`image-reader`. A global guard denies every one of those calls and the skill stops
working.

So the discriminator is the skill's **own declaration**, which is already in the repo
and needs no new list:

> **You may call what you declared. You may not call what was granted only to your
> subagent.**

| Skill | Declares `image_read`? | Main-thread call |
|---|---|---|
| `search-images` | yes (`:20`) | **allowed** — browsing is the skill |
| `record-extraction` | no — holds it only via `@plugin:image-reader` | **denied** |
| `research` | no (its `image_read` mention is prose in a routing table) | n/a |

`allowed_tools.declared_skill_tools()` returns the pre-union set;
`subagent_only_violation(input_data, declared_tools)` requires all three of: guarded
tool, main thread, **not declared**. `declared_tools=None` fails **closed** (treated as
declaring nothing). `tests/unit/test_context_policy.py` pins this against the *real*
SKILL.md files, so dropping either declaration fails loudly rather than silently
breaking browsing or silently un-guarding the router.

**And this is why the guard is unit-only.** The e2e orchestrator *cannot* apply it:
sub-skills run in the **same session** via the `Skill` tool (no `agent_id` to attribute
them), and e2e's allowlist is the `mcp__genealogy` wildcard, so a legitimate
`search-images` browse and a `record-extraction` router violation are **indistinguishable
at the hook**. `/research` does route to `search-images`
(`research/SKILL.md:118`), so enforcing there would deny real browsing mid-run. The unit
harness has no such ambiguity — one skill per test, known up front. The e2e hook carries
a comment recording this rather than a check.

**Open consequence worth a second look (not fixed here):** `search-images` browses many
pages in one main-session context, which is precisely the "accumulated base64" pattern
§1 says overflows the buffer and crashes the run. Either it is exposed to the same
crash, or the crash needs more than one image to trigger and the record-extraction
rationale is overstated. Both readings can't be right. That is a genuine question about
`search-images`' design, not something this plan should decide unilaterally — filed in
`docs/TODOs.md`.

## 5. The open question this does *not* answer — production

The hook covers the **harness**. Production Cowork has no eval hook, and §1's crash is
a *production* failure mode. Because per-agent tools are subtractive (§2), production
is in one of two states — **both bugs, in opposite directions**:

- **(a)** Cowork's session set for this skill honors `allowed-tools` and excludes
  `image_read` → the image-reader subagent cannot call it either → **image reading is
  broken in production today.**
- **(b)** Cowork grants a broader set → the router can call `image_read` → **the crash
  is reachable by real users.**

e2e cannot distinguish them: its allowlist is the `mcp__genealogy` wildcard
(`orchestrator.py:620`), so it never exercises production's derivation. Settling this
needs a live Cowork observation, not a repo read — run the record-extraction skill in
Cowork against an image ARK and observe whether the subagent's `image_read` succeeds.
That experiment is cheap and should precede any production-side fix.

## 6. ut_015 is evidence, not the metric

`eval/tests/unit/record-extraction/positive-extract-and-route-image-ark.json`
(`ut_record_extraction_015`) grades this rule, but only stochastically via
`judge_context`. **On the current committed runlog it is a clean pass** —
`v1_2026-07-17_00-10-25.json` (`releasable: true`), all six dimensions at 3.

**That is not evidence the boundary holds.** It means the router *didn't* violate in
that run, not that it *can't*. The violation was observed as recently as
`v1_2026-07-16_20-23-34.json` ("it invoked image_read directly in the main context
(first MCP tool call) rather than delegating"), and nothing since has changed the
enforcement path — #711/#715 touched the shape seam and classification grading, never
`pretool_hook` or `allowed_tools.py`. A green ut_015 and a reachable crash are fully
compatible.

The earlier 8-run spread (5 pass / 3 partial, 2026-07-16 17:16→21:39) is superseded by
#715's craft and variance work, but its structural lesson stands and is worth keeping:
across those runs the violation and the outcome were **decoupled** — run 20-51 passed
*while delegating correctly*, run 20-23 partialed *while violating*, and the other two
partials had unrelated causes (`informant_proximity` craft, `docs/TODOs.md:128-139`; a
`tree_edit` `nameForms` shape retry). The test detected the violation roughly 1-in-8.

#712 pinned the unit judge to `temperature=0` (`judge.py`, `JUDGE_TEMPERATURE`). That
removes judge-variance from the residual, which **sharpens** the case rather than
weakening it: whatever routing flap remains is now purely stochastic *skill* behaviour
— precisely the thing a judge cannot be relied on to catch and a hook catches every
time.

**Therefore: "ut_015 passes" is not the acceptance test, and neither is "ut_015 stops
flapping."** The acceptance test is the deterministic denial in §7. The hook assertion
replaces judge-grading of routing entirely; ut_015's residual flap belongs to the craft
and shape lanes.

## 7. Sequencing and DoD

1. ~~**Probe first.**~~ **DONE (§3.1)** — `agent_id` confirmed present on subagent
   calls, absent on the main thread, under the pinned CLI + SDK 0.1.81. The
   `parent_tool_use_id` fallback (`types.py:1029`) is **not needed**; noted only in
   case a future SDK bump regresses the field.
2. ~~Wire the denial into the **unit** hook.~~ **DONE** — `skill_runner.py`, recorded
   on `SkillRunResult.blocked_context_calls`.
3. ~~Wire the same into the **e2e** hook.~~ **DROPPED, deliberately** — e2e cannot
   attribute a call to the active skill, so it cannot tell a legitimate
   `search-images` browse from a router violation. Enforcing there would break real
   browsing. Reasoning + the comment left at the call site: §4.1.
4. ~~Drop routing from ut_015's judge grading; assert on the recorded field instead.~~
   **DONE** — the universal validator `test_no_main_thread_subagent_only_calls`
   (`validators/test_universal.py`) fails the test on any violation, and
   `_compute_outcome` hard-fails on a failed validator (`if not validators_passed:
   return "fail"`). So detection goes from ~1-in-8 to 100%. ut_015's `judge_context`
   now tells the judge routing is out of its scope, while keeping the two guards no
   hook can see (unreachable-without-trying; ARK→imageId conversion). This **extends
   an established pattern rather than inventing one** — see §9.
5. **OPEN** — answer §5 by live Cowork observation; file whatever it turns up as its
   own issue. This is the part that can crash a real user's run.

**DoD:** a router-side `image_read` call is denied and recorded **in the unit harness**,
with no judge involvement (**met**, verified live per §4); a subagent-side call and a
declaring skill's direct call are unaffected (**met**, §4.1); §5 answered and filed
(**open**). The original DoD said "both harnesses" — §4.1 retires the e2e half as
unattributable rather than leaving it silently unmet.

## 8. Risks

- ~~**`agent_id` doesn't populate in practice.**~~ **Retired by the §3.1 probe.**
  Residual: a future SDK/CLI bump could regress the field. Cheap guard — the probe is
  ~90 lines and re-runnable; `parent_tool_use_id` remains the fallback.
- **Denying the router changes run outcomes.** A denied call is a *new* failure path.
  The e2e precedent returns no `stopReason` and lets the run continue; match that, so
  the router pivots to delegation rather than dying.
- **Fixing the harness masks production.** The hook makes the harness safe while
  leaving §5 live. Do not let a green harness close this out — §5 is the part that can
  crash a user's run.
- **The exemption encodes "declared = intended", not "declared = safe."** §4.1 lets
  `search-images` call `image_read` on the main thread because it declared the tool.
  If that skill turns out to have the same base64 exposure (open question, filed in
  `docs/TODOs.md`), the guard is currently waving it through by construction. The
  exemption is right for *this* change — it preserves shipping behaviour and the guard
  is not the place to relitigate another skill's design — but it is not a safety
  judgement about `search-images`.
- **A denied call is new behaviour on a path that used to succeed.** The router now
  gets a refusal it never got before. The live probe showed the model reading the
  reason and pivoting to delegation, and the denial carries no `stopReason` so the run
  survives — but this is a real behavioural change to every record-extraction run that
  touches an image, and the first full-suite run after it lands deserves a look rather
  than a rubber stamp.

## 9. Precedent, and docs to fix alongside

**Step 4 extends an established pattern.** #715 introduced deterministic-over-judge
grading for classification — `expected_classifications` (`docs/specs/unit-test-spec.md`
§5.10): a mechanical validator owns what doctrine fixes deterministically, and the
judge is *deferred to* only where genuine ambiguity remains. It goes further than
we need to here, with **deterministic-validator deference**: when the mechanical check
passes, the harness floors a judge `1` to `2` so "a fuzzy re-grade must not override a
deterministic check that already confirmed the classification"
(`orchestrator.apply_deterministic_deference`, `harness/orchestrator.py:751`). That
retired the recurring census direct/indirect judge-inversion flap.

Routing is a *better* fit for that treatment than classification is: it is not merely
doctrine-fixed but **mechanically observable at call time**, so it needs no deference
ladder — the hook simply denies. Frame step 4 as extending §5.10's pattern to routing,
and cite it rather than re-arguing the philosophy.

Docs to fix:

- `docs/TODOs.md:120-125` — rewrite; its premise is falsified (§3, probe-verified in
  §3.1). Keep the item open for §5, re-scoped to production.
- `docs/specs/unit-test-spec.md:1529-1542` — stale (line refs shifted ~+14 by #715's
  §5.10 insertion; verify before editing). Its `compute_allowed_tools` pseudocode is
  `return baseline + declared` — missing **both** the agent-union step
  (`allowed_tools.py:65-68`) and `Task`, which the implementation's baseline now
  includes ("Task always — plugin subagents are staged into every workspace").
- `docs/specs/image-reader-agent-spec.md:129-134` — stale: claims the path is "not
  unit-testable" because `Task` is backstopped. `Task` is in the baseline, and
  `DISALLOWED_BACKSTOP` is only `["Bash", "WebFetch", "WebSearch", "NotebookEdit"]`.
