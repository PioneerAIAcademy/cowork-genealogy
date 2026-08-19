# ADR-0011: Put a guardrail that must hold at the write boundary, not in skill prose

> **Read before you:** answer a compliance failure by strengthening a `SKILL.md`
> sentence · decide where a new "this must always hold" rule lives · design a
> completion gate, a write invariant, or a lockdown · argue a boundary check
> would be too strict to ship · widen a gate that already exists.

- **Status:** Accepted
- **Decided:** 2026-08-09 (on the fourth independent re-derivation in one week)
- **Last updated:** 2026-08-19 (the hook row gets its first production caller rule; the split-writer-tool alternative records the decision it redirected)
- **Deciders:** Dallan Quass
- **Supersedes:** —
- **Superseded by:** —
- **Applies to:** `packages/engine/mcp-server/src/tools/research-append.ts`, `packages/engine/mcp-server/src/tools/image-transcribe.ts`, `packages/engine/plugin/hooks`, `packages/engine/plugin/skills`, `scripts/claude-hooks`, `docs/specs/guardrail-enforcement-spec.md` — *linted; keep current*
- **Related:** ADR-0003, ADR-0005, ADR-0006, ADR-0009; PR #1029; issues #1335, #1463, #1490, #1492, #1493, #1499, #1509, #1081, #1273, #1399

## Context

The rule the lead has now stated four times in a week, in four different places,
without it living anywhere a fifth reader would find it.

**Prose was tried on exactly this class of rule, and it failed inside a day.**
PR #1029 merged 2026-08-04 01:32 UTC carrying reinforced prose in the research
orchestrator: every routing-table "Invoke" became a literal `Skill` call, plus an
explicitly enforced-not-advisory contract against hand-authoring the artifacts
those skills own. Issue #1335 was filed the next day off
`eval/runlogs/e2e/antonio-lucas-spouse/run-2026-08-04_22-45-15.json`, a run made
**about 21 hours after that merge**. It carries `compliance: "fail"` and **18
`guardrail_bypass_violations`** in the run log (the issue body says 21).
`proof-conclusion`, `conflict-resolution` and `research-exhaustiveness` were
never invoked — and each one's artifacts were written anyway, straight through
`research_append`.

That is a different failure from the one ADR-0003 measured. There the mechanism
is decay: a rule is evicted by compaction and stops binding. Here the
instruction was hours old and almost certainly still in context; the agent
simply reached the *effect* by a route the prose does not own. Prose describes
what the agent should call. It cannot describe every way of producing the same
bytes without calling it.

**The reverse also holds. A boundary check that ships, holds.** `research_append`
refuses `project.status: "completed"` while a blocking conflict is unresolved —
the only completion gate in the tool today. Its own comment records why it
exists: in the `wilkins-death-kentucky` run an agent logged an unresolved
identity conflict with a 43-year birth mismatch and completed the project anyway,
because the prose-level guardrails that fired were rationalized away. As a tool
refusal, nobody has argued past it. In
`eval/runlogs/e2e/hannah-earnest-children/run-2026-07-27_20-58-58.json` the agent
hit the refusal, and its very next two calls resolved the conflict with a
substantive four-part rationale and retried the completion, which then succeeded.
The refusal did not block correct work; it redirected the agent into doing it.

**And the same reasoning keeps being re-derived from scratch.** Four independent
issues in one week: issue #1490 (move the two completion gates out of
`research/SKILL.md` and into the tool — "reinforced prose did not survive one
day"); issue #1492's second ruling (the question of who writes
`project.status = "completed"`, where the body enumerates five disagreeing sites,
names a sixth, and its analysis note counts seven — one option on the table being
to move the write into `research_append` as a computed gate); issue #1493 (the
raw-write lockdown exists in three implementations and the unit eval harness,
the tier that runs the most sessions, is not one of them); and issues #1499 and
#1509 (the lockdown has a hole — `device_bash` wrote both protected files past it,
observed live in Cowork 2026-08-09). Three of those carry `needs-decision`.

