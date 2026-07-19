# Research-Latency Reduction — Plan

**Project:** Cowork Genealogy — AI genealogy research assistant
**Status:** DRAFT, for review (dev + designer + genealogist)
**Goal:** Roughly halve the agent-controllable wall-clock of a single research
session, without removing safety gates on irreversible/external actions and without
re-architecting the skill pipeline.
**Companion work:** the research-latency quick wins — two changes that should land
*before* this plan's measurement gate.

---

## 1. Baseline — and why it is already stale

The decomposition below comes from the timestamped Claude Code transcript of the
Kenneth Quass session (a real research run). It is the evidence that motivates this
work — **and the reason Phase 0 exists.**

**Wall-clock (one 19-min human walk-away removed → ~37 min of real session):**

| Bucket | Share of active work |
|---|---|
| Model generation (thinking + writing + tool-call args) | **~90%** |
| Human turnaround (confirmation "yes" gates, ex-walkaway) | ~8% |
| **Tool / API latency** (FamilySearch, MCP) | **~0%** |

The two phases that dominate model time:

| Phase | Model time | Model turns | Thinking volume |
|---|---|---|---|
| record-extraction | 12.7 min | 68 | 38k chars |
| search-records | 11.3 min | 89 | 28k chars |

Two mechanical drivers: **turn count** (241 model turns; many from sequential
`Edit`/`validate`/`ToolSearch` round-trips) and **thinking volume** (~21k tokens of
reasoning, including a dead-end exploring an invalid `no_evidence` enum).

**The stale-baseline caveat (load-bearing).** This run is dated **2026-06-18**. The
persistence-tool migration shipped **2026-06-19**: five validate-before-persist atomic
write tools (`research_append`, `research_log_append`, `tree_edit`,
`merge_record_into_tree`, `merge_tree_persons`) and a rewrite of 7 of 8 write-heavy
skills to use them, which **dropped the separate `validate_research_schema` calls and
the array-re-serialization through `Edit`**. That removed a large slice of the turn-count
driver above. So the numbers that should set this plan's *priorities* are partly
obsolete: we do not know whether the dominant remaining cost is now write-mechanics
(turn count) or deliberation (thinking). **Speccing the optimizations against the
2026-06-18 numbers would risk optimizing the wrong thing.** Hence Phase 0.

