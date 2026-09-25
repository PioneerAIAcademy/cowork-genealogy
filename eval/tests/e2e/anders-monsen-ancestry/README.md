# Anders Monsen & Unna Halsteinsdatter — marriage (1786, Norway)

**Source PID:** `LKFW-9XH`

**Anders Monsen is deceased** (buried 8 January 1821, Manger parish, Hordaland, Norway). (FamilySearch ToS requires all committed e2e fixtures to be about deceased persons.)

## Research question

> When and where did Anders Monsen marry Unna Halsteinsdatter, and what does the marriage record show?

## What was removed from the starting tree

- The `Marriage` fact (date and place: 25 June 1786, Hamre parish church, Hordaland, Norway) from the `Couple` relationship between Anders Monsen (`LKFW-9XH`) and Unna Halsteinsdatter (`KZHH-VTX`) — the relationship itself is retained (empty `facts` array), since the question already names Unna as the spouse.
- The marriage-attesting source: `MWGF-FDS`, "Anders Monsen, 'Norway, Marriages, 1660-1926'" (ark `1:1:NW44-PM2`).

## What the starting tree contains

- Anders Monsen's birth is 1759 in Håtuft, Meland, his christening is 7 April 1759 in Hamre kirke, Osterøy, his death is in 1821 in Åsebø and he was buried 8 January 1821 in Manger.
- His parents, both fully identified and linked via `ParentChild`: Mons Monsen "Qvamme" (`LKFW-9ML`, b. 1724 Nedre Kvamme, christened 1 Oct 1724 Hamre kirke, d. 1779 Åsebø) and Anna Andersdatter (`LKFW-9QR`, b. 1739 Bjørnestad, christened 5 Apr 1739 Meland, d. 1805 Åsebø). These were the answer in a prior version of this fixture (parents/christening question) — they are now given context, not the tested finding.
- His spouse Unna Halsteinsdatter (`KZHH-VTX`) as a known person: birth (May 1745, Hestdal, Meland) and christening (27 May 1745, Hamre). The `Couple` relationship to Anders exists but carries no marriage fact.
- Three non-marriage sources: the christening record, the "Norway, Baptisms, 1634-1927" index entry, and the death/burial record.

