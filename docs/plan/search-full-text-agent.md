# Replace `search-full-text` skill with an agent

**Status:** Implemented — pending harness-test run; packaging tests all pass (2026-10-06)
**Issue:** #2120
**Assignee:** mercyokum
**Baseline run log:** `eval/runlogs/unit/search-full-text/v1_2026-10-06_09-29-31.json` (18 pass, 1 partial `_016`, 0 fail)

---

## Background

Issue #2120 converts the `search-full-text` skill into a dedicated agent and deletes the
skill entirely (lead ruling 2026-09-22). The primary motivation is cost and context: a
`model:` / `effort:` pin only takes effect on an agent, and the folded body stops occupying
the orchestrator's context window on runs that do not need it. This is not a guardrail
conversion, so no hook route or writer-tool precondition is required — but a lane
(`AGENT_WRITABLE_SECTIONS`) and `agentCallers` rows in `ownership.json` ARE required by CI.

Issue #1828 merged 2026-10-06 (PR #3047), so the skill's `allowed-tools` now includes
`get_name_variants`, and the suite has tests `_014`–`_020`. Fold from `main` at or after
commit `5704fc3b0`.

Issue #2486 (edits `SKILL.md`) is still open; this card lands first, so #2486 will
target `agents/search-full-text.md` instead.

---

## Body changes required before the first run

Three issues from comments must be corrected in the fold (they cannot ride a separate run):

1. **Step 11 (pass to extraction) → match `search-records` pattern.** The skill currently
   says "invoke record-extraction". No plugin agent grants `Skill`, `Task`, or `Agent`, so
   once it's an agent the agent cannot launch extraction. Match `search-records`: name the
   promising records and their ARKs, report what context survives (names/places/dates, title,
   recordType, highlightTerms), and return — let the orchestrator route to extraction. The
   plan item stays `in_progress` (extraction will complete it); do not mark it `completed`
   until extraction runs.

2. **Step 3 / Step 12 contradiction (SKILL.md:124 vs :371).** Step 3's strategy table says
   "if NLP missed the name, retry with `Surname` in Name field". Step 12 says "Always use
   `keywords` for queries." The agent cited step 12 to abandon the Name-field retry in test
   `_010`. Resolution: the Name-field route is a valid fallback variant in nil-result
   recovery, not a violation of keywords-first. Add a sentence after the strategy table
   clarifying that: *"The Name-field retry in the nil-result path (step 9) is a variant, not
   a contradiction of the keywords-first rule — the strategy table's nil-recovery row wins in
   that specific context."*

3. **Step 8 `skipped` plan items must carry `skip_category` + `skip_reason`.** PR #3087
   (`research_append` refuses a bare skip without a `skip_category`) lands before this card.
   Add both fields to every skip example in the agent body. Most skips are `answered`
   (question already resolved) or `fallback_not_triggered`. Example:
   ```
   fields: {
     status: "skipped",
     skip_category: "answered",
     skip_reason: "Target already has a source covering this jurisdiction and period."
   }
   ```

---

## Touches (tick each one off)

### A. Author the agent

- [ ] **`packages/engine/plugin/agents/search-full-text.md`** — new file.

  **Frontmatter:**
  - `name: search-full-text`
  - `description:` — `>-` block scalar (hosted loader requires this form). Copy the skill
    description verbatim and widen it: "non-principal" framing is already fixed by #1828;
    keep that text.
  - `model: claude-sonnet-4-6`
  - `tools:` — three spellings each for: `Read`, `fulltext_search`, `get_name_variants`,
    `source_attachments`, `research_log_append`, `research_append`, `wiki_search`,
    `wiki_read`. No `Task`, `Agent`, or `Skill` — `agent-tool-names.test.ts` rejects them.

  **Body structure (in order):**
  1. "Invocation contract" table — `projectPath` (required), `planItemId` (optional),
     `looking_for` (optional). Modelled on `search-images.md`.
  2. "A delegation is a request for work, never a finding" section — hostile-delegation
     hardening against callers that pre-state results or name the extraction target.
     Required: agent must work from tool returns, not caller assertions.
  3. ROUTING gate — same pattern as `search-images.md`'s "ROUTING — run this FIRST".
     Covers: external sites → `search-external-sites`; indexed search → `search-records`;
     planning → `research-plan`; record already in hand → `record-extraction`; image browse
     → `search-images`. Must fire before any tool call.
  4. Narration line (same wording as the skill).
  5. All remaining sections from `SKILL.md` body, verbatim — steps 1–12, MCP tool table,
     Key differences, Important rules, Re-invocation behavior.
  6. Inline content from all four `references/` files (since agents cannot read their own
     reference files — measured 6/19 vs 12-14/19 baseline):
     - `online-search-literacy.md` — coverage checklist
     - `query-syntax.md` — operator details and wildcards
     - `search-strategies.md` — full strategy catalog (contains the "Formal | Abbreviations"
       name-variant table cited by `name-variant-drift.test.ts`)
     - `transcription-quirks.md` — HTR error patterns, **including the era-specific hands
       passage (lines 46–62)** covering Secretary, Copperplate, Kurrent/Sütterlin, and
       Spanish procesal. Carry it verbatim; the wiki pages do not yet have this content
       (measured 2026-09-25 per issue comment; re-derive before dropping it).
  7. Body fixes from §"Body changes required" above:
     - Step 11 rewrite (hand-off without invoking extraction)
     - Contradiction fix (Name-field retry is a valid variant)
     - Skip fields (`skip_category` + `skip_reason` on every skip example)
  8. Return contract section — `summary_for_user` heading + format matching
     `search-images.md`'s return contract.

