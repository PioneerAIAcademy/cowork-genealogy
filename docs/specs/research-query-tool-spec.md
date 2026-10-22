# `research_query` — filtered research.json read — Spec

> **Status:** New (2026-07-26, tree-materialization latency follow-up). Read-only
> sibling of `project_context` (`project-context-tool-spec.md`) — a second
> read-side tool, not an extension of the first (see §3 for why).
> **Updated 2026-08-03:** added `offset` pagination so items 51+ are reachable
> (the tool half; the skill half has since landed).
> **Updated 2026-10-06 (T2.1, `docs/plan/cost-latency-10x.md` Wave 1):** `log`
> takes `questionId`, so one call returns every log entry for a question's plan
> items instead of one `planItemId` call per item (§3, "A cross-section filter").
> **Updated 2026-10-14 (T2.3):** `personId`, `assertionId`, `sourceId` and
> `recordId` also take a list of ids, and a list call returns `countById`; every
> non-string filter value is now rejected (§3, "Plural ids, not plural sections").

```
research_query({ projectPath, section, ...well-known filters }) -> { count, items, truncated, countById? }
```

---

## 1. Why this exists

`project_context` already exists to stop one re-read pattern (the
record-extractor's (since retired) fresh-context `Read` of the whole project on every
delegation). It deliberately does **not** cover per-assertion detail or any
other section body (`project-context-tool-spec.md` §3: "no assertion bodies —
deliberately excluded"), because its consumers need a stable, small,
unfiltered orientation snapshot, not a lookup.

A different pattern showed up in the 2026-07-26 batching-work verification
run: a wilkins-marriage e2e run made **53 `Read` calls on
research.json**, including hand-paginated reads (`offset: 850/1500/2000/2500`)
immediately before the run's single longest generation gap (385s) — almost
certainly a skill (person-evidence, proof-conclusion, or
research-exhaustiveness; not the record-extractor) reviewing accumulated
evidence for a specific persona/question/person before writing a conclusion.
`research.json` grows monotonically over a session exactly like the file
`project_context` was built to stop re-reading — this is the same class of
cost, in skills `project_context` doesn't serve, for content
`project_context` deliberately omits.

## 2. The tool

```typescript
research_query({
  projectPath: string,
  section: "questions" | "plans" | "log" | "sources" | "assertions"
         | "person_evidence" | "rejected_links" | "conflicts" | "hypotheses" | "timelines"
         | "proof_summaries" | "evaluations" | "localities" | "namesakes"
         | "external_collections",   // reads external-collections.json, not research.json — §2.4
  orderBy?: "review",            // person_evidence only — §2.5
  // well-known filters — only some apply to a given section; see §2.1.
  // The four id keys also take a list (≤50 ids) — §2.1, "Lists of ids".
  recordId?: string | string[],
  recordRole?: string,
  sourceId?: string | string[],
  questionId?: string,
  personId?: string | string[],
  assertionId?: string | string[],
  planItemId?: string,
  status?: string,
  targetId?: string,
  focus?: string,
  // pagination (NOT a filter): skip the first `offset` matches, then return up
  // to 50. Applies to every section; absent ⇒ 0. See §2.2.
  offset?: number,
})
```

Read-only: opens `research.json` only (no `tree.gedcomx.json`), writes
nothing. Not a validator — a malformed section (present but not an array) is
a reported error, but malformed *items* within a valid array are not
inspected; `validate_research_schema` remains the diagnosis tool.

### 2.1 Supported filters per section

| Section | Filter | Matches (item field) | Mode |
|---|---|---|---|
| `questions` | `questionId` | `id` | exact |
| | `status` | `status` | exact |
| `plans` | `questionId` | `question_id` | exact |
| | `status` | `status` | exact |
| `log` | `planItemId` | `plan_item_id` | exact |
| | `questionId` | `plan_item_id` ∈ the item ids of every plan whose `question_id` is the value | via plan |
| `sources` | `sourceId` | `id` | exact |
| `assertions` | `assertionId` | `id` | exact |
| | `recordId` | `record_id` | exact |
| | `recordRole` | `record_role` | exact |
| | `sourceId` | `source_id` | exact |
| | `questionId` | `extracted_for_question_ids` | contains |
| `person_evidence` | `personId` | `person_id` | exact |
| | `assertionId` | `assertion_id` | exact |
| `rejected_links` | — | — | no filters; the whole section is small by construction |
| `conflicts` | `assertionId` | `competing_assertion_ids` | contains |
| | `questionId` | `blocks_question_ids`, OR a `competing_assertion_ids` entry whose assertion's `extracted_for_question_ids` contains the value — the link the completion gate derives; any status, so a resolved conflict (whose `blocks_question_ids` is empty) still answers for its question | via assertions |
| | `status` | `status` | exact |
| `hypotheses` | `questionId` | `related_question_ids` | contains |
| | `assertionId` | `supporting_assertion_ids` OR `contradicting_assertion_ids` | contains-either |
| | `status` | `status` | exact |
| `timelines` | `personId` | `person_ids` | contains |
| `proof_summaries` | `questionId` | `question_id` | exact |
| | `assertionId` | `supporting_assertion_ids` | contains |
| `evaluations` | `targetId` | `target_id` | exact |
| | `focus` | `focus` | exact |
| `localities` | *(none)* | — | — |
| `namesakes` | `personId` | `person_id` | exact |
| `external_collections` | `place` | `place` | the place or any enclosing jurisdiction |
| | `recordType` | `record_types` | case-insensitive substring of any |

**Sections not served, and why.** A completeness test
(`tests/tools/research-query.test.ts`) derives the list of top-level array
sections from `docs/specs/schemas/research.schema.json` at runtime and fails if
any is neither queryable nor named here — so a section added later cannot go
silently unreadable — the defect that let `localities` stay unreadable long
enough to reach a user.

| Section | Why not |
|---|---|
| `known_holdings` | Write-only, and slated for deletion from the schema — exposing it would create a contract that deletion then has to remove. |
| `warning_justifications` | Writer-tool only: the warning gate appends it as a side effect of a justified write. |
| `project` | An object, not an array. This tool pages arrays. |
| `researcher_profile` | An object, not an array. |

Supplying a filter not in this table for the chosen `section` is a rejected
call (`'<key>' is not a supported filter for section '<section>'`), not a
silent no-op — a caller who mistypes or mis-targets a filter gets an
actionable error, not a confusingly-empty (or confusingly-unfiltered) result.

**Lists of ids.** `personId`, `assertionId`, `sourceId` and `recordId`
(`PLURAL_KEYS` in `research-query.ts`) take a string **or** a list of strings,
on every section whose row above names them, with the same field and mode. A
list matches an item when **any** of its ids would: `exact` becomes "the field
is one of the ids", `contains` and `contains-either` become "the array holds
any of them". Other filters on the same call still AND, so
`{section: "assertions", recordId: ["R1", "R2"], recordRole: "principal"}` is
the principal personas of both records.

- A string whose trimmed form starts with `[` is parsed as JSON and used as the
  list — every recorded plural attempt arrived stringified. It must parse to an
  array of non-empty strings, or the call is rejected. No recorded id starts
  with `[`. On every other key such a string stays one value unless it parses as a JSON array, which is rejected like a list.
- A list must hold 1–50 distinct non-empty strings (duplicates collapse
  silently); only one filter per call may be a list. Every rejection is in §4.
- Items come back in document order, each once even when it matches several
  ids, and page exactly as a singular answer does.

### 2.2 Return value

```typescript
{
  ok: true,
  section: string,
  count: number,      // total matches, BEFORE the 50-item page cap and any offset
  items: any[],        // the section's native snake_case fields, verbatim — a
                        // read projection, not a persisted document, so no
                        // camelCase rename (contrast project_context, whose
                        // fixed shape IS a wire surface)
  truncated: boolean,  // true when matches remain beyond this page
                        // (count > offset + items.length)
  countById?: { [id: string]: number },
                        // list calls only — see below
  unregisteredDisagreements?: { personId, fact, assertionIds }[],
                        // `conflicts` only — see below
}
// on failure: { ok: false, errors: string[] }
```

**A list call also returns `countById`:** for every requested id, zeros
included, the number of matching items, counted over the whole match set — not
the page — so it is identical on every page. `countById[id]` equals the `count`
the singular call for that id (with the same other filters) would answer, which
keeps "an empty result IS the answer" true per id even when the list answer
pages or holds other ids' items. On the `contains`-mode sections (`conflicts`,
`hypotheses`, `timelines`, `proof_summaries`) an item naming two listed ids
counts under both, so the values **can sum above `count`**; `count` stays the
number of distinct items. A singular call never carries the key.

