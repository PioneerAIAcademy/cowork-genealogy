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
source; re-run a section rather than trusting a figure that looks stale. The
exception is **Answer size**, whose figures come from
`packages/engine/mcp-server/dev/try-catalog-search.ts`, run live on 2026-10-22.

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

The item leg is issued with `attempts: 1`. `fetchWithRetry` defaults to 3 and
retries every 429/5xx — exactly what the service answers once volume pushes it
into the degraded regime — so the default would turn a capped 25 item calls
into as many as 75 under precisely the condition the cap is sized against. The
search leg keeps its retries; it is one request.

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
`standardPlaceToRepId`'s Places fetches go through `fetchWithRetry` at the
30 s default timeout, and a resolution can make more than one of them (a dated
search, then an undated fallback). `fetchWithRetry`'s first attempt always runs
its full `timeoutMs` whatever the 10 s retry budget says, so place resolution
has no wall-clock budget of its own, and the search adds 30 s more before a
hydration clock would even start.

So: **a 50 s deadline taken at `catalogSearchTool` entry**. It bounds
**hydration**: place resolution and the search spend from it, hydration gets
`deadline - Date.now()` at phase start, and is skipped entirely when **nothing**
is left — not merely when little is. A search leaving 50 ms still starts every
item call; each then carries that 50 ms as its own `timeoutMs` and aborts
itself.

It does **not** abort them, and that limit is worth stating rather than
implying. `standardPlaceToRepId` exposes no budget parameter, so a pathological
place resolution still exceeds the Cowork cap with nothing this tool can do.
What it must not do is carry on: the deadline is re-checked **after**
resolution, because `Math.max(0, deadline - Date.now())` is then `0` and
`AbortSignal.timeout(0)` turns the search into `Request to <whole query URL>
timed out after 0ms`, which names neither the Catalog nor a way out. The tool
throws its own error there instead, naming the place and telling the caller to
retry without `standardPlace`.

Its `contextName` option is **not** a label and must not be given one: it is a
parent place used to disambiguate same-name places, and any other value
suppresses the context the resolver derives from the input itself
(`contextName ?? deriveContextName(name)`). A tool name there matches no
candidate, so `"Paris, Idaho, United States"` loses its `Idaho` filter and
resolves to Paris, France — the Maine → Timor-Leste failure one layer up. The
tool passes no options at all. The search leg *is* cappable and is capped:
it goes out with `timeoutMs = Math.max(0, deadline - Date.now())`. What the
entry anchor buys is that the common case never **adds** 50 s on top of an
already-slow search.

`standardPlaceToRepId` also swallows every error and returns `null`, so the
`placeResolved: false` fallback below covers auth and network failures as well
as a genuinely unknown place. Hits the deadline does not reach come back `hydrated: false`
with `hydrationTimedOut: true` on the response — **including** when the search
leg spent the whole budget and hydration was never attempted. That case needs
stating because it does not fall out of the race: every task short-circuits on
its own `remaining <= 0` guard, so `work` settles in microtasks and beats the
expiry macrotask deterministically, reporting `false`. The flag means "retry
later"; `hydrated: false` alone means "this item has no detail", and conflating
them tells the caller to stop when it should retry. A partial answer inside the cap
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

**Concurrency is the budget arithmetic's load-bearing assumption**: every item
call must be in flight at once. At a concurrency of 1 the same ten degraded
calls take 110 s and the only symptom is `hydrationTimedOut: true`.

