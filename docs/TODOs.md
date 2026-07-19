# TODOs — hosted web workbench

Deferred items to revisit. Not blocking the alpha. Architecture context:
`docs/plan/ably-realtime-migration.md`.

## Alpha readiness — deliberately deferred (2026-07-18)
Surfaced while preparing for the first alpha testers and consciously left for
later. Each was judged not to affect a tester's experience; the reasoning is
recorded so it can be re-examined rather than re-derived.

- [ ] **Session cost does not survive a page reload** — `SessionView.tsx` sums
  per-turn usage into component state, so a refresh restarts the count. The chip
  is now shown to all users (it was behind `?alpha=1`), which makes the reset
  user-visible; the tooltip says "counted since this page loaded" as the interim
  honesty measure. Real fix: a `Project.cost` column accumulated server-side.
  Accepted for the alpha (2 testers, no spend cap in play).
- [ ] **Per-user spend cap** — there is no cost, turn, or session cap anywhere in
  the control plane, and sandboxes pause but are never reaped. Tolerable at two
  testers with the cost now visible on every screen; needed before the tester
  count grows. Opus was removed from the model picker in the meantime
  (`SessionList.tsx`) since it is ~5× the cost.
- [ ] **Feedback Drive endpoint accepts unauthenticated writes** — the Apps
  Script URL is hardcoded in a shipped client and committed to git, deployed with
  "anyone" access, and `doPost` validates only that the fields are present. So
  anyone holding the URL can write arbitrary files into the team Drive folder.
  Explicitly deferred: harden later.
- [ ] **`feedback-json-spec.md` §6 contradicts the code on thinking blocks** —
  the spec says thinking is stripped before writing the session log; both
  bundlers deliberately **keep** it (it is the highest-value triage signal) and a
  test pins that behaviour. The user-facing copy in `FeedbackDialog.tsx` was
  corrected 2026-07-18; the spec still needs to catch up. Fix the spec, not the
  code.
- [ ] **GEDCOM import** — no GEDCOM 5.5 parser exists anywhere in the repo, and
  ingesting one needs a parser plus a mapping onto simplified GedcomX plus merge
  semantics against an existing tree. Alpha testers enter their starting tree
  conversationally instead (`init-project` builds local stub persons from what
  they type), and `docs/alpha-user-guide.md` says plainly that import is not
  available.

## Pre-production
- [ ] **Delete-janitor** — GC E2B sandboxes for sessions idle > N days (cost).
  There is no in-session reaper (E2B's `on_timeout: pause` lifecycle is the idle
  backstop; C5 removed the in-CP idle loop). This is only for *abandoned*
  sessions: a background task / cron that lists sandboxes whose project
  `last_active` is older than N days and deletes them.
- [ ] **`ws_signing_key` prod guard** — it defaults to
  `dev-ws-signing-key-change-me` (`config.py`). Make the control plane refuse to
  start in prod (e.g. when `PUBLIC_URL` is https, or behind an explicit flag) if
  it's still the dev default, so a deploy can't silently mint forgeable
  per-sandbox WS tokens.

## Engine — image transcription
- [ ] **User-invoked Opus transcription (`image_transcribe` Flow 2)** — brainstormed,
  **not requested by any user yet** (parked per YAGNI/scope-discipline). The research
  workflow uses **Qwen only** (`image_transcribe`); this would let a user ask Claude
  to transcribe a *specific* image with **Opus** on demand (premium, higher accuracy).
  Recommended shape: a user-only tool `image_transcribe_opus` — a thin wrapper over the
  same host-side OCR helper with the model pinned to an Opus slug **via OpenRouter** (so
  it inherits any-size + text-out + no base64, since the bytes never cross the MCP stdio
  transport) — that the research skills do **not** list in `allowed-tools`, invoked by
  the main session on request or a `/transcribe-image` command. Present the transcription;
  optionally write it into the source's `transcription` (the tool can already persist the
  scan via `projectPath`). Ideal future UX: a "Transcribe with Opus" button in the viewer
  beside the saved scan (needs a viewer→action channel). Open impl detail: Opus via
  OpenRouter (reuses the key; may lag the latest 4.8) vs the Anthropic API directly
  (latest, needs an Anthropic-key path). See `docs/specs/image-transcribe-tool-spec.md`.