### B. Delete the skill

- [ ] **`packages/engine/plugin/skills/search-full-text/`** — delete the entire directory
  (SKILL.md + references/). Do not leave any file behind.

### C. Delete routing-negative eval tests

These four tests assert which *skill* Cowork picks by `description` match — they don't
exercise the agent at all (96% of graded runs never loaded the subject). Delete them:

- [ ] `eval/tests/unit/search-full-text/negative-external-sites.json` (ut_005)
- [ ] `eval/tests/unit/search-full-text/negative-record-extraction.json` (ut_003)
- [ ] `eval/tests/unit/search-full-text/negative-research-plan.json` (ut_006)
- [ ] `eval/tests/unit/search-full-text/negative-search-records.json` (ut_004)

The remaining 16 tests (out-of-scope negatives + positive tests) stay unchanged.

### D. Fix ut_search_full_text_010 missing fixture

- [ ] `eval/tests/unit/search-full-text/write-result-sidecar.json` — add
  `fulltext-search-flynn-witnesses-by-name` to the test's `mcp_fixtures` list (the two
  sibling witness tests load it but `_010` does not; the agent's first call will be
  `fulltext_search {name: "Flynn"}` per strategy table step, which gets
  `fixture_not_found`).

### E. Packaging tests

- [ ] **`packages/engine/mcp-server/tests/packaging/agent-tool-names.test.ts`**
  — Add `AGENT_PERMISSIONS` entry for `search-full-text` with the full tool list (three
  spellings each for all eight tools listed above).

- [ ] **`packages/engine/mcp-server/tests/packaging/agent-delegation-framing.test.ts`**
  — Three changes:
  1. Add `"search-full-text"` to `PROSE_ARM_COVERS`.
  2. Delete the stale `["search-full-text -> question-selection", ""]` entry (it named an
     edge that no longer exists).
  3. Add `PROSE_MENTIONS` entries for every SKILL.md/agent body that mentions
     `search-full-text` bare: today that is `skills/record-extraction/SKILL.md` and
     `skills/search-records/SKILL.md`. Do not edit those files to satisfy the test.

- [ ] **`packages/engine/mcp-server/tests/packaging/agent-return-contract.test.ts`**
  — Since the agent body includes the `summary_for_user` heading from the start (not a
  verbatim-only baseline), the agent name must NOT go into `PENDING`. Verify the heading is
  present; the test will pass on the first packaging run without any edit needed here
  (unless CI rejects for some other reason, in which case add to `PENDING` and remove after
  the heading is confirmed).

- [ ] **`packages/engine/mcp-server/tests/packaging/prompt-sizes.json`**
  — Remove the `packages/engine/plugin/skills/search-full-text/SKILL.md` entry and add the
  new agent entry. Run `npx vitest run tests/packaging/prompt-budget.test.ts` to regenerate
  — it writes the file; commit the result.

- [ ] **`packages/engine/mcp-server/tests/packaging/name-variant-drift.test.ts`**
  — Update `strategiesPath` from `skills/search-full-text/references/search-strategies.md`
  to `agents/search-full-text.md` (the verbatim fold carries the
  "Formal | Abbreviations" table).

### F. Hooks

- [ ] **`packages/engine/plugin/hooks/guard_project_files.py`**
  — Add to `AGENT_WRITABLE_SECTIONS`:
  ```python
  # search-full-text updates the status of the plan item a search executed.
  # This is a repo CI requirement, not a runtime gate (the guard does not fire
  # for agents outside the listed sections).
  "search-full-text": frozenset({"plan_items"}),
  ```
  Model after the `search-images` entry at line 174.
  **After this change, run `make hook-smoke`** (live, billed, not run by CI).

### G. Ownership

