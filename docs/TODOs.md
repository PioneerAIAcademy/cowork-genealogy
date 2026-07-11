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

## Eval framework
- [ ] **Revisit recovered-retry Tool Arguments scoring** — the judge policy
  (`eval/harness/judge/prompt.md` + the mirror note in
  `eval/tests/unit/record-extraction/rubric.md`) caps a validation-rejected
  call that Claude cleanly fixed on the first retry at partial (2). Chosen
  while the suite is *diagnostic*: the retry path is where wasted round-trips
  and silent op-drops were observed, and scoring it 3 would blind the trend
  to the failure class the composite-persist work eliminates. Once
  composite-persist has made validation rejections rare and the suite's role
  shifts toward regression acceptance (post-alpha), consider full credit for
  a cleanly-recovered single retry — decide with post-composite data.

## Done
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
