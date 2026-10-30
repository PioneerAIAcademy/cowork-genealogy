# Matcher shim — one matching call, two backends

Every score `same_person` and ranking compute (`rank_search_matches`, and
`record_search` when it ranks) goes through one call, `matchPairs`
(`packages/engine/mcp-server/src/utils/matcher.ts`). Two backends answer it:

- **FamilySearch's matcher**, the default: `matchTwoExamples` through `scorePair`
  (`src/utils/match-engine.ts`), sent exactly what each call site sent it before
  the shim.
- **The matcher service**: matcher-lab's `matcher` package run as an HTTP
  service, `POST {matcherUrl}/v1/score`.

## The call

```ts
matchPairs(pairs: MatchPair[], principal: Principal, fs: FamilySearchOptions): Promise<MatchCall>
```

- A pair is `tree_record` (`tree`, `pid`, `rec`, `personaId`, and
  `familysearchTree`, the document FamilySearch is sent for the tree side) or
  `record_record` (`rec`, `personaId`, `rec2`, `personaId2`). Types:
  `src/types/matcher.ts`.
- `tree` is the whole tree after the call site's own transforms. The service is
  sent it cut around `pid` with `Mob.matchSubset()`; `familysearchTree` is never
  sent to it.
- `fs` is FamilySearch's fan-out for that call site: its concurrency, and
  whether a failed pair is retried.
- The answer is `{ scorer, model, floors, results }`: the backend, the service's
  model version (`null` for FamilySearch), the backend's two floors, and one
  `{ score, error?, familysearch? }` per pair in the order sent. `score` is
  `null` when that pair could not be scored, and `error` says why.

## Choosing the backend

Three per-user keys in `~/.familysearch-mcp/config.json`, read by
`getMatcherSettings(principal)` (`src/auth/config.ts`). No environment fallback.

| Key | Value |
|---|---|
| `matcher` | `"familysearch"`, the default when absent, or `"service"` |
| `matcherUrl` | the service's base URL; required with `"service"`; trailing slash stripped |
| `matcherApiKey` | this caller's bearer key; required with `"service"` |

Any other `matcher` value throws, naming the two allowed values; `"service"`
without a URL or key throws, naming the missing key. Each message ends "Do not
ask the user to paste a key into the chat." and none echoes the key.

Who fills the keys:

| Runtime | How |
|---|---|
| Desktop `.mcpb` | the developer edits `config.json` |
| Hosted alpha (Fly + E2B) | `hosted_config()` (`apps/server/app/fs_oauth.py`) writes them into each sandbox on create and every connect, from `MATCHER_URL` and `MATCHER_API_KEY`: `"service"` with the URL and key when both are set, else `"familysearch"`. It always writes `matcher`, so unsetting the service switches a sandbox back. |
| Beta tool server (`http.ts`) | `configFromEnv` (`src/hosted-config-env.ts`) layers `MATCHER_URL` and `MATCHER_API_KEY` over its config; both set means the service, one alone nothing |
| Eval harnesses | nothing, so FamilySearch's matcher |

## What each call site sends

| Call site | FamilySearch's matcher | The matcher service |
|---|---|---|
| Ranking | `scorePair(record, primaryId, enriched subject alone, subjectId)`, 10 at a time, retried | `tree_record`: the project tree with the enriched subject in place of the tree person, cut around the subject; the whole page in one POST |
| Project arm | `scorePair(record, persona, subject's family cut without the record's own facts, treePersonId)`, once | `tree_record`: the whole tree without the record's own facts, cut around `treePersonId` (the same document) |
| Project relatives | `scorePair(record, relative, subject's family cut, tree relative)`, 5 at a time, retried | `tree_record` per pair: the whole tree without the record's own facts, cut around each tree relative |
| Explicit arm | `scorePair(gedcomx1, primaryId1, gedcomx2, primaryId2)`, once | `record_record` |
| Explicit relatives | `scorePair(gedcomx1, relative, gedcomx2, relative)`, 5 at a time, retried | `record_record` per pair |

Relatives mode makes no call when nothing pairs.

## FamilySearch's backend

Unchanged from before the shim: the same documents, anchoring, id mint,
concurrency, retries and errors (`same-person-tool-spec.md`). A pair that fails
keeps the error `scorePair` threw, so the single-pair arms rethrow exactly it.
Its floors are 0.01 and 0.01.

## The service backend