**`conflicts` also returns `unregisteredDisagreements`:** linked assertions that
disagree on a birth or death place or year with no `conflicts` entry naming the
pair, computed by `unregisteredDisagreements()` in `utils/question-state.ts` —
the same detector behind `project_context`'s `questionStatuses`. `count` covers
registered entries only, and the router read `count: 0` as "no evidence
conflicts" and skipped `conflict-resolution` while two disagreements sat
unregistered (`ut_research_h22`). Scope: the question's own assertions
(`extracted_for_question_ids`) under `questionId`, otherwise every assertion;
narrowed to those naming `assertionId` (any of them, for a list); omitted under a `status` filter other
than `unresolved`, since an unregistered disagreement has no other status. The
field does not page — `offset` and the 50-item cap apply to `items` alone.

Each call returns at most 50 items (`MAX_ITEMS` in `research-query.ts`). A
caller that hits `truncated: true` either narrows the filter or **pages**: set
`offset` to 50, then 100, and so on, until `truncated: false`. `offset` skips
the first N matches of the *filtered* set — it is pagination, not a filter, so
it is absent from the §2.1 table and applies to every section uniformly.
`count` stays the true total throughout, so the next page's `offset` is simply
`offset + items.length`. `offset` must be a non-negative whole number and is
rejected (not coerced) otherwise — see §4. Omitting every filter returns the
whole section, one 50-item page at a time.

