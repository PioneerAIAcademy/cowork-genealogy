# Wiki Page Tools — Implementation Spec

Covers the migration of `wiki_read` and `wiki_place_page` off direct
local-disk reads onto the hosted `wiki-query-api` server, and the new
`GET /page/{title}` endpoint that backs them. The retrieval pipeline
for `wiki_search` (POST `/search`) is unchanged — these two tools now
just call a sibling endpoint on the same server.

For the broader split between server (`wiki-query-api`, a sibling repo)
and MCP server (this repo), see `docs/specs/wiki-search-tool-spec.md`.

---

## Motivation

`wiki_read` and `wiki_place_page` currently read pre-crawled markdown
files off the developer's local filesystem via `getWikiMarkdownDir()` +
`readFile()`. That makes every developer carry a multi-gigabyte
markdown corpus, keeps them in sync by hand, and rules out running the
tools inside the Cowork VM (no path to local laptop disk). The fix is
to ask the same `wiki-query-api` server that already powers
`wiki_search` for the page content. One server, one canonical corpus.

---

## New wiki-query-api endpoint

**`GET {WIKI_API_URL}/page/{title}`**

- `title` is the wiki page slug — the part of a FamilySearch wiki URL
  after `/wiki/`, e.g. `Portugal_Genealogy`,
  `Manitoba,_Canada_Genealogy`, `Minnesota,_United_States_Genealogy`.
- Commas are valid in URL path segments (RFC 3986 sub-delims); no
  encoding is required. Spaces don't appear in real slugs (they're
  rendered as underscores in FamilySearch wiki URLs).
- The server reads from the same pre-crawled corpus the `/search`
  index is built from; no live fetch of familysearch.org.
- No auth, no pagination, no batching — one page per call.

### Responses

| Status | Body | When |
|---|---|---|
| `200 OK` | `{ "title": "<slug>", "content": "<markdown>", "source_url": "https://www.familysearch.org/en/wiki/<title>" }` | Page exists in the corpus |
| `404 Not Found` | `{ "detail": "No wiki page found for title '<slug>'" }` | Slug not in the corpus |
| `5xx` | server-defined | Upstream error |

### Example

```
GET /wiki/page/Portugal_Genealogy
```

```json
{
  "title": "Portugal_Genealogy",
  "content": "# Portugal Genealogy\n\nPortugal records research...",
  "source_url": "https://www.familysearch.org/en/wiki/Portugal_Genealogy"
}
```

---

## MCP-side tools

Two TypeScript tools call the new endpoint. Both follow the same call
pattern as `wiki-search.ts`: read the base URL via `getWikiApiUrl()`,
`fetch(`{base}/page/{title}`)`, handle 200/404/5xx/network. No
`fs/promises`, no `getWikiMarkdownDir`.

### `wiki_read` (`src/tools/wiki-read.ts`)

Input: `{ url: string }` (the full FamilySearch wiki URL).

Behavior:
1. Parse the slug out of the URL (`urlToSlug`, unchanged).
2. `GET {WIKI_API_URL}/page/{slug}`.
3. On 200 → return the server's `{ title, content, source_url }` body
   directly (or remapped to the existing `WikiPageResult` shape
   `{ url, content }` for backwards compat with the existing
   `WikiPageResult` interface).
4. On 404 → throw `No wiki page found for "<slug>". The page may not
   exist in the corpus.` (matches today's wording).
5. On 5xx → `wiki-query-api error: {status}`.
6. On network failure → `Could not reach wiki-query-api at {base}. Is
   the server running?`.

### `wiki_place_page` (`src/tools/wiki-place-page.ts`)

Input + behavior unchanged from the caller's perspective; only the
internal `tryNames`/`tryReadFile` is rewritten:

1. For each candidate slug (from the section + name-variant
   enumeration that already exists), `GET /page/{slug}`.
2. **404 is "try the next candidate"**, not a hard error — exactly
   what the file-not-found case does today.
3. First 200 wins, return its content.
4. If all candidates miss (404 on every one, after both the leaf-name
   pass and the places-API alternate-names pass), throw the existing
   `No wiki page found for "<standardPlace>".` error.
5. Network failure or 5xx bubbles up immediately (same as
   `wiki-search`); a transient server error must not be treated as
   "page not found."

The candidate-slug enumeration (`candidateSlugsFor`), the
place-resolver fallback to `getPlaceCandidateNames`, and the
`WikiPlacePageResult` shape are all unchanged.

---

## Error handling — match `wiki_search`

| Condition | Behavior |
|---|---|
| Missing `wikiApiUrl` | Bubble up the LLM-instruction error from `getWikiApiUrl()` |
| 5xx from API | Throw: `wiki-query-api error: {status}` |
| Network failure | Throw: `Could not reach wiki-query-api at {url}. Is the server running?` |
| 404 (`wiki_read`) | Throw: `No wiki page found for "<slug>". The page may not exist in the corpus.` |
| 404 on every candidate (`wiki_place_page`) | Throw: `No wiki page found for "<standardPlace>".` |

---

## Config + cleanup

- `wikiApiUrl` (per-user) — already used by `wiki_search`; reused
  unchanged.
- `wikiMarkdownDir` (per-user) — **removed**. No tool reads disk after
  this migration. Drop `getWikiMarkdownDir`,
  `WIKI_MARKDOWN_DIR_MISSING_MESSAGE`, and the `wikiMarkdownDir` field
  on `AppConfig` (`src/types/auth.ts`). Update the per-user config
  table in `CLAUDE.md` to drop the row.

---

## Tests

### Vitest (`packages/engine/mcp-server/tests/tools/`)

- `wiki-read.test.ts` — replace the existing `fs/promises` mocks with
  `fetch` mocks. Mirror the structure of `wiki-search.test.ts`: happy
  path, missing config, 404, 5xx, network failure.
- `wiki-place-page.test.ts` — same swap. Add a multi-candidate
  scenario that 404s the first slug and 200s the second (proves the
  "try next candidate on 404" branch).

### Skill unit tests (`eval/tests/unit/<skill>/`)

Three skills call these tools: `locality-guide`, `research-plan`,
`historical-context`. The harness mocks the MCP-tool call itself (not
the HTTP layer underneath), so existing `eval/fixtures/mcp/wiki-read-*.json`
and `eval/fixtures/mcp/wiki-place-page-*.json` fixtures continue to
match unchanged.

Add new tests covering the explicit "skill calls `wiki_read` / `wiki_place_page`
and uses the returned page content" path. Detailed coverage in each
skill's test directory; see the test cases shipped with this change.

---

## Operational notes

- The wiki-query-api server's Swagger docs page (`/wiki/docs`)
  currently 404s on `/openapi.json` because the FastAPI app isn't
  configured with `root_path="/wiki"` to match its reverse-proxy
  mount. Fix in the same wiki-query-api PR that adds `/page` —
  set `app = FastAPI(root_path="/wiki", ...)`.
- The endpoint contract is intentionally minimal (no auth, no
  versioning header). When the server gains auth, it lands the same
  way `wiki_search`'s auth lands — by passing a header via the same
  `getWikiApiUrl`-driven config; no schema change here.
