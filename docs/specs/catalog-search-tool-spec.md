# `catalog_search` tool spec

## Overview

Searches the **FamilySearch Catalog** — microfilm, books, manuscripts and
finding aids, described by place, title, author, subject, call number and film
number — and hydrates its top hits with the item detail that answers the
question the Catalog is reached for: *where are the originals held, and can I
see them.*

This is a different index from `collections_search`, which covers the
**indexed record collections**. A parish register that was filmed but never
indexed is invisible to `collections_search` and present here. That gap is why
shipped skill docs name the Catalog as a manual step: without this tool the
agent is told to use a capability it does not have, and in one alpha-feedback
case it filled the hole with a guess — asserting that a Slovenian village was a
filial of a mother parish, and sending the user to the wrong registers.

Every figure below is measured, from `packages/engine/mcp-server/dev/probe-catalog.ts`
(sections A–G, 2026-09-14). Where this spec states a number, that probe is the
source; re-run a section rather than trusting a figure that looks stale.

## Design

**One hydrating tool, not a search/read pair** (lead ruling, 2026-09-27). A
search hit is thin: `title`, `creator`, `repositoryCalls`, `identifier`, and a
`coverage.temporal` that was empty on all 1,697 hits sampled — no dates, no
format, no film, no online status (probe F). So the question the Catalog is
reached for cannot be answered from a search alone, and a `catalog_read`
sibling would cost a second agent turn before any answer existed. This tool
fetches the item detail itself and answers in one turn.

**The item calls run in parallel, and `N` is deliberately small.** The service
has two regimes (probe E): rested, item calls are 0.18–0.25 s; degraded, 4–11 s —
a figure the probe flags as provisional, since it was taken through
`fetchWithRetry` and an unknown part of it may be backoff rather than service
latency. The budget below is sized so that it holds either way: a *smaller*
true latency only widens the margin.
The degraded regime is entered on **request volume** — this probe's own ~150
requests inside a few minutes did it — and **not** on concurrency. So
concurrency buys latency for free, while a large `N` buys the degraded regime
for the whole session.

`hydrate` therefore defaults to **10** and is capped at **25**. Ten item calls
per search leaves room for roughly thirteen searches (150 ÷ 11 requests per call) before approaching the
volume that degraded the service, and at the degraded 11 s with all ten in
flight the hydration still finishes in ~11 s — well inside the budget below.
At the cap of 25 it is 26 requests per call and roughly six searches, which is
the number that decides whether 25 is safe. Raising the cap is additive;
lowering it after agents depend on it is not.

**The budget is anchored at tool entry, and it must cut off rather than wait.**
`mapWithConcurrency` (`src/utils/place-resolver.ts`) has no deadline: called
alone it waits for the slowest item call however long that takes.

Anchoring that deadline at *hydration* entry would be the mistake
`person-read.ts` already made and documents — *"Anchored at phase entry the
budget was 40 s on top of whatever the read had already used … could put the
call past 60 s and lose everything, which is the one outcome this exists to
prevent."* Everything before hydration is unbudgeted otherwise:
`standardPlaceToRepId` goes through `withRetry`, which has **3 attempts and no
wall-clock budget**, over `fetchWithTimeout` at the 30 s default; and
`fetchWithRetry`'s first attempt always runs its full `timeoutMs` whatever the
10 s retry budget says. Worst case that is ~90 s of place resolution plus 30 s
of search before a hydration clock would even start.

So: **a 50 s deadline taken at `catalogSearchTool` entry**. It bounds
**hydration**: place resolution and the search spend from it, hydration gets
`deadline - Date.now()` at phase start, and skips entirely when little is left.

It does **not** abort them, and that limit is worth stating rather than
implying. `standardPlaceToRepId` exposes no budget parameter — it takes only
`{ contextName }` — so a pathological place resolution still exceeds the Cowork
cap with nothing this tool can do. The search leg *is* cappable and is capped:
it goes out with `timeoutMs = Math.max(0, deadline - Date.now())`. What the
entry anchor buys is that the common case never **adds** 50 s on top of an
already-slow search.