What enforces that is **the slice, not the limit argument**. `targets` is
already `slice(0, hydrate)`, so `mapWithConcurrency`'s
`Math.max(1, Math.min(limit, items.length))` always equals `targets.length` and
the limit can never bind — the call is an unconditional `Promise.all`, and the
test asserting a peak of 4 is observing that rather than a lever. Stated
plainly because an earlier draft of this section described `hydrate`-as-limit
as a tunable knob, which it is not. The argument is kept as a backstop: it
costs nothing, and it means removing the slice cannot silently turn one tool
call into 200 parallel requests. To actually vary concurrency, a separate
constant would have to be introduced and the slice widened.

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
| `availability` | string | `q.availability` | The service matches **exactly**: `Online` → 472 (473 re-measured in review), `online` and `ONLINE` → 0, with no error. A clean zero reads to the agent as "the Catalog holds nothing", so the tool **normalises any capitalisation of `online` to `Online`**. Only that one value is normalised — it is the only one measured live; anything else passes through unchanged rather than being guessed at |
| `count` | integer, 1–200 | `count` | the tool sends 25 when omitted; max 200 (201 → 400). The *service's* default was never measured — every probe query passes `count` |
| `hydrate` | integer, 0–25 | — | item calls to make, default 10; `0` skips hydration |

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
  hydrateRequested: number,     // how many hits hydration was asked for
  hits: [{
    id?: string,                // "koha:123456"; absent with `url`, since it
                                // is derived from it
    title: string,
    creator?: string,
    repositoryCalls: string[],  // access signal, see below
    url?: string,
    hydrated: boolean,
    // present only when hydrated:
    notes?: string[],
    authors?: string[],
    subjects?: string[],
    filmNotes?: [{                // one entry per reel, see below
      filmNumber?: string,        // legacy microfilm
      imageGroupNumber?: string,  // DGS — feeds image_search / fulltext_search
      indexed?: string,
      copyLocation?: string,
      text?: string,              // what the reel covers; several notes' texts joined with " | "
    }],
    filmNotesTotal?: number,      // only when filmNotes was cut short: how many entries the item has
    filmNotesHint?: string,       // only with filmNotesTotal: how many are listed, how to get the rest
    availableOnline?: boolean,
    digitalLibraryUrl?: string,
  }]
}
```

### Film notes: one entry per reel

One reel can carry many film notes, each with its own `text` and the same
numbers. The tool returns one entry per reel.

Film notes that agree on all four of `filmNumber`, `imageGroupNumber`,
`indexed` and `copyLocation` are one reel, and become one entry. Their `text`
values are joined with `" | "`, in the order the Catalog gave them. A note with
no text adds nothing, not even a separator. Entries come out in the order their
reel first appeared.

Nothing is lost. Every text is kept, once. Notes that differ in any one of the
four fields stay apart, and so does a note that lacks a field another has. The
same reel held in two places is therefore two entries. That matters because the
plugin reads `copyLocation` and `imageGroupNumber` off each entry as a fact
about one reel, and a merge across a difference would give an entry that says
something no note said. Splitting a joined `text` back into its notes is exact
while no note text contains the separator. None did in the answers that
`packages/engine/mcp-server/dev/try-catalog-search.ts` saved on 2026-10-22.

`shelf` and `imageStartNumber` are not carried. `shelf` names the format or
shelving area (for example `Digital`, `Film`, `Fiche`, `B1 Floor Film`), not
which reel it is. `imageStartNumber`, the Catalog's `item_image_start_no`, was
absent from every film note in those same answers. No plugin body, validator or
recorded fixture reads either field.

### `filmNotesTotal` and `filmNotesHint`

A hit carries these two fields only when its `filmNotes` list was cut short to
keep the answer within its size budget (see **Answer size**). On a hit that
lists every entry both are absent.

`filmNotesTotal` is how many entries the item has, counted after merging, so it
is in the same unit as the list. `filmNotes` then holds the first entries of
that list, in order, each one whole.

`filmNotesHint` is one line. It says how many entries are listed and how to get
the rest: hydrate fewer hits, or search with keywords that name the item. It
names no input the tool does not have. It does not name the hit's `url`: that is
the Catalog's item record, which answered 401 without a sign-in token when
probed on 2026-10-22, so neither an agent nor a person can open it.

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

`id` on the response is the item segment following the prefix (`koha:3308785`) — the remainder stripped at the first `/`, `?` or `#`, not the whole remainder, which would carry a query string or a trailing path into a citation. The probe measured 25/25 bare ids, so the two read the same today; they are written to stay that way —
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

## Answer size

The serialized answer is kept at or under 40,000 characters. The film notes of
the hydrated hits are what give way.

### Why

Claude Code saves any tool result longer than 50,000 characters to a file and
hands the agent a preview. The agent has to read that file back to see the rest,
and the plugin cannot count on that (see `docs/specs/sidecar-read-tool-spec.md`,
section 4). `locality-guide` has `Read` but no `Bash`. So an answer over the line
loses the hits past the preview, and this tool has to stay under it.

A default call could go over. On 2026-10-22, Ireland with `Catholic parish
registers baptism marriage`, at the defaults, was 55,803 characters.

### The budget

