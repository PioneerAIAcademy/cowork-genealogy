# E2E Research Runtime Speedup Plan (90 min → 10–15 min)

**Status:** Draft for team review
**Date:** 2026-06-23
**Branch:** `e2e-author-and-harness-fixes`
**Scope:** Ideas 1–3 below. Idea 4 (context/compaction tuning) is noted as
follow-on, not specced here.

---

## 1. Context & problem

The `spriggs-parents-1898` e2e fixture (autonomous `/research`, agent model
**claude-sonnet-4-6**) **passed but took 90 minutes / ~$10.33**. Forensic
analysis of the raw SDK session transcript (now auto-copied next to each runlog
as `*.session.jsonl` — see `eval/harness/e2e/orchestrator.py`
`_find_session_transcript`) decomposed the wall-clock into two **independent**
problems:

| Bucket | Time | % | Nature |
|---|---|---|---|
| Transient API stalls (2 events: 15.6 + 23.2 min) | ~39 min | 43% | Luck — random Sonnet streaming hangs |
| Structural turn count (191 turns) | ~51 min | 57% | Repeatable — the real target |
| Tool / network execution | ~0.5 min | <1% | Not a factor (FamilySearch was fast) |

Key measured facts (from the session JSONL + runlog):

- **211 MCP tool calls; 191 model turns; ~10.8–16 s/turn structural.**
- **94 of 211 tool calls (44.5%) are `research_append`**, written one entry at a
  time (5 homogeneous streaks of 8/16/18/19/19 consecutive appends). **+17
  `tree_edit`** (also streaky: an 11-op and a 4-op run).
- Latency does **not** track context size (gap-vs-prefix Pearson ≈ −0.13); the
  stalls hit at modest prefixes and **resumed cold-cache (`cache_read = 0`)**
  because each >5-min stall expired the prompt-cache TTL, forcing an 80K / 56K
  token rewrite.
- Context rode a ~110K-token prefix (peak 165K), tripping auto-compaction twice;
  cost is 59% cache-read (20.3M tokens re-read across turns).

**Conclusion:** neither lever alone reaches the goal. Removing the stalls floors
the run at ~51 min; cutting the structural turn count brings that ~51 min toward
~15–20 min. **Both are required.** The keystone is batching the persistence
tools — the skills are slow because they are *correctly* following single-entry
tools.

## 2. Goal & non-goals

**Goal:** bring a passing single-question e2e run from ~90 min to **10–15 min**
at the **same verdict/quality** (the fixture must still PASS), without changing
the persisted `research.json` / `tree.gedcomx.json` shapes.

**Non-goals:** changing the GPS methodology or rubric; changing the research.json
schema; reducing genealogical rigor; eliminating upstream API variance (we can
only cap its cost). Switching the agent model is out of scope — it is already
Sonnet, not Opus.

## 3. How we will measure

Re-run the fixture before/after each idea and read the copied
`run-*.session.jsonl` with the scratch analysis scripts used for this report
(per-turn timestamps, `usage.cache_read/creation`, tool histogram, gap
distribution). Track: total wall-clock, structural minutes (excl. stalls), turn
count, tool-call count, peak prefix tokens, cost. Because single runs carry API
variance, compare **structural minutes and turn count** (deterministic-ish)
primarily, and report wall-clock as a range.

---

## Idea 1 — Batch the persistence tools (`research_append` + `tree_edit`) · keystone · [tool change]

