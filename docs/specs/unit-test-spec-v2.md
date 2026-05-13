# Unit Test Spec v2 — Deferred Features

**Status:** Plan. v1.7 fixed one critical bug — judge-skipped-on-error
was silently returning outcome=pass — plus widened leakage detection,
added an SDK-version probe for `dontAsk` regressions, enumerated all
runnability conditions in spec §9, and closed the tree.gedcomx.json
runnability test gap.

**Companion spec:** [`docs/specs/unit-test-spec.md`](unit-test-spec.md) — the
full target spec.

---

## What v1.7 ships

A working Python harness at `eval/harness/`:

- `pyproject.toml` + uv; deps with a tightened `claude-agent-sdk>=0.1.81,<0.2`
  bound so the session-cleanup contract can't silently regress.
- `run_tests.py` — CLI with `--test`, `--skill`, `--all`, `--tag` (repeatable),
  `--max-cost-usd`, `--max-wall-clock-seconds`, `--runlogs-root`,
  `--tests-dir`. Exit codes 0/1/2/3 (and `2` for empty selections so CI
  gates don't silently green on typos).
- `harness/` package: `loader.py`, `rubric.py`, `fixtures.py`, `workspace.py`,
  `diff.py`, `runnability.py`, `runlog.py`, `mock_mcp.py`, `auth.py`,
  `skill_runner.py`, `validator_runner.py`, `judge.py`, `orchestrator.py`,
  `allowed_tools.py` (also hosts the shared `load_skill_frontmatter` helper).
- `judge/prompt.md` — judge prompt template with single-pass slot
  substitution.
- `tests/unit/` — 212 unit tests across 16 modules (TDD).
- `tests/e2e/test_wiki_lookup_e2e.py` — real-API run end-to-end.

Features added since v1.6 (the seventh-pass review):

- **CRITICAL bug fix — judge-skipped no longer silently passes.**
  `_compute_outcome` now takes a `judge_skipped: bool` flag. When
  validators pass but the judge raised (missing API key, transient API
  error, parse failure), the run returns `fail` instead of falling
  through to `pass` on empty `judge_dimensions`. Spec §7 requires "every
  judge dimension scored pass"; zero dimensions can't satisfy that.
  Regression tests cover the unit-level outcome + the orchestrator
  integration via JudgeError mock.
- **SDK-version probe** on harness startup. Pins claude-agent-sdk to a
  tested-known-good range `>=0.1.81,<0.2`; emits a stderr warning if
  the installed version is outside that range. Closes spec §15 known
  risk on `permission_mode="dontAsk"` regression.
- **Leakage detector widened** with 4 new patterns: verdict-first
  ("Ireland is the right birthplace"), reason-baked-in
  ("since X is true"), negated forms ("should not conclude Y"), and
  bare equality ("Patrick = Thomas's son"). Module docstring reframes
  recall expectations honestly: 30-60%, senior review is the safety net.
- **Spec §9 enumerates all 8 runnability conditions** — tool-usage
  rubric requirement and `negative.correct_skill` existence checks
  (added in v1.5/v1.6) are now in the spec table.
- **Tool-usage keyword set widened** in runnability to catch reasonable
  naming variations: "mcp tool", "tool work", "tool call", "fixture",
  in addition to the original four.
- **Spec §15 documents `max_input_tokens_per_turn` is post-hoc**: the
  SDK exposes `usage.input_tokens` only after a turn returns; the
  offending turn is billed before abort.
- **`eval/CLAUDE.md` parity list adds serial execution** — production
  may run skills concurrently; eval runs sequentially. Suite latency
  is ~30s/test today; gate CI on specific `--skill` / `--tag` rather
  than `--all`.
- **Tree.gedcomx.json schema-validation runnability test added** —
  paralleling the research.json test that already existed; the
  runnability code handled both files but only research.json was
  covered by tests.

Features added since v1.5 (the sixth-pass review):

- Negative-test `correct_skill: []` reverted to **strict spec §6 step 2**
  (skills_invoked must be empty). The v1.4 "had_substantive_effect"
  interpretation was too lenient — for out-of-scope inputs, Claude
  shouldn't even try a skill.
- Spec §6 rule 4 updated to **document the skill-name-aware heuristic**
  the harness implements (the previous "≥2 sentences" wording was
  superseded in v1.4 but the spec text hadn't been updated).
- **Proactive criterion-leakage flagging**: a new `harness/leakage.py`
  pattern-matches verdict-shaped phrasing in `additional_criteria`
  ("should resolve in favor of", "should classify as", "the right answer
  is", etc.) and surfaces matches in run_log.output.criteria_leakage_flags
  for senior review. Non-blocking — the test still runs.
- **`test_tree_ownership_table` universal validator**: parallel to the
  research.json ownership table, but for tree.gedcomx.json
  (persons/relationships/sources owned by tree-edit, init-project,
  proof-conclusion). Closed the gap where tree-edit writes were
  vacuously passing.
- **queue_reused → run-log warning**: when the mock fixture queue is
  exhausted and the last fixture is reused, a `warnings` entry surfaces
  on the run log so reviewers see the fixture-coverage gap.
- **disallowed_tools = complement**: the explicit disallow list now
  includes every `mcp__genealogy__*` tool NOT in the skill's allow-list,
  in addition to the dangerous-tools backstop. Belt + suspenders if
  `permission_mode="dontAsk"` ever regresses.
- **validators.passed = null for aborted runs**: schema extended to
  accept null; the v1.5 `passed=True` (vacuous) and the original
  `passed=False` (misleading) both misrepresented the not-run case.
- **runnability validates `negative.correct_skill`** against
  `plugin/skills/` — a typo no longer silently produces an unsatisfiable
  test.
- **CLI variance warning**: when running `--all` over 20+ tests, prints a
  stderr note about temperature=0 not being enforceable and suggesting
  `runs_per_test` bumping for optimizer / golden-set work.
- **`eval/CLAUDE.md` parity section**: documents the deliberate
  divergences from production Cowork (setting_sources, no temperature,
  mock MCP, sandboxed workspace) so operators don't expect identical
  behavior from unit tests alone.
- Spec §7 prompt-slot list **dropped {system_preamble}** (the preamble
  is inlined in the template, not a fillable slot).
- Spec §15 ownership section added for tree.gedcomx.json
  (init-project / tree-edit / proof-conclusion as writers).

Features added since v1.4 (the fifth-pass review):

- Judge prompt has explicit **leakage guardrail** for `additional_criteria`
  (largest validity threat fix) — applies the §5.4 neutrality test:
  grade reasoning, not verdict.
- Shape validation **delegated to jsonschema** against research.schema.json
  and tree-gedcomx.schema.json (dropped ~80 lines of duplicated Python
  literals: CLOSED_ENUMS, ENUM_FIELDS, ID_PREFIXES per-section mappings).
  Single source of truth.
- Runnability gate now **schema-validates scenarios** per spec §9, not
  just JSON-parses them.
- `response_fixture` is **populated** in the run log — threaded the
  fixture source name through `load_fixtures` → `build_manifest` → the
  mock handler so spec §10 audit-by-fixture works.
- Tool-usage rubric requirement (spec §7) **enforced** at runnability:
  skills with `allowed-tools` must declare a dimension named "tool usage",
  "argument quality", "response interpretation", or similar.
- Skill tool input key **verified** in e2e: PreToolUse hook records the
  observed key set; the e2e test asserts it's `{"skill"}` (or fallback
  "name") so an SDK change can't silently empty `skills_invoked`.
- Judge prompt **cache_control structuring**: stable prefix (rubric)
  marked ephemeral so the second+ test in a batched skill run hits the
  prompt cache. Spec §11 targets 50%+ judge cache hits.
- Judge `max_tokens` clipping **surfaced explicitly** — when
  `stop_reason == "max_tokens"`, raise JudgeError rather than failing
  parse opaquely.
- Judge **retry-with-backoff** on 529/429/connection errors (3 attempts,
  exponential delay). A transient 529 no longer aborts the suite.
- `_summarize_response` **depth-capped** at 8 — pathological nested
  fixtures can't hang the judge.
- `_safe_rubric_hash` uses **SHA-256 sentinels** ("<rubric missing>",
  "<rubric malformed>") instead of all-zeros — no more cross-run hash
  collisions for aborted runs.
- Rubric parser **enforces the 5-dimension cap** from spec §7.
- `validators/conftest.py` added so `pytest eval/harness/validators/`
  works standalone (spec §8). Default fixtures are empty;
  validator-author overrides them per test file.
- `OWNERSHIP_TABLE` reconciled with `plugin/skills/` directory names
  (spec used "init" shorthand, harness sees "init-project"); spec
  updated, and `search-full-text` added to the log writers row.
- Per-skill ownership checks (in `test_conflict_resolution.py` and
  `test_record_extraction.py`) removed — universal `test_ownership_table`
  is the single source of truth.
- `setting_sources` **reverted to ["project"]** — eval must be reproducible
  across developer machines; the previous ["user", "project"] was a
  contamination risk (operator's `~/.claude/skills/` leaked into routing
  tests). Spec §15 updated.
- Write/Edit always-granted documented in spec §15 (ownership table is
  about research.json sections, not "skill writes any file";
  `test_ownership_table` catches misuse).
- `temperature=0` documented as not exposed by the current SDK; variance
  is captured via `runs_per_test` bumping when needed.

Features added since v1.3 (the fourth-pass review):

- Skill vs judge tokens split at the run level. Run-level
  `input_tokens`/`cached_input_tokens`/`output_tokens` are skill-only;
  judge tokens live on the judge block (and in `totals` as
  `judge_*_tokens`). Restores the spec §11 cache-hit-rate diagnostic.
- `_is_substantive` is skill-name-aware: short responses that don't
  mention another known skill are substantive (fixes false-negatives
  on convert-dates, translation, terse wiki-lookup outputs); short
  responses that mention another skill are routing-acks.
- `HARNESS_VERSION` read from pyproject.toml via `importlib.metadata`
  (with toml-parse fallback for uv's editable-but-not-installed setup).
  One source of truth.
- text_response sidecar implemented: responses > 100 KB spill to
  `runs/<run_id>.text.md` per spec §10; the inline string becomes
  `{"ref": "..."}`. Schema's anyOf already accepted both shapes.
- Judge prompt fences `skills_invoked` from grading (spec §7) —
  routing decisions are deterministic, not for the judge to grade.
- `_aborted_log` validator block now uses `passed=True, results=[]`
  (vacuously true: zero validators ran, none failed).
- Negative-test outcome fix: drops the over-strict
  `if spec.skill in skills_invoked or activated` to `if activated`
  per spec §6 step 1. A routing-only Skill call to the skill under
  test no longer false-fails.
- `cleanup_session_store` lazy-imports `project_key_for_directory`:
  offline tooling (validator dev, spec inspection) now imports the
  module without an SDK present; cleanup still raises loudly if invoked
  without the symbol.
- Suite cost cap projects per-test cost (`spec.runs_per_test × avg`)
  before allowing the next test — a multi-run test can't blow past
  the cap mid-run.
- CLI help notes serial execution + suite runtime expectation.
- `--capture` flag for URL-driven fixture creation documented in v2
  plan (item 9).

Features added since v1.2 (the third-pass review):

- ResultMessage `is_error: true` now sets `aborted_reason="error"`; partial
  output no longer flows into normal outcome scoring.
- Universal `test_ownership_table` validator driven by a single OWNERSHIP_TABLE
  dict mirrors `research-schema-spec.md` §4 — covers all 23 skills via one
  source of truth (replaces the 1-of-23 per-skill validator gap).
- Hardcoded `_NO_FILESYSTEM_WRITE` set dropped. Write/Edit always granted;
  the ownership validator + disallowed-tools backstop are the layer-1 defense.
- Timestamps include milliseconds (`YYYY-MM-DDTHH-MM-SS-fffZ`) — preempts
  collisions in parallel/back-to-back runs.
- `setting_sources=["user","project"]` to match spec §15.
- Negative `correct_skill: []` check uses substantive-activity signals
  (file_changes, files_created, tool_calls) instead of bare `skills_invoked` —
  routing-only Skill calls that decline without effect no longer false-fail.
- Judge prompt total-size guard (`_TOOL_CALLS_MAX_CHARS=50K`); oldest tool
  calls are dropped with a `_dropped_for_size` marker.
- Judge `max_tokens` bumped from 2048 → 4096 to fit 7+ dimensions cleanly.
- CLI `--runlogs-root` flag so tests/scripts can write outside `eval/runlogs/`.
- Stray `ut_a_*.json` files at `eval/runlogs/` removed (test pollution).
- `test_no_mcp_tools_called` validator fixed (signature took `after_state`
  but never received `tool_calls`); regression test added.
- Validator unknown-param error now lists valid kwargs.
- Spec prose updated: predicated fixtures explicitly noted as having no
  per-call usage limit.

Features added since v1.1 (the second-pass review):

- `permission_mode="dontAsk"` so per-skill `allowed_tools` is enforced at
  call time, not only by the after-the-fact universal validator.
- `JudgeError` (and any other judge exception) caught and recorded as
  `judge.skipped: true, error: "..."` — one bad judge call no longer
  aborts the suite. `judge_results` schema extended with the `error` field.
- Empty CLI selection now returns exit 2 instead of 0.
- `aborted_reason="error"` documented in spec §10.
- `queue_reused` documented in spec §10 (schema already accepted it in v1.1).
- `xpass` naming consistent across schemas, code, and prose.
- ID-reference integrity now checks `conflicts.preferred_assertion_id`,
  `questions.depends_on`, `questions.unblocks`,
  `questions.resolution_assertion_ids`,
  `hypotheses.supporting_assertion_ids`,
  `hypotheses.contradicting_assertion_ids` in addition to the original set.
- `ID_PREFIXES` dead `pli_` entry removed; plan-item prefix check uses a
  named constant via its dedicated branch.
- `JUDGE_PRICING` covers Haiku 4.5, Sonnet 4.6, and Opus 4.7; unknown
  models warn once and fall back to Sonnet-class rates so total_cost_usd
  doesn't silently report zero.
- `_load_skill_frontmatter` deduplicated into `allowed_tools.load_skill_frontmatter`.
- Validator docstrings rewritten to reflect the actual harness-supplied
  arg shape; the `tool_calls` regression in `test_conflict_resolution.py`
  fixed, with a regression test in `test_validator_runner.py`.
- `_SUBSTANTIVE_MIN_SENTENCES` and `_SUBSTANTIVE_MIN_WORDS` promoted to
  documented module constants with rationale comments.
- `max_input_tokens_per_turn` docstring is honest: this is a post-hoc
  abort (the SDK reports usage after the turn ran), not a pre-emptive cap.
- `cleanup_session_store` requires `project_key_for_directory` at import
  time, so an SDK regression fails loudly instead of leaking entries.

E2E confirmation (after v1.2 changes):
`cd eval/harness && uv run python run_tests.py --test ut_wiki_lookup_001`
writes a schema-valid run log with outcome `pass`.

---

## Still deferred for v2

### 1. Parallel execution

**Cut:** Tests run serially via `asyncio.run` inside a sync wrapper.

**Spec §15:** `asyncio.gather` over independent per-test sessions.

**Integration point:** `eval/harness/run_tests.py::main` — the
`for spec in specs:` loop. Replace with `asyncio.gather` of
`_run_one_test_async(spec)` invocations.

**Why still deferred:** Serial baseline is stable. Parallel adds rate
limiting, session-store contention, and progress-reporting work that's
separable.

**Risks for v2:**
- Anthropic API rate limits during high-fan-out runs. Add a configurable
  concurrency cap (default 5).
- Session-store cleanup runs per test; verify nothing races.

---

### 2. Strict-isolation auth (subscription preference is already implemented)

**Status of subscription preference:** ✅ implemented. `auth.py::resolve_auth`
returns `skill_runner_mode="subscription"` whenever `~/.claude/` exists,
falling back to `api_key` only when no subscription is available. The judge
always uses `auth.api_key` independently. `AuthConfig` exposes both fields
so the two layers are resolved separately.

**What's still deferred — strict isolation only.** The Agent SDK's
`options.env` merges with `os.environ` rather than replacing it, so a
shell-set `ANTHROPIC_API_KEY` is still inherited by the SDK subprocess
even in subscription mode. The auth module docstring documents this:
put the key in `eval/.env` rather than the shell if you want subscription
mode honored.

True strict isolation would require:
1. Patching the SDK transport (`claude_agent_sdk/_internal/transport/subprocess_cli.py`) to replace env rather than merge, or
2. Running the CLI in a tightly controlled subprocess of our own that explicitly drops the inherited env.

Both are out of scope for the eval harness — the cost (forking SDK internals
or rolling our own transport) outweighs the gain (preventing operators from
accidentally using API-key auth when they think they're on subscription).

**Why still deferred:** Scrubbing inherited env requires patching the SDK
transport (or running the CLI in a controlled subprocess).

---

### 3. Stability floor (regression-vs-noise thresholds)

**Cut:** No regression threshold. Per-skill pass-rate noise band is unknown.

**Spec §7 "Stability floor (TBD)".**

**Integration point:** `eval/harness/run_tests.py` summary table. v2 adds
`--regression-baseline <path>` that reads a baseline run and flags any
pass-rate drop > noise_band as a regression.

**Prerequisite:** N=5 on the golden set to compute per-skill noise bands.

---

### 4. Gemini Flash judge option

**Cut:** Haiku 4.5 only (Sonnet 4.6 and Opus 4.7 are priced in `JUDGE_PRICING`
but the SDK client is hardcoded to Anthropic).

**Integration point:** `eval/harness/harness/judge.py::_make_client` —
branch on model name. Gemini uses `google.generativeai` and has different
tool_use semantics. `_extract_dimensions` would need a Gemini-aware variant.

---

### 5. Multi-turn dialogue support

**Cut:** Single-turn only. `init-project` and `search-external-sites`
decompose into single-turn tests per `unit-test-spec.md` §1.

**Integration point:** New `user_messages: [...]` array in
unit-test.schema.json + `harness/skill_runner.py::run_skill` takes a list
of prompts and feeds them turn-by-turn.

---

### 6. Per-fixture `input_schema` auto-extraction from the TypeScript MCP server

**Cut:** `input_schema` is an optional field on each fixture. Fixture
authors declare it explicitly; mock falls back to permissive when absent.

**v2 ambition:** Auto-extract `inputSchema` from the TypeScript MCP server
module so every mock tool's schema matches production by construction.

**Integration point when picked up:** `eval/harness/harness/mock_mcp.py` —
add a build step that exports `mcp-server` tool schemas to a JSON file the
harness loads, or have the MCP server expose them via a CLI flag.

---

### 7. Pre-emptive `max_input_tokens_per_turn` enforcement

**Cut:** Current check is post-hoc — the offending turn has already been
billed by the time the harness reads `usage.input_tokens` off the
AssistantMessage.

**v2:** Pre-turn hook with token estimation that aborts before the call.
Requires SDK support (a `PreSendMessage` hook or similar).

**Integration point:** `eval/harness/harness/skill_runner.py::_consume_messages`.

---

### 8. Cross-file ID-reference validation

**Cut:** `test_id_references_resolve` covers every research.json foreign
key but not cross-file references like `timelines.person_ids` (which point
to GedcomX persons in `tree.gedcomx.json`).

**Integration point:** `eval/harness/validators/test_universal.py` —
expand `test_id_references_resolve` to read `tree_gedcomx_json` from
`after_state` and collect persons[].id into known_ids before the
timelines check.

---

### 9. `--capture` flag for URL-driven fixture creation

**Cut:** Spec §3.2 references a `--capture` flag on the harness CLI that
hits the live MCP server with a URL/argument set and saves the response as
a fixture. Not implemented in v1.

**v2:** Add `python run_tests.py --capture <tool> <url-or-args> --out <fixture-name>`.
Calls the configured upstream (`mcp-server/` or the live API), saves the
response into `eval/fixtures/mcp/<fixture-name>.json` with the
appropriate `tool` and a placeholder `description`. Operator edits the
description and adds the fixture to a test's `mcp_fixtures` array.

**Integration point:** `eval/harness/run_tests.py::_build_parser` for the
flag; new `harness/capture.py` for the live-call logic (uses the same
HTTP client paths as `mcp-server/dev/try-*.ts` does in Node — port the
minimum needed).

---

### 10. Binary file outputs

**Cut:** `harness/workspace.py::snapshot_files` reads every workspace file
as text. Binary outputs (a hypothetical skill writing a PNG, ZIP, etc.)
are stored as the literal string `"<binary>"` in the snapshot. The
`files_created` list still surfaces the path, so the judge sees that
*something* was created, but it can't grade the contents.

**Acceptable for v1.x** because no skill in the current corpus produces
binary output. Flag and revisit if one does.

**Integration point:** `eval/harness/harness/workspace.py::snapshot_files`
— store a tuple like `{"kind": "binary", "bytes": N, "sha256": "..."}` so
the judge has something structurally inspectable to grade against.

---

### 11. Run-log content hash / dedup

Hash the run log content (excluding timestamps) and skip the write when
an identical recent run log exists. Useful for the description optimizer.

**Integration point:** `eval/harness/harness/runlog.py::write_run_log`.

---

### 12. CRUD UI

Out of scope for the harness entirely. Tracked in
`docs/specs/eval-crud-ui-spec.md`.

---

### 13. Skill discovery on Linux

The Agent SDK has historically had bugs with skill discovery on Linux
(testing-plan Appendix F, issue #268). On the affected versions,
`skills_invoked` can be empty even when the skill ran, false-failing
positive tests.

**Cut:** v1.2 accepts the false-fail and relies on the empty
`skills_invoked` field as the diagnostic for triage.

**Integration point when fixed upstream:** No code change here — the
strict requirement (spec §7) is correct. Confirm by running the full
suite on Linux once the SDK ships a fix.

---

## Notes on v1.x design decisions

- **Mock tool input schema requires both `"type"` AND `"properties"`** for
  the SDK to recognise it as a JSON Schema rather than param-name→type
  mapping. Fall back to
  `{"type": "object", "properties": {}, "additionalProperties": True}`.
- **Validators using `pytest.skip()` raise `Skipped`** from
  `_pytest.outcomes`. `validator_runner.py` catches it as
  "validator does not apply" → passed with a `skipped: <reason>` marker.
- **Model ID `claude-sonnet-4-6-20250514` doesn't exist.** Use
  `claude-sonnet-4-6`. Haiku has the date suffix:
  `claude-haiku-4-5-20251001`.
- **Subscription auth + judge:** Judge bypasses the Agent SDK and talks to
  the Anthropic SDK directly, which has no subscription path. CLI warns at
  startup when subscription-only mode is selected.
- **`iso_datetime` regex** accepts both `HH:MM:SS` and `HH-MM-SS` time
  forms so the harness's filename-safe timestamps validate.
- **`permission_mode="dontAsk"`** is the only mode that enforces
  `allowed_tools` at call time. `bypassPermissions` auto-approves everything;
  `default` would prompt the operator. We rely on the SDK's deny behavior
  *and* the after-the-fact universal validator for layered defense.
- **Activation rule 3 narrowing:** spec §6 rule 3 says "characteristic of
  the skill's workflow" in the heading and "listed in `allowed-tools`
  frontmatter" in the body. Code matches the body. An out-of-frontmatter
  call to an MCP tool fails the universal allowlist validator anyway, so
  this can't produce a false pass.
- **Positive-test strict Skill-tool requirement:** spec §7 mandates
  `spec.skill in skills_invoked`. Relaxing to the four-rule `activated`
  alone would let "wrong skill happened to write a file" pass. Linux
  skill-discovery bugs are the false-fail risk (deferred item 11).

---

## When v2 work begins

The natural next step is **#1 parallel execution** — every other deferred
feature is either small or infrastructure-heavy. Parallelism is where suite
latency compounds once the corpus grows past ~50 tests.
