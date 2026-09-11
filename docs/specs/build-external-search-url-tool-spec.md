# `build_external_search_url` — external-site search URL tool — Spec

> **Status:** New (2026-09-09), corrected 2026-09-10 after review. Migrates
> the deterministic URL-templating the `search-external-sites` skill
> previously performed **by hand in prose** into a tested MCP tool. The
> skill's own SKILL.md carried seven site-wide templates (Ancestry,
> MyHeritage, FindMyPast, FindAGrave, Newspapers.com, Chronicling America, and
> one state/regional digital-newspaper archive) as `{...}`-slot text for the
> model to fill in by hand. The LLM keeps every judgment this task requires
> (which record type/event the search targets, which curated link fits, what
> `conflicts[]` says about a disputed field); the tool does only the
> string-templating.

A pure, offline tool that builds a pre-filled search URL for one of fifteen
supported external genealogy sites from structured search attributes, either
as a fresh site-wide search or by appending parameters onto a FamilySearch-
curated collection link.

```
build_external_search_url({ site, baseUrl?, attributes }) -> { ok: true, url, notes } | { ok: false, reason, errors, supportedSites? }
```

---

## 1. Why this exists

Three corrections plus one architectural risk motivated the migration, not
just a style preference:

- **Chronicling America's shipped parameters were dead — both of them, not
  one.** The site-wide template shipped `start_date=YYYY-01-01&end_date=YYYY-12-31`;
  the working date parameter is `dates=YYYY/YYYY`. Review additionally found
  the template's search-term parameter, `qs`, is *also* dead on the live
  endpoint — `q` is what actually filters (§9 records the live measurement).
  Neither dead parameter errors — it is silently ignored, so a search
  "succeeds" unscoped and a nil result from it means nothing.
- **`sid` must never appear.** It's browser session state carried along in a
  copy-pasted URL, not a search parameter. A tool that never has `sid` in its
  per-site parameter table cannot forget it, and strips it from any curated
  `baseUrl` too (§3.2).
- **Two worked examples in SKILL.md encoded a project's own rejected value.**
  Both filled `birthplace=Pennsylvania` into an illustration for the
  `mid-research-flynn` fixture, whose own `conflicts[]` entry `c_001` resolved
  that dispute *against* Pennsylvania (`preferred_assertion_id: a_002`,
  Ireland). A worked example that contradicts the fixture it illustrates
  teaches exactly the failure this skill's "check `conflicts[]` before
  encoding a place or date" rule (SKILL.md `:318-337`) exists to prevent. Both
  now encode Ireland (SKILL.md `:275`, `:420`).
- **The general risk this class of bug represents.** A hand-composed URL with
  a wrong or dead parameter name doesn't error — the site accepts it,
  ignores what it doesn't recognize, and returns an unscoped or empty result
  that reads exactly like a legitimate negative finding. That failure mode is
  invisible to every downstream consumer (`research-exhaustiveness`, the
  user) once the log entry says `outcome: "negative"`. The `qs` finding above
  is a second, independent instance of exactly this failure inside the same
  card that set out to fix the first one — evidence that this class of bug is
  real, not hypothetical, and that a tool's parameter table is worth a live
  check even when it looks like a faithful port.

A fourth, later finding motivated §3.1's `access` field: a real alpha tester
was told FindAGrave needs a subscription when it is free, even though
`SKILL.md` on `main` said "free" three separate times. The fact was correct
in prose the model had to recall unprompted; it now comes back on every call
that succeeds, so the model reads it instead of remembering it.

---

## 2. Evidence base

Facts still verifiable in the current tree, cited at their current location:

| Fact | Source |
|------|--------|
| `conflicts[]` c_001 rejects Pennsylvania in favor of Ireland | `eval/fixtures/scenarios/mid-research-flynn/research.json` |
| The "check `conflicts[]` before encoding" rule | `SKILL.md:318-337` |
| The two worked examples now encoding Ireland | `SKILL.md:275`, `:420` |
| `digital_newspaper_archive` is an open bucket identified by `url_generated`, not a fixed per-state URL | `docs/specs/schemas/enums.schema.json:177-178`, `docs/specs/research-schema-spec.md:452` |
| `convert_calendar` — the architectural precedent for a pure, no-network, no-project-files tool | `packages/engine/mcp-server/src/tools/convert-calendar.ts` |
| `research-log-append.ts` already derives an MCP schema enum from `VALIDATOR_ENUMS` rather than hand-typing it — the pattern this tool's `SUPPORTED_SITES` follows | `packages/engine/mcp-server/src/tools/research-log-append.ts`, `EXTERNAL_SITE_VALUES` |

Facts about SKILL.md prose that **this same PR deletes** — cited without a
line number, since one would be wrong the moment the PR merges and the file
renumbers: the seven site-wide templates, the `start_date`/`end_date` pair as
shipped, the `sid`-prohibition sentence, and the Case A "append with `&`
instead of `?`" instruction all existed in SKILL.md before this PR and are
gone after it, superseded by this tool. Anyone wanting the exact prior
wording can read the PR's diff; a citation into a file this PR itself
rewrites is not durable evidence.

---

## 3. The tool

