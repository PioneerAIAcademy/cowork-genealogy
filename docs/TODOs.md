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
- [ ] **Upstream sidecar-staging gap** — one e2e run had all 18
  `record_persona_id`s nulled because the search never staged a sidecar
  (spriggs). D2 can't auto-fill what was never staged; the fix is
  search-skill-side (always pass `projectPath` / surface the staging failure).
- [ ] **Bare agent-tool names in gps-mentor.md / image-reader.md** — the
  agent-mode spike proved bare tool names leave a subagent toolless in the
  unit-harness SDK path (needs `mcp__genealogy__*`), yet these two agents use
  bare names and work in Cowork/e2e paths. Reconcile once the PR-3
  investigation lands: qualify (or dual-list) so all agents work identically
  in Cowork, the e2e harness, the unit harness, and the hosted web SDK path.

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
- [ ] **`image_read` callable by the main session** — prose failed 3x (rx_015):
  the record-extraction skill tells the MAIN session not to call `image_read`
  itself (delegate to image-reader), but no environment can currently deny a
  main session a tool an agent needs — Cowork allowed-tools are per-skill, not
  per-context. Wants a per-context tool-policy design (main-session denylist
  while an agent holds the tool).

## Eval framework
- [ ] **record-extraction real craft gaps (surfaced by the 2026-07-16 classification
  audit) — SKILL issues, not eval bugs; route per the lane rule.** The classification
  audit (docs/plan/record-extraction-tool-boundary-plan.md era) found 3 places the
  agent is genuinely wrong (these should keep partialing until fixed, and are NOT
  loosened): (1) census `informant_proximity: self` on household members — pre-1940
  the enumerator didn't record who answered, so it is `household_member`, never `self`;
  (2) a *stated* birthplace ("Ireland") marked `indirect` — a stated census birthplace
  is `direct`; (3) naming "the clerk"/recorder as the informant for a witness's facts —
  recorder ≠ informant. Fixes belong in the record-type playbook / agent body, gated by
  the unit suite. Also deferred: add a **christening informant table** (officiant =
  recorder; presenting parent = informant, proximity `household_member`) — a *specifying*
  fix for ut_016, not a loosening.
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
