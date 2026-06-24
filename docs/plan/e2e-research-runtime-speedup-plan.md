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
- **Defer the `gps-mentor` gates** (`research/SKILL.md:121-136`) — for a
  single-question autonomous objective, run the mentor review **once at
  conclusion** rather than at each transition (each gate is a cold-context
  subagent read of the whole project). Risk: medium — these are the quality
  backstop, so *defer, don't delete*; keep the final gate to protect the PASS.
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

## 6. Open questions for review

- **Batch shape:** heterogeneous `ops` (proposed — enables one-call-per-record)
  vs. a simpler homogeneous `entries` (covers the observed streaks). Heterogeneous
  costs the same to implement; do we want the generality?
- **gps-mentor deferral (2b):** acceptable to run the mentor gates once at
  conclusion for single-question autonomous runs, or keep per-transition for
  safety? (Quality-vs-speed call for the senior reviewer.)
- **Idea 3 ownership:** the tool-deferral and stall behavior also affect
  production Cowork, not just the eval harness — should 3a/3b be solved in the
  harness, raised upstream, or both?
