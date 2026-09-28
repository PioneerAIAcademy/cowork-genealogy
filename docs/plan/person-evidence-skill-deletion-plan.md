# Plan: Delete person-evidence routing skill and convert suite to delegation

**Issue:** #2821  
**Branch:** person-evidence-2821  
**Status:** Implemented — PR open

## What this does

Deletes the thin `person-evidence` routing skill (3.1 KB) that sits in front of the 62.2 KB `person-evidence` agent and routes nothing — `/research` already spawns `@plugin:person-evidence` directly. Converts all 18 unit tests from `input.user_message` to `input.delegation` format, then updates every site the skill's existence touched.

**Dependencies satisfied:**
- PR #2782 merged (runnability fallback + agent-file snapshot embedding)
- PR #2851 merged 2026-09-26 (rewrites `ownership.json` caller fields + `test_universal.py`)
- PR #2870 merged 2026-09-27 (edits `agents/person-evidence.md` and `autonomous-weak-match-no-link.json`)

Rebase on main before starting.

---

## Acceptance check (from issue)

- [ ] `npx vitest run` (engine + packaging tests) green
- [ ] `uv run python eval/harness/run_tests.py --skill person-evidence --runs-per-test 3` — every converted non-xfail test `flaky: false` and non-failing (scratch run)
- [ ] `ls packages/engine/plugin/skills/ | wc -l` drops from 27 to 26
- [ ] One committed `make eval-skill SKILL=person-evidence` run, annotated (separate from plan; done after code review)
- [ ] Manual Cowork/hosted check: "is this the same person?" → reaches `@plugin:person-evidence` by agent description

---

## Sites — ordered by dependency

### 0. Rebase

```
git fetch origin
git rebase origin/main
```

### 1. Delete the skill directory (CI: `skill-name-resolution.test.ts`)

```
git rm -r packages/engine/plugin/skills/person-evidence/
```

This removes `SKILL.md` and any sub-files. After this, `prompt-sizes.json` has a stale entry (fixed in step 7).

### 2. Convert all 18 unit tests to `input.delegation`

All files under `eval/tests/unit/person-evidence/*.json`.

**Format** (follow `eval/tests/unit/proof-conclusion/direct-*.json`):

```json
"input": {
  "delegation": "<terse task description carrying assertion or pe_ ids>\n\nprojectPath: <workspace>",
  "scenario": "<same scenario as before>"
}
```

Rules:
- `"user_message"` key → `"delegation"` key
- Append `\n\nprojectPath: <workspace>` to the message text
- Do NOT move the correct outcome into the delegation; the delegation is the caller's framing
- Rewrite `test.description` and `judge_context` strings that say "SKILL.md §1" or "the skill" → "agents/person-evidence.md" (or "the agent")
- The 5 `expected_outcome: xfail` tests stay xfail; their xfail_reason text may also cite "SKILL.md" and needs updating

Files and their current `user_message` key (to confirm the conversion in each):

| File | Scenario |
|------|----------|
| audit-surfaces-unlinked-role.json | (xfail) |
| autonomous-weak-match-no-link.json | |
| baptism-parentage-links-only-defers-relationship.json | (xfail) |
| degenerate-score-unresolvable-id-still-links.json | |
| detect-absent-household-member.json | (xfail) |
| fts-assertion-qualitative-fallback.json | |
| high-score-conflict-not-auto-linked.json | |
| household-skeleton-siblings.json | |
| link-death-cert-to-patrick.json | (xfail) |
| link-relationship-to-both-persons.json | |
| low-score-strong-correlation-still-links.json | |
| marriage-assertion-links-only-defers-relationship.json | |
| marriage-parent-persona-unscored.json | |
| match-score-persisted.json | |
| patronymic-mismatch-caps-confidence.json | |
| research-query-cold-lookup.json | |
| single-person-record-materializes-onto-matched-person.json | |
| stub-creation-new-son.json | (xfail) |

### 3. Update `docs/specs/schemas/ownership.json` — 3 rows

