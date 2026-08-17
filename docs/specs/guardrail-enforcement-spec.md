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

`bagley-father-1884` (2026-07-27) is the case that shaped §8's third check.
Verified against `run-2026-07-27_20-01-40.json`:

- **call 85** — `materialize_facts`, 7 ops, mints the new tree person `I1` and
  attaches sourced refs, including onto the *existing* `MJDL-Q8B` / `LVDV-6MK`.
- **call 86** — a **30-op** `person_evidence` batch across **three** persons:
  `MJDL-Q8B` 12, `I1` 11, `LVDV-6MK` 7.
- **call 141** — `I1`'s remaining 2 links; final count 32.

`person-evidence` had been read off disk at call 77 and was not invoked until
call 138 — for a different record. `same_person` was called **zero** times in the
whole 174-call run. The whole-run "was it invoked" check passed; only the
windowed check caught it. A blind human annotation independently downgraded the
run for the same underlying defect (the person was never pinned to an identity),
which is content-level corroboration that a skipped gate has genealogical
consequences, not just procedural ones.

**The sequence sets the enforcement point, and it is not the `person_evidence`
append.** The unscored identity claim commits at call 85's tree write, one call
*before* any `person_evidence` entry exists to gate. A gate binding only on the
pe append cannot catch the failure this example is the reference case for; a
design has to span `materialize_facts`'s create-and-enrich path too.

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

Deliberately independent — each catches something the others cannot, and none
depends on another shipping first.

| # | Layer | Binds in | Catches | Status |
|---|---|---|---|---|
| §5 | Write-boundary invariant | engine (MCP tool) — so Cowork, hosted, both harnesses | a tier claimed without a prior exhaustiveness declaration | **enforcing** |
| §6 | Raw-write lockdown | plugin hook (Cowork, hosted, wherever the plugin loads) + SDK hook (hosted) + e2e harness | writing the two project files without going through a validating tool | **enforcing** |
| §7 | Caller-attributed recency check | e2e harness only | a protected write with no recent successful invocation of its owning skill | **shadow only — permanently, unless a skill gains a completion signal** |
| §8 | Post-run compliance detectors | e2e harness only | a guardrail skill's effect in the final state with no invocation anywhere in the run | **enforcing (fails the run)** |
| §8 | Live pre-write `same_person` provenance check | e2e harness only (`pretool_hook`) | a `person_evidence` link for a brand-new tree person written before any `same_person` scored that identity | **shadow only** (opt-in `deny` per run) |
| below | Section ownership | unit harness only, and only inside a paid per-skill run | a skill writing a section of either project document that it does not own | **enforcing there, nowhere else** |
| §5 | Set-once project fields | engine (MCP tool) — so Cowork, hosted, both harnesses | a rewrite of `objective`, `title` or `subject_person_ids` after project creation | **enforcing** |

> **§6's "Reaches" claim is narrower than it looks — see §6.1.** Measured
> 2026-08-15: in Cowork with a connected folder the lockdown never fires, because
> project files are written through the **device bridge**, whose tool names its
> matcher does not cover — while `Write`, which it does deny, cannot reach the
> user's files at all. It denies the harmless operation and permits the real one.

### The ownership declaration: promoted out of Python, still not a hard deny

**Where it lives now.** `docs/specs/schemas/ownership.json` — 19 rows, one per
`(artifact, section)` pair across both project documents, loaded through
`eval/harness/harness/ownership.py`. It replaced two dict literals inside
`eval/harness/validators/test_universal.py`. Each row carries its owner (typed
`skill:` / `agent:`, or `null` with a stated reason), the full permitted caller
set, its writer tools, the enforcement planes it can be checked on, and what the
rule requires / what breaks without it / what the caller should do instead.

Three checks hold it, all free and all running on every push:

- `packages/engine/mcp-server/tests/packaging/ownership-manifest.test.ts` — every
  writable section of both schemas has exactly one row; every owner, caller and
  writer tool resolves to something that ships.
