# Plan: replies link every image and record they name (#4582)

**Status:** planned, not built. Final after plan-critic rounds 1 and 2.

## Goal

A reply never names an image page or a record by a bare ARK or bare image id. It gives
the https URL a tool result returned (`viewerUrl`, `recordUrl`, or an ARK written as
`https://www.familysearch.org/ark:/…`) as a markdown link. An image group is
"image group <number>" (no hand-built URL; review-ready ruling 2026-11-16) and is called
a Catalog item only when `catalog_search` returned it.

## Step 0 — who wrote it (done 2026-11-16, bundle in scratchpad)

Both lines were written by the **main thread**, not a relayed block:
- Session "Ashford full text" (top-level log): `search-full-text` returned four image
  ARKs; the main thread called `image_transcribe({ark})` on all four itself (each response
  carried `viewerUrl` `https://www.familysearch.org/ark:/61903/3:1:…`) and ended with
  "**Sources consulted:**" and four bare lines
  `- FamilySearch image ark:/61903/3:1:3QHN-BQ8C-33BG (Ashford vital register, page 5)`,
  `…3QHN-TQ2K-9B47 (page 209)`, `…3QHV-JQ56-WTQK (page 19)`,
  `…3Q9M-C9BT-D9VV-3 (pages 298–299, tabular transcription)`.
- Session `4b6c47a7`: user message "FamilySearch digitized the early vital records of
  Ashford, Connecticut as well as published indexes of the same. Locate (in the
  FamilySearch Catalog) and transcribe the image of the original record referenced by
  the index card in this image: https://www.familysearch.org/ark:/61903/3:1:3Q9M-CS56-DQGC-1."
  Main thread `image_read` the card, was hook-denied `catalog_search`, spawned
  search-images twice. The second agent found group 113551215 through **`volume_search`**
  (its `catalog_search` calls never returned it) and returned bare ids above and below
  its `---`. The main thread then wrote its own reply:
  "**Catalog item:** FamilySearch imageGroupNumber 113551215, image 3 (viewer:
  familysearch.org/search/film/113551215?i=2)" — a hand-built, scheme-less URL.

So step 1 (router) is the fix for both lines; step 2 (search-images) fixes what the
router relays and what it copies from. Extra validator rule from this: a
`familysearch.org/` link written without `https://` fails (rule 4 below).

## Step 1 — router rule (`packages/engine/plugin/skills/research/SKILL.md`)

- Bounded-requests paragraph: drop "and give `viewerUrl` as a link" (the rule below
  covers it). Next to item 1 of "One step per turn", add one rule for text the main
  thread writes itself:
  > In your own words, link every page or record you name to the https URL its tool
  > result gave (`viewerUrl`, `recordUrl`, or an ARK as
  > `https://www.familysearch.org/ark:/…`); never a bare ARK or image id. An image group
  > is "image group <number>", a Catalog item only when `catalog_search` returned it.
  > Never rewrite a block you relay verbatim.
- No "never a bare image-group number" — `ut_research_np2` (DGS numbers, no page read)
  answers with group numbers and nothing to link.
- Net length: trim at least as many words elsewhere in the file as the rule adds.

## Step 2 — relayed half (`packages/engine/plugin/agents/search-images.md`, "No project")

- Return bullet: each fact followed by a markdown link to the page's `viewerUrl` from its
  `image_transcribe` result, link text the image id
  (e.g. `[004567123_00058](https://www.familysearch.org/search/film/004567123?i=57)`);
  never a bare image id or short form like `(00058)`. "may carry image ids" → "may carry
  image ids only as link text". Name the record set "image group <number>"; a Catalog
  item only when `catalog_search` returned it.
- Fixtures: `viewerUrl` goes only on fixtures matching ONE exact page (production builds
  it per page; the mock does not, and editing `mock_mcp.py` stales every suite —
  `check_runlogs.py:985`). Add it to `image-transcribe-m246-dustin-roll-p1/p2` and
  `-m246-nh-film-index` (verify each predicate is one page). Leave it off
  `-m246-nh-film-other-company` and `image-transcribe-any` (substring catch-alls).
- `ut_search_images_np1`: edit `description` and judge_context "cited to the image id"
  → "cited by a link to the page's viewerUrl (link text may be the id)".
- `ut_research_np1` stub (`route-no-pid-record-set-to-search-images.json`): rewrite its
  relayed block to the link form so the stub matches what the agent now returns.

## Step 3 — validator (`eval/harness/validators/test_research.py`)

`test_reply_links_named_sources`, tag-gated on `links-sources` (shape of
`test_names_collections_only_from_search`). Two views of `text_response`:
`targets` = every markdown link replaced by its target; `labels` = replaced by its link
text (`_MD_LINK` gains a second group for the target; its three `\1` callers at
1683/1716/1798 are unaffected).

Negative rules (on `targets`):
1. Fail on `ark:/61903/…` not immediately preceded by `https://(www\.)?familysearch\.org/`.
2. Fail on a bare image id `\b\d{9}_\d{5}\b`.
3. Fail on short page forms the agent actually writes (search-images v7 np1): a
   parenthesised `\(\d{5}\)` and `\bimages? \d{5}(\s*[-–]\s*\d{5})?\b`. Five digits
   only (the image-id page suffix), so years like `(1777)` never match.