## Decision

**A rule that must hold goes at the write boundary — the MCP writer tool that
persists the state, or a `PreToolUse` hook where no writer tool owns the route.
Prose states the rule; it does not enforce it.**

Concretely, this is a placement question with six answers — **the layer map**:

| Substrate | Owns | The test an author applies |
|---|---|---|
| **Writer tool** (precondition) | a value or a state transition in `research.json` / `tree.gedcomx.json`; every MUST; every completion gate; every foreign key | *"Can this be decided by reading the documents alone?"* If yes it goes here and nowhere else. **The only substrate that binds in all five environments.** |
| **Schema validator** | document *shape* — types, closed enums, required fields, id patterns, referential integrity | *"Would violating this make the document malformed, rather than merely wrong?"* This is the **integrity tier — not overridable.** |
| **`PreToolUse` hook** | a route no writer tool owns (raw `Write`/`Edit`, the shell, the device bridge), and any rule that turns on **who** is calling | *"Does this depend on the caller?"* Only substrate that can restrain the main thread (ADR-0005). **Fails open** — never the sole guarantee for anything that matters. **First production caller rule: 2026-08-19**, `proof_summaries` to the `proof-conclusion` agent. It is not the sole guarantee there — the writer tool's own content invariants (the mentor gate, `proofSummaryInvariants`) sit underneath it and do not fail open. |
| **Agent frontmatter** | what one delegated agent may touch | tool identity plus a `disallowedTools:` deny (ADR-0006). Binds under `bypassPermissions`; a missing deny fails open **silently**. |
| **Tool description** | what the model must know *at the moment of the call* but that no predicate can enforce — paging, argument choice, budget notices | *"Does the model need this to choose correctly, and is it advice rather than a constraint?"* Reloaded after compaction; **strength unmeasured** — two rules already in `record_search`'s schema decay anyway. Includes the advisory-field shape for a read-tool resource budget. |
| **Harness validator** | rules judgeable only over a **whole run** — bypass detection, episode analysis, compliance axes | *"Does evaluating this need the whole run?"* **Eval-only; never reaches production** — say so wherever one is added. |
| **Prose** | judgment exercised inside a single invocation | *"Is this a matter of judgment no predicate can express?"* **Not an enforcement layer.** State the rule; label it guidance. |

**The decision procedure** — take the first row that fits, in this order:

1. Decidable from the documents? → **writer tool**.
2. About shape rather than content? → **schema validator**.
3. Turns on who is calling? → **hook**, and only with a writer-tool backstop.
4. Only judgeable over a whole run? → **harness validator**, labelled eval-only.
5. Needed at call time but unenforceable? → **tool description**.
6. Otherwise → **prose, labelled as guidance rather than as a rule.**

### Writing a caller rule — the identifier is not what you expect

Any rule taking the hook row above depends on `PreToolUseHookInput`'s caller
keys, and both have a trap measured live in Cowork (2026-08-16):

- **`agent_id` is absent as a key on the main thread**, not present-and-null. Test
  membership (`"agent_id" in input`), never truthiness.
- **`agent_type` for a plugin agent is NAMESPACED** —
  `genealogy-research:record-extractor` — while a built-in delegate reports bare
  (`general-purpose`). **A predicate written as
  `agent_type == "record-extractor"` never fires in production.**

The second one is worse than a no-op because of polarity. `deny unless ==` with a
value that never matches denies **every** caller, including the owner the rule
exists to permit — and if a writer tool also refuses the broad path, the artifact
becomes unwritable in Cowork while every test stays green, because no CI job
reaches that runtime.

**Match both spellings, or normalise before comparing.** This is not
hypothetical: the same shape was flagged on one issue and then written into a
draft of this repo's own next phase, in a document that already contained the
warning. Prose in the same file did not prevent it; an adversarial reader did.