- `eval/harness/tests/unit/test_ownership_manifest.py` — the enforced writer sets
  still equal the pre-promotion literals, pasted in verbatim, plus the three
  declared deltas below. Each delta is a named constant a reviewer can look at.
- `eval/harness/tests/unit/test_universal_validators.py` — the *validators* still
  behave, called directly. They have to be, because `pyproject.toml` sets
  `testpaths = ["tests"]`: `validators/test_universal.py` is outside it, so its
  ownership and no-delete checks are never collected by `make harness-test` and
  their real pass/fail set appears only inside a paid per-skill run.

**What promotion did not change: it is still not a hard deny.** The rows are
enforced on exactly one plane — the harness's universal validator, inside a paid
per-skill eval run. Nothing keys on this manifest in Cowork, on the hosted path,
or at any writer tool. The measurement below is why.

#### Why a tool-boundary deny is still refused — measured

The two literals were the natural candidate for promotion to a write-boundary
deny. **Replayed over the committed corpus, 2026-08-15, they are not:**

> **3,466 of 7,238 write units (47.9%) would have been denied, and at least
> 1,345 of those denials (39%) are provably wrong** independent of who called —
> the section has no row at all, or its only declared owner is a skill the corpus
> never routes to.

**Root cause: there were two vocabularies.** The pytest check diffed the **11**
names in `REQUIRED_SECTIONS`; a tool-boundary deny sees `args.section`, whose
vocabulary is **14** (including the `plan_items` pseudo-section). Four keys
existed on one side only — `plan_items`, `evaluations`, `known_holdings`
(tool-only) and `localities` (table-only) — and those four account for **1,307 of
the 1,314 no-owner denials**. A third key, `log`, was in neither: it is written
by `research_log_append`, which has no `section` argument at all. The manifest
closes the vocabulary gap; what it does not close is everything below.

| Row | False denies | Why |
|---|---:|---|
| `plan_items` absent from the table | **1,134** | the tool defines the section; the table's own comment *blesses* the status flip it would deny |
| `evaluations` absent | 172 | a schema-required section; denying it kills the mandatory proof-critique |
| `hypotheses` → `{hypothesis-tracking}` | 31 | that skill is invoked **0 times in 154 runs** |
| three rows narrower than the prose table they mirror | 72 | incl. `questions` omitting `proof-conclusion` |
| `known_holdings` absent | 1 | the prose table declares owners; the code row is missing |

Repairing those drops the rate to 34.9%; the residue is dominated by attribution
artifact.

**Caller-dependent rows cannot be validated offline at all.** Where both signals
exist, Skill-proximity attribution **disagrees with measured `agent_type` 81
times against 40** — wrong about two thirds of the time. A `Skill` call has no
end marker, so every post-skill orchestrator write is charged to the last-named
skill; median gap 19 tool calls, p90 82, max 359.

**Four sections had no enforced owner at all**, from a separate writer census
over the same corpus. Each now has a row, and the right-hand column is what that
row says:

| Section | Observed | Row as promoted |
|---|---|---|
| `evaluations` | 230 ops, 114/154 runs; **32 of 34 attributable writes are the `gps-mentor` agent** | `agent:gps-mentor`, **no enforcement plane**. The harness check keys on the calling *skill's* name and cannot see an agent, so claiming a plane would deny the owner's own writes. The loader raises rather than silently dropping an agent caller |
| `localities` | 73 ops, 71 to `locality-guide` | `skill:locality-guide`, **newly enforced**. The paper row was always correct and had never once been evaluated — the check iterated `REQUIRED_SECTIONS`, which the section is not in |
| `known_holdings` | **zero successful writes corpus-wide** | `owner: null` with a reason. Writable through `research_append`, solicited by nothing; the paper owners the prose table named have never written it, and repeating them here would read as coverage |
| `researcher_profile` | **0 writes, non-empty in 154/154 sidecars** — every fixture seeds it | `owner: null` with a reason. **No tool can write it**; its only route is a raw `Write` the lockdown denies |