`ANSWER_CHAR_BUDGET` is 40,000 characters, a constant in the tool's own file. It
leaves 10,000 under the 50,000 line. This is a budget of characters, not the 50 s
time budget under **Design**.

It is measured on the serialized answer, `JSON.stringify(result)`, which is how
the server sends it, compact. Every character counts: keys, quotes, braces,
commas, and the two fields a cut hit adds (`filmNotesTotal` and
`filmNotesHint`). Counting only the film-note text would leave the answer over.

### What gives way

Only the film notes of the hydrated hits. Before the change they were 73.6% of
the Ireland answer, 86.5% of the Hammer one and 99.3% of the Norway one (the
calls measured below). Nothing else is cut. Every hit stays listed, and every
other field of a hit stays whole. The cut is a list, so the answer stays valid
and says what it left out.

### How the room is shared

`shapeAnswer` runs once every hit is hydrated. It merges each hit's film notes
into entries, then fits the entries into the budget:

1. Measure everything except the film notes of the hydrated hits: the envelope,
   every unhydrated hit, and every other field of the hydrated hits. What is
   left under 40,000 is the room.
2. A hit's need is what its whole list of entries costs, commas included.
3. Take the hydrated hits that have film notes in order of need, smallest first.
   With `m` hits left, each is offered the room that remains divided by `m`,
   rounded down.
4. A hit whose need is no more than its offer is listed whole. What it did not
   use stays in the room for the hits after it.
5. A hit that needs more lists the first entries that fit, in order. The two
   fields it adds are paid for out of the same offer.
6. A cut hit lists at least one entry, whatever the offer. An item with a single
   entry is listed whole, since listing fewer of one entry cuts nothing.

Sharing by need, not by rank, keeps a giant at rank 1 from taking the room the
small hits behind it need. Handing down what a small hit leaves gives that room
to the giants instead. Nothing is cut mid-entry. No hit is dropped. The
serialized answer is never truncated.

### The bound

The film notes are the only thing cut, so the answer is at most 40,000
characters unless the rest of it is over that already. Two cases go over, on
purpose:

- The rest of the answer, with every film-note list emptied, is itself over
  40,000. Hits are never dropped, so a large `count` can do this.
- The first entry of a cut hit, or the one entry of an item that has only one,
  is longer than the room left for it. The tool keeps it whole rather than list
  nothing.

In both cases the film notes are down to what the rules above keep, and the
answer is as small as this tool will make it without dropping a hit.

Tests pin the bound at the default `count`, at `hydrate` 1, 10 and 25, with
items of up to 1,804 entries, and they pin the two exceptions.

### Measured on 2026-10-22

Measured with `packages/engine/mcp-server/dev/try-catalog-search.ts`, live, at
the tool's defaults (`count` 25, `hydrate` 10). Each call was run before the
change and again after it. The Catalog moves, so a re-run differs by a few
characters: the Ireland call came back 55,803 and, run again at once, 55,802.

| call | before | after | what the answer holds |
|---|--:|--:|---|
| `Ireland` + `Catholic parish registers baptism marriage` | 55,803 | 26,392 | 25 hits, 10 hydrated. The hit at rank 1 lists 5 of its 7 entries (it carried 76 notes). The other hydrated hits are whole |
| `Hammer, Hordaland, Norway` + `kirkebøker` | 25,595 | 9,620 | 3 hits, all whole. One hit's 142 notes are 14 entries |
| `Cook, Illinois, United States` + `church records` | 18,012 | 16,614 | 25 hits, none cut. 21 notes became 11 entries, and `shelf` is gone |
| `Norway` + `kirkebøker` | 1,476,812 | 39,921 | every hit listed, 8 of 25 cut, each to its first 34 or 35 of 434 to 1,804 entries |

The Norway call is the tail. Before the change it carried ten hydrated hits,
nine of them `Norway, kirkebøker : Volume N`, with 434 to 1,804 notes each and
every note its own image group, so merging cannot shrink them. In the run after
the change one of the ten item calls gave no detail, so nine hits were
hydrated.

### How to get the rest

A hit with `filmNotesTotal` lists only the first entries of its item. There are
two ways to the rest through this tool, the same two its `filmNotesHint` names:

- **Hydrate fewer hits.** The room is shared among the hydrated hits, so a
  smaller `hydrate` leaves more for each, and `hydrate: 1` leaves one hit all of
  it. With `hydrate: 1` the Ireland hit at rank 1 lists all 7 of its entries,
  where at the default it lists 5. A test pins that.
