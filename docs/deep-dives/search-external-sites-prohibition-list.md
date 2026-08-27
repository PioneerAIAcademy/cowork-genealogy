# search-external-sites — prohibition list (Step 1 of the deep-dive guide)

Built from `packages/engine/plugin/skills/search-external-sites/SKILL.md`
(523 lines) and the four reference files it actually names —
`references/repository-types.md`, `references/search-strategy-external.md`,
`references/evaluating-compiled-sources.md`, `references/places-guidance.md` —
as this branch leaves them at `abd76bb8`. The other two reference files in the
folder (`research-log-protocol.md`, 82 lines; `validation-protocol.md`, 16
lines) are named by nothing — not SKILL.md, not `rubric.md`, not any test — and
contribute no rule; see finding F1.

Every line below is checkable by eye against a run-log transcript
(`runs[].output.text_response`, `.tool_calls`, `.files_created`) or against the
project state the validators receive (`before_state` / `after_state`).

Judgement calls — "was this the right first-contact strategy", "is the triage
narrative clear", "does the capture instruction read well" — are deliberately
excluded. They belong to the judge, per the guide.

This skill is unusual in that **its whole output is a URL it cannot test.**
Nothing in the harness, in CI, or in the eval loop ever loads a generated URL,
so a template that silently stopped working would pass every check the repo
owns. That shapes the list: section E is longer than it looks like it should
be, and most of it is not mechanically checkable. See finding F6.

**Save this file. The next auditor of `search-external-sites` starts here
instead of rebuilding it.**

---

## A. Scope and routing (what this skill must refuse to do)

1. Must not choose *which* site or record type to search, or in what order —
   that is `research-plan`. The skill executes a search already chosen.
2. Must not treat "what should I search next?" / "where should I look for
   X's parents?" as a search request. It is planning; route and generate no
   URL.
3. Must not analyze a single record already in the user's hands — that is
   `record-extraction`.
4. Must not search FamilySearch itself — that is `search-records`.
5. Must not judge whether research is now exhaustive — that is
   `research-exhaustiveness`.
6. On any of 1–5 the run routes and **executes nothing**: no
   `external_links_search` call, and no new `tool: "external_site"` entry in
   `log[]`.
7. On a route-away the skill may still say one line naming the correct skill.
   Silence is not required; a *search* is what is forbidden.

## B. Tools

8. Only five MCP tools may ever be called: `place_search`,
   `collections_search`, `external_links_search`, `research_log_append`,
   `research_append`. Anything else violates `allowed-tools:`.
9. Must not fetch, load, scrape, or otherwise open any of the five supported
   sites. The sites have no public API and prohibit automated access; the
   user's browser is the only access path.
10. Must not call `validate_research_schema` — `research_log_append` and
    `research_append` validate before persisting.
11. Must not hand-edit `research.json`. Every write goes through
    `research_log_append` (for `log[]`) or `research_append` (for the plan-item
    status).
12. Must not write `sources` or `assertions`. This skill writes `log[]`
    entries and one `plan_items` status field, nothing else —
    `record-extraction` owns the rest.
13. On `{ ok: false, errors }` from either writer, must surface the errors and
    fix the inputs. Must not retry blindly, and must not fall back to writing
    the file by hand.

## C. Place resolution

14. Must call `place_search` before `external_links_search` on any
    search-generation turn.
15. Must pass to `external_links_search` the `standardPlace` **as
    `place_search` returned it**. A guessed, reconstructed, or
    prettified place string is a violation even when it is correct.
