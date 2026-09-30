# U2: Patron sign-in and owner scoping (prototype web tier)

**Status:** Built and verified (2026-09-29) on branch `u2-patron-sign-in`; PR not yet opened. Offline suites, break proofs, embedded-Postgres and compose checks, a real FamilySearch sign-in on 1837, and the revocation measurement all ran. Plan reviewed by `plan-critic` and a split skeptic; their findings are folded in.

## Goal
This PR replaces the prototype web tier's stub auth with a real FamilySearch sign-in: PKCE, an email allowlist, and each patron's grant stored encrypted in Postgres. It scopes every session route and project to the signed-in owner. It includes no token refresh and does not pass the token to the worker; both belong to U3, which ships as a separate PR after this one. Handoff: [U2](familysearch-handoff.md) in list 1.

## Decisions (chesworthrm, 2026-09-29)
1. **The U13-host sign-in check moves to U13's Done-when.** U13 depends on U3, so it cannot run when U2 merges. U2 proves sign-in on compose through the dev key's `127.0.0.1:1837` redirect.
2. **The interim operator-token window is covered by a written rule, not a code guard.** The PR body and the web README say: until U3 merges, allowlist only staff entitled to the operator's FamilySearch access (see "Interim constraint").
3. **The web image builds from the repo root** and copies `packages/engine/mcp-server/config/familysearch.json` in, as the tools image already does (compose `tools` service, `context: ../../..`). There is no bind mount.

### Deviations recorded during implementation
4. **`PgStore._SELECT` uses `LEFT JOIN projects`, not `JOIN ... USING`.** `001_schema.sql` declares no foreign keys, so a session whose project row is missing must still load, with a NULL owner the route turns into a 404, rather than vanish. `test_pgstore_session_select_carries_the_owner_through_a_left_join` pins it.
5. **`web/auth.py` falls back to the checkout's `packages/engine/mcp-server/config/familysearch.json`** when `/app/config/familysearch.json` is absent, so the tier also runs from the venv (`make proto-web`). The fallback is added only when that parent path exists: indexing it unguarded crashed the tier at import inside the image, which the compose run found (`test_the_client_config_lookup_survives_the_image_layout`).
6. **`drive.py` expects the `turn_queued` key** `GET /events` has returned since PR #2870. That is unrelated to U2, but `make proto-drive` was failing on `main` without it, and it is one line.

## Evidence anchors (verified)
- **Stub auth:** `PROTO_USER` (app.py:90) and the `/auth/*` stubs (app.py:725-739).
- **Session gate checks existence only:** `_session()` (app.py:707-711). PATCH and DELETE call their own store methods (app.py:758-773). The store SQL has no owner filter: `list_sessions` 390-393, `get_session` 395-399, `patch_session` 401-409, `delete_session` 411-426. The delete also wipes documents, blobs, staging and projects by project_id (424-425).
- **Any client can attach any project:** `CreateSessionBody.project_id` (app.py:585-591) and `INSERT INTO projects ... ON CONFLICT DO NOTHING` (app.py:379). The SPA never sends a project_id (apps/web/src/api.ts:60).
- **Schema runs on every start:** by `PgStore.apply_schema` (app.py:349-361), by initdb (apps/server/proto/docker-compose.yml:28-30) and by the worker (worker.py:689-691). A new 008 must therefore be idempotent.
- **Web image contents:** it copies only enqueue.py, sql/ and web/, and pip-installs fastapi, uvicorn and psycopg (web/Dockerfile:11-15). `app.*` is not importable there.
- **Alpha source to port:** fs_oauth.py:55-147, auth.py:38-66, 193-214, 232-263, 266-286 and 296-408, crypto.py:35-44 and 59-70, config.py:195-271.
- **Alpha user upsert:** `_upsert_user` (auth.py:78-91) keys on email and never compares familysearch_id.
- **Projects the engine creates have no owner:** the engine inserts projects with project_id only (pg-s3-project-store.ts:564-570). seed.py creates the project through the engine and only then calls POST /api/sessions (seed.py:89-135), so seeded projects have a NULL owner.
- **No automated test covers the PgStore session SQL:** every route test drives FakeStore (tests/test_proto_web.py:58-100, stated at :661), and CI has no Postgres (server-tests.yml:108; handoff:104 U15).
- **Script clients:** seed.py:135, demo.py:229/265, turn.py:122-123/505-507 and drive.py:279-283 call /api/sessions without a cookie. Their fakes are in test_proto_demo.py:336 (a `nullcontext` client) and test_proto_kill.py:189-193 (a `post` that raises AssertionError).
- **Callback port:** the only registered redirect is `http://127.0.0.1:1837/callback` (apps/server/app/fs_oauth.py:11-14; packages/engine/mcp-server/src/auth/config.ts:14). The desktop login uses the same port (`make e2e-login`, Makefile:866-870). The compose web tier publishes on 127.0.0.1:8085 (docker-compose.yml:173-174).