(One headline finding is *not* stale and reframes the whole effort: tool/API latency
is ~0. This is not a "make the searches faster" problem; it is a "make the model
generate less, in fewer round-trips" problem.)

---

## 2. Goals / non-goals

**Goals**
- Halve the agent-controllable time (≈ model-generation time) of a representative
  research session.
- Complete the half-built persistence-tool architecture so no skill hand-edits JSON.

**Non-goals**
- Removing safety gates on irreversible or external actions (e.g. the user-capture
  step in `search-external-sites`). Those stay.
- Re-architecting the skill pipeline or the GPS workflow.
- Faster FamilySearch/MCP calls — latency is already ~0; not the bottleneck.

---

## 3. Phase 0 — Re-measure (the gate)

**Do this before sizing Phase 2.** Phase 1 (structural) may proceed in parallel because
it is sound regardless of the numbers; Phase 2 (behavior tuning) priorities are
**gated** on this.

- Re-run the existing e2e fixture `eval/tests/e2e/kenneth-quass-death` against the
  **migrated** skills (post-2026-06-19), in `real` agent mode.
- Capture the session transcript JSONL from the sandbox
  (`/home/user/.claude/projects/-project/<session-id>.jsonl`; the session id is in
  `/project/.agent_session`) — note this is now also bundled into web feedback, per the
  feedback-transcript change.
- Decompose with the same method used for the baseline: total wall-clock; model-gen vs
  tool-latency vs human-turnaround; per-phase model time, turn count, and thinking
  volume; top single gaps.

**Deliverable:** a short post-migration baseline doc (drop it next to this plan).
**Decision it drives:** if write-mechanics (turn count) still dominates →
prioritize Phase 1c (batch-append). If deliberation (thinking) dominates → prioritize
Phase 2a (thinking/narration). Likely both contribute; the measure says in what ratio.

---

## 4. Phase 1 — Tool-coverage completion (sound regardless of measurement)

The migration left three hand-edit gaps and one ergonomics gap. Closing them finishes
the persistence-tool architecture and removes the last JSON hand-edits.

### 1a. `tree_edit`: `add_source` / `update_source`
**Delivered by the quick-wins work.**
Removes the hand-written tree `S` entries in `record-extraction` and `proof-conclusion`.
Listed here for completeness of the coverage map; assumed already landed.

### 1b. `project` / `researcher_profile` writer
**Problem:** `research_append` operates on **arrays of ID'd entries**; the `project`
header and `researcher_profile` are **singleton objects**, so they have no write tool.
Today `proof-conclusion` hand-edits `project.status`/`project.updated`, and
`init-project` hand-writes the whole `project` block + `researcher_profile`.

**Proposed:** a small dedicated tool (e.g. `research_set`) — or a special-cased
`research_append` mode — with **update/merge-only** semantics on these singletons:
no append, no ID allocation, shallow-merge supplied fields, stamp `project.updated`,
validate-before-persist + atomic write. Sections: `project` (settable: `objective`,
`status`, `title`; `updated` tool-owned) and `researcher_profile`
(`experience_level`, `subscriptions`, `narration_guidance`).

**Risk:** medium-low. New (or extended) tool surface; singleton semantics differ from
`research_append`'s array model, so keep it a distinct path to avoid muddying the
array-append contract. Per the three-places rule in CLAUDE.md, any schema touch must
update `research.schema.json`, `research-schema-spec.md`, and `validator.ts` — but this
adds no fields, only a writer, so likely no schema change.

### 1c. `research_append` batch append (`entries[]`)
**Problem:** `research_append` writes **one entry per call** (`record-extraction` calls
it "once per fact" — ~29 assertion calls + 5 source calls; `person-evidence` ~31 calls).
Each is a model turn. This trades the old array-re-serialization tax for per-entry turn
overhead.

**Proposed:** add an optional `entries: [...]` to the `append` op (alongside the
existing single `entry`): validate the whole batch once, **all-or-nothing**, allocate
ids sequentially, and on failure return the **per-entry index** that caused it. Adopt
in `record-extraction` (assertions), `person-evidence` (pe entries), and
`research-plan` (plan_items).

**Risk:** medium — this re-touches **freshly-migrated** skills and their evals
(re-validate the `skill-rewrites-for-persistence-tools` test suite). The tool change
itself is additive (existing single-`entry` callers unaffected). **Magnitude is
measurement-dependent** — if Phase 0 shows deliberation dominates, this saves fewer
minutes than the turn count suggests. Size it after Phase 0; it is the clearest
turn-count lever if turn count still dominates.

### 1d. Migrate `init-project`
**Problem:** `init-project` is the one un-migrated write-heavy skill — it hand-writes
both `research.json` and `tree.gedcomx.json` from scratch (manual `I`/`N`/`F`/`R`/`S`
id allocation) and still calls `validate_research_schema` separately.

**Proposed:** rewrite it to use `tree_edit` (`add_person`/`add_fact`/`add_source`) +
the 1b writer (`project`/`researcher_profile`) + `research_append` (any seed
sources/assertions), and drop the separate validate. **Depends on 1a + 1b.**

**Risk:** highest in Phase 1 — `init-project` is the project bootstrap; a regression
breaks every session. Land it **last**, behind unit tests and an e2e smoke. Time-wise
it was small in the baseline (~1.3 min ex-walkaway), so this is for consistency and
correctness, not raw speed.

---

## 5. Phase 2 — Behavior tuning (sized after Phase 0)

Priorities here depend on Phase 0's breakdown. All three target model-generation time
directly.

### 2a. Thinking / narration precision
The novice narration guidance ("narrate the why, define every term, err toward more
context") inflates both visible output and, indirectly, deliberation. The user's own
feedback was *"it did great, just too long."*
- The enum-pinning in the quick-wins spec is the first, safe slice (kills the
  `no_evidence` dead-end).
- Beyond that: scope novice narration to **user-facing output**, not internal thinking;
  cut re-derivation of analysis the tools/skills already encode. This interacts with
  the in-flight **SKILL.md shortening work** — coordinate
  so the two efforts don't fight.
- Tradeoff: do not gut the teaching value — the complaint is verbosity, the fix is
  *precision*, not silence. This is the lever most likely to move the needle if Phase 0
  shows deliberation dominates.

### 2b. Round-trip reduction
- **MCP-tool preloading:** the run spent ~11 turns on `ToolSearch` (one per deferred-tool
  load). Pre-loading the always-used genealogy tools would remove them — **but the
  mechanism is runtime-dependent**: `allowed-tools` SKILL.md frontmatter is honored
  by **Cowork** but **silently ignored by the Agent SDK** (the hosted-web path). So this is "investigate the deferral knob per
  runtime, then apply where controllable," not a confident win. Verify first.
- **Batch adaptive search retries:** `search-records` fired the wildcard + broad-fallback
  searches as separate sequential turns. Where the broadening is not data-dependent,
  issue them together (as `research-plan`'s locality survey already does). Lower
  confidence — the broadening is partly adaptive — so measure the realized turn savings.

### 2c. Auto-chaining the pipeline — DESIGN-REVIEW ITEM (not a foregone optimization)
The agent stops for a "yes" confirmation between every skill (question-selection →
research-plan → search-records …), each adding a human round-trip **and** a fresh
skill-load turn that re-reads the skill's reference docs. Auto-chaining the pipeline
when the user has already committed to researching a person would remove both.

**But this is a UX/safety call, not a pure speed change.** The persistence ops here are
reversible and local (so these gates are UX-pacing, not safety gates on irreversible/
external actions — those, like `search-external-sites`' user capture, stay regardless).
Whether to auto-chain, and how much to narrate while doing so, trades against the
"simple, predictable UI" and "user stays in control" values. **Route through
`plan-design-review`** before building.

---

## 6. Risks & tradeoffs (cross-cutting)

- **Stale baseline (the big one):** Phase 2 priorities are unknown until Phase 0. Do
  not commit Phase 2 sizing on the 2026-06-18 numbers.
- **Batch-append churn:** 1c re-touches skills migrated only days ago; budget eval
  re-validation, not just the tool change.
- **Enum/vocabulary drift:** pinning enums in prose (quick wins) must cite
  `research-schema-spec.md` as canonical.
- **Narration trim vs novice value:** precision, not silence.
- **Auto-chain vs UX/safety:** designer's call; keep gates on external/irreversible
  actions.
- **Singleton-writer semantics (1b):** keep distinct from the array-append contract.

---

## 7. Build order

1. **Quick wins** (separate spec): `tree_edit add_source` + enum-pinning. Land first.
2. **Phase 0 re-measure.** Produces the post-migration baseline (reflecting the quick
   wins). Gates Phase 2.
3. **Phase 1 structural**, in parallel with Phase 0 where possible: 1b (project/profile
   writer) → 1c (batch-append, sized by Phase 0) → 1d (`init-project` migration, last,
   behind tests).
4. **Phase 2 behavior tuning**, prioritized by Phase 0: 2a (thinking/narration) and/or
   2b (round-trips); 2c (auto-chaining) only after `plan-design-review`.
5. **Re-measure again** against the same fixture to confirm the halving target and to
   decide whether to stop.

---

## 8. References

- `docs/specs/research-append-tool-spec.md`, `docs/specs/tree-edit-tool-spec.md`,
  `docs/specs/research-log-editor-spec.md` — the write tools extended here.
- `docs/specs/research-schema-spec.md` + `docs/specs/schemas/research.schema.json` +
  `packages/engine/mcp-server/src/validation/validator.ts` — the three-places rule for any
  schema touch.
- `docs/specs/skill-rewrites-for-persistence-tools-spec.md` — the 2026-06-19 migration
  whose skills 1c/1d re-touch.
- `eval/tests/e2e/kenneth-quass-death` — the fixture for Phase 0 / final re-measure.