- **Request.** `POST {matcherUrl}/v1/score`, `Authorization: Bearer <matcherApiKey>`,
  JSON `{"pairs": [...]}`, each pair's `id` its index in the call. No `jev` field:
  whether the service holds a Jev key decides. A page goes in one POST (at most
  100 pairs, `record_search`'s cap); a call with no pairs still posts, so ranking
  gets the floors.
- **Timeout.** `fetchWithRetry` with a 15 s timeout and a 15 s budget: the
  service's 10 s page deadline, Jev's 1.5 s and the transfer, and room for a
  retry after an immediate 503 `busy` or `not_ready`.
- **Checks.** `model.version` a string; `model.cutoffs.floors.thin_subject` and
  `.real_negative` each in [0, 1]; `results` echoing the ids sent, in order;
  each result a `score` in [0, 1] or an `error.code`. Any check that fails fails
  the call.
- **Pair errors** (`pid_not_in_tree`, `persona_not_in_record`, `bad_document`,
  `deadline`, `internal`) give that pair a null score and an error naming the
  code and what to do. A `tree_record` pair whose `pid` is not in its tree is not
  sent and gets `pid_not_in_tree`.
- **Call failures.** A call that scores no pair throws one error: a non-200
  after the retries (named by status and the service's code), a transport
  failure or timeout ("Could not reach the matcher service"), an unreadable
  answer, or a non-empty page on which every pair failed. A one-pair call throws
  that pair's own error; a larger one names each distinct code.
- **401.** On the desktop the message says to set `matcherApiKey` to this
  caller's key or `matcher` to `"familysearch"`; hosted (`isHostedMode`) it says
  scoring is unavailable until an operator fixes the key, to tell the user and not
  retry.

## Floors, and a page with unscored candidates

Ranking applies the active backend's floors (`rank-search-matches-tool-spec.md`,
**Floors**): FamilySearch's 0.01 and 0.01, the service's from each response. A
page with a candidate that failed to score claims no negative under either
backend: `subjectResolvable` stays unset, so `record_search`'s surname and
jurisdiction hints stay off; diagnostic (b) gives way to a count of the unscored
candidates; a thin subject's ranking is still withheld. A failed service call
reaches `record_search` as `rankingError`, the search intact.

## No fallback

Neither backend falls back to the other. A service failure is an error, never a
FamilySearch re-score: each backend's floors judge only its own scores.

## What is stored

The `same_person` attestation (`results/.scores/`) and each line of
`results/match-scores.jsonl` carry `scorer` (`familysearch` or `service`) and
`model` (the service's version, `null` for FamilySearch). Neither carries
`matched` or `confidence`.

## What the shim removed

`matched` and `confidence` from `same_person`'s results, relatives triples and
the attestation; `matchConfidence` from ranking stubs and `record_search` rows;
`match_confidence` from the score log; the review list's "low match score"
label; and ranking's single `DEGENERATE_FLOOR`.

## The key's redaction

A matcher key is 64 hex characters, so it is found by its JSON field. The e2e
capture redactor and its CI scanner (`MATCHER-KEY`,
`eval/harness/harness/redact.py`, `eval/harness/scripts/check_e2e_fixtures.py`),
and the alpha's, the beta's and the desktop's feedback redactors drop the value of
`matcherApiKey` and keep the field name.

## Where each property is tested

| Property | Test |
|---|---|
| FamilySearch is sent what it was sent before the shim, and the outputs differ only in the removed and added fields | `tests/tools/matcher-familysearch-parity.test.ts`, against a golden generated on the shim's merge base |
| The service request, cut, timeout, checks, pair errors, call failures, 401s, no fallback | `tests/utils/matcher.test.ts` |
| The keys and their errors | `tests/auth/config.test.ts` |
| Ranking's call, floors and unscored-candidate rule | `tests/tools/rank-search-matches.test.ts`, `tests/tools/record-search.test.ts` |
| `same_person`'s documents, answers and attestation under the service | `tests/tools/same-person.test.ts` |
| Who fills the keys | `apps/server/tests/test_hosted_config.py`, `tests/auth/hosted-config-env.test.ts`, `apps/server/tests/test_proto_config.py` |
| The redactors | `eval/harness/tests/unit/test_redact.py`, `apps/server/tests/test_feedback.py`, `apps/server/tests/test_proto_feedback.py`, `apps/electron/src/main/__tests__/feedback.test.ts` |
| The live service contract | nothing in CI; `dev/try-matcher-service.ts` against a running service |