**How the declaration is keyed, and why.** On the **union** of three
vocabularies, because each alone leaves a hole: the two schemas' top-level
properties, plus the `plan_items` pseudo-section `research_append`'s `section`
enum defines. Keying on `RESEARCH_APPEND_SECTIONS` alone would drop `log` (written
by `research_log_append`, which takes no `section`) and `researcher_profile`;
keying on the schema alone would drop `plan_items`, the single largest source of
false denies in the replay above.

**Three writer-set changes, and no others.** `localities` is newly enforced, as
above. `assertions` loses `convert-dates`, a grant that was dead on arrival —
the skill's only tool is `convert_calendar`, it holds no writer tool, and none of
its 14 unit tests names `research_append` or `assertions`. A narrowing is the
direction that *can* break a run, which is why it was measured before it was
made. And `questions` gains `proof-conclusion`: the `status -> resolved` transition
it covers was owned by nobody — `proof-conclusion`'s body hands it to
`question-selection`, `question-selection`'s body hands it back, and 150
questions reached `resolved` across 154 runs from 11 different skill contexts.
The prose table, the write-boundary gate's remedy text, and the batches that
write a summary and its resolve together all name `proof-conclusion`. A widening
cannot newly fail a test; the matching skill-body edit is a separate change,
gated on that skill's paid run.

**Two declared contradictions that turn out not to be defects**, recorded rather
than repaired:

- `hypotheses` and `timelines` name skills the e2e corpus routes to **zero**
  times. The rows stay enforced because the unit corpus does exercise both — 14
  tests and 10 respectively.
- `citation` is allowed on research `sources` and forbidden on tree `sources`,
  while `research_append` mints a tree source in the same call, so **`citation`
  can never create a source**. Read as a structural impossibility when it was
  first measured; it is intended. citation's own description says it never
  creates source entries and routes a new record to record-extraction.

One name was checked and found already gone: 49 corpus writes are attributed to
`assertion-classification`, a skill that stopped shipping when extraction
absorbed it. It appears in no row, and the manifest lint now fails any owner or
caller that does not resolve to a shipped skill directory or agent file.

**A neighbouring gap, closed in the same change.** The list the ownership checks
used to iterate is also read by two *other* validators — no-entries-deleted and
id-references-resolve — so `localities`, `evaluations` and `known_holdings` were
exempt from the no-delete rule the prose ownership table states for all three.
All three sections are now in it.

Measured before it was switched on, the same way `localities` ownership was:
zero deleted ids in any section across 153 committed e2e runs, including the ten
sections already covered; 9 unit tests run against a scenario carrying entries in
any of the three; and all three sections require an `id`, which is what the check
keys on. What makes it close to free is upstream of the corpus, though —
`research_append`'s op enum is `append | update` with **no delete at all**, so
the only route to a deleted entry is a raw file write, which is already a
violation on two other counts.

The list was called `REQUIRED_SECTIONS` and was neither: it omitted `evaluations`,
which the schema does require, and it now carries two sections the schema makes
optional. It is the diff set, so it is named `DIFFED_SECTIONS`. It holds every
top-level property except `researcher_profile`, which is an object rather than an
array of id-bearing entries and so has nothing for either check to read.

### What is actually in the shadow-to-graduate pipeline

Measured over the whole corpus, `make e2e-guardrail-shadow SINCE=all`, 154 runs,
2026-08-16 — **the pipeline is not full of checks waiting on a measurement;
three of them have one, and it is zero:**

| Check | Fires | Status |
|---|---:|---|
| §7 caller-attributed recency | 811 (window 40), 127 runs | **retired permanently**, not queued |
| §8 live `same_person` provenance | **7**, 5 runs | the only graduatable check with a real rate |
| §7.5 citation-nulling (`find_citation_nulling_in_conclusions`) | **0**, 0 runs | never fired |
| §7.5 conflict-unpersisted (`find_unpersisted_conflict_resolutions`) | **0**, 0 runs | never fired |
| §7 warnings-unchecked (`find_relationship_writes_without_warnings_check`) | **0**, 0 runs | never fired |
| §11 unnamed-delegate (`find_protected_writes_by_unnamed_delegate`) | attribution reaches 15 of 154 runs | blocked on corpus growth |

