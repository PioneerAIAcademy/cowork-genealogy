# ADR-0012: Read locality and record-type guidance from the FamilySearch wiki at runtime; never restate it in the plugin

> **Read before you:** write a per-country, per-state, or per-record-type rule
> into a `SKILL.md`, an agent body, or a `references/` file · author a
> "reference guide" for a country's records · add a census-year, calendar
> adoption, registration-start, or naming-convention fact to a prompt · fold a
> skill's `references/` into an agent body · notice a shipped rule assumes the
> US federal census · decide whether a passage stays in a prompt or is fetched.
>
> **This list means stop and read this file. It does not mean ask the lead.**
> The decision below already answers the common case; escalate only the residue
> the "What stays in the plugin" paragraph does not settle.

- **Status:** Accepted
- **Decided:** 2026-08-27 (issue #1967: no record-type × country tables) and
  2026-08-31 (issue #1923: the wiki is the source of truth)
- **Last updated:** 2026-09-07 (created; the two rulings had lived only in issue comments)
- **Deciders:** Dallan Quass
- **Supersedes:** —
- **Superseded by:** —
- **Applies to:** `packages/engine/plugin/skills`, `packages/engine/plugin/agents`, `packages/engine/mcp-server/src/tools/wiki-read.ts`, `packages/engine/mcp-server/src/tools/wiki-search.ts`, `packages/engine/mcp-server/src/tools/wiki-place-page.ts`, `docs/skill-to-agent-pair-conversion.md` — *linted; keep current*
- **Related:** ADR-0002 (where a capability goes), ADR-0003 (prose does not
  bind), ADR-0004 (three tool spellings), ADR-0011 (write-boundary rules);
  issues #1923, #1967, #2123, #2153, #2078, #2054, #2130, #1344, #1112

## Context

**The plugin carries a lot of this, and it is US-shaped.** A full read of all 28
`SKILL.md` files, every `references/` file, and the five agent bodies on
2026-09-07 found record-type or locality-specific instruction in 22 skills and
4 agents. The dense cases: `search-records` (a year-by-year US and England &
Wales census field table, a per-collection quirks file for US, English, Mexican,
German and Norwegian collections), `citation` (a template per record type plus
Pennsylvania's probate courts), `locality-guide` (Massachusetts registration
levels, state-land versus federal-land), `research-plan` (Danish levy rolls,
Iberian surnames), `convert-dates` (a Gregorian-adoption table down to Dutch
provinces), `translation` (per-language vocabulary and abbreviations),
`historical-context` (state formation dates, civil-registration start dates by
country, Utah), `search-full-text` (Iberian surnames, historical names of Canada
and Mexico, era-specific hands), `record-extractor` (informant tables per record
type, and census era rules stated without a jurisdiction). The US federal census
is the unstated default: the 1880 relationship column, the 1890 gap and the 1820
manifests are each restated in several files. Non-US knowledge sits in five
clusters — Scandinavian patronymics, Iberian surnames, German script, England &
Wales censuses and parishes, calendar adoption — and nothing else.

**That space does not close.** The lead's ruling on issue #1967 (2026-08-27):
roughly 200 countries × dozens of record types × several eras, every entry a
maintenance liability that goes stale silently. The same ruling names what a
reference-plus-retrieval layer *is* for: what the record in hand cannot answer —
which repository holds the originals, what years survive, where the boundaries
were.

**The reference tier is closing as a home for it.** An agent reading its own
`references/` measured 6/19 against a 12–14/19 baseline and failed silently
(CLAUDE.md, "Agent bodies are self-contained"). Every skill-agent pair
conversion deletes `references/`. `search-records` cannot be paired at all
because 87,313 of its 143,557 folded bytes are reference files (issue #2123).

**The wiki already has it, and it is reachable.** The hosted wiki-query-api
served 1,240,565 indexed chunks on 2026-09-07 (`GET /health`). Pages probed the
same day, characters of markdown returned by `GET /page/{slug}`:

| page | chars | page | chars |
|---|---:|---|---:|
| `German_Genealogical_Word_List` | 72,175 | `United_States_Census` | 33,782 |
| `Latin_Genealogical_Word_List` | 67,872 | `England_Census` | 26,351 |
| `Dutch_Genealogical_Word_List` | 60,147 | `Norway_Census` | 36,987 |
| `Julian_and_Gregorian_Calendars` | 21,657 | `Massachusetts_Vital_Records` | 43,886 |
| `France_Civil_Registration` | 29,852 | `United_States_Land_and_Property` | 21,052 |
| `Ireland_Civil_Registration` | 18,178 | `Pennsylvania_Probate_Records` | 12,145 |
| `Norway_Naming_Customs` | 23,163 | `Denmark_Military_Records` | 16,503 |
| `Spain_Naming_Customs` | 17,545 | `Germany_Handwriting` | 15,511 |

Issue #1923 probed the twelve census and church-record pages for England,
Wales, Ireland, Sweden, Norway and Denmark the same way (about 440 KB) and
found the vernacular terms — *kirkebog*, *husförhörslängd* — glossed in
English, so the guidance needs no translation. Reproduce any row from the repo
root with the URL in `DEFAULT_WIKI_API_URL` (`src/auth/config.ts`):

```sh
curl -s "$WIKI/page/Norway_Naming_Customs" | python3 -c 'import json,sys; print(len(json.load(sys.stdin)["content"]))'
```

Three tools reach it. `wiki_read` returns one whole page from a wiki URL.
`wiki_place_page` returns a place page for a `standardPlace` and one of four
sections; it has no record-type axis and cannot address county pages (issue
#2078). `wiki_search` is retrieval over chunks and returns ranked fragments.

**The wiki is not always right, and slugs are not guessable.** Issue #2123
measured the wiki's census table wrong on the 1940 supplementary sample, silent
on 1950, and silent on England & Wales where our file is right; on
`record_search` mechanics the corpus carries claims we have refuted and
contradicts itself within one result set. `Spain_Names,_Personal` is a 404
where `Spain_Naming_Customs` is 17,545 characters.

**The wiki does not carry GPS craft.** Issue #2153 measured five topic pages
(250,465 characters) for the words that carry our informant and evidence
doctrine: `informant` 2, `derivative` 0. Informant proximity per record type,
evidence classification, citation form: none of it is on the wiki.

**An instruction to fetch is not a fetch.** `gps-mentor` names the wiki tools
at five sites in its body and called neither across 91 invocations (ADR-0009,
issue #1344). `locality-guide`'s pre-work block names its wiki calls as
unconditional members of a labelled list and they run at 96–97% across 73 e2e
segments (`docs/architecture.md` §3.3, "`references/` — the fourth artifact,
duplicated on purpose"). Placement decides whether the call happens.

## Decision

The FamilySearch wiki is the source of truth for locality-specific and
record-type-specific guidance, and the plugin does not restate it. A skill or
agent that needs to know what a jurisdiction's records contain, when a
registration system began, which calendar a date was written in, or how names
were formed fetches the page at runtime and reasons from it.

Concretely:

- **Fetch by page, not by search.** `wiki_read` with the page URL when the page
  is known (`{Jurisdiction}_{Topic}` — `Denmark_Church_Records`,
  `Sweden_Naming_Customs`), `wiki_place_page` for a place's own page, and
  `wiki_search` only when the page is not known. A known page fetched through
  `wiki_search` comes back as fragments and reads as "the wiki does not have
  this." Do not wait on issue #2078; a constructed URL reaches the record-type
  pages today.
- **Route each passage in this order** (issue #2123's four routes, tool first
  per ADR-0011): into the tool, where the passage tells the model how to drive
  our own API; onto the wiki, where it is knowledge about records or places;
  folded into the body, only for craft the wiki demonstrably lacks, with the
  measurement that says so; deleted, where nothing reads it.
- **What stays in the plugin:** the instruction to fetch, and GPS craft the wiki
  does not carry — informant and proximity reasoning, evidence classification,
  citation form. A record-type-shaped rule may stay when it is craft; a
  jurisdiction-shaped fact may not. "Pre-1880 census" is a fact about one
  country's schedule and is written as such or fetched.
- **Where the wiki is wrong or thin, fix the wiki.** The genealogist's path is
  to find the page for the country and record type and request a specific change
  to it. The plugin does not keep a corrected local copy.
- **Name the fetch so it runs.** A wiki call is an unconditional member of a
  labelled pre-work block, and the acceptance check for any move observes the
  call in the run log. A unit test exercising the lookup declares a fixture for
  the page under `eval/fixtures/mcp/` (`wiki-read-*.json`,
  `wiki-place-page-*.json`). The agent that will make the call grants the tool
  under all three spellings (ADR-0004).

The order for a skill on its way to becoming a pair is: reliable unit suite,
then this move, then the fold (`docs/skill-to-agent-pair-conversion.md`, "The
process, in order"), then the model and effort floor search.

## Alternatives considered

| Option | Why rejected | Evidence |
|---|---|---|
| Author per-country reference guides in `references/` | Six guides for the UK and Scandinavian censuses were requested; the same content already existed upstream at about 440 KB, agents cannot read reference files, and six new unreached files would fail `skill-reference-reachability.test.ts` | issue #1923, closed 2026-09-01; the twelve-page probe in its comments |
| Hard-code record-type × country checks in the writer tools | A year-only pre-1880 census gate false-denies a correct claim about an 1851–1871 England & Wales or a Norwegian census; the space is ~200 × dozens × eras and every entry goes stale silently | issue #1967, ruling 2026-08-27; 4 non-US flags measured on `residenceYearFrom < 1880` |
| Fold `references/` verbatim into the agent body at pair conversion, locality content included | Carries the US-shaped content into a body billed on every spawn, and for `search-records` the reference layer alone makes the pair unbuildable | issue #2123: 87,313 of 143,557 folded bytes are references |
| Serve every lookup through `wiki_search` | Fragments for a known page; on `record_search` mechanics the corpus returns refuted claims and contradicts itself inside one result set | issue #2123's comment of 2026-09-01, live probes |
| Persist the facts once in `research.json`'s `localities` and read them there | Holds place-scoped record availability, not record-type craft, and `search-records` does not read that section | `docs/specs/research-schema-spec.md`; issue #2123's comment |
| Keep a corrected local copy where the wiki is measured wrong | Re-creates the tier this decision closes, one exception at a time; the correction belongs on the wiki page | argued, not measured |

The `craftNotes` payload on `project_context` (issue #2153) is not an
alternative but the complement: it carries the residue the wiki lacks, and its
field-inventory half still comes from the wiki.

## Consequences

**Gains.** Coverage scales with the wiki's roughly complete country and
record-type axis instead of with what we have written. The US default goes with
the tables that carried it. `references/` shrinks to what is genuinely ours, so
the remaining pair conversions carry less and `search-records` becomes
buildable. FamilySearch maintains the content; we maintain a fetch and a
change-request path.

**Costs, knowingly accepted.** Every affected skill spends a paid eval run on
the move, and a second on the fold that follows. Correctness now depends on a
network service at runtime: the wiki tools are single-shot until issue #2054
lands retries, an outage is recorded as "no page" until issue #2130 lands, and
the compiled-in default still points at one developer's public tailnet host.
Each lookup adds tool calls and page tokens to an invocation. Wiki errors we
have measured — the 1940 census sample, no 1950, no England & Wales table, and
`United_States_Census` omitting the 1890 loss (its loss statement lives on the
separate `United_States_Census_1890` page, so the country page lists 1890 as an
available collection) — become our errors until the change request lands upstream.

**Risks.** The model skips the fetch (the `gps-mentor` pattern); a floor search
at a cheaper model may pass the rubric by skipping the lookups unless a
validator asserts the call. A guessed slug 404s silently and the model proceeds
without the page. `wiki_place_page`'s address space stays narrower than the
corpus until issue #2078.

## Enforcement

None — convention only, beyond two neighbours:

> `packages/engine/mcp-server/tests/packaging/skill-reference-reachability.test.ts` —
> a `references/` file nothing names fails packaging, so a per-country guide
> nobody wires up cannot ship.
> It does **not** catch a locality fact written into a body, a reachable
> reference, or a tool description.

> `eval/harness/e2e/wiki_failure_report.py` (`make e2e-wiki-failures`) — reports
> the rate and causes of wiki-call failures across the e2e corpus.
> It does **not** catch a wiki call that was never made.

## Revisit when

- Issue #2078 lands and `wiki_place_page` gains the record-type axis: the
  "fetch by page" bullet names the deterministic call instead of a constructed
  URL.
- A change request against a wiki page is refused and the plugin measurably
  needs the corrected fact: the residue rule above then needs a carrier for
  that one fact, and this file says which.
- The wiki service moves off the developer host (issue #290 stays `icebox`;
  hosting is not ours): the costs paragraph changes.
