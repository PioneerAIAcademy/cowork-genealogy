# Research Guardrail Bypass — Plan

**Project:** Cowork Genealogy — `/research` orchestration
**Status:** DRAFT, for review (engineering) — adversarially reviewed once;
findings incorporated, see §8.
**Goal:** Close the structural gap that lets autonomous `/research` silently
bypass `research-exhaustiveness`, `proof-conclusion`, `person-evidence`, and
`conflict-resolution` — the four sub-skills that own GPS tier/exhaustiveness/
identity/conflict judgments — without waiting on a full agent-architecture
rewrite that a separate investigation (issue #702) shows is not free.
**Companion work:** `docs/specs/research-append-tool-spec.md` §11 (the
`extraction_append` lane-gating precedent this plan extends, and §11.4's
"What this does not fix," which already named this exact gap and predicted
prose wouldn't hold it); `docs/diagnoses/wilkins-death-kentucky-headless-runs2-3.md`
(prior instance: `person-evidence` silently skipped, fixed with prose that
later re-broke); `CLAUDE.md` "Cowork plugin agents" → "No playbook/reference
files for agents" (issue #702, closed not planned 2026-07-27); `docs/TODOs.md`
"Router-side (main-thread) lane enforcement," "match_score remains fabricable
by person-evidence," "The router substitutes for a denied subagent tool"; PR
#893 (`e2e-John-Richardson`, the john-richardson-parents fixture that surfaced
this).

---

## 1. Problem

PR #893's `john-richardson-parents` fixture captures a real headless run in
which `proof-conclusion` selected a tier and wrote a `narrative_markdown`
claiming the case was "proved" and "reasonably exhaustive" while
`exhaustive_declaration.declared` was `false` and plan items were still open —
directly contradicting the project's own recorded state. The mother (Mary
Mallalieu) was left identified only as "Mary," maiden name unestablished,
under a conclusion that claimed the opposite.

The PR author traced this to autonomous `/research` bypassing the four GPS
guardrail skills: interactively (Cowork), `research-exhaustiveness` is
invoked correctly; headless, it and the other three guardrail skills are
sometimes not invoked as `Skill` calls at all. A prose fix — a "MANDATORY...
invoke the skill, never a generic subagent" contract added to
`research/SKILL.md` — was tried and produced an identical bypass on re-run.

Investigation (this thread) found the bypass takes two distinct shapes in
committed e2e runlogs (`eval/runlogs/e2e/wilkins-death-kentucky/run-2026-07-17_00-16-59.{json,transcript.md}`):

- **Read-and-improvise:** the orchestrator `Glob`/`Read`s the target skill's
  own `SKILL.md` off disk, then does the work itself inline via
  `research_append` — no `Skill` call, no `Agent`/`Task` call at all
  (transcript lines 968–1058).
- **Untyped subagent:** an `Agent` call with no `subagent_type` key and a
  hand-written prompt standing in for the skill (tool_calls[44]).

Corpus-wide, all four guardrail skills are invoked correctly *most* of the
time (`research-exhaustiveness` 79×, `proof-conclusion` 58×, `person-evidence`
90×, `conflict-resolution` 4× across the runlog corpus) but the bypass recurs
in ~23 of ~50 committed e2e runs and clusters late in long runs (47–81% of
the way through), suggesting a context-pressure correlation, not a rare
fluke.

## 2. Root cause

Nothing in the current architecture mechanically prevents the orchestrator
from doing a guardrail skill's job itself. Specifically:

- **`allowed-tools:` frontmatter is not enforced in the e2e/headless path.**
  `research/SKILL.md` declares `allowed-tools: [validate_research_schema]` —
  by its own contract the orchestrator should be unable to call
  `research_append` directly — but `eval/harness/e2e/orchestrator.py:738`
  grants the entire `mcp__genealogy` wildcard to the whole session for the
  full run. The only place `allowed-tools` becomes a real SDK allow/deny list
  is the isolated unit-skill harness (`harness/allowed_tools.py` →
  `harness/skill_runner.py`), and it has never been pointed at `research`
  itself (no unit-test scenario exists for the orchestrator).