- [ ] **Upgrade `image-reader` (small-image path) Sonnet 4.6 → Sonnet 5** — called out
  by the OCR quality spike as the **biggest remaining accuracy lever**, and cheaper and
  faster than the current pin. A one-line `model:` frontmatter change in
  `packages/engine/plugin/agents/image-reader.md`, gated by the eval suite, independent
  of the Qwen/`image_transcribe` work. Note the countervailing evidence from the
  record-extractor A/B: sonnet-5 at high effort can run away on adaptive thinking, so
  gate on a full suite run, not a spot check.
- [ ] **(Optional) Firm up the German OCR result** — the spike rested on a single
  German register page, which is thin for the domain the accuracy bet depends on. A few
  more German Kurrent pages would tighten the confidence interval before final sign-off.
- [ ] **(Optional) Add a third-party OCR datapoint** (Gemini / Mistral via OpenRouter)
  if the small-image cost question resurfaces.

## Before horizontal scaling (`count > 1`)
- [ ] **`init_db` → Fly `release_command`** — move `init_db()` (`create_all()` +
  the allowlist seed) off the per-boot path into a one-time Fly `release_command`
  that runs once before any Machine starts. At `count > 1`, two Machines booting
  together race: both pass `create_all`'s existence check then both `CREATE TABLE`,
  and both see an allowlist email absent then both `INSERT` the same PK
  (`IntegrityError`) — crashing a boot. **Not needed at `count = 1`** (single
  always-on Machine; no concurrent boot — harmless). Required before
  `fly scale count > 1`. See `docs/plan/neon-postgres-plan.md` § "Also before
  count > 1". (The other former `count > 1` blockers are already cleared: the DB
  pin by the Neon migration, and the `LiveSession` pin by the shipped
  sandbox-as-server arch; the `/v1` turn lock is already DB-backed.)

## Depends on other work
- [x] **Wiki page tools corpus — DONE.** `wiki_read` / `wiki_place_page` were
  moved to the networked `wiki-query-api` like `wiki_search`; all three are
  HTTP-only (`getWikiApiUrl()` + `fetch`), and the helper falls back to a working
  default URL, so nothing needs baking into the sandbox image and no per-sandbox
  config is required. Verified 2026-07-18. The stale `wikiMarkdownDir` comment in
  `apps/server/sandbox/e2b.Dockerfile` was removed at the same time — it had been
  describing a code path that no longer exists, which read as "the wiki page
  tools are broken" long after they were fixed.

## FamilySearch login (unified front door)
The hosted web workbench signs in with FamilySearch once; that login gates app
access (email allowlist) and yields the data token injected into every sandbox at
create. Google is gone. Follow-ups (`docs/plan/familysearch-login-plan.md`):
- [ ] **Register the prod HTTPS redirect** — FamilySearch must allow
  `https://<public-host>/callback` (top-level, **not** `/familysearch/callback`)
  for the bundled client id before the Fly deploy's login works. Locally it rides
  the desktop loopback registration. See `docs/plan/fly-deploy-plan.md` §
  OAuth-redirect.
- [ ] **Encrypt FS tokens at rest** — `familysearch_tokens.access_token` /
  `refresh_token` are plaintext (`models.py` TODO). Encrypt before any real PII /
  wider alpha.
- [ ] **Refresh-on-inject for long-lived sandboxes** — the token is injected at
  sandbox-create and self-refreshed in-sandbox by `getValidToken()` on first use.
  A sandbox created long before first use (or whose refresh token has since died)
  keeps a stale token; re-login at the front door updates the DB row but not an
  existing sandbox. Optionally refresh-on-inject / re-inject on resume.
- [ ] **Allowlist trusts an unverified email** — `/users/current` returns no
  `email_verified`, so the gate trusts the FS-account email as-is. Fine for a
  hand-curated alpha list; before open signup, pin `users[0].id` (trust-on-first-
  use) so an allowlisted email can't be claimed on a throwaway FS account.

## Skill coverage (orphaned tools)
These MCP tools are shipped, specced, and advertised, but no skill references them
(`image_search` is also orphaned — tracked separately as a new image-search skill).
- [ ] **Integrate `collection_read`** — skills call `collections_search` (13 of them)
  but none drill into a single collection's detail. Wire it into the search path
  (e.g. `search-records` / `record-extraction`) so Claude can read a collection
  after finding it.