## Files to touch
1. `apps/server/proto/sql/008_auth_owner.sql` (new).
2. `apps/server/proto/web/auth.py` (new, vendored).
3. `apps/server/proto/web/app.py`: Store Protocol (153-168; also add the missing `project_id` to its `create_session`), PgStore SQL, `_session`, routes, lifespan.
4. `apps/server/proto/web/Dockerfile` (decision 3): the build context becomes the repo root. The COPY lines become `COPY apps/server/proto/enqueue.py ./`, `COPY apps/server/proto/sql ./sql`, `COPY apps/server/proto/web ./web`, plus `COPY packages/engine/mcp-server/config/familysearch.json ./config/familysearch.json`. Add `itsdangerous cryptography httpx` to the pip line. Update the header comment. The root `.dockerignore` already excludes `node_modules`, `.git`, `.claude` and `eval`.
5. `apps/server/proto/docker-compose.yml`, web service (166-200):
   - `build: {context: ../../.., dockerfile: apps/server/proto/web/Dockerfile}`; update the "Context is ./" comment.
   - Add env PUBLIC_URL, WEB_ORIGIN, SESSION_SECRET, FS_TOKEN_ENC_KEY, ALLOWED_EMAILS and FAMILYSEARCH_WEB_ENABLED (default false). `FAMILYSEARCH_CONFIG` defaults to `/app/config/familysearch.json` in `auth.py`, so compose need not set it.
   - Keep the 127.0.0.1:8085 publish; update its "no auth" comment.