- **There is no way to attribute a tool call to "which skill is currently
  active" in a shared session.** The SDK's only context-scoping primitive is
  `agent_id`, present on `PreToolUseHookInput` only inside a `Task`-spawned
  subagent. A `Skill`-tool invocation runs inline in the same session with no
  `agent_id` — indistinguishable, at the tool-call layer, from the
  orchestrator doing the work itself. `context_policy.py`'s own docstring
  says as much: it can guard `image_read` only because that check keys on
  `agent_id`, and states plainly it cannot generalize to sub-skills invoked
  via `Skill`.
- **This is a known, previously-named gap, not a new discovery.**
  `research-append-tool-spec.md` §11.4 already predicted it: *"The router
  (main thread) is unrestrained in production... nothing stops the router
  from writing `person_evidence` itself... The mitigation is prose... the
  instrument if it recurs is a `context_policy` PreToolUse rule keyed on
  `agent_id`, which is eval-only."* The `wilkins-death-kentucky-headless-runs2-3`
  diagnosis shows the identical failure for `person-evidence` alone, fixed
  with routing-table prose that this investigation confirms still fails in
  later runs. PR #893's prose fix for the other three skills is the same
  remedy, applied again, with the same result.

Prose fixes keep failing here for a structural reason: the party being asked
to self-police ("invoke the skill, never a generic subagent") is the same
party whose behavior degrades under the exact condition (long-run context
pressure) that produces the bypass.

## 3. Options considered and set aside

**Full agent conversion of the four skills** (gets a real `agent_id` for hook
enforcement, isolates context growth) was the initial candidate fix but is
not adopted here. All four skills have mandatory on-demand `Read` of their
own `references/*.md` (research-exhaustiveness, proof-conclusion,
person-evidence, conflict-resolution all instruct "read `references/X.md`
before/when Y"). Issue #702 measured that pattern as unreliable *and silent*
when done from an agent: across a `record-extraction` playbook experiment
with the files provably reachable, the agent read the reference on some
tests, ignored it on others (falling back to a degenerate default), and
over-applied it on others — pass rate 6/19 against a 12–14/19 baseline. The
only fix CLAUDE.md sanctions is full inlining, no on-demand `Read`, no
build-time assembly ("the prompt is the product"). Inlined, `research-exhaustiveness`
(413 lines) and `proof-conclusion` (509 lines) are comparable to existing
agent bodies (`gps-mentor` 635, `record-extractor` 818); `person-evidence`
(941) and `conflict-resolution` (1006) would each be the largest agent body
in the plugin. Given that cost is concentrated on the two skills that fire
most often per run (person-evidence ~90×, conflict-resolution far less but
carries its own identity-safety doctrine), this plan defers agent conversion
rather than bundling it with an urgent fix. See §5.

**`caller_id` as a tool-call argument the orchestrator/skills set
themselves** was proposed and rejected. A self-reported field is filled in by
the same untrusted party whose behavior we don't trust at the moment it
matters — there is nothing checking it against what actually happened. This
codebase has direct precedent for exactly this failure: `person-evidence`'s
`match_score` was meant to attest that `same_person` was consulted; a
provenance guard for it was designed and cut in #695 with "zero observed true
positives... against a real false-positive class" (`docs/TODOs.md`). The
fix below achieves the same *intent* — a caller-id — by having the harness
infer and track it itself, never the model.

**Splitting each guardrail skill's writes into its own MCP tool**
(`proof_conclusion_append`, `exhaustiveness_declare`, `person_evidence_link`,
`conflict_resolve`, mirroring `extraction_append`'s split from
`research_append`) was raised as a strong idea but scoped out of this plan.
It doesn't attribute anything by itself in a shared session — a split tool
is exactly as callable by the orchestrator as the section-branch version is
today — so it's a multiplier on the fix below, not a substitute. It is a
near-prerequisite if the deferred agent conversion in §5 ever happens
(`disallowedTools` enforcement, which binds even under `bypassPermissions`,
is tool-name-granular only). Tracked as its own investigation in
`docs/TODOs.md` rather than committed here.

## 4. Recommended changes

### 4.1 Caller-id enforcement hook (harness-tracked, not model-supplied)

Add a session-scoped tracker to the `PreToolUse` hook (`eval/harness/e2e/orchestrator.py`'s
existing `pretool_hook`, ~lines 596–684, which today only enforces
`BLOCKED_TREE_TOOLS`, fixture `blocked_tools`, and the tool-call budget cap).
**Implementation prerequisite:** the hook currently early-returns for any
non-`mcp__`-prefixed tool name, so a `Skill` call never reaches the hook body
today — this needs restructuring, not just an added branch.

- On every successful `Skill` tool call, record `(skill_name, question_id if
  derivable, call_index)`. Gate "successful" on the tool result, not just the
  call — an errored/degraded `Skill` invocation must not open the window,
  otherwise "invoke the skill, have it fail, finish the write inline anyway"
  evades both this hook and §4.4's detector at once (a `Skill` call really
  is present in the log in that sequence). This requires hooking
  `PostToolUse` in addition to `PreToolUse` to observe the result.
