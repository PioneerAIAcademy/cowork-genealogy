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
> **Updated 2026-11-17 (budget paging):** pages are sized by a 40 000-character budget
> (greedy fill to `MAX_ITEMS=50`) rather than a fixed count; the result now
> carries `nextOffset` when `truncated` is true, and callers must use it rather
> than stepping by a fixed number; offsets that do not land on a greedy page
> boundary are refused with the nearest valid start.
> **Updated 2026-11-17 (grouped assertions):** `assertions` items are grouped by
> persona — the five keys a persona's facts repeat are hoisted onto one group,
> and a `questionId` read drops the `[questionId]` echo. Lossless; counts still
> count assertions (§2.2, "Assertions are grouped by persona").

```
research_query({ projectPath, section, ...well-known filters }) -> { count, items, truncated, nextOffset?, countById? }
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
         | "hit_verdicts"
         | "external_collections",   // reads external-collections.json, not research.json — §2.4
  orderBy?: "review",            // person_evidence only — §2.5
  // well-known filters — only some apply to a given section; see §2.1.
  // personId, assertionId, sourceId, recordId and conflictId also take a list (≤50 ids) — §2.1, "Lists of ids".
  recordId?: string | string[],
  recordRole?: string,
  sourceId?: string | string[],
  questionId?: string,
  personId?: string | string[],
  assertionId?: string | string[],
  conflictId?: string | string[],
  planItemId?: string,
  status?: string,
  targetId?: string,
  focus?: string,
  // pagination (NOT a filter): skip the first `offset` matches, then return up
  // to 50. Applies to every section; absent ⇒ 0. See §2.2.
  offset?: number,
  // assertions only (NOT a filter): true also returns assertions a re-extraction
  // retired (non-null `superseded_by`, research-schema-spec.md §5.6). Absent ⇒
  // they are left out, since they are not evidence. Not a boolean ⇒ refused.
  includeSuperseded?: boolean,
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
| `conflicts` | `conflictId` | `id` (also a list) | exact |
| | `assertionId` | `competing_assertion_ids` | contains |
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
| `hit_verdicts` | `personId` | `person_id` | exact |
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
| `warning_justifications` | Writer-tool only: the warning gate appends it as a side effect of a justified write. |
| `project` | An object, not an array. This tool pages arrays. |
| `researcher_profile` | An object, not an array. |

Supplying a filter not in this table for the chosen `section` is a rejected
call (`'<key>' is not a supported filter for section '<section>'`), not a
silent no-op — a caller who mistypes or mis-targets a filter gets an
actionable error, not a confusingly-empty (or confusingly-unfiltered) result.

**Lists of ids.** `personId`, `assertionId`, `sourceId`, `recordId` and `conflictId`
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
  count: number,      // total matches, BEFORE the page cap and any offset
  items: any[],        // the section's native snake_case fields, verbatim but
                        // for the two omissions below, and grouped by persona
                        // on `assertions` (below) — a read projection, not
                        // a persisted document, so no camelCase rename
                        // (contrast project_context, whose fixed shape IS a
                        // wire surface)
  truncated: boolean,  // true when matches remain beyond this page
  nextOffset?: number, // next valid page start; present iff truncated is true
  countById?: { [id: string]: number },
                        // list calls only — see below
  unregisteredDisagreements?: { personId, fact, assertionIds }[],
                        // `conflicts` only — see below
}
// on failure: { ok: false, errors: string[] }
```

**Assertions are grouped by persona.** On `assertions`, `items` is a list of
groups. A group is a maximal run of *consecutive* matching assertions, in the
section's order, that share all five of `record_id`, `record_persona_id`,
`record_role`, `source_id` and `log_entry_id` — a key absent from an assertion is
a different value from `null`:

```typescript
{ record_id?, record_persona_id?, record_role?, source_id?, log_entry_id?,
  facts: [ { id, ...every other field of one assertion } ] }
```

- The group carries only the hoisted keys its assertions carry; an absent key
  stays absent, never written as `null`.
- Exactly those five are hoisted. `informant` and `informant_proximity` stay on
  each fact: over the 15,793 assertions in `eval/runlogs/e2e/*/*.final-research.json`
  (2026-11-17), `informant` differs inside 1,160 of the 2,062 multi-fact groups
  whose `record_persona_id` is a value. `record_document_id` never varied inside a
  group but is on only 1,410 of those assertions, so it stays per fact too.
