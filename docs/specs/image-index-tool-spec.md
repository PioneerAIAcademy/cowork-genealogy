# `image_index` tool spec

**Status:** built; the live measurements under "Still to measure" are owed before the order and
cap findings below are final. Read-only, needs a FamilySearch session (`OAuth` in
`docs/catalog.md`).
Built for re-indexing a page against FamilySearch's index: comparing a fresh transcription of a
page with what FamilySearch already indexed on it, line by line.

## Overview

Lists the records FamilySearch has indexed on ONE page image, with the persona arks and names on
each record. A researcher's "what has FamilySearch already indexed on this page" needs exactly
this, and nothing else answers it: `record_search` filters by `imageGroupNumber`, which is the
whole volume; `image_search` lists a volume's image ids, not the records on them; `record_read`
reads one persona's record at a time and refuses a `1:2:` record ark.

Two FamilySearch calls do the work: one list call for the image, then one read per listed record,
because the list carries record ids and no names.

## Why a separate tool

Decided by Richard on 2026-11-17 (option A of the tool's issue): a new tool, not a mode on
`record_search`, `image_search` or `record_read`. Each candidate's existing contract has a
different upstream and a different answer shape:

- `record_search` is a ranked search over one search service, answering persona hits;
- `image_search` lists a volume's image ids from the image-group service;
- `record_read` reads one persona's record from the recapi persona service.

An image's record list fits none of them. As a mode it would add a set of parameters that are
mutually exclusive with every existing one on that tool, and on `record_read` it would leak into
the internal callers that read one persona (`extraction_append`, the sidecar path). The rule in
CLAUDE.md ("generic tools with parameters, not one tool per endpoint") is about providers; this is
a different question asked of FamilySearch, with its own answer shape.

## Input

| Field | Type | Required | Meaning |
|---|---|---|---|
| `imageId` | string | yes | The page's document-image ARK, in any form: `ark:/61903/3:1:33SQ-GYY1-B2G`, bare `3:1:33SQ-GYY1-B2G`, the id alone in the 4-4-4-1 shape `image_read` also takes (`UNPREFIXED_IMAGE_ID_RE`), or a FamilySearch URL containing it (the image viewer's URL included). `3:2:` is accepted by the shared check (`isDocumentImageArk`), but only `3:1:` has been measured against this route, and a 404 for a `3:2:` ARK says so. A viewer URL's `i=` (and `groupId=`) is not sent: the list is for the ARK itself (see "Still to measure"). |
| `collectionId` | string of digits | no | FamilySearch's collection id, sent as `cc`. When `imageId` is a URL carrying `cc=`, that value is used; when both are given and differ, or the URL carries two different `cc=`, the call is refused, because silently dropping one changes the answer. |
| `offset` | whole number, at least 0 | no | The position in FamilySearch's record list to start reading from. Default 0. Use the previous answer's `nextOffset`. |

Refused before any network call, each with what to pass instead: a missing or empty `imageId`; a
`1:1:` persona or `1:2:` record ark; a DGS image number (`005155907_00688`, the form `image_search`
returns); a film-viewer URL (`/search/film/...`), which carries no ark; anything else that is not a
document-image ark; a `collectionId` that is not digits; an `offset` that is `null`, a string,
negative or a fraction. An `offset` above 0 that is at or past the list's length is refused after
the list call, naming the length (an empty list included: an offset into it is a caller error).

## Output

```jsonc
{
  "imageArk": "ark:/61903/3:1:33SQ-GYY1-B2G",
  "collectionId": "1803958",         // only when one was sent
  "total": 27,                       // records FamilySearch lists for the image
  "offset": 0,
  "returned": 27,                    // entries.length
  "entries": [
    {
      "index": 0,                    // position in FamilySearch's list, NOT a line on the page
      "recordArk": "ark:/61903/1:2:1TVW-1PV",
      "hydrated": true,              // the record was read
      "personas": [
        {
          "personaArk": "ark:/61903/1:1:XHPP-F3V",
          "name": "Michael Barry",
          "principal": true,
          "role": "Principal",           // display.role, when FamilySearch sends one
          "relationshipToHead": "Head",  // PR_RELATIONSHIP_TO_HEAD, when indexed
          "sortKey": "...",              // FS_SORT_KEY, when indexed
          "lineNumber": "...",           // PR_EXT_LINE_NBR, when indexed
          "personNumber": "..."          // SOURCE_PERSON_NBR, when indexed
        }
      ]
    }
  ],
  // "nextOffset": 30,                // only when entries remain past this answer
  "ordered": false,                  // see "Order"
  "hydrationTimedOut": false,        // ran out of time before reading the whole window
  "rateLimited": false               // FamilySearch, or this server's limit, refused a read
  // "listTruncated": true           // only when the list answer carried a next-page link
}
```