### Snapshot or live — the rule that decides

A writer-tool precondition reads either the **pre-call snapshot** or the **live**
document, and picking wrong is a silent false-deny or a self-satisfying gate:

> **Snapshot when the precondition must be satisfied by someone else. Read live
> when it is the same author's own prior step.**

A `gps-mentor` verdict is not something the writer may append for itself, so the
mentor gate snapshots. A proof summary and its question's `resolved` flip are two
halves of one author's conclusion, so that gate reads live — measured: 7 of 154
corpus resolve-calls write both in one batch, all with the summary ordered first,
so a snapshot would refuse 7 correct writes.

### Overridable or not — two tiers

The researcher **must** be able to override a doctrine gate (lead ruling,
2026-08-15). A system that can only refuse, used by professionals who are
sometimes right, becomes the thing people route around — which is the failure
being fixed.

- **Integrity gates are not overridable**: schema validity, and the raw-write
  lockdown. Overriding either yields an unvalidated document, which is what the
  layer exists to prevent.
- **Doctrine gates are overridable**, and the override must be attributable to
  the *human*: the tool records the refusal with an id, and the override is a
  **separate write** referencing that id and carrying a justification that
  persists and is visible. An `override` field on the original call is forgeable
  by the caller — the same reason a lane expressed as a tool parameter does not
  hold (ADR-0006).

**The override rate is the calibration signal.** A rule overridden often is a
wrong rule — and it is the only satisfiability measurement that generates itself
in production, which every shadow-mode check in this repo has lacked.

The first row is the default and the cheapest: it is caller-agnostic, so it binds
identically in Cowork, the hosted path, and both harnesses, and it needs no new
machinery. `docs/specs/guardrail-enforcement-spec.md`'s "Write-boundary
invariant" section already says to prefer that shape for any new gate; this ADR
makes it the standing answer rather than one gate's note.

### Four limits — this is not an absolutist rule

A boundary check refuses work, so it is not free, and three of these limits are
measured rather than argued.

