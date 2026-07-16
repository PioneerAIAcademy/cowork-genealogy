# Plan: `localities` section — persist place/locale research knowledge

> **Status:** in progress (branch `locality-guide-persistence`). Steps 1–5 landed
> (schema, `research_append`+`project_context`, `locality-guide` persist + test,
> `research-plan` invoke/read/stage + `search-records` general reflex, viewer
> Localities tab). Remaining: runlog re-run + annotation for the three touched
> skills (locality-guide, research-plan, search-records) — needs the judge API +
> genealogist — before the PR can pass the check-runlogs gate. 
> **Goal:** give the place/locale knowledge `locality-guide` produces a durable
> home in `research.json`, make `locality-guide` actually read all the
> place-oriented wiki pages and persist what it learns, ensure `research-plan`
> invokes it, and keep `search-records` general. Companion (plain-English +
> code-audit evidence): `personal/locale-handling/design-note.md`.

## 1. Why (background)

"Locale rules" — how to find records in a place — were hardcoded as per-country
prose inside `search-records` (e.g. the Hungary→Slovakia boundary lever), which
can't reach the skill that actually knows them. Meanwhile `locality-guide` owns all
the place tools and is *supposed* to research a place, but:

- **It persists nothing** (its SKILL.md says "does not write to research.json"; it
  has no write tool), so its analysis is shown once in chat and discarded.
- **It under-reads the wiki pages.** Verified from a real run (hole-parents, 136
  tool calls): `wiki_place_page` was called **once**, though its own instructions
  say to read **all four** sections (`home` / `getting_started` / `online_records`
  / `research_tips`). The wiki-api is healthy (pages serve fine, correct 404s) — so
  this is a skill-behavior gap, not broken infra.
- **There is no `localities` section** in `research.json`, so even a full read has
  nowhere to live for `research-plan`/`search-records` to use.

## 2. Design principles (treat as constraints)

1. Add a **`localities` section** to `research.json`; update the **Electron viewer**
   to display it (new tab).
2. **Skills share state via `research.json`.** Add **read/write of `localities`** to
   the section-scoped tools (`research_append` write, `project_context` read) so a
   skill doesn't touch the whole document.