- On a `questionId` read, a fact omits `extracted_for_question_ids` when it is
  exactly `[questionId]`. Every hit of that read contains `questionId` (the filter
  is `contains`), so the omission is lossless.
- `count`, `offset`, `nextOffset`, `countById` and `MAX_ITEMS` count assertions,
  never groups. A persona split across a page boundary repeats its keys at the top
  of the next page.
- The page budget is measured on the groups actually emitted: opening a group
  costs the whole one-fact group, continuing one costs a comma and the fact.
- `flattenAssertionGroups` (exported from `research-query.ts`) is the inverse: it
  returns the flat assertions, deep-equal to the stored ones, key order aside.
  `replay_collapse.py`'s `_flatten_items` restates it for the replay harness.

Measured with `make replay-sizes BASE=<pre-change> TOOLS=research_query
SECTION=assertions` over the 651 recorded assertion reads that answered (of 653
replayed), the grouped answers are 20.1% smaller;
a single-assertion read grows by the 14 characters of its one-fact wrapper.

**Misreads (probe, 2026-11-17).** `eval/harness/scripts/probe_assertion_shape.py`
replays the 24 largest recorded assertion reads (at most two per run) on the pre-change build (flat)
and on this one (grouped), and asks each assertion reader's model, by assertion
id, for `information_quality`, `record_basis`, `informant`,
`informant_proximity` and `record_persona_id` on 192 sampled assertions: 960
answers per shape per model. Misreads out of 960:

| model (effort) | system prompt holds the tool description | flat | grouped |
|---|---|---|---|
| claude-sonnet-5 (medium) | no | 0 | 0 |
| claude-sonnet-5-5 (medium) | no | 1 | 0 |
| claude-haiku-5-5 (low) | no | 0 | 11 |
| claude-sonnet-5 (medium) | yes | 1 | 3 |
| claude-sonnet-5-5 (medium) | yes | 0 | 3 |
| claude-haiku-5-5 (low) | yes | 0 | 1 |

Without the description, Haiku read a group's `record_persona_id` as absent on
every fact of one page (8 of its 11). With it — as every real reader has it — the
grouped misreads are one adjacent persona id and a single pattern: the one fact
in a group whose informant differs from the rest (a census residence attested by
the enumerator among facts from a household member) read with the group's
majority values. That is why the description says each fact holds its own fields.

**Eval gate.** All eight `assertions` readers gate the shape, since
`research_query` runs live from the compiled build in the unit harness: a new fail
in any of them sends assertions back to flat. Scratch runs on this build, against
each suite's committed rate (`make eval-health`): research-exhaustiveness 20,
timeline 13, conflict-resolution 14, search-hints 11, search-full-text 18 — 69
pass, 7 partial, no fail or abort — and person-evidence 36 — 29 pass, 7 partial,
no fail. Committed runs, for the two agents whose paging line this shape
reworded: proof-conclusion 26 (23 pass, 3 partial, no fail) and gps-mentor 2
(2 pass).

person-evidence's two `research_query` lines ("group the items by `record_id` +
`record_role`", and paging "until you hold `count` items") were left as they
are, though both read stale against groups. On `ut_person_evidence_027`
(Haiku 5.5 low), main's text linked a_012 `confident` in 4 of 7 runs, and any
edit to either line did so in 0 of 22, on the flat and grouped builds alike.

**Two fields are left out of `items`.** An item of a plan that is not active
(`superseded` or `completed`) carries no `rationale`, except a `skipped` item
with no `skip_category`. Every item of an active plan keeps its `rationale`,
`completed` and `skipped` ones included, and a plan with no `status` counts as
active, as in `question-state.ts`. Every other field of an item is as stored,
`skip_category` and `skip_reason` included. A `log` entry carries no
`staged_ref`. Both are left out of the answer only, never out of
`research.json`.

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

Each call returns at most 50 items (`MAX_ITEMS`) and at most `TOOL_RESULT_CHAR_BUDGET = 40 000` characters of JSON (measured as the cumulative `JSON.stringify` length of each item as emitted — on
`assertions`, of each group). The budget cap applies first: items are added greedily until adding one more would exceed the budget, so a page of large items may be fewer than 50. A caller that hits `truncated: true` either narrows the filter or **pages**: set `offset` to `nextOffset` (returned in the result) and repeat until `truncated: false`. `offset` skips the first N matches of the *filtered* set — it is pagination, not a filter, so it is absent from the §2.1 table and applies to every section uniformly. `count` stays the true total throughout. `offset` must be a non-negative whole number **and must land on a greedy page boundary** (i.e., be a valid `nextOffset` returned by a prior call, or 0); any other value is rejected with the nearest valid start below it — see §4. Omitting every filter returns the whole section, one budget-capped page at a time.

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