- [ ] **`docs/specs/schemas/ownership.json`**
  — Three changes:
  1. On the `plans` row: change `skill:search-full-text` to `agent:search-full-text` in the
     `requires` prose.
  2. On the `plan_items` row: change `skill:search-full-text` to `agent:search-full-text`
     (owner or caller); add an `agentCallers` entry:
     `{ "name": "search-full-text", "section": "plan_items", "op": "update" }`.
  3. On the `log` row: change `skill:search-full-text` to `agent:search-full-text`; add an
     `agentCallers` entry:
     `{ "name": "search-full-text", "section": "log", "op": "append" }`.
  Do NOT edit `eval/harness/tests/unit/test_ownership_manifest.py` — its frozen tables are
  intentionally not updated for conversions (editing them makes the free suite green and the
  paid run red).

### H. Eval harness

- [ ] **`eval/harness/harness/skill_invocation.py`**
  — Add `"search-full-text"` to `DEDICATED_AGENT_NAMES`. Follow the `search-images` entry
  pattern (same shape, same reason — issue #2065 is the reference; pick the closest
  matching issue number from the existing comments).

- [ ] **`eval/harness/validators/test_search_full_text.py`**
  — Review each validator. Any check that reads `skills_invoked` must be updated to read
  `agents_spawned` (the run will carry `agents_spawned` once it is a dedicated agent).
  Confirm no validator accidentally gates on the skill-invocation path.

### I. Worker and server tests

- [ ] **`apps/server/proto/worker/worker.py`**
  — Add `"search-full-text"` to `EXPECTED_AGENTS`. **Re-derive `EXPECTED_SKILLS` from disk
  after the final rebase** (`ls -d packages/engine/plugin/skills/*/ | wc -l`) — do not
  decrement from branch point, since PRs #3172, #3124, #3115, #3036, #3157 and #3007 are
  all moving the same literal. Same applies to `EXPECTED_AGENTS`.

- [ ] **`apps/server/tests/test_proto_worker.py`**
  — Update `AGENTS` set and the test name
  `test_the_plugin_ships_twenty_one_agents_and_twelve_skills` (count changes to reflect
  the new agent/skill counts). Re-derive counts from disk at final rebase.

### J. Config

- [ ] **`packages/engine/mcp-server/config/given-name-variants.json`**
  — Every entry whose `source` field cites `search-strategies.md:<line>` must be re-pointed
  at the agent body by section heading (not line number). After the fold, the strategies
  content lives in `agents/search-full-text.md` under a section heading — use that as the
  citation. `name-variant-drift.test.ts` only checks that `source` exists (not the path),
  so stale cites pass CI; re-point them proactively.

### K. Docs

- [ ] **`README.md`**
  — Move `search-full-text` row from Skills table to Agents table. Update "12 skills" count
  at README.md:166 (re-measure; do not decrement blindly).

- [ ] **`docs/architecture.md`**
  — Update skill counts at lines :355 and :1488. Re-measure (`ls -d packages/engine/plugin/skills/*/ | wc -l`); do not decrement.

- [ ] **`docs/skill-dataflow.md`**
  — Update references at lines :76, :119, :136, :338, :370 that name `search-full-text`
  as a skill.

- [ ] **`docs/specs/fulltext-search-tool-spec.md`**
  — Update line :400: change "Trigger via the `search-full-text` skill" to "Trigger via the
  `search-full-text` agent".

- [ ] **`docs/adrs/ADR-0002-decompose-into-tools-skills-and-agents.md`**
  — Update counts at line :53: "52 tools, 12 skills, and 21 agents" → "52 tools, 11 skills, and 22 agents".

---

## Verification sequence

1. `npx vitest run tests/packaging` inside `packages/engine/mcp-server/` — read the **file
   count**, not just the red count (a file that cannot import reports "no tests", not a
   failure).
2. `make harness-test` — unit suite; confirm snapshot flips for deleted tests.
3. `make server-test` — covers `test_proto_worker.py`.
4. `make hook-smoke` — **live, billed, not run by CI**. Run after step F.

---

## What does NOT belong here

- Editing `research/SKILL.md` to add a routing row for `search-full-text` — that is a
  separate card on the `research` slot, filed and linked from the PR.
- Editing `skills/record-extraction/SKILL.md` or `skills/search-records/SKILL.md` to remove
  their `search-full-text` prose mentions — each edit bills that skill a paid run.
  The delegation-framing test covers them via `PROSE_MENTIONS` instead.
- Commenting out or weakening the `ownership.json` frozen-table checks — the comment in
  `test_ownership_manifest.py` explains why: "editing a frozen table to drop a converted
  skill is the wrong fix."

---

## Original passages replaced by issue comments

*(Board-audit clean-up. These passages were in the original issue body and were superseded.)*

- "Blocked on #2246" banner — removed 2026-09-20 (closed COMPLETED 2026-09-16).
- "Order: issue #1860, then this" — superseded by lead ruling 2026-09-27 ("Convert now").
- Tool list derived from `allowed-tools` — superseded by review-ready decision 2026-10-06
  (derive from body calls; `allowed-tools` lacks `Read`).