- Key the window by `(skill_name, question_id)` where a question id is
  derivable from the call args, not by `skill_name` alone — a bare
  skill-name window means `Skill(proof-conclusion)` for question A can leave
  the window open long enough for an unguarded inline write on question B in
  a multi-question project (the normal case, not an edge case). Where a
  question id genuinely can't be extracted from a given write's args, fall
  back to the global per-skill window and accept the imprecision (documented
  in §6, not silently).
- On every write that touches a protected field — see the expanded list
  below — check that the matching skill was invoked (successfully, for the
  same question where keyed) within a generous trailing window of tool calls
  (size TBD — tuned empirically against the runlog corpus, using §4.4's
  "was this skill invoked" logic as the measurement tool; see §7). Reject
  otherwise, naming only the required skill (same narrow error-contract
  style as `extraction_append`'s lane gate: name what's required, not a
  routing map).
- **Protected fields, expanded.** The original list (`proof_summaries.tier`,
  `person_evidence`, `conflicts`, `exhaustive_declaration.declared: true`)
  covers `research.json` only and misses each guardrail skill's actual
  documented output on the *tree* side, which is a live bypass route right
  now, independent of everything else in this plan:
  - `materialize_facts` can create a new tree person and attach facts to it
    without any `person_evidence` entry existing — an identity-bypass route
    that doesn't go through `person-evidence` at all, so watching only
    `research.json`'s `person_evidence` section misses it entirely.
  - `proof-conclusion/SKILL.md`'s own Tree-encoding gate says a conclusion
    isn't complete until it's reflected in `tree.gedcomx.json` (`primary:
    true` on the concluded fact, the `ParentChild`/`Couple` relationship) —
    calling a conclusion whose tree-side write never happened "incomplete."
  Add `tree_edit`/`tree_correct`/`materialize_facts` calls that set `primary:
  true`, add a `ParentChild`/`Couple` relationship, or create a new tree
  person to the watched-writes list, gated the same way as the
  `research.json` fields above.
- Port this to the hosted/production path (`apps/server/app/agent/real_agent.py`),
  not just eval. `docs/TODOs.md`'s "Router-side" note already flags that the
  analogous `context_policy.py` guard is eval-only and doesn't cover Cowork
  or hosted; this plan explicitly commits to not repeating that limitation
  for this gate.
