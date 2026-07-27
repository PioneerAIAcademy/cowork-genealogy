# Tree-Materialization Batching — Plan

**Project:** Cowork Genealogy — MCP server
**Status:** DRAFT, for review (dev + designer + genealogist)
**Goal:** Close the batching gap `#701` (tree materialization, 2026-07-18)
reopened — recover the e2e wall-clock regression it caused — without
speculatively re-editing skill prose before we know that lever still matters.
**Companion work:** `docs/plan/research-latency-reduction-plan.md` (the
general Phase 0/1/2 latency effort; its batch-append keystone landed for
`research_append`/`tree_edit` *before* `#701` shipped `materialize_facts`,
which never got the same treatment — this plan closes that gap and finishes
the Phase 0 loop that plan left open). `docs/specs/tree-materialization-spec.md`
(owns `materialize_facts`'s per-assertion contract — unchanged by this plan).
`docs/TODOs.md` "Batch `add_relationship`" (Tree materialization / #701
deferred section — addressed here, see §3.2 for a correction to its framing).

This supersedes two independent first-draft plans written in parallel
(`materialize-facts-batching-plan.md` and the original
`tree-materialization-batching-plan.md`); it keeps each draft's strongest
evidence and design work and corrects one factual error in the second draft
(§3.2).

---

## 1. Evidence

### 1.1 Cross-fixture regression, paired before/after (broad, quantified)

`make e2e-latency`, comparing each fixture's last pre-2026-07-16 run against
its first post-2026-07-20 run, shows a tight correlation between
`materialize_facts` call volume and wall-clock regression:

| fixture | `materialize_facts` calls (after) | wall-clock before → after |
|---|---|---|
| hannah-earnest-children | 44 | 90.6m → 92.7m (flat only because other tool use fell) |
| wilkins-marriage | 25 | 37.5m → 72.1m (**+92%**) |
| susan-miller-birth | 26 | 63.2m → 82.1m (**+30%**) |
| ferber-marriage | 8 | 42.3m → 62.1m (**+47%**) |
| mccarley-spouse | 5 | 39.1m → 43.6m (+12%) |
| cruz-corona-ancestry | 0 | 61.2m → 44.4m (−27%) |
| morris-jenkins-marriage | 0 | 67.6m → 33.1m (−51%, confounded — verdict dropped pass→partial) |

Every fixture calling `materialize_facts` heavily got worse; every fixture
that doesn't call it at all got faster (unrelated concision work landed the
same week). Heavy-use fixtures are structurally the ones with many personas
per research question — marriages, vitals, family reconstitutions.

### 1.2 One fully-instrumented run — where inside a run the time goes

Committed e2e runlogs don't normally retain raw session timestamps
(`.session.jsonl` is gitignored, best-effort). One local, not-yet-committed
run happened to still have it:
`eval/runlogs/e2e/spriggs-marriage-1926/run-2026-07-20_15-49-31.session.jsonl`.
Segmenting by `Skill` tool-use boundaries:

| Phase | Wall-clock | Share of run |
|---|---|---|
| person-evidence | ~11.0 min | 27% |
| proof-conclusion | ~6.8 min | 17% |
| **combined** | **~17.8 min** | **44%** |
| *(total run)* | *41.2 min* | *100%* |

Within those two phases: **person-evidence** made 5 `materialize_facts`
calls, 4 `same_person`, 3 `tree_edit` calls (one failed and was retried:
"Need source-refs on each relationship. Retrying with provenance"), plus one
mega-turn of ~188s thinking + ~60s streaming a single batched
`research_append` (45 `pe_` entries, ~20K output tokens). **proof-conclusion**
spent ~126s/7400 tokens on upfront reasoning before any write, ~43s
streaming its proof-summary `research_append`, and ~138s on the mandatory
gps-mentor proof-critique subagent call (a real, doctrine-required second
model call — not narration bloat).

### 1.3 Cross-run corroboration (35 committed runs since 2026-07-20)

Segmenting `transcript.md` by `Skill` boundaries across every committed e2e
run since 2026-07-20:

- `person-evidence` appears in 11/35 runs, `proof-conclusion` in 4/35 — most
  runs never reach these phases at all (they stall or exhaust budget
  earlier).
- Of the runs that do reach `person-evidence`, several then hit the 120-min
  wall-clock cap outright: `young-marriage-1828` timed out on **all three**
  attempts; `reese-children` and `ogletree-children` also timed out.