- `name` is the first non-blank `nameForms[].fullText`, trying the preferred name first and then
  the others in order, else the person's `display.name`. A persona with none has no `name`.
- `personaArk` is the person's first `http://gedcomx.org/Persistent` identifier that is a `1:1:`
  persona ark (normalised with `toArk`), the form `record_read` takes; with none, no `personaArk`.
- `role` is the raw person's `display.role`, the field `record_search` already lifts
  (`record-search.ts`); absent when the record body does not carry it.
- `relationshipToHead`, `sortKey`, `lineNumber` and `personNumber` come from the shared
  `personaIndexFields` (`src/utils/record-index-fields.ts`), present only when the record carries
  those index fields. None is verified as the line order on the page (see "Order").
- An entry whose read failed has `hydrated: false`, an empty `personas` and an `error` naming why:
  `HTTP 403` (restricted), `HTTP 404`, a 5xx (with "retry it"), another `HTTP <status>`, `not a
  FamilySearch record link`, `unreadable record body` (the body arrived whole and is not the JSON
  expected), or the thrown message (a network error, or the read's own timeout, including a body
  that stalls past it or a connection reset mid-body). A timeout, a network error or a 5xx is worth retrying with `offset` set
  to that entry's `index`; a 403, a 404, another 4xx, a bad link or an unreadable body fails the
  same way again.
- A 401 or a 429 on a record read is not an entry: see "How much one call reads".

## FamilySearch routes (measured by hand with `curl` from malachi, the beta's host, 2026-11-17)

**The image viewer's own chain does not work from the beta's host.** `POST
https://www.familysearch.org/search/filmdatainfo/image-data` (found by
`dev/probe-image-index.ts`, 2026-11-04) returned 403, FamilySearch's JSON `"User not authorized to see this
image."`, not an Imperva page. That probe measured 200 from inside the church network and 403 from
outside, with or without a bearer. This tool does not use it.

**List:** `GET https://www.familysearch.org/platform/records/images/{3:1:id}/records?cc={collectionId}`,
the link that 403 body names (`imageMeta.links.records.href`).

- No bearer: 401, `"Failure in upstream call: FailureToGetImageRecords (upstream 401)"`.
- An ordinary user bearer, `Accept: application/x-gedcomx-v1+json` and `BROWSER_USER_AGENT`: 200,
  11,614 bytes, for the Peru page (`3:1:33SQ-GYY1-B2G`, `cc=1803958`).
- 27 `sourceDescriptions` of `resourceType` `http://gedcomx.org/Record`, the count the probe got
  in-network from the viewer's chain. Each is a `1:2:` record (`1TVW-1PV`, `1TVW-15X`, ...,
  `1TVW-15H`) with a `links.record.href` to `/platform/records/records/{id}`.
- No names: no `persons`, `names` or `fullText`.

The tool sends the `3:1:<id>` path segment unencoded (colons literal, as measured), which is safe
because the id has already been validated to letters, digits, `.` and `-`. It reads only the
`sourceDescriptions` whose `resourceType` is `http://gedcomx.org/Record`, in array order.

**Record:** each listed record is read through the list's own `links.record.href`, for example
`GET https://www.familysearch.org/platform/records/records/1TVW-1PV?flag=fsh&cc=1803958`, with the
same three headers: 200, 28,316 bytes, 0.41 s, carrying the persona `ark:/61903/1:1:XHPP-F3V` with
`fullText` "Michael Barry", the probe's in-network entry 0.

- **Not through `record_read`.** It refuses a `1:2:` ark (`extractEntityId`), and a bare
  `1TVW-1PV` is taken as a persona id and sent to the persona service.
- **The bearer is sent only to FamilySearch.** A `links.record.href` is resolved against
  `https://www.familysearch.org` and read only when it is `https:` on host `www.familysearch.org`
  with the path `/platform/records/records/<id>`. Anything else is not fetched: the entry carries
  `error: "not a FamilySearch record link"`. `recordArk` is `ark:/61903/1:2:<id>` from that path.

## Order