Find with: `grep -n 'skill:person-evidence' docs/specs/schemas/ownership.json`
Currently at lines 281, 283, 438, 495.

**3a. `person_evidence` section row (lines ~278–303):**
- `"owner": "skill:person-evidence"` → `"agent:person-evidence"`
- In `"callers": ["skill:person-evidence"]` → `["agent:person-evidence"]`
- Rewrite `"notes"` field: remove the stale sentence "callers stays skill-only … naming an agent there raises OwnershipManifestError" — that was false since issue #2799. Replace with accurate statement: the caller is `agent:person-evidence`; the unit plane resolves it via `writer_sets(..., subject=skill_name)` per the agent-rule in `ownership.py`.

**3b. `persons` section row (line ~438):**
- `"skill:person-evidence"` in `callers[]` → `"agent:person-evidence"`

**3c. `relationships` section row (line ~495):**
- `"skill:person-evidence"` in `callers[]` → `"agent:person-evidence"`

**Verification:** `grep -n 'skill:person-evidence' docs/specs/schemas/ownership.json` → no results. CI: `skill-name-resolution.test.ts:153-156` catches any surviving `skill:person-evidence`.

**⚠ Deviation from plan (steps 3a–3c):** Steps 3a–3c said to put `agent:person-evidence` in `callers[]`. During implementation, a test failure showed that `callers[]` on a unit-plane row grants ALL `writerTools`, so placing an agent there authorized it for `merge_tree_persons` — which `test_a_hook_caller_counts_only_for_research_append` catches. The actual approach used:
- `person_evidence` row: `callers: []` (empty) + `hookCallers: ["agent:person-evidence"]` — authorizes only `research_append` (hookCallers' semantics)
- `persons` and `relationships` rows: removed `skill:person-evidence` from `callers` and added a new **`unitCallers`** field with `["agent:person-evidence"]` — unit-plane-only authorization; `listed_writers` (e2e) does not read `unitCallers`
- `ownership.py:writer_sets()` updated to read `callers + hookCallers + unitCallers`

Additional unplanned files required by this approach:
- `eval/harness/tests/unit/test_ownership_manifest.py` — added `TREE_NARROWED` dict, extended `NARROWED`, updated `expected_tree_owners()` and `test_a_unit_plane_agent_caller_is_a_suite_subject` (to also check `unitCallers`)
- `eval/harness/tests/unit/test_handoffs.py` — removed `"person-evidence"` from the paired-name stub list
- `eval/harness/scripts/check_rubric_tool_drift.py` — removed 2 stale SUPPRESSIONS entries
- `eval/fixtures/scenarios/flynn-spouse-stub-marriage/README.md` — stale path cite updated
- `packages/engine/mcp-server/tests/packaging/agent-delegation-framing.test.ts` — removed delegation edge, added prose mentions, added to agentOnly list

### 4. Fix `eval/harness/validators/test_universal.py:919`

The `test_tree_ownership_table` function calls `writer_sets(TREE_GEDCOMX_JSON)` with no `subject=`, so it drops any `agent:` caller silently. The research.json check at line 664 already passes `subject=skill_name`. Apply the same fix:

```python
# line 919 — before:
owners = writer_sets(TREE_GEDCOMX_JSON)

# after:
owners = writer_sets(TREE_GEDCOMX_JSON, subject=skill_name)
```

This is needed so the stub-creation-new-son, household-skeleton-siblings, and detect-absent-household-member tests pass ownership on the tree sections.

### 5. Update `docs/specs/research-schema-spec.md` §4 — add agent: caller rule for conversions

In the `callers` table row discussion (around line 366–380 where it explains `agent:citation`), add one sentence making this policy explicit for conversion cards:

> A converted skill whose suite and agent share the same `name` follows the same rule: its ownership rows use `agent:<name>` in `callers`, and `writer_sets(..., subject=skill_name)` resolves it at the unit plane.

Place it at the end of the paragraph that currently ends with `"...a row must list its own owner among its callers."` (line ~374).

### 6. Update skill counts — 27 → 26

**6a. `README.md`** (CI: `readme-catalog.test.ts` for line 162):
- Line 162: `"27 skills"` → `"26 skills"`
- Line 205 (table row): **delete the `person-evidence` row entirely**
- Line 268: `"(not invoked directly — the \`person-evidence\` skill delegates)"` → `"(spawned by \`/research\` directly via the agent description)"` — the routing skill is gone, so this note about it delegating is now false. The agent IS the entry point.
- Line 287 (numbered list): delete `"7. person-evidence           Link assertions to persons in the tree"` entry and renumber what follows
- Line 317 (table): `"person-evidence (stubs)"` — update to say `"person-evidence agent (stubs)"`
- Line 482: `"**27 shipped skills.**"` → `"**26 shipped skills.**"`
- Line 493: `"\`person-evidence\` (identity"` — update context to say agent, not skill

**6b. `CLAUDE.md`** (line 399):
- `"26 of the 27 skills"` → `"25 of the 26 skills"` (person-evidence carried a Narration line; removing it means 25 of 26 carry it)
- The grep command on line 407 stays correct (it counts skill files still on disk)

**6c. `docs/architecture.md`**:
- Line 224: `**27**` → `**26**`
- Line 228: remove `person-evidence` from the skills list
- Line 353: `"16 of the 27 skills carry a \`references/\` folder"` → `"16 of the 26 skills"` (person-evidence had no `references/`)
- Line 1450: `"26 of the 27 skills"` → `"25 of the 26 skills"`
- Line 1894: `"27 skill suites"` → `"26 skill suites"`
- Line 1896: `"the 27 live suites"` → `"the 26 live suites"`

**6d. `docs/skill-dataflow.md`**:
- Line 14: `"There are 27 skills and 8 agents."` → `"There are 26 skills and 8 agents."`
- Line 346: `"so \`skills/person-evidence/\`,"` — remove `skills/person-evidence/` from this sentence (the directory is gone). Update the sentence: "Rows 7, 10 and 11 route to `@plugin:<agent>`, so `skills/research-exhaustiveness/` and `skills/proof-conclusion/` are no longer on the in-loop route" — person-evidence is now fully gone, not just "no longer on the in-loop route."

### 7. Regenerate `prompt-sizes.json` (CI: `prompt-budget.test.ts`)

```
UPDATE_PROMPT_SIZES=1 npx vitest run tests/packaging/prompt-budget.test.ts
```

This removes the stale entry for `packages/engine/plugin/skills/person-evidence/SKILL.md`.

### 8. Update `apps/server/proto/worker/worker.py`

- Line 150: remove `"person-evidence",` from `EXPECTED_AGENTS` frozenset (wait — this is EXPECTED_AGENTS for the agents, not skills. person-evidence is still an AGENT. Do NOT remove it from EXPECTED_AGENTS.)
- Line 157: comment `"an image shipping 27 skills"` → `"26 skills"`
- Line 159: `EXPECTED_SKILLS = 27` → `EXPECTED_SKILLS = 26`

**`apps/server/tests/test_proto_worker.py`** — update all skill count literals:
- Line 662: `_info(AGENTS, 27, ...)` → `_info(AGENTS, 26, ...)`
- Line 663: `expected_skills=27` → `expected_skills=26`
- Line 667: `_info(AGENTS - {"gps-mentor"}, 27, ...)` → 26
- Line 668: `expected_skills=27` → 26
- Line 670: `_info(AGENTS, 26)` → `_info(AGENTS, 25)` (this is the "one short" case)
- Line 671: `"26 ... expected 27"` → `"25 ... expected 26"`
- Line 672: `expected_skills=27` → 26
- Line 675: rename `test_the_plugin_ships_eight_agents_and_twenty_seven_skills` → `test_the_plugin_ships_eight_agents_and_twenty_six_skills`
- Line 679: `== 27` → `== 26`
- Line 682: `"EXPECTED_SKILLS = 27"` → `"EXPECTED_SKILLS = 26"`
- Line 717: comment `"Eight agents and 27 skills"` → `"26 skills"`
- Line 720: `_info(AGENTS, 27)` → `_info(AGENTS, 26)` (the "clean" case)
- Line 721: `_info(AGENTS - {"gps-mentor"}, 27, ...)` → 26
- Line 723: `_info(AGENTS, 26)` → `_info(AGENTS, 25)` and message `"26 ... expected 27"` → `"25 ... expected 26"`
- Line 732: `== 26` → `== 25` (remove-one-skill copy)
- Line 733-735: message `"26 ... expected 27"` → `"25 ... expected 26"`

### 9. Fix stale path cites to `skills/person-evidence/SKILL.md`

From `grep -rn 'skills/person-evidence' docs eval/harness packages --exclude-dir=runlogs`:

**9a. `docs/adrs/ADR-0009-refuted-agent-design-claims.md:85`**
- Change `packages/engine/plugin/skills/person-evidence/SKILL.md` → `packages/engine/plugin/agents/person-evidence.md`
- Update the line references (e.g., "SKILL.md:267-294" → verified equivalent in agents file)

**9b. `eval/harness/harness/skill_invocation.py:836`**
- Change `"person-evidence/SKILL.md, the skill that owns the identity decision"` → `"agents/person-evidence.md, the agent that owns the identity decision"`

**9c. `docs/skill-dataflow.md:346`**
- Already handled in step 6d.

**9d. `packages/engine/mcp-server/tests/packaging/prompt-sizes.json:25`**
- Auto-fixed in step 7 (regenerated).

**9e. Remaining hits** (`docs/deep-dives/`, `docs/plan/`, `docs/specs/same-person-match-relatives-spec.md`):
- `docs/deep-dives/person-evidence-prohibition-list.md:4` — update path at top of file
- `docs/plan/content-advisory-doctrine-plan.md:50, 81` — update paths (plan file; keep for historical accuracy)
- `docs/specs/same-person-match-relatives-spec.md:311` — update path reference

Note: `eval/harness/tests/fixtures/gh_issues_slurp_capture.json` contains the path inside a captured GitHub issue body — do not change (it's a verbatim fixture capture).
Note: `eval/harness/tests/unit/test_check_slot_queue.py:252` contains the path inside a test string literal that matches an issue body — do not change (verbatim match).

### 10. Update `packages/engine/mcp-server/tests/packaging/skill-name-resolution.test.ts`

Check whether the test explicitly names `person-evidence` (beyond the `skill:person-evidence` ownership check already removed in step 3). If it does, remove those references.

Also check `packages/engine/mcp-server/tests/packaging/ownership-manifest.test.ts` per the issue's Touches list.

---

## What to NOT change

Per the issue:
- `agents/gps-mentor.md:457`, `agents/proof-conclusion.md:155`, `translation`/`timeline`/`check-warnings` SKILL.md — they name `person-evidence` (the agent), which still exists
- `guard_project_files.py:105,170` — already keys on the agent

---

## Verification sequence

```bash
# 1. Packaging + engine tests (CI)
npx vitest run

# 2. Harness unit tests
uv run python -m pytest eval/harness/tests/ -x

# 3. Ownership manifest test explicitly
npx vitest run tests/packaging/ownership-manifest.test.ts

# 4. Skill name resolution test
npx vitest run tests/packaging/skill-name-resolution.test.ts

# 5. Prompt sizes test (generates output)
UPDATE_PROMPT_SIZES=1 npx vitest run tests/packaging/prompt-budget.test.ts

# 6. Person-evidence suite — scratch run before commit
cd eval/harness && uv run python run_tests.py --skill person-evidence --runs-per-test 3

# 7. Skill count on disk
ls packages/engine/plugin/skills/ | wc -l   # should be 26
```

---

## Falsifiable acceptance checks (per issue)

- `ls packages/engine/plugin/skills/ | wc -l` → 26 (not 27, not "not_runnable" aborts)
- `test_tree_ownership_table` passes on stub-creation-new-son, household-skeleton-siblings, detect-absent-household-member
- `grep -n 'skill:person-evidence' docs/specs/schemas/ownership.json` → no results
- `npx vitest run` → green
