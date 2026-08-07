# GPS Guardrail Enforcement — Specification

**Scope:** the mechanisms that stop autonomous `/research` from producing a
guardrail skill's output without invoking that skill. Cross-cutting by nature —
the layers live in the MCP server, the plugin, the hosted control plane, and
both eval harnesses — which is why they are specified here rather than inside
any one of those specs.

**Owned in detail elsewhere.** This spec is the map and the rationale. Two
layers have a more specific owner and are not re-specified here:

- the write-boundary invariant → `docs/specs/research-append-tool-spec.md` §5
- the post-run compliance detectors → `docs/specs/e2e-test-spec.md` §7.5

**History.** This replaces `docs/plan/research-guardrail-bypass-plan.md`
(deleted once its work shipped). The plan's §4.1–§4.4 map to §7, §5, §6 and §8
below. The production port of §6 has shipped; graduating §7 to a hard deny and
porting §8's detectors to production have not.

---

## 1. What must hold

Four skills own four GPS judgments that nothing else in the system is
authorized to make:

| Skill | Owns |
|---|---|
| `research-exhaustiveness` | whether the search was reasonably exhaustive (`exhaustive_declaration.declared`) |
| `proof-conclusion` | the tier on a conclusion (`proof_summaries[].tier`) and its tree encoding |
| `person-evidence` | identity — that a record's subject is the tree person (`person_evidence[]`) |
| `conflict-resolution` | how competing assertions are weighed (`conflicts[]` independence/weighing analysis) |

**The invariant:** a judgment's recorded effect must not exist unless the skill
that owns it produced it. The router (`/research`, the main thread) may
sequence these skills; it may not do their work itself.

This is a correctness property, not a process preference. A tier written by the
router is a genealogical claim nobody applied the standard to — and it reaches
the user looking exactly like one that was.

## 2. Why prose cannot hold it

Prose was tried three times and failed three times: the routing-table mandate in
`research/SKILL.md`, the "MANDATORY… invoke the skill, never a generic subagent"
contract added in PR #893, and the earlier per-skill fix recorded in
`docs/diagnoses/wilkins-death-kentucky-headless-runs2-3.md`. Each produced an
identical bypass on re-run.

The reason is structural, and it is the thing to re-read before proposing a
fourth prose fix: **the party asked to self-police is the same party whose
behavior degrades under the exact condition that produces the bypass.** Bypasses
cluster late in long runs (47–81% of the way through), which is where context
pressure is highest and where an instruction that is no longer in context stops
binding at all. The independent compaction audit in
`docs/plan/research-performance-2026-07-27.md` measured the general mechanism:
an unanchored prose rule's compliance falls from ~100% to 3–45% once its skill
body is evicted, while tool-validated and output-coupled rules hold at 100%.

Two bypass shapes are on record, both from committed runlogs:

- **Read-and-improvise** — the router `Glob`/`Read`s the target skill's own
  `SKILL.md` off disk, then does the work inline via `research_append`. No
  `Skill` call and no `Task` call at all.
- **Untyped subagent** — a `Task`/`Agent` call with no `subagent_type` and a
  hand-written prompt standing in for the skill.

**Why attribution is hard.** The SDK's only context-scoping primitive is
`agent_id`, present on `PreToolUseHookInput` only inside a `Task`-spawned
subagent. A `Skill` invocation runs inline in the same session with no
`agent_id`, so at the tool-call layer it is indistinguishable from the router
doing the work itself. `eval/harness/harness/context_policy.py` says exactly
this in its own docstring — it can guard `image_read` only because that check
keys on `agent_id`'s *absence*, and it does not generalize to sub-skills. Every
design here is shaped by that limitation.

## 3. Evidence base

**The bypass is per-gate, not per-run.** All three confirmed cases invoked some
guardrail skills and skipped a specific one. Any detector built on "did any
guardrail skill run this session" misses every case we have evidence for.

| Run | Recorded verdict | What happened |
|---|---|---|
| `alvro-taylor-marriage-1931` (2026-07-15) | **pass** | 95 calls, only question-selection/research-plan/search-records invoked; 27 `person_evidence` appends, a `tree_edit` relationship, an `exhaustive_declaration` and a `proof_summaries` append all written inline. Zero guardrail skills, ever |
| `cruz-corona-ancestry` (2026-07-13) | partial | full independence + weighing analysis written with `conflict-resolution` absent from the run |
| `hole-parents-negative` (2026-07-22) | **pass** | ran proof-conclusion *and* research-exhaustiveness, then wrote conflict-resolution's output itself |
| `eulogia-gatica-burial` (2026-07-28) | pass → failed by §8 | 83 calls, 6 skills invoked, 17 direct `research_append`; stamped `proved` over an unresolved 1862/1865 birth-year conflict |

