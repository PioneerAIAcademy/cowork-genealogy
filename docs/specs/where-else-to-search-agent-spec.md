# `where-else-to-search` — agent spec

> **Status:** New (2026-10-26). Agent file:
> `packages/engine/plugin/agents/where-else-to-search.md`. Unit suite:
> `eval/tests/unit/where-else-to-search/`.

A one-shot plugin agent for the Search Help feature. The user has just run a
FamilySearch historical-records search: a name, an event, a year or range, a
place, and perhaps a collection. The agent answers "where else should I look?"
with up to 8 external collections that FamilySearch curates for that place and
period. Each one gets a prefilled search link and one line on why it fits. The
audience is beginner and intermediate users, and the target is about one
minute of wall-clock time.

---

## 1. What it does

1. **Routing gate.** It runs before any tool call and hands back, with no call:
   - a named single-site search inside a project, or capture triage, goes to
     `search-external-sites`;
   - a FamilySearch search goes to `search-records`;
   - "what records exist for <place>" goes to `locality-guide`;
   - planning a project's next searches goes to `research-plan`.
2. **`place_search`** on the place as typed, which yields `standardPlace`.
3. **One `external_links_search`** with `standardPlace` and the searched years.
4. **Select, then build.** It picks at most 8 rows whose host is one the URL
   builder supports, ranked in this order:
   - `linkText` that names the searched record type or collection;
   - dated rows that overlap the searched years;
   - the tool's own order.

   It then calls `build_external_search_url` once per selected row, in one
   parallel batch. Each call is Case A, with the row's `url` as `baseUrl`
   (`build-external-search-url-tool-spec.md` §3.2).
5. **Return.** A two-line caller header, then `---`, then `summary_for_user`:
   an opening sentence, then each entry in a fixed three-line shape (bold
   `linkText` with the site and free/subscription; the span and how it covers
   the search, or "Undated collection."; the link in full), then one closing
   sentence. Up to 3 curated rows on unsupported hosts are listed separately,
   described as opening the collection with no prefilled search.

   The shape is fixed because free prose failed grounding. On the first scratch
   run (2026-10-26) the "plain paragraph per entry" form produced lines no tool
   returned: transcription vendors, the surname's origin, and enlistment
   history. Most of the run's 8.6k output tokens went into that prose.

An **entry** is one link that `build_external_search_url` returned. One site may
appear more than once, with different collections.

## 2. Decisions

- **Grounding comes from tool output, never from the body.** ADR-0012 bars
  restating jurisdiction-shaped facts in a plugin prompt, so the body carries no
  "for Ireland use FindMyPast" table. Each reason cites the curated row's
  `linkText` and its `startYear`–`endYear`, plus the build call's `access`.
  - A site with no curated row is never suggested. When fewer than 3 entries
    are grounded, the agent returns fewer and says so.
  - When zero rows come back, it says that no curated collection was found and
    builds nothing.
  - Considered and rejected:
    - an uncurated site-wide (Case B) fallback, because choosing which site
      suits a country is memory;
    - a `wiki_place_page` call per query, which is grounded but adds a fourth
      round-trip against a one-minute target.
- **`external_links_search` rows carry their years.** The grounding rule
  presupposes a year span on each row. Before this agent, a row was only
  `{url, linkText}`, and undated rows always pass the year filter. So a row being
  returned did not show that it covered the search.
  - The tool now emits optional `startYear`/`endYear`
    (`external-links-search-tool-spec.md`, §Output). This is output only: its
    `description` and `inputSchema` are unchanged, so no other suite's
    snapshot fingerprint moves.
  - A merged row's span is the hull of its duplicates, so it can be wider than
    its `linkText` says. Many rows are undated in the fields while their
    `linkText` names years. A reason may state either span, the row's
    `startYear`–`endYear` or years its `linkText` names, because both are tool
    output. A row with neither says "Undated collection."
  - The first paid run (`v1_2026-10-26_17-59-04`) required the field span only.
    Every failure in it was the agent preferring the title's years, which are
    usually the collection's own, over the merged hull. So the rule was widened
    to what is grounded, and
    `test_each_entry_states_its_rows_span_and_nothing_more` still fails a span
    found in neither.
- **The host table is exact hostnames, not registrable domains.** Live data for
  the three suite places carries curated rows that share a supported site's
  domain but are not a search:
  - `chroniclingamerica.loc.gov` is retired, and the builder refuses it;
  - `web.archive.org` is the Wayback Machine;
  - `media.digitalarkivet.no` is an image viewer.

  Matching by domain would build nonsense prefills on those three.
- **Tools, exactly:** `place_search`, `external_links_search` and
  `build_external_search_url`, each under all three spellings.
  - There is no `Read`, no `research_*` and no `project_context`, so "never
    writes `research.json`" is structural: an omitted tool is absent under
    `bypassPermissions`.
  - `build_external_search_url` logs a hand-off only when it is given a
    `projectPath`, which the body never passes. That residual capability is why
    `ownership.json` names the agent on the `log` row (its manifest test
    requires every holder of a writer tool to be named).
- **No `**Narration:**` line.** Narration is a `research.json` read, and there
  is no project.
- **Model `claude-sonnet-4-6`**, the pin most agents carry. `claude-haiku-4-5` was
  tried on scratch runs (2026-10-26) and rejected: it altered a curated `baseUrl`
  (a trailing `/`), gave undated rows a span read from their title, and was not
  reliably faster (80 s and 154 s on the same test). Neither model meets one
  minute: the time is model generation, not tool round-trips, so the batch form
  of `build_external_search_url` below would not close it.
- **Batch `build_external_search_url` is out of scope.** A new tool parameter is
  a contract change. The scratch runs already show the agent issuing all its
  builds in one parallel turn, so a batch call would save one tool round-trip,
  not the model's generation time, which dominates.

## 3. What nothing checks

- **Whether a user's words reach this agent at all.** The unit harness spawns
  it directly, and nothing measures whether the main thread delegates to an
  agent.
  - On the hosted path the competitor is concrete. `research/SKILL.md`'s
    routing table sends a no-`research.json` message that names a person to
    `init-project`, which then asks for a FamilySearch ID.
  - Both `search-external-sites` and `research-plan` also claim "where should I
    look?".
- **Whether the three tools bind live.** Only a live session checks this, and
  only for the spelling that session exposes. `make agent-smoke` covers
  registration.
- **What the user is shown.** The unit harness relays the whole return,
  including the lines above `---`. Production prints only what follows the
  final `---`.
  `test_every_suggested_link_reaches_the_user` closes the gap for links:
  every built link must appear after the separator. Nothing closes it for any
  other content.
- **Whether a curated Case A link still searches.** Curated URLs carry
  collection paths with no recorded provenance
  (`build-external-search-url-tool-spec.md` §9.1). The builder appends
  parameters, and a site may ignore them.

## 4. Verification

- Unit suite: `make eval-skill SKILL=where-else-to-search`. It has five
  positives on live-captured `external-links-search-wets-*` fixtures and three
  direct-arm hand-backs graded on invariant.
- Validators: `eval/harness/validators/test_where_else_to_search.py` checks
  four things:
  - every link is one a tool returned;
  - every built link reaches the user;
  - no tool outside the three, and no `projectPath`;
  - at most 8 links, and nothing built when there are zero rows.

  `eval/harness/tests/unit/test_where_else_to_search_validators.py` proves
  each one fires on a planted defect and passes a legitimate variant.
- Timing: the p50 of `tests[].totals.duration_ms` in that run log, which
  includes no live latency, plus one live timing.
