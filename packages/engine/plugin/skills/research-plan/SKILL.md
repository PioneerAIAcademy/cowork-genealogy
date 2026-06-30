---
name: research-plan
model: claude-sonnet-4-6
description: Creates, reviews, and revises a sequenced research plan (written to research.json)
  for a specific genealogy question — which record sets to search, in what order,
  from which repositories, with fallbacks. GPS Step 1 (Reasonably Exhaustive
  Research), aligned with BCG Standards 9-18. Use when the user wants to create a
  plan ("plan research for [question]", "what records should I search?", "where
  should I look?"), to see or recap an existing plan ("what does the research plan
  look like?", "review the plan"), or to re-plan because new information
  invalidated an active plan's assumptions ("revise the plan", "re-plan for
  [question]"); or after question-selection creates a new question. Do NOT use to
  execute a search (use search-records or search-external-sites), to select which
  question to research (use question-selection), to analyze records already found
  (use record-extraction), or — after a search came back empty or a plan item
  finished — to judge whether research is exhaustive or what to do next — "are we
  done", "what's the next step" (use research-exhaustiveness or project-status, and
  question-selection to pick the next question).
allowed-tools:
  - wiki_search
  - place_search
  - place_search_all
  - collections_search
  - place_population
  - external_links_search
  - volume_search
  - wiki_place_page
  - research_append
---

# Research Plan

**Narration:** Read `researcher_profile.narration_guidance` from `research.json` and apply it as your narration style for this invocation. If absent, default to a one-line preamble per action.

**Places:** When resolving or writing places, follow `references/places-guidance.md` — resolve with `place_search` / `place_search_all` and record the `standardPlace` (and `standard_place` on persisted facts/assertions/events).

**Write `plans` and `plan_items` only through `research_append` — never hand-edit `research.json`.** It assigns ids, enforces the schema and the one-active-plan invariant, and writes atomically; on `{ ok: false, errors }` nothing is written, so fix the input and re-issue. No separate `validate_research_schema` step is needed.

Load `references/planning-standards.md` for BCG standards (9-18) that
govern research planning. Load `references/record-type-guide.md` for
record-type selection by research goal.

## Inputs

- A research question from `research.json` `questions[]` (identified
  by `q_` ID or by the user describing what they want to answer)
- The project context: what's already been searched (log), what
  persons/dates/places are known (assertions, tree.gedcomx.json)

## MCP tools used

| Tool | Purpose |
|------|---------|
| `wiki_search` | FamilySearch wiki articles about record availability for the jurisdiction |
| `place_search` | Place ID, jurisdictional hierarchy, boundary changes |
| `collections_search` | FamilySearch record collections covering this place |
| `place_population` | Population statistics to understand community size |
| `external_links_search` | FS-curated third-party URLs (Ancestry, MyHeritage, archives, wiki pages) for this place and period |
| `volume_search` | Digitized volumes (image groups) covering this place and period — reveals browse-only films not in indexed collections |
| `wiki_place_page` | Country research strategies (`section: "research_tips"`) and online record sources (`section: "online_records"`) |

## Steps

### 1. Understand the question's context

From the question's `rationale` and `selection_basis`, determine:
- **Who** — the subject and what is known (tree.gedcomx.json, assertions)
- **What** — the event or relationship under investigation
- **Where** — jurisdiction, county, state/province, country
- **When** — target time period
- **Prior searches** — read the log; don't re-plan a source already
  searched unless using a different repository or parameters

If you already hold the question and its context in memory from this
run, work from that — don't re-read `research.json` "to be safe." Read
it only when planning cold, or when a sub-skill or the user changed the
file since. (Step 1a still requires reading **all plans for the target
question** when you don't know their statuses — that's for picking the
mode, not a defensive re-read.)

**Verify the starting point (BCG Standard 11).** Before planning,
check whether starting-point facts are documented or merely assumed.
Flag unsupported assumptions (e.g., "widow = mother of all children")
and add plan items to verify them before relying on them.