`standardPlaceToRepId` also swallows every error and returns `null`, so the
`placeResolved: false` fallback below covers auth and network failures as well
as a genuinely unknown place. Hits the deadline does not reach come back `hydrated: false`
with `hydrationTimedOut: true` on the response. A partial answer inside the cap
beats a complete one the runtime kills.

The mechanism is the shipped shape in `person-read.ts`'s transcription phase —
`mapWithConcurrency(hits, hydrate, fn)` **raced from outside** against a
`setTimeout` expiry (`Promise.race([work, expiry])`), with `fn` catching its own
errors and publishing into a `finished` map, and no task started that the
remaining budget cannot pay for.

The raced `Promise.all` inside the helper is safe **only** because of those two
properties: a task that never rejects cannot abandon its siblings, and a return
value nobody reads cannot be lost to the race. Drop either and the batch
becomes all-or-nothing — which would break "one bad item must not fail the
search" below. This is also what the lead's 2026-09-27 ruling says to do
("hydrate with `mapWithConcurrency` at concurrency N"); an earlier draft of
this spec claimed `person-read.ts` avoided the helper, which is the opposite of
what that file does.

**Each item call is issued with `timeoutMs = Math.max(0, deadline - Date.now())`**,
so a straggler aborts its own request rather than outliving the tool call. The
"never start work the budget cannot pay for" check fires once for every task
here — concurrency equals `hydrate`, so they all start together — which makes
the per-call timeout the only lever left on a slow one. `person-read.ts`'s own comment on that phase
records what an escaped fetch costs: it made an unrelated test fail 4 runs in 10.

**Concurrency is the budget arithmetic's load-bearing assumption**, so it is
pinned: the in-flight limit **is** `hydrate`. `mapWithConcurrency`'s own default
is 8; at a concurrency of 1 the same ten degraded calls take 110 s and the only
symptom is `hydrationTimedOut: true`. A test asserts all `hydrate` calls are in
flight at once.

## Endpoints

| | |
|---|---|
| search | `GET https://www.familysearch.org/service/search/catalog/v3/search` |
| item | `GET https://www.familysearch.org/service/search/catalog/item/{koha\|olib}:{n}` |

### Headers

`Authorization: Bearer <token>` from `getValidToken(principal)` — the service
answers **401 with an empty body** without one, so there is no JSON error to
parse on the auth path (probe A).

`Accept: application/json` — **required**. Without it the service answers
**200 with XML**, so a JSON parse fails on a response that looked successful.
The probe sends it on every call but its header does not record it as
load-bearing; measured here 2026-10-02.

`User-Agent: BROWSER_USER_AGENT` — **required**. Imperva fronts the host and
403s `node` and `fs-search-agent`; only the browser UA returns 200 (probe A).

Both calls go through **`fsFetch(principal, url, init, timeoutMs)`**, the
repo's standard for an authenticated FamilySearch endpoint — it sets the bearer,
delegates to `fetchWithRetry`, and on a 401 under `LOCAL` re-reads `tokens.json`
once. Re-deriving the header here would lose that re-read.

> **A green run from inside the church network does not prove the UA is right.**
> In-network callers are cleared before Imperva inspects the UA, so all four
> spellings return 200 there. The requirement is observable only from the
> public internet — which is where the `.mcpb` runs. Probe A records all three
> vantage points for this reason.

## Input

Every field is optional, but **at least one of `standardPlace`, `keywords`,
`surname`, `title`, `author`, `subject`, `filmNumber` or `callNumber` must be
present** — the service will answer an empty query with millions of hits.