3. **`search-records` never calls `locality-guide`.** Two triggers send it back to
   `research-plan`: **(a) a dead-end** (a nil it can't clear with its general
   reflex), and **(b) a new discovery** — it reads a record and finds a lead the plan
   didn't contemplate (a new place, person, or record type). Both are *planning*
   decisions, so `research-plan` owns them, including whether to invoke
   `locality-guide` for a newly-discovered place (a new place needs locale homework
   that only `research-plan` can commission — otherwise search-records would search
   it blind, the very bug we're fixing). **Refine-vs-bounce line:** refining the
   *current* search — name variants, broaden one jurisdiction level, re-anchor on a
   known relative — stays in `search-records` (its one general reflex); bounce only
   for a genuinely *new target*, not every next query. **`search-records` carries no
   place tools** — any place lookup bounces to `research-plan`, which calls
   `locality-guide`, which owns `place_search_all`. (Resolved: not even a cheap
   fallback — pure bounce, per Dallan's preference.)
4. **Keep the applied locale facts in `plan_item.rationale` free text.** (`localities`
   is the knowledge base; the per-search decision lives in the plan item.)
5. **`search-records` stays clean:** "one general reflex, no per-country rules."
6. **`locality-guide` must actually read the place pages — all of them, or most.**

## 3. The `localities` section (the crux)

### 3.1 Where it lives

A new top-level array `localities` in `research.json` (snake_case, like every
persisted document). One entry per place-jurisdiction the project researches. It
**accumulates across the whole project** (all its questions), not per question —
if `q_001` worked out "Ringebu → search at Oppland," `q_002` about a sibling in the
same parish reuses it. It resets only for a brand-new project.

### 3.2 Entry schema (recommended: *semi-structured*)

Each field earns its place by a concrete consumer. `req` = required.

| Field | Type | req | Written from | Consumed by | Why it exists |
|---|---|---|---|---|---|
| `id` | string `loc_NNN` | ✔ | tool-assigned | all | stable handle; `plan_item.rationale` can cite it |
| `place` | string | ✔ | `place_search` | viewer, research-plan | the jurisdiction the guide covers (standardized; wiki corpus is country + US-state/Canadian-province level, so usually that granularity) |
| `for_place` | string | – | agent | viewer | the *specific* place of interest that prompted it (e.g. "Ringebu, Oppland, Norway") when narrower than `place` |
| `time_period` | string | – | agent | research-plan | era the guide was scoped to (e.g. "1850–1880") |
| `jurisdictions` | `[{name, date_range}]` | – | `place_search_all` | research-plan | **border/name succession** — the machine-actionable "search historical *and* modern jurisdiction" data |
| `collections` | `[{id, title, date_range}]` | – | `collections_search` | research-plan | which record sets cover this place + their coverage windows |
| `quirks` | `[string]` | – | wiki + empirical | research-plan, viewer | short, actionable gotchas ("indexed only at county level"; "cross-border records filed under modern country") |
| `guide_markdown` | string (markdown) | – | wiki place pages | viewer | the distilled research guide (strategies / quick-start / overview / online records) — carries the depth |
| `pages_read` | `[{section, url, found}]` | ✔ | `wiki_place_page` | **reviewer / validator / test** | **provenance** — records which of the 4 sections were actually fetched (see §3.3) |
| `source` | string | ✔ | tool | audit | always `"locality-guide"` |
| `created` / `updated` | date `YYYY-MM-DD` | ✔ | tool-stamped | audit | tool-owned timestamps (date-only, per the current schema) |

### 3.3 `pages_read` — the field that operationalizes Dallan's concern

Dallan's worry ("no one reported errors that Claude couldn't read them → maybe it's
not reading them") becomes **checkable** if every entry records *which* wiki sections
it fetched. `pages_read` lists all four sections with `found: true|false`. Then:

- A **reviewer** can see at a glance whether all four were read.
- A **validator/test** can assert `pages_read` has 4 entries (the four sections)
  and flag an entry that only read one — turning the "1-of-4 under-read" from an
  invisible behavior into a **first-class, gradeable fact**.
- `found: false` legitimately records "this section 404s for this place" (e.g. a
  place with no `research_tips` page) without it looking like a skipped read.

This is the single most important structural choice: it makes "is locality-guide
reading the pages?" answerable forever, not just this once.

### 3.4 Relationship to `plan_item.rationale` (honoring ruling #4)

- `localities[]` = the **durable knowledge base** about a place (guide, jurisdictions,
  collections, quirks, provenance). Written by `locality-guide`, read by
  `research-plan`.
- `plan_item.rationale` (free text) = the **applied decision** for a specific search
  ("searching Oppland-level, not the exact parish, because Ringebu is indexed at
  county level — see `loc_001`"). Written by `research-plan`.

So the actionable locale fact still rides in the plan item (Dallan's constraint),
and it *points at* the locality entry rather than re-deriving prose each time.
`search-records` reads plan items (which it already does) — it does **not** need to
read `localities` directly, keeping it general.

### 3.5 Example entry

```jsonc
{
  "id": "loc_001",
  "place": "Norway",
  "for_place": "Ringebu, Oppland, Norway",
  "time_period": "1850-1880",
  "jurisdictions": [
    { "name": "Ringebu, Oppland, Norway", "date_range": "1838-" }
  ],
  "collections": [
    { "id": "4237104", "title": "Norway, Church Books, 1797-1958", "date_range": "1797-1958" }
  ],
  "quirks": [
    "Parish records indexed only at the COUNTY level (Oppland) — search county, not the exact parish.",
    "Cross-border records may be filed under the MODERN country — retry there on nil."
  ],
  "guide_markdown": "## Norway research\n\nChurch books (klokkerbøker) are the core...\n",
  "pages_read": [
    { "section": "home", "url": ".../Norway_Genealogy", "found": true },
    { "section": "getting_started", "url": ".../Norway_Getting_Started", "found": true },
    { "section": "online_records", "url": ".../Norway_Online_Genealogy_Records", "found": true },
    { "section": "research_tips", "url": ".../Norway_Research_Tips_and_Strategies", "found": true }
  ],
  "source": "locality-guide",
  "created": "2026-07-14",
  "updated": "2026-07-14"
}
```

### 3.6 Alternatives considered

- **(A) No structure — a single `guide_markdown` + `pages_read` per place.** Simplest;
  honors "structure (if any!)." But the viewer can only show a blob, and
  `research-plan` must parse prose to stage jurisdiction/collection searches. Loses
  the machine-actionable border-succession.
- **(B) Semi-structured (recommended).** A few structured fields
  (`jurisdictions`, `collections`, `quirks`, `pages_read`) + `guide_markdown` for the
  prose. Viewer renders cleanly; research-plan reads the actionable bits; provenance
  is checkable. Modest schema surface.
- **(C) Fully structured** (every research-tip normalized into typed fields). Over-fit;
  the wiki content is inherently prose — forcing structure loses nuance and bloats
  the writer. Rejected.

**Recommendation: (B).** It's the least structure that still (i) powers the viewer,
(ii) lets research-plan act mechanically, and (iii) makes the read-coverage
verifiable. `guide_markdown` + `quirks` are optional, so a lean first cut can ship
with `place`, `jurisdictions`/`collections` when available, `pages_read`, and
metadata, and grow. **Open question for Dallan below (§7).**

## 4. Data flow

```
research-plan (Step 2, needs jurisdiction context)
    └─ invokes locality-guide  ─────────────────────────────┐
                                                            ▼
locality-guide: place_search → place_search_all,           writes
   collections_search, volume_search, external_links,   →  localities[loc_NNN]
   and ALL FOUR wiki_place_page sections (+ wiki_search)    via research_append
                                                            │
research-plan: reads localities (project_context) ◀─────────┘
   → stages plan items; puts the applied locale fact in plan_item.rationale (cites loc_NNN)
                                                            │
search-records: executes plan items; general reflex ────────┘
   (broaden one level / try other names on nil). On a genuine dead-end → BOUNCE to
   research-plan (never calls locality-guide). place_search_all allowed as a cheap
   name fallback.
```

## 5. Changes by area

### 5.1 Schema (change class: "new field/section" — see CLAUDE.md)
- `docs/specs/schemas/research.schema.json` — add `localities` array + entry schema.
- Prose table in `docs/specs/research-schema-spec.md` — document the section + fields.
- `packages/engine/mcp-server/src/validation/validator.ts` — hand-maintained
  `validate_research_schema`; add `localities` (and `additionalProperties:false`
  entry shape).
- Web mirror: `packages/schema/schemas/research.schema.json` + the TS `interface`
  in `packages/schema/src/index.ts`.
- Seed `localities: []` in `init-project`'s `research.json` template.

### 5.2 Tools (Dallan: "add read/write localities to those tools")
- **`research_append`** (`src/tools/research-append.ts`): add
  `localities: { prefix: "loc_", stampTimestamp: CREATED_DATE }` to the `SECTIONS`
  table; the tool assigns `loc_NNN`, stamps `created`/`updated`, validates before
  persist. Add to the tool-spec (`research-append-tool-spec.md`) + manifest as
  needed. (No delete op — supersede-not-delete, per existing invariants.)
- **`project_context`** (`src/tools/project-context.ts`): expose a compact
  `localities` projection (id, place, quirks, pages_read coverage) so `research-plan`
  reads it without loading the whole doc.

### 5.3 `locality-guide` skill (the behavior fix)
- Add **`research_append`** to `allowed-tools` (it has *no* write tool today).
- Add a **"read then persist"** step: fetch **all four** `wiki_place_page` sections
  (reshape the instruction so it's not skippable — the current "batch all four" line
  is being under-followed), plus `place_search_all` / `collections_search` as
  applicable, then **write one `localities` entry** including `pages_read` provenance
  for every section attempted (`found: true|false`).
- It still outputs the guide to the user *and* now persists it.

### 5.4 `research-plan` skill
- Ensure Step 2 **actually invokes `locality-guide`** when no locality entry exists
  for the jurisdiction (verify, don't assume).
- **Read `localities`** (via `project_context`) and use `jurisdictions`/`collections`
  to stage searches (e.g. a historical + modern jurisdiction `fallback_for` pair).
- Put the applied locale fact in each `plan_item.rationale`, citing `loc_NNN`.

### 5.5 `search-records` skill (keep clean)
- Replace the Hungary-specific worked example with **one general reflex**: on nil,
  broaden one jurisdiction level / try the other names the plan lists — no country
  rules.
- On a genuine dead-end the plan didn't cover, **bounce back to `research-plan`**
  (do **not** call `locality-guide`).
- Do **not** add `place_search_all` (or any place tool) to `search-records`.
  **Delete** the dead `place_search_all` prose reference (fixes the dead-code issue
  by removal). All place lookups go via `research-plan` → `locality-guide`.

### 5.6 Electron viewer
- Add a **Localities tab/section** in `packages/viewer-ui` (follow the existing
  section-component pattern + `ResearchDataProvider`); render `place`, `time_period`,
  `jurisdictions`, `collections`, `quirks`, `guide_markdown`, and a `pages_read`
  coverage indicator. Wire into `apps/electron` (+ `apps/web`) via the shared viewer.

## 6. Tests & acceptance criteria
- **Schema:** validator round-trips a `localities` entry; rejects unknown fields.
- **research_append:** unit test writing a `localities` entry (id assignment,
  timestamps, supersede).
- **locality-guide:** unit test — given a place, it calls `wiki_place_page` for **all
  four** sections and writes a `localities` entry with 4 `pages_read` records.
  **Acceptance: verify via the run's `tool_calls` that `wiki_place_page` is called
  ≥4× (not 1).** (This is the concrete fix for the under-read.)
- **research-plan:** unit test — invokes locality-guide when no entry exists; reads an
  existing entry and stages searches citing `loc_NNN` in `plan_item.rationale`.
- **search-records:** unit test — on a dead-end it bounces to research-plan and does
  **not** call locality-guide; general reflex has no per-country text.
- **(stretch) e2e locale-quirk fixture** (e.g. the Ringebu/Oppland case) exercising
  the whole chain: locality-guide reads → persists → plan stages county-level → search
  finds. Doubles as a regression guard.

## 7. Decisions
1. **Structure depth → semi-structured (§3.2/B)** *(proposed; confirm)*. Enough
   structure for research-plan + viewer, `guide_markdown`/`quirks` optional so a lean
   first cut can grow.
2. **`search-records` place tools → NONE (resolved).** search-records stays tool-free;
   delete the dead `place_search_all` prose; every place lookup bounces to
   research-plan → locality-guide (which has `place_search_all`).
3. **`pages_read` provenance → include in v1 (§3.3)** *(proposed; confirm)*. It's the
   mechanism that makes "did locality-guide read all four sections?" testable.

## 8. Sequencing (suggested PR order within the branch)
1. Schema + `init-project` template + validator + mirror (the `localities` shape).
2. `research_append` write + `project_context` read (+ specs/tests).
3. `locality-guide` read-all-four + persist (+ the ≥4-calls test).
4. `research-plan` invoke + read + stage; `search-records` general reflex + bounce.
5. Electron viewer tab.
6. (stretch) e2e locale-quirk fixture.