- **Search with keywords that name the item.** A search that matches the item
  alone hydrates it alone, which is the same thing by another road.

### What this does not cover

- An item whose entries do not fit in one whole answer cannot be listed in full
  through this tool, even as the only hydrated hit. The largest item measured on
  2026-10-22, a `Norway, kirkebøker` volume of 1,804 entries, is more than four
  times the budget by itself, after merging and without `shelf`. The tool has no
  input for paging through an item's entries. For that item an agent cannot reach
  the rest; a person can read it in the FamilySearch Catalog.
- Hits are never cut. At a large `count` the hits alone can pass the line: an
  unhydrated hit takes roughly 250 to 450 characters in the answers measured on
  2026-10-22.

### Recorded answers

The recorded answers in `eval/fixtures/mcp/catalog-search-*.json` stand in for
the tool in the eval runs, so they are held in the shape the tool returns. They
were reshaped by running each through `shapeAnswer`, with
`packages/engine/mcp-server/dev/reshape-catalog-fixtures.ts`, not by hand, and a
test fails if shaping any of them would change it. Shaping a shaped answer
changes nothing: a hit that carries `filmNotesTotal` is counted as it stands.

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
| no searchable field given | names the eight fields and says at least one is required — refused before any request. "Given" means a value the query can **carry**: the guard and `buildQuery` ask the same question (`searchableValue`), because a guard testing presence while `buildQuery` tested `typeof === "string"` let `filmNumber: 568142` through to a query with no `q.*` filter at all — the whole catalogue's top 25, returned as if they answered. The MCP boundary does not validate against `inputSchema` (`server.ts` casts `arguments`), so a number, `null` or a blank string is a live input |
| `standardPlace` present but not a usable name (object, array, blank) | names the value. It was the one field read unguarded, so the resolver's internal `s.trim is not a function` reached the agent verbatim. A number is coerced to its text, as `str` does for unquoted film numbers, and simply fails to resolve |
| `exactPlace` without a place | refused, not dropped: `.exact` alone 400s, and silently dropping it returned the WIDER set with nothing saying so, so the agent read the hit count as an answer to the narrower question it asked |
| `year` non-integer, or outside 1000–2200 | names the range and the value. Integrality alone is not enough: `1e21` **is** an integer and reaches the wire as `q.year=1e%2B21`, costing the same 400 as the `NaN` the guard was written for; `0` and `-1850` likewise |
| `exactPlace` not a boolean | refused. It was the one field with no type guard, and a bare truthiness test: `"false"`, `"no"`, `[]` and `{}` all silently turned the **narrowing** filter on, answering 803 of Maine's 3,902 items as the whole set. Two sweeps hunting silent *widening* walked past it because this one narrows |
| `count` or `hydrate` given as `null` | refused. `?? DEFAULT` treats null as absent, so these were silently defaulted while null on every other field is refused — the asymmetry both earlier wrong-answer bugs came from |
| any `q.*` field present but not a value the query can carry | refused, never dropped. Dropping one silently WIDENS the answer: with `{ standardPlace: "Maine, United States", keywords: {} }` the keywords vanished and the agent got the top 25 of all 3,902 Maine items as the answer to "Maine + parish registers", `placeResolved: true`, nothing saying a filter had gone. An earlier fix closed only the case where every field was unusable |
| a 200 whose body is not a JSON object, **including a top-level array** | `typeof [] === "object"`, so an array body walked through the guard written for exactly this and answered `{ totalHits: 0, returned: 0, hits: [] }` — a clean, authoritative "the Catalog holds nothing here", which an agent records as negative evidence it never obtained. The body is now unwrapped like every container inside it |
| a 200 whose body is not a JSON object | names the Catalog and says to retry. Imperva fronts this host and answering 200 with a challenge page is ordinary for it — the thing `Accept` exists to prevent, with no fallback if it is ignored. Unguarded, the agent got `SyntaxError: Unexpected token '<'` |
| `count` outside 1–200, or `hydrate` outside 0–25, or either non-integer | names the range and the value given. Both bounds are checked, not just the cap: `hydrate: -1` passed a one-sided `> MAX` test, and `slice(0, -1)` then kept all-but-one hit as targets while `mapWithConcurrency` clamped `-1` to **one** worker — 59 serial item calls against a cap of 25 |
| place resolution spends the whole budget | names the place and says to retry without `standardPlace`; the alternative is a bare `timed out after 0ms` quoting the query URL |
| no session | `getValidToken` throws the shared not-logged-in instruction, before the Catalog request. On the `standardPlace` path the resolver's own Places calls go out first and swallow their auth failure to `null`, so the session error arrives after them |
| 401 **from the service** | `fsFetch` re-reads `tokens.json` once, then the shared "FamilySearch session not accepted; call the login tool to re-authenticate." |
| 403 from the search | names the browser user-agent requirement; this is Imperva, not a permissions error |
| other non-2xx from the search | `FamilySearch Catalog search failed: {status} {statusText} — {detail}`. The Catalog answers RFC7807 (`{"detail":"Validation failure","instance":"/v3/search",...}`), so `parseUpstreamErrorBody` was widened to read that shape alongside the search endpoints' `{errors:[…]}`. Every error path reads the body first, which also releases the undici socket |
| item call fails | **not** an error — that hit returns `hydrated: false`; one bad item must not fail the search |
| `standardPlace` does not resolve | **not** an error — falls back to `q.place` with `placeResolved: false` |