- The retry-tax pattern in §1.2 is not a one-off: `reese-children`'s
  person-evidence phase shows the identical "Need source-refs on each
  relationship. Retrying with provenance" failure, independently, on a
  batched 22-edge `tree_edit` call.
- `materialize_facts` calls per `person-evidence` invocation ranged 3–6 in
  small runs up to 30 in `reese-children` (11 new tree persons across three
  census years) — always one call per persona, never batched. This matches
  §1.1's fixture-level counts (25–44 calls on the worst-hit fixtures).

Full diagnosis (including the two confounded "wins" and secondary levers
this plan does not address) is also in project memory
(`proj_e2e_perf_bottlenecks.md`).

---

## 2. Goals / non-goals

**Goals**
- Remove the per-persona / per-edge round-trip tax from the tree-
  materialization write path (`materialize_facts`, `tree_edit
  add_relationship`), matching the batching contract `research_append`
  already has.
- Close the source-ref retry tax on relationship writes.
- Answer, with real before/after evidence, whether prose concision on
  person-evidence/proof-conclusion's SKILL.md actually moves e2e wall-clock
  — before writing more of it.

**Non-goals**
- Removing the mandatory gps-mentor proof-critique call, or any other GPS
  doctrine gate. That cost is legitimate.
- Re-architecting the person-evidence / proof-conclusion pipeline or GPS
  workflow.
- Chasing tool/API latency — per the companion plan, that's already ~0% of
  wall-clock.
- Touching the `search-records` nil→full-text pivot or the `image-reader`
  subagent delegation. Both are **deliberate correctness fixes for real bugs**
  (missed probate records; a base64-accumulation crash), not oversights — their
  cost is the intended trade-off of the fix, not a gap to close. Revisiting
  either means re-litigating a chosen recall/crash-safety trade-off, which is
  out of scope here on purpose, not on a backlog.
- The `search-staging-integrity` hard-gate's false-positive rate is a
  genuinely open question (unlike the two above, nobody has instrumented
  whether it rejects compliant calls) — but instrumenting it is its own small
  investigation, not something this plan's evidence supports doing blind.
- Reopening any of `materialize_facts`'s per-assertion semantics (fact
  identity, conflict-surfacing rules, `primary`/`preferred` ownership,
  spec §4.2–§4.4) — only call *shape* changes.

---

## 3. Root causes, ranked by evidence strength

### 3.1 `materialize_facts` takes one persona per call — no batch input

`MaterializeFactsInput` (`src/types/materialize-facts.ts`) is:

```ts
export interface MaterializeFactsInput {
  projectPath: string;
  personId?: string;
  recordId: string;
  recordRole: string;
}
```

No array field. Every other tree/research writer already solved this:
`research_append` and `tree_edit` (and `extraction_append`, which delegates
to `research_append`) accept a top-level `ops: [...]` array — validate once,
write once, all-or-nothing. `materialize_facts` shipped 2026-07-18 (`#701`)
*after* that convention was established and didn't pick it up.
`person-evidence/SKILL.md` §5 makes the cost concrete: "for each persona —
the subject *and* each sibling/spouse — call `materialize_facts`," i.e. one
call per household member. The spec's own §13 open-items section anticipated
an input-shape question but framed it as an `assertionIds[]` variant for
narrowing *one* persona's assertions — a different axis from what actually
bit us (batching *many* personas in one call).

### 3.2 `add_relationship` household edges — a skill-prompt gap, not a tool gap

`docs/TODOs.md` carries this as "Batch `add_relationship`," deferred from
`#701`, framed as needing new tool capability. **That framing is out of
date: `tree_edit`'s existing `ops[]` batch mechanism already supports
multiple `add_relationship` ops in one validated, atomic call today** —
confirmed directly against `tests/tools/tree-edit.test.ts` (e.g. lines
950/1012/1020/1037, which already exercise multiple relationship ops inside
one `ops` batch, including one op's edge referencing another op's
just-minted person id). The tool need not change.