The response then carries `reviewReasons`, keyed by link id, naming why each link
on the returned page sits where it does — a rank with no reason is a number to
distrust. Links with nothing notable carry no entry, and the key is absent when none
on the page do. A link on another page has its reason on that page.

Ignored for every other section: a plan's items are sequenced, and reordering them
would destroy meaning rather than add it.

### 2.6 `settledConflicts` — settled birth disputes behind `person_evidence` links

A `person_evidence` read returns `settledConflicts` when a settled fact conflict set
aside a birth place or birth date of a linked record person and that value differs
from the tree person's Birth fact:

```json
"settledConflicts": [
  { "linkIds": ["pe_004", "pe_005"],
    "notes": ["Conflict 'c_001' already set aside this record's birth place \"Pennsylvania\" (assertion 'a_012'), which differs from the tree person's. It is settled: not a contradiction, and not a reason to lower or withhold this link."] }
]
```

- The sentences are `settledBirthDisputes`'s (`src/utils/settled-birth-disputes.ts`),
  the ones `same_person` returns (`docs/specs/same-person-tool-spec.md`,
  "`settledConflicts`"). A review of existing links reads them here and never calls
  `same_person`, so this is the call that tells it the disagreement is settled.
- Computed for the live links on the returned page only. Links whose sentences are
  identical share one row, so the links of one record person cost one row.
- Absent when no link on the page has one. A project with no `resolved` or `moot`
  fact conflict skips the tree read. An unreadable tree yields none, and the links
  still come back.
- `person_evidence` only.

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

**A conflict is read by its own id with `conflictId`, and an id of the wrong
kind is refused on every id filter.** On `conflicts`, `assertionId` matches the
competing assertions, so a conflict's own id there returned `count: 0`, which
reads as "no such conflict". In `ut_conflict_resolution_008` (conflict-resolution
`v4`, run 2) the agent read `c_001` that way and appended a duplicate of it.
`assertionId`, `conflictId`, `questionId`, `sourceId` and `planItemId` each take
one id prefix (`a_`, `c_`, `q_`, `src_`, `pli_`). A value that is a research.json
id of another kind (`<prefix>_<digits>` with a prefix `research_append` mints) is
refused, naming its kind and, when the section has a filter for that kind, the
filter to pass. Anything else, such as `a_002b`, a record ARK, or a tree person id,
is matched as before. `conflictId` takes a list like the other id filters, and
it scopes `unregisteredDisagreements` to the named conflicts' competing assertions.

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
  entries as-is, but for the two omissions under "Return value" — the caller is asking "what
  does research.json currently say," not requesting a designed output shape.
  Renaming per-section fields here would mean maintaining thirteen bespoke
  projections instead of one filter layer.
- **No `rationale` on an item of a plan that is not active, and no
  `staged_ref` on a log entry (lead, 2026-11-10).** A plan's items nest inside
  it with their full `rationale`, and a `questionId` read returns every plan
  the question ever had, completed and superseded ones included. In the hosted
  sessions of 2026-10-15 to 2026-11-08, every `research_query` answer large
  enough to be withheld from the model was that read, on a question with four
  plans. The largest one delivered was 48.4k characters and is 18.8k under
  this rule. Two withheld ones, rebuilt from the same question's plans, were
  54.8k and 58.9k and are 25.2k and 29.3k; the largest withheld one, 66.6k, is
  at most 37.0k even if all its growth was on the active plan. Over the repo's
  committed scenario and e2e `research.json` files, plans answers shrink by
  11%, and the largest is 13.9k, an active plan's.
  The active plan keeps every item's `rationale` because research-plan lists
  each item of the plan it reviews, disposes, edits, writes or recaps with its
  rationale in one clause, and that plan is the active one; the router and the
  agents that run an item read an open item of it too. A `skipped` item with
  no `skip_category` was written before that field existed, and its skip
  reason is in `rationale`, which research-exhaustiveness reads as the
  recorded reason; it keeps it on any plan. A skipped item that has a
  `skip_category` keeps `skip_category` and `skip_reason`, which is what
  research-exhaustiveness reads. `staged_ref` is `research_log_append`'s own
  record of the staged file an entry came from, and it reads it from
  `research.json` itself (`findLoggedStagedRef` in
  `utils/results-staging.ts`). There is no opt-in for either. `make
  replay-collapse`'s log oracle leaves `staged_ref` out the same way.
