# `build_external_search_url` — external-site search URL tool — Spec

> **Status:** New (2026-09-09). Migrates the deterministic URL-templating the
> `search-external-sites` skill currently performs **by hand in prose** into a
> tested MCP tool. The skill's own SKILL.md carried seven
> site-wide templates (Ancestry, MyHeritage, FindMyPast, FindAGrave,
> Newspapers.com, Chronicling America, and one state/regional digital-newspaper
> archive) as `{...}`-slot text for the model to fill in by hand. The LLM keeps
> every judgment this task requires (which record type/event the search
> targets, which curated link fits, what `conflicts[]` says about a disputed
> field); the tool does only the string-templating.

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

- **Chronicling America's shipped parameters are dead.** SKILL.md templated
  `start_date=YYYY-01-01&end_date=YYYY-12-31`; the working parameter as of
  2026-09-04/2026-09-08 is `dates=YYYY/YYYY`. The dead pair does not error —
  it is silently ignored, so a search "succeeds" unscoped and a nil result
  from it means nothing. Prose can't be re-verified except by a human
  re-reading and re-testing it; a tool's constant is a single edit site.
- **`sid` must never appear.** It's browser session state carried along in a
  copy-pasted URL, not a search parameter — the skill said "never emit" it,
  but that's a rule a model can forget mid-generation. A tool that never has
  `sid` in its per-site parameter table cannot forget.
- **Two worked examples in SKILL.md encoded a project's own rejected value.**
  Both filled `birthplace=Pennsylvania` into an illustration for the
  `mid-research-flynn` fixture, whose own `conflicts[]` entry `c_001` resolved
  that dispute *against* Pennsylvania (`preferred_assertion_id: a_002`,
  Ireland). A worked example that contradicts the fixture it illustrates
  teaches exactly the failure this skill's "check `conflicts[]` before
  encoding a place or date" rule (SKILL.md `:352-371`) exists to prevent.
- **The general risk this class of bug represents.** A hand-composed URL with
  a wrong or dead parameter name doesn't error — the site accepts it,
  ignores what it doesn't recognize, and returns an unscoped or empty result
  that reads exactly like a legitimate negative finding. That failure mode is
  invisible to every downstream consumer (`research-exhaustiveness`, the
  user) once the log entry says `outcome: "negative"`.

---

## 2. Evidence base (seen directly)

| Fact | Source |
|------|--------|
| Seven site-wide templates, not five | `packages/engine/plugin/skills/search-external-sites/SKILL.md:277-337` |
| `sid` prohibition | `SKILL.md:300` |
| Chronicling America's `start_date`/`end_date` as shipped | `SKILL.md:312-331` |
| The Case A curated-URL append contract (`?` vs `&`) | `SKILL.md:259-268` |
| The two Pennsylvania worked examples | `SKILL.md:265`, `:454` |
| `conflicts[]` c_001 rejects Pennsylvania in favor of Ireland | `eval/fixtures/scenarios/mid-research-flynn/research.json` |
| `digital_newspaper_archive` is an open bucket identified by `url_generated`, not a fixed per-state URL | `docs/specs/schemas/enums.schema.json:177-178`, `docs/specs/research-schema-spec.md:452` |
| `convert_calendar` — the architectural precedent for a pure, no-network, no-project-files tool | `packages/engine/mcp-server/src/tools/convert-calendar.ts` |

---

## 3. The tool