6. `apps/server/proto/docker-compose.fs-signin.yml` (new override): adds a `127.0.0.1:1837:8085` publish and sets PUBLIC_URL=http://127.0.0.1:1837 and FAMILYSEARCH_WEB_ENABLED=true. It is used only for the manual FamilySearch round-trip.
7. `apps/server/proto/turn.py`: add a `signed_in_client(base, email="dev@localhost")` helper that POSTs `/auth/dev-login` on an `httpx.Client` cookie jar. `seed.py`, `demo.py` and `drive.py` call it for all /api traffic, and each gains an `--email` flag.
8. `apps/server/tests/test_proto_web.py`: FakeStore (60-93) gains owner parameters and returns owner_id; update 302-304 and 949-958; rewrite `test_web_build_context_carries_enqueue_and_sql` (931-935) for the repo-root context and the new COPY paths; add the new tests.
8a. `apps/server/tests/test_continue_policy_parity.py:205-210`: this test asserts no web COPY source starts with `app`. Under decision 3 every source starts with `apps/`, so it goes red for the wrong reason. Change it to assert that no COPY source is `apps/server/app` or under it, and prove it: red for a planted `COPY apps/server/app ./app`, green for the new `apps/server/proto/...` lines.
9. `apps/server/tests/test_proto_auth.py` (new). The alpha cases are rewritten, not imported, because they depend on app.main and SQLite (tests/conftest.py:20-22).
10. `apps/server/tests/test_proto_demo.py` (`_fake_stack`, 325-336) and `apps/server/tests/test_proto_kill.py` (185-218): monkeypatch `turn.signed_in_client`, or give the fake clients a `post` that answers `/auth/dev-login`.
11. `apps/server/tests/test_proto_config.py`: add the three tables to `EXPECTED_TABLES`, plus the new tests below.
12. `Makefile:496`: add tests/test_proto_auth.py to `proto-test`.
13. `apps/server/proto/web/README.md`: the sign-in section, the env vars, the override file, the e2e-login port conflict, and the interim operator-token constraint.
14. `docs/plan/familysearch-handoff.md`:
    - :26: the web tier now has sign-in; FamilySearch identity stays the operator's until U3.
    - :76: the adjusted Done-when.
    - :94: drop "auth stubs (U2)".
    - :98: add "FamilySearch sign-in completes on the rehearsal host" to U13's Done-when.
    - :202: name SESSION_SECRET, FS_TOKEN_ENC_KEY, ALLOWED_EMAILS, PUBLIC_URL, WEB_ORIGIN and FAMILYSEARCH_WEB_ENABLED, and say that the web image carries familysearch.json.
    - Step 15: the web code now builds from the repo root and includes the client config.
    - U19's delete_session item: trim it to the S3 objects and the transcript.
    (The U2/U3 entries, U13's Done-when and U19 were already updated when this plan was written; recheck them when the PR lands.)

## Schema: `008_auth_owner.sql`
```sql
CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY,
  email text NOT NULL UNIQUE,
  familysearch_id text,
  sessions_revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS allowed_emails (email text PRIMARY KEY);
CREATE TABLE IF NOT EXISTS familysearch_tokens (
  user_id text PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  access_token_enc text NOT NULL,
  refresh_token_enc text,
  expires_at timestamptz NOT NULL,
  granted_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE projects ADD COLUMN IF NOT EXISTS owner_id text REFERENCES users(id);
CREATE INDEX IF NOT EXISTS projects_owner_idx ON projects (owner_id);
```
- `user_id` as the primary key gives U3 one row per patron to lock.
- `granted_at` is set at sign-in and never on refresh, so U3 can use it as the 24 h clock. The alpha's `expires_at` moves on every refresh (auth.py:94-116), so it cannot serve.
- A NULL owner means the project is visible to nobody, not to everybody.
- The owner goes on `projects`, not `sessions`, so U3 can resolve the patron from the project_id already in the queue body (app.py:223).
- Do not port the alpha's `projects` model or `create_all` (apps/server/app/models.py:54-66, db.py:33-45).

## Steps
1. **auth.py.** No refresh function, no lock, no refresh margin.
   - Settings are read from env at call time. ALLOWED_EMAILS defaults to empty.
   - `client_id()` reads the file at FAMILYSEARCH_CONFIG with `encoding="utf-8"`. If FAMILYSEARCH_WEB_ENABLED is true and the file is missing or unreadable, boot fails with a named error. It never falls back to "unconfigured", because that state turns dev-login back on.
   - `encrypt`, and `decrypt` returning `str | None`.
   - `pkce`, `exchange_code`, `fetch_identity` (browser UA, as at fs_oauth.py:32-40) and `expires_at_from` (8 h default).
   - Cookie: salt `wb-session`, payload {uid, iat}, 30 days, httponly, samesite=lax, secure when PUBLIC_URL is https.
   - `dev_login_enabled()` is true when FamilySearch is not configured and PUBLIC_URL is not https.
   - `preflight()` refuses default or empty SESSION_SECRET or FS_TOKEN_ENC_KEY on https. Its error text names the env vars, not Fly or Neon.
2. **Store.**
   - `sync_allowlist(emails)`, in one transaction.
   - `upsert_user(email, fs_id)`: when the stored familysearch_id is non-null and differs from fs_id, raise `IdentityMismatch`, which the callback maps to 403. When the stored value is null, set it.
   - `get_user`, `is_allowed`, `revoke_sessions`.
   - `store_grant(uid, access_enc, refresh_enc, expires_at)` takes ciphertext and runs one statement: `INSERT ... ON CONFLICT (user_id) DO UPDATE SET access_token_enc=EXCLUDED.access_token_enc, refresh_token_enc=COALESCE(EXCLUDED.refresh_token_enc, familysearch_tokens.refresh_token_enc), expires_at=EXCLUDED.expires_at, granted_at=now(), updated_at=now()`.
3. **Session scoping: the decision is made in the route.**
   - `_SELECT` becomes `sessions s JOIN projects p USING (project_id)` and adds `p.owner_id` to SessionRow.
   - `_session(request, sid, user)` returns 404 when the row is missing or `row.owner_id != user.id` (so a NULL owner is always 404).
   - PATCH and DELETE call `_session` first, then the existing statements. Check-then-act is safe: the owner of an existing project only moves from NULL to a user, and a NULL owner has already failed the check.
   - `list_sessions(owner)` filters `WHERE p.owner_id = %s` in SQL.
   - `create_session(title, model, project_id, owner, may_create_or_claim)`, in one transaction:
     - No project_id: mint an id and insert it with owner=caller.
     - project_id given: `SELECT owner_id ... FOR UPDATE`. If the owner is the caller, proceed.
     - If the row does not exist, or exists with a NULL owner, and `may_create_or_claim` (equal to `dev_login_enabled()`): insert, or `UPDATE ... SET owner_id=caller WHERE owner_id IS NULL`, then proceed.
     - Otherwise raise `ProjectNotOwned`, which maps to 404. Production therefore never creates or claims a client-chosen id.
   - `delete_session`: keep the per-session deletes. Delete documents, blobs, staging and projects only `WHERE project_id=%s AND NOT EXISTS (SELECT 1 FROM sessions WHERE project_id=%s)`, evaluated after the session row is gone.
4. **Routes.**
   - A `current_user` dependency: cookie, signature, user row (401 if any fails). It also enforces `sessions_revoked_at` against iat, and when FamilySearch is configured it requires the email to be allowlisted (403 otherwise).
   - All 15 `/api/sessions*` routes (app.py:743-906) depend on `current_user`. `/api/health` stays open.
   - `/auth/config`, `/auth/me`, `/auth/dev-login` (403 when disabled), `/auth/logout` (sets revoked_at).
   - `/auth/familysearch/login`: 501 when FamilySearch is unconfigured; `next` is checked with the safe regex from auth.py:293.
   - `GET /callback`, in order: check state, exchange the code, fetch identity, check the allowlist (403, no rows written), `upsert_user` (403 on an identity mismatch, no grant written), encrypt, `store_grant`, set the cookie, redirect.
   - Delete `PROTO_USER`.
5. **Lifespan.** Call `auth.preflight()` before building the store. After `apply_schema`, call `sync_allowlist`. Skip the allowlist sync when the injected fake does not implement it.
6. **Compose and ports.** Files 5-6. The default stack stays on 8085, so the script defaults (seed.py:110, demo.py:327, drive.py:413) and Makefile:635-646 do not change. The override exposes 1837 for the manual sign-in. The README warns that `make e2e-login` (and therefore env.sh's `.fs-token` minting) cannot bind 1837 while the override is up: mint the operator token first, or stop the override.
7. **Revocation measurement (in U2).** On compose, with a turn running on the operator's `.fs-token`, sign in through the override with the operator's FamilySearch account. Record whether that turn's FamilySearch calls start returning 401.
   - If they do, the PR and README say: sign in only between turns, or with a FamilySearch account other than the operator's, until U3 lands.
   - Either way, no guard ships.
   - **Measured 2026-09-29 (dev key, compose, n=1): a second sign-in does NOT revoke the account's earlier access token.** The operator's `.fs-token` answered `users/current` 200 on all 62 polls (every 5 s) from before the sign-in at 01:22:51 UTC to 01:27:57 UTC, for the same FamilySearch account (ids compared). Unlike a refresh, which revokes at once, a fresh authorization-code grant leaves the old token live, so no "sign in only between turns" warning is needed. The measurement ran as polls instead of a running turn: dev-login is off under the override, so no turn could be posted, and the poll asks the same question for free.
8. **Must not change:** queue_body (app.py:212-227), worker/*, the FS_ACCESS_TOKEN* compose lines, env.sh.

## Tests
**tests/test_proto_web.py** (FakeStore, which now exercises the real route decision):
- `test_second_user_gets_404_on_every_session_route`: parametrised over the per-id routes derived from `app.routes` (paths starting `/api/sessions/{session_id}`), asserting the derived count is 13. For each route, B gets 404 and A gets its normal status.
- `test_list_sessions_returns_only_the_callers_sessions`.
- `test_delete_by_another_user_leaves_the_session_and_project_documents`.
- `test_deleting_one_of_two_sessions_keeps_the_other_visible`.
- `test_create_session_refuses_a_project_owned_by_another_user` (404, no row).
- `test_create_session_on_own_project_opens_a_second_session`.
- `test_supplied_project_id_is_created_or_claimed_only_under_dev_login` (with FamilySearch configured: a new id and an unowned id both give 404).
- `test_session_routes_require_a_cookie` (401; health stays 200).
- `test_queue_body_carries_no_token_or_user_field` (the keys equal the six at app.py:220-227).
- `test_pgstore_list_sessions_filters_on_owner`, `test_pgstore_create_session_claims_only_unowned` and `test_pgstore_store_grant_keeps_refresh_and_resets_granted_at`: `inspect.getsource` pins in the style of test_proto_web.py:578/:736, using the whitespace-normalising matcher at :936-940.
- Rewrite 949-958 under a dev-login cookie, and update 302-304.

**tests/test_proto_auth.py** (the FamilySearch HTTP calls are monkeypatched):
- `test_callback_refuses_a_non_allowlisted_email_and_writes_no_rows`.
- `test_callback_state_mismatch_is_400`.
- `test_callback_stores_ciphertext_with_granted_at`: the value FakeStore receives starts with `gAAAAA`, is not the plaintext, and decrypts back to it.
- `test_callback_refuses_a_second_fs_account_for_an_existing_email`: 403, and no grant is written.
- `test_second_sign_in_resets_granted_at_and_keeps_refresh_token_when_omitted`.
- `test_next_redirect_accepts_only_safe_hash_routes`, `test_logout_revokes_existing_cookie`, `test_allowlist_removal_403s_an_existing_cookie`, `test_dev_login_disabled_when_fs_configured_or_https`, `test_decrypt_soft_fails_to_none_under_wrong_key`, `test_alpha_key_derivation_decrypts_alpha_ciphertext`, `test_preflight_refuses_default_secrets_on_https`, `test_fs_enabled_with_missing_client_config_fails_boot`.
- `test_web_auth_does_not_import_app_package` (AST).

**tests/test_proto_config.py:** `test_008_is_idempotent_and_owner_is_nullable`, `test_web_dockerfile_installs_auth_deps`, `test_web_image_copies_the_engine_client_config` (the Dockerfile COPYs `packages/engine/mcp-server/config/familysearch.json` to the path `auth.py` defaults to).

**Script-client fakes:** test_proto_demo.py and test_proto_kill.py pass after the fakes are updated (Files 10).

## Proving the guards fail
- **404 sweep.** Each break must go red, then gets restored:
  - (a) Remove the owner comparison from `_session`: the 11 routes that resolve through it go red.
  - (b) Make PATCH skip `_session`: exactly PATCH goes red.
  - (c) Add an unguarded dummy `/api/sessions/{session_id}/x` route: red through the derivation (count 14 ≠ 13, then 200 for B).
  - Legitimate direction: reordering the decorators or renaming a handler stays green.
- **SQL pins.** Each break goes red:
  - (a) Drop `p.owner_id = %s` from `list_sessions`.
  - (b) Drop `WHERE owner_id IS NULL` from the claim.
  - (c) Replace the COALESCE with a plain assignment in `store_grant`.
  - Legitimate direction: reflowing the SQL across lines stays green.
- **No-app-import AST lint.** Red for `from app.crypto import _fernet`, for `import app.config as c`, and for a nested import. `from web import auth` and a local named `app_state` stay green.
- **008 idempotency.** Red for `owner_id text NOT NULL`, for a missing IF NOT EXISTS, and for NOT NULL reflowed onto the next line. A comment containing the words "NOT NULL" stays green.
- **Queue-body pin.** Adding `fs_access_token` to queue_body goes red.

## Acceptance (falsifiable), mapped to Done-when
1. **A second user gets 404 on every session route.**
   - The sweep and list tests are green.
   - Live, against PgStore on `make proto-up`: a small script signs in as a@x and b@x through dev-login, creates a session as A, and sweeps all 13 per-id routes plus the list route with B's cookie. It expects 404 on each, and A's own session absent from B's list.
   - Break proof for the live script: with the list filter removed from PgStore, B sees A's session.
2. **Opening a session on another user's project is refused.**
   - The refusal test is green.
   - Live: B's `POST /api/sessions {project_id: A's}` returns 404, and `SELECT count(*) FROM sessions WHERE project_id=<A's>` is unchanged.
3. **Sign-in works on compose** (decision 1; the U13-host run is U13's).
   - With the override and the dev key, an allowlisted account completes the login, `/callback`, and lands on the SPA.
   - Inside the web container, `access_token_enc LIKE 'gAAAAA%'` holds, `web.auth.decrypt(access_token_enc)` is non-null, `granted_at` is not null, and `/auth/me` returns the email.
   - A non-allowlisted account gets 403 and leaves zero rows in users and familysearch_tokens.
   - The revocation measurement from step 7 is recorded in the PR.
   - `docker-compose build web` succeeds from the new context, and inside the container `/app/config/familysearch.json` exists.
4. **No regressions.**
   - `make proto-test` passes, including the demo and kill tests.
   - `make proto-seed FIXTURE=bagley-father-1884` prints a session id that is visible to dev@localhost only.
   - `make proto-demo` reaches turn_done on the operator token.
   - The web container boots with FamilySearch disabled, and refuses to boot with it enabled and `FAMILYSEARCH_CONFIG` pointed at a missing file.
   - Live: running 008 twice is a no-op, and an engine write through PgS3ProjectStore succeeds on a project with a NULL owner.
5. **Nothing of U3 leaked in.**
   - `grep -rnE 'grant_type"?: *"refresh_token|def refresh|asyncio\.Lock' apps/server/proto/web/` finds nothing. Show it matching once on a planted `grant_type: refresh_token` line, then remove the plant.
   - `git diff --stat main -- apps/server/proto/worker apps/server/proto/env.sh` is empty.

## Left for other units
- **U3:** the refresher and its per-patron database lock; the join that blocks refresh while a turn is live; the worker's per-attempt grant read; deleting `message['fs_access_token']` and the FS_ACCESS_TOKEN* fallbacks (docker-compose.yml:121-132,152) and their tests; the 24 h named outcome keyed on `granted_at`; the SSE FamilySearch state; the callback rewrite under the lock; the 8 h and 24 h idle measurements.
- **U4:** a lookup from the bearer to a user, added as a column in U4's own migration.
- **U19:** deleting the S3 objects and the transcript.
- **U11:** `.fs-token` in .dockerignore, and the NullQueue.
- **U13:** the host run, https PUBLIC_URL, dropping the loopback publish, and registering the host callback.

## Interim constraint (PR body and README; decision 2, no code guard)
Between U2 and U3, every signed-in patron's FamilySearch calls run under the operator's token (options.py:184-193). Project data is scoped to the owner; FamilySearch identity is not. The engine sends FamilySearch only reads, but they run as the operator. Until U3 merges, allowlist only staff who are entitled to the operator's FamilySearch access. There is no patron-facing host in this window, because U13 depends on U3 (handoff:56).