### 2.4 `external_collections`

The curated external collections `external_links_search` stored for this project
(`external-links-search-tool-spec.md`, "Stored list"). Served from
`external-collections.json`, not `research.json`: it is not a schema section, so
it is in neither the schema-derived completeness lists nor
`RESEARCH_QUERY_OPTIONAL_SECTIONS`, and it has its own branch that runs before
the `research.json` read. `no_project` is answered the same way as every other
section.

Each item is one stored row — `{ key, url, link_text, record_types, place, cost,
content_type, start_year, end_year }` — and carries its own `place`. Items are
ordered by place, then key; the order is sorted at read time, because a
jsonb-backed store does not keep the written key order.

- **`place`** matches the place and every enclosing jurisdiction, by dropping
  leading comma segments: `Venango, Pennsylvania, United States` returns rows of
  that county, of `Pennsylvania, United States` and of `United States` — and never
  of a sibling county.
- **`recordType`** is a case-insensitive substring of any of a row's
  `record_types`. FamilySearch's record types are free text (one Pennsylvania
  page holds `Cemeteries` and `Cemetery Records`, `Marriage` and `Marriages`), so
  a substring is the honest match; there is no mapping table.

`count: 0` does not say whether a place was fetched: no file, a fetched place
with `rows: []`, and a place name in another form (`Pennsylvania` for the stored
`Pennsylvania, United States`) all answer it. To tell "fetched, nothing here"
from "never fetched", read `project_context`'s `externalCollections`, which lists
every fetched place, `total: 0` included.


### 2.5 `orderBy: "review"` — ordering `person_evidence` by consequence

By default `items` are in document order, and that is deliberate: it is what every
committed run replays against, so changing it rewrites recorded truth.

`orderBy: "review"` orders `person_evidence` by how much a wrong link would cost —
a recorded `core_identifier_conflict` first, then `speculative` over `probable` over
`confident`, then a missing `match_score`. It only matters because of paging: a run
that wrote 311 links shows 50 at a time, so the ordering decides which links a
reviewer ever sees.

The response then carries `reviewReasons`, keyed by link id, naming why each ranked
link sits where it does — a rank with no reason is a number to distrust. Links with
nothing notable carry no entry, and the key is absent when none do.

Ignored for every other section: a plan's items are sequenced, and reordering them
would destroy meaning rather than add it.

## 3. Decisions recorded

**`assertionId` means two different things, and only one of them is "the
assertion itself".** On `assertions` it matches the item's own `id`; on
`person_evidence`, `conflicts`, `hypotheses` and `proof_summaries` it matches a
field holding *references* to an assertion (`assertion_id`,
`competing_assertion_ids`, `supporting`/`contradicting_assertion_ids`,
`supporting_assertion_ids`). One parameter name, five fields, two meanings.

Before the filter was added the allow-list throw carried that distinction for free: a caller
who meant `person_evidence` and wrote `assertions` got
`'assertionId' is not a supported filter for section 'assertions'` and
self-corrected. That error is now gone, and the wrong section returns a
plausible `count: 1` holding the assertion body — which has no `person_id` and
no `confidence`, so a caller using the "an empty result IS the answer: unlinked"
idiom reads a hit as "already linked". The filter was still worth adding (26
measured mis-calls on main came from its absence), but the trade is real and is
recorded here rather than discovered.