Entries keep the list's array order and `ordered` is `false`, a constant. The rule this tool
was built to: return the list's order as page order only if the list is shown to match the probe's
in-network order (Michael Barry entry 0, Mila Fuller entry 1, carried by the viewer chain's `SortKey`);
otherwise mark the entries unordered and never sort them, by record id or anything else.

Measured so far: the list's entry 0 is the page's first name (one data point, above). Whether the
rest follows page order is not measured (see "Still to measure"). One page could not vouch for
every image anyway, so a live result is recorded here and does not by itself make `ordered` true.

`sortKey`, `lineNumber` and `personNumber` are passed through as FamilySearch's own index fields
and are not verified as the line order. Note for whoever measures it: the 2026-11-17 grep behind
"No `SortKey`/`sortKey` field in the body" cannot match `FS_SORT_KEY` (case and underscore), the
label the raw GedcomX of every census household probed for `src/utils/record-index-fields.ts`
carries (its table: US 1880, US 1850 and England and Wales 1861). Whether the platform record body
carries it, or the line and person numbers, is part of the live check.

## How much one call reads (the cursor rule)

- **Cap: 30 records per call, read 6 at a time.** The rule:
  `CAP = min(30, 6 x floor(25 s / p95 read latency))`. Hydration must finish within half the
  50 s tool budget at the 95th-percentile read, and the record reads of one call never number
  more than 30. The one measured read, 0.41 s, gives 6 x 60 = 360, so the spend ceiling binds; 30
  covers the Peru page (27) in one call. The rule lowers the cap only if p95 passes 5 s.
- **What one call can spend:** at most 33 FamilySearch requests: the list call, which keeps
  `fetchWithRetry`'s retries of a 429, a 5xx or a network failure (at most 3 attempts, as
  `catalog_search`'s one search request does), and 30 record reads of one attempt each. Under the
  desktop login (`LOCAL`) only, `fsFetch` also repeats a request that got 401 once when
  `tokens.json` changed meanwhile: the list call's repeat is retried like the list call, and each
  record read in flight can be sent twice. The first record read's 401 stops the reading (below).
- **Deadline: 50 s for the whole call**, anchored when the tool starts, as `catalog_search` does,
  under the Cowork bridge's ~60 s abort. The list call's timeout is 24 s (its retries run inside
  `fetchWithRetry`'s 10 s retry budget), so that under the desktop login, where `fsFetch` repeats a
  request that got 401 once with the same timeout, the two together (48 s) still fit the budget. Each record read is one attempt with a timeout of
  at most 15 s, and never past 2 s before the deadline, so a stalled read ends as an entry with a
  timeout error inside the budget and the cursor moves past it. A read that would start with less
  than 2 s of that left (`MIN_REQUEST_AFTER_WAIT_MS`) makes no request at all.
- **The invariant.** Every record in the window ends as one of: an entry (its read finished before
  the deadline, with its personas or its error); unread, with `nextOffset` at or before it and the
  answer saying why; past the answer-size cut (read, but dropped to fit, with `nextOffset` at or
  before it and no flag: see the cursor rule); or the whole call throws the session's sign-in
  message. Nothing that lands at
  or after the deadline changes the answer: not an entry, not a flag, not a throw. A record is
  unread either for lack of time (its read never started, never got to start before the deadline,
  or landed late) or because reading stopped on a rate limit. `hydrationTimedOut` is true when any
  record in the window is unread for lack of time, including when the budget was already spent
  before hydration began; `rateLimited` when reading stopped on a rate limit. Both can be true.
- **Stops.** A 401 on a record read means the session was rejected: no further read starts and the
  call throws `rejectedTokenMessage(principal)`, as for the list call. A stop is raised when the
  status arrives, before its body is drained, and checked again just before each request (fsFetch's
  `beforeAttempt`, after any token read or connector pause wait), so a read that passed its own
  check before the stop still sends nothing. The same holds when the
  session itself refuses during a read (signed out, or a token refresh that failed, before the
  request or at `fsFetch`'s re-check after a 401): any thrown error that is not a fetch timeout or
  a marked refusal is checked with `getValidToken`, and its refusal is the call's answer, with its
  own message. A 429 on a record read, or a local refusal before any request (this server's
  FamilySearch budget, or a connector user's 429 pause; `isFsBudgetExhausted`), means FamilySearch
  is rate-limiting: no further read starts, the refused record stays unread, and the answer
  carries `rateLimited: true`.
- **Known gaps, desktop login only.** (1) `fsFetch`'s one repeat of a record read after a 401
  (when `tokens.json` changed meanwhile) runs with the read's full time again, so it can pass the
  2 s margin. The late rule then leaves that record unread for lack of time, and the next call
  reads it with the new token, so the cursor does not pin on it. (2) If that repeat's own token
  re-check throws once and the session check right after it passes (a `tokens.json` caught
  mid-write), the record ends as an entry whose error is the sign-in text rather than a throw: the
  session recovered, and the entry says what to do. (3) A token refresh that times out inside a
  read is reported as that read's timeout, which is retryable, as it should be. (4) Token reads sit
  outside every timeout above: `getValidToken` may refresh the token (its own request) before the
  list call, before `fsFetch`'s repeat after a 401, or before a record read, and that time is not
  counted against the 24 s or the 15 s, so a slow refresh can push the call past 50 s. Every tool
  that goes through `fsFetch` shares this; the hosted paths never refresh.
- **The cursor rule.** `entries` is always a contiguous prefix of the window
  `[offset, offset + 30)`, and `nextOffset = offset + entries.length` whenever that is below
  `total`. Four things shorten the prefix: the cap; the deadline and a rate-limit stop (the prefix
  stops at the first unfinished read, so `nextOffset` points at it and no name is skipped); and the
  answer size (trailing entries are dropped until the answer fits `TOOL_RESULT_CHAR_BUDGET`, 40,000
  characters, `src/constants.ts`; at least one entry is always kept, so one record over that size
  is still returned whole, which is outside every household measured: `record_read` keeps 40
  personas whole). A read that failed is finished: it stays in the prefix with its `error`.
- **A paged list.** Whether the list route pages is not measured. When its answer carries a GedcomX
  `links.next`, the answer says `listTruncated: true`: `total` then counts only that first part,
  and this tool does not follow the link.
- **A caller that hangs up** gets no special handling: no tool here takes an abort signal. The
  reads already started finish or meet the deadline, bounded by the cap and the 50 s; nothing is
  written anywhere.

## Error handling (the list call)

| FamilySearch answers | The tool throws |
|---|---|
| no session (`getValidToken` throws) | that message unchanged (desktop: call login; hosted: reconnect) |
| 401 | `rejectedTokenMessage(principal)`, as `record_read` does |
| 403 | the image's records are restricted: tell the user they cannot be listed |
| 404 | FamilySearch has no record list for the image: it may not be indexed or the id is wrong; if the viewer URL carries `cc=`, pass it as `collectionId`; for a `3:2:` ARK, that only `3:1:` has been measured |
| 429 | rate limited and not cleared within the retry budget: wait a minute and try again |
| other non-2xx | the status |
| 2xx whose body is not a JSON object | the list could not be read |
| a network failure or timeout | `fetchWithRetry`'s message |

A list with no record entries is an answer, not an error: `total: 0`, `entries: []`.

## Untrusted text

Names come from FamilySearch's index and are passed through as data. This repo has no
prompt-injection doctrine (`docs/architecture.md`, "Add an MCP tool"); nothing here adds one.

## Still to measure (live, needs a FamilySearch login)

Run from `packages/engine/mcp-server/`, signed in, on a network outside the church's:
`npx tsx dev/try-image-index.ts --record tests/fixtures/image-index`. It prints each item
below; paste the answers here with the date and the network.

- The list's order beyond entry 0: are entries 0 and 1 `1:1:XHPP-F3V` and `1:1:XHPP-FQX`?
- Whether the platform record body carries `FS_SORT_KEY`, `PR_RELATIONSHIP_TO_HEAD`,
  `PR_EXT_LINE_NBR`, `SOURCE_PERSON_NBR` and `display.role`, and whether the sort keys ascend in
  list order.
- Per-record latency over every read: min, median, p95, max, and the cap the rule gives.
- The list call's own latency: the 24 s list timeout rests on no list measurement (only its size,
  11,614 bytes, was recorded).
- The list call's status without `cc`, and with the viewer URL's `i=6` added (the Peru page's
  viewer URL carries it): whether the route takes `i=`, and whether it changes the answer.
- Whether the list answer carries any `links` (a `next` would mean the route pages).
- Whether the route answers from that network at all (record the result either way).

The test fixtures `tests/fixtures/image-index/peru-list.json` and `peru-records.json` are built
from the measurements above, not recorded (their `_note` says so). `--record` overwrites both
with the raw bodies, and the unit test then runs on the recording.

## Files

- `packages/engine/mcp-server/src/tools/image-index.ts`: schema and `imageIndexTool`.
- `packages/engine/mcp-server/src/types/image-index.ts`: input and answer types.
- Registered in `src/tool-schemas.ts` (`allToolSchemas`, `READ_ONLY`), `src/server.ts` (dispatch),
  `manifest.json` (`tools`), `dev/smoke-calls.ts` (a `tokenStep` row) and
  `apps/server/proto/worker/options.py` (`FS_TOOLS`, the worker's reauth alarm).
- `packages/engine/mcp-server/dev/try-image-index.ts`: the live one-shot above.
- `packages/engine/mcp-server/tests/tools/image-index.test.ts`.

## Verification

- `make engine-test` (`tests/tools/image-index.test.ts`, plus the packaging drift tests over the
  registration sites).
- `make engine-smoke-http`: in its default no-bearer mode the row must answer the hosted reconnect
  instruction, which proves the request's principal reached the tool.
- The live check above, then the lead's call from malachi after deploy: the Peru page returns 27
  entries including `1:1:XHPP-F3V` and `1:1:XHPP-FQX`.