What's actually missing is that `person-evidence/SKILL.md` §7 step 4
("Write the edges") never instructs collecting a household's edges into one
`tree_edit({ ops: [...] })` call — it reads as "write ... via `tree_edit
add_relationship`" with no batching language, and the runlog evidence (§1.2,
§1.3) confirms the skill in practice issues one call per edge (~7-9 for a
census household). **This closes as a SKILL.md rewrite, not a tool change** —
materially cheaper than the TODO implies. Retire the `docs/TODOs.md` item
once the rewrite lands.

### 3.3 A missing source-ref default costs a guaranteed retry

Two independent runs (spriggs, reese-children) show the first
`add_relationship` call in a session omitted a required source-ref and had
to be retried in full — the tool already enforces "the added relationship
edge must carry a non-null source-ref" and "each Couple fact must carry a
non-null source-ref" (tested at `tree-edit.test.ts:854`, `:868`), correctly,
but the model reliably gets it wrong on the first attempt. Options, needing
a real design decision rather than a quick patch:
  - (a) Have `tree_edit` resolve the ref itself given a reference (mirroring
    `materialize_facts`'s own `resolveSourceRef`: `assertion.source_id →
    research source → tree S-entry`) instead of requiring the model to walk
    that chain and supply the literal ref inline.
  - (b) If the model must keep supplying it explicitly, surface the
    requirement more visibly (schema description, worked example) *before*
    the first attempt rather than only on rejection.
  Investigate against `docs/specs/tree-edit-tool-spec.md` before building;
  a wrong default could silently attach incorrect provenance, so this is not
  a place to guess.

### 3.4 Batching cuts round-trips, not generation time — a separate lever

Even the *correctly*-batched final `research_append` in §1.2 (45 `pe_`
entries in one call) still cost ~60-90s of raw token streaming to emit the
payload. Tool-call batching removes per-call fixed overhead (context
re-processing, validate, write); it does not shrink how long the model
takes to generate a given amount of output. Set expectations accordingly:
Phase 1 below recovers the round-trip tax, not necessarily all of it.

### 3.5 person-evidence's prose never got the concision pass proof-conclusion did

person-evidence/SKILL.md is 658 lines; proof-conclusion's is 205, already
trimmed once (PRs #582/#583, measured **−44%** output tokens at the
unit-test level). Whether that cut ever showed up in e2e wall-clock was
never confirmed — the companion latency plan's own next step, "confirm
#578 compounds to e2e (kenneth run)," was left open. **Do not assume prose
concision is still the right lever for person-evidence until that question
is answered** (§5, Phase 0 and Phase 4).

### 3.6 gps-mentor's ~138s proof-critique call is legitimate, not waste

Doctrine-required (a real second model call reviewing the conclusion), out
of scope for removal. Worth carrying as a known fixed cost in any
re-measurement so it isn't later mistaken for a lever.

---

## 4. Design

### 4.1 `materialize_facts` batching — mirror `tree_edit`'s `ops[]` exactly

`tree_edit`'s batch form (`src/tools/tree-edit.ts:558-625`,
`executeTreeOps`) is the direct precedent:

- `TreeEditInput extends Partial<TreeEditOp> { ops?: TreeEditOp[] }` —
  supply either the single-op top-level fields, or `ops` (which wins when
  present).
- One `sanitizeTree` read, one `research.json` read.
- Loop over `ops` against the **same in-memory tree object**; ids minted by
  an earlier op are visible to later ops for free — `nextId` is a pure
  `max(doc, prefix) + 1` scan over the live document (`gedcomx-ids.ts:35-37`,
  confirmed by reading it), no extra plumbing needed.
- On any op's failure: nothing written, error is `ops[i]: <msg>`.
- One `validateParsed`, one `backupIfExists` + `atomicWriteJson` for the
  whole batch.
- Returns `results: [...]`, one entry per op.

**`materialize_facts` batching is simpler than `tree_edit`'s**, because
`materialize_facts` never writes relationships and never links two persons
together (spec §4.5) — each op only ever touches one target person's own
facts/names. Unlike `tree_edit`'s `add_person` → `add_relationship` chains,
there is no cross-op *data* dependency to design for, only the shared
mutable tree + id-allocator state `tree_edit` already proves works.

Proposed shape:

```ts
export interface MaterializeFactsOp {
  personId?: string;
  recordId: string;
  recordRole: string;
}