### 1a. Decide the planning mode

Read ALL plans for the target question (`plans[]` where
`question_id == <target>`), regardless of status — read first, decide
second, write last.

**Review mode** — An `active` plan still has `planned`/`in_progress`
items, and the user wants a recap. Narrate which item is next, why,
and what follows — **do not create a new plan or modify items.** The
active plan is the audit trail; review is explanatory only. If the
item you confirm as the next step names no specific collection, run a
quick `collections_search` at its jurisdiction to confirm the source
is actually available and cite the collection/repository — a read-only
catalog check that makes the recommendation actionable, never a new
plan item.

**Add-new mode** — The most recent plan's items are all
`completed`/`skipped`, but the question isn't yet `proved` (no proof
summary, or `proof_summaries[].status` below `proved`). Create a NEW
`active` plan targeting next-best record types; leave the completed
plan untouched as the record of what was done.

**Supersede mode (re-plan)** — The active plan has unfinished items
but new information invalidates its assumptions (e.g., the subject
turned out to be a different person, or a boundary change moved the
records). Apply Step 6 ("Handle re-planning"): supersede the old plan,
create a new one.

**Heuristic for ambiguous prompts.** When a prompt could mean "tell me
the plan" (review) or "make a plan" (add/supersede), default to review
if an active plan has unfinished items — a duplicate plan alongside a
usable one is the worse mistake.

### 2. Conduct a locality survey

Determine what records exist for the target jurisdiction and period.

**Invoke locality-guide or do inline?** No guide yet → invoke
`locality-guide` first, then return. Guide exists → read it and
supplement with targeted MCP calls for gaps. Quick survey of a familiar
jurisdiction → call MCP tools directly:

```
place_search({ placeName: "Schuylkill County, Pennsylvania" })
collections_search({ standardPlace: "Schuylkill, Pennsylvania, United States" })
external_links_search({ standardPlace: "<standardPlace from place_search>", startYear: 1875, endYear: 1890 })
volume_search({ standardPlace: "<standardPlace from place_search>", startYear: 1875, endYear: 1890 })
wiki_search({ query: "Pennsylvania probate records genealogy" })
wiki_place_page({ standardPlace: "Pennsylvania, United States", section: "research_tips" })
wiki_place_page({ standardPlace: "Pennsylvania, United States", section: "online_records" })
```

Pass the target period to `external_links_search` as `startYear`/`endYear`.
It returns a flat list of curated URLs across third-party sites; use
`linkText` and the URL host to identify each, and dedupe by URL before
adding items.

Use `volume_search` to find browse-only image groups (digitized
microfilm, book scans) — many records exist only as unindexed images
that `collections_search` won't show. Include these as plan items when
the question may need unindexed records.

**What the survey must answer for planning purposes:**
- Which record types exist for this place and period
- Whether records survive (fires, floods, wartime destruction)
- Where records are held and how to access them (indexed, images-only,
  on-site only)
- Boundary changes affecting which jurisdiction holds the records

### 3. Identify relevant record sets

From the question, the locality survey, and the period, identify which
record sets could answer it.

Load `references/record-type-guide.md` for the record-type-by-goal
table and contextual factors checklist.

**Key selection principles:**
- Apply topical breadth (BCG Standard 14) — do not limit the plan
  to census and vital records.
- Include the FAN cluster (relatives, neighbors, associates) — their
  records may contain evidence about the subject.
- Consider occupation-specific, institutional, and organizational
  records when relevant to the subject's life.
- Cover both FamilySearch and external/paid repositories (Ancestry,
  MyHeritage), and look beyond online indexes — image-only collections,
  catalogs, and physical repositories.
- Account for boundary changes, record destruction, and legal context
  that affect what records exist.

### 4. Sequence the plan items

Order items for efficient discovery (BCG Standard 15):