`bagley-father-1884` (2026-07-27) is the case that shaped §8's third check: at
call 86 the router wrote a 26-op batch creating a new tree person and linking 13
assertions to him, `person-evidence` having been read off disk at call 77 and
not invoked until call 138 — for a different record. `same_person` was called
**zero** times in the whole run. The whole-run "was it invoked" check passed;
only the windowed check caught it. A blind human annotation independently
downgraded the run for the same underlying defect (the person was never pinned
to an identity), which is content-level corroboration that a skipped gate has
genealogical consequences, not just procedural ones.

**Scale.** Replaying the windowed check across 99 committed runs
(`eval/harness/e2e/guardrail_shadow_report.py`, no API spend — `tool_calls` is
persisted per run). The report now windows to the last 14 days like every
other run-log reader; `SINCE=all` is the whole-corpus mode this table was
measured in: calibration wants that maximum-sample replay, and the staleness it
inherits ("the historical corpus predates several of today's skills") is answered
with *new* runs, not with a wider window.

The numbers below are a point-in-time replay over the **99 runs committed when
they were taken**, kept as the record of what motivated the window. The corpus
only grows, so `SINCE=all` reports larger absolute counts than this table — the
shape, not the figures, is what reproduces. Re-run it rather than reading a
count out of this page:

| window | violations | runs affected |
|---|---|---|
| 10 | 723 | 93/99 |
| 40 | 530 | 87/99 |
| 150 | 430 | 81/99 |

The count barely moves from 10 to 150, which is the tell that most of these are
not "the window was slightly tight." Caveat that survives into any future
calibration: runs older than the current four-skill decomposition reference
skill names that no longer exist (`assertion-classification`, `check-warnings`)
and will read as noise until filtered.

## 4. The enforcement layers

Four layers, deliberately independent — each catches something the others
cannot, and none depends on another shipping first.

| # | Layer | Binds in | Catches | Status |
|---|---|---|---|---|
| §5 | Write-boundary invariant | engine (MCP tool) — so Cowork, hosted, both harnesses | a tier claimed without a prior exhaustiveness declaration | **enforcing** |
| §6 | Raw-write lockdown | plugin hook (Cowork, hosted, wherever the plugin loads) + SDK hook (hosted) + e2e harness | writing the two project files without going through a validating tool | **enforcing** |
| §7 | Caller-attributed recency check | e2e harness only | a protected write with no recent successful invocation of its owning skill | **shadow only** |
| §8 | Post-run compliance detectors | e2e harness only | a guardrail skill's effect in the final state with no invocation anywhere in the run | **enforcing (fails the run)** |
| §8 | Live pre-write `same_person` provenance check | e2e harness only (`pretool_hook`) | a `person_evidence` link for a brand-new tree person written before any `same_person` scored that identity | **shadow only** (opt-in `deny` per run) |

Read the status column literally. Only §5 and §6 restrain a real user's session
today; §7 and §8 are measurement over eval runs. §8 cannot port to production
until something is retained to detect against — the hosted path persists no
tool-call ledger.

The last row is the live, pre-write form of a question §8 already hard-fails
post-run, so its doctrine needs no shadow period — but its *enforcement* does.
It fires in the large majority of runs that link a person, because scoring a
locally-minted tree person is not current agent behavior. Denying on that would
intervene in most of a suite costing $7-25 a run with no evidence for how the
agent recovers, so it records into `guardrail_shadow_violations` and lets the
write through. Graduating it to a deny is gated on these numbers. Note it asks a
stricter question than its §8 counterpart: that one accepts a `same_person`
anywhere in the run, including *after* the link, so link-then-score is a shadow
hit and a post-run pass.

**Re-measure; do not read a count out of this page.** As with §3's table, the
corpus only grows:

```sh
make e2e-guardrail-shadow REPLAY=1 SINCE=all
```