export interface MaterializeFactsInput extends Partial<MaterializeFactsOp> {
  projectPath: string;
  /** Batch form — supply ops; when present the single-op fields above are
   *  ignored. Applies every op to one in-memory tree, validates ONCE,
   *  writes ONCE — all-or-nothing. */
  ops?: MaterializeFactsOp[];
}
```

Result: keep today's single-op result shape unchanged (back-compat); add a
batch result `{ ok: true, results: MaterializeFactsOpResult[], filesWritten,
validation }`, where each element is today's per-call payload (`personId,
created, factsAdded, factsEnriched, namesAdded, refsAttached,
conflicts_surfaced`) — mirrors `tree_edit`'s `results: [{operation,
assignedIds}]`.

**Open naming decision:** call the array `ops` (family-wide consistency with
`research_append`/`tree_edit` — every batchable tool uses that name, so a
caller pattern-matches "batch = `ops[]`" everywhere) or `personas` (more
domain-honest here, since `materialize_facts` has exactly one implicit
operation — there's no `operation` field to disambiguate, unlike
`tree_edit`). Recommendation: **`ops`**, for cross-tool consistency; either
is fine mechanically. Flag for reviewer sign-off, not left ambiguous into
implementation.

This is the actual latency win: the fixed cost per call (context
re-processing on every turn, one `sanitizeTree`, one `research.json` read,
one `validateParsed`, one atomic write) is paid once per batch instead of
once per persona.

### 4.2 `add_relationship` batching — no tool design needed (§3.2)

Nothing to design; the mechanism exists. Only the skill instruction changes.

### 4.3 Source-ref default (§3.3) — design decision deferred to Phase 3

Not pre-decided here; investigate options (a)/(b) against the tree-edit
spec before writing code (§3.3).

---

## 5. Phases

### Phase 0 — Re-measure gate (do first)

Only one run in the whole corpus had a raw, timestamped session transcript
(§1.2), and it was found by accident — not yet committed, about to be
gitignored away. Before sizing later phases by feel:
- Deliberately capture `.session.jsonl` (already produced best-effort by
  `orchestrator.py`, just not normally kept) for 2-3 representative runs
  that reach `person-evidence`/`proof-conclusion` — commit them next to
  their runlog as the evidence base, the way `kenneth-quass-death` served
  the companion plan's own Phase 0.
- This is the moment to close the companion plan's dangling item: does the
  earlier proof-conclusion prose cut (−44% unit-level output tokens) show
  up in e2e wall-clock at all? If it doesn't, that's useful evidence that
  tool-level batching (Phase 1-2) is the real lever here, not more prose
  editing — which directly gates Phase 5.

**Deliverable:** a short before-numbers note (§1.1/§1.2 baseline, explicitly
including the dangling-question answer), dropped next to this plan.

### Phase 1 — `materialize_facts` batching (highest leverage; most directly implicated in the dated regression)

1. **Refactor, no behavior change.** Extract the body of today's
   `materializeFacts` into a pure helper —
   `applyMaterializeOp(tree, research, op): MaterializeFactsOpResult` — that
   mutates the shared in-memory `tree` and returns the per-op result
   fields. `materializeFacts` itself becomes: read tree + research once,
   call the helper once, validate once, write once, return the single-op
   shape unchanged. All 13 existing tests in
   `packages/engine/mcp-server/tests/tools/materialize-facts.test.ts` must
   pass with no changes to their expectations — proof the refactor is
   inert before batching is added.
2. **Add the batch branch**, mirroring `tree-edit.ts:586-625` structurally:
   `ops` present → loop calling `applyMaterializeOp` per index inside a
   try/catch reporting `ops[i]: <msg>` and writing nothing on failure →
   validate once → `backupIfExists` + `atomicWriteJson` once → return
   `{ ok: true, results: [...] }`.
3. **Schema/description.** Update `materializeFactsSchema` to document
   `ops`, mirroring the paragraph `tree-edit.ts:683-688` adds to its own
   schema description.
4. **Dev smoke script.** Add a batch example to `dev/try-materialize-facts.ts`.
5. **Unit tests**, numbered continuing from the existing 13, mirroring
   `tree-edit.test.ts`'s batch suite one-for-one:
   - **(14)** a batch of 2+ personas across different records/roles writes
     once (single `.bak`, single `validateParsed` call).
   - **(15) all-or-nothing:** op 2 references a persona with no tree
     S-entry (today's existing error case, #7) → nothing written, error is
     `ops[1]: ...` — mirrors `tree-edit.test.ts:1047`.
   - **(16) id-allocator continuity:** two create-or-enrich ops in the same
     batch (both omit `personId`) mint two *distinct* person ids in order —
     mirrors `tree-edit.test.ts:1012`, adapted since `materialize_facts` ops
     don't reference each other's ids, they just must not collide.
   - **(17)** `conflicts_surfaced` is scoped per-op, not leaked across ops
     in the same batch.
   - **(18)** idempotency holds inside a batch: the same persona listed
     twice in one `ops` array behaves like two separate calls today (#3).
   - **(19)** a JSON-stringified `ops` array is coerced, mirroring
     `tree-edit.test.ts:1076` (`coerceJsonArg`) — check whether
     `materialize_facts` already runs input through it; if not, add it.
6. **Skill update.** `person-evidence/SKILL.md` §5 ("Materialize every
   member, per persona") — rewrite to collect every household member
   needing materialization after the `merge_warnings` coherence gate
   clears, and issue **one** `materialize_facts({ ops: [...] })` call.
   Single-new-person stub creation can stay a single-op call (no batching
   win at n=1).
7. **Spec update.** `docs/specs/tree-materialization-spec.md` §4.1 gains the
   batch contract; §13's open item gets updated to record that the real
   need arrived (this regression) and what was built.

### Phase 2 — `add_relationship` batching (skill-only; do alongside Phase 1's skill work)

Rewrite `person-evidence/SKILL.md` §7 step 4 ("Write the edges") to collect
a household's parent-child + spouse edges and issue **one**
`tree_edit({ ops: [...] })` call instead of N. No tool change (§3.2/§4.2).
Retire the `docs/TODOs.md` "Batch `add_relationship`" item once landed,
noting in the closing commit that the fix was a skill-prompt change, not
new tool capability.

### Phase 3 — Source-ref default investigation (small; do before or alongside Phase 2, same call surface)

Resolve the §3.3/§4.3 design decision, then implement whichever option is
chosen. Route through the same rigor as any schema-adjacent change (the
three-places rule if it ends up touching `research.schema.json` or
`tree-shape.ts`'s allow-lists — expected not to, but confirm).

### Phase 4 — Verification / re-measure (the actual acceptance test)

Aggregate e2e averages are misleading (§1.1 — some regressions were masked
by unrelated wins, some "wins" were confounded by quality drops). Do both:
- **Targeted fixture re-runs:** wilkins-marriage, susan-miller-birth,
  hannah-earnest-children, ferber-marriage, mccarley-spouse through `make
  e2e-latency` before/after. Success bar: `materialize_facts` call count
  drops from ~(personas × records) to ~(materialization steps, typically
  one per household/record); `tree_edit` call count for edges drops
  similarly; wall-clock on these fixtures moves back toward its
  pre-2026-07-16 baseline. Confirm verdicts don't regress as a side effect
  of the skill rewrites — two "fast" runs in the original diagnosis turned
  out to be quality regressions (pass→partial) rather than genuine
  speedups; this fix must not add a third.
- **Re-capture the instrumented per-skill breakdown** (§1.2's method) on a
  late-stage-reaching fixture (e.g. `kenneth-quass-death` or
  `spriggs-marriage-1926` again) and diff against §1.2's numbers — this is
  also where Phase 0's dangling "-44% compounds to e2e?" question finally
  gets answered, informing whether Phase 5 is warranted at all.

### Phase 5 — person-evidence prose concision (conditional; do NOT start before Phase 4 answers whether it matters)

Only if Phase 4 shows deliberation/output-token volume — not round-trips —
is still the dominant remaining cost in person-evidence. If warranted,
apply the same pass that took proof-conclusion to 205 lines: scope
narration to user-facing output, cut re-derivation of what tools already
encode, keep precision over silence. Do not spend this lever speculatively
(§3.5) — this is exactly the trap the companion plan's own unresolved item
represents if skipped.

---

## 6. Risks

- **Refactor risk (Phase 1, step 1):** extracting today's single-op logic
  into a shared helper must not change existing behavior — mitigated by
  running the full existing 13-test suite unchanged before adding any
  batch-specific test.
- **Ordering sensitivity within a batch:** two ops in one
  `materialize_facts` call can legitimately interact — e.g. op A
  materializes a competing Birth date, op B's persona (same target person)
  now sees op A's fact when checking for conflicts. This is correct and
  already happens today across two *separate* calls (assertions accumulate
  onto a person across records); it just now happens inside one call.
  Covered by Phase 1 tests (17)/(18), not a new hazard, but worth a
  deliberate test since it was previously separated by a disk round-trip.
- **Re-touches a one-month-old tool and its evals.** `materialize_facts`
  and its `eval/tests/unit/person-evidence/` fixtures are recent (`#701`,
  2026-07-18); budget eval re-validation alongside the tool change, not
  just the code change. Same applies to the person-evidence SKILL.md
  rewrites in Phases 1 and 2 — re-run the person-evidence unit suite, not
  just smoke-test it.