```typescript
build_external_search_url({
  site: "ancestry" | "myheritage" | "findmypast" | "findagrave" | "newspapers"
      | "chronicling_america" | "digital_newspaper_archive",

  // A FamilySearch-curated collection link (SKILL.md Case A). When present,
  // attributes are appended onto it rather than a fresh site-wide search
  // (Case B). REQUIRED for `digital_newspaper_archive` (§3.3).
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

    // Newspapers.com's generic date-range/place slots (no single named event
    // fits a newspaper search — it could be a birth, marriage, or death notice)
    searchYear?: number,           // dr_year
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

`notes` carries non-fatal observations the caller should narrate — e.g. a
FindMyPast call with no `eventYear` and no `birthYear` still produces a URL
(the name/place alone are a legitimate broad search) but is silently
under-scoped, so the tool notes it rather than treating it as an error.

### 3.2 Case A vs Case B (`baseUrl`)

When `baseUrl` is present, the tool appends the site's own query parameters
onto it — `&` if the base URL already carries a query string, `?` if not —
instead of building a fresh site-wide URL (SKILL.md `:259-268`). **The tool
strips any existing `sid` parameter from `baseUrl` before appending** — the
one documented case of a stray parameter that must never survive into a
presented URL (SKILL.md `:300`) — but does not otherwise alter `baseUrl`'s
existing query string: a curated link's own collection-scoping parameters (if
any) are the caller's evidence, not the tool's to second-guess.

### 3.3 `digital_newspaper_archive` requires `baseUrl`

Unlike the other six sites, `digital_newspaper_archive` has no fixed
site-wide URL — it is an open bucket for whichever state/regional free
archive applies to the place being researched (Utah Digital Newspapers,
California Digital Newspaper Collection, …), and "which one is identified by
`url_generated`, not by a per-state enum value"
(`research-schema-spec.md:452`). A single hard-coded URL would be wrong for
every place but the one it names. So for this site, `baseUrl` — the specific
archive's own search endpoint, from `locality-guide` output or a curated
link — is **required**, and the tool appends only `q=<given>+<surname>`
(space-joined with `+`, matching SKILL.md's own Utah template
`q={first}+{last}` at `:336` and the same convention as Newspapers.com's
`query=` field at `:309` — **not** Ancestry's underscore-joined `name=` field
at `:279`, which is a different kind of parameter on a different site).
Omitting `baseUrl` for this site returns `{ ok: false, reason:
"base_url_required" }` rather than fabricating a site-wide URL.

### 3.4 Unsupported site

A `site` value outside the seven above (whether a genuinely new site or a
free-text value the model invented) returns
`{ ok: false, reason: "unsupported_site", supportedSites: [...] }` naming the
seven supported values — never an invented URL. The MCP `inputSchema` also
enforces this as a closed enum, so this branch is reached only via the
exported function's non-enum-guarded call path (mirroring
`convert_calendar`'s `quakerMonth.era` guard).

---

## 4. Per-site parameter tables (the ported prose)

Each site's table below is a straight port of its SKILL.md template
(`:277-337`), applying the corrections named in §1 where noted.

| Site | Base URL (Case B) | Fixed params | Parameters |
|------|--------------------|--------------|------------|
| `ancestry` | `https://www.ancestry.com/search/` | — | `name` (`givenName`_`surname`), `birth` (`birthYear`), `birthplace` (`birthPlace`), `death` (`deathYear`), `deathplace` (`deathPlace`), `marriage` (`marriageYear`), `residence` (`residenceYear`_`residencePlace`), `father`/`mother`/`spouse` (`{given}_{surname}` per relative) |
| `myheritage` | `https://www.myheritage.com/research` | `action=query` | `first`, `last`, `birth_year`, `birth_place`, `marriage_year`, `marriage_place`, `death_year`, `death_place`, `father_first`, `father_last`, `mother_first`, `mother_last` |
| `findmypast` | `https://www.findmypast.com/search/results` | — | `firstname`, `lastname`, `yearofbirth` (`birthYear`), `yearofbirth_offset` (`birthYearOffset`), `keywordsplace` (`birthPlace`), `keywordsplace_proximity` (`placeProximityMiles`), `eventyear` (`eventYear`), `fatherfirstname`, `motherfirstname` — ported exactly: the template names only `fatherfirstname`/`motherfirstname`, no `*lastname` counterpart |
| `findagrave` | `https://www.findagrave.com/memorial/search` | — | `firstname`, `lastname`, `birthyear` (`birthYear`), `deathyear` (`deathYear`), `location` (`deathPlace`, falling back to `birthPlace` when no death place is given — a grave search's most relevant place is where the person died/was buried) |
| `newspapers` | `https://www.newspapers.com/search/` | — | `query` (`givenName`+`surname`), `dr_year` (`searchYear`), `dr_place` (`searchPlace`) |
| `chronicling_america` | `https://www.loc.gov/collections/chronicling-america/` | `dl=page` (required — without it the search returns newspaper titles, not digitised pages, per `SKILL.md:316-318`) | `qs` (`givenName`+`surname`), `dates` (`searchStartYear`/`searchEndYear` → **`YYYY/YYYY`, correction #1** — not `start_date`/`end_date`), `location_state` (`usState`, lowercased) |
| `digital_newspaper_archive` | none — `baseUrl` required (§3.3) | — | `q` (`givenName`+`surname`) only |

**Why `keywordsplace` defaults to `birthPlace` and `eventyear` is generic.**
FindMyPast's template pairs `yearofbirth`/`yearofbirth_offset` with
`keywordsplace`/`keywordsplace_proximity` immediately after it — the eval
corpus's one FindMyPast test (`ut_search_external_sites_004`) confirms this
reading, filling `keywordsplace` from the birth place. `eventyear` has no
such pairing and no natural default, so it stays a generic field the caller
sets explicitly for a FindMyPast search targeting a different event (a
marriage or death search) — preserving the "the LLM decides which event the
search targets" judgment (SKILL.md `:346-348`) rather than the tool guessing.

**Why Newspapers.com's `dr_year`/`dr_place` are generic, not birth-specific.**
A newspaper search can target any event (birth announcement, marriage
notice, obituary) — SKILL.md's own obituary test
(`ut_search_external_sites_006`) fills this pair from the *death* window, not
birth. The tool does not guess which event a newspaper search targets; the
caller passes whatever year/place fits.

**Death/marriage fields on Ancestry.** The literal example URL at
`SKILL.md:279` shows only `birth`/`birthplace`/`residence`/`father`/`mother`/
`spouse`, but the accompanying bullet notes (`:281-285`) document `death`,
`deathplace`, and `marriage` as valid parameters too ("`birth`, `death`,
`marriage` — event year"; "`birthplace`, `deathplace` — location string").
The table above ports the fuller, documented set rather than only the
illustrative example. No `marriageplace` parameter is documented anywhere in
SKILL.md's Ancestry section, so none is ported — inventing one would not be a
faithful port.

---

## 5. Errors / edge cases

| Condition | Behavior |
|-----------|----------|
| `site` outside the seven supported values | `{ ok: false, reason: "unsupported_site", supportedSites: [...] }` |
| `site: "digital_newspaper_archive"` with no `baseUrl` | `{ ok: false, reason: "base_url_required" }` |
| `attributes` has no field the target site uses at all (e.g. `site: "ancestry"` with only `eventYear` set) | `{ ok: false, reason: "no_attributes", errors: [...] }` — an empty search is not a URL worth presenting |
| `baseUrl` carries an existing `sid` parameter | stripped before appending; not an error |
| FindMyPast call with name/place but no `birthYear`/`eventYear` | succeeds; `notes` flags the search as unscoped by year |
| Any relative-name field given with only given-name or only surname (e.g. `fatherGivenName` but no `fatherSurname`) | the joined value uses whichever half is present (`joinUnderscore`/`joinPlus` skip missing parts) — not an error |

---

## 6. Non-goals / persistence

- **Writes nothing.** Like `convert_calendar`, output-only — no
  `research.json` or `tree.gedcomx.json` access. The skill still owns
  writing the `external_site` log entry (SKILL.md `:411-431`); the tool
  returns only the URL string.
- **Does not decide which event a search targets, or resolve `conflicts[]`.**
  Those are the skill's judgments (SKILL.md `:352-371`) — the tool receives
  already-decided attribute values and templates them.
- **Does not fetch or validate that the URL resolves.** Pure string
  construction; no network (§ "What nothing checks" below).
- **Fourteen new sites and two locale variants are out of scope for this
  tool's first version** — their parameter tables depend on live example
  URLs from a teammate not obtainable in this PR; the per-site table in §4 is
  additive, so a follow-up PR extends it without touching this spec's
  existing rows.

---

## 7. Test plan (vitest)

- **One passing case per site** — the seven rows in §4, each producing the
  documented parameter names with `+`/`_` joins as specified.
- **Chronicling America's `dates=YYYY/YYYY`** — confirms the correction, and
  a negative case confirming `start_date`/`end_date` are never emitted.
- **`sid` is never emitted** — no per-site table includes it, and a `baseUrl`
  carrying `?sid=abc123&foo=bar` has `sid` stripped but `foo` preserved.
- **`baseUrl` append, both join characters** — a base with no existing query
  string gets `?`; one with an existing query string gets `&`.
- **`digital_newspaper_archive`** — `baseUrl` required; omitting it is
  `base_url_required`; with it, only `q=<given>+<surname>` is appended, and a
  facet/date parameter is never invented even if `attributes` supplies
  `searchStartYear`/`usState` (§3.3's "do not invent facet or date
  parameters" carry-over).
- **Unsupported site** — `supportedSites` names exactly the seven.
- **`no_attributes`** — a site with every one of its own parameters absent
  from `attributes` is rejected rather than returning a bare site URL.
- **Relative names, partial** — only `fatherGivenName` set still produces a
  `father`/`father_first` value from that half alone.

---

## 8. Wiring

Standard MCP tool: implementation in
`src/tools/build-external-search-url.ts`, schema added to `allToolSchemas` in
`src/tool-schemas.ts`, dispatch in `src/index.ts`, name in `manifest.json`'s
`tools` array, `README.md` tool table row (and its tool-count line — see PR).
Signals its one failure mode by returning `ok: false`, so it is listed in
`tool-result.ts`'s `OK_FALSE_IS_FAILURE`. camelCase at the boundary; no
persisted output so no snake_case rename applies.

Eval harness: registered as a `LIVE_TOOL` in `mock_mcp.py` (calling the
compiled `build/**` output directly, same as `convert_calendar`) rather than
fixture-mocked — a canned fixture would supply the exact URL string the eval
exists to measure. `check_tool_coverage.py`'s `EXEMPT_TOOLS` carries the same
justification `convert_calendar` does.