**A zero fire rate is not a licence to graduate.** The citation-nulling check's
own graduation gate reads "only
if the rate is low enough that a fail is a signal and not a wall" — zero is not
"low enough", it is *nobody has seen this detector fire*. Graduating it promotes
an unexercised predicate to a hard failure.

**And nothing distinguishes the two readings of a zero:** either the behaviour
never occurs, or the detector is broken. That failure is already documented here
— the mentor-verdict arm read 0 where recomputation gives 8. **Before any of the
three graduates, it needs a synthetic fixture that makes it fire** — a positive
control, offline and free.

Read the status column literally. Only §5 and §6 restrain a real user's session
today; §7 and §8 are measurement over eval runs. §8 cannot port to production
until something is retained to detect against — the hosted path persists no
tool-call ledger.

**§7's status is a finding, not a queue position.** Its graduation was gated on a
false-positive rate that cannot be measured while its success gate reads `Skill`
launch acknowledgements — and no instrument available to the harness observes
skill *completion* (§7, "What the success gate can and cannot see"). Treat that
row as settled unless one of the four skills becomes something that emits a
completion signal; do not re-open it as a calibration task.

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
- Both counts are **branch-scoped** — they read `eval/runlogs/e2e/` in the
  current checkout, so a graded run committed on an unmerged branch is not
  skipped, it is never seen. Two are known to sit outside `main` today, one of
  them the first run to store live entries for this check at all. Read a rate
  off an up-to-date `main` with in-flight fixture PRs merged, or it is biased at
  the moment it is used.
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

## 5. Write-boundary invariants

### Set-once project fields

`objective`, `title` and `subject_person_ids` on the `project` singleton may be
written while unset and never rewritten. Empty counts as unset, per type — `""`
for a string, `[]` for a list — because `subject_person_ids` is seeded as an
empty array rather than omitted, so a truthiness test would refuse the first
legitimate write.

Implemented as `initOnlyFields` on the section config in
`packages/engine/mcp-server/src/tools/research-append.ts`. It exists because the
ownership declaration's own statement of the harm is "a skill rewrites the
objective, and every later skill plans against a changed goal it never agreed
to" — and that row's remedy, routing the change through `init-project`, was not
enforceable by anything.

**It constrains the system, not the researcher, and that is why it needs no
override.** ADR-0011's override tier says a doctrine gate must be overridable by
the human; here the override is the file itself. The raw-write lockdown binds
the agent, never a text editor, and preventing a person from editing their own
project is explicitly out of scope for this layer. The refusal message says so
outright rather than leaving the researcher to guess.