- **Source-ref default (Phase 3) needs a real design call**, not a quick
  patch — a wrong default could silently attach incorrect provenance to a
  relationship.
- **Skill-prompt under/over-batching risk (Phases 1, 2):** if the rewrites
  under-specify when to batch, the agent could miss the batching
  opportunity (no regression, just no win) or try to batch across
  households it shouldn't (no correctness risk — ops are independent per
  persona/edge — just wasted opportunity if overly conservative). Low risk
  either way; verify via Phase 4.
- **Don't let Phase 5 run ahead of Phase 4.** The companion plan's own
  unresolved item (does the 44% unit-level proof-conclusion cut show up in
  e2e?) is exactly the trap Phase 5 could repeat if the gate is skipped.

---

## 7. Build order

1. **Phase 0** — capture deliberate before-numbers (cheap, unblocks
   everything else's acceptance criteria).
2. **Phase 1** — `materialize_facts` batching (highest leverage, most
   directly implicated in the dated regression).
3. **Phase 2** — `add_relationship` batching (skill-only, do alongside
   Phase 1's skill-rewrite work since both touch person-evidence's
   household-materialization steps).
4. **Phase 3** — source-ref default (small; same call surface as Phase 2).
5. **Phase 4** — re-measure (targeted fixtures + instrumented breakdown;
   answers the dangling prose-concision question).
6. **Phase 5** — only if Phase 4 says so.

---

## 8. Follow-up ideas (not in scope)

- `eval/harness/e2e/latency_report.py` (`make e2e-latency`) reports whole-run
  numbers only; it has no per-skill-phase breakdown, which is why §1.2/§1.3's
  evidence came from ad hoc transcript segmentation by hand rather than a
  reusable tool. A `--by-skill` mode reading `Skill` tool-use boundaries the
  way this plan's analysis did would make Phase 0/4's re-measurement (and
  any future latency work) much cheaper to repeat.
- Whether the `search-staging-integrity` hard-gate has a real false-positive
  rate is worth instrumenting at some point (§2) — that's a genuine open
  question, unlike the `search-records` pivot and `image-reader` delegation
  (§2), which are settled trade-offs, not follow-ups. Don't lump those two in
  with this one; they aren't on any backlog.

---

## 9. References

- `docs/plan/research-latency-reduction-plan.md` — the general latency
  effort this plan follows on from.
- `docs/specs/tree-materialization-spec.md` — owns `materialize_facts`'s
  contract (§4); §13 anticipated an input-shape question this plan resolves.
- `docs/specs/tree-edit-tool-spec.md` — the batching precedent (`ops[]`)
  this plan mirrors; also owns `add_relationship`'s source-ref requirement
  (§3.3/Phase 3).
- `docs/TODOs.md` — "Batch `add_relationship`" (Tree materialization / #701
  deferred section) — corrected and closed by Phase 2.
- `packages/engine/mcp-server/src/types/materialize-facts.ts`,
  `packages/engine/mcp-server/src/tools/materialize-facts.ts` — current
  (unbatched) implementation.
- `packages/engine/mcp-server/src/tools/tree-edit.ts:558-625,683-688` — the
  `executeTreeOps` batching precedent.
- `packages/engine/mcp-server/tests/tools/tree-edit.test.ts:950,1012,1020,
  1037,1047,1076` — existing batch-op tests proving `add_relationship`
  already batches today, and the patterns Phase 1's new tests mirror.
- `eval/runlogs/e2e/spriggs-marriage-1926/run-2026-07-20_15-49-31.session.jsonl`
  — the instrumented run behind §1.2 (not committed; Phase 0 captures a
  deliberate replacement rather than relying on this accidental one).
- `proj_e2e_perf_bottlenecks.md` (project memory) — the full cross-fixture
  diagnosis behind §1.1, including the two confounded "wins" and the
  secondary levers out of scope here.