4. Fail on `(www\.)?familysearch\.org/` not preceded by `https://` (the hand-built
   "viewer: familysearch.org/search/film/113551215?i=2").

Catalog rule (on `labels`): for each `\bcatalog item\b` label (case-insensitive), take
the 6+-digit / `koha:` ids on that line; fail unless each, leading zeros stripped, occurs
in the JSON-dumped response of a `catalog_search` call in `tool_calls` (subagent calls are
recorded there — v7 np1). `agent_returns` is NOT evidence: relayed and stub text lives
there, so it would excuse the very case under test.

Positive rule (makes the check able to fail on a reply that cites nothing): collect the
`viewerUrl` of every `image_transcribe` response in `tool_calls`, and compare with
`www.` stripped on both sides. A test tagged `links-sources` must have at least one
such URL in `targets`; for a routed run (search-images live) it must appear after the
final `---`. No new test-JSON field, so no schema/whitelist/spec edits.

Proof both ways: `eval/harness/tests/unit/test_research_links_sources_validator.py`.
- Fails: session's bare `ark:/61903/3:1:…` lines (verbatim, step 0); the Catalog-item
  line with no catalog_search; the same line with the number present only in
  `agent_returns`; a bare image id in a bullet; a link whose TARGET is a bare `ark:/…`;
  a bare ARK in a table cell; `(00412)`; "images 00412–00413"; a reply with no links
  when `tool_calls` holds an `image_transcribe` `viewerUrl`.
- Passes: `[ark:/61903/3:1:X](https://www.familysearch.org/ark:/61903/3:1:X)`;
  `https://familysearch.org/ark:/…`; `[004567123_00058](viewerUrl)`; "image group
  113551215 (not a Catalog item)"; a Catalog-item line whose number (with/without
  leading zeros) a catalog_search response carries; untagged test → skip; `(1777)` and "born 1845 (1850 census)"; the no-www form of an
  expected viewerUrl.
- Mutation: delete each rule in turn and watch its cases go red.

## Step 4 — research unit tests (`eval/tests/unit/research/`), tag `links-sources`

(a) `no-project-transcribe-named-image-links.json`: empty folder; ONE named image ARK
from step 0, "transcribe this" (the only path the router reads itself —
`SKILL.md:205-207`; more pages go to search-images). One exact-page fixture
`image-transcribe-<slug>.json`, `ark` predicate on the id tail (`"ark": "~3:1:<ID>"`),
`viewerUrl` `https://www.familysearch.org/ark:/61903/3:1:<ID>`, marked SYNTHETIC unless
step 0 gives the real text; envelope from `image-transcribe-driscoll-1881-census.json`;
`image-transcribe-any` last. Stubs as `ut_research_np1`. If the router stops after the
init-project stub instead of transcribing, the positive rule fails it — intended. If
step 0 shows the four session-2 reads went through search-images, that shape goes into
(b) with exact-page fixtures keyed on `ark`.

(b) `no-project-find-original-from-index-links.json`: session 4b6c47a7's message
verbatim (it says "Locate (in the FamilySearch Catalog)", the pull toward "Catalog
item"), `execution.run_agents: ["search-images"]`. Fixtures (real ids and
text from the bundle): image_read/image_transcribe for the index card ARK; catalog-search
empty catch-alls (as in the session, it never returns 113551215); a volume_search for
Ashford returning group 113551215 "Second Copy Vol 4"; image_search on 113551215; exact-page
image-transcribe fixtures with `viewerUrl`, `volume-bisect-any` (required by
`allowed_tools.py:404`), catch-alls last. `stub_skills` = init-project, tree-survey,
search-records, locality-guide, search-familysearch-wiki (not search-images —
`runnability.py:240`).

`runs_per_test` stays 1.

## Verification (falsifiable)

- `pytest eval/harness/tests/unit/test_research_links_sources_validator.py` green; each
  rule deletion turns its cases red (recorded in PR).
- `make harness-test` (corpus + runnability) green; vitest `mcp-fixture-shape.test.ts`
  green; a `run_tests.py --test <id>` dry start for each new test.
- Scratch: `run_tests.py --test <a> --runs-per-test 3 --runlogs-root <tmp>` and same for
  (b); paste `per_run_outcomes`. Expect 3/3.
- Before/after: `git checkout origin/main -- packages/engine/plugin/skills/research/SKILL.md
  packages/engine/plugin/agents/search-images.md`, run each test 3× into scratch, restore.
  Expect ≥1 failure on main for (b). (a) may pass on main (the router already links a
  transcription it delivers); if it does, say so in the PR — (a) then guards the rule
  rather than proving the change, and (b) carries the proof.
- After rebasing onto #4607, #4572, #4537: `make eval-skill SKILL=research` and
  `make eval-skill SKILL=search-images`, genealogist annotation, `check_runlogs.py` green.

## Not in scope

#4432 (speculative "almost certainly the father"), #4576 (report citations), a URL field
on `image_search` (lane-1 tool change), the mock building `viewerUrl` (stales every suite).