1. **Highest probability first** — indexed sources where the subject
   should appear
2. **Free before paid** — FamilySearch before Ancestry/MyHeritage
3. **Original before derivative** — search the index for discovery,
   plan to verify against the original image
4. **Narrow before broad** — specific county before adjacent counties
5. **Include contingencies** — use `fallback_for` to link alternate
   sources when a primary may fail
6. **Include FAN items** — at least one search targeting records of
   relatives, neighbors, or associates

**Plan size guidance:** A typical plan has 4-10 items: fewer than 3
usually isn't exhaustive enough; more than 12 suggests the question is
too broad — consider splitting.

### 5. Write the plan

**Before writing, re-confirm you're not in review mode (Step 1a).** If
an active plan has `planned`/`in_progress` items and the request is a
recap or ambiguous, narrate it and append nothing — creating or
superseding a usable plan when asked only to see it is a defect.

Write the whole plan in ONE batched `research_append` call: op #1
appends the plan shell, then one `append` op per plan item. Each item
is still its own op; batching changes only the number of *calls*, not
the data. The whole batch validates once and writes once; on any per-op
failure it returns `{ ok: false, errors: ["ops[i]: <msg>"] }` and writes
NOTHING — surface the errors and fix the offending op, don't re-issue
the same call blindly.

**Op #1 — the plan shell.** Omit the `id` (the tool assigns the `pl_`
id) and omit `items` (the item ops add those). The tool rejects a second
`active` plan for the same `question_id` (one active plan per question).

**Ops #2…N — the plan items**, in sequence order, each targeting op #1's
plan via `planId`. The tool assigns each id as **(highest existing id of
that prefix in `research.json`) + 1**, zero-padded to 3 — so **predict**
them, don't assume `_001`: if the project already has `pl_001`/`pl_002`,
op #1's plan is `pl_003`, and that's the `planId` for every item op.
**Never hard-code `pl_001`** — in an ongoing project it silently attaches
your items to another question's plan. Omit each item's `id`. A
`fallback_for` likewise needs the primary's predicted `pli_` id ((highest
existing `pli_` across all plans) + 1, advancing one per item op), so
place the primary's op before its fallback's:

```
research_append({
  projectPath: "<absolute-path-to-project-directory>",
  ops: [
    {
      section: "plans",
      op: "append",
      // assigned pl_ id = (highest existing pl_) + 1; pl_001/pl_002 exist → pl_003.
      entry: {
        question_id: "q_003",
        status: "active",
        created: "2026-05-04"
      }
    },
    {
      section: "plan_items",
      op: "append",
      planId: "pl_003",   // op #1's predicted id (computed, not assumed _001)
      entry: {
        sequence: 1,
        record_type: "probate",
        jurisdiction: "Schuylkill County, Pennsylvania",
        date_range: "1875-1890",
        repository: "FamilySearch",
        rationale: "Thomas Flynn likely died circa 1881 (disappears from tax records). Schuylkill County probate records 1810-1920 are indexed on FamilySearch. A will naming Patrick as a son would be direct evidence of parentage.",
        fallback_for: null,
        status: "planned"
      }
    }
    /* …one append op per plan item, each with planId: "pl_003"… */
  ]
})
```

**Plan item fields:**

- `record_type`: census, vital_record, probate, land, church,
  military, newspaper, cemetery, tax, immigration, court, other
- `jurisdiction`: Human-readable place description
- `date_range`: Target period (e.g., "1875-1890", "1850")
- `repository`: FamilySearch, Ancestry, MyHeritage, FindMyPast,
  NARA, state_archives, county_courthouse, other
- `rationale`: Why this record set for this question — what it could
  reveal and why it's worth searching. "Because it exists" is insufficient.
- `fallback_for`: `pli_` ID of the plan item this falls back from,
  or null. The fallback is searched if the primary yields nothing.
