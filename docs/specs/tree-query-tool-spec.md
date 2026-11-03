# `tree_query` — filtered read of the tree — Spec

> **Status:** New (2026-10-28; decided by Richard 2026-10-27).
> The tree-side read tool. No other tool serves tree facts:
> `research_query` excludes the tree (`research-query-tool-spec.md`, "No
> `tree.gedcomx.json` access") and `project_context` carries only ids, names,
> one-hop family and `diedByYear`. Agents that needed a person's dates, places,
> marriages, ark or a source's author opened `tree.gedcomx.json` with the
> built-in `Read`, which Cowork's VM cannot see (a stale staged copy at best) and
> a remote project store makes miss outright.

```
tree_query({ projectPath, personIds?, factTypes? }) -> persons, relationships, sources (read-only)
```

## 1. Why a new tool

Extending `project_context` would put the larger projection on every caller's
every call, and most callers need only ids. Extending `research_query` would
break its stated contract. A separate read-only tool leaves both unchanged and
lets a caller pay only when it needs facts.

## 2. The tool

Read-only: reads `tree.gedcomx.json` through `readProjectJson`, writes nothing,
never creates a `.bak`. Not a validator — a malformed *entry* is skipped
defensively; only an unreadable or unparseable file is an error
(`validate_research_schema` diagnoses it).

### 2.1 Input

| Param | Type | Notes |
|---|---|---|
| `projectPath` | string, required | Project directory. |
| `personIds` | string[] | Tree person ids to return. Omitted or `[]` = every person. |
| `factTypes` | string[] | Keep only facts of these types, matched case-insensitively on the type's last URI segment (`Birth` matches `http://gedcomx.org/Birth`). Omitted or `[]` = all. |

A `personIds` or `factTypes` that is not an array of strings is
`{ ok: false, errors: [...] }`.

### 2.2 Return value

Wire-side **camelCase** (a tool output, not a persisted document — see
CLAUDE.md, "Identifier casing"):

```typescript
{
  ok: true,
  persons: [{
    id: string,
    ark: string | null,
    living: boolean | null,
    gender: string | null,
    names: [{ id, preferred: boolean, type, prefix, given, surname, suffix }],  // all names, array order
    facts: [{
      id, type, primary: boolean | null,
      date, standardDate, place, standardPlace, value,   // each string | null
      assertionId: string | null,
      sourceRefs: string[],                              // distinct S ids on the fact
    }],
    sourceRefs: string[],                // distinct S ids cited anywhere on the person
  }],
  relationships: [{
    id, type: "Couple" | "ParentChild" | <raw>,   // last URI segment
    person1, person2, parent, child, subtype,     // string | null
    facts: [ /* same shape as above — a Couple's Marriage lives here */ ],
    notes: string[],
    sourceRefs: string[],                  // distinct S ids on the edge itself
  }],
  sources: [{ id, title, citation, author, url }],   // string | null except id
  missingPersonIds: string[],            // requested ids not in the tree
}
// on failure: { ok: false, errors: string[] }
// outside a project: { ok: false, reason: "no_project", ... } — the shared answer, not an error
```

Rules:

- **Persons** — `tree.persons[]` in array order, narrowed to `personIds` when
  given. A person without a string `id` is skipped.
- **`sourceRefs`** — the distinct `ref` values on the person, every name, and
  **every fact, including facts `factTypes` removed**, so the filter never
  changes which sources a person is reported as citing.
- **Relationships** — every edge when no `personIds`; otherwise every edge with
  at least one end (`person1`, `person2`, `parent`, `child`) among the returned
  persons. The relationship `type` matches on its last segment, as in
  `project_context`. `factTypes` filters an edge's facts too.
- **Sources** — only the `tree.sources[]` entries cited by a returned person,
  name, fact, or relationship (or its facts). An uncited description is not
  returned.
- **`missingPersonIds`** — the requested ids with no person, in request order;
  `[]` when no `personIds` was given.
- **Size** — no `personIds` returns the whole tree, which grows with the
  project. Callers pass `personIds` (the subject, a household) and `factTypes`
  when they can.

### 2.3 Not in scope

- Research records (`research_query`), the person/question/source overview and
  profile (`project_context`), and any write (`tree_edit`, `tree_correct`).
- Computed fields (warnings, quality, candidate matches). Those have their own
  tools.

## 3. Sites

Added as a new MCP tool: `src/tools/tree-query.ts`; `allToolSchemas` and
`READ_ONLY` in `src/tool-schemas.ts`; dispatch arm in `src/server.ts`;
`manifest.json` `tools`; `dev/smoke-calls.ts` row; `dev/try-tree-query.ts`;
`tests/tools/tree-query.test.ts`; `tests/tools/no-project.test.ts`; the
`docs/catalog.md` tool table; `eval/harness/harness/mock_mcp.py`
(`_COMPILED_TOOLS`, so the unit harness serves it from the workspace).
