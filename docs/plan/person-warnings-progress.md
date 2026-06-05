# person_warnings — Implementation Progress

**Branch:** `person-warning-tool`
**Spec:** `docs/specs/person-warnings-tool-spec.md`
**Issue:** #25

Keep this file updated as you complete steps. Check off items, add
notes, and record any decisions. Your teammate picks up from wherever
you left off.

---

## Status

**Current phase:** Spec complete, implementation not started.

---

## Checklist

### 1. Spec
- [x] Write spec (`docs/specs/person-warnings-tool-spec.md`)
- [x] Spec reviewed and tightened
- [x] Spec review round with Dallan + Richard (2026-05-27) — changes applied; see Notes
- [ ] Resolve blocked items: warning-list tags/messages (Richard), date-format decision (Dallan)
- [ ] Spec approved / merged (or approved as part of implementation PR)

### 2. Types
- [ ] Create `mcp-server/src/types/person-warnings.ts`
  - `PersonWarningsInput` — `{ projectPath: string; personId?: string }`
  - `PersonWarning` — `{ warningId, severity, personId, personName, message, factIds, relatedPersonId? }`
  - `PersonWarningsResult` — `{ personsChecked, warningCount, warnings[], message }`

### 3. Tool implementation
- [ ] Create `mcp-server/src/tools/person-warnings.ts`
  - [ ] `extractYear(dateStr)` — date string → year, exported
  - [ ] `extractEarliestYear(dateStr)` — range-aware, returns start, exported
  - [ ] `extractLatestYear(dateStr)` — range-aware, returns end, exported
  - [ ] `personWarningsTool(input)` — main function
  - [ ] `personWarningsToolSchema` — MCP schema
  - [ ] W1: `DEATH_BEFORE_BIRTH` check
  - [ ] W2: `FATHER_TOO_YOUNG` check
  - [ ] W3: `EVENT_AFTER_DEATH` check
  - [ ] `getPersonName()` helper (preferred name → first name → `"Unknown (id)"`)
  - [ ] Error handling (throw vs return per spec)

### 4. Registration
- [ ] Wire into `mcp-server/src/index.ts`
  - Import `personWarningsTool`, `personWarningsToolSchema`, type
  - Add schema to `ListToolsRequestSchema` handler
  - Add `if` block to `CallToolRequestSchema` handler

### 5. Smoke test
- [ ] Create `mcp-server/dev/try-person-warnings.ts`

### 6. Unit tests
- [ ] Create `mcp-server/tests/tools/person-warnings.test.ts`
  - [ ] `extractYear()` tests (1–12)
  - [ ] `extractEarliestYear()` tests (13–21)
  - [ ] `extractLatestYear()` tests (22–30)
  - [ ] W1 tests (31–38)
  - [ ] W2 tests (39–45)
  - [ ] W3 tests (46–51)
  - [ ] Integration tests (52–59)

### 7. Verify
- [ ] `npm run build` passes
- [ ] `npm test` passes
- [ ] Manual test with MCP Inspector
- [ ] Spec review (run `spec-review` agent against implementation)

### 8. PR
- [ ] PR created
- [ ] PR reviewed and merged

---

## Key decisions

| Decision | Rationale |
|----------|-----------|
| `projectPath` input, not inline JSON | Matches `validate_research_schema` pattern, avoids wasting context tokens |
| Three date helpers (`extractYear`, `extractEarliestYear`, `extractLatestYear`) | `extractEarliestYear`/`extractLatestYear` handle ranges internally — no branching at call sites |
| Conservative range logic | Only flag when even the most generous interpretation of a range produces an impossible/unlikely result |
| Post-death exclusions: Burial, Cremation, Obituary, Probate, Will, Estate, Funeral | These fact types are expected after death |
| W2 emits warning on child, not father | The child's data is typically what needs correction |
| Throw for tool failures, return result for data conditions | Missing file / unknown person are reportable to the user, not crashes |
| `personName` fallback: preferred name → first name → `"Unknown (id)"` | Handles stub persons with no names |

---

## Patterns to follow

**Registration in index.ts** — Follow the `validate_research_schema`
block exactly. It's the most recent addition and closest in shape
(local file tool, no auth):

```typescript
// Import
import {
  personWarningsTool,
  personWarningsToolSchema,
  type PersonWarningsInput,
} from "./tools/person-warnings.js";

// ListTools — add to the tools array
personWarningsToolSchema,

// CallTool — add if block
if (request.params.name === "person_warnings") {
  try {
    const args = request.params.arguments as unknown as PersonWarningsInput;
    const result = await personWarningsTool(args);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return { content: [{ type: "text", text: JSON.stringify({ error: message }) }], isError: true };
  }
}
```

**Types file** — Follow `mcp-server/src/types/fulltext-search.ts` or
similar. Input and output types only, no logic.

**Tool file** — Follow `mcp-server/src/tools/validate-research-schema.ts`
for the file-reading pattern (`resolve(projectPath, "tree.gedcomx.json")`).

**Smoke test** — Follow any `mcp-server/dev/try-*.ts` script. Read
`process.argv` for projectPath and optional personId.

**Unit tests** — Follow `mcp-server/tests/tools/*.test.ts`. Use
in-memory test fixtures (no file I/O for warning logic tests). Use
temp directories + real files for integration tests.

---

## Notes

_Add freeform notes here as you work. Timestamp if helpful._

### 2026-05-27 — spec review with Dallan + Richard

Reviewed the spec live. Changes applied to
`docs/specs/person-warnings-tool-spec.md`:

- **`personId` is now REQUIRED.** It names the **anchor** person; it is
  not a scope filter. Warnings run from the anchor's point of view over
  the anchor + one-hop relatives (the "relative mob"). Removed the
  "omit to check all persons" mode. The file itself may hold everyone
  gathered so far, but the tool only checks the anchor's mob.
- **Removed `personsChecked` and the top-level `message`** from the
  output ("keep it simple"). `warningCount` is **kept** — it's a
  deterministic, code-derived count, unlike the natural-language
  `message` summary that was removed.
- **Error handling reworked:** with `message` gone, data-level
  conditions (file-not-found, person-not-found, no persons) now THROW
  (index.ts serializes a readable error) instead of returning a result.
  Flagged as an open question.
- **Removed `DUPLICATE_FACTS`** future candidate (same birth date can
  legitimately appear in two records).

Two items are **BLOCKED** pending input — do not finalize:

1. **Warning IDs + messages** — Richard (ChesworthRM) is sharing the
   existing FamilySearch quality-score warning list. Reuse its tags and
   the same English sentences for equivalent warnings. Current strings
   in the spec are placeholders.
2. **Dates** — Dallan to decide by EOD whether simplified GedcomX gets
   a standardized date format (+ a day-difference helper for future
   full-date warnings). v1's three warnings are year-only and unaffected.

**Process:** apply spec changes → open a NEW PR → review → then code.
Implementation stays not-started until the spec PR is approved.
