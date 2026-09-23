# `validate_research_schema` — project file validation — Spec

> **Status:** New (2026-09-22). Covers the tool's I/O contract at the
> MCP boundary. The validation rule set is owned by
> `research-schema-spec.md`; this spec does not restate it.

```
validate_research_schema({ projectPath }) -> { valid, errors[], warnings[], message }
```

---

## 1. Purpose

Validates `research.json` and `tree.gedcomx.json` against their published
schemas. Catches structural errors, missing required fields, invalid
enums, and broken cross-references. Intended to be called after writing
to either file.

The tool is a thin wrapper around `validateProject` — it formats results
for the MCP boundary and catches every throw from it, so a caller that
supplies `arguments` receives a structured result rather than an
MCP-level error. A call that omits `arguments` entirely is the one
exception (§3.4).

## 2. Input

```typescript
{
  projectPath: string;   // required — absolute path to the project directory
}
```

The directory is expected to contain `research.json` and
`tree.gedcomx.json`.

## 3. Output

```typescript
{
  valid: boolean;
  errors: string[];      // each formatted "${path}: ${message}"
  warnings: string[];    // each formatted "${path}: ${message}"
  message: string;
}
```

### 3.1 Success

When both files pass all checks:

```json
{
  "valid": true,
  "errors": [],
  "warnings": [],
  "message": "Both project files pass all validation checks."
}
```

### 3.2 Validation failure

When `validateProject` returns `valid: false`:

```json
{
  "valid": false,
  "errors": ["<path>: <message>", ...],
  "warnings": ["<path>: <message>", ...],
  "message": "Validation failed: N error(s), M warning(s)"
}
```

### 3.3 Missing or unparseable files

Both project files are required. A missing or invalid-JSON
`research.json` or `tree.gedcomx.json` is reported as an `errors[]`
entry by `validateProject` (e.g. `": research.json not found or invalid
JSON: ..."`) and returns `valid: false` before any further checks run.
This is the normal validation path, not the catch arm.

### 3.4 Unexpected throw (catch arm)

If `validateProject` throws (rather than returning a result), the catch
arm returns:

```json
{
  "valid": false,
  "errors": ["Validation error: <error message>"],
  "warnings": [],
  "message": "Validation error: <error message>"
}
```

This is the only path where `errors[]` carries the `"Validation error: "`
prefix.

One case escapes the structured result. `validateResearchSchema`
destructures `input` before it enters its `try`, so a `tools/call` that
omits `arguments` altogether — the MCP protocol marks `arguments`
optional, and `server.ts` does not validate it against `inputSchema` —
throws `Cannot destructure property 'projectPath' of 'input' as it is
undefined`. `server.ts` catches that and returns `{ error: "<message>" }`
with `isError: true`. Whenever `arguments` is present, every outcome is a
structured result and `isError` is never set.

## 4. Validation rules

The rule set lives in `validateProject`
(`packages/engine/mcp-server/src/validation/validator.ts`) and is
specified by `docs/specs/research-schema-spec.md`. This spec does not
restate them.

The rule set is exercised by 215 cases in
`tests/validation/validator.test.ts` (measured 2026-09-23 — the count
`vitest` reports, not the `it(` line count, since the file builds many of
its cases in `for` loops and `it.each` blocks). The figure tracks a file
that grows with the rule set and nothing checks it, so re-measure rather
than trusting it: `npx vitest run tests/validation/validator.test.ts`.

## 5. Consumers

Skills that call this tool after writing project files:
`research/SKILL.md`, `research-plan/SKILL.md`,
`hypothesis-tracking/SKILL.md`, `citation/SKILL.md`,
`tree-edit/SKILL.md`, `timeline/SKILL.md`,
`validate-schema/SKILL.md`.

Agents: `person-evidence.md`, `gps-mentor.md`.

Referenced in: `citation/references/validation-protocol.md`.

## 6. Implementation

Source: `packages/engine/mcp-server/src/tools/validate-research-schema.ts`
(68 lines). Schema registered in `allToolSchemas`
(`src/tool-schemas.ts`), dispatch in `src/server.ts`. No smoke test
script exists for this tool.