### Reading a collapsed response

The upstream is an XML→JSON bridge: a one-element list arrives as a bare
object, several as an array, a text-only element as a bare scalar, and nothing
at all when empty. **That rule applies at every level**, which is the single
thing this tool got wrong most often — five reviews found it at a new depth
each time, always in a node whose siblings were already defended:
`repositoryCalls`, then `searchHits`, then `identifier`, then `title`/
`creator`, then `item.source` (the *parent* of four defended fields), then
`metadataHit`/`metadata` (two layers further up), the `film_note` keys,
`available_online`, `totalHits`, `note.type`, and finally the top-level body
itself.

Patching them one at a time is what kept failing. There are now exactly three
readers and every access uses one of them:

| reader | for | behaviour |
|---|---|---|
| `asArray` | a repeated child | object → `[object]`, array → itself, bare scalar → `[{ text }]`, absent → `[]` |
| `objectsIn` | a container where a bare scalar is malformed, not a collapse (`source`) | every real object, nothing else |
| `scalarOf` | **every** scalar taken off a response | `str(v)`, else the text of the first collapsed element |

`scalarOf` is the one that keeps a new field from being half-defended: a bare
`str()` reads a string or a number and silently drops `{value}`, `{text}` and
`["x"]`, which is how every film-note key, `available_online` and
`note.type` each failed while their neighbours worked.

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
| the resolver is called with the place and **no options** | a `contextName` that is not a parent place suppresses the derived one; asserted as the whole argument list, since `expect.anything()` for the opts passes either way |
| `count` and `hydrate` are refused outside their range, non-integer, and `NaN`; and accepted at 1 / 200 / 0 / 25 | the one-sided `> MAX` hole, and the other direction — that the legitimate edges still pass |
| a search body whose repeated fields collapsed to one object still answers | `.map` on a raw `repositoryCalls` threw the whole search away |
| an unquoted `filmno` / `digital_film_no` is read | a JSON number yielded a film note of `{}` with `hydrated: true` |
| a note that collapsed to a bare string survives | text content with no attributes collapses to a string, the ordinary free-text `<note>` |
| `available_online` is read as `true`/`false`/`"Y"`/`"N"` | a boolean fell through the string-only reader |
| the **first** RSLINK url is surfaced and its markup stays out of `notes` | one URL field, and raw `<a href>` was being handed to the LLM as prose |
| `exactPlace`, `year`, `availability` and `count` reach the query | six inputs the suite never asserted on; `.exact` alone 400s |
| `online` / `ONLINE` / `oNlInE` all reach the query as `Online`, and an unmeasured value passes through unchanged | exact matching upstream turns a wrong case into a false "nothing held"; the second half keeps the normalisation to the one value measured |
| the search leg spending the budget sets `hydrationTimedOut` | the task guard makes `work` win the race deterministically, so this does not fall out of the race |
| a one-hit answer whose `searchHits` collapsed to an object | `.map` on it threw the whole search away; it is the last repeated field that was not read through `asArray` |
| the item url is found when it is **not** the first `identifier`, and an off-host one among several is still refused | a catalogue entry carries external ids beside its item URL; the widening must not weaken the host check |
| a bare-string `title` / `repositoryCalls` / `identifier` is read | `asArray` preserves a bare string as `{ text }`, and a reader checking only `.value` lost exactly that shape |
| an unquoted `filmNumber` reaches `q.filmNumber`; `null`, blank and object values are refused | the guard and `buildQuery` must ask the same question |
| `year` is refused at `NaN` and `18.5` | `typeof NaN === "number"` |
| a bound given as a string names its type | `count is 10` read as a value that already satisfied the rule |
| an item call is tried **once** | `fetchWithRetry`'s default 3 attempts multiply the load under the degraded regime the cap is sized against |
| three targets sharing the fallback fixture all hydrate | guards the test helper: one shared `Response` can be read once, so later calls failed into `hydrated: false` |
| an off-host hit does not consume a hydration slot | `hydrateRequested` is "the first N with a usable url", not the first N positions |
| a 401 and a 403 carry the upstream detail, and the 403 does not blame the user-agent | the detail was parsed then discarded, and the old 403 named an action nobody can take |
| `standardPlace` as an object/array/blank is refused, and as a number is coerced rather than crashing | it was the one field read unguarded |
| the place is trimmed before both the resolver and `q.place` | `q.place=+++` was filtering the Catalog on nothing |
| an empty rep id reports `placeResolved: false` | `buildQuery` branches on truthiness, so the flag must too |
| `exactPlace` alone is refused | silently dropping it answered a wider question than the agent asked |
| a bare-number element survives `asArray` | `str` has a number branch; the element level did not |
| `notes`, `authors` and `subjects` read one element the same way | `notes` read `.text` first and the others `.value` first |
| an item url carrying a query string still yields a bare `id` | the response field and its spec disagreed |
| a failed item response is drained | 25 unconsumed undici bodies per call under the degraded regime |
| an item landing exactly on the deadline is discarded | the expiry timer fires AT the deadline, so `>` let it write after the race settled |
| the 403 does not state its cause as fact | a 403 cannot be told from a missing entitlement, which waiting never clears |
| `parseUpstreamErrorBody` falls through to `detail` when `errors` yields nothing | present-but-unusable is not absent |
| every film-note field maps to its own key, and `shelf` and `imageStartNumber` are not carried | the five fields are one table read once each, where seven near-identical spreads let a mistyped repeat go unseen; the two dropped fields stay dropped, as the service sends them |
| `hydrateRequested` is echoed | with the defaults 15 of 25 hits are `hydrated: false` purely for sitting past the window |
| place resolution eating the budget names the place | otherwise a bare `timed out after 0ms` quoting the query URL |
| a 400 carries the Catalog's own `detail` | the service says which parameter it rejected; discarding it left the agent retrying the same query |
| notes on one reel become one entry, texts joined with `" \| "` in the order given; a note with no text adds no separator, and a reel with no text has no `text` key | the merge rule, and a stray separator or an empty `text` |
| two notes that differ only in `filmno`, `digital_film_no`, `fs_indexed` or `copy_location` stay apart, and so does a note missing a field the other has | a merge across a difference gives an entry that says something no note said; the same reel held in two places must stay two entries, because the plugin reads `copyLocation` off each |
| notes that differ only in `shelf` are one reel | `shelf` is where the reel sits, not which reel it is |
| entries keep the order their reel first appeared in, and a later note joins its reel's entry | the Catalog's order is the order the agent reads |
| `mergeFilmNotes` is empty for no notes, leaves a lone note as it was, drops any field the answer does not carry, is idempotent and leaves its input alone | it runs on saved answers as well as live ones |
| on the saved Ireland answer, the 76 notes of one hit become one entry per reel and every text survives | the merge loses nothing on real data; the reel count is taken independently of the code |
| the saved Ireland answer rebuilds into upstream responses | `packages/engine/mcp-server/tests/fixtures/catalog-search/ireland-catholic-parish-registers.answer.json` is the tool's own answer of 2026-10-22 at the defaults, before the merge and the budget (433 hits, 25 returned, 10 hydrated, 55,803 characters); the tests that follow feed the tool responses rebuilt from it |
| the answer budget is 40,000 and at least 10,000 under the 50,000 spill line | every other budget test imports the constant, so a changed value would leave them true; this one pins the value |
| the Ireland call at the defaults stays under the spill line and the budget, lists all 25 hits, changes nothing but the film notes, and keeps the DGS on a hydrated hit's first entry | the call that was 55,803 characters |
| on that call only the giant at rank 1 is cut; it lists the first entries in order and carries `filmNotesTotal` and `filmNotesHint`, and the other nine carry neither | the cut is a prefix of whole entries, and it says so |
| `hydrate: 1` on that call lists every entry of the giant, with no total and no hint | the way back that needs no new input |
| a Norway-sized page (ten hydrated items of 3 to 1,804 entries) is within the budget at the defaults, lists all 25 hits, and cuts each giant to a prefix of its own entries; 25 giants at `hydrate: 25` are within it too; one giant alone gets far more entries than when ten share the room | the 1,476,812-character case is bounded by the shaping, not by the default |
| a hit that needs less than an equal share is listed whole and what it leaves goes to the giant; a giant at rank 1 does not starve the small hits behind it, and the room they leave is used | smallest need first with the hand-down. Both bound the size above and below, so an equal share for every hit goes red |
| a hit that fits its offer exactly is listed whole, and one a character short is cut | the edge is "no more than", not "less than" |
| a cut hit keeps at least one entry when the rest of the answer already exceeds the budget; a single huge entry is listed whole and is not called cut | the two cases the bound allows to go over |
| every character is counted, the two fields a cut hit adds included, at five budgets | the serialized answer is at most the budget |
| a hit that was not cut carries neither `filmNotesTotal` nor `filmNotesHint`, and the hint never names the hit's `url` | the two fields appear only when something was left out, and the `url` is an API record nobody can open |
| shaping a shaped answer changes nothing, and a hit already cut keeps its total and its entries | cutting it again would count the entries it lists as the entries it has, and `filmNotesTotal` would understate the item |
| 200 hits come back as 200, whatever the film notes | no hit is dropped |
| every `catalog-search-*.json` under `eval/fixtures/mcp/` is unchanged by shaping and carries neither `shelf` nor `imageStartNumber`, and the glob finds the files it guards | the recorded evals are graded on an answer the tool still gives. `mcp-fixture-shape.test.ts` reads keys one level below the response and does not see film notes |

