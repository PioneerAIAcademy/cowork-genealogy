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

A pure, offline tool that builds a pre-filled search URL for one of seven
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
      | "chronicling_america" | "digital_newspaper_archive",

  // A FamilySearch-curated collection link (SKILL.md Case A, :258-277). When
  // present, attributes are appended onto it rather than a fresh site-wide
  // search (Case B). REQUIRED for `digital_newspaper_archive` (§3.3).
  baseUrl?: string,

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
{ ok: true, url: string, notes: string[] }
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

A `site` value outside the seven above (whether a genuinely new site or a
free-text value the model invented) returns
`{ ok: false, reason: "unsupported_site", supportedSites: [...] }` naming the
seven supported values — never an invented URL. The MCP `inputSchema` also
enforces this as a closed enum, so this branch is reached only via the
exported function's non-enum-guarded call path (mirroring
`convert_calendar`'s `quakerMonth.era` guard).

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
| `findagrave` | `https://www.findagrave.com/memorial/search` | — | `firstname`, `lastname`, `birthyear` (`birthYear`), `deathyear` (`deathYear`), `location` (`deathPlace`, falling back to `birthPlace` when no death place is given — a grave search's most relevant place is where the person died/was buried) |
| `newspapers` | `https://www.newspapers.com/search/` | — | `query` (`givenName`+`surname`+`keywords`, space-joined), `dr_year` (`searchYear` — a year or a range, passed through unparsed), `dr_place` (`searchPlace`) |
| `chronicling_america` | `https://www.loc.gov/collections/chronicling-america/` | `dl=page` (required — without it the search returns newspaper titles, not digitised pages) | `q` (`givenName`+`surname`+`keywords`, space-joined — **correction #2**: the site-wide template's `qs` is dead, `q` is what filters, §9) , `dates` (`searchStartYear`/`searchEndYear` → **`YYYY/YYYY`, correction #1** — not `start_date`/`end_date`), `location_state` (`usState`, lowercased) |
| `digital_newspaper_archive` | none — `baseUrl` required (§3.3) | — | `q` (`givenName`+`surname`+`keywords`, space-joined) |

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

---

## 5. Errors / edge cases

| Condition | Behavior |
|-----------|----------|
| `site` outside the seven supported values | `{ ok: false, reason: "unsupported_site", supportedSites: [...] }` |
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
- **Fourteen new sites and two locale variants are out of scope for this
  tool's first version** — their parameter tables depend on live example
  URLs from a teammate not obtainable in this PR; the per-site table in §4 is
  additive, so a follow-up PR extends it without touching this spec's
  existing rows.

---

## 7. Test plan (vitest)

- **One passing case per site** — the seven rows in §4, each producing the
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
- **Unsupported site** — `supportedSites` names exactly the seven.
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

---

## 8. Wiring

Standard MCP tool: implementation in
`src/tools/build-external-search-url.ts`, schema added to `allToolSchemas` in
`src/tool-schemas.ts`, dispatch in `src/index.ts`, name in `manifest.json`'s
`tools` array, `README.md` tool table row (and its tool-count line — 49).
Signals its one failure mode by returning `ok: false`, so it is listed in
`tool-result.ts`'s `OK_FALSE_IS_FAILURE`. camelCase at the boundary; no
persisted output so no snake_case rename applies.

`SUPPORTED_SITES` (and the `site` enum in the MCP schema) is **derived** from
`VALIDATOR_ENUMS.external_site` (`src/validation/validator.ts`), filtered to
exclude `familysearch_web` — the persisted log's catch-all for a site with no
template — rather than hand-typed as a string-literal array. A hand-typed
copy is exactly what `tests/packaging/tool-schema-enums.test.ts` flags as a
near-miss of the closed `external_site` enum (it scored 0.875 on that test's
own overlap ratio in an earlier draft); deriving it is the same pattern
`research-log-append.ts` already uses for this enum, and means a future
addition to the schema surfaces here as a real site string this tool has no
template for, rather than as silent drift in a literal.

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