The field is `id`, never `assertion_id` — an assertion object has no such key,
so that rule would be accepted and match nothing, ever.

- **A second tool, not an extension of `project_context`.** `project_context`
  is one fixed, unfiltered projection for one consumer (the record-extractor's
  startup) — extending it with per-call scoping parameters would either (a)
  change its return shape conditionally, breaking the "one stable shape" the
  record-extractor's prompt is written against, or (b) grow it into exactly
  the query surface it exists to avoid needing. A second, narrowly-scoped
  tool keeps both contracts simple.
- **Named, allow-listed filters — not a generic `{field: value}` query.**
  `project_context`'s spec already rejected "jq-style path parameters" as
  "open-ended context cost, un-promptable" (§3 there). This tool's filters are
  a small, fixed, documented set (mirroring `record_search`'s structured
  params, not a free-text query language), validated per-section — the same
  reasoning that rejected an open-ended query surface for `project_context`
  would reject one here too. What's different from that prior rejection is
  scope: twelve named parameters across fourteen sections, not an arbitrary path
  language.
- **No filter on `localities`, deliberately.** None of the ten existing
  filter keys maps onto a locality field, so a filter would mean a new MCP
  tool parameter; and there is one entry per place-jurisdiction, so the whole
  section fits inside a single 50-item page. Querying it returns everything,
  and any filter argument is rejected with the standard "(this section takes
  no filters)" error.

- **No `superseded_by` filter on `evaluations`, deliberately.** `targetId` +
  `focus` narrow to the verdicts about one target; picking the *live* one
  (`superseded_by: null`) stays the caller's step. The filter layer compares a
  string against a field (`matches()`), and `superseded_by` is `string | null`
  — expressing "is null" would need either a sentinel (`"null"`, ambiguous
  against a real `ev_` id) or a second filter *kind*. Neither is worth it for a
  result set that is a handful of entries by construction: one target, one
  focus. `gps-mentor.md`'s existing-verdict skip states the null-check step
  explicitly so it cannot be forgotten, and
  `tests/tools/research-query.test.ts` pins the boundary.
- **Verbatim snake_case `items`, not a camelCase projection.** Unlike
  `project_context`'s curated fields (which ARE a wire surface, so camelCase
  per the repo's casing rule), this tool returns the underlying section
  entries as-is — the caller is asking "what does research.json currently
  say," not requesting a designed output shape. Renaming per-section fields
  here would mean maintaining thirteen bespoke projections instead of one
  filter layer.
- **No `tree.gedcomx.json` access.** The observed cost (§1) was
  `research.json` re-reads specifically; tree re-reads were an order of
  magnitude lower in the same runs. Out of scope until evidence says
  otherwise.
- **50-item page cap + `offset` pagination — not a raised cap, a `fields`
  projection, or a staged-to-disk fallback.** The page size stays 50
  (`MAX_ITEMS`); `offset` reaches items 51+. This closes a silent-wrong-answer
  path: proof-conclusion's "collect every assertion" gate once read 50 of 57
  matches and could write a proof summary from the truncated set, with neither
  the skill, the validator, nor the judge able to tell. Three alternatives were
  weighed and rejected:
  - **`limit` + `offset`** reopens "just raise the cap," which this section
    already decided against — the source of truth is on disk, so an unbounded
    page is only a second copy of data the caller already has file access to.
    `offset` with a fixed page keeps that decision intact.
  - **A `fields` projection** (return only some keys per item) is more elegant
    but does not close the gate alone: proof-conclusion's Step 2 needs
    `information_quality`, `record_basis`, `informant`, and
    `informant_proximity` per assertion — most of the body — so trimming fields
    would not shrink the payload enough to fit 57 in one call.
  - **A staged-to-disk fallback** (as `fulltext_search` uses, because *its*
    source is a live one-shot API response) is unwarranted
    here for the same on-disk reason.

  `offset` is typed `number` and rejected loudly when it is not a non-negative
  whole number (§4). The **tool** supports paging, and the **skill half**
  has landed: `research/SKILL.md` and `agents/proof-conclusion.md`
  both check `truncated` and page with `offset`. A tool-only fix would not have
  cleared the reported symptom on its own.