- `status`: the item's progress — exactly one of `planned`,
  `in_progress`, `completed`, or `skipped`. New items are `planned`.
  Never use any other value (e.g. not `not_started`, not `pending`).

**Field-value rules (strict).** Use only schema-defined fields and
values. A plan's `status` is one of `active`, `superseded`,
`completed`, or `exhausted`. There is no `supersedes` field — record
supersession only by updating the prior plan's `status` to
`superseded` (Step 6). **research-plan writes only the `plans` and
`plan_items` sections** — never `conflicts`, `hypotheses`,
`assertions`, or others.

### 6. Handle re-planning

If a previous plan for this question exists and all items are searched
but the question remains unresolved:

1. Supersede the old plan with an `update`:

   ```
   research_append({
     section: "plans",
     op: "update",
     entryId: "pl_003",
     fields: { status: "superseded" }
   })
   ```

   Supersede first — the tool rejects a new `active` plan while another
   `active` plan exists for the same `question_id`.

2. Create a new plan (Step 5) targeting what the old missed —
   different repositories, jurisdictions, record types, FAN or
   contextual sources. Reference the old plan in the rationale.

Never modify a superseded plan — it is part of the audit trail. Status
transitions (`planned → in_progress → completed`) on existing items are
made by the executing skills (search-records, search-external-sites),
not here.

**Termination (BCG Standard 18):** If all identified sources are
exhausted or inaccessible and the question remains unresolved, set the
plan status to `exhausted` with an update:

```
research_append({
  section: "plans",
  op: "update",
  entryId: "pl_003",
  fields: { status: "exhausted" }
})
```

Note explicitly that the GPS cannot be met — an acceptable outcome;
not every question is answerable with available records.

### 7. Present

If any `research_append` call returned `{ ok: false, errors }`, fix and
re-issue it first. Then present the plan:

- The question being addressed
- Each plan item with its rationale, in execution order
- Fallback relationships ("if step 1 yields nothing, step 3 is
  the fallback")
- Total estimated scope (how many searches)
- Suggest next step: "Would you like me to start executing this
  plan?" (search-records / search-external-sites, depending on
  the repositories)

## Example

**Question:** q_003 — "Did Thomas Flynn leave a will in Schuylkill
County naming Patrick as a son?"

**Survey:** `place_search` (county formed 1811) → `collections_search`
(FamilySearch "Pennsylvania Probate Records, 1683-1994", indexed) →
`wiki_search` (probate = county Register of Wills: wills,
administrations, guardianships).

**Plan:** pl_003 — three items: probate on FamilySearch, probate on
Ancestry (fallback), land records (fallback).

## Decision rules

| Situation | Action |
|-----------|--------|
| No locality guide exists for this jurisdiction | Invoke `locality-guide` skill first, then return here |
| Question is too vague to plan for | Return to `question-selection` to refine it |
| All plan items exhausted, question unresolved | Set plan to `exhausted`; invoke `research-exhaustiveness` to evaluate the question against the GPS stop criteria. If it returns "not yet exhaustive," follow its recommendation — extend the plan here, or invoke `question-selection` for a FAN pivot |
| User says "start searching" | Hand off to `search-records` (FamilySearch items) or `search-external-sites` (other repositories) |

## Re-invocation behavior

**Writes:** entries in the `plans` section of `research.json` (`pl_`
ids and nested `pli_` plan items). Plans are never deleted; a replaced
plan is marked `superseded`.

**On repeat invocation:** follow the mode gate in Step 1a — do not
assume a fresh plan. If an `active` plan already exists for the
question, default to **review** (recap status and the next item);
create a **new** plan only when the prior plan is `completed`; mark the
old plan `superseded` and write a new `pl_` entry only when the user is
explicitly re-planning. Never edit a `completed` or `superseded` plan's
items in place.

**Do not duplicate:** never leave two `pl_` entries with
`status: "active"` for the same research question — the audit-trail
invariant the review and supersede modes exist to protect.