| field | type | maps to | notes |
|---|---|---|---|
| `standardPlace` | string | `q.placeId` | resolved; see below |
| `exactPlace` | boolean | `q.place.exact=on` | excludes subordinate jurisdictions: Maine 3,902 → 803 hits. Needs a place beside it — alone it 400s |
| `keywords` | string | `q.keywords` | phrase quoting is honoured: `"parish registers"` 136,842 vs bare 153,738 |
| `surname` | string | `q.surname` | |
| `title` | string | `q.title` | |
| `author` | string | `q.author` | |
| `subject` | string | `q.subject` | |
| `filmNumber` | string | `q.filmNumber` | matches **both** the legacy microfilm number and the DGS |
| `callNumber` | string | `q.callNumber` | |
| `year` | number | `q.year` | an **exact year**, not a decade: `q.year=1800` → 22 hits, against the year facet's 1800 bucket of 185 |
| `availability` | string | `q.availability` | **case-sensitive**: `Online` → 472, `online` → 0 |
| `count` | number | `count` | the tool sends 25 when omitted; max 200 (201 → 400). The *service's* default was never measured — every probe query passes `count` |
| `hydrate` | number | — | item calls to make, default 10, max 25 |

Everything ANDs: place id 333 + `exactPlace` → 803; plus `keywords=census` → 54.

**Not exposed.** `q.placeId` and `q.subjectId` take raw ids and the LLM
boundary takes names (the repo-wide rule). `q.place` is reached only as the
fallback below. `offset` is not exposed — see **Paging**. `m.defaultFacets` is
not exposed; facets are not returned by this tool, and nor are the
`c.<facet>1=on&f.<facet>0=<value>` filters probe D accepts — they are the only
route to Format, Record Type and Language (`q.format`, `q.language` and
`q.recordType` all 400), but nothing in the shipped reference docs asks for
them: they ask for microfilmed and image-only holdings, which `filmNotes[]` and
`availableOnline` answer. Declined for that reason, not overlooked.

**Always sent:** `m.queryRequireDefault=on`. Without it the query term
constrains almost nothing — `q.keywords=lutheran` is **2,046,826** hits
unflagged and **12,344** flagged (probe B). This is not a tunable.

### `standardPlace` → `q.placeId` is a **rep id**, and the wrong helper lies

`q.placeId` takes this repo's **`placeRepId`**, resolved with
**`standardPlaceToRepId`**. Not `standardPlaceToPlaceId`.

The two id namespaces overlap in small integers, so the wrong helper returns a
**wrong answer rather than an error**:

| helper | "Maine, United States" | what the Catalog returns |
|---|--:|---|
| `standardPlaceToRepId` | **333** | Maine — 803 exact, 3,902 with subordinates |
| `standardPlaceToPlaceId` | 16 | **Timor-Leste** — 8 items, East Timor dictionaries |

A non-numeric `placeId` 400s; an unknown numeric one returns 0 hits. Neither
fails loudly enough to catch this, so a unit test mocks the resolver and
asserts the **rep** id is what reaches `q.placeId`.

When `q.placeId` is present the service **ignores `q.place` entirely** —
`q.place=Zanzibar&q.placeId=333` returns the Maine set.

**Fallback.** When `standardPlaceToRepId` cannot resolve the name, the tool
sends `q.place=<the name>` instead and sets `placeResolved: false` on the
response. The Catalog does match place by name, so a searchable answer beats
an error; the flag tells the agent its place filter is looser than it asked for.

## Response

```
{
  totalHits: number,
  returned: number,
  placeResolved: boolean,
  hydrationTimedOut: boolean,
  hits: [{
    id: string,                 // "koha:123456"
    title: string,
    creator?: string,
    repositoryCalls: string[],  // access signal, see below
    url?: string,
    hydrated: boolean,
    // present only when hydrated:
    notes?: string[],
    authors?: string[],
    subjects?: string[],
    filmNotes?: [{
      filmNumber?: string,        // legacy microfilm
      imageGroupNumber?: string,  // DGS — feeds image_search / fulltext_search
      indexed?: string,
      shelf?: string,
      copyLocation?: string,
      text?: string,
      imageStartNumber?: string,
    }],
    availableOnline?: boolean,
    digitalLibraryUrl?: string,
  }]
}
```

