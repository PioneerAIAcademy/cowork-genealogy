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
tree_query({ projectPath, personIds?, factTypes?, includeSources?, sourceIds? }) -> persons, relationships, sources? (read-only)
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
| `personIds` | string[] | Persons to return, by tree id (`I1`) or FamilySearch id (`KWCH-ABC`), in that order. Omitted or `[]` = every person, in tree order. |
| `factTypes` | string[] | Keep only facts of these types, matched case-insensitively on the type's last URI segment (`Birth` matches `http://gedcomx.org/Birth`). Omitted or `[]` = all. |
| `includeSources` | boolean | Return the source entries cited by what is returned. Default `false`: no `sources` key at all. |
| `sourceIds` | string[] | Return these source entries, whether or not a returned person cites them. Implies `includeSources`; `[]` behaves as `includeSources: true`. Persons and edges still follow `personIds`. |

A `personIds`, `factTypes` or `sourceIds` that is not an array of strings, or an
`includeSources` that is not a boolean, is `{ ok: false, errors: [...] }`.

### 2.2 Return value

Wire-side **camelCase** (a tool output, not a persisted document — see
CLAUDE.md, "Identifier casing"):

```typescript
{
  ok: true,
  truncated?: true,                      // the answer was cut to the budget (see "Size")
  omittedPersonIds?: string[],           // persons cut, in the order they would have come
  omittedSourceIds?: string[],           // source entries cut that a follow-up must name
  persons: [{
    id: string,
    ark?, living?: boolean, gender?,
    names?: [{ id?, preferred?: true, type?, prefix?, given?, surname?, suffix? }],  // array order
    facts?: [{
      id?, type?, primary?: true,
      date?, standardDate?, place?, standardPlace?, value?,
      assertionId?,
      sourceRefs?: string[],                             // distinct S ids on the fact
    }],
    sourceRefs?: string[],               // distinct S ids cited anywhere on the person
  }],
  relationships: [{
    id?, type?: "Couple" | "ParentChild" | <raw>,   // last URI segment
    person1?, person2?, parent?, child?, subtype?,
    facts?: [ /* same shape as above — a Couple's Marriage lives here */ ],
    notes?: string[],
    sourceRefs?: string[],                 // distinct S ids on the edge itself
  }],
  sources?: [{ id, title?, citation?, author?, url? }],   // only with includeSources or sourceIds
  missingPersonIds: string[],            // requested ids matching nothing
}
// on failure: { ok: false, errors: string[] }
// outside a project: { ok: false, reason: "no_project", ... } — the shared answer, not an error
```

Rules:

- **Omitted keys** — on persons, names, facts and relationships a key whose value
  would be `null`, `""` or `[]` is left out: absent means null or none. A fact's
  `place` is left out when it equals `standardPlace`, and its `date` when it
  equals `standardDate`: an absent `place` with a `standardPlace` means the two
  are the same. A name's `preferred` and a fact's `primary` are sent only when
  true, the tree file's own rule (`simplified-gedcomx-spec.md` §6: absence means
  false). Fact, name and relationship
  ids are kept: `tree_edit` and `tree_correct` address facts by id.
- **Persons** — `tree.persons[]` in array order, or in `personIds` order when
  given. A `personIds` entry matching no tree id is read as a FamilySearch id and
  returns every person whose `ark` names it (`treePidOfArk`, case-insensitive;
  the `findAnchor` rule, except that two linked persons are both returned rather
  than refused). Duplicates are dropped. A person without a string `id` is
  skipped.
- **`sourceRefs`** — the distinct `ref` values on the person, every name, and
  **every fact, including facts `factTypes` removed**, so the filter never
  changes which sources a person is reported as citing.
- **Relationships** — every edge when no `personIds`; otherwise every edge with
  at least one end (`person1`, `person2`, `parent`, `child`) among the returned
  persons. The relationship `type` matches on its last segment, as in
  `project_context`. `factTypes` filters an edge's facts too.
- **Sources** — absent unless asked for. `includeSources: true` returns the
  `tree.sources[]` entries cited by a returned person, name, fact, or
  relationship (or its facts), in tree order; an uncited description is not
  returned. `sourceIds` returns the named entries that exist, in request order,
  cited or not. Facts keep their `sourceRefs` either way, so "no sources" and
  "not requested" stay distinguishable.
- **`missingPersonIds`** — the requested ids that match neither a tree id nor
  any person's FamilySearch link, in request order; `[]` when no `personIds` was
  given.
- **Size** — an answer over `TOOL_RESULT_CHAR_BUDGET` (40,000 characters of
  compact JSON, as `server.ts` sends it) is cut and carries `truncated: true`.
  Persons are cut from the end of the order (the first is never cut), keeping
  only the edges touching a kept person and the cited sources a kept person or
  edge cites; then, if sources were asked for and it is still over, source
  entries are cut from the end. With `sourceIds`, the named entries are cut first
  when that alone fits every person; when the persons alone are over, the named
  entries are kept and persons go. `omittedPersonIds` names the persons cut: call
  again with `personIds: omittedPersonIds` (and `includeSources: true` if set).
  `omittedSourceIds` names the source entries cut that that follow-up would not
  bring back: call with `personIds: [<first returned id>], sourceIds:
  omittedSourceIds`. An agent that needs source content asks for the subject's
  sources by `personIds`, not with an opt-in on a family or whole-tree read. The one exception is research-plan's tree survey, which reads every person in scope with `includeSources: true`: the survey's job is a relative's person-level attachments, a deed attached only to a relative is otherwise unreachable, and the 40k cap bounds the read: persons are cut from the end with their sources, then sources, and the survey follows `omittedPersonIds`. It is the one exception to the rule that an agent reads the subject's sources only.

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
