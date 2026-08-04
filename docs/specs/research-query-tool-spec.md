# `research_query` — filtered research.json read — Spec

> **Status:** New (2026-07-26, tree-materialization latency follow-up). Read-only
> sibling of `project_context` (`project-context-tool-spec.md`) — a second
> read-side tool, not an extension of the first (see §3 for why).
> **Updated 2026-08-03:** added `offset` pagination so items 51+ are reachable
> (#1031, tool half; teaching the skills to page is the skill half, #1183).

```
research_query({ projectPath, section, ...well-known filters }) -> { count, items, truncated }
```

---

## 1. Why this exists

`project_context` already exists to stop one re-read pattern (the
record-extractor's fresh-context `Read` of the whole project on every
delegation). It deliberately does **not** cover per-assertion detail or any
other section body (`project-context-tool-spec.md` §3: "no assertion bodies —
deliberately excluded"), because its one consumer needs a stable, small,
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
         | "person_evidence" | "conflicts" | "hypotheses" | "timelines"
         | "proof_summaries" | "evaluations",
  // well-known filters — only some apply to a given section; see §2.1
  recordId?: string,
  recordRole?: string,
  sourceId?: string,
  questionId?: string,
  personId?: string,
  assertionId?: string,
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
| `sources` | `sourceId` | `id` | exact |
| `assertions` | `recordId` | `record_id` | exact |
| | `recordRole` | `record_role` | exact |
| | `sourceId` | `source_id` | exact |
| | `questionId` | `extracted_for_question_ids` | contains |
| `person_evidence` | `personId` | `person_id` | exact |
| | `assertionId` | `assertion_id` | exact |
| `conflicts` | `assertionId` | `competing_assertion_ids` | contains |
| | `questionId` | `blocks_question_ids` | contains |
| | `status` | `status` | exact |
| `hypotheses` | `questionId` | `related_question_ids` | contains |
| | `assertionId` | `supporting_assertion_ids` OR `contradicting_assertion_ids` | contains-either |
| | `status` | `status` | exact |
| `timelines` | `personId` | `person_ids` | contains |
| `proof_summaries` | `questionId` | `question_id` | exact |
| | `assertionId` | `supporting_assertion_ids` | contains |
| `evaluations` | `targetId` | `target_id` | exact |
| | `focus` | `focus` | exact |

Supplying a filter not in this table for the chosen `section` is a rejected
call (`'<key>' is not a supported filter for section '<section>'`), not a
silent no-op — a caller who mistypes or mis-targets a filter gets an
actionable error, not a confusingly-empty (or confusingly-unfiltered) result.

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
}
// on failure: { ok: false, errors: string[] }
```

Each call returns at most 50 items (`MAX_ITEMS` in `research-query.ts`). A
caller that hits `truncated: true` either narrows the filter or **pages**: set
`offset` to 50, then 100, and so on, until `truncated: false`. `offset` skips
the first N matches of the *filtered* set — it is pagination, not a filter, so
it is absent from the §2.1 table and applies to every section uniformly.
`count` stays the true total throughout, so the next page's `offset` is simply
`offset + items.length`. `offset` must be a non-negative whole number and is
rejected (not coerced) otherwise — see §4. Omitting every filter returns the
whole section, one 50-item page at a time.

## 3. Decisions recorded

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
  scope: ten named parameters across eleven sections, not an arbitrary path
  language.
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
  here would mean maintaining eleven bespoke projections instead of one
  filter layer.
- **No `tree.gedcomx.json` access.** The observed cost (§1) was
  `research.json` re-reads specifically; tree re-reads were an order of
  magnitude lower in the same runs. Out of scope until evidence says
  otherwise.
- **50-item page cap + `offset` pagination — not a raised cap, a `fields`
  projection, or a staged-to-disk fallback (#1031).** The page size stays 50
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
    `information_quality`, `evidence_type`, `informant`, and
    `informant_proximity` per assertion — most of the body — so trimming fields
    would not shrink the payload enough to fit 57 in one call.
  - **A staged-to-disk fallback** (as `fulltext_search` / `external_links_search`
    use, because *their* source is a live one-shot API response) is unwarranted
    here for the same on-disk reason.

  `offset` is typed `number` and rejected loudly when it is not a non-negative
  whole number (§4). The **tool** now supports paging; teaching proof-conclusion
  and the other consumers to actually page is the **skill half, #1183** — until
  that lands the gate can still under-read, so a tool-only fix does not by itself
  clear the reported symptom.

## 4. Errors / edge cases

| Condition | Behavior |
|---|---|
| `section` not one of the eleven supported values | `{ ok: false, errors }` |
| A supplied filter not in that section's allow-list (§2.1) | `{ ok: false, errors }` naming the filter and the section |
| `research.json` missing or invalid JSON | `{ ok: false, errors }` |
| The named section is missing or not an array | `{ ok: false, errors }` |
| No filters supplied | the whole section, one 50-item page (page with `offset` for the rest) |
| No items match | `{ ok: true, count: 0, items: [] }` — a legitimate answer, not an error |
| More than 50 matches, no `offset` | `items` is the first 50; `count` is the true total; `truncated: true` |
| `offset` present and not a non-negative whole number — **including a string like `"50"`** | `{ ok: false, errors }`, rejected loudly, **not coerced**. `index.ts` passes tool arguments through without type-coercion, so a model that sends `offset: "50"` (as one did — hannah-earnest-children idx 79) reaches the tool as a string and `Number.isInteger` rejects it. This mirrors `person_search.offset`'s validation. The old behavior silently ignored the unknown key and returned the *first* page — a wrong answer wearing `ok: true`; the loud rejection is the fix, and the caller (once #1183 teaches it) sends a real number. |
| `offset` past the last match | `{ ok: true, count: <total>, items: [], truncated: false }` — a legitimate empty page, not an error |
| `offset` set, matches remain beyond the returned page | `items` is the (≤50) slice at `[offset, offset+50)`; `count` is the true total; `truncated: true` |