```typescript
build_external_search_url({
  site: "ancestry" | "myheritage" | "findmypast" | "findagrave" | "newspapers"
      | "chronicling_america" | "digital_newspaper_archive" | "archives_gov"
      | "archive_org" | "billiongraves" | "digitalarkivet" | "antenati"
      | "library_archives_canada" | "american_ancestors" | "italian_genealogy",

  // A FamilySearch-curated collection link (SKILL.md Case A, :258-277). When
  // present, attributes are appended onto it rather than a fresh site-wide
  // search (Case B). REQUIRED for `digital_newspaper_archive` (§3.3).
  baseUrl?: string,

  // Country-domain variant for `ancestry`/`findmypast` only (§3.9).
  locale?: "us" | "uk",

  attributes: {
    givenName?: string,
    surname?: string,
    birthYear?: number,
    birthPlace?: string,
    deathYear?: number,
    deathPlace?: string,
    marriageYear?: number,
    marriagePlace?: string,
    residenceYear?: number,
    residencePlace?: string,
    fatherGivenName?: string,
    fatherSurname?: string,
    motherGivenName?: string,
    motherSurname?: string,
    spouseGivenName?: string,
    spouseSurname?: string,

    // FindMyPast-only tuning knobs (its own template's `{plus_minus_years}`/`{miles}` slots)
    birthYearOffset?: number,      // yearofbirth_offset
    placeProximityMiles?: number,  // keywordsplace_proximity
    eventYear?: number,            // FindMyPast's generic eventyear slot, for a
                                    // search whose target event isn't birth

    // Free-text terms appended alongside the name. Only read by the three
    // sites whose site-wide search is a single free-text query field rather
    // than structured name parameters — see §3.5.
    keywords?: string,

    // Newspapers.com's generic date-range/place slots (no single named event
    // fits a newspaper search — it could be a birth, marriage, or death notice)
    searchYear?: string,           // dr_year — a plain year OR a hyphenated range
    searchPlace?: string,          // dr_place

    // Chronicling America's date window and state
    searchStartYear?: number,      // dates= lower bound
    searchEndYear?: number,        // dates= upper bound
    usState?: string,              // location_state (lowercased by the tool)
  },
})
```

### 3.1 Return value

```typescript
{ ok: true, url: string, notes: string[], access: "free" | "free_bot_protected" | "subscription" }
| { ok: false, reason: "unsupported_site", errors: string[], supportedSites: string[] }
| { ok: false, reason: "base_url_required", errors: string[] }
| { ok: false, reason: "no_attributes", errors: string[] }
```

`notes` carries non-fatal observations the caller should narrate:

- A FindMyPast call with no `eventYear` and no `birthYear` still produces a
  URL (the name/place alone are a legitimate broad search) but is silently
  under-scoped, so the tool notes it rather than treating it as an error.
- **A supplied attribute the target site's mapping never reads** — e.g.
  `deathYear` passed to `chronicling_america`, which has no death slot — is
  named in a note (`"'deathYear' is not used by chronicling_america —
  supplied but ignored"`) rather than silently vanishing. Without this, a
  caller could believe a death event scoped a search that actually ran
  whole-corpus and undated, with nothing in the response saying so.
- **`american_ancestors` always carries a note** that a subscription may
  still be required to view full results, even though `access` reports
  `"free"` — the search itself has no paywall, but the 3-value `access` enum
  alone can't express "free to search, may gate the results," so the nuance
  travels as a note instead.

