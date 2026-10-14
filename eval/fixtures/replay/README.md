# Replay cassettes

Recorded upstream answers that let `make replay-sizes` replay the FamilySearch
and wiki tools — `wiki_read`, `wiki_place_page`, `wiki_search`,
`record_search`, `record_read` (live mode), `volume_search`, `fulltext_search`
— with **no network**. Both engine builds in a replay read the same bytes for
the same request, so the size difference between them is the build's own,
never upstream drift. Task T1.4c of `docs/plan/cost-latency-10x.md`.

## What is here

- `manifest.json` — the recorded set: `recorded_at`, `engine_sha`, build
  `version`, `privacy_year_floor`, `allowed_ids_sha256`, `tree_subrequests`,
  and per run and call index either `{"status":"recorded","keys":[...]}` or
  `{"status":"excluded","reason":...}`. The manifest's run list **is** the set.
- `cassettes/<group>.jsonl` — one upstream exchange per line, sorted by key,
  deduplicated across runs. Groups: `wiki`, `fs-search`, `fs-records`,
  `fs-places`, and — only if Q1 below allows — `fs-match` and
  `fs-attachments`. A group over 20 MB is split into `<group>.<hex>.jsonl` by
  the first hex character of `sha256(key)`. Line fields: `key`, `method`,
  `url`, `accept`, `body_sha256`, `status`, `content_type`, `body`,
  `rewrites`. **There is no request-header field.**

Nothing is recorded here yet. Until Dallan answers Q1, recordings go to a
scratch folder outside the repo.

## Why committing these is allowed, and what holds it

Dallan's ruling of 2026-10-06 approved recording the FamilySearch record tools
and the wiki on one premise: **no living person's data in the public repo.**
Four rules hold that premise. They live in one stdlib-only module,
`eval/harness/e2e/replay_privacy.py`, which runs twice: as the recorder's
filter, inside the fetch hook, on every upstream body *before* the engine sees
it — so only the filtered bytes are ever written — and as the CI lint
(`eval/harness/tests/unit/test_replay_cassettes.py`) over what is committed.

1. **Endpoint allowlist.** Only the endpoints these seven tools call, matched
   on scheme, exact host, path prefix and method. Anything else — the tree
   API, memories, OpenRouter — taints the call and it is excluded.
2. **Living-person year floor** (`recording year − 100`; 1926 for 2026,
   stored in the manifest). Read from structured person and record dates
   only, never from collection titles or citation access dates. A search entry
   dated at or after the floor is dropped before the engine sees it; a
   full-text entry with no `recordDate` and no `DATE` entity is dropped too; a
   `record_read` dated at or after it is never written.
3. **Identifier rewrite.** A tree-person id outside the committed fixture and
   run trees (hashed into `allowed_ids_sha256`) becomes the fixed placeholder
   `ZZZZ-ZZZ` / `ZZZZ-ZZZZ`, never anything derived from the real id.
   Attachments are rebuilt to `{entityId, tags}` — the attacher's account id
   (`contributorId`) is never stored — and match responses to
   `{entries:[{id, score, confidence}], title, updated}`.
4. **Credentials.** Every line and the manifest pass the run-log credential
   scanner, plus no `Authorization` key and no `Bearer` token value.

## Q1 — open, for Dallan

May `record_search`'s two tree-touching sub-requests be committed in the
sanitised form above (option b), or must every call that makes them be
excluded (option a, `--exclude-tree-subrequests`)? 255 of 543 recorded
`record_search` calls carry `subjectId` and make them. The manifest's
`tree_subrequests` field records which way a recording went.

## Re-recording

Needs a live FamilySearch login (the `login` tool) and reach to the wiki host.
Zero model calls.

    make replay-record OUT=<scratch dir outside the repo>       # check it first
    make replay-record OUT=eval/fixtures/replay                 # only after Q1

`RUNS=newest-per-fixture` (default) | `all` | `<run path,...>`; `BUILD=<dir>`
(default the working-tree build); `MERGE=1` adds to an existing OUT instead of
replacing it — how a candidate that changes a request is measured: record base
and candidate into one scratch dir in one session, then replay with that dir
listed first, `CASSETTES=<scratch>,eval/fixtures/replay`.

A recording replaces only `cassettes/` and `manifest.json`; this README stays.
`make replay-sizes` exits 3 with "cassettes stale: re-record" when the base
build asks for requests the cassettes do not hold beyond a margin.