- [ ] **Integrate `person_ancestors`** — the pedigree/ancestor-fetch tool isn't
  called by any skill (`tree-edit` uses the match tools + `person_read`, never
  `person_ancestors`). Wire it into the relevant tree/research workflow.

## Record-extraction consolidation follow-ups (2026-07 window)
Deferred at wrap; see
`docs/plan/record-extraction-consolidation-closing-report.md`.
- [ ] **Record-type playbook files + snapshot carve-out** — per-record-type
  references (census/death/probate/church/marriage) as the parallel-team
  ownership surface. Blocked on a design decision: inside the skill dir every
  playbook edit flips the runlog inactive (full re-run+annotation per edit);
  outside it agents have no reliable load path. Needs a deliberate, documented
  snapshot carve-out (e.g. a `playbooks/` subdir exclusion) before creating
  the files. Until then, compact tables live in the extractor agent body.
- [ ] **Fan-out extractor agents** — the extractor runs serially per record;
  the latency plan's P3 full form fans out one agent per record with parent
  batch-persist. Do after per-record overhead is measured on multi-record e2e
  runs.
- [ ] **Extraction→tree materialization gap ownership** — fact-less sibling
  stubs are never enriched, the 5d trigger can't fire on a family's first
  record, and no skill promotes extracted facts onto tree persons (8/27 e2e
  scenarios; judges penalize the thin tree). Needs an ownership spec:
  `merge_record_into_tree` grows this, or person-evidence does.
- [ ] **person-evidence epistemic gate** — identity over-reach: pe links
  written at `confident` from one uncorroborated record with `[?]` readings
  (clark-parents). The extractor agent got a tentative-cap line; person-evidence
  needs the equivalent gate + mandatory conflicts entry.
- [ ] **Recover the classification-quality drop from the sonnet-4-6 pin.** The
  extractor was re-pinned sonnet-5 → `claude-sonnet-4-6` (this PR) because sonnet-5
  hangs at Cowork/e2e `effortLevel: high` (adaptive-thinking runaway); the 8k
  output-cap alternative is non-viable (starves before any tool call, or runs away
  across turns — 0 pass, ~20 min/test in a 5-test A/B). Downgrading is the surgical
  fix (effort is session-wide, model is per-subagent) but costs ~0.24/3 mean judge
  score, concentrated in GPS classification nuance: 4.6 slips on the **existing**
  "Blank columns produce no assertions" rule and on `informant_proximity` /
  `evidence_type` calls. Deferred mitigation: follow the rx-partials pattern of
  adding concrete point-of-use examples (NOT duplicate rules), then re-run the
  record-extraction unit suite to confirm recovery. Do **not** target the 009
  death-cert case — judge noise, not craft.
