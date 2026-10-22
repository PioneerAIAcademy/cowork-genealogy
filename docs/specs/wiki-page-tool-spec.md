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
- No auth, no pagination, no batching — one page per call. (The tools below page
  what they return; see **Pagination**.)

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

Input: `{ url: string, offset?: number }` (the full FamilySearch wiki URL; `offset` is
described under **Pagination**).

Behavior:
1. Parse the slug out of the URL (`urlToSlug`, unchanged).
2. `GET {WIKI_API_URL}/page/{slug}`.
3. On 200 → return the existing `WikiPageResult` shape `{ url, content }`: the
   server's `{ title, content, source_url }` remapped, with `content` cut to one
   part when the page is longer than the cap (see **Pagination**).
4. On 404 → throw `No wiki page found for "<slug>". The page may not
   exist in the corpus.` (matches today's wording).
5. On 5xx → `wiki-query-api error: {status}`.
6. On network failure → `Could not reach wiki-query-api at {base}
   ({cause}).`

### `wiki_place_page` (`src/tools/wiki-place-page.ts`)

Input: `standardPlace`, `section` and an optional `offset` (see **Pagination**). A
missing or out-of-set `section`, or a bad `offset`, is rejected before any
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

The `WikiPlacePageResult` members are unchanged; `placeName` is the name that
resolved — the leaf or alternate name for a country or state, the title's
jurisdiction (`Schuylkill County, Pennsylvania`) for a page resolved by title.
The place is resolved first and the page cut afterwards, so every way of resolving
one is paged the same way; a truncated answer, or a call that passes `offset`, adds
the paging members described under **Pagination**.

---

## Pagination

A few pages are longer than one tool answer can be. Claude Code saves any tool result over
50,000 characters to a file and hands the agent a preview. `locality-guide` has `Read` but no
`Bash`, and `Read` refuses a file over 25,000 tokens, so what lies past the preview is lost to
the research. Measured 2026-10-22, straight from `GET /page/<title>` (lengths in UTF-16 code
units, the unit `content.length` and `offset` use; `#` lines are lines that start with `#`):

| page | characters | JSON-escaped body | `#` lines | longest line |
|---|--:|--:|--:|--:|
| `Schuylkill_County,_Pennsylvania_Genealogy` | 66,317 | 67,042 | 51 | 3,439 |
| `Pennsylvania_Church_Records` | 64,649 | 65,685 | 43 | 7,052 |
| `Ireland_Online_Genealogy_Records` | 53,075 | 53,255 | 1 | 46,407 |

A page edited on the wiki moves these. Re-fetch a page rather than trusting a figure that
looks stale.

**The input is `offset`**, optional on both tools: a whole number ≥ 0, a UTF-16 code-unit
offset, with the same name, unit and validation as `sidecar_read`'s. (`research_query`'s
`offset` shares the name and the refusal of a non-number, but counts matches, not characters.) A
string, a negative number, a fraction, `NaN` or `null` is refused by `requireWholeNumber`
before any request. It is not called `section`: `wiki_place_page` already takes a required
`section`, which says which page, not which part of it. Both tools take it because an agent
may hold `wiki_place_page` without `wiki_read` (`gps-mentor` does), and "continue with
`wiki_read`" would strand it. As in `sidecar_read` (`sidecar-read-tool-spec.md` §4), the tool does
not adjust the start of a part: an `offset` a caller invents that lands on the low half of a
surrogate pair returns that stray unit as the first character, and a caller that only passes back
`nextOffset` never does.

**The cap.** One part holds at most 40,000 characters (`WIKI_PAGE_MAX_CHARS`), measured as
`sidecar_read` measures its pages: on the JSON-escaped body of `content`,
`JSON.stringify(content).length - 2`, because the server serializes a result and escapes every
quote, backslash and line break. `fitPage` (`src/utils/text-page.ts`, shared with
`sidecar_read`) takes the first characters that fit, shrinks them until the escaped body is
within the cap, and never splits a surrogate pair; the reasoning for the escape bound is
`sidecar-read-tool-spec.md` §4 and holds here unchanged. The URL, the place and the paging
members add a few hundred characters around `content`, so a whole result stays near 41,000, under
the 50,000 line. A page whose escaped body lies between the cap and that line, such as
`England_Church_Records` (43,246 characters escaped, measured 2026-10-22), came back whole before
paging and now comes back in two parts. The cap stays at 40,000 anyway: it is the bound `sidecar_read`
already holds, and it leaves the margin under the line that the members around `content` need.

**Where the cut falls.** `fitPage`'s cut is then moved back to a boundary a reader can use
(`cutAtBoundary`):

1. to the start of the last line that starts with `#`, if that line starts past the part's
   midpoint. A part that already ends where a heading line starts is left as it is: moving
   it back to an earlier heading would shorten the part for nothing;
2. otherwise to just after the last `\n` past the midpoint;
3. otherwise it stays where `fitPage` cut it.

The last part of a page is never cut back. Neither rule alone is enough: `Ireland_Online_Genealogy_Records`
has one heading and one 46,407-character line (a table row), so for it there is no heading and no line
break past the midpoint, and the part ends in the middle of the row. A cut only ever moves toward the
start of the part, so a part never grows past the cap, is never empty (the cut is past the midpoint), and
never ends inside a surrogate pair (it falls beside a `\n` or a `#`).