Extended relatives not relevant to the marriage question (Mons's other marriages, Anna's parents, Anders's many siblings) were deliberately left out of the starting tree to keep it focused — see "Path 1" scope note below.

## Expected difficulty

Moderate, and harder than originally scoped — the marriage record is real and readable directly by ark (`record_read ark:/61903/1:1:NW44-PM2`, collection 1468080), and this premise held when the fixture was authored: run 1 (2026-07-09) recovered it via `record_search` itself, ranked #2 of 58, `attachedToSubject: true`. As of 2026-09-16/17 the record is confirmed **not** retrievable through `record_search` under either persona's own indexed name, by any query tried across two independent checks a week apart (see "What the live runs revealed" below). Consistent with the run-8 probe's own finding, this is the search index drifting, not the original premise having been wrong — and per that same probe, the record "may revert." Until it does, Digitalarkivet or another Norwegian-only archive may be the only current route to `f2`. Norwegian patronymic naming (Anders Monsen = son of Mons; Unna Halsteinsdatter = daughter of Halstein) also makes both names extremely common, so disambiguation would rest on combining both spouses' names with the approximate 1786 date and Hordaland/Meland-area geography if the record re-enters the search index.

## Notes for reviewers

Two required findings: (f1) the marriage fact — Anders Monsen married Unna Halsteinsdatter on 25 June 1786 at Hamre parish church, Hordaland, Norway, and (f2) the source — the FamilySearch-indexed "Norway, Marriages, 1660-1926" collection entry that documents it. This fixture was rebuilt from a live `person_read` snapshot of `LKFW-9XH` (Path 1), replacing an earlier PID-less (Path 3) version of this fixture that tested Anders's parents and christening instead — that prior version's document-derived christening place (Håtuft farm) turned out to conflate the birth farm with the actual christening church (Hamre kirke, a different parish), which the live FamilySearch data corrects. The parents/christening facts from that prior version are now included as given context in the starting tree rather than being the tested answer.

### What the live runs revealed

- **Run 1 (2026-07-09 12:04, pre-fix)** — passed, but only by luck: the agent
  searched with `spouseGivenName: "Unna"`, got zero results, then dropped the
  spouse filter entirely and spotted the correct record while eyeballing 58
  unfiltered candidates (`isPrincipal: true`, `marriageYearFrom/To: 1770-1800`,
  no spouse filter — the real record ranked #2 of 58 via `rank_search_matches`,
  already `attachedToSubject: true`). Its proof narrative also asserted the
  digital church-book image was "accessible" without the search-tool output
  actually confirming an image existed.
- **Fix #1** (`search-records` + `proof-conclusion`) — added "retry secondary-party
  names with spelling variants" and "never claim a digital image exists unless
  tool data confirms it," directly motivated by run 1's rough edges.
- **Run 2 (2026-07-09 18:51, post-fix #1)** — failed. The agent tried three
  `record_search` variations (swap principal/spouse roles, drop surname, drop
  place) but never varied the *spelling* of "Unna" itself — it satisfied the
  letter of fix #1 without the substance, then fell back to weak indirect census
  evidence rather than recovering the marriage record.
- **Fix #2** (`search-records`) — sharpened the distinction between
  "query-structure changes" (swapping which field is filtered) and "name-spelling
  changes" (varying the string itself), and added a `collection-quirks.md` entry
  citing the two real observed index spellings pulled from the two runs: "Urna
  Halsteinsdr" (marriage record) and "Udna Halstensdatter" (census record).
- **Run 3 (2026-07-13 23:18, post-fix #2)** — failed. The agent *did* try the
  given-name variant "Urna" extensively, but kept the surname at the full
  "Halsteinsdatter" rather than the record's actual abbreviated index form
  "Halsteinsdr," and never tried the two together in one search. It pivoted
  instead to a genuine, separate research lead (a possible second marriage,
  Anders Monsen + Sønneve Peersdatter, from an 1820 baptism record) — a real
  finding, just not the one this fixture tests.
- **Fix #3** (`collection-quirks.md`) — documented that the surname is
  independently abbreviated in the same index ("Halsteinsdr," not
  "Halsteinsdatter"), and required trying the given-name and surname variants
  *together in the same search*, not just one at a time across separate calls.
- **Run 4 (2026-07-14 10:15, post-fix #3)** — failed, the mirror-image miss:
  this time the agent varied the *surname* ("Halstensdatter") but never tried the
  given-name variant "Urna" at all, then found the couple in the 1801 census
  under "Udna Halstensdatter" and wrote a defensible `probable`-tier proof
  bounding the marriage to "before 1796" — real, honest research, just not the
  exact marriage record/date.
- **Fix #4** (`search-records` SKILL.md) — added a required fallback: when
  secondary-party name variants are exhausted and still weak, drop the
  secondary-party filter entirely (principal-only search) and run
  `rank_search_matches` with `checkAttachments: true`; treat `attachedToSubject:
  true` as a strong confirming signal for a *fact-confirmation* question (not
  something to deprioritize as "already known," which is the right instinct only
  when hunting for *new* evidence) — formalizing exactly the mechanism that made
  run 1's lucky pass work.
- **Run 5 (2026-07-14 23:22, post-fix #4)** — failed. The agent correctly executed
  the new fallback (principal-only search + `rank_search_matches`), but its
  `isPrincipal: true` search used a `marriageYearFrom/To: 1770-1795` filter and
  returned only 8 candidates — versus 58 for run 1's slightly wider 1770-1800
  window. That's a large swing for a 5-year narrower window, suggesting
  FamilySearch's year-range filter may not reliably match this record's indexed
  date even though its displayed date (25 Jun 1786) falls inside both windows.
  The agent reached an honest, well-reasoned `not_proved` conclusion for the
  marriage question and a separate `probable` conclusion for a self-added
  census-based question — good GPS-compliant behavior, just not the fixture's
  expected findings.
- **Tried in run 8's probe (2026-09-09); was "not yet tried" until then:**
  dropping the marriage-year filter entirely on the principal-only fallback
  search (relying on collection + place + `rank_search_matches`'s own
  biographical scoring instead of a numeric year range). It returns **165** hits
  and does **not** reach the target — see the run-8 probe bullet below. This is
  no longer an open refinement.
- **Pattern across runs 3-5:** each attempt correctly exercised *some* piece of
  the accumulated guidance but not all of it in the same pass, and each miss had
  a different, well-evidenced proximate cause. This looks less like one
  remaining bug and more like real run-to-run variance in how much of a
  multi-step search checklist the agent executes before satisficing on an
  alternate (honest, defensible, but off-target) research lead — worth keeping
  in mind before spending more live-run budget chasing a single clean pass.
- **Runs 6-7 (2026-07-21 08:10 and 23:15)** — both failed; both annotated `f1`
  partial, `f2` false, proof quality 3. Each identified the right couple through
  indirect 1801-census evidence but never recovered the marriage date or place.
  Both annotations concluded the "Norway, Marriages, 1660-1926" entry was
  "genuinely absent, not a search-quality problem" after 27 and 9 search
  strategies respectively — **a conclusion the run-8 probe below half-vindicates
  and half-corrects**: they were right that no search reaches it (the record's
  personas are not in that collection's search index today), but wrong that it
  is "absent" — `record_read` returns it in full, and run 1 reached it through
  `record_search` in July. Their operational advice was sound; their
  explanation was not. Both
  recorded `stop_reason: "error"` while still producing a full tree and a
  committed grade. (Runs 3 and 4 in the narrative above have no committed run
  logs; the five on disk before run 8 are runs 1, 2, 5, 6 and 7.)
- **Run 8 (2026-09-09 14:30, `git_sha` 96cadcac5)** — `f1` partial, `f2` false,
  proof quality 2; `stop_reason: completed`, `compliance: fail`. The first run
  **since run 1** to recover the marriage date, and the first to reach it from a
  source **other than the index record** (run 1 recovered both date and place
  from the index record itself and graded `f1` true). It reached **25 Jun 1786**
  by a route no prior run took: `image-reader` transcribed a **1963 LDS Family Group Sheet** (ark
  `3:1:3QSQ-G979-7SPB`) whose submitter cites Hamre parish film 17885. It wrote a
  `probable` proof summary and encoded the date on the `Couple` relationship,
  flagging the place as inferred from the source's parish scope rather than
  stated on the marriage line. Cost $11.58 / 102.9 min — roughly double this
  fixture's prior mean, the excess spent on a second research loop after
  `research-exhaustiveness` returned `declared: false`.
- **What run 8 probed about `f2` (probed live 2026-09-09, after the run):** the
  expected record is **not** absent. `record_read ark:/61903/1:1:NW44-PM2`
  returns it in full — Anders Monsen + Urna Halsteinsdr, Marriage `25 Jun 1786`,
  Hamre, Hordaland, collection 1468080. **Run 1 recovered this same record from
  `record_search`** — same collection, `isPrincipal: true`, over a wider
  `1770-1800` window (`tool_calls[29]`, then `rank_search_matches` ranked it #2
  of 58, then `record_read` of the ark at `[32]`), and run 1's annotation grades
  `f2` true. So `f2` is recoverable in principle, and any claim that this record
  is inherently unsearchable is wrong.
  **What changed is the index, not the query.** Re-running run 1's query
  *verbatim* on 2026-09-09 — including its `recordType: marriage` and
  `recordCountry: Norway` — returns **10** matches, not 58, and the target is
  not among them. Eight configurations were probed and none reached it:
  `marriageYear 1786-1786` (19 hits, all Anders-Monsen-as-*parent*);
  `isPrincipal` + `1780-1790` (4); `isPrincipal` + `1770-1800` (10, with and
  without run 1's two extra params); `isPrincipal` + `marriagePlace=Hamre`
  (**82** — re-pulled in full during review on 2026-09-10, which also corrects
  this line's original "50, target not in top 5": **all 82 were read and the
  target is absent from every one**, and three of the 82 sit in the *same Hamre
  extraction batch* as the target's own sibling entries, so the batch is indexed
  and this one persona is not); `isPrincipal` + `marriagePlace=Hamre` +
  `1770-1800` (**0**); and the previously "not yet tried" principal-only with
  **no** year filter at all (165 hits). Most telling: the bride's own exact
  indexed name from `record_read`, `Urna Halsteinsdr`, returns **0** in
  collection 1468080 with no year filter and no `isPrincipal` — so the record's
  personas are not in that collection's search index today, which is a stronger
  and simpler explanation than year-range semantics.
  **How to read an `f2` miss:** as a search result about a drifting index, not
  as proof of an expected-findings defect and not as an agent regression. The
  record was reachable on 2026-07-09 and is not reachable by any probed query on
  2026-09-09; it may revert. Before attributing a future `f2` miss to the agent,
  re-run run 1's `tool_calls[29]` query and the `Urna Halsteinsdr` probe above —
  if they still return 10 and 0, the record is out of the search index and no
  search strategy will find it.
- **Run 9 (2026-09-16 10:16) confirms the drift has not reverted, and sharpens the diagnosis.**
  `f1` false, `f2` false, `stop_reason: tool_cap`, proof quality 3 — the tree's
  `Couple` relationship carries no marriage fact at all this time (worse than
  run 8's partial). Before grading, re-ran the run-8 probe's own exact
  re-verification: `record_read ark:/61903/1:1:NW44-PM2` still returns the
  record in full (Anders Monsen + Urna Halsteinsdr, 25 Jun 1786, Hamre,
  collection 1468080); a targeted `record_search` on that exact spelling +
  collection + year (34 results, both pages) does not include it; widening to
  1780-1790 with no spouse filter (19 results) does not either. **A second,
  independent check the next day (2026-09-17) went further and settles it**:
  `isPrincipal` + 1786 alone, `isPrincipal` + a 1780-1790 window at Hamre,
  `isPrincipal` + the spouse name, and — the query that removes any doubt —
  the bride alone under her own exact indexed spelling `Urna Halsteinsdr`, no
  year, no collection filter, across all of Norway: **10 results, she is not
  among them.** That is the fixture's own premise being tested directly (a
  bare exact-name search for the record's own indexed persona), not a query
  someone forgot to try.
  **Sharper framing than "ranking gap":** both personas are retrievable by ark
  through `record_read`; neither is retrievable through `record_search` by its
  own indexed name, under any query shape tried across nine attempts spanning
  two independent checks a week apart. Calling this "a ranking gap" invites the
  next reader to go looking for better query terms — there are none to find.
  The fixture's `Expected difficulty` text has been corrected above and in
  `fixture.json`'s `notes` to say so plainly -- not that the premise was wrong
  when authored (run 1 recovered this record via `record_search` itself, and
  the run-8 probe already established this is index drift, which may
  revert), but that it does not hold *today*, confirmed twice a week apart.
  Whether this fixture's `f2` remains achievable at all — short of an
  interactive Digitalarkivet/Ancestry search this harness's autonomous mode
  cannot perform — is now an open question for whoever next reviews this
  fixture's continued inclusion in the panel, not something a future run
  should be expected to solve with a cleverer FamilySearch query.
- **Lead ruling (2026-09-22, issue #2709)** — that open question is answered:
  **run it as filed; the fixture stays in the panel with both findings
  required.** `f1` still discriminates between runs — run 8 reached 25 Jun 1786
  from a 1963 family-group-sheet image, run 9 persisted no tree fact at all — so
  a `partial` or `fail` here is data, not waste. Marking `f2` non-required was
  considered and rejected: it would error the two stamped annotations at
  `calibrate_judge` rung 7 and change what the month-over-month number
  measures. Replacing the fixture was considered and rejected: the panel is
  fixed by design. Grade `f2: false` as index drift and land the run.
- **Run 10 (2026-09-24 07:23, post-ruling)** — recovered neither finding;
  graded `f1: false`, `f2: false`, proof quality 2. `stop_reason: completed`,
  and it finished well inside every cap: 43.4 min against a 120-minute wall,
  $7.86 against a $15 ceiling, and **137 MCP calls against the 300-call cap**
  (210 tool calls in all — the cap counts `mcp__*` only, as run 9's entry
  notes). That is roughly half the wall-clock of runs 8 and 9, and 55-68% of
  their cost ($11.58 and $14.26). The `Couple` relationship is unchanged from
  the starting tree, and the only source added all run is the 1801 census
  household of Nils Andersen (`1:2:4H6K-B56Z`), which documents no marriage.
  **The drift is confirmed a third time, against a wider query set than either
  earlier probe.** Counted by stated criteria over the run's 25 `record_search`
  calls, so the next reader can re-derive rather than re-guess: **13** carried
  `recordType: "marriage"`; **14** named the bride in any field (`Unna` or
  `Halstein*`); **3** were scoped to `collectionId: 1468080`; **3** carried a
  `marriage*` year or place parameter. Twenty distinct calls matched at least
  one of those. Between them they covered the bride's exact indexed surname
  alone, both spouse cross-references, the marriage collection directly, and a
  1775-1800 window scoped to Hordaland. None returned the record. The agent
  graded itself `not_proved` with `shortfall: gap` and named the two
  repositories it did not reach — Digitalarkivet's browse-only pre-1797 Hamre
  books and Ancestry's "Norway, Select Marriages" — as "the most likely
  repositories for a direct marriage record", which is the same conclusion this
  section reached.
  `compliance: fail` on the single known bypass (a `proof_summaries` entry
  written without `proof-conclusion` being invoked — issue #1851), as in both
  2026-09 runs.
  **One claim in that run's proof summary should not be carried forward:** it
  states collection 1468080 was "confirmed **not to index** Hamre/Hammer
  parish." That is a coverage claim inferred from a retrieval failure. The
  record is in that collection and `record_read ark:/61903/1:1:NW44-PM2`
  still returns it in full; what fails is `record_search`, not the indexing.
