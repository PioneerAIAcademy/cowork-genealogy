# Project Goal — FamilySearch MCP Server

This file tracks the implementation goal and progress. For detailed research
(OAuth patterns, full API documentation, risk analysis), see `local/project-goal.md`.

## Goal

Build an MCP server that gives Claude access to FamilySearch genealogy data
through five tools:

| Tool | Purpose | Auth |
|------|---------|------|
| `collections` | List record collections for a geographic area | No |
| `places` | Place details from FamilySearch + Wikipedia | No |
| `search` | Search historical records | Yes |
| `tree` | Read from shared Family Tree | Yes |
| `cets` | Read/write personal user trees | Yes |

## Current Focus

**Phase 2 — Public Tools** (`collections` and `places`). These don't require
authentication and can be built now.

## Key API Endpoints

```
# Collections (public)
GET https://api.familysearch.org/platform/collections

# Places (public)
GET https://api.familysearch.org/platform/places/search?q={query}
GET https://api.familysearch.org/platform/places/{placeId}

# Wikipedia summary (for places enrichment)
GET https://en.wikipedia.org/api/rest_v1/page/summary/{title}
```

---

## Task Progress

### Phase 0 — Setup

| # | Task | Status |
|---|------|--------|
| 1 | Register with FamilySearch developer program | Not started |
| 2 | Initialize TypeScript MCP server project | **Done** |
| 3 | Create FamilySearch API client module | Not started |

### Phase 1 — Authentication

| # | Task | Status |
|---|------|--------|
| 4 | Implement token storage | Not started |
| 5 | Implement OAuth login flow | Not started |
| 6 | Token refresh + register login tool | Not started |

### Phase 2 — Public Tools

| # | Task | Status |
|---|------|--------|
| 7 | Build `collections` tool | Not started |
| 8 | Build `places` tool | **Done** |

### Phase 3 — Authenticated Tools

| # | Task | Status |
|---|------|--------|
| 9 | Build `search` tool | Not started |
| 10 | Build `tree` tool | Not started |
| 11 | Build `cets` tool | Not started |

### Phase 4 — Testing & Polish

| # | Task | Status |
|---|------|--------|
| 12 | End-to-end testing | Not started |
| 13 | Error handling and edge cases | Not started |
| 14 | Documentation and installation guide | Not started |