### The item URL needs no parsing — it is `identifier.value`

Measured 2026-10-02 against Maine (`q.placeId=333&q.place.exact=on`), which
returned the probe's recorded 803 hits:

```
identifier.value = "https://www.familysearch.org/service/search/catalog/item/koha:3308785"
```

`identifier.value` **is already the item endpoint URL**, so the tool fetches it
directly rather than reconstructing `{ns}:{n}`. That removes the failure this
design exists to prevent: a wrong id parse 404s every item, and the error table
below turns a 404 into `hydrated: false` per hit — so the tool would return thin
search hits forever with every unit test green.

**The URL is checked before a credential is attached to it.** `fsFetch` sets the
bearer on whatever URL it is handed, and this one arrived inside a response
body — the same shape `fs-image-fetch.ts` guards with `MEMORY_ARTIFACT_PATTERN`
("nothing should hand a token to a URL that arrived inside a response body").
`identifier` is a catalogue field and catalogues routinely carry *external*
resource identifiers, so this needs no attacker: one hit whose `identifier.value`
is a publisher or WorldCat URL would send the user's FamilySearch access token
to a third-party host.

So: the value must be a string beginning
`https://www.familysearch.org/service/search/catalog/item/`. A hit whose
`identifier` is absent, non-string, or off-prefix is returned `hydrated: false`
and **no request is made for it**. Nothing is reconstructed — the check only
refuses a URL we did not measure.

`id` on the response is the last path segment of that URL (`koha:3308785`),
carried for citation, not used to build the request. Both namespaces occur —
`koha:` (2,987 of 2,991 sampled) and `olib:` (4) — and because the URL is used
verbatim, neither needs special handling. A test hydrates an `olib:` hit anyway,
since a future refactor that starts parsing would silently drop them.

`repositoryCalls` is the access signal — the one useful field a search hit
carries. Observed values: `Online`, `Online at FamilySearch Center`,
`Online at Affiliate Library`, `FamilySearch Library`,
`Granite Mountain Record Vault`, `HSB (Headquarters Storage Building)`.

### Repeated item fields are XML-collapsed and must be normalized

Under the item's single `source` object, **`note`, `author`, `subject` and
`film_note` are an object when there is one value and an array when there are
several**, and `film_note` is **absent** when the item was never filmed — 12 of
18 sampled items had none, 6 had a single object, others arrays of up to 29
(probe F). Every one of the four is normalized to an array before it is read,
and the one-value, several-values and absent cases are each tested.

### `digital_film_no` is an image group number

`film_note[].digital_film_no` is a DGS that resolves against the same group
service `image_search` uses — DGS 5157135 → apid `TH-1942-25137-31341-10`
(probe G). It is surfaced as `imageGroupNumber` **because that is the parameter
name `image_search` and `fulltext_search` take**, so a Catalog item hands them
their input directly rather than leaving the agent at a film number with
nowhere to go.

A populated `filmNumber` with an empty `imageGroupNumber` means **filmed but
not digitized**.

### Digitized books have no film at all

`available_online: "Y"`, no `film_note`, and the link buried as HTML inside a
`note` of `type: "RSLINK"` pointing at
`familysearch.org/library/books/idurl/1/{id}` — the FamilySearch Digital
Library, which no tool here reaches. The URL is surfaced as
`digitalLibraryUrl`; the service behind it is not called.

## Paging

**This tool does not page, and does not expose `offset`.**

These figures are probe E's, taken in-network and not re-run end to end from
outside; the probe itself names them as worth re-measuring before a spec leans
on them. **This decision does not lean on them** — not paging is the right call
at any ceiling, because of the silent-ignore behaviour below. `count` maxes at
200 and `offset` is honoured to 9,990 (10,000 → 400), so a
result set is walkable only to its first 10,000 items — and there is **no
`sort` parameter**, so relevance order is the only order (probe D, E).

