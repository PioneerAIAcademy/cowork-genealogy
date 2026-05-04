# Project Goal — FamilySearch MCP Server

## What this project is

A two-piece system that lets Claude do FamilySearch genealogy
research from inside Cowork:

1. **An MCP server** (TypeScript, `mcp-server/`) that runs on the
   host and wraps FamilySearch + Wikipedia APIs as MCP tools.
2. **A Cowork plugin** (`plugin/`) with skills, slash commands, and
   templates that teach Claude when and how to use those tools.

The two are coupled but isolated. Cowork's sandboxed VM has
restricted egress, so anything that calls the network has to live
on the host (the MCP server). Skills inside the VM call host tools
through structured JSON over MCP — they never share files or
runtime code with the server.

For full architecture, conventions, and the developer guide, see
`CLAUDE.md`. For the long-form research and design history, see
`local/project-goal.md` (gitignored).

## Goal

Expose seven FamilySearch + reference-data tools to Claude:

| Tool | Purpose | Auth |
|------|---------|------|
| `wikipedia_search` | Wikipedia article summary | None |
| `places` | FamilySearch place data + Wikipedia enrichment | None |
| `login` / `logout` / `auth_status` | OAuth 2.0 + PKCE session management | — |
| `collections` | Record collections for a place | Yes |
| `search` | Search historical records | Yes |
| `tree` | Read from shared FamilySearch Family Tree | Yes |
| `cets` | Read/write personal user trees | Yes |

## Current Focus

**Phase 3 — Authenticated read tools.** With OAuth and `collections`
shipped, the next two tools are `search` (historical records) and
`tree` (shared Family Tree). `cets` (personal trees, includes write
operations) follows.

## Key API Endpoints

```
# Public
GET https://api.familysearch.org/platform/places/search?q={query}
GET https://api.familysearch.org/platform/places/{placeId}
GET https://en.wikipedia.org/api/rest_v1/page/summary/{title}

# Authenticated (Bearer token)
GET https://www.familysearch.org/service/search/hr/v2/collections
GET https://www.familysearch.org/service/search/hr/v2/personas
GET https://api.familysearch.org/platform/tree/persons/{pid}
GET / POST / PATCH .../platform/tree/trees/{treeId}/persons[/{personId}]
```

---

## Task Progress

### Phase 0 — Setup

| # | Task | Status |
|---|------|--------|
| 1 | Register with FamilySearch developer program | **Done** |
| 2 | Initialize TypeScript MCP server project | **Done** |
| 3 | Central FamilySearch API client module | **Skipped** (per-tool fetch chosen instead — see CLAUDE.md "Code reuse") |

### Phase 1 — Authentication

| # | Task | Status |
|---|------|--------|
| 4 | Token storage | **Done** |
| 5 | OAuth login flow with PKCE | **Done** |
| 6 | Token refresh + register login tool | **Done** |

### Phase 2 — Public Tools

| # | Task | Status |
|---|------|--------|
| 7 | `wikipedia_search` tool | **Done** |
| 8 | `places` tool | **Done** |

### Phase 3 — Authenticated Tools

| # | Task | Status |
|---|------|--------|
| 9 | `collections` tool | **Done** |
| 10 | `search` tool | **Spec'd** (v2 at `docs/specs/search-tool-spec-v2.md`); implementation pending |
| 11 | `tree` tool | Not started |
| 12 | `cets` tool | Not started |

### Phase 4 — Testing & Polish

| # | Task | Status |
|---|------|--------|
| 13 | End-to-end testing | In progress (per-tool testing guides under `docs/`) |
| 14 | Error handling and edge cases | In progress |
| 15 | Documentation and installation guide | In progress (`README.md`, `CLAUDE.md`, `docs/specs/`) |