1. **A semantic gate prefers a false allow over a false deny.** Issue #1490's
   tree-encoding phase states it directly: a wrong refusal hard-blocks a
   researcher from finishing correct work with no way around it, while a wrong
   allow leaves us exactly where we already are. Check only what is mechanically
   checkable, scope it conservatively, and write down what it knowingly lets
   through. #1572 applied this to the write gate itself: validating the whole
   project and refusing every writer tool on a pre-existing drifted section —
   even a call that never touched it — was a false deny reaching the researcher,
   so the gate now blocks only on errors the call introduces
   (`validation/introduced-errors.ts`). What it knowingly leaves undone: the
   tolerated fields still hold real evidence (`sources[].author`/`title` is
   citation content, `assertions[].person_id` the assertion-to-person link,
   `conflicts[].resolution_notes` the researcher's reasoning), so a legacy-shaped
   document stays invalid for downstream readers (the viewer, `packages/schema`)
   until an Option 2 healer rewrites it — a separate, lead-gated call, since the
   per-key mapping is a genealogical judgment (validate-project-refactor-spec §11).
2. **Satisfiability is a precondition, not a follow-up.** State which call shape
   satisfies the gate and how often agents actually produce it, *before*
   shipping the deny. ADR-0009's sixth `same_person` constraint disqualified a
   deny whose satisfying shape appeared in 3 of 103 corpus runs; issue #1463
   measured the caller-attributed recency check firing on **52% of protected
   writes** — 1,451 protected pairs across 140 runs — which projects to failing
   132 of 145 runs. A check that fails almost every run is a constant, not a
   guardrail, and each of those runs costs $7–25.
3. **A deny binds even under `bypassPermissions`, but only by exact tool name.**
   That is what makes `disallowedTools:` the last line of defence for a
   delegated agent (see the plugin-agents section of `CLAUDE.md`) — and it is
   also the limit: the matcher decides whether the hook runs at all, so a name
   it omits is a hole the script behind it can never close. `device_bash` is
   omitted deliberately and the write landed (issue #1509);
   `device_commit_files` was omitted by accident, which left the route open
   after all three predicate copies had been taught to deny it. The matcher is
   now `Write|Edit|NotebookEdit|.*device_commit_files`, and a packaging test
   derives the expected set from the guard script instead of restating it.
4. **Coverage is per-boundary, never global.** A writer-tool check binds only
   for callers who use the writer tool; a hook binds only for the tool names it
   matches, and only where the hook loads. The plugin hook is the one that
   reaches Cowork (see the plugin-hooks section of `CLAUDE.md`); the unit eval
   harness carries no protected-file rule at all (issue #1493).

## Alternatives considered

| Option | Why rejected | Evidence |
|---|---|---|
| **Reinforce the prose** — restate the rule, mark it enforced-not-advisory, name the exact `Skill` call | Tried on this precise class of rule and beaten in about 21 hours. Three skills were bypassed while their artifacts were written directly | PR #1029 (merged 2026-08-04 01:32 UTC) → issue #1335, off `run-2026-08-04_22-45-15.json`: `compliance: "fail"`, 18 violations in the log |
| **Fold this into ADR-0003** rather than write a new ADR | ADR-0003 answers *does this rule need an anchor*, from a compaction-decay audit of one skill. This answers *which boundary, and what the gate must satisfy before it ships* — and its four limits are the payload. Two of them (false-allow preference, satisfiability) are counterweights *against* anchoring, which would read as contradiction inside an ADR whose argument is that prose decays | Argued, not measured. `docs/adrs/README.md` rule 4's test: a reader arriving with "where does my guardrail go" is not served by the decay file |
| **A per-skill or per-section split writer tool**, so the tool's name carries the doctrine | Rejected before, and it generalises: *"a split tool is exactly as callable by the router as a section branch is."* Splitting names constrains nobody who holds all the names; the constraint comes from the check, or from not holding the broad tool. **This row did work in 2026-08:** Phase 3 was first planned as a narrow `proof_summary_append` and was redirected to a hook caller check by reading it — which removed six tool-wiring sites, kept the batched summary+resolve shape alive, and left every existing fixture valid | `docs/specs/guardrail-enforcement-spec.md`, "Options set aside"; ADR-0006; the Phase 3 plan |
| **An advisory instead of a refusal** — a warning, or a mentor verdict the agent is told to respect | This is what the completion gate replaced. In the `wilkins-death-kentucky` run the prose-level guardrails fired and were rationalized away, and the project completed over an unresolved identity conflict | The gate's own comment in `research-append.ts`; issue #1490 |
| **A read tool's resource budget, as an advisory** — `image_transcribe`'s browse notice | **Scopes the row above, does not overturn it.** That row is about a *state* gate: an advisory let `wilkins-death-kentucky` complete over an unresolved identity conflict. A page read persists nothing, so the asymmetry inverts — a wrong refusal hard-blocks a researcher mid-browse with no way around it, and no production telemetry would surface that. The budget therefore ships as a field on a successful result, and knowingly does nothing if the agent ignores it | Issue #1081; 267 `image_transcribe` calls across 145 committed runs, of which two image groups in one run exceed 20 distinct pages — and that run passed, citing no image from either |
| **Post-run detection only** — let it happen, catch it at grading | Catches it after the user has the wrong answer. The detectors also cannot yet yield a rate: no committed run resolves `pass`, and the universal validator's project-file check is coarse by design — one legitimate writer call legitimizes the session's raw edits | ADR-0003's enforcement note; issue #1493's read of `test_universal.py` |
| **Ship the deny on the violation count alone**, and tune later | The count cannot distinguish an impossible gate from an achievable one the agent was never taught to satisfy. Both cases were measured here, and both look identical from the number | ADR-0009 constraint 6 (3 of 103); issue #1463 (52%, projecting to 132 of 145 runs failing) |
| **Wait for a per-caller `PreToolUse` policy** to be ported to production before moving anything | Unported and not gated on anything currently moving; the writer-tool check needs none of it and reaches every environment today | ADR-0006's hook row; `eval/harness/harness/context_policy.py` |

## Consequences

**Gains.** The check holds regardless of context state, model, elapsed session
time, or which caller reached the tool — which prose never does. The one shipped
example behaves the way the argument predicts: the completion gate's refusal in
the `hannah-earnest-children` run was followed immediately by a substantive
conflict resolution and a successful retry, where the same rule as prose had been
talked past in `wilkins-death-kentucky`. It also gives the four open issues above
a single answer instead of four re-derivations, and removes the reason three of
them carry `needs-decision`.

**Costs, knowingly accepted.**

1. **A gate can refuse legitimate work, and there is no override.** A researcher
   blocked by a wrong denial cannot finish correct work at all. That is the whole
   reason for the false-allow preference and for conservative scoping, and it
   means a semantic gate will knowingly let some violations through.
2. **Every gate is more work than a sentence** — a check, a spec row, and a test
   that has been made to go red — so there is standing pressure to write the
   sentence instead, exactly when the deadline makes the rule matter most.
3. **The prose does not go away.** Issue #1490 is explicit that the tool becomes
   the enforcement while the prose stays as guidance, which leaves two artifacts
   that must keep saying the same thing.
4. **Coverage stays partial and the gaps are silent.** `device_bash` walked past
   the lockdown in the shipping product on 2026-08-09; the unit tier has no
   protected-file rule, so it cannot distinguish "the skill complied" from
   "nothing was checking," and 0 of 1,845 committed unit run records carry a
   `tool_calls` array to audit after the fact.

**Risks.** A gate shipped without its satisfying shape measured becomes a
constant that denies correct work at $7–25 a run — the failure ADR-0009's sixth
constraint exists to prevent, and the one issue #1463 caught before it shipped.
In the other direction, nothing mechanical flags a "must hold" rule that is still
a sentence: two gates identified as needing anchors, the tree-encoding gate and
the mentor gate, are still prose today even though both are computable from files
`research_append` already loads.

## Enforcement

**None for the placement decision — convention only.** No lint can see that a
rule which should be a check is still a sentence. The check is review, carried by
the "Read before you" line above and by ADR-0003.

What exists holds the gates that did ship:

> `packages/engine/mcp-server/tests/tools/research-append.test.ts` — the
> completed-status gate's refusal path and the pre-call-snapshot discipline the
> write-boundary invariants depend on.

> `packages/engine/mcp-server/tests/packaging/plugin-hooks.test.ts` — runs the
> real guard script against vectors, and asserts the `hooks` directory is
> actually packaged (without it the guard silently never ships).

> `eval/harness/tests/unit/test_write_lockdown_parity.py` — asserts the three
> lockdown implementations agree, and fails on an unregistered fourth copy.

> `eval/harness/e2e/guardrail_shadow_report.py` — replays a shadow check across
> the committed corpus. This is the instrument that produces a satisfying-shape
> rate before a graduation, and it costs no API spend.

None of these catches the thing this ADR is about. And per the new-lint rule in
`CLAUDE.md`, a new gate's test is not evidence until the gate has been commented
out and the test watched to fail.

*Linted: every path in this section must resolve.*

## Revisit when

> A boundary check is observed denying correct work in the field — a false deny
> that reaches a researcher — at which point conservative scoping needs teeth
> beyond review, or gates need a documented override path.
>
> Or a platform mechanism arrives that keeps a rule binding across a whole
> session without a tool call (the "constraint pinning" class of mitigation that
> ADR-0003 notes is not available to us), which would make prose a real
> enforcement surface for the first time.