The reason not to page is stronger than the ceiling. Under the degraded regime
a deep offset **stops erroring and starts being silently ignored**: `offset=5000`
answers 200 with `"offset": 0` and page one's hits. A pager that trusts the
status code loops forever over page one, under exactly the load a pager
generates.

**If `offset` is ever added, the echoed `offset` in the response body must be
checked against the one requested**, and a mismatch treated as the end of the
result set rather than as another page.

## Errors

| condition | message |
|---|---|
| no searchable field given | names the eight fields and says at least one is required — refused before any request |
| `count` > 200 or `hydrate` > 25 | names the cap and the value given |
| no session | `getValidToken` throws the shared not-logged-in instruction, before the Catalog request. On the `standardPlace` path the resolver's own Places calls go out first and swallow their auth failure to `null`, so the session error arrives after them |
| 401 **from the service** | `fsFetch` re-reads `tokens.json` once, then the shared "FamilySearch session not accepted; call the login tool to re-authenticate." |
| 403 from the search | names the browser user-agent requirement; this is Imperva, not a permissions error |
| other non-2xx from the search | `FamilySearch Catalog search failed: {status} {statusText}` |
| item call fails | **not** an error — that hit returns `hydrated: false`; one bad item must not fail the search |
| `standardPlace` does not resolve | **not** an error — falls back to `q.place` with `placeResolved: false` |

## Tests

| test | pins |
|---|---|
| the **rep** id reaches `q.placeId` | the Maine → Timor-Leste substitution (probe C) |
| `m.queryRequireDefault=on` is always sent | 12,344 vs 2,046,826 (probe B) |
| `note`/`author`/`subject`/`film_note` normalize from object, array and absent | XML collapse (probe F) |
| hydration deadline abandons in-flight calls | fake timers, one item resolving at 90 s, `advanceTimersByTimeAsync(120_000)`; asserts `hydrationTimedOut: true` and `hydrated: false`. **Not** a never-resolving mock — with the deadline removed that hangs to the vitest timeout instead of failing an assertion. This departs from the issue's trap wording, which predates the break table |
| `offset` is never sent | the silent-ignore trap (probe E) |
| `BROWSER_USER_AGENT` and the bearer are both sent | probe A |
| a failing item call leaves the search successful | one bad item must not fail the answer |
| `digital_film_no` surfaces as `imageGroupNumber` | the bridge to `image_search` |
| the item call uses `identifier.value` verbatim | the id-parse failure class |
| an `olib:` hit hydrates | `id` is derived from `identifier.value`, so no fixture can make the two disagree while the tool reads them this way; the row pins that a non-`koha:` namespace is fetched as given, and reds if a later change reconstructs the URL from a parsed id |
| a hit whose `identifier.value` is off-host is never fetched | the bearer must not reach a host we did not measure |
| all `hydrate` item calls are in flight at once | the budget arithmetic's assumption |
| a search leg costing 45 s leaves hydration 5 s, not a fresh 50 s | that the clock starts at tool entry, not at the phase. The budget cannot be consumed *entirely* by the search — each leg's own `timeoutMs` is the remaining budget, so an exhausted search aborts and throws rather than reaching hydration |
| a 401 from the search gives the shared re-auth instruction | the error table's 401 row; the generic `!res.ok` arm would answer `failed: 401 Unauthorized`, which is not LLM-actionable |
| `Accept: application/json` is sent | a 200 of XML otherwise |

## Live check

```
cd packages/engine/mcp-server
npx tsx dev/try-catalog-search.ts "Maine, United States"
npx tsx dev/try-catalog-search.ts "Javorje nad Škofjo Loko, Slovenia"
```

The second is the alpha-feedback case: a place with unindexed holdings where
the agent previously guessed a mother parish.

## Not in this spec

The two skill-side callers. `locality-guide` is being replaced by an agent, so
its grant and the Javorje acceptance test belong to that work; `research-plan`'s
`planning-standards.md` line is being routed elsewhere and may not survive.
Editing either here would buy a paid eval run for a file about to move.