### Exhaustiveness before a proved tier

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
(issue #1129, closed not-planned) — all three stay. The three copies are
`packages/engine/plugin/hooks/guard_project_files.py`,
`apps/server/app/agent/real_agent.py`, and
`eval/harness/e2e/orchestrator.py`, and
`eval/harness/tests/unit/test_write_lockdown_parity.py` runs all three against
one vector set, so an addition to `PROTECTED_PROJECT_FILES` that lands in only
some of them fails `make harness-test`.

**Deliberate gaps.**

- **`Bash` is not covered.** All three copies of the guard match on `file_path`,
  so `cat > research.json`, `sed -i`, and `python -c` all get through. Skills run
  their stdlib-only scripts through `Bash` so it cannot be revoked, and matching
  command text would deny a legitimate `python script.py research.json > out`
  while still missing a variable-built path. A false deny is the worse failure
  mode: it turns a silent quality bug into a loud availability regression.

  Close this if a bypass appears in a runlog or a feedback case — and that
  condition is now **watched rather than asserted**. `make e2e-corpus` prints a
  `bash protected-file access:` census (`eval/harness/e2e/corpus_report.py`)
  over every committed e2e runlog: the total `Bash` calls naming a protected
  file, and the write-shaped subset named individually. It prints at zero too,
  so "nobody has touched these from the shell" cannot be confused with "the
  counter stopped running".

  **Measured 2026-08-09, whole corpus (`--since all`, 145 runs): 36 accesses,
  34 of them reads, 2 write-shaped — and both of those were refused before they
  ran.** The reads are `cat`, `wc -l`, `grep`, and `python3 -c json.load`
  inspecting the working files, which is the traffic §6 declines to pattern-match
  against. The two write-shaped calls are
  `victor-spenard-parents/run-2026-07-08_12-31-17.json` and
  `zuniga-rojas-parents/run-2026-07-09_19-45-45.json`, both a
  `cat > …/tree.gedcomx.json << 'EOF'` heredoc seeding a starting tree, and both
  answered `Permission to use Bash has been denied because Claude Code is
  running in don't ask mode`. So the corpus still holds **zero successful shell
  writes** to a protected file — but the earlier reading, that the shell route
  is never *attempted*, does not survive the measurement. The agent reaches for
  it; only the harness's permission mode stopped it, and that is not one of the
  three guard copies. Cowork runs `permission_mode: "default"` and the hosted
  path runs `bypassPermissions`, so neither environment has the thing that
  refused these two.

  This does not by itself close the gap — the false-deny argument above is
  unchanged, and no *landed* shell write has been observed. It does move the
  question from "has this ever happened" to "what stops it where the permission
  prompt does not", which is the form the next decision has to take.
- **`Read` is not revoked, and should not be** until there is a way to read the
  same data. `research_query` covers 11 of `research.json`'s ~15 top-level
  sections (missing `project`, `researcher_profile`, `known_holdings`,
  `localities`) and pages at 50 items per call — `offset` reaches items 51+,
  and `truncated` says when to use it. For
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
`eval/harness/tests/unit/test_e2e_tree_block.py`), and
`eval/harness/tests/unit/test_write_lockdown_parity.py` asserts the three
**agree** — extracting each copy's constant and predicate with `ast` and running
them against one vector set, so the next `PROTECTED_PROJECT_FILES` change cannot
land in one copy only.

### 6.1 The lockdown is inert — and inverted — in Cowork with a connected folder

**Measured live, 2026-08-15, on both macOS and Windows.** This is the most
consequential finding about §6 and it is not what the section above assumes.

In Cowork with a connected folder, the agent runs in a **cloud sandbox**
(`cwd` = `/home/claude`) and reaches the user's project **over the device
bridge**. Consequences, all observed rather than inferred:

- **`init-project` created both protected files through
  `mcp__remote-devices__device_commit_files`.** Across the run's 47 logged calls,
  `Write`, `Edit` and `NotebookEdit` appear **nowhere**. The guard's matcher is
  `Write|Edit|NotebookEdit`, so **it never fired** — and this was the ordinary
  onboarding path, not an agent improvising.
- **`Write` cannot reach the user's files at all.** It operates on the container
  filesystem; the staged copy of the connected folder is read-only. A `Write` to
  the user's `research.json` creates a *container-local* file, reports success,
  and changes nothing on disk.

So the lockdown **denies the operation that cannot do harm and permits the one
that can.** An unvalidated byte-level append to `research.json` landed on the
user's disk through the shell path during the same session.

**Route closure is possible, and was demonstrated.** A canary hook shipped in the
plugin denied both bridge write routes, before execution, with nothing written:

| tool | result |
|---|---|
| `mcp__remote-devices__device_bash` | **denied** |
| `mcp__remote-devices__device_commit_files` | **denied** |
| `Write` | denied |

That removes the doubt on which the 2026-08-11 deferral partly rested — a
name-matcher *does* bind against a registrar the plugin does not control. The
bridge surface is nine tools: `device_bash`, `device_commit_files`,
`device_stage_files`, `device_list_dir`, `device_request_folder_access`,
`get_device_info`, `create_artifact`, `list_artifacts`, `update_artifact`.

