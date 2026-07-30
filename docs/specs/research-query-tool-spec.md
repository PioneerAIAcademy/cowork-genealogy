# `research_query` — filtered research.json read — Spec

> **Status:** New (2026-07-26, tree-materialization latency follow-up). Read-only
> sibling of `project_context` (`project-context-tool-spec.md`) — a second
> read-side tool, not an extension of the first (see §3 for why).

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
| `evaluations` | *(none)* | — | — |

Supplying a filter not in this table for the chosen `section` is a rejected
call (`'<key>' is not a supported filter for section '<section>'`), not a
silent no-op — a caller who mistypes or mis-targets a filter gets an
actionable error, not a confusingly-empty (or confusingly-unfiltered) result.

### 2.2 Return value

```typescript
{
  ok: true,
  section: string,
  count: number,      // total matches, BEFORE the cap below
  items: any[],        // the section's native snake_case fields, verbatim — a
                        // read projection, not a persisted document, so no
                        // camelCase rename (contrast project_context, whose
                        // fixed shape IS a wire surface)
  truncated: boolean,  // true when count > 50 and items was capped
}
// on failure: { ok: false, errors: string[] }
```

Capped at 50 items (`MAX_ITEMS` in `research-query.ts`) — a caller that hits
`truncated: true` should narrow the filter, not assume `items` is everything.
Omitting every filter returns the whole section, subject to the same cap.

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
  scope: eight named parameters across eleven sections, not an arbitrary path
  language.
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
- **50-item cap, not a staged-to-disk fallback.** Unlike
  `fulltext_search`/`external_links_search` (which stage oversized results to
  disk because the source is a live, one-shot API response), the source of
  truth here is already on disk in the project directory — a caller that
  needs more than 50 matches should narrow the filter, not be handed a second
  copy of data it already has file access to.

## 4. Errors / edge cases

| Condition | Behavior |
|---|---|
| `section` not one of the eleven supported values | `{ ok: false, errors }` |
| A supplied filter not in that section's allow-list (§2.1) | `{ ok: false, errors }` naming the filter and the section |
| `research.json` missing or invalid JSON | `{ ok: false, errors }` |
| The named section is missing or not an array | `{ ok: false, errors }` |
| No filters supplied | the whole section, capped at 50 |
| No items match | `{ ok: true, count: 0, items: [] }` — a legitimate answer, not an error |
| More than 50 matches | `items` capped at 50; `count` is the true total; `truncated: true` |