`access` classifies the target site's own barrier to entry — `"free"` (no
barrier), `"free_bot_protected"` (free, but bot protection blocks an
automated fetch — narrate a blocked capture as expected, not as a negative
result), or `"subscription"` (the user needs their own access; see SKILL.md's
subscription table for which `researcher_profile.subscriptions` value covers
which site). This is a fixed per-site classification, not derived from
`attributes` — it exists so the caller reads it from the tool's own output
rather than from memory of a written list, which is exactly how a real alpha
tester was told FindAGrave needs a subscription (it's free) — SKILL.md `main`
already said "free" three times over, and the model contradicted its own
skill anyway when the fact lived only in prose it had to recall correctly.

### 3.2 Case A vs Case B (`baseUrl`)

When `baseUrl` is present, the tool appends the site's own query parameters
onto it — `&` if the base URL already carries a query string, `?` if not —
instead of building a fresh site-wide URL. **The tool strips any existing
`sid` parameter from `baseUrl` before appending**, matched
case-insensitively (`sid`/`SID`/`Sid` are all the same browser-injected
token) — the one documented case of a stray parameter that must never
survive into a presented URL.

The append is done on raw substrings, not by parsing `baseUrl` through
`URLSearchParams`, for three reasons a first draft got wrong (all caught in
review, all covered by a test in `tests/tools/build-external-search-url.test.ts`):

- **A `#fragment` must not swallow the appended query.** `…/search#facets`
  appended naively became `…/search#facets?q=…` — everything after `#` is
  fragment as far as a browser is concerned, so the query was never actually
  sent. The tool splits the fragment off first and reattaches it after the
  query.
- **An existing query is never re-parsed or re-split**, so a value already
  containing a literal `?` (`?a=1?b=2`) is preserved whole rather than having
  its second half silently dropped.
- **An existing value is never re-encoded, and a valueless flag stays
  valueless.** Routing the existing query through `URLSearchParams` decodes
  and re-encodes every value (an existing `Smith%2C%20John` came back as the
  equivalent but different-looking `Smith%2C+John`) and turns a bare flag
  parameter (`?flag`) into `flag=` — both are real changes to `baseUrl`'s own
  bytes that the spec's "does not otherwise alter" guarantee, below, forbids.

Beyond that stripping, the tool does **not** otherwise alter `baseUrl`'s
existing query string: a curated link's own collection-scoping parameters
(if any) are the caller's evidence, not the tool's to second-guess. **Each
site's fixed parameters (§3.4) are applied whether or not `baseUrl` is
given** — a first draft applied them only on the site-wide branch, which
silently dropped Chronicling America's required `dl=page` and MyHeritage's
`action=query` on exactly the curated-link path SKILL.md's Case A uses first.

### 3.3 `digital_newspaper_archive` requires `baseUrl`

Unlike the other six sites, `digital_newspaper_archive` has no fixed
site-wide URL — it is an open bucket for whichever state/regional free
archive applies to the place being researched (Utah Digital Newspapers,
California Digital Newspaper Collection, …), and "which one is identified by
`url_generated`, not by a per-state enum value"
(`research-schema-spec.md:452`). A single hard-coded URL would be wrong for
every place but the one it names. So for this site, `baseUrl` — the specific
archive's own search endpoint, from `locality-guide` output or a curated
link — is **required**, and the tool appends `q=<given>[+<surname>][+<keywords>]`
(space-joined, form-encoded as `+` — see §3.6). Omitting `baseUrl` for this
site returns `{ ok: false, reason: "base_url_required" }` rather than
fabricating a site-wide URL.

### 3.4 Fixed parameters

Two sites carry a parameter with no attribute behind it at all, applied on
every call regardless of `baseUrl` (§3.2):

| Site | Fixed parameter | Why |
|------|-----------------|-----|
| `myheritage` | `action=query` | Required for the site-wide search form; harmless on a curated link |
| `chronicling_america` | `dl=page` | Required — without it the search returns newspaper *titles* from the U.S. Newspaper Directory, not digitised pages |

### 3.5 Free-text `keywords`

`givenName`/`surname` alone cannot express what the original prose could —
a record-type hint ("obituary"), a nickname, or an exact phrase. `keywords`
restores that for the three sites whose site-wide search is a single
free-text field rather than structured name parameters: `newspapers`
(`query`), `chronicling_america` (`q`), `digital_newspaper_archive` (`q`).
It is appended after the name, space-joined like the name itself. A caller
wanting an exact-phrase match includes its own quote marks in `keywords`
(e.g. `'"Patrick Flynn"'`); the tool does not add or strip quoting, only
templates and encodes whatever string it is given. `keywords` is not a
recognized attribute for the four structured-name sites (`ancestry`,
`myheritage`, `findmypast`, `findagrave`) — supplying it there produces the
"not used by `<site>`" note (§3.1) rather than being silently absorbed
somewhere unexpected.

### 3.6 Encoding: space becomes `+`, not `%20` or a literal plus

Every value is encoded the way a browser's own search form submits one
(`application/x-www-form-urlencoded`): a space becomes `+`; everything else
is percent-encoded normally. This matters specifically for the sites whose
name is joined with a separator meant to render as a space —
`newspapers`/`chronicling_america`/`digital_newspaper_archive`'s query
fields. A first draft joined `givenName`/`surname` with a literal `+`
character and then ran the whole value through `encodeURIComponent`, which
escapes `+` to `%2B` — sending the receiving site a literal plus sign, not a
space between two words. The fix joins with a real space and lets the
encoding step turn it into `+`, so `"Patrick" + "Flynn"` becomes
`Patrick+Flynn` on the wire, not `Patrick%2BFlynn`. Structured-field sites
(`ancestry`'s underscore-joined `name=`, etc.) are unaffected — `_` needs no
escaping either way.

### 3.7 Numbers and empty strings

Every numeric attribute must be a finite integer in `[0, 9999]` — a
genealogy year is always a small positive integer, and this single check
rejects `NaN`, `Infinity`, scientific-notation nonsense (`1e21`), and
fractional years (`1845.7`) in one place rather than letting any of them
reach the URL as a literal string. An empty string (`""`) is treated
identically to an absent attribute throughout — `attributes: { birthPlace:
"" }` must not produce `birthplace=`, and must not defeat a documented
fallback: `findagrave`'s `location` falls back from `deathPlace` to
`birthPlace` only when `deathPlace` is genuinely absent, empty string
included (a first draft's `??` fallback only triggered on `null`/`undefined`,
so `deathPlace: ""` produced `location=` instead of falling through).

### 3.8 Unsupported site

A `site` value outside the supported set (whether a genuinely new site or a
free-text value the model invented) returns
`{ ok: false, reason: "unsupported_site", supportedSites: [...] }` naming the
supported values — never an invented URL. The MCP `inputSchema` also
enforces this as a closed enum, so this branch is reached only via the
exported function's non-enum-guarded call path (mirroring
`convert_calendar`'s `quakerMonth.era` guard).

### 3.9 Locale variants (`ancestry.co.uk`, `findmypast.co.uk`)

An optional top-level `locale: "us" | "uk"` (default `"us"`) selects the
country-domain variant for `ancestry` and `findmypast` — the issue's own
instruction is to handle these as a host argument on the existing entry, not
a duplicate site/parameter table, since both `.co.uk` domains were confirmed
to use the identical path and parameter names as their `.com` counterparts
(§9). `locale` only affects the Case B site-wide fallback — a supplied
`baseUrl` already names its own host and is used as-is regardless of
`locale`. Requesting `locale: "uk"` for a site with no UK variant is noted
(`notes: [...]`) rather than silently ignored.

### 3.10 Sites named in the launch scope with no template

Six of the fourteen sites named in the launch-scope table (§4) got no
template — each for a reason live research could not resolve, not an
oversight:

| Site | Why it has no template |
|------|------------------------|
| `byu.edu` | No verifiable structured search endpoint found behind the domain — a public search form posts to a dead-end redirect, and the only working query interface found is an undocumented, per-collection internal API with no way to confirm it is even the resource the wiki corpus's links point at |
| `nyu.edu` | Same: no confirmed genealogy-shaped structured search; the one plausible candidate (a library finding-aid search) is free-text-and-facets, not a name/date/place search, and could not be fetched at all (WAF-blocked) |
| `usgwarchives.net` | Unreachable from every network vantage point tried during verification (direct fetch and an independent third-party fetch proxy both timed out; a public uptime monitor independently reports it down). Even the last-known-good archived version of the site had only free-text per-state search, no structured fields |
| `uscis.gov` | Its one live endpoint (`genealogy.uscis.dhs.gov`) is a paid index-search **order** form, not a query interface — results come back as a mailed/emailed letter, not a results page |
| `italianparishrecords.org` | A pure browse-by-region directory (region → province → municipality → parish) — no search form, text input, or query string exists at any level |
| `genealogycenter.info` | Live-verified as **POST-only**, not merely unconfirmed: its two top-level entry points (`results_gensurnames.php`, the surname file; `results_allsite.php`, the cross-database search) return byte-identical results for a real surname, no surname, and a nonsense surname supplied via GET query string — the same silently-ignored-parameter defect class as the FindAGrave fix (§4), confirmed live rather than assumed. One of the site's dozens of independent sub-databases (`results_mid90s.php?acsurname=`) does genuinely filter via a GET parameter, but that naming is specific to that one narrow dataset and does not generalize to a site-wide contract |

A site with no verifiable parameterized search gets the "not supported"
return, named — never an invented template. This list is not necessarily
permanent: `usgwarchives.net`'s unreachability and `byu.edu`/`nyu.edu`'s
ambiguous target endpoint are both re-checkable, and a future correction
follows the same one-edit-site path any other parameter correction does
(§4, §9).

---

## 4. Per-site parameter tables (the ported prose)

Each site's table below is a straight port of the site-wide templates this
tool replaces, applying the corrections named in §1 where noted. The tables
live in code (`siteWideParams` in `build-external-search-url.ts`), not only
here — this section documents the same mapping the implementation embeds.

| Site | Base URL (Case B) | Fixed params | Parameters |
|------|--------------------|--------------|------------|
| `ancestry` | `https://www.ancestry.com/search/` | — | `name` (`givenName`_`surname`), `birth` (`birthYear`), `birthplace` (`birthPlace`), `death` (`deathYear`), `deathplace` (`deathPlace`), `marriage` (`marriageYear`), `residence` (`residenceYear`_`residencePlace`), `father`/`mother`/`spouse` (`{given}_{surname}` per relative) |
| `myheritage` | `https://www.myheritage.com/research` | `action=query` | `first`, `last`, `birth_year`, `birth_place`, `marriage_year`, `marriage_place`, `death_year`, `death_place`, `father_first`, `father_last`, `mother_first`, `mother_last` |
| `findmypast` | `https://www.findmypast.com/search/results` | — | `firstname`, `lastname`, `yearofbirth` (`birthYear`), `yearofbirth_offset` (`birthYearOffset`), `keywordsplace` (`birthPlace`), `keywordsplace_proximity` (`placeProximityMiles`), `eventyear` (`eventYear`), `fatherfirstname`, `motherfirstname` — ported exactly: the template names only `fatherfirstname`/`motherfirstname`, no `*lastname` counterpart |
| `findagrave` | `https://www.findagrave.com/memorial/search` | — | `firstname`, `lastname`, `birthyear` (`birthYear`), `deathyear` (`deathYear`). No place parameter — **removed by live verification**: `location` is a free-text autocomplete box whose real filter keys off a hidden `locationId` resolved from a dropdown, not the text itself; four different `location=` values (absent, a real place, a nonsense string, and the exact address copied from a matching result) all returned byte-identical result sets |
| `newspapers` | `https://www.newspapers.com/search/` | — | `query` (`givenName`+`surname`+`keywords`, space-joined), `dr_year` (`searchYear` — a year or a range, passed through unparsed), `dr_place` (`searchPlace`) |
| `chronicling_america` | `https://www.loc.gov/collections/chronicling-america/` | `dl=page` (required — without it the search returns newspaper titles, not digitised pages) | `q` (`givenName`+`surname`+`keywords`, space-joined — **correction #2**: the site-wide template's `qs` is dead, `q` is what filters, §9) , `dates` (`searchStartYear`/`searchEndYear` → **`YYYY/YYYY`, correction #1** — not `start_date`/`end_date`), `location_state` (`usState`, lowercased) |
| `digital_newspaper_archive` | none — `baseUrl` required (§3.3) | — | `q` (`givenName`+`surname`+`keywords`, space-joined) |
| `archives_gov` | `https://catalog.archives.gov/search` | `dataSource=authority`, `availableOnline=false` (scopes to person/org name-authority records; without them the same `personOrOrg` field is read by the archival-description search instead) | `personOrOrg` (`givenName`+`surname`, space-joined), `q` (`keywords` only — free text, not the name), `geographicReference` (`birthPlace`, falling back to `deathPlace`) |
| `archive_org` | `https://archive.org/search` | — | `query` (`givenName`+`surname`+`keywords`, space-joined). No structured date/place fields — Dublin-Core metadata (creator/date/subject/title), not a vital-records schema |
| `billiongraves` | `https://billiongraves.com/search/results` | — | `GivenNames`, `FamilyName`, `EventBirthYear` (`birthYear`), `EventDeathYear` (`deathYear`). No place field exists on this site's form |
| `digitalarkivet` | `https://www.digitalarkivet.no/en/search/persons/advanced` | — | `firstname`, `lastname`, `birth_year_from`/`birth_year_to` (both set to `birthYear` — a range field, no separate single-year input), `birth_place` (`birthPlace`), `domicile` (`residencePlace` — the site's own name for a residence field, not birth or death) |
| `antenati` | `https://antenati.cultura.gov.it/search-nominative/` | — | `nome` (`givenName`), `cognome` (`surname`), `anno` (`birthYear`, falling back to `deathYear` — one year field for whichever civil/parish act matched; no verified way to also select which act type the year scopes to), `localita` (`birthPlace`, falling back to `deathPlace`) |
| `library_archives_canada` | `https://recherche-collection-search.bac-lac.gc.ca/eng/Home/Result` | `DataSource=Genealogy\|Census`, `ST=SCTB` (required by the search form's own client JS to select the census/genealogy dataset before the results redirect) | `FirstName`, `LastName`, `YearOfBirth` (`birthYear`). Deliberately omits `ProvinceCode`/`GenderCode`/`MaritalStatusCode` — coded `<select>` values with no verified string mapping, and no death data exists in a census (it records the living population at census time) |
| `american_ancestors` | `https://app.americanancestors.org/SearchResults/AdvancedSearch` | — | `Keywords` (`givenName`+`surname`+`keywords`, space-joined — **not** `Name.First`/`Name.Last`, confirmed non-binding via round-trip GET reflection testing), `Location` (`birthPlace`, falling back to `deathPlace`), `FromYear`/`ToYear` (both set to `birthYear`) |
| `italian_genealogy` | `https://www.italiangenealogy.com/forum/search` | `terms=all`, `sf=all`, `sr=posts` (the exact fields present on the one confirmed-working search URL — omitting them was not tested) | `keywords` (`givenName`+`surname`+`keywords`, space-joined). A phpBB forum, not a records database — no structured name/date/place fields exist anywhere on the site |

**Why `keywordsplace` defaults to `birthPlace` and `eventyear` is generic.**
FindMyPast's template pairs `yearofbirth`/`yearofbirth_offset` with
`keywordsplace`/`keywordsplace_proximity` immediately after it — the eval
corpus's one FindMyPast test (`ut_search_external_sites_004`) confirms this
reading, filling `keywordsplace` from the birth place. `eventyear` has no
such pairing and no natural default, so it stays a generic field the caller
sets explicitly for a FindMyPast search targeting a different event (a
marriage or death search) — preserving the "the LLM decides which event the
search targets" judgment rather than the tool guessing.

**Why Newspapers.com's `dr_year`/`dr_place` are generic, not birth-specific.**
A newspaper search can target any event (birth announcement, marriage
notice, obituary) — SKILL.md's own obituary test
(`ut_search_external_sites_006`) fills this pair from the *death* window, not
birth. The tool does not guess which event a newspaper search targets; the
caller passes whatever year/place fits, and — per the same test's review
finding — the caller may pass a range string rather than a single year when
the exact year isn't known.

**Death/marriage fields on Ancestry.** The tool's `ancestry` case includes
`death`/`deathplace`/`marriage` as documented parameters, ported from the
original SKILL.md template's bullet notes rather than only its single
illustrative example URL (which showed `birth`/`birthplace`/`residence`/
`father`/`mother`/`spouse` alone). No `marriageplace` parameter was ever
documented for Ancestry, so none is ported — inventing one would not be a
faithful port.

### 4.1 Access classification per site

The static `access` value each site returns (§3.1) — `digital_newspaper_archive`
inherits the classification of whichever archive `baseUrl` points at, so it is
listed here as the same `"free_bot_protected"` state-archive sites carry
generally, not verified per archive:

| Site | `access` |
|------|----------|
| `ancestry`, `myheritage`, `findmypast`, `newspapers` | `subscription` |
| `chronicling_america`, `digital_newspaper_archive` | `free_bot_protected` |
| `findagrave`, `archives_gov`, `archive_org`, `billiongraves`, `digitalarkivet`, `antenati`, `library_archives_canada`, `american_ancestors`, `italian_genealogy` | `free` |

---

## 5. Errors / edge cases

| Condition | Behavior |
|-----------|----------|
| `site` outside the supported values | `{ ok: false, reason: "unsupported_site", supportedSites: [...] }` |
| `site: "digital_newspaper_archive"` with no `baseUrl` | `{ ok: false, reason: "base_url_required" }` |
| `attributes` has no field the target site uses at all (e.g. `site: "ancestry"` with only `eventYear` set) | `{ ok: false, reason: "no_attributes", errors: [...] }` — an empty search is not a URL worth presenting |
| `attributes` has fields but every one is an empty string | same as above — empty string never counts as a supplied value (§3.7) |
| `baseUrl` carries an existing `sid` parameter (any case) | stripped before appending; not an error |
| `baseUrl` carries a `#fragment` | the appended query lands before it; the fragment is preserved at the end of the URL |
| A numeric attribute is `NaN`/`Infinity`/out of `[0, 9999]`/non-integer | treated as absent, not stringified into the URL |
| FindMyPast call with name/place but no `birthYear`/`eventYear` | succeeds; `notes` flags the search as unscoped by year |
| A supplied attribute the target site doesn't read (e.g. `keywords` on `ancestry`) | succeeds; `notes` flags the attribute as unused |
| Any relative-name field given with only given-name or only surname (e.g. `fatherGivenName` but no `fatherSurname`) | the joined value uses whichever half is present — not an error |

---

## 6. Non-goals / persistence

- **Writes nothing.** Like `convert_calendar`, output-only — no
  `research.json` or `tree.gedcomx.json` access. The skill still owns
  writing the `external_site` log entry (SKILL.md `:382-395`); the tool
  returns only the URL string.
- **Does not decide which event a search targets, or resolve `conflicts[]`.**
  Those are the skill's judgments (SKILL.md `:318-337`) — the tool receives
  already-decided attribute values and templates them.
- **Does not fetch or validate that the URL resolves, or that `site` and
  `baseUrl` agree.** Pure string construction; no network (§9). A caller
  could in principle pass `site: "myheritage"` with an Ancestry `baseUrl` and
  get a URL mixing both sites' conventions — matching the curated link to the
  requested site is left to the skill's own judgment (SKILL.md's Case A
  matching step), not enforced here as a code check.
- **A future addition to the launch-scope list follows the same path.** The
  per-site table in §4 is additive, so a new site (or a re-check of one of
  the six in §3.10) extends it without touching this spec's existing rows.

---

## 7. Test plan (vitest)

- **One passing case per site** — the fifteen rows in §4, each producing the
  documented parameter names with the correct join/encoding.
- **Chronicling America's corrections** — `dates=YYYY/YYYY` (never
  `start_date`/`end_date`), and `q` (never `qs`).
- **`keywords`** — appended on the three free-text sites; produces a "not
  used" note on a structured-name site; an exact quoted phrase survives
  encoding unmangled.
- **`searchYear` accepts a range** — a hyphenated string passes through
  unparsed.
- **`sid` is never emitted** — no per-site table includes it, a `baseUrl`
  carrying `?sid=abc123&foo=bar` has `sid` stripped but `foo` preserved, and
  the strip is case-insensitive (`SID`, `Sid`).
- **`baseUrl` append edge cases** — both join characters (`?`/`&`); a
  `#fragment` is preserved after the appended query, not before it; an
  existing query containing a literal `?` is preserved whole; an
  already-encoded existing value is not re-encoded; a valueless flag
  parameter (`?flag`) survives without gaining a spurious `=`; the site's
  fixed parameters (§3.4) are applied even when `baseUrl` is given.
- **`digital_newspaper_archive`** — `baseUrl` required; omitting it is
  `base_url_required`; with it, only `q=<given>+<surname>[+<keywords>]` is
  appended, and a facet/date parameter is never invented even if
  `attributes` supplies `searchStartYear`/`usState`.
- **Unsupported site** — `supportedSites` names exactly the fifteen supported
  sites.
- **`no_attributes`** — a site with every one of its own parameters absent
  (or present only as empty strings) is rejected rather than returning a
  bare site URL.
- **Empty strings and non-finite numbers** — an empty `birthPlace` does not
  reach the URL; an empty `deathPlace` still falls through to `birthPlace`
  on `findagrave`; `NaN`/`Infinity`/`1e21`/`1845.7` are all rejected.
- **Unused-attribute notes** — a supplied attribute the target site doesn't
  read produces a note naming it; an attribute the site does read produces
  no such note.
- **Relative names, partial** — only `fatherGivenName` set still produces a
  `father`/`father_first` value from that half alone.
- **`access` classification** — every supported site returns the value in
  §4.1's table; `american_ancestors` returns `"free"` and still carries the
  results-viewing note; `digital_newspaper_archive` returns
  `"free_bot_protected"` regardless of which archive `baseUrl` names.

---

## 8. Wiring

Standard MCP tool: implementation in
`src/tools/build-external-search-url.ts`, schema added to `allToolSchemas` in
`src/tool-schemas.ts`, dispatch in `src/index.ts`, name in `manifest.json`'s
`tools` array, `README.md` tool table row (and its tool-count line — 49).
Signals its one failure mode by returning `ok: false`, so it is listed in
`tool-result.ts`'s `OK_FALSE_IS_FAILURE`. camelCase at the boundary; no
persisted output so no snake_case rename applies.

`SUPPORTED_SITES` (and the `site` enum in the MCP schema) is **derived from
`Object.keys(SITE_BASE_URL)`** (plus `digital_newspaper_archive`, handled
separately since it has no fixed base URL) — deliberately **not** from the
shared `VALIDATOR_ENUMS.external_site` enum in `src/validation/validator.ts`,
even though that enum is the closed list `research_log_append` validates
persisted `site` values against. An early draft derived `SUPPORTED_SITES`
from the enum directly; the enum reserves room for launch-scope sites this
tool has no `siteWideParams` case for yet (§3.10), so a site valid under the
enum but unimplemented here passed the `isSupportedSite` guard and then
crashed on `Object.values(undefined)` the first time `siteWideParams`'s
switch fell through with no matching case — reproduced by appending a site to
the enum with no matching implementation. `SITE_BASE_URL` is a `Record` typed
with exactly the switch's implemented keys, so `Object.keys` of it can never
diverge from what `siteWideParams` actually handles; a test asserts
`SUPPORTED_SITES` stays a subset of `VALIDATOR_ENUMS.external_site` (catching
a spelling drift) without reintroducing the crash risk. `Object.keys(...)` is
an identifier expression, not a hand-typed string-literal array, so
`tests/packaging/tool-schema-enums.test.ts`'s literal-array scan (which
flags a near-miss hand-typed copy of a closed enum) does not flag this
derivation.

Eval harness: registered as a `LIVE_TOOL` in `mock_mcp.py` (calling the
compiled `build/**` output directly, same as `convert_calendar`) rather than
fixture-mocked — a canned fixture would supply the exact URL string the eval
exists to measure. `check_tool_coverage.py`'s `EXEMPT_TOOLS` carries the same
justification `convert_calendar` does.

---

## 9. What nothing checks

**No unit test, and no CI job, confirms a parameter name actually binds at
the live site.** A vitest case asserts the tool's own constant against
itself — it would pass identically whether `q` or `qs` were the real
Chronicling America parameter. That is exactly how the dead `qs` shipped
through the initial version of this same PR: `qs` was carried over from the
pre-existing SKILL.md template, the earlier live measurement behind
correction #1 (§1) held the search term fixed while varying only the date
parameters, and so never exercised `qs` itself. Every one of this tool's
other six parameter tables carries the identical, unaddressed risk — they
are unverified ports of prose that was itself never mechanically checked
against the live sites.

**The one live check this PR does record**, from review (2026-09-09), against
the exact URL shape `chronicling_america`'s Case B branch builds:

```
qs=Patrick%2BFlynn -> of = 6,950,625   (same as no term parameter at all)
q=zzzqqqxyzzz      -> of = 0            (a nonsense term returns zero — q filters)
qs=zzzqqqxyzzz     -> of = 6,950,625   (a nonsense term returns everything — qs does not)
```

`qs` returns the same corpus total regardless of what it's set to; `q` does
not. This is why §4's table now emits `q`. This check was not independently
re-run while implementing the fix — loc.gov's bot protection (SKILL.md's own
"Bot-protected — capture required" note) returns a Cloudflare challenge page
to a non-browser client, which is what a direct request from this
environment received when re-verification was attempted. The measurement
above is taken on trust from the reviewer's own reported numbers, not
independently reproduced here; if it is ever wrong, the fix is the same
one-line change back, at the same single edit site.

**A second, independent attempt to re-verify (review round 2, same day) hit
the same Cloudflare wall.** So the claim now rests on exactly one live
measurement, by one person, made once, and two separate later attempts by
two different parties to check it independently were both blocked by the
same bot protection this correction exists to work around. That is not
weaker evidence than it was — the original measurement is unchanged — but it
means "confirmed" would overstate it: nobody but the original reviewer has
ever seen `q` bind and `qs` fail to, and if that one measurement is wrong,
this tool, its spec, the skill, a test fixture, and committed run logs all
now encode the same error. Treat any future re-measurement (by someone with
a working browser session against loc.gov) as the first independent check
this claim has ever had.

Any future correction to a parameter name discovered the same way — by
someone with a real browser and reproducible counts, not by re-reading
SKILL.md more carefully — should be recorded here the same way: the
measurement, the date, and which of the two nonsense-value checks a false
positive would need to fail.

## 10. Live checks for the eight launch-scope sites and the FindAGrave fix (2026-09-11)

Each of the eight sites added to the launch-scope table (§4) was checked
live before being written into the tool, at one of two confidence levels —
recorded honestly per site rather than uniformly, since they were not all
verified the same way.

**Full end-to-end verification (parameter names AND real, filtered matching
results confirmed):**

- **`digitalarkivet`** — `?firstname=Ole&lastname=Hansen&birth_year_from=1850&birth_year_to=1860`
  returned a real results page ("Your search resulted in 10,000 hits") with
  working pagination echoing the same parameter names back.
- **`antenati`** — `?cognome=Strada&nome=Giovanni&anno=1850&localita=Milano`
  returned "Pagina 1 di 175" with live faceted given-name/surname data. The
  four candidate range-parameter spellings tried (`anno_da`/`anno_a`,
  `dal`/`al`, `dataDa`/`dataA`, `from`/`to`) were tested and confirmed to have
  **no effect** — only the single `anno` field works, which is why the table
  has no separate year-range input.
- **`italian_genealogy`** — `?keywords=Rossi&terms=all&sf=all&sr=posts`
  returned "Search found 858 match(es)" against the live forum.
- **`archive_org`** — `advancedsearch.php?q=creator:(Mark+Twain)+AND+date:[1870-01-01+TO+1885-12-31]&output=json`
  returned only correctly-dated matches; a genealogy-relevant query
  (`q=subject:(genealogy)+AND+title:(Smith family)`) returned genuinely
  on-target family-history book titles. The bare UI path (`archive.org/search?query=`)
  is confirmed as the real parameter name via its being the actual redirect
  target of the legacy `search.php?query=` URL, though its own rendering
  could not be directly confirmed (client-rendered SPA) — the tool builds the
  UI path (§4), not the verified JSON API path, since the skill hands a
  human a browsable link.
- **`ancestry` (`locale: "uk"`)** — `ancestry.co.uk/search/?name=John_Smith`
  returned a real results page (title `John Smith - Ancestry.com`, hundreds
  of on-target name occurrences); `name`, `birth`, `birthplace`, `death`,
  `deathplace`, `marriage`, `father`, `mother`, `spouse` were each confirmed
  individually to survive the domain's redirect/canonicalization, with
  near-identical result counts to the same query against `ancestry.com`.

**Parameter names confirmed from the site's own live form or shipped
production JavaScript, but end-to-end result filtering NOT independently
confirmed** (each is a client-rendered app that a non-browser fetch cannot
exercise past the page shell):

- **`archives_gov`** — `personOrOrg`, `q`, `geographicReference`, and the
  `dataSource`/`availableOnline` fixed params are the field ids the National
  Archives Catalog's own currently-shipping JS bundle wires into its query
  string (read directly from the production bundle, not guessed).
- **`billiongraves`** — `GivenNames`, `FamilyName`, `EventBirthYear`,
  `EventDeathYear` are confirmed two ways: the live form's own `<input
  name=...>` attributes, and the exact submit-handler object decompiled from
  the site's own shipped JS. No place field exists on this form at all.
- **`library_archives_canada`** — `FirstName`, `LastName`, `YearOfBirth`,
  and the required `DataSource`/`ST` fixed params were read directly out of
  the search form's own shipped JavaScript (`fnResultRedirect()`), which
  names the exact results-endpoint URL and field set. The results endpoint
  itself returned a Cloudflare JS challenge to every non-browser request
  tried, so the live-filtering step is unconfirmed.
- **`findmypast` (`locale: "uk"`)** — both `findmypast.com` and
  `findmypast.co.uk` returned identical Cloudflare challenges to every direct
  fetch attempt, so neither could be checked by fetching a live results page.
  Instead, Google's search index was checked for real, previously-crawled
  production URLs on the `.co.uk` domain itself — several were found using
  `firstname`, `lastname`, `firstname_variants`, `yearofbirth`,
  `yearofbirth_offset`, `keywordsplace` at the same `/search/results` path
  this tool already uses for `.com`. `fatherfirstname`, `motherfirstname`,
  and `keywordsplace_proximity` did not happen to appear in any crawled URL
  found this way — carried over from the `.com` table on the strength of
  every other field matching, not independently confirmed on `.co.uk`.

**A field confirmed NOT to bind, so it was excluded rather than shipped as a
silent no-op** (this is the `american_ancestors` `Keywords`-instead-of-`Name.First`/
`Name.Last` decision in §4): a GET request's `Name.First=John&Name.Last=Smith`
was round-tripped and checked against the search form's own `value=`
reflection in the response — it came back blank in every encoding tried
(dotted, bracketed, bare), while `FromYear`, `ToYear`, `Location`, and
`Keywords` all correctly reflected the values passed. A raw POST with the
same field names produced the same blank-form result. This is the same
failure class as the FindAGrave `location` fix below: a field that looks
right and is silently ignored by the live site.

**The FindAGrave `location` fix (§4).** `firstname`, `lastname`, `birthyear`,
`deathyear` were reconfirmed live and are exact-match filters — a
nonsense-lastname test returned zero results against a real-name test's 20,
and every one of 20 same-query results carried exactly the requested birth
and death years. `location`, by contrast, produced **byte-identical** result
sets (same 20 memorial IDs, same order) across four different values: no
`location` at all, a real place name, a nonsense string, and the exact
address copied verbatim from one of the actual matching results. The
rendered page's own markup explains why: the visible `location` input pairs
with a separate hidden `locationId` field that a client-side dropdown
widget — not the free-text box — actually populates, so a bare place-name
string submitted via URL has no path to the real filter. Removed rather than
kept with a caveat, since a parameter confirmed to do nothing is worse than
one merely unverified.

**Not attempted for any of the above:** re-running any check a second time,
or from a different network/IP to rule out this environment's own network
conditions as a confound (relevant specifically to the sites blocked by
Cloudflare/WAF challenges here). Each site above is one measurement, by one
session, on one day (2026-09-11) — the same evidentiary caveat §9 already
states for Chronicling America applies identically to all of these.