#### Closed 2026-08-17 — `device_commit_files` only

All three lockdown copies now cover `device_commit_files`, matched on the **bare
tail** (Cowork namespaces it and the plugin cannot control the prefix). It is
the route the ordinary onboarding path took, and the only one by which an
unvalidated write to a protected file has been observed reaching a user's disk.

Two properties, both deliberate and both pinned by vectors in
`eval/harness/tests/unit/test_write_lockdown_parity.py`:

- **Only the two project files.** A user asking Cowork to write any of their own
  files into a connected folder is not this guard's business, and content that
  merely *mentions* `research.json` is not a write to it — whole basenames are
  compared. Denying more would be a availability regression in exchange for
  nothing.
- **Fails open on an unrecognised payload.** The bridge's argument schema is not
  ours and is recorded nowhere in this repo — we know the tool's name and that a
  deny binds, not its shape. So the guard walks whatever arrives for path-like
  strings and, finding none, allows. **This is a real hole**, and it is the
  reason the closure is not proven by its tests: a live Cowork session is the
  only instrument that sees the true payload, exactly as with agent tool
  binding.

#### `device_bash` is still open, and a bypass through it LANDED — 2026-08-17

**Reproduced live, on request, in Cowork with a connected folder.** Asked to
append a note to `research.json` "using the shell or a file write", the agent did
exactly that — a `python open(path, 'w')` through `device_bash` — and the write
reached the user's disk.

The damage is worse than an unvalidated entry:

- The resulting document **failed schema validation on nine counts**: the entry
  carried none of the seven fields a log entry requires (`plan_item_id`,
  `performed`, `tool`, `query`, `outcome`, `results_examined`, `external_site`),
  carried three the schema forbids (`date`, `note`, `type`), and used an
  invented `lg_001` id where the prefix must be `log_`.
- **It locked the project out of the sanctioned tools.** Every writer validates
  the whole project before persisting, so a subsequent ordinary `research_append`
  returned `ok: false` on that same entry. One shell write did not merely skip
  validation — it made the tools that perform validation unusable until the
  entry was removed by hand.

**This falsifies the reasoning that kept the route open**, which is recorded here
rather than deleted, because the error is instructive. The argument was "0 landed
across the corpus". But every write-shaped shell attempt in the corpus was
refused by the **harness's** `dontAsk` permission mode — and this section already
said, in the paragraph above, that neither Cowork nor the hosted path has that
refusal. The corpus structurally could not record a landed write, so "0 landed"
measured where the light was. The close-condition stated here — *"close this if a
bypass appears in a runlog or a feedback case"* — is now met.

**What does NOT change: a command-text matcher is still the wrong instrument.**
`cat research.json` and `cat > research.json` remain indistinguishable without
parsing a shell; 37 of the 40 corpus touches are reads the system depends on,
because `research_query` covers 11 of ~15 sections and there is no tree query
surface at all; and a denial simply moves the agent to `head`, `python`, or a
path built from a variable — the harness's own denial text suggests as much.

**Chosen direction: make the FILE the unit, not the command.** Keep both project
files read-only on disk and have the shared write layer re-apply the mode after
each write. Measured on macOS: mode 444 blocks `>`, `>>`, `tee` and
`python open(w)` — including today's bypass — while reads still work and
`atomicWriteJson`/`atomicWriteBoth` still succeed, because they rename a temp
over the target and POSIX rename ignores the target's mode. The mode does not
survive the rename (it becomes 644), so re-applying it is the whole mechanism.

**The platform asymmetry is real, and it changes the design.** Measured
2026-08-17 with `packages/engine/mcp-server/dev/probe-readonly-project-files.ts`:

| | macOS | Windows |
|---|---|---|
| `fs.rename` over a **read-only** target | succeeds | **fails (EPERM)** |
| open for write / append | blocked | blocked |
| read | works | works |
| `chmod` back, then write | works | works |