- **Rollout: ship in shadow mode first.** Log rejections without denying,
  against both the historical runlog corpus and a batch of live runs, and
  measure the false-positive rate (a legitimate write the window should have
  covered but didn't) before flipping to hard-deny. See §6 for why this
  matters — a mistuned window turns a silent quality bug into a loud
  availability regression, which is a worse failure mode than the one this
  plan is fixing.

This closes both observed bypass shapes (untyped-`Agent` substitution and
read-and-improvise), since neither sets the tracked state. It is a recency
heuristic, not a cryptographic guarantee — see §6.

### 4.2 Mechanical cross-field validation at the write boundary

Add a validation rule (`packages/engine/mcp-server/src/tools/research-append.ts`
/ wherever `proof_summaries` writes are validated): a `tier` of `proved` or
`disproved` is rejected unless the referenced question's
`exhaustive_declaration.declared == true` in the pre-write state.

**Must check against state as of the start of the call, not the end —
`research_append`'s batch form is a real hole here, not a theoretical one.**
`research-append.ts`'s batch loop (~lines 1449–1471) mutates one shared
in-memory document sequentially across `ops[]` and validates the *final*
state once, after every op has applied. As written, a single batch call
could set `exhaustive_declaration.declared: true` (with a `stop_criteria`
whose *content* is unchecked, and `log_entry_ids` never cross-checked
against real `log[]` entries) and `tier: "proved"` **in the same call**, and
the rule above would see a document where the declaration is already `true`
by the time it checks — self-satisfying its own precondition inside one
atomic write. The rule must diff against the document state as it existed
**before this call/batch started**, and reject a batch that both establishes
the declaration and consumes it for a tier in the same call. This also means
the fix only catches the literal PR #893 shape (declaration left `false`)
unless this ordering check is included — without it, a bypassing orchestrator
simply adds one more op to its already-improvised batch and the gate does
nothing.

Content-level validation of `stop_criteria` and `log_entry_ids` (confirming
the declaration is actually backed by real, referenced log entries, not just
present-and-non-empty) is a related, deeper gap this rule does not close —
flagged here, not fixed here.

This is caller-agnostic — it holds regardless of whether the caller is the
main thread, an in-session `Skill`, or a future agent — so it doesn't depend
on §4.1 at all and should ship independently, first if possible.

Out of scope for this rule: detecting overclaiming *language* in
`narrative_markdown` text (e.g., "reasonably exhaustive" prose when the tier
doesn't support it). That remains `gps-mentor`'s proof-critique job — see
4.4's note on verifying that gate actually fires.

### 4.3 Revoke `Write`/`Edit` on `research.json` and `tree.gedcomx.json`

No skill's `allowed-tools` lists bare `Write`/`Edit`, and `research/SKILL.md:167-170`
already prose-forbids direct writes to these files ("all writes go through
the writer tools"). No legitimate use was found. Add both file paths to
`disallowed_tools` for the e2e harness and, for parity, the hosted path (via
an explicit deny if the SDK supports path-scoped denial, otherwise a
`PreToolUse` check on `Write`/`Edit` calls whose `file_path` matches either
file). Low cost, no known workflow breakage — ship immediately, independent
of the rest of this plan.

**Scope this correctly: it's hygiene, not a fix for the observed bypass.**
Both bypass shapes documented in §1 write via `research_append`, never via
raw `Write`/`Edit` — this closes a theoretical escape hatch that hasn't been
observed in the corpus, not the mechanism actually causing PR #893's bug.
Worth doing regardless, but §4.1/§4.2 are the real gates.

Explicitly **not** in scope: revoking `Read` on these files. `research_query`
covers only 11 of `research.json`'s ~15 top-level sections (missing
`project`, `researcher_profile`, `known_holdings`, `localities`), caps
results at 50 items with no pagination, and there is no MCP tool that reads
`tree.gedcomx.json` at all (`person_read` hits the live FamilySearch API, a
different data source entirely). Closing that gap is a real build project of
its own — extend `research_query`, build a new `tree_read` tool — not a
config change, and is not scoped into this plan.

### 4.4 Extend the e2e hard detector

The isolated unit harness already fails a positive test when a skill's
effect is present but the skill was never invoked
(`eval/harness/tests/unit/test_orchestrator.py::test_positive_fails_when_skill_not_in_skills_invoked`).
The e2e path has no equivalent (`skills_invoked` has zero hits across
`eval/harness/e2e/{orchestrator,judge,result}.py`). Add one: post-run, for
each of the four guardrail skills, if the final project state shows an
effect attributable to it — a `research.json` `proof_summaries` entry,
`person_evidence` link, `conflicts` resolution, or
`exhaustive_declaration.declared: true`, **or** (per §4.1's expanded
protected-fields list) a `tree.gedcomx.json` write it's the documented
owner of (a new tree person or attached fact with no backing
`person_evidence` entry; a `primary: true` fact or `ParentChild`/`Couple`
relationship with no matching `proof-conclusion` tier-≥-probable
conclusion) — with no matching successful `Skill` call anywhere in the run's
tool-call log, hard-fail the run regardless of judge/validator verdict. This
check must inspect **both** project files, not `research.json` alone —
watching only `research.json` misses the `materialize_facts` identity-bypass
route §4.1 identifies.

Also check that the `gps-mentor` proof-critique gate actually fired for
every `ps_id` a resolved question references — not just that
`research/SKILL.md`'s routing table calls it mandatory. That gate is
nominally the last line of defense against exactly this bug (its own
description: "specifically designed to catch... a tier claim the cited
assertions don't support"), and its invocation is exposed to the same
"orchestrator skips a routing-table step under context pressure" risk as the
four skills this plan is about. Not confirmed as having actually happened in
any runlog — flagged as a risk to check, not a proven instance (see §6).

## 5. Deferred (not in this plan)

- **Agent conversion of `research-exhaustiveness`/`proof-conclusion`** — the
  two cheap-to-inline candidates (413/509 lines fully self-contained,
  comparable to existing agent bodies). Revisit if §4.1's hook proves to have
  practical gaps. Treat `person-evidence`/`conflict-resolution` as a separate
  decision given their inlined size (941/1006 lines) would set a new
  high-water mark for the plugin.
- **Thin-agent-calls-`Skill`** — untested variant where a fresh-context agent's
  only action is `Skill('<name>')`, keeping substantive content in SKILL.md
  as the single source of truth. Plausible because the record-extractor
  playbook failure was a *conditional, secondary* fetch, whereas this would
  be *unconditional and first* — but unverified, and the SDK mechanism for
  granting a subagent `Skill` access (`AgentDefinition.skills`) is not
  currently surfaced anywhere in this repo's agent `.md` frontmatter format.
  A small controlled experiment (cheaper than #702's) should precede
  committing to it.
- **Per-skill write tools** — tracked as its own `docs/TODOs.md` investigation
  (added by this plan); worth doing if/when one of the four is ever
  converted to an agent, not worth it standalone.
- **Full `research_query`/`tree_read` coverage** to allow revoking `Read` on
  the two project files — real value, real build cost, not scoped here.

## 6. Open questions / risks

- **§4.1's recency window is a heuristic, not a guarantee.** A model that
  invokes the correct `Skill` and then does something unrelated to it while
  the window is still open would incorrectly pass. Window size needs
  empirical tuning against the existing runlog corpus (generous enough to
  cover a skill's legitimate multi-step work, tight enough to mean
  something) before shipping.
- **Untested assumption baked into the current architecture, not just this
  plan's fix:** whether `Skill`-tool content injection is more reliable than
  an agent's on-demand `Read` for a skill's *own* nested `references/*.md` is
  not verified — proof-conclusion, research-exhaustiveness, person-evidence,
  and conflict-resolution all do this today, in-session, and it has never
  been stress-tested the way #702 tested the agent case. A regression here
  would look identical to the original bug and would not be caught by
  anything in this plan except §4.4's detector (which catches "skill never
  invoked," not "skill invoked but its own reference silently skipped"). Worth
  a dedicated experiment mirroring #702's reachable/unreachable methodology
  against the in-session path.
- **Whether `gps-mentor`'s own gate is itself skippable** the same way the
  four guardrail skills are — §4.4 adds detection, not prevention, and no
  runlog evidence was checked to confirm or rule this out.
- **§4.1's false-positive risk, not just its false-negative risk.** A window
  that's too tight can hard-deny a legitimate write — turning today's silent
  quality bug into a loud availability regression, which is a worse outcome
  for a shipped feature than the bug this plan fixes. A denial that steers
  the model toward actually invoking the missing skill is fine in principle
  (arguably the intended effect), but a mistuned window risks a stuck loop —
  the model re-invoking a skill repeatedly without the write ever landing,
  especially interacting with headless runs' existing stall/budget-cap
  machinery, which was not checked against this risk. §4.1's shadow-mode
  rollout is the mitigation; do not skip it.
- **Batch semantics beyond the §4.2 TOCTOU fix.** §4.2's fix addresses one
  same-call ordering hole (declaring exhaustiveness and consuming it in one
  batch); it was not exhaustively checked for other same-batch orderings
  that could similarly self-satisfy a precondition (e.g., a batch that adds
  a `person_evidence` link and then, in the same call, writes an assertion
  that link was supposed to gate). Worth a dedicated pass over
  `research-append.ts`'s full validation-ordering behavior before relying on
  either gate as complete.

## 7. Sequencing

1. **Build §4.4's "was this skill invoked" detection logic first**, ahead of
   its own hard-fail wiring — it's the direct measurement tool §4.1 needs to
   tune its recency window against the runlog corpus, so building it as a
   standalone check before enforcement gives real data instead of a guess.
2. §4.3 (revoke `Write`/`Edit`) — no dependencies, ship alongside the above.
3. §4.2 (cross-field validation, including the batch-ordering fix) —
   directly fixes PR #893's fixture failure mode, caller-agnostic, ship
   next.
4. §4.1 (caller-id hook) — tune against the corpus using step 1's tool, ship
   in shadow mode, measure false-positive rate, then hard-enforce and port
   to the hosted path.
5. Wire step 1's detection logic into a hard e2e fail (completing §4.4) once
   §4.1 is enforcing — it's the regression backstop for this bug class going
   forward.
6. Revisit agent conversion / per-skill tools (§5) informed by how §4.1
   performs in practice.

## 8. Adversarial review findings

One adversarial pass was run against this plan before circulation. Two
findings changed the design materially and are incorporated above, not just
noted here:

- **§4.2's original form was defeatable inside a single atomic
  `research_append` batch call** (verified against `research-append.ts`'s
  batch-validation loop) — a bypass could set `exhaustive_declaration.declared:
  true` and `tier: "proved"` in the same call, satisfying the cross-field
  check against its own just-written state. Fixed by validating against
  pre-call state and rejecting same-call establish-and-consume (§4.2).
- **The original "protected fields" list covered `research.json` only**,
  missing that `materialize_facts` can create tree persons and attach facts
  without any `person_evidence` entry, and that `proof-conclusion`'s
  documented output includes tree-side writes (`primary: true`,
  `ParentChild`/`Couple` relationships) that neither §4.1 nor §4.4 was
  watching. Both sections now cover `tree.gedcomx.json` writes explicitly
  (§4.1, §4.4).

Findings incorporated as design refinements rather than section rewrites:
per-question keying and success-gating for §4.1's recency window; a
shadow-mode rollout step and false-positive/availability risk (§6); §4.3
reframed as hygiene rather than a fix for the observed bypass; sequencing
reordered so §4.4's detection logic is built before §4.1's window is tuned,
rather than after.

Not incorporated, flagged as residual risk instead: full validation-ordering
audit of `research-append.ts`'s batch semantics beyond the one TOCTOU case
found (§6); content-level validation of `stop_criteria`/`log_entry_ids`
(§4.2); whether `Skill`-tool content injection is actually reliable for a
skill's own nested references, an assumption the *current* architecture
already depends on, not one this plan introduces (§6); whether `gps-mentor`'s
own gate is itself skippable (§6).
