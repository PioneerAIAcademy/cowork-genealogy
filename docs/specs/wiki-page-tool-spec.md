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
pattern as `wiki-search.ts`: read the base URL via `getWikiApiUrl(principal)`,
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
6. On network failure → `Could not reach wiki-query-api at {base}
   ({cause}).`

### `wiki_place_page` (`src/tools/wiki-place-page.ts`)

Input unchanged. A missing or out-of-set `section` is rejected before any
network call (error table below).

Resolution depends on the place's level. A `standardPlace` with one or two
comma-separated parts is a country or a state/province; three or more is
anything below that.

1. **Country or state/province — the leaf-name grammar** (`candidateSlugsFor`).
   For each candidate slug, `GET /page/{slug}`; a 404 is "try the next
   candidate", the first 200 wins. `home` tries `{leaf}_Genealogy`,
   `{leaf},_Canada_Genealogy` and `{leaf},_United_States_Genealogy`; the other
   three sections try `{leaf}_Getting_Started`, `{leaf}_Online_Genealogy_Records`
   and `{leaf}_Research_Tips_and_Strategies`. When every leaf slug misses, the
   places-API alternate names (`getPlaceCandidateNames`) are tried through the
   same grammar — for `home`, only after step 2 misses.
2. **`home` for anything but a bare country, once the leaf grammar misses — the
   page's real title.** A two-part place outside the US and Canada (`Malmöhus,
   Sweden`, `Jalisco, Mexico`) reaches its page only this way. The wiki names a
   sub-state page with its parent and usually a type word
   (`Schuylkill_County,_Pennsylvania_Genealogy`), which no grammar built from the
   leaf can produce, so the title comes from the wiki's own ranking:
   `POST /search` with `"{leaf} {parent} genealogy"`, then the first ranked
   `page_title` that `homeTitleShape` (`src/utils/wiki-home-title.ts`) accepts is
   fetched by `GET /page/{title}`. A title is accepted only when it is a home
   page (`... Genealogy`), starts with the leaf at a word boundary, and names the
   place's direct parent as its first container (a type word may follow it, as
   in `Ulster County`), so `Los Angeles, Los Angeles County, California
   Genealogy`, the city's page, is not taken for Los Angeles County, and
   `Washington, United States Genealogy`, the state's page, is not taken for a
   Washington County. A type word after the leaf
   must fit the Places API `type` (`typeWordFits`): `St. Louis City` and
   `St. Louis County` rank together for "St. Louis, Missouri", and only the type
   (`Independent City`) separates them. `County` also admits the wiki's `Parish`
   (Louisiana) and `Borough`. An unresolved or failed type lookup rejects every
   typed title, so it can cost a page but never return the wrong jurisdiction's.
   When no ranked title matches the leaf, the same titles are matched against
   the place's names in **every** language (`getPlaceCandidateNames(…, {
   anyLanguage: true })`): the wiki titles some provinces by their local name
   (`South Holland, Netherlands` → `Zuid-Holland, Netherlands Genealogy`; the
   sibling `Noord-Holland` never matches). A parenthetical that is one of those
   names is a name, not a type word (`Bavaria (Bayern), Germany Genealogy`);
   one that is not must still fit the type (`Baltimore (Independent City)`).
   The parent check admits one alias: a place under Northern Ireland matches a
   title under `Ireland`, because the wiki titles all six counties under
   pre-1922 Ireland (`County Antrim, Ireland Genealogy`; every
   `County X, Northern Ireland Genealogy` 404s, measured 2026-10-19).
3. **Below state level, the other three sections return no page at once.** They
   exist only for a country or a state/province (measured 2026-10-01: every
   county-level section page 404s while the state's 200s), and the leaf grammar
   applied to a county can only 404 or hit a same-named larger place with a 200.
   The caller broadens one jurisdiction level and calls again.
4. If nothing resolves, throw the existing `No wiki page found for
   "<standardPlace>".` error.
5. A network failure or 5xx from either `/page` or `/search` bubbles up
   immediately (same as `wiki-search`); a transient server error must not be
   treated as "page not found."

**Diacritics are preserved, never folded.** `Västra_Karaby_Parish,_Malmöhus,_Sweden_Genealogy`
returns 200 and the ASCII-folded spelling returns 404, so folding is a measured
failure, not a fallback. Ranked titles arrive percent-encoded for non-ASCII names
and are decoded before the slug is built.

The `WikiPlacePageResult` shape is unchanged; `placeName` is the name that
resolved — the leaf or alternate name for a country or state, the title's
jurisdiction (`Schuylkill County, Pennsylvania`) for a page resolved by title.

---

## Error handling — match `wiki_search`

| Condition | Behavior |
|---|---|
| Missing `wikiApiUrl` | Bubble up the LLM-instruction error from `getWikiApiUrl(principal)` |
| 5xx from API | Throw: `wiki-query-api error: {status}` |
| Network failure | Throw: `Could not reach wiki-query-api at {url} ({cause}).` — `{cause}` is `describeFetchError`'s walk of the error's `.cause` chain (`src/utils/http.ts`), so the socket code (ETIMEDOUT, ENOTFOUND, …) is named rather than a bare "fetch failed" |
| 404 (`wiki_read`) | Throw: `No wiki page found for "<slug>". The page may not exist in the corpus.` |
| 404 on every candidate (`wiki_place_page`) | Throw: `No wiki page found for "<standardPlace>".` |
| Missing or out-of-set `section` (`wiki_place_page`) | Throw, before any network call: `section is required and must be one of 'home', 'getting_started', 'online_records', 'research_tips'.` — the values come from `VALIDATOR_ENUMS.locality_page_section`, the same set the input schema advertises and `validate_research_schema` enforces on `pages_read[].section` |

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