`REPLAY=1` recomputes the check from each run's `tool_calls` and its fixture's
committed seed tree. That is a distinct number from the *stored* count printed
above it, and the distinction is the thing to understand before reading either:

- The **stored** count covers only runs made after the live check shipped
  (`2026-08-04 23:45Z`). At the time of writing that is **zero of 144 committed
  runs** — the newest committed run predates the merge by an hour — which is why
  the graduation gate ("run a real suite and read the entries") could not be answered
  from the corpus at all. It needs no code: the next committed e2e run produces
  stored entries by itself.
- The **replayed** count reads the whole pre-hook corpus: at the time of writing
  **111 of the 137 runs that link a person have ≥1 gap (750 links, 72
  fixtures)**, with one run skipped and named for having no committed seed tree.
  It is a **lower bound** — the live hook may not yet see a `same_person` issued
  in the same turn as the write, while the replay always sees the full prefix.
  Its second job is scoring a candidate *narrowing* of the rule against history
  before that narrowing ships.

**Why a deny needs more than a number: the reason has to be satisfiable.** The
original reason said a brand-new identity "should be scored before it is
asserted", which the agent believes it did. The cause is an **id mismatch**, not
laziness: `tree_edit` mints local ids (`I1`) and rejects caller-supplied ones,
while `same_person` scores `primaryId1`/`primaryId2` *inside the caller's own
gedcomx documents*. The one satisfying shape is to pass the tree side as
`gedcomx2` with `primaryId2: "I1"`, which agents produced in 3 of 103 corpus
runs. The reason text now names that shape, says the **entire batch** is
rejected (a `PreToolUse` deny is all-or-nothing, and these batches run to a
median of 17 ops), and states the escape below.