- [x] **Upstream sidecar-staging gap — DONE (#699).** One e2e run had all 18
  `record_persona_id`s nulled because the search never staged a sidecar
  (spriggs). D2 can't auto-fill what was never staged, and — since
  `research_log_append` sets `results_ref` only from a `stagedResultsRef` — a
  search that omitted `projectPath` had **no** manual way to recover a sidecar.
  Fixed on two sides: the `search-records` / `search-full-text` skills now treat
  staging as a **hard gate** (results but no `staged.resultsRef`/a `stagingError`
  → stop and re-run with `projectPath`, never proceed), and `research_append`
  now **rejects** an assertions append whose log entry is a producer search
  (`record_search`/`fulltext_search`) that returned results but has `results_ref:
  null`, instead of silently nulling the persona ids.
- [x] **Bare agent-tool names in gps-mentor.md / image-reader.md — DONE
  (#698).** The agent-mode spike proved bare tool names leave a subagent
  toolless in the unit-harness SDK path (needs `mcp__genealogy__*`), yet the
  agents used bare names and worked in Cowork/e2e paths (e2e tolerated them
  via its ToolSearch prefix allowlist). All three agents now qualify their
  MCP tools (`image-reader` and `record-extractor` earlier; `gps-mentor` in
  #698, which also updated `docs/specs/gps-mentor-agent-spec.md`), so they
  behave identically in Cowork, the e2e harness, the unit harness, and the
  hosted web SDK path. The convention is documented in CLAUDE.md's "Cowork
  plugin agents" section (built-in `Read` stays bare).

- [x] **Extractor write authority is too broad (op-level restriction)** —
  **superseded by the `tree_edit`/`tree_correct` split (this commit,
  2026-07-12)**: the mutating ops (`update_fact`/`update_name`/`update_person`/
  `update_source`/`remove`) moved to a new `tree_correct` tool; `tree_edit`
  keeps only the additive ops, so the record-extractor agent (tree_edit only)
  is structurally unable to rename/rewrite/remove existing tree entities
  (the ut_013 rename incident). Residual gap: **per-op authorization within a
  single tool is still unavailable** — if a finer split is ever needed (e.g.
  add_name but not add_person), there is no `allowedOperations` caller
  contract; the only lever is splitting tools again.
- [ ] **Enum-drift lint** — grep prose enum enumerations (agent bodies, cribs,
  rubrics) against `enums.schema.json` in CI, following the places-guidance
  byte-lint pattern. Two drift instances shipped 2026-07-12 (the /research crib
  listed `researcher` as invalid after it became a valid
  `informant_proximity`; record-extractor's negative-evidence section still
  said `unknown`).
- [ ] **`image_read` callable by the main session — PRODUCTION half only; the
  harness is fixed.** The router must not call `image_read` itself: the inline
  base64 overflows the transport's ~1 MiB per-turn buffer and crashes the run.
  *Both harnesses now enforce this* — the PreToolUse hook denies the call when
  `agent_id` is absent (main thread) and a universal validator hard-fails the
  test (`harness/context_policy.py`; plan: `docs/plan/image-read-context-policy.md`).
  **This item's original premise was wrong** and is kept here as a correction:
  "no environment can currently deny a main session a tool an agent needs" is
  true of the *allowlist* layer only — per-agent `tools:` is subtractive, so the
  session set is always a superset — but false of the *hook* layer, which can
  discriminate by context and always could. Do not re-derive a per-context policy
  design; it exists.
  **What remains is production.** Cowork has no eval hook, so the crash is still
  reachable there, and because per-agent tools are subtractive production is in
  one of two bug states that e2e cannot distinguish (its allowlist is a
  `mcp__genealogy` wildcard): either Cowork's session set honors the skill's
  `allowed-tools` and excludes `image_read` — in which case the image-reader
  subagent cannot call it either and **image reading is silently broken in
  production** — or Cowork grants a broader set and **the router can crash a real
  user's run**. Settling it needs one live Cowork run against an image ARK, not a
  repo read. See plan §5.
- [ ] **Does `search-images` have the same base64 crash exposure?** Two shipped
  claims contradict each other and both can't be right. `record-extraction/SKILL.md:70-73`
  and `agents/image-reader.md:13-16` say accumulated `image_read` base64 overflows
  the transport's ~1 MiB per-turn buffer and **crashes the whole run**, which is why
  that skill delegates to a throwaway subagent. But `search-images` declares
  `image_read` itself (`SKILL.md:20`) and browses a volume **page-by-page in its own
  main-session context** (`§4 Browse with image_read`) — the accumulation pattern the
  warning describes, only more so. Either search-images is exposed to the same crash
  (and should delegate per-page, or the reader should), or the crash needs conditions
  beyond "more than one image" and the record-extraction rationale is overstated.
  Worth settling because the answer changes the per-context guard's scope: today it
  exempts search-images purely because the skill declared the tool
  (`harness/context_policy.py`, plan §4.1), which encodes "declared = intended", not
  "declared = safe". Surfaced 2026-07-16 while implementing
  `docs/plan/image-read-context-policy.md`; NOT investigated.

## Tree materialization (#701) — deferred from implementation
Deferred during the #701 build.
- [ ] **Batch `add_relationship`** — person-evidence now writes a household's
  parent-child + spouse edges as N separate `tree_edit add_relationship` calls
  (Phase 3A, Option 1: tools encode the write, the skill handles matching). A
  batch mode (multiple edges in one validated write) would make a household's
  edges atomic and cut tool round-trips for the common census-child case (~7-9
  edges). Latency/atomicity only — per-edge writes are correct today. Surfaced
  2026-07-18 while implementing Phase 3A.

## Eval framework
- [x] **record-extraction real craft gaps (surfaced by the 2026-07-16 classification
  audit) — RESOLVED (#711 + record-extractor informant-craft follow-up).** The audit
  found 3 agent craft gaps + a christening-table gap. Resolution:
  (2) *stated birthplace marked `indirect`* — subsumed by **#711** (the census
  direct/indirect rubric rebuttal + agent doctrine + structured `birth`+`place`=`direct`
  model; the skill already persists it `direct` — the inversion was the judge's, now
  fixed).
  (1) *census `informant_proximity: self`* — added an explicit "**never `self` on a
  census**; a pre-1940 enumerator didn't record who answered → `household_member`"
  prohibition to the agent.
  (3) *clerk/recorder named as informant for a witness's/party's facts* — generalized the
  recorder≠informant principle across record types (enumerator/clerk/officiant/registrar
  *record* but don't *inform* for the parties' biographies).
  Christening informant table added (officiant = recorder; presenting parent = informant,
  `household_member`; a christened infant is never `self`) — the specifying fix for
  ut_016. All in the record-extractor agent body, gated by the unit suite.
- [x] **Stop the record-extraction suite flapping — grade unambiguous things reliably
  (2026-07-16).** After the systematic fixes (#711), the residual fails were rotating
  sampling/judge noise, not defects. Three grading-quality changes (not agent tuning):
  (1) **deterministic-validator deference** (`orchestrator.apply_deterministic_deference`)
  — when `test_expected_classifications` passes, the LLM `Evidence type accuracy` /
  `Informant identification` dimensions cannot FAIL on the verified classifications
  (floored 1→2); kills the recurring census/death-cert judge-inversion flap. (2) an
  **`optional` matcher flag** — a fact whose *existence* the skill produces unreliably
  (009's death-cert parent names) is no longer a hard `expected_classifications` gate;
  its classification is still checked when present, and the soft `Completeness` dimension
  covers the omission. (3) **fixture clarifications** for genuine ambiguities the
  atomicity edit exposed (018: child->head `direct` stated vs child->spouse-of-head
  `indirect` inferred). The 009 `xfail` was reverted (xfail is for deterministic
  known-failures, not flaps). If a dimension needs stronger stability later, consider
  extending the deference to force-3 for comprehensively-declared fixtures, or
  `runs_per_test>1` (the only lever for raw skill-output variance).
- [ ] **Revert the temporary $25 e2e cost caps** — `bottemiller-parents` and
  `cruz-corona-ancestry` fixtures carry `caps.max_cost_usd: 25` as experiment
  headroom for the extractor-state-diet measurement window (3 of 5 e2e runs
  were hitting the default $15 cap pre-diet; cruz peaked at $19.12). Once the
  diet (`project_context` + tool-side source reuse + `add_household_children`)
  demonstrably lands runs under $15, drop the `caps` blocks so the default cap
  is the regression gate again.
- [x] **Judge fabrication class — give the judge before-state file content** —
  **shipped (branch `rx-tool-boundary`).** three citation fails (2026-07-12)
  came from the judge claiming on-file text was fabricated or absent. The
  harness now threads the before-run `sources` (research.json `src_`) + tree
  source descriptions (`S`) into a `{before_state}` judge-prompt slot
  (`orchestrator._summarize_before_state` → `judge.grade`), bounded, with a
  prompt section telling the judge to check "not on file" claims against it.
  `(none)` for empty-project scenarios (most record-extraction tests).
- [x] **Revisit recovered-retry Tool Arguments scoring** — **DECIDED + shipped
  (2026-07-16, branch `rx-tool-boundary`).** The prior policy capped a
  cleanly-recovered validation retry at partial (2) — chosen while the suite was
  *diagnostic*, to keep the retry-cost failure class visible. The tool-boundary
  work (record-extraction-tool-boundary-plan.md: name-lift, access_date ISO,
  plan_item_id) turns most of those rejections into silent normalizations, so
  the remaining rejections are rare and legitimate ("tool says exactly what to
  fix → Claude fixes it"). New policy in `eval/harness/judge/prompt.md` (+ the
  rubric.md mirror): a **single clean recovery** scores **3** (grade the final
  persisted state, not the rejected attempt); **2** is reserved for an *unclean*
  recovery (multiple retries / thrashing / a retry still leaving a non-critical
  arg wrong); a wrong critical arg or an unrecovered error still fails. This is a
  project-global judge-prompt change (bumps `judge_prompt_hash` for all skills —
  warn-only, CI rule 2b). It is the primary partial→pass lever toward the
  record-extraction 75%-pass target; validate its effect (and guard against
  over-reach) with the N≥3 acceptance run per the plan's §10 acceptance test.
- [ ] **Verify harness stop-early kill reliability on Windows; robust path if it
  fails.** The shipped quick path leans on OS process-group signal delivery plus the
  SDK's `atexit` sweep to kill in-flight subprocesses — reliable on macOS/Linux, but
  `CTRL_C_EVENT` reaching child console processes on **Windows** (the genealogist
  team's platform) is murkier. **Verify on a real Windows box.** If in-flight `claude`
  processes survive a Ctrl-C there, adopt the robust path: run each test in a child
  process the harness owns — replace the `ThreadPoolExecutor` of `run_one_test` calls
  with a `ProcessPoolExecutor`/explicit `subprocess`, spawned `start_new_session=True`,
  and have the stop handler terminate each worker's process group explicitly
  (`os.killpg` on POSIX, `CTRL_BREAK_EVENT`/`TerminateProcess` on Windows).
  **Inversion to watch:** putting children in their own session means a terminal
  Ctrl-C no longer auto-kills them — ship the explicit teardown *with* it or
  interrupts hang. Cost: `run_one_test` currently shares the parent's imports, auth
  object, and `OrchestratorPaths` in-process, so inputs must become picklable or be
  reconstructed in the child. Bonus: owned subprocesses make a SIGKILL under memory
  pressure one lost test rather than a process-wide hazard. Incremental partial
  persistence is transport-agnostic and unaffected either way.
- [ ] **Attack the eval stall tax (fix deferred pending data).** Instrumentation is in
  place (`duration_api_ms`, `skill_attempts`, and the harness's post-run "Timing
  breakdown": skill work vs wall, API %, judge time, turns, transient retries). The
  *fix* was deliberately deferred — committing to a service-tier change or a
  silence-watchdog retune blind would be guessing. Use `make eval-timings` to decide.
  Related, no harness code: use `num_turns` + output tokens to spot chatty or
  over-scoped *positive* tests; that time is inherent model generation, so cutting it
  is a test-authoring / skill-prompt decision. **Decided against:** mass-tightening the
  80+ oversized `max_wall_clock_seconds` caps — once LPT weights by actual duration the
  cap is only a safety ceiling, so an over-generous cap costs nothing, and tightening
  adds abort/flakiness risk. Revisit only if a specific runaway needs a faster ceiling.
- [ ] **Judge is blind to provenance nulling** — the record-extraction closing report §4
  notes no judge/eval dimension detects a null-persona regression. Needs a rubric or
  deterministic-validator change to catch it.

## Research latency (e2e `/research` runs)
Parent plan: `docs/plan/research-latency-reduction-plan.md`. These two levers were
sized by the Phase-0 latency analysis and are not covered by the parent plan's phases.
- [ ] **Negative-result short-circuit / defer proof** *(top direct lever)* — in the
  `/research` orchestrator, when a question's retrieval yields **no candidate answer
  for the objective**, `research_log_append` a negative result and route to the next
  question, **deferring** the exhaustiveness / proof-conclusion / gps-mentor gates until
  a candidate exists at the objective level. *Defer, don't eliminate* — GPS rigor stays.
  Gate on the agent's explicit "no candidate" signal (it already emits one). Co-design
  with `question-selection`, which is the root cause (it posed the elizabeth gatekeeper
  question); consider not spawning full-proof-cycle gatekeeper questions at all.
  **Rigor-critical: validate on an instrumented e2e re-run before shipping.** Exit
  criteria: on elizabeth-class runs the breakthrough moves earlier and the answering
  question's proof completes inside the cap; answering-first runs (bottemiller) are
  unaffected.
- [ ] **Cut gps-mentor gate count** — gps-mentor is invoked 3–4 gates per answering
  question at ~40–84s each (≈3.5–4 min/question) on the critical path, since the parent
  blocks on each gate. The model half of this lever is **already banked** (repinned
  `claude-opus-4-8` → `claude-sonnet-5`); the residual is the gate *count*: the spec has
  3 checkpoints but runs show 4 (re-checks, "second pass", "final critique after
  revisions"). Consolidate the re-invocations. Optionally right-size per gate — run the
  lightweight readiness gates on a faster model and reserve the stronger model for the
  substantive post-proof critique. (The negative-result short-circuit above already
  removes gates entirely for *non-answering* questions; this covers the answering path.)

## Skills / tools — smaller deferrals
- [ ] **Write `docs/specs/place-distance-tool-spec.md`** — `place_distance` is
  advertised in `tool-schemas.ts` but is the only live tool with **no spec**, so
  `spec-review` cannot check it. The 2026-05-07 timeline-distances design doc was the
  de facto stand-in and has been retired; the behavior is currently defined only by
  `src/tools/place-distance.ts` and its use in `timeline/SKILL.md`.
- [ ] **Optional `site`/`host` filter param on `external_links_search`** — deferred from
  the search-shaping work (option B) as unnecessary while the count cap holds. File it
  properly if the cap proves insufficient on real runs.
- [ ] **Named-agents catalog + contributions on-ramp in README** — the researcher-
  experience plan designed a "Named Agents" capability table (job-title framing —
  Question Finder, Record Extractor, Conflict Resolver, … ≈22 rows mapping to skills,
  deliberately excluding `wiki-lookup` as the reference example) to replace the flat
  skill list, plus a CONTRIBUTIONS section with researcher-responsibility framing. The
  `researcher_profile` half of that plan shipped; this presentation half never did.
  Unbuilt product intent, recorded here because the plan doc is being retired.

## Done
- ~~Generate the mock input-schema mirror from compiled schemas~~ —
  **shipped** (2026-07-13): `mock_mcp.py` now pulls both input schemas and
  descriptions from the compiled `allToolSchemas` (`build/tool-schemas.js`)
  via a single cached `node` import, killing the drift class. Deleted the
  ~290-line hand-maintained `_live_tool_input_schema` and the src-regex
  `tool_catalog.py` (+ its test). Fixture-tool schema precedence is now
  build → fixture-provided (aspirational tools only) → permissive, so the
  match-tool fixtures that had no schema (rx_007/008) advertise the real
  `required: ["id"]` instead of a zero-required `{additionalProperties:true}`
  stub. Safe because engine deps + a fresh build are already hard
  prerequisites of every eval run (`$(ENGINE_BUILD)` → `$(ENGINE_DEPS)` +
  the build-fresh gate); the loader degrades to permissive/stub on a
  missing build rather than aborting.
- ~~Negative-evidence `informant_proximity` enum value~~ — **shipped**
  (2026-07-12, the tree_edit/tree_correct + enum-drift-fixes window):
  `researcher` is a valid `informant_proximity` closed-enum value with the
  full blast radius applied — both `enums.schema.json` trees, the TS union in
  `packages/schema/src/index.ts`, validator `CLOSED_ENUMS`, and the
  `research-schema-spec.md` prose (`researcher` = the value is the
  researcher's own conclusion — negative evidence, structure-inferred
  relationships; `unknown` = a record informant exists but can't be
  identified). Residual prose-drift policing is the separate "Enum-drift
  lint" item above.
- ~~`/v1` FamilySearch token mechanism~~ — **shipped**: `POST /v1/sessions` accepts an
  optional `familysearch_token` ({`access_token`, `refresh_token?`, `expires_in?`}),
  injected straight into the sandbox at create and **not** persisted. Include the
  refresh token for sessions that outlive the ~1h access-token TTL — the in-sandbox
  `getValidToken()` self-refreshes, so one create-time injection covers the sandbox's
  life (same as the browser path). Omit it for an FS-tool-less session. Mechanism chosen:
  per-request token at create (caller may pass a per-client or shared service token).
  See `docs/plan/public-rest-api.md` § `POST /v1/sessions`.
- ~~`/v1` public REST chat API~~ — **shipped** (#294) as a control-plane
  WS-client to the in-sandbox server; bearer auth, sync + SSE, DB-backed turn
  lock. Spec: `docs/plan/public-rest-api.md`.
- **Router-side (main-thread) lane enforcement** — `extraction_append` (#695)
  makes the record-extractor structurally unable to write `person_evidence`,
  but nothing restrains the *router*: e2e grants `mcp__genealogy` wholesale
  (`eval/harness/e2e/orchestrator.py`) and the hosted path runs
  `permission_mode="bypassPermissions"` with no allowlist
  (`apps/server/app/agent/real_agent.py`). Precedent that this matters:
  `eval/harness/harness/context_policy.py` exists because the router was
  observed calling `image_read` directly after the same class of lane was
  closed on the agent. Current mitigation is prose in
  `record-extraction/SKILL.md`. The instrument if it recurs is a
  `context_policy` PreToolUse rule keyed on `agent_id` — eval-only, so it
  would not cover Cowork or the hosted path.
- **MCP tool-name prefix differs between Cowork and the harnesses — agent
  `tools:` lists do not bind in Cowork.** Every plugin agent declares
  `mcp__genealogy__*`, correct for the unit + e2e harnesses. A live Cowork
  session (2026-07-18) shows the tools surfaced as
  `mcp__remote-devices__Genealogy_Research__*`, and `image-reader` **failing in
  production** because it "looks for `mcp__genealogy__image_transcribe` but the
  tool here is named `mcp__remote-devices__Genealogy_Research__image_transcribe`".
  Two consequences, both the opposite of over-permissioning: an agent is scoped
  to a list matching nothing (under-permissioned to zero tools), and a
  `disallowedTools` entry naming an unresolvable tool denies nothing — so #695's
  belt-and-braces layer is inert in Cowork.
  That same failure is the proof Cowork *does* enforce `tools:` restrictively:
  an ignored allow-list could not break a subagent by name mismatch. So the
  mechanism is sound and only the names are wrong.
  Affects all three agents (`gps-mentor` 7 tools, `record-extractor` 9,
  `image-reader` 1) — pre-existing, not introduced by #695.
  **Open questions the fix must answer:** is the prefix deployment-dependent
  (remote/bridged MCP vs a local `.mcpb` install)? If so, no hardcoded string is
  right everywhere — is a server-level pattern (`mcp__<server>` /
  `mcp__<server>__*`) viable, or bare names (CLAUDE.md says bare names left the
  subagent toolless in the unit-harness SDK path, so neither form is currently
  known-good in both)? The fix must also correct `CLAUDE.md`'s claim that
  qualified names make an agent "behave identically across Cowork, the e2e
  harness, the unit harness, and the hosted web SDK path" — that is false.
- **The router substitutes for a denied subagent tool — observed in production.**
  In the same Cowork session the `record-extraction` router correctly recited
  that it "cannot call ... `research_append` ... or `image_transcribe`/`image_read`
  directly", then in the next breath: "I'm falling back to `image_read` to pull
  the scan inline so I can see it directly." This is the exact substitution
  #695's spec §11.4 names as out of scope, and the same tool
  `eval/harness/harness/context_policy.py` was built for — but that hook is
  eval-only, so nothing covers Cowork or the hosted path. Closing a lane on a
  subagent raises pressure on the router doing the job itself; any real fix has
  to bind the main thread too.
- **`match_score` remains fabricable by person-evidence** — it is not
  derivable at the tool boundary (`same_person`'s tree side is a hand-curated
  record-sized slice; a local stub returns a degenerate near-zero score the
  skill must read as *no score*), so the lever is eval/rubric, not tooling.
  A provenance guard was designed and cut in #695: zero observed true
  positives across all 15 `eval/tests/unit/person-evidence/` cases, against a
  real false-positive class.
- **`_make_research_append_handler` duplicates `_make_compiled_tool_handler`** —
  in `eval/harness/harness/mock_mcp.py` the two are now byte-equivalent modulo
  the parameterized names; the `ops`-shape fallback that justified the bespoke
  copy is gone. `extraction_append` (#695) uses the generic builder. Collapse
  `research_append` onto it too and delete the bespoke handler.
- **README tool catalog is stale** — `README.md` says "33 tools" in one place
  and "31 MCP tools" in another; `manifest.json` lists 45. `research_append`,
  `tree_edit`, `materialize_facts`, and `extraction_append` appear in no README
  tool table, and `docs/specs/mcpb-package-spec.md` still tells a manual tester
  to assert 21 tools. No CI reads either, so nothing reds.