So a design that leaves the files read-only and simply renames over them would
**break every sanctioned write on Windows** — the platform the genealogist team
runs. This is the third time that asymmetry has mattered here; the guard's own
path splitting was a silent no-op on Windows until someone noticed.

**The write layer must therefore unlock, rename, and re-lock**, not rename and
re-apply:

```
chmod(target, 0o644)      # no-op when the file does not exist yet
writeFile(tmp); rename(tmp, target)
chmod(target, 0o444)
```

Both halves are exercised by the probe's two `FIX:` lines — the first that the
sanctioned write still works, the second that protection survives it — and both
pass on macOS. **They must be run on Windows before this ships**; a pass on one
platform proves nothing about the other, which is the whole reason the probe
exists.

Two costs, both accepted rather than hidden. There is a microsecond window in
which the file is writable, which no agent is positioned to exploit. And the
mode is trivially removable by an agent that thinks to (`chmod` then write) — the
point is not a wall but converting a one-step accident into a two-step deliberate
act, which is what today's `python open(w)` bypass was.

**Write-shape matching is held back on purpose.** Denying the narrow, unambiguous
write forms a read-only file misses — `sed -i`, `mv` over the target, and an
explicit `chmod` — would close the rename-shaped residue. It is **not** being
built now (lead ruling, 2026-08-17): the file-mode approach covers today's
observed bypass, and the corpus cannot say how often the rename shapes are
reached for, so the matcher would be scope bought on speculation. Add it only if
a rename-shaped bypass is actually observed. Recorded so the residue is known
rather than forgotten.

**One route no matcher closes, and the spec should say so rather than imply
otherwise.** With every programmatic path denied, the agent wrote the file into
the container via `Bash` and delivered it to the user through `SendUserFile` for
manual placement. Nothing reached disk programmatically, so the lockdown held —
**its guarantee is over *programmatic* writes, not over the file's contents.** A
human placing a file is out of scope by design.

**A related boundary this layer does not provide.** `SendUserFile` is permitted,
and the session also holds Gmail `send_message` and Drive `share_file`. The
lockdown protects the *integrity* of the project documents; it says nothing about
*exfiltration*. Those are different guarantees.

### 6.2 What the `PreToolUse` payload actually carries

Recorded from a live Cowork session so nobody re-derives it:

```
cwd, effort, hook_event_name, permission_mode, prompt_id,
session_id, tool_input, tool_name, tool_use_id, transcript_path
```

- **`agent_id` is absent as a key on the main thread** and present inside a
  Task-spawned subagent — confirming in production the discriminator
  `context_policy.is_subagent_call` depends on.
- **`agent_type` for a plugin agent is NAMESPACED** —
  `genealogy-research:image-reader` — while a built-in reports bare
  (`general-purpose`). **A caller rule written as
  `agent_type == "record-extractor"` never fires in production**, and with a
  `deny unless ==` polarity it denies every caller including the owner.
- `permission_mode`, `session_id` and `transcript_path` are available and unused
  by anything today. `transcript_path` in particular means a hook has a handle on
  session history without keeping its own state — subject to its 20s timeout.
- The hook **cannot** read the project documents: `cwd` is the sandbox, and the
  connected folder is not mounted there.

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

  **What that buys, and what it does not.** `is_error` reports whether the *tool
  call* failed, which is not the same question as whether the *skill* succeeded:

  - **`Skill` — launch only.** Every `Skill` result in the committed corpus is a
    launch acknowledgement (`Launching skill: <name>`); the skill's work happens
    in later turns of the same session. So `is_error` on a `Skill` entry catches
    an unknown-skill-name launch failure and nothing else. **The
    invoke-then-let-it-fail evasion named at the top of this bullet stays open**,
    and the next block explains why it cannot be closed from here.
  - **MCP writer tools — thrown errors, and returned `{ok:false}`.** `src/index.ts`
    sets `isError` from its `catch`, and since #1282 also from a returned
    `{ok:false}` on the writer arms listed in `src/tool-result.ts`'s
    `OK_FALSE_IS_FAILURE` — so `research_append`'s `fail()` helper, which
    *returns* rather than throws, now records `is_error: true`. Runs predating
    that change carry the old classification and are `HARNESS_SCHEMA_VERSION` 3.
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