**One class of write genuinely cannot satisfy the gate — and one that looks like
it can't, does.** `person-evidence/SKILL.md` scopes scoring to
`record_search`-sourced assertions only ("Match scoring works **only** for
`record_search`-sourced assertions"): an FTS-, image- or PDF-sourced assertion
has a null `record_persona_id`, so there is no record persona to compare
against. That case is real, and the reason's stated escape — record in the link's
`rationale` that no score was obtainable, and proceed — is what keeps it
satisfiable.

The same skill also says a locally-minted stub returns a degenerate score to be
treated as "no score available". **That guidance is stale, and acting on it would
be the more expensive mistake**, because it excuses the agent from the exact call
this layer exists to require. It dates from 2026-07-02; the match-engine
mint-hardening that made an ARK-less focus person score on document content
landed 2026-07-07, five days later. Probed live
(`packages/engine/mcp-server/dev/probe-same-person-local-id.ts`), holding the
record side and every fact constant and varying only the tree side's `ark`:

| arm | tree focus | score |
|---|---|---|
| A | real ARK (control) | `0.999967` |
| B1 | ARK removed, local id `I1` | `0.9999484` |
| B2 | identical to B1, fresh random mint | `0.9999484` |
| C | every tree ARK removed | `0.9999484` |

B1 and B2 are identical although `randomFsId()` mints a different id per call,
and stripping every ARK degrades nothing further — the score is document
content, not identity resolution. **A newly-minted tree person is scorable, so
the gate is achievable for it.** The consequence for graduation is the opposite
of what the fire rate suggests on its own: the rate measures an agent that does
not know the call shape, not a gate that cannot be met — which makes the reason
rewrite the lever, and a later deny more defensible than the raw number implies.

One caveat on the probe: it is a single pair with strongly agreeing name, date,
place and a parent relationship. A minted person carrying thinner content will
score lower — but that is a real weak-match signal, which is what the gate is
for, not an ARK artifact.

**Trying a deny on one fixture.** `make e2e-run TEST=<slug>
PERSON_EVIDENCE_GUARD=deny` (default `shadow`) blocks the write instead of only
recording it, bounded by a two-limit loop valve: per id set, and per run. Past
either the write is **released** rather than denied again, because a denied
`research_append` returns before `tool_call_count` and so charges no budget,
while `activity_count` increments regardless — so without the valve the only stop
is `max_turns` / the wall clock, the §10 failure mode the deny is supposed to
avoid. Releasing falls through to the normal path and charges budget, which is
the only bound a wedged agent can actually reach.

Two things about a deny-mode run's output:

- Its provenance entries carry `kind: "person_evidence_deny"`, and
  `guardrail_shadow_report`'s stored scan **excludes** them. Without that they
  would land in the shadow corpus indistinguishably and inflated — the valve
  records several denials plus a release for one logical gap — corrupting the
  number the graduation is gated on. Those entries also carry
  `valve_released: true|false`, which is how you tell the two apart: `false` is a
  write the gate actually blocked, `true` is one it let through because a limit
  was reached. **Reading a deny-mode run's fire rate means counting
  `valve_released: false` only** — the releases are the valve working, not
  additional violations.
- **Its `compliance` axis is not comparable to a shadow run's.** The denied write
  never lands, so `find_person_evidence_missing_same_person` finds no
  `person_evidence` entry for that person and its arm passes **vacuously**. The
  mode is recorded in the runlog's `usage` block so a reader can tell.

## 5. Write-boundary invariant

A `proof_summaries` entry may not carry `tier: "proved"` or `"disproved"`
unless the referenced question already carried
`exhaustive_declaration.declared === true` **before the current call began**.

Implemented as `proofSummaryInvariants` in
`packages/engine/mcp-server/src/tools/research-append.ts`; specified with the
other state-coupling invariants in `docs/specs/research-append-tool-spec.md` §5.

Two properties are load-bearing and must survive any refactor:

- **Pre-call state, not final state.** `research_append`'s batch form mutates
  one shared in-memory document across `ops[]` and validates the result once.
  Checked against final state, a single batch could set
  `exhaustive_declaration.declared: true` and `tier: "proved"` in the same call
  and satisfy the gate with its own just-written value. The batch that
  establishes a precondition and consumes it must be rejected.
- **Caller-agnostic.** It holds whether the caller is the router, an in-session
  `Skill`, or a future agent, which is why it is the one layer that reaches
  every environment for free. Prefer this shape for any new gate.

What it does not do: validate the *content* of `stop_criteria` or cross-check
`log_entry_ids` against real `log[]` entries — a declaration can still be
present-and-empty. And it says nothing about overclaiming language in
`narrative_markdown`; that is `gps-mentor`'s proof-critique job, checked by §8.

## 6. Raw-write lockdown

No raw `Write`, `Edit`, or `NotebookEdit` may target `research.json` or
`tree.gedcomx.json`. Every write goes through a validating MCP tool
(`research_append`, `research_log_append`, `tree_edit`, `tree_correct`); a
direct file write never validates.

Three implementations, deliberately:

| Where | File | Reaches |
|---|---|---|
| Plugin `PreToolUse` command hook | `packages/engine/plugin/hooks/{hooks.json,guard_project_files.py}` | Cowork, hosted, anywhere the plugin loads |
| SDK `PreToolUse` hook | `apps/server/app/agent/real_agent.py` (`_pretool_hook`) | hosted only |
| Harness hook | `eval/harness/e2e/orchestrator.py` | e2e runs |

**Why the plugin copy exists.** A per-agent `tools:` allow-list is subtractive —
it can only narrow what a subagent inherits — so nothing but a hook can restrain
the *main thread*. But `hooks=` is an SDK argument, and Cowork's session options
are not ours to set, so a host-side hook can never reach Cowork. A
plugin-shipped `hooks/hooks.json` does. Verified live in Cowork 2026-07-30: the
hook loads, fires for `Write` and for `Bash`, both matcher forms bind, and a
`deny` is honored with the script's own reason text surfacing to the agent.
Cowork runs `permission_mode: "default"`; the hosted path runs
`bypassPermissions`; a hook binds under both. See `CLAUDE.md` § "Plugin hooks"
for the packaging constraints (`scripts/package-plugin.mjs`'s `INCLUDE` must
carry `"hooks"`) and the two upstream reports that do **not** reproduce.

**Why the hosted copy still exists.** Redundant in principle — the hosted path
also loads the plugin — but "the plugin loader does what you'd expect in the
hosted path" is exactly the assumption issue #939 disproved for agents. Both
fire until one hosted run confirms otherwise; they deny the same thing with the
same reason, so the redundancy is harmless. Deleting the SDK copy was declined
(issue #1129, closed not-planned) — all three stay. **No test asserts the three
agree**, so a future addition to `PROTECTED_PROJECT_FILES` can silently lag in
two of them; that gap is `docs/architecture.md` §9.4's, and the three copies are
`packages/engine/plugin/hooks/guard_project_files.py`,
`apps/server/app/agent/real_agent.py`, and
`eval/harness/e2e/orchestrator.py`.

**Deliberate gaps.**

- **`Bash` is not covered.** All three copies of the guard match on `file_path`,
  so `cat > research.json`, `sed -i`, and `python -c` all get through. Skills run
  their stdlib-only scripts through `Bash` so it cannot be revoked, and matching
  command text would deny a legitimate `python script.py research.json > out`
  while still missing a variable-built path. A false deny is the worse failure
  mode: it turns a silent quality bug into a loud availability regression. No
  bypass in the corpus has used the shell; close this if one appears in a runlog
  or a feedback case.
- **`Read` is not revoked, and should not be** until there is a way to read the
  same data. `research_query` covers 11 of `research.json`'s ~15 top-level
  sections (missing `project`, `researcher_profile`, `known_holdings`,
  `localities`) and caps at 50 items with no pagination. For
  `tree.gedcomx.json` there is **no query surface at all** — nothing that stands
  to the tree as `research_query` stands to `research.json`. Plenty of tools
  *open* the file: `project_context` (its `readJson` of `research.json` in
  `packages/engine/mcp-server/src/tools/project-context.ts`) loads it, and
  roughly a dozen writer/validator tools (`tree_edit`, `tree_correct`,
  `tree_forget`, the merge tools, `materialize_facts`, `research_append`,
  `validate_research_schema`, …) load it to validate or rewrite it. But none of
  them hand the agent its contents to inspect: the writers return a result, not
  the tree, and `project_context` returns only a flat person roster
  (`{id, name, gender, sourceRefs}`) — no facts, no dates or places, no
  relationships, no per-fact sources. An agent that needs to see what the tree
  actually says has `Read` and nothing else. (`person_read` is not a substitute
  — it hits the live FamilySearch API, a different data source.) Closing that is
  a build project, not a config change.
- **Scope this correctly: it is hygiene.** Both observed bypass shapes write via
  `research_append`, never via raw `Write`. This closes an escape hatch; §5 and
  §7 are the gates that address the observed bug.

Each copy is tested independently (`tests/packaging/plugin-hooks.test.ts` runs
the real script; `apps/server/tests/test_write_lockdown.py`;
`eval/harness/tests/unit/test_e2e_tree_block.py`) and **no test asserts the
three agree** — a known divergence risk when `PROTECTED_PROJECT_FILES` next
changes.

## 7. Caller-attributed recency check (shadow mode)

`find_unguarded_protected_writes` (`eval/harness/harness/skill_invocation.py`)
flags a protected write with no *successful* invocation of its owning skill
within a trailing window of tool calls (`GUARDRAIL_SHADOW_WINDOW = 40` in
`eval/harness/e2e/orchestrator.py`). Findings land in the runlog as
`guardrail_shadow_violations`. **It logs; it never denies.**

Design points that were paid for and should not be re-derived:

- **Harness-tracked, never model-supplied.** A `caller_id` argument the router
  fills in itself is attested by the party we don't trust at the moment it
  matters. Direct precedent: `person-evidence`'s `match_score` was meant to
  attest that `same_person` was consulted, and its provenance guard was cut in
  #695 for zero observed true positives across **every**
  `eval/tests/unit/person-evidence/` case as of that PR, against a real
  false-positive class.
- **Success-gated, off the joined `tool_calls[].is_error` — but only to the
  depth that key can see.** The intent is that an errored `Skill` call must not
  open the window, or "invoke the skill, let it fail, finish the write inline"
  evades this check and §8 at once. The instrument is the SDK's
  `ToolResultBlock.is_error`, joined onto each entry by `apply_tool_result` in
  `e2e/orchestrator.py` and read by the `entry.get("is_error") is True` gates in
  `harness/skill_invocation.py` — `recently_succeeded`,
  `find_unguarded_protected_writes`, `find_effects_without_invocation`,
  `find_person_evidence_missing_same_person`, and
  `find_protected_writes_by_unnamed_delegate`.

  **There is no `PostToolUse` hook** anywhere in `eval/harness/`, and nothing
  here should be built on one existing.

  **What that buys, and what it does not.** `is_error` reports whether the *tool
  call* failed, which is not the same question as whether the *skill* succeeded:

  - **`Skill` — launch only.** Every `Skill` result in the committed corpus is a
    launch acknowledgement (`Launching skill: <name>`); the skill's work happens
    in later turns of the same session. So `is_error` on a `Skill` entry catches
    an unknown-skill-name launch failure and nothing else. **The
    invoke-then-let-it-fail evasion named at the top of this bullet is still
    open** — closing it needs an instrument that observes skill *completion*,
    which `ToolResultBlock` is not.
  - **MCP writer tools — thrown errors only.** `src/index.ts` sets `isError`
    from its `catch`; `research_append`'s `fail()` helper *returns* `{ok:false}`
    without throwing, so a rejected write still records `is_error: false`
    (issue #1282).
  - **What it does gate today:** MCP tools that throw — an errored
    `same_person` no longer enters `find_person_evidence_missing_same_person`'s
    `scored_ids`, and an errored `tree_edit` no longer counts as a protected
    write in `find_unguarded_protected_writes`.

  Violation counts and the §8 `compliance`/`outcome` verdict are not comparable
  across that join. The boundary is the commit, not cleanly a version number —
  #1255 shipped it at `harness_schema_version` 2 and the bump to 3 came after, so
  a `2` log means either thing depending on its date; `docs/specs/e2e-test-spec.md`
  §7.5 has the table. The measured delta on the committed corpus is two entries.
- **Keyed by `(skill, question_id)` where a question id is derivable**, not by
  skill name alone: in a multi-question project a `Skill(proof-conclusion)` for
  question A would otherwise cover an inline write for question B. Where no
  question id can be extracted, it falls back to a per-skill window and accepts
  the imprecision.
- **Protected writes include the tree side**, not just `research.json`.
  `materialize_facts` can create a tree person and attach facts with no
  `person_evidence` entry existing at all, and `proof-conclusion` owns tree
  writes (`primary: true`, `ParentChild`/`Couple`). A check watching only
  `research.json` misses both.

**Why it is still shadow.** The window is a recency heuristic, not a guarantee,
and its default was a first-cut guess. Graduating it to deny requires knowing
the false-positive rate, because a mistuned window hard-denies legitimate writes
and can produce a stuck loop against the harness's own stall/budget machinery.
**Measure the false-positive rate first. Do not graduate it on intuition.**

## 8. Post-run compliance detectors

Three non-windowed checks over the final project state and the run's tool-call
log; any violation sets `compliance: fail` and forces `outcome: fail`,
regardless of what the judge said. Specified in full — including the historical
`not_checked` handling — in `docs/specs/e2e-test-spec.md` §7.5. Implemented in
`skill_invocation.py` (`find_effects_without_invocation`,
`find_missing_mentor_verdicts`, `find_person_evidence_missing_same_person`).

Two properties worth keeping in view here:

- **Whole-run scope is a real limitation, not an oversight.** "Was this skill
  invoked anywhere" passes on `bagley-father-1884`, where it was invoked 52
  calls away for a different record. That is precisely what §7 exists to catch
  and why both layers are needed.
- **A required-tool fingerprint beats a proximity heuristic where one exists.**
  Check 3 works because `same_person` is a *required call*, so "was it called
  for this person" is a fact. None of the other three guardrail skills has an
  equally unambiguous fingerprint, which is why they stay on §7's windowed path.

Porting these to production is a **retention** problem first: the hosted path
keeps no tool-call ledger to run them over.

## 9. Options set aside

Each of these was worked through and rejected or deferred with a reason. Read
this section before reopening one.

- **Converting the four skills to agents** (which would give a real `agent_id`
  and make hook attribution trivial). All four do mandatory on-demand `Read` of
  their own `references/*.md`, and issue #702 measured that pattern from an
  agent as unreliable *and silent* — read on some tests, ignored on others,
  over-applied on others; 6/19 against a 12–14/19 baseline. The only sanctioned
  fix is full inlining (`CLAUDE.md`, "No playbook/reference files for agents"),
  and inlined, `person-evidence` (941 lines) and `conflict-resolution` (1006)
  would each set a new high-water mark for a plugin agent body.
  `research-exhaustiveness` (413) and `proof-conclusion` (509) are the cheap
  candidates if this is revisited.
- **A thin agent whose only action is `Skill('<name>')`** — keeps SKILL.md as
  the single source of truth while buying a real `agent_id`. Plausible, because
  #702's failure was a *conditional, secondary* fetch whereas this would be
  unconditional and first. Untested, and `AgentDefinition.skills` is not
  surfaced in this repo's agent frontmatter format. Wants a small controlled
  experiment before anyone commits to it.
- **A self-reported `caller_id` argument** — see §7.
- **Splitting each guardrail skill's writes into its own MCP tool**
  (`proof_conclusion_append`, `exhaustiveness_declare`, …, mirroring
  `extraction_append`). Attributes nothing on its own: a split tool is exactly
  as callable by the router as a section branch is. It is a multiplier on
  agent conversion — `disallowedTools` binds even under `bypassPermissions` but
  is tool-name-granular only — not a substitute for any layer here.
- **Per-turn scoping for a production detector** — proposed for #1054 and dead.
  Three of `find_effects_without_invocation`'s arms read whole-document state
  with no baseline — research-exhaustiveness, conflict-resolution, and
  proof-conclusion's `proof_summaries` half — so at turn scope they latch
  permanently after the first legitimate write; and a hosted "turn" is one user
  message, while an autonomous research request is the whole run.
  (proof-conclusion's tree half and the person-evidence arm are
  `starting_tree`-baselined — a run-level baseline, which does not help at turn
  scope.)
- **Enforcing coherence at the write boundary instead of provenance** — PR #997,
  closed with review. Replayed over 113 committed runs it flagged 3 where the
  shipped provenance check flagged 63, with an empty set difference: it detects
  nothing the existing check misses, and is evadable via `moot` status or a
  `probable` tier.

## 10. Residual risks

Open questions live on the board, not here. This section keeps only the risks
that outlive any one of them.

- **§7's window is a heuristic.** A model that invokes the right skill and then
  does something unrelated while the window is open passes. It bounds the
  failure; it does not eliminate it.
- **False-deny risk is the asymmetric one.** Every enforcement layer here can
  turn a silent quality bug into a loud availability regression if mistuned.
  This is the reason §7 ships in shadow and the reason `Bash` is left open in
  §6 — in both cases deliberately, in favor of the failure mode that is merely
  wrong over the one that is stuck.
- **A gate can be unsatisfiable by doctrine, not just mistuned** — and the
  owning skill's doctrine can itself be stale. §4's live provenance check asks
  for a `same_person` score on writes `person-evidence` says cannot be scored.
  One of those two claims is true (a non-`record_search` assertion has no
  `record_persona_id` to compare against); the other — that a locally-minted stub
  returns a degenerate score — was **refuted by probing the live API**, and had
  been superseded by a match-engine change five days after it was written. A
  fire-rate measurement distinguishes none of this: an impossible gate, a
  mistuned one, and an achievable one the agent has been told to skip all look
  identical from the count. Before graduating any layer here, read the owning
  skill's doctrine for cases where no call sequence satisfies the gate — **and
  date each claim against the code it describes** rather than trusting it,
  because a stale excuse in a skill body suppresses the very call the guardrail
  is measuring. Narrowing this check to `record_search`-sourced assertions is
  open work; correcting the stale stub guidance is separate skill-prose work.
- **`Skill`-tool content injection under compaction is unverified.** All four
  guardrail skills `Read` their own `references/*.md` on demand, in-session. If
  that read is as unreliable as #702 found the agent case to be, the failure
  looks identical to the original bug and nothing here catches it — §8 detects
  "skill never invoked," not "skill invoked, its own reference silently
  skipped."
- **`gps-mentor`'s own gate may be as skippable as the four.** §8 check 2
  detects a missing verdict after the fact; nothing prevents the router from
  skipping the invocation under the same context pressure.
- **`research-append.ts`'s batch ordering was audited for one TOCTOU case
  only** (§5's). Other same-batch orderings that self-satisfy a precondition —
  adding a `person_evidence` link and consuming it for an assertion in one
  call — were flagged, not audited.

---

## 11. Caller-attributed protected writes (shadow mode)

**Status:** shadow only. Instrumented, never denied. Graduating it is gated on
the same calibration as §7.

### The rule

A **protected write** — one `owning_skills` attributes to one of the four
`GUARDRAIL_SKILLS`, or any `extraction_append` call — is legitimate **iff its
caller is one of**:

- the **main thread** (no `agent_id` on the ledger entry), or
- one of the four **dedicated Cowork agents** (`DEDICATED_AGENT_NAMES`), which
  carry their own self-contained doctrine.

`extraction_append` is narrower still: only `agent_type == "record-extractor"`
exactly. It is hard-restricted at the TypeScript layer to `sources`/`assertions`
(`extraction-append.ts`) and `record-extractor.md` is the only agent file that
declares it, so a *different* dedicated agent holding it is not a case any
agent's `tools:`/`disallowedTools:` declaration is set up to permit, and is
itself worth flagging.

Anything else — most importantly a `general-purpose` subagent the model spawned
itself — is a bypass.

### The decision, and what it beat

**Caller identity decides. Doctrine presence does not.** Settled by the lead
2026-08-02.

The case that forced it is `ogletree-children/run-2026-07-21_13-24-05.json`, a
**committed, judge-`pass`** run: the model spawned a `general-purpose` subagent,
that subagent **called `Skill(person-evidence)` itself** at `tool_calls[267]` —
so the doctrine genuinely loaded — and then made three protected writes
(`materialize_facts` with no `personId` at 278, `tree_edit` at 279,
a 19-op `research_append` at 280). Under a doctrine-presence rule that run is
compliant. Under this rule it is a bypass.

**Rejected: doctrine presence.** Two reasons, either sufficient.

1. A `general-purpose` subagent binds **none** of the `tools:` /
   `disallowedTools:` declarations that every other capability restriction in
   this system depends on (`CLAUDE.md`, issue #939). It is precisely the shape
   that escapes them, so "it read the doctrine" guarantees nothing enforceable.
2. It cannot bind in production. A `PreToolUse` hook can see *who is calling*;
   it cannot see *whether doctrine was loaded*. A rule that is uncheckable at
   the enforcement point is a rule that only ever runs in a post-hoc report.

This is [ADR-0006](../adrs/ADR-0006-restrict-capability-by-tool-identity.md)
("restrict capability by tool identity, not by prompt or parameter") applied to
callers that have no declared identity at all. It does not supersede that ADR;
it extends it to the dynamically-spawned case, which ADR-0006 does not cover.

**Also rejected: two separate shadow axes** (unnamed-caller and doctrine-absent,
calibrated independently). It would produce two uncalibrated numbers when one
is already blocked on calibrating one, and the second axis needs exactly the
adjacency heuristic retired below.

### Why this needs no window

The retired predecessor — `find_skill_call_without_doctrine` — guessed "who is
currently executing" from `Skill`/`Agent`/`Read` adjacency in a flat,
unattributed `tool_calls` list, and missed real bypasses because it asked the
wrong question: whether doctrine was *reloaded*, not who was permitted to act on
it. It is retired, not tuned.

Attribution removes the guess. `e2e/orchestrator.py`'s `pretool_hook` stamps
every ledger entry with the PreToolUse hook's own `agent_id` / `agent_type`
(`claude_agent_sdk` `_SubagentContextMixin`: present only inside a Task-spawned
subagent, **absent** — not merely falsy — on the main thread). With true
per-call caller identity the check needs no window and no episode boundary.
`harness/context_policy.py::is_subagent_call` is the probe-verified precedent
for keying on exactly this, though that module is unit-harness-only and does not
itself cover e2e.

A call still in flight when a run aborts never receives these fields — the same
degradation `response_summary` already has.

### Where it surfaces

`E2eResult.protected_writes_by_unnamed_delegate`, a list of human-readable
violation strings. **Deliberately not read by `__post_init__`**: it must not
move the `compliance` axis until its false-positive rate is measured. Detector:
`harness/skill_invocation.py::find_protected_writes_by_unnamed_delegate`.

## Related

- `docs/specs/e2e-test-spec.md` §7.5 — the detectors, specified
- `docs/specs/research-append-tool-spec.md` §5, §11 — the write-boundary
  invariant and the `extraction_append` lane-gating precedent this extends
- `docs/architecture.md` §5 — the three capability-binding surfaces and which
  of them bind in production; §9.4 lists what nothing checks
- `CLAUDE.md` — "Plugin hooks", "Cowork plugin agents"
- Issues #911 (calibrate §7), #913 (what past verdicts are worth), #1054
  (retain a hosted ledger, then port §8), #998 (closed — §8 check 1's
  proof-conclusion arm now takes the `starting_tree` baseline),
  #940 (closed — the production port of §6)
