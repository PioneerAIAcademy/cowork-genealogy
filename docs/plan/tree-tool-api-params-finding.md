# Tree Tool — Query Parameter Discovery

## What we found

The FamilySearch person endpoint (`/platform/tree/persons/{id}`) accepts
two query parameters that can bundle related data into a single response:

- **`relatives=true`** — includes all parents, children, and spouses
- **`sourceDescriptions=true`** — includes source descriptions for the person (and relatives if both are set)

This means a single API call can return a person's details, their
entire family, and all attached sources at once.

## Test results

Tested on George Washington (`KNDX-MKG`):

| Call | Persons | Relationships | Sources |
|------|---------|---------------|---------|
| `/persons/{id}` (baseline) | 1 | 11 | 3 |
| `/persons/{id}?relatives=true` | 8 | 105 | 10 |
| `/persons/{id}?sourceDescriptions=true` | 1 | — | 27 |
| `/persons/{id}?relatives=true&sourceDescriptions=true` | 8 | 105 | 34 |

With both parameters, the response includes:

- 8 persons (George + parents + spouse + 4 children)
- 105 relationships (couple + parent-child, full extended family)
- 34 source descriptions (sources across all family members)
- Each person has a `sources[]` array with per-person source ref counts

## How this compares to separate endpoints

The current spec uses dedicated endpoints for each action:

| Action | Endpoint used |
|--------|---------------|
| `person` | `GET /persons/{id}` |
| `families` | `GET /persons/{id}/families` |
| `sources` | `GET /persons/{id}/sources` |
| `ancestry` | `GET /ancestry?person={id}&generations={n}` |

The query parameters offer an alternative for `families` and `sources`:

| Action | Separate endpoint | Query parameter alternative |
|--------|-------------------|----------------------------|
| `families` | `GET /persons/{id}/families` | `GET /persons/{id}?relatives=true` |
| `sources` | `GET /persons/{id}/sources` | `GET /persons/{id}?sourceDescriptions=true` |
| Both | Two separate calls | `GET /persons/{id}?relatives=true&sourceDescriptions=true` |

The `ancestry` endpoint has no query parameter equivalent — it stays as a separate call.

## Options

### Option A — Keep 4 separate actions, use params under the hood

The tool still exposes 4 actions to the user (`person`, `ancestry`,
`families`, `sources`). The user picks what they need. But internally,
the code uses the query parameters instead of separate endpoints where
it makes sense.

```
User asks for "person"   → GET /persons/{id}
User asks for "families" → GET /persons/{id}?relatives=true
User asks for "sources"  → GET /persons/{id}?sourceDescriptions=true
User asks for "ancestry" → GET /ancestry?person={id}&generations={n}
```

**Pros:**
- Responses are focused — only returns what was asked for
- Lighter payloads when user just wants a person's name or just sources
- Claude decides what to fetch based on the user's question
- Ancestry stays clean (no change)

**Cons:**
- Multiple round-trips if user wants everything (person + family + sources = 3 calls)

### Option B — Bundle into fewer actions using both params

Reduce to 2 actions: `person` (with optional bundling) and `ancestry`.
The `person` action always calls with `?relatives=true&sourceDescriptions=true`
and returns everything in one shot.

**Pros:**
- Single API call for person + family + sources
- Simpler tool design (fewer actions)

**Cons:**
- Response is always heavy (105 relationships, 34 sources for George Washington) even when user just wants a birth date
- Still needs filtering (105 relationships includes grandchildren's families, step-children's spouses, etc.)
- Harder for Claude to present — a lot of data to summarize

### Option C — Hybrid approach

Keep the 4 actions, but add an optional `include` parameter:

```json
{ "personId": "KNDX-MKG", "include": ["relatives", "sources"] }
```

When `include` is set, the tool adds the corresponding query parameters
to the person call and returns bundled data. When omitted, each action
fetches only what's needed.

**Pros:**
- Flexible — user can get lean or bundled responses
- Single call when everything is needed, separate calls when not

**Cons:**
- More complex tool schema
- More complex response shape (conditional fields)

## Verified answers

### Q1: Does `?relatives=true` match `/families`?

**Partially.** The relationship data is identical, but the persons differ:

|                        | `?relatives=true` | `/families` |
|------------------------|--------------------|-------------|
| persons                | 8                  | 17          |
| relationships          | 105                | 105         |
| childAndParentsRels    | 49                 | 49          |
| couple relationships   | 7                  | 7           |
| has parent1/2Facts     | yes                | yes         |

- `childAndParentsRelationships` IDs: **exact match**
- Couple relationships: **exact match**
- `parent1Facts`/`parent2Facts`: **present in both**
- Persons: **`/families` returns 9 extra people** — these are siblings
  (Betty Washington, Samuel Washington, John Augustine Washington, etc.)
  who appear as children in shared parent relationships but are not
  direct relatives of the focal person. `?relatives=true` only returns
  parents, spouse, and children (8 people).

**Conclusion:** `?relatives=true` is a subset. For immediate family
(parents, spouse, children), it's sufficient. For siblings, the
`/families` endpoint returns more.

### Q2: Does `?sourceDescriptions=true` match `/sources`?

**Yes, with 3 extra metadata entries.**

|                        | `?sourceDescriptions=true` | `/sources` |
|------------------------|----------------------------|------------|
| sourceDescriptions     | 27                         | 24         |
| metadata (SD_*)        | 3                          | 0          |
| real sources           | 24                         | 24         |

- Real source IDs: **exact match**
- Title, about, resourceType, citation: **exact match** per source
- One minor difference: `/sources` includes a `sortKey` field on each
  source; `?sourceDescriptions=true` does not.

**Conclusion:** The real source data is identical. The param version
adds 3 metadata entries (`SD_PERSON_*`, `SD_TREE_*`, `SD_COLLECTION_*`)
that can be filtered out by skipping IDs starting with `SD_`.

### Q3: Which option?

**Decision needed at standup.**

## Recommendation

**Option A** — keep 4 separate actions. It keeps responses lean, is
simpler to implement, and lets Claude fetch only what's needed. The
query parameters are a useful optimization that can be adopted later
if bundling proves necessary for performance.

The key reason: `?relatives=true` returns only 8 persons while
`/families` returns 17 (includes siblings). If siblings matter, the
dedicated endpoint gives more data. The source data is equivalent
either way.