### What the success gate can and cannot see

This layer is shadow-only **permanently**, and the reason is not that nobody has
got round to the calibration. It is that the calibration has no instrument.

Graduating §7 was gated on a false-positive rate. That rate is not obtainable
while "did the skill succeed" is read off `Skill` entries, because those entries
carry launch acknowledgements — a census of the committed corpus returns 18
distinct values across 1,242 entries, all of the form `Launching skill: <name>`
plus one unknown-skill error. Three candidate instruments were checked and none
observes completion:

- **Trace-based** — between a launch and the next one, did the skill's own tool
  sequence appear? Measured over 358 guardrail-skill episodes
  (`make e2e-skill-episodes SINCE=all`): the highest-recall in-episode tool for
  **all four** skills is `research_append` — the protected write itself. A gate
  built on it would credit a skill for the very write §7 exists to gate. Nothing
  reaches recall ≥ 0.30 with precision ≥ 0.90; the best is `materialize_facts`
  for `person-evidence` at 0.84. And "launched, did nothing" has no ledger shape:
  empty episodes are 4 of 358, while the failure mode is an episode whose only
  event *is* the inline write, which is indistinguishable from success.
- **A `PostToolUse` hook** — the SDK does expose one (along with
  `SubagentStart`/`SubagentStop`), though `eval/harness/` registers only
  `PreToolUse` and `Stop`. It does not help: on a `Skill` call it fires at
  launch-ack, reporting exactly what `ToolResultBlock` already does.
  `SubagentStop` fires only for Task-spawned agents, and a `Skill` runs inline in
  the same session with no `agent_id` (§2).
- **A skill-side completion marker** — self-attestation, refused by the
  `match_score` precedent at the top of this section.

**What would change the answer:** giving a guardrail skill an identity that emits
a completion signal — i.e. converting it to an agent, which §9 costs out. Absent
that, do not re-open this as a tuning task; the window is not the variable. The
count barely moves from window 10 to 150 (§3), which was the early tell.

The window itself stays at 40 and the layer stays instrumented, because the
shadow signal is still worth having as measurement. What is retired is the
expectation that it graduates.

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
  and inlined, `person-evidence` (974 lines) and `conflict-resolution` (1007)
  would each set a new high-water mark for a plugin agent body — against
  `record-extractor`'s 894 today. `research-exhaustiveness` (413) and
  `proof-conclusion` (519) are the cheap candidates if this is revisited.

  **This is the only route that reopens §7.** An agent is the one form a
  guardrail skill can take that emits a completion signal (`SubagentStop`) and
  carries an `agent_id`, which is what §7's success gate has never had. Weigh
  that against #702 before dismissing it as attribution-only plumbing — but weigh
  #702 seriously too: it is a measured regression, not a theoretical risk.
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

**Status:** shadow only. Instrumented, never denied.

**Its gate is its own false-positive rate, not §7's.** This layer needs no
completion instrument — it keys on the caller's `agent_id`/`agent_type`, a fact
the PreToolUse hook stamps per call ("Why this needs no window", below). So the
finding that closes §7's graduation says nothing about this one. What it does
need is a sample, and the sample is thin: attribution rides only on runs made
after PR #1027, which is 6 of 145 committed runs, one of them carrying any
violation at all. Graduate on an accumulated count decided in advance — not on a
date, and not on that single run.

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
  of them bind in production; §9.4 points at what nothing checks
- `CLAUDE.md` — "Plugin hooks", "Cowork plugin agents"
- Issue #1054 — retain a hosted tool-call ledger, then port §8. The one open
  dependency named on this page; §8 cannot reach production without it.