### Problem
Each call to `research_append` / `tree_edit` reads `research.json`+`tree`,
applies **one** mutation, validates the whole project, and writes atomically.
The skills loop one call per assertion / person-evidence link / plan item / tree
edit, so 111 of 211 tool calls (94 append + 17 tree_edit) are single-row writes,
each a full ~16 s turn re-reading the ~110K-token prefix. The spec already names
the hazard: `docs/specs/research-append-tool-spec.md:48` ("Multi-entry / multi-
file writes re-serialize large JSON").

### Proposed change
Add a **backward-compatible batch form** to both tools: an optional `ops` array.
When present, the tool applies every op to the in-memory document, validates
**once**, and writes **once**, all-or-nothing.

**`research_append`** — add `ops?: BatchOp[]`, each
`{ section, op, entry?, entryId?, fields?, planId? }` (the same per-op shape the
single form already takes). When `ops` is provided, the top-level
`section`/`op`/`entry`/`entryId`/`fields`/`planId` are ignored.

```
research_append({
  projectPath,
  ops: [
    { section: "sources",         op: "append", entry: {...} },
    { section: "assertions",      op: "append", entry: {...} },   // x N personas
    { section: "person_evidence", op: "append", entry: {...} },   // x N links
    { section: "assertions",      op: "update", entryId: "a_012", fields: {...} }
  ]
})
→ { ok: true, results: [{section, op, entryId}, ...], filesWritten, validation }
```

**`tree_edit`** — add `ops?: TreeEditOp[]`, each `{ operation, ...fields }` (the
existing single-op fields). Result gains `results: [{operation, assignedIds}]`.

### Implementation sketch (contained — both tools already factor cleanly)
- `research-append.ts`: the per-op body (resolve `SECTIONS[section]`, append/
  update, run section invariants) is already self-contained. Refactor it into an
  `applyOne(research, op)` helper, then loop it over `ops` against one in-memory
  `research`. `nextResearchId` scans the live array, so **intra-batch id
  sequencing is automatic** (op #2's append sees op #1's). Validate + atomic-
  write once after the loop. On any per-op error, return
  `{ ok:false, errors:["ops[i]: <msg>"] }` and **write nothing**.
- `tree-edit.ts`: `applyOperation(tree, input)` is *already* the per-op helper.
  Loop it over `ops` against one in-memory `tree` (`nextId` already sees prior
  adds), collect `assignedIds[]`, then validate + `backupIfExists` + atomic-write
  once.
- Single-op form stays exactly as-is (zero risk to existing callers).

### Blast radius (deliberately small — input surface only)
- **Edit:** `src/tools/research-append.ts`, `src/tools/tree-edit.ts` (logic +
  the `*Schema` `inputSchema.properties.ops`).
- **No change** to `src/tool-schemas.ts` (it imports the `*Schema` objects).
- **No change** to `manifest.json` (it lists tool *names* only; names are
  unchanged — `tests/packaging/manifest.test.ts` stays green).
- **No change** to `research.json` schema, the `validate_research_schema`
  validator, the `packages/schema/` web mirror, or `eval/fixtures/**` — the
  **persisted shape is byte-identical**; only the number of write calls changes.
  (This is the reason batching is low-risk: it sidesteps the heavy "two kinds of
  schema change" blast radius in CLAUDE.md entirely.)
- **Update specs:** `docs/specs/research-append-tool-spec.md`,
  `docs/specs/tree-edit-tool-spec.md` (document `ops`, all-or-nothing semantics,
  intra-batch id assignment).
- **Tests (vitest):** add to `tests/tools/research-append.test.ts` and
  `tree-edit.test.ts` — (a) batch success returns ordered ids; (b) atomic
  rollback: a mid-batch invariant/validation failure writes nothing; (c) intra-
  batch id sequencing (two appends to the same section get consecutive ids);
  (d) heterogeneous batch (source + assertions + person_evidence in one call).

### Expected savings
`research_append` 94 → ~18 calls (−76), `tree_edit` 17 → ~4 (−13): **~89 fewer
turns ≈ 16–22 min** of structural wall-clock. This single change lands the
structural budget near the target on its own.

### Risks
- **Atomicity is the correctness lynchpin** — the batch must validate the whole
  post-mutation document and write nothing on any failure (same guarantee the
  single form gives today). Covered by test (b).
- Error messages must identify the failing op (`ops[i]`) so the agent can fix a
  batch without losing the good rows. Covered by the `results`/error contract.
- Larger single tool *inputs* (the agent emits a bigger JSON arg). This trades
  many small turns for one bigger turn — net win, and well under context limits.

---

## Idea 2 — Skill-prompt cleanups · [mostly prompt-only]

> Line numbers below are from the skill-design analysis pass; reconfirm at edit
> time (skill bodies shift). All edits are to `packages/engine/plugin/skills/`.

### 2a. Switch the "one call per entry" instructions to batched calls *(pairs with Idea 1)*
The skills explicitly mandate single-entry writes:
- `record-extraction/SKILL.md:458-461` ("**Append each assertion** … one call
  per assertion") and `:472` ("never compress into ranges").
- `person-evidence/SKILL.md:278-298` (one `pe_` append per assertion-person
  pair).
- `assertion-classification/SKILL.md:210-213` ("one `research_append` call per
  assertion").
- `research-plan/SKILL.md:196-240` ("append each plan item … one call per item").

**Change:** rewrite each to *"emit all entries for this record / household /
plan in a single batched `research_append({ ops: [...] })` call"*, preserving the
requirement that **every persona/assertion is still individually represented**
(batching changes the call count, not the data). **Savings:** the bulk of Idea
1's turn reduction is realized here. **Quality risk:** none if Idea 1's batch is
atomic — the persisted content is identical.

### 2b. Stop redundant re-reads, validations, and gate round-trips *(independent of Idea 1)*
- **Per-entry narration → per-phase.** `research/SKILL.md:27` ("one-line preamble
  per action") made the agent narrate before each of 94 appends, even though
  `researcher_profile.narration_guidance` was "concise". Change to *narrate once
  per record/phase; under `--autonomous` suppress per-entry preambles.* Savings:
  output-token + turn reduction (~5–10 min). Risk: none (the audit trail lives in
  persisted `rationale`/`notes`, not chat).
- **Stop re-reading `research.json` (7× observed) and re-reading spilled tool
  results (36K tokens).** Re-read directives: `question-selection:34`,
  `research-plan:67-73`, `search-records:140`, `record-extraction:46`,
  `person-evidence:158`, and the orchestrator loop `research/SKILL.md:48-58`.
  Change to *trust the compact writer-tool return and prior context; re-read only
  after an external change.* Savings ~3–5 min. Risk: low (writer tools validate
  the whole project on every write, so a stale read can't silently corrupt).
- **Drop the standalone `validate_research_schema` passes**
  (`research/SKILL.md:107-109`). Every writer tool already validates-before-
  persist, so the periodic orchestrator validate is pure redundancy. Risk: low.
- **~~Defer the `gps-mentor` gates~~ — DROPPED from this plan.** The mentor is
  **not staged into the e2e sandbox at all**: `build_workspace`
  (`eval/harness/e2e/orchestrator.py`) copies only `plugin/skills/`, never
  `plugin/agents/`, so both passing e2e runs recorded `evaluations: []` with
  zero mentor invocations. Deferring the gates therefore saves the benchmark
  **0 min** and would ship a quality-affecting change to the GPS workflow's only
  production proof-quality backstop with no test coverage. The mentor is
  decoupled from this speedup work; the "stage → measure → then decide" sequence
  for reducing its cost (a production, not benchmark, concern) is recorded in
  `docs/specs/gps-mentor-agent-spec.md` §17.1. **2b's remaining savings below are
  unchanged** — they were always attributed to narration / re-reads / redundant
  validates / the handoff retry loop, not the mentor.
- **Fix the record-extraction handoff** so it doesn't re-run `record_search` to
  recover persona IDs / the `record_id` it was already handed
  (`search-records:441-447` context-only handoff; `record-extraction` then
  re-searched after a `record_id`-format validation failure). Pass the canonical
  `recordId` explicitly and correct the `record_id` guidance to match what the
  validator checks (the sidecar `recordId`, not a constructed ARK URL). Savings
  ~2–4 min + removes a recurring failed-append→retry loop. Risk: none.

### Expected savings (Idea 2 total)
~15–25 min combined (2a's batching realizes Idea 1's turns; 2b trims narration,
re-reads, redundant validates, and the handoff retry loop).

---

## Idea 3 — Harness resilience · [harness change]

### 3a. Pre-warm / pin the core genealogy tool schemas
`ToolSearch` was called **17×** — the agent re-discovers the same tool schemas
(`research_append`, `tree_edit`, `record_search`, `person_warnings` each fetched
2×) as it re-enters phases, because the SDK defers MCP tool schemas. **Change:**
investigate the SDK/Claude-Code tool-deferral configuration and pin the ~20
genealogy tools so their schemas load once at session start.
- Knobs to evaluate: `ClaudeAgentOptions.extra_args` (pass-through CLI flags) and
  `env` (`eval/harness/e2e/orchestrator.py:405`), and whether deferral is keyed
  off tool count (if so, the genealogy set may need explicit inclusion).
- **Savings:** ToolSearch 17 → ~5 (~12 turns ≈ 3–4 min). **Confidence:** medium
  — depends on what the SDK exposes; if not configurable from the harness, this
  win is unavailable and should be raised upstream (it also affects production
  Cowork, which uses the same deferral mechanism).

### 3b. Stall-detect + resume (cap the tail latency)
The two stalls (15.6 + 23.2 min) are upstream API variance the harness currently
*waits out* — `_consume` wraps `__anext__()` in
`asyncio.wait_for(timeout=inactivity_seconds=600)` and on timeout **aborts**
(`sdk_stream_silence`). We can instead **resume** and cap each stall.
- The SDK supports session resume: `ClaudeAgentOptions.resume: str | None`
  (+ `fork_session`) — verified in the installed `claude_agent_sdk/types.py`.
- **Change:** (1) capture the `session_id` from the init `SystemMessage`; (2)
  lower the inactivity timeout (e.g. 600 → ~180 s); (3) on timeout, tear down the
  stalled `query()` and start a new one with `resume=<session_id>` to re-issue
  the stalled turn, bounded by a small max-resume count before a genuine abort.
- A cheaper first probe: set a **per-request timeout / max-retries** on the
  underlying client so a hung streaming request fails fast and the SDK's own
  retry re-issues it (check `extra_args`/`env`, e.g.
  `CLAUDE_CODE_STREAM_CLOSE_TIMEOUT` and any Anthropic-client timeout env var).
- **Savings:** caps each stall at ~the inactivity window instead of 15–23 min —
  on this run that is ~30+ min recovered on a *bad* run; **0 on a good run**.
  This protects the tail and de-risks the cold-cache cliff (a shorter stall stays
  inside the 5-min cache TTL). **Confidence:** medium — resume plumbing needs
  care (avoid double-applying a turn that actually landed); start behind a flag.

---

## 4. Sequencing

1. **Idea 1** (batch tools) + **Idea 2a** (batch instructions) ship together —
   2a is inert without 1, and 1 is unused without 2a. Land with the vitest +
   spec updates. *Largest, highest-confidence win.*
2. **Idea 2b** (prompt-only re-read/validate/handoff cleanups) — independent;
   can land in parallel or first (no code dependency).
3. **Idea 3** (harness) — independent; 3a is a quick config probe, 3b is the
   hardest item and should land behind a flag with its own before/after.

## 5. Expected impact (rough, to validate by re-run)

| Lever | Turns saved | Wall-clock |
|---|---|---|
| Idea 1+2a — batch appends + tree edits | ~89 | −16 to −22 min |
| Idea 2b — narration/re-reads/validate/handoff | ~15–20 | −10 to −15 min |
| Idea 3a — pin tool schemas | ~12 | −3 to −4 min |
| Idea 3b — stall resume | n/a (tail) | −15 to −38 min on a bad run |

Structural floor ~51 min → projected ~15–20 min after 1+2; with 3b capping the
stalls, total wall-clock projects to **~12–18 min**. Reaching the 10–15 target
reliably needs **both** the batch tool change and the stall cap.

## 6. Open questions — resolved

Resolved 2026-06-23 after a code/skills/harness research pass (parallel readers +
adversarial verification). Each decision below cites the deciding evidence.

### Q1 — Batch shape: **heterogeneous `ops`** ✅

Adopt the heterogeneous shape (each op names its own `section`/`operation`); keep
`research_append` and `tree_edit` as two separate batched tools.

- **It is not more expensive than homogeneous.** Per-op dispatch already exists in
  the single-call form (`research-append.ts` resolves `SECTIONS[section]` per call;
  `tree-edit.ts` switches on `operation` per call), and both id allocators rescan
  the live in-memory document, so intra-batch sequencing is automatic in either
  shape. Homogeneous would only *add* an "all entries share one section" constraint
  for no saving.
- **The real run decides it.** In the spriggs run, 5 of 6 large write-blocks **mix
  sections** (the two record-extraction blocks most of all). Whole-run write calls:
  **111 today → ~25 homogeneous → ~17 heterogeneous.** Heterogeneous saves ~8 more
  turns, concentrated in the record hot path (`record-extraction/SKILL.md` step 5
  fans one record across source + assertions + tree `add_source` + sibling stubs).

**Correction to Idea 1's framing:** `research_append`'s single-op body returns
`{ok:false}` inline **~17 times** (not "~10") and the `project` singleton has its
**own** validate+write+early-return tail (`research-append.ts:184-226`) — both must
be folded into the shared `applyOne` + validate-once/write-once path. `tree_edit`'s
`applyOperation` is already a clean throwing per-op helper, so it is near-free.

**Batch contract the implementation must honor (shape-independent, but the het hot
path makes it load-bearing):**
1. **All-or-nothing:** apply every op to one in-memory doc, validate the whole doc
   **once**, write **once**; on any per-op failure write nothing.
2. **Per-op error indexing:** `ops[i]: <message>` so the agent can fix one row.
3. **Result array:** `research_append` → `results: [{section, op, entryId}]`;
   `tree_edit` → `results: [{operation, assignedIds}]`.
4. **Intra-batch id rule:** an op MAY reference an id it *creates* earlier in the
   same batch via that id's predictable `<prefix>NNN` (the allocator assigns
   sequentially — e.g. an assertion's `source_id: "src_001"` after appending the
   source as op #1, exactly as the sequential run already does). An op MAY NOT
   `update` or otherwise depend on an id created earlier in the same batch (append
   assigns the id internally; the caller cannot pre-name it for update).
5. **Cross-tool ordering stays two calls:** `tree_edit add_person` assigns the
   `I`-ids that the `research_append` `person_evidence` batch references, so the
   tree batch commits first; do not merge or reorder the two.
6. **Single-op form is byte-identical** to today (zero risk to existing callers);
   persisted shapes are unchanged, so no schema/validator/web-mirror/fixture churn.

### Q2 — gps-mentor: **decoupled from this plan** ✅

Not a speedup lever for e2e — the mentor is never staged into the sandbox (see the
struck bullet in Idea 2b). No production change is made here. The conditions and
the staged "(a) land conformance PR → (b) stage + measure in e2e → (c) then decide
gating" sequence for ever reducing mentor cost are recorded durably in
`docs/specs/gps-mentor-agent-spec.md` §17.1.

### Q3 — Ownership: **both, harness-first** ✅ (separate follow-ups, not this PR)

- **3a (pin schemas):** the lever is the bundled-CLI env var **`ENABLE_TOOL_SEARCH`**
  (`true | auto | auto:N`, keyed off tool-definition token weight) — **not** a
  `ClaudeAgentOptions` field; set it via the SDK `env=` pass-through. The genealogy
  server advertises **38 tools** (over the ~30 / ~10K-token guidance), which is why
  ~20 get deferred and re-discovered 17×. Cheapest probe: add
  `env={"ENABLE_TOOL_SEARCH": "true"}` to the orchestrator and re-run one fixture,
  counting ToolSearch calls. **Hosted-web production (`apps/server/app/agent/real_agent.py`)
  uses the same SDK + bundled CLI + stdio MCP config with no override**, so the same
  env must also land there or real users get nothing. Raise upstream for (i) a
  surgical "pin a named tool set" / `auto:N` end-state and (ii) the Cowork *desktop*
  runtime, which the env may not reach. **Structural alternative worth evaluating:**
  cut the tool count below the token threshold (CLAUDE.md already mandates generic
  tools with provider params) — removes deferral everywhere without eager-loading 38.
- **3b (stall resume): DEFERRED — not implemented (evidence too thin).** The two
  stalls are real (measured from the spriggs transcript), but that is **n=1** — one
  run with timing forensics, no frequency data. Building resume plumbing plus a
  correctness-risky double-apply mitigation behind a flag, to insure against a
  variance seen once, is premature — and the batching (shorter runs) reduces
  cold-cache exposure on its own, possibly shrinking 3b's value before it is
  measured. **Trigger to revisit:** the e2e re-runs (validating Idea 1/2a/2b/3a) show
  stalls *recurring* across runs. Only then build it, with real frequency data. The
  design below stands for that point. Ownership when built: harness, behind a flag,
  two ordered steps. Step 1 (safe,
  first): capture `session_id` (currently discarded — `SystemMessage` branch is a
  bare `pass`) and lower the inactivity cap (the 15–23 min stalls currently trip the
  3600 s wall-clock cap, not the 600 s inactivity cap, so lowering inactivity is what
  makes a stall *detectable*). **Correction:** the "cheaper fail-fast probe" the plan
  hoped for does **not exist** — there is no per-request Anthropic timeout / max-retries
  knob; `CLAUDE_CODE_STREAM_CLOSE_TIMEOUT` covers only the init handshake (≥60 s floor).
  Step 2 (off-by-default flag): resume-on-stall, gated by the **double-apply hazard** —
  all three writers are non-idempotent on create (`max+1` ids; `tree_edit` even rejects
  caller-supplied create ids), so a replayed already-landed turn **duplicates** rather
  than overwrites; the "resume only if no create pending" gate narrows but does not
  close the window (the write commits in the MCP server before the `tool_result`
  returns). Raise the stall variance upstream regardless. **Correction:** the "5-min
  cache-TTL cliff" parallel in §1/§3b is a misread — the cited doc's "5-min timeout" is
  the E2B sandbox idle-pause lifecycle, not an Anthropic prompt-cache TTL; drop it.

### Scope of the immediate PR

This PR implements **Ideas 1, 2a, 2b, and 3a**:
- **1** — heterogeneous-`ops` batch tools (`research_append`, `tree_edit`) + spec + vitest.
- **2a** — the four skills rewritten to emit batched `ops` calls.
- **2b** — prompt-only efficiency cleanups (per-phase narration, stop redundant
  re-reads, drop standalone validates, fix the record-extraction handoff).
- **3a** — `ENABLE_TOOL_SEARCH=true` on the e2e orchestrator **and** the hosted-web
  `real_agent.py`, to stop the ToolSearch re-discovery loop.

**Deferred:** **3b** (stall resume — n=1 evidence; see above) and the **gps-mentor**
change (decoupled; a production concern recorded in
`gps-mentor-agent-spec.md` §17.1). End-to-end validation of the whole set is **one
e2e re-run** (the plan's measurement method); the unit tests cover only the tool
batching's correctness.
