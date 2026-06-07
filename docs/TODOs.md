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

## Depends on other work
- [ ] **Wiki page tools corpus** — `wiki_read` / `wiki_place_page` need the
  pre-crawled wiki markdown (`wikiMarkdownDir`). Being handled by baking the
  corpus into the `wiki-query-api` tool (not the sandbox image). Once that lands,
  point those tools at it (or move them to the networked API like `wiki_search`).
  Until then they error; everything else works.

## Dropped (revisit only if needed)
- `/v1` public REST chat API (`docs/plan/public-rest-api.md`) — deferred; would
  re-base onto a server-side WSS-to-sandbox proxy.
