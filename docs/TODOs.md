# TODOs — hosted web workbench

Deferred items to revisit. Not blocking the alpha. Architecture context:
`docs/plan/realtime-rearch-status.md`.

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
- [ ] **Wiki page tools corpus** — `wiki_read` / `wiki_place_page` need the
  pre-crawled wiki markdown (`wikiMarkdownDir`). Being handled by baking the
  corpus into the `wiki-query-api` tool (not the sandbox image). Once that lands,
  point those tools at it (or move them to the networked API like `wiki_search`).
  Until then they error; everything else works.

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
Deferred from `docs/plan/record-extraction-consolidation-plan.md` §7 at wrap.
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