- **No `tree.gedcomx.json` access.** The observed cost (§1) was
  `research.json` re-reads specifically; tree re-reads were an order of
  magnitude lower in the same runs. Out of scope until evidence says
  otherwise.
- **50-item cap + 40 000-character budget paging — not a raised cap, a `fields`
  projection, or a staged-to-disk fallback.** The item cap stays 50 (`MAX_ITEMS`);
  pages are also bounded by `TOOL_RESULT_CHAR_BUDGET = 40 000` characters of JSON
  (measured as cumulative `JSON.stringify` length), so a page of large items may
  be fewer than 50. `offset` reaches later pages; callers must use `nextOffset`
  from the result rather than stepping by a fixed number, because page sizes vary
  with item size. This closes a silent-wrong-answer path: proof-conclusion's
  "collect every assertion" gate once read 50 of 57 matches and could write a
  proof summary from the truncated set, with neither the skill, the validator, nor
  the judge able to tell. Three alternatives were weighed and rejected:
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

  `offset` is typed `number`, rejected when not a non-negative whole number, and
  rejected when it does not land on a greedy page boundary (§4). The **tool**
  supports paging, and the **skill half** has landed: `research/SKILL.md` and
  `agents/proof-conclusion.md` both check `truncated` and page with
  `offset: nextOffset`. A tool-only fix would not have cleared the reported
  symptom on its own.