16. Must not reject a returned `standardPlace` for resolving to a broader
    administrative level than the request named (a county request resolving to
    a state is the API's answer, not an error).
17. Persisted facts, assertions and events must carry `standard_place`
    (snake_case) — `references/places-guidance.md`.

## D. Consuming the curated-links response

18. Must pass `projectPath` on the `external_links_search` call, so the full
    year-filtered set is staged to disk.
19. Must filter `results[]` to the target site client-side even though `host`
    already narrowed it server-side.
20. Must dedupe repeated URLs, and must say in one line when a dedupe
    happened. A silent collapse is a violation.
21. Must match `linkText` against the plan item's record type before
    presenting a curated link.
22. Must not present a curated link of the wrong record type as the search.
    A probate plan item may not be answered with a census collection.
23. When no curated link matches the record type, must fall back to the
    site-wide template **and say which record type it was looking for**.
24. Falling back to the site-wide template is correct behaviour, not a
    failure — must not be narrated as one.
25. Must distinguish the two zero cases in narration: `matched === 0` with
    `totalForPlace > 0` ("FS curates this place, nothing fits") versus
    `totalForPlace === 0` ("FS curates nothing here").

## E. Building the URL

26. Must run `collections_search` for the same place and window before
    presenting any external-site result as a source.
27. Must not present a competitor site as the source for a collection
    FamilySearch itself holds — must name the FamilySearch copy and offer
    `search-records`.
28. Must ground every statement about which collections or census years exist
    in the `collections_search` result. Must not state coverage from memory.
29. Must still build the URL the user asked for even when FamilySearch holds
    the same collection. The skill executes the chosen search; it does not
    override it.
30. Case A: must append parameters to the returned curated URL rather than
    templating the collection ID separately.
31. Case A: must append with `&` when the base URL already carries a query
    string, `?` otherwise.
32. Must match the encoded parameters to the plan item's **event**. A
    marriage plan item must not be searched on birth-only fields.
33. Must omit parameters it is not confident about.
34. Must check `conflicts[]` before encoding a place or date, and must
    honour a `status: "resolved"` entry by encoding the value from
    `preferred_assertion_id`. Encoding a value that entry **rejected** is a
    violation.
34a. Where a `conflicts[]` entry naming that field is **not** resolved, must
    omit the field and name the candidate values in one line. Must not pick
    a side.
35. Must use the documented per-site parameter names exactly
    (`birthplace` not `birth_place` on Ancestry; `birth_place` not
    `birthplace` on MyHeritage; `keywordsplace` on FindMyPast; `location` on
    FindAGrave; `query` on Newspapers.com). A swapped parameter name produces
    a URL that loads and silently ignores the filter.
36. Must not invent a parameter the site's template does not list. **Confirmed
    live 2026-08-26:** `_004` emitted `yearofbirthrange=5` on FindMyPast; the
    site ignored it and applied its ±2yr default. The real spelling is
    `yearofbirth_offset` (give-or-take) and `keywordsplace_proximity` (place
    radius) — verified by reading the address bar back after setting the range
    in FindMyPast's own form. See finding F10.
36a. Must never emit a session parameter. FindMyPast's returned URL carries
    `sid=`; that is browser session state, not a search parameter, and a
    generated URL must not reproduce one.
37. Ancestry is a **narrow start** on first contact —
    `references/search-strategy-external.md` gives it the only per-site row,
    and the row overrides the name-uniqueness selector.
38. Must present exactly the URL it logged. The `externalSite.urlGenerated`
    value and the link in the reply must be the same string.

## F. Logging the search

39. Must log the search in the **same turn** the URL is handed over. Must not
    defer the log until the capture arrives.
40. Must not skip the log because "there was nothing to record".
41. The curated-links fetch is its **own** `log[]` entry, separate from the
    search entry, whenever `staged.resultsRef` came back.
42. That fetch entry uses `tool: "external_links_search"` and carries
    `stagedResultsRef`.
43. That fetch entry grades **the fetch, not the search**: `positive` when
    links came back, even when none of them fit the plan item's record type.
    Logging it `negative` because nothing was relevant is a violation — it
    collapses "FS curates nothing here" into "FS curates plenty, none of it
    relevant", which call for different next steps.
44. Must not pass `externalSite` on the `external_links_search` entry.
45. The search entry uses `tool: "external_site"`, `outcome: "partial"`,
    `resultsExamined: 0`, `externalSite.captureReceived: false`,
    `externalSite.captureFilename: null`.
46. Must not pass `stagedResultsRef` on the `external_site` entry — no
    sidecar exists until the capture arrives.
47. `externalSite.site` must be one of `ancestry | myheritage | findmypast |
    findagrave | newspapers`, and must match the site actually targeted.
48. The `log[]` is append-only. Must never edit or delete a prior entry. A
    capture that comes back gets a **new** entry, not an amendment.
49. Two runs of the same search correctly produce two entries. Must not
    de-duplicate them.
50. A user-*reported* nil with no capture must be logged **immediately** as
    `outcome: "negative"`, with `notes` marking the absence **unconfirmed
    pending a capture**, and must be followed by the capture instructions.
51. Must not treat logging a nil as declaring the record absent. `notes` must
    record the collection searched, its known coverage gaps, and whether the
    absence is conclusive.
52. A subscription or login wall the user cannot pass is `outcome: "error"`
    with the reason — not `negative`.
53. Before calling a site exhausted on zero results, must try at least two
    variations, each logged as its own entry.

## G. Plan-item status

54. Must set the status with `research_append`
    (`section: "plan_items"`, `op: "update"`) once the search is logged, on
    any turn that names or unambiguously targets a plan item.
55. Must not write a status when the search matches no plan item
    (`planItemId: null`).
56. `completed` requires a triaged capture — including a captured empty
    results page, which is a conclusive nil. Handing over a URL is never
    `completed`.
57. `skipped` outside `--autonomous` requires the user to have **asked** for
    it. Must never be inferred from an access failure alone.
58. A capture that arrived unusable (login page, truncated) leaves the item
    `in_progress`.
59. Must not offer the exhaustiveness evaluation while any plan item is
    `in_progress` — must name what is outstanding instead.

## H. Triage of a captured PDF

60. Must not triage, rate, or report results from a capture that has not
    arrived. Fabricating matches is the worst failure this skill has.
61. On a capture-present turn, must list each result with name, age/birth
    year, location, record type, and any visible record ID.
62. Must classify the source as index / digitized original / user-contributed
    before rating anything.
63. Must rate every result and give the reason — must not bulk-accept or
    bulk-reject.
64. Must not send the raw search-results PDF to `record-extraction`. The user
    picks which single record is worth examining, and that single-record PDF is
    what gets handed on.
65. For a user-contributed source, must separate photographed evidence from
    contributor-entered text, and must never cite it as primary.

## I. Autonomous mode

66. Under `--autonomous` must not present a URL and wait, and must not end the
    turn asking for a capture.
67. Must prefer a FamilySearch equivalent first and route to `search-records`
    when one exists.
68. Otherwise must still build the URL, log it `outcome: "negative"`,
    `resultsExamined: 0`, `captureReceived: false`, with `notes` stating the
    search was **deferred — requires an interactive user capture**, and the
    URL recorded.
69. Must mark the plan item `skipped` and return to the orchestrator without
    waiting.

## J. Access and repositories

70. `researcher_profile.subscriptions` is a tie-breaker, never a gate. Must
    not refuse to generate a URL for a site the researcher lacks access to.
71. Must flag the access gap in one line and offer the choice — flag, don't
    block.
72. Must not pester about access when the profile is absent or
    `subscriptions: ["none"]`.
73. Must not treat a negative *online* result as proof a record does not
    exist — `references/repository-types.md` lists five readings of a nil and
    only one is absence.
74. Must not rule a repository out on its name. Libraries hold manuscripts;
    archives hold published works.