- **A cross-section filter on `log`, not a nested join (2026-10-06, T2.1).**
  `research-exhaustiveness` reads a question's log by walking it: one
  `log × planItemId` call per plan item, the ids handed to it by its own previous
  read (224 of 250 cases). Over the 27 runs recording answer sizes that is 45
  walks, 222 calls, 42 of them that agent's; one `log × questionId` call per walk
  (two where a question passes 50 entries) replaces about 219 of them with ~50.
  A nested `include: "log"` on `plans` was rejected: it makes the answer's shape
  depend on the arguments, and its own overflow needs this filter anyway.
  Assertions are deliberately not nested: no recorded call walks to them, and
  9 of 30 questions carry more than 50. The answer is **larger** than the walk
  (≈ +37%: it returns every entry for the question, where the walk read 3–5 of
  ~8 items), so the gain is calls and turns, not characters. An unfiltered
  `log` read already returns the whole log in one call and agents make it 59
  times against 428 walk calls — the walk is a model choice, so whether this
  filter changes it is measured, not assumed.

- **Plural ids, not plural sections (2026-10-14, T2.3; ruling 2026-10-10,
  Promise).** `section` stays one string — a call that bundles sections makes
  the answer's shape depend on the arguments, the reason T2.1's nested
  `include` was rejected — and the `sections` near-miss message is unchanged.
  What is plural is the id: `personId`, `assertionId`, `sourceId`, `recordId`.
  - *The demand.* All 11 recorded plural attempts (1 in the e2e corpus, 10 in
    unit logs, counted for the T2.3 plan) asked for several **sections** and
    arrived **stringified**; no recorded call passed a list of ids or any other
    non-string filter value (0 of 39,085 e2e tool calls at `a9d57123d`, none in
    the unit logs), because the tool gave no way to. The walk is what agents do instead: `make replay-collapse
    RULE=plural-id` finds, over the 32 tracked runs carrying answer sizes at
    `a9d57123d`, 165 runs of strictly adjacent same-thread calls differing in one
    of these keys. 146 replay faithfully and collapse **402 calls to 157**
    (−245): 101 non-empty groups 272 → 112 and 45 empty ones 130 → 45. Callers
    are person-evidence 186 → 67, research-exhaustiveness 111 → 51,
    proof-conclusion 90 → 33. Every group is on an exact-match section
    (`person_evidence × personId|assertionId`, `assertions × recordId|assertionId`,
    `sources × sourceId`), so replay proves that path only; the `contains`-mode
    sections are proven by `tests/tools/research-query.test.ts`. On the 8 runs
    whose timeline carries message ids, most members were already sent in one
    message, so turns fall far less than calls (9 over 40 groups).
  - *Why only these four keys.* They are the keys agents walk one id at a time.
    `planItemId`'s walk is answered by T2.1's `log × questionId`; `questionId`,
    `status`, `recordRole`, `place` and `recordType` narrow rather than
    enumerate, and no recorded walk varies them.
  - *Why `countById`, given the shape rule above.* It is the second key whose
    presence depends on the request; `unregisteredDisagreements`, present only
    on `conflicts` reads, is the first. Neither changes what `items` holds:
    `countById` is a count of the same section's items, not another section's
    body, so a caller that ignores it reads exactly the singular contract. It
    exists because a flat list answer otherwise loses "0 means unlinked" per
    id — person-evidence's idiom — once the answer pages or holds other ids'
    items, and because without it the replay cannot tell a pre-T2.3 build's
    silent `count: 0` from a right empty answer on 45 of 146 groups. Per-id
    counts can sum above `count` on `contains` sections (§2.2).
  - *Non-strings are now rejected.* The server does not validate
    `inputSchema`, and `matches()` compared with `===`, so before this a list —
    real or stringified — answered `ok: true, count: 0`, and `planItemId: null`
    matched every log entry with a null plan item (21 on anders-monsen's
    2026-09-16 final notes), which §4 never documented. Every non-string,
    non-list value on every key is now an error; no recorded call sends one, so
    the change breaks no observed caller.
  - *Union types.* Each of the four properties is typed
    `["string", "array"]` with `items: { type: "string" }`. Unions already ship:
    `research_log_append` uses `["string", "null"]` (the null case) and
    `convert_calendar` `["number", "string"]`, and both load on every registrar
    we run. An array branch has not yet been seen on a live gateway call.
  - *Cost.* The schema grows 5,103 → 5,393 chars (a ≈150-char sentence on the
    tool description and a type-only union on the four properties; no
    property-description text). At ≈ 80–110 tokens, read ≈ 174 times a run at
    $0.30/MTok and written ≈ 19 times at $6.00/MTok, that is ≈ $0.013–0.018 per
    run, on every run, because the tool is in `ALWAYS_LOAD`. The saving depends
    on agents adopting the list form, which is measured on panel runs, not
    assumed.