- **Assertions grouped by persona, consecutive runs only — not columnar, not
  merged across the page (2026-11-17).** Assertions are the largest share of what
  `research_query` returns, and within one persona the five hoisted keys repeat on
  every fact. Measured over the 651 recorded assertion reads that answered (of
  653 replayed) against the pre-change build (`make replay-sizes …
  SECTION=assertions`):

  | shape | smaller by |
  |---|---|
  | grouped, consecutive runs (shipped) | 20.1% |
  | grouped, every same-persona assertion on the page merged | 20.3% |
  | columnar, lossless (a group splits where the fact keys change) | 5.5% |
  | columnar, an absent field written as `null` (whole-section estimate) | ~33% |

  Merging across the page reorders assertions for 0.2 points, so a flattened
  page would no longer be the stored order. Columnar saves little losslessly,
  because assertions carry different optional fields; it nears its estimate only
  by writing absent fields as `null`, which loses the absent/`null` difference
  the grouped shape keeps.

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
  `include` was rejected — and the `sections` near-miss message is unchanged
  (`SECTIONS_NEAR_MISS`; over MCP `server.ts`'s unknown-argument guard answers
  it before the handler, a direct call with no `section` gets it from the handler).
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
  - *Non-strings are now rejected.* The server checks argument names, not
    types, and `matches()` compared with `===`, so before this a list —
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
| `section` not one of the supported sections | `{ ok: false, errors }` |
| `section: "external_collections"` and no `external-collections.json` yet | `{ ok: true, count: 0, items: [], truncated: false }` — nothing has been fetched for this project |
| `external-collections.json` is invalid JSON, or not an object holding a `places` object | `{ ok: false, errors }` |
| A supplied filter not in that section's allow-list (§2.1) | `{ ok: false, errors }` naming the filter and the section |
| `filters` or `filter` sent (filter arguments bundled in one object, stringified or not) | Refused by `server.ts`'s unknown-argument guard before the handler runs; the handler would ignore the key and read the whole section. The message says each filter is its own argument beside `section`, lists the filters the requested section takes (read from `SECTION_FILTERS`), and says a key outside that list does not exist there, so with none left the call reads the whole section. A section with no filters says so; with no known `section` it points to the tool description. The value is never unwrapped and run |
| `entryId` sent | Refused by the guard before the handler runs. On a section with a filter on an entry's own id (`questionId`, `sourceId`, `assertionId`, `conflictId`) the message names that filter; on any other section it says to drop `entryId` and read the section; with no known `section` it lists the sections that read one entry by its id. It never names a writer tool, where `entryId` is a parameter |
| `sections` sent | Refused by the guard before the handler runs, with `SECTIONS_NEAR_MISS`. A direct call gets the same text from the handler only when `section` is missing; with a valid `section` the handler ignores `sections` |
| A filter value that is neither a string nor (on the id keys that take one) a list — a number, boolean, object or `null` | `{ ok: false, errors }` (`'<key>' must be a string …`). Before T2.3 these answered `ok: true` with `count: 0`, and `null` matched items whose field was `null` |
| `planItemId: null` | `{ ok: false, errors }` — **changed** in T2.3; it used to return every log entry with a null `plan_item_id`, an undocumented behaviour no recorded call relied on |
| A list on a key other than `personId`, `assertionId`, `sourceId`, `recordId`, `conflictId` | `{ ok: false, errors }` naming the keys that take one |
| An empty list (`[]` or `"[]"`), an element that is not a non-empty string, or more than 50 distinct ids | `{ ok: false, errors }` |
| A string on one of those keys that starts with `[` but is not a JSON array of non-empty strings | `{ ok: false, errors }` — never read as one id |
| Two list-valued filters in one call | `{ ok: false, errors }` naming both |
| A list repeats an id | collapses silently: one `countById` key, each item once |
| `projectPath` is a real directory holding **neither** project file | `{ ok: false, reason: "no_project", errors }` — the user is not in a research project, so this is an answer rather than a failure and is **not** marked `isError`. One of the two reads that owed this. See the write-boundary invariants in `guardrail-enforcement-spec.md` |
| `research.json` missing or invalid JSON — with `tree.gedcomx.json` present, i.e. a *broken* project | `{ ok: false, errors }`, loud |
| An **optional** section (one the schema does not list as `required` — today `localities`, `namesakes`, `rejected_links` and `hit_verdicts`) is absent from a `research.json` that is otherwise a well-formed object | `{ ok: true, count: 0, items: [], truncated: false }` — a legitimate answer. `localities` postdates most projects: 90 of the 102 committed fixtures have no such key, and erroring on those is what stopped an agent re-reading locality findings it had just written. A project carries `namesakes` only once a namesake is recorded, and `hit_verdicts` only once a search hit is evaluated. |
| A **required** section is missing, or any section is present but not an array, or `research.json` parses to something that is not an object (`null`, an array, a string, a number) | `{ ok: false, errors }` |
| `log` × `questionId`, `plans` missing or not an array | `{ ok: false, errors }` — `plans` is a required section, so its absence is a corrupt document, never a `count: 0` |
| `log` × `questionId`, an entry with `plan_item_id: null` | never matches (the walk could not reach it either) |
| `log` × `questionId`, a plan item on a non-`active` plan | included — `research-exhaustiveness` treats those as audit trail and filters itself |
| No filters supplied | the whole section, one budget-capped page (page with `offset: nextOffset` for the rest) |
| No items match | `{ ok: true, count: 0, items: [] }` — a legitimate answer, not an error |
| More than 50 matches, or first page exceeds budget, no `offset` | `items` is the first budget-capped page (at most 50 items); `count` is the true total; `truncated: true`; `nextOffset` names the next valid start |
| `offset` present and not a non-negative whole number — **including a string like `"50"`** | `{ ok: false, errors }`, rejected loudly, **not coerced**. `index.ts` passes tool arguments through without type-coercion, so a model that sends `offset: "50"` (as one did — hannah-earnest-children idx 79) reaches the tool as a string and `Number.isInteger` rejects it. This mirrors `person_search.offset`'s validation. The old behavior silently ignored the unknown key and returned the *first* page — a wrong answer wearing `ok: true`; the loud rejection is the fix, and the caller (once the skill half teaches it) sends a real number. |
| `offset` present but not a valid greedy page boundary (not 0 or a `nextOffset` a prior call returned) | `{ ok: false, errors }` naming the nearest valid start below `offset` — prevents callers from stepping by a fixed number and landing mid-page |
| `offset` past the last match | `{ ok: true, count: <total>, items: [], truncated: false }` — a legitimate empty page, not an error |
| `offset` set, matches remain beyond the returned page | `items` is the budget-capped greedy slice starting at `offset` (at most 50 items); `count` is the true total; `truncated: true`; `nextOffset` names the next valid start |