**A page that fits returns exactly what it always did.** `wiki_read` returns `{ url, content }` and
`wiki_place_page` `{ url, content, standardPlace, placeName }`: no `truncated: false`, no `totalChars`.
Only a truncated answer, or any call that passes `offset`, adds `totalChars` (the length of the whole
page), `offset` (where this part starts) and `truncated`, and, when `truncated`, `nextOffset` (`offset`
plus `content.length`). They are optional members of `WikiPageResult`, so the fixtures under
`eval/fixtures/mcp/` stay valid. An `offset` at or past the end returns an empty part with
`truncated: false`.

**How a caller continues.** It passes `nextOffset` back as `offset` until `truncated` is false. That
instruction is in both tool descriptions (`WIKI_PAGING_NOTE`): an agent body is not edited for it. Each
call fetches the page from the wiki server again. A `wiki_place_page` call from the start resolves the place
again too; a continuation does not (next paragraph).

**A continuation reuses the page the first call resolved.** Resolving a sub-state place costs a search
(`POST /search`), Places API lookups and then the page `GET`. A Places lookup of the place's type that fails
reads as an unknown type, which rejects every typed title, and a failed lookup of its names throws. Repeated
on every part, a Places failure on part 2 would fail a read that part 1 began, as `No wiki page found` or as
the Places error. So `wiki_place_page` remembers what each resolution found, the slug and the `placeName`,
in a map shared by the process and keyed by the wiki server URL, the section and the `standardPlace`. A call
with `offset` above 0 that finds its entry fetches that slug directly: one `GET`, no search, no Places call.
A call from the start (no `offset`, or 0) always resolves in full, as before paging, and replaces the entry.
If the remembered page now answers 404, the entry is dropped and the call resolves in full; a network
failure or a 5xx on that `GET` is thrown as it always is, and the entry stays. A continuation with no entry
resolves in full. Wiki pages are public and the key carries the per-user server URL, so the map holds
nothing user-scoped; it has no TTL, like the caches in `place-resolver.ts`.

**What nothing checks.** Whether an agent follows `nextOffset` to the end. That depends on the model
reading the tool description. The tests prove the parts join back to the page and that each stays under
the line; they cannot prove an agent reads them all.

---

## Error handling — match `wiki_search`

| Condition | Behavior |
|---|---|
| Missing `wikiApiUrl` | Bubble up the LLM-instruction error from `getWikiApiUrl(principal)` |
| 5xx from API | Throw: `wiki-query-api error: {status}` |
| Network failure | Throw: `Could not reach wiki-query-api at {url} ({cause}).` — `{cause}` is `describeFetchError`'s walk of the error's `.cause` chain (`src/utils/http.ts`), so the socket code (ETIMEDOUT, ENOTFOUND, …) is named rather than a bare "fetch failed" |
| 404 (`wiki_read`) | Throw: `No wiki page found for "<slug>". The page may not exist in the corpus.` |
| 404 on every candidate (`wiki_place_page`) | Throw: `No wiki page found for "<standardPlace>".` |
| `offset` not a whole number ≥ 0 (either tool) | Throw, before any network call: `offset must be a whole number ≥ 0 (got <value>). Send it as a number, not a string.` — `requireWholeNumber`, the same check and message as `sidecar_read` |
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
- Paging, in both files, over three generated pages (about 50 headings over 66,000
  characters; one heading and one 46,000-character row; 66,000 double quotes): every
  part serializes under 50,000 characters; the parts joined across the `nextOffset` chain
  equal the page exactly; the chain ends with `truncated: false` and no `nextOffset`; a
  9,000-character page returns exactly today's object with no extra key; `offset` of
  `"5"`, `-1` and `1.5` is refused before any request. For `wiki_place_page` the same over
  a title-resolved page and an alternate-name page, and over the continuation: a title-resolved
  page read in parts makes no search and no Places call after the first part and still joins;
  the next part comes back when the Places lookup fails by then; a continuation with no entry,
  after a 404 on the remembered page, or from the start resolves in full; another section, place
  or wiki server URL does not take an entry.
- `tests/utils/text-page.test.ts` — the cut rules and their edges (a heading exactly at
  the midpoint is not past it; a part that already ends at a heading is kept), the cap
  taken from `maxChars` and not a constant, progress for a `maxChars` under 6, the cut checked
  against the rule written as two backward scans over every short text of `#`, line breaks, `a`
  and a surrogate pair, and a seeded property test: any text, offset and cap walks to the end
  and joins back.

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

## Live check

```
cd packages/engine/mcp-server
npx tsx dev/check-wiki-paging.ts          # the three long pages through wiki_read, two of them through wiki_place_page
npx tsx dev/check-wiki-paging.ts --wire   # the same through the built server over stdio (npm run build first)
```

Each case fetches the page whole from the wiki server, follows `nextOffset`, joins the parts and
compares. It exits non-zero on a mismatch, on a part at or over the CLI line, or on a chain that does
not end. Measured 2026-10-22: `Schuylkill_County,_Pennsylvania_Genealogy` came back in 2 parts
(37,690 and 28,627 characters, cut at a heading), `Pennsylvania_Church_Records` in 2 (38,388 and
26,261, at a heading) and `Ireland_Online_Genealogy_Records` in 2 (39,957 and 13,118, mid-row), each
joining back to the page exactly, through both tools where a section reaches the page and over stdio.

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