## 4. Errors / edge cases

| Condition | Behavior |
|---|---|
| `section` not one of the fourteen supported values | `{ ok: false, errors }` |
| `section: "external_collections"` and no `external-collections.json` yet | `{ ok: true, count: 0, items: [], truncated: false }` — nothing has been fetched for this project |
| `external-collections.json` is invalid JSON, or not an object holding a `places` object | `{ ok: false, errors }` |
| A supplied filter not in that section's allow-list (§2.1) | `{ ok: false, errors }` naming the filter and the section |
| A filter value that is neither a string nor (on the four id keys) a list — a number, boolean, object or `null` | `{ ok: false, errors }` (`'<key>' must be a string …`). Before T2.3 these answered `ok: true` with `count: 0`, and `null` matched items whose field was `null` |
| `planItemId: null` | `{ ok: false, errors }` — **changed** in T2.3; it used to return every log entry with a null `plan_item_id`, an undocumented behaviour no recorded call relied on |
| A list on a key other than `personId`, `assertionId`, `sourceId`, `recordId` | `{ ok: false, errors }` naming the four keys that take one |
| An empty list (`[]` or `"[]"`), an element that is not a non-empty string, or more than 50 distinct ids | `{ ok: false, errors }` |
| A string on one of the four keys that starts with `[` but is not a JSON array of non-empty strings | `{ ok: false, errors }` — never read as one id |
| Two list-valued filters in one call | `{ ok: false, errors }` naming both |
| A list repeats an id | collapses silently: one `countById` key, each item once |
| `projectPath` is a real directory holding **neither** project file | `{ ok: false, reason: "no_project", errors }` — the user is not in a research project, so this is an answer rather than a failure and is **not** marked `isError`. One of the two reads that owed this. See the write-boundary invariants in `guardrail-enforcement-spec.md` |
| `research.json` missing or invalid JSON — with `tree.gedcomx.json` present, i.e. a *broken* project | `{ ok: false, errors }`, loud |
| An **optional** section (one the schema does not list as `required` — today `localities`, `namesakes` and `rejected_links`) is absent from a `research.json` that is otherwise a well-formed object | `{ ok: true, count: 0, items: [], truncated: false }` — a legitimate answer. `localities` postdates most projects: 90 of the 102 committed fixtures have no such key, and erroring on those is what stopped an agent re-reading locality findings it had just written. A project carries `namesakes` only once a namesake is recorded. |
| A **required** section is missing, or any section is present but not an array, or `research.json` parses to something that is not an object (`null`, an array, a string, a number) | `{ ok: false, errors }` |
| `log` × `questionId`, `plans` missing or not an array | `{ ok: false, errors }` — `plans` is a required section, so its absence is a corrupt document, never a `count: 0` |
| `log` × `questionId`, an entry with `plan_item_id: null` | never matches (the walk could not reach it either) |
| `log` × `questionId`, a plan item on a non-`active` plan | included — `research-exhaustiveness` treats those as audit trail and filters itself |
| No filters supplied | the whole section, one 50-item page (page with `offset` for the rest) |
| No items match | `{ ok: true, count: 0, items: [] }` — a legitimate answer, not an error |
| More than 50 matches, no `offset` | `items` is the first 50; `count` is the true total; `truncated: true` |
| `offset` present and not a non-negative whole number — **including a string like `"50"`** | `{ ok: false, errors }`, rejected loudly, **not coerced**. `index.ts` passes tool arguments through without type-coercion, so a model that sends `offset: "50"` (as one did — hannah-earnest-children idx 79) reaches the tool as a string and `Number.isInteger` rejects it. This mirrors `person_search.offset`'s validation. The old behavior silently ignored the unknown key and returned the *first* page — a wrong answer wearing `ok: true`; the loud rejection is the fix, and the caller (once the skill half teaches it) sends a real number. |
| `offset` past the last match | `{ ok: true, count: <total>, items: [], truncated: false }` — a legitimate empty page, not an error |
| `offset` set, matches remain beyond the returned page | `items` is the (≤50) slice at `[offset, offset+50)`; `count` is the true total; `truncated: true` |