## Live check

```
cd packages/engine/mcp-server
npx tsx dev/try-catalog-search.ts "Maine, United States"
npx tsx dev/try-catalog-search.ts "Javorje nad Škofjo Loko, Slovenia"
npx tsx dev/try-catalog-search.ts "Ireland" "Catholic parish registers baptism marriage"
npx tsx dev/try-catalog-search.ts "Hammer, Hordaland, Norway" "kirkebøker"
npx tsx dev/try-catalog-search.ts "Cook, Illinois, United States" "church records"
npx tsx dev/try-catalog-search.ts "Norway" "kirkebøker"
```

The second is the alpha-feedback case: a place with unindexed holdings where
the agent previously guessed a mother parish.

The last four are the answer-size check, the calls measured on 2026-10-22. The
Norway call is the one that was 1,476,812 characters, so run it again after any
change to the shaping. The script sends `count` and `hydrate` only when given
`--count` and `--hydrate`, so a bare run is the tool's defaults. In the output
look for:

- The `JSON.stringify(result).length` line: under the 50,000 spill line. And the
  `budget 40,000` line: `within it`.
- `every hit listed: true` on that same line.
- The `filmNotes` column of the per-hit table: `listed/total` on a hit that was
  cut, a plain count on the rest. The first three hits are printed in full, and
  a cut one shows its hint.
- The reconciliation line: `0 unattributed`. The per-field table must add up to
  the answer, or the script prints `RECONCILIATION FAILED` and exits 1.

`--save FILE` writes the raw answer, and `--from FILE` re-measures a saved
answer with no login and no network.

No CI job sees the size of a live answer. The tests pin the fixtures they build,
so this run is the check that the bound holds on the Catalog as it is today.

## Not in this spec

`research-plan`'s `planning-standards.md` line is being routed elsewhere and
may not survive. Editing it here would buy a paid eval run for a file about to
move. The `locality-guide` grant and Javorje acceptance test shipped separately.

`search-records` grants the tool and names it in its 0-hit lever and its
exhaustive-exit checklist (`references/search-strategy-levers.md`); its unit
tests register two empty catch-all fixtures (`catalog-search-empty*.json`) so a
call never aborts the run.
