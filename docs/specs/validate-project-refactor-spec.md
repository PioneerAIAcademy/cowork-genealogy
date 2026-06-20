# `validateProject` refactor — in-memory validation entry point — Spec

> **Status:** New (2026-06-19). Prerequisite for the `merge_record_into_tree` /
> `merge_tree_persons` tools (see `merge-gedcomx-spec.md` §5b.2 step 4 and its
> implementation note). Pure structural refactor — **no validation rule changes**.

Extract an in-memory validation entry point from the project validator so callers
can validate already-parsed `research` / `tree` objects **before** writing them to
disk. Today the only entry point reads the files itself, so there is no way to ask
"would this project be valid *if* I wrote these objects?"

---

## 1. Why this exists

`merge_record_into_tree` / `merge_tree_persons` build a new `tree.gedcomx.json`
(and, in Mode 2, a remapped `research.json`) **in memory** and must validate the
result before persisting — the "validate-before-persist / never-invalid file"
guarantee in `merge-gedcomx-spec.md` §5b.2. The current validator only accepts a
`projectPath` and reads from disk, which would force a write-then-validate-then-
maybe-rollback dance. The same in-memory entry point is the natural fit for the
future `research_append` tool, which has the same "validate the would-be state"
need.

---

## 2. Current state (seen directly)

| Fact | Source |
|------|--------|
| Sole entry point: `validateProject(projectPath: string): Promise<ValidationResult>` | `packages/engine/mcp-server/src/validation/validator.ts:104` |
| It reads + `JSON.parse`s both files, reports parse failure, **returns early** if invalid, then runs the checks | `validator.ts:104–153` |
| Four private check functions: `validateResearch` (pure), `validateGedcomx` (pure), `validateCrossFile` (pure), `validateSidecars` (**async, reads `results/` from disk**) | `validator.ts:236, 737, 871, 953` |
| `ValidationResult = { valid, errors[], warnings[] }`; report helpers `createReport` / `addError` / `isValid` | `src/validation/types.ts` |
| Consumers: the `validate_research_schema` tool and the validator test suite (~35 cases) | `src/tools/validate-research-schema.ts:20`, `tests/validation/validator.test.ts` |
| No Python validator port remains in the plugin (the `validator.ts` header comment is historical) | grep `plugin/**/validate*.py` → none |

The key structural fact: of the four checks, **only `validateSidecars` touches the
filesystem** (it reads the `results/` directory and each `log[].results_ref`
sidecar). The other three are pure functions over the parsed objects.

---

## 3. The refactor

Add one exported function; slim `validateProject` to a thin reader in front of it.
The four private check functions are **unchanged**.

```typescript
// NEW — validate already-parsed objects. No file reads except, optionally,
// the sidecar pass (which needs projectPath to reach results/).
export async function validateParsed(
  research: unknown,
  tree: unknown,
  options?: { projectPath?: string },
): Promise<ValidationResult>;
```

Behavior of `validateParsed`:

1. Guard: if `research` or `tree` is `null` / not an object, `addError("", …)` for
   that file and **return early** (mirrors `validateProject`'s parse-failure
   early-return; the pure checks must not be handed `undefined`).
2. Run `validateResearch`, `validateGedcomx`, `validateCrossFile` (synchronous,
   no disk) — exactly as `validateProject` does today.
3. **Sidecar pass is conditional on `options.projectPath`:**
   - With `projectPath` → `await validateSidecars(research, projectPath, report)`
     (identical to today).
   - Without `projectPath` → **skip** the sidecar pass (no disk access at all).
4. Return `{ valid: isValid(report), errors, warnings }`.

`validateProject` becomes the reader that owns file I/O and parse-error reporting,
then delegates:

```typescript
export async function validateProject(projectPath: string): Promise<ValidationResult> {
  // read + JSON.parse research.json and tree.gedcomx.json
  // on parse failure: addError and return early (UNCHANGED from today)
  return validateParsed(research, tree, { projectPath });
}
```

Because `validateProject` always passes `{ projectPath }`, the sidecar pass still
runs for the existing tool path → its results are **byte-identical** to today.

---

## 4. Behavior-preservation contract

- `validate_research_schema` keeps calling `validateProject(projectPath)`
  unchanged; its output must be identical before and after the refactor.
- The existing `tests/validation/validator.test.ts` (~35 cases) must pass
  **unmodified** — this is the primary proof that `validateProject` behavior is
  preserved.
- No enum, required-field, cross-reference, or sidecar **rule** changes. This is a
  mechanical extraction only.

---

## 5. The sidecar decision (why it is `projectPath`-gated, and what merge passes)

Sidecar validation (`validateSidecars`, validator.ts:953) reads `results/` and
each `log[].results_ref` payload, and resolves every assertion's
`record_persona_id` inside the named record (D5). It is inherently disk-coupled,
so a truly in-memory call cannot run it. Two facts make the gating clean:

- **It depends only on `research` + the on-disk `results/` files** — not on
  `tree`. So validating an in-memory `research` against the **unchanged** on-disk
  sidecars is well-defined.
- **A merge does not change anything sidecar validation inspects.** The tools
  modify `tree.gedcomx.json` and (Mode 2) remap person-id refs in `research.json`
  (`subject_person_ids`, `person_evidence.person_id`, `timelines.person_ids`,
  `known_holdings.relates_to_person_ids`). None of those are read by the sidecar
  pass, which keys off `log[].results_ref` and `assertions[].record_persona_id /
  record_id / log_entry_id`. Sidecar results are therefore **invariant under a
  merge**.

**Recommendation for the merge tools: pass `{ projectPath }`.** The sidecar pass is
**invariant** under a merge (the facts above), so for the merge case it adds no new
coverage — pass it anyway as **belt-and-suspenders** against that invariance
assumption ever being wrong, accepting the cost of re-reading `results/` on each
merge (the same full-project read priced in `research-log-editor-spec.md` §6
"Validation cost"). Omitting `projectPath` is the right choice only for a caller that
genuinely has no project directory or deliberately wants structural-only validation;
document that as the narrower mode.

---

## 6. Errors / edge cases

| Condition | Behavior |
|-----------|----------|
| `research` or `tree` is `null` / not an object | `addError`, return early; never throw (§3 step 1) |
| `options` omitted or `projectPath` absent | skip the sidecar pass; pure checks still run |
| `projectPath` given but `results/` absent | unchanged — `validateSidecars` already tolerates a missing `results/` dir |
| Parse failure (path entry point only) | unchanged — `validateProject` reports it and returns early before delegating |

---

## 7. Test plan (vitest, alongside `validator.test.ts`)

- **Parity** — for each existing fixture (valid + a spread of invalid cases),
  write it to a temp dir, then assert
  `validateParsed(research, tree, { projectPath })` deep-equals
  `validateProject(projectPath)` (same `valid`, same `errors`, same `warnings`,
  same order). This pins `validateProject ≡ reader + validateParsed`.
- **Sidecar toggle** — a project whose only error is a sidecar error returns
  `valid: false` with `{ projectPath }` and `valid: true` without it (proves the
  pass is gated and otherwise inert).
- **Null/non-object guard** — `validateParsed(null, tree)` and
  `validateParsed(research, null)` return an error and do not throw.
- **Unchanged suite** — the existing `validator.test.ts` passes without edits.

---

## 8. Non-goals

- Not a new MCP tool — `validate_research_schema` is untouched.
- Not the `research_append` tool (separate work; this is a shared prerequisite).
- No rule/enum/schema changes; no `results/` format changes.
- The historical "Port of validate_project.py" header comment may be corrected to
  note the TS validator is now the single implementation, but that is cosmetic.

---

## 9. Consumers

- `merge_record_into_tree` / `merge_tree_persons` — `merge-gedcomx-spec.md` §5b.2
  step 4 (import `validateParsed` from `../validation/validator.js`).
- Future `research_append` — same validate-before-persist need.
- `validate_research_schema` — continues through `validateProject` unchanged.

---

## 10. Related prerequisite — the shared write layer (first writers of project files)

`validateParsed` is the *read/validate* half of the read/write tools. The *write*
half is a sibling prerequisite worth landing in the same window, because the merge
and log tools (`merge-gedcomx-spec.md`, `research-log-editor-spec.md`) are the
**first code in the MCP server to write `research.json` / `tree.gedcomx.json`** —
today the server only ever reads them (`validate_research_schema`, `person_warnings`;
the only `writeFile`s anywhere are auth tokens). That makes the write path a
corrupt-the-user's-project blast radius, so its primitives should be lifted to
shared, **independently unit-tested** utils rather than reimplemented in each tool:

- `atomicWriteJson(path, obj)` — single-file temp-write + rename
  (`research_log_append`, `merge_record_into_tree`).
- `atomicWriteBoth(...)` — two-file both-or-neither, used by `merge_tree_persons`,
  which rewrites tree + research together. Note: two renames are **not** truly atomic
  on POSIX; the contract is write-both-temps → rename-both back-to-back to shrink the
  window, with validate-on-next-open as the backstop. Test it with an injectable
  failure point between the two renames.
- `assertInsideProject(projectPath, ref)` — the path-traversal guard currently
  inlined at `validator.ts:988` and re-described by `research-log-editor-spec.md` §8
  and `search-result-staging-spec.md` §6. One implementation, one test.

Additionally, **export `validateGedcomx`** (today a private function at
`validator.ts:737`; it already takes a parsed tree + a report and no `projectPath`).
`merge_record_into_tree` must validate its inline `candidateGedcomx` argument
(`merge-gedcomx-spec.md` §8) and should reuse this, not hand-roll a parallel check —
`validateParsed` validates a research+tree *pair*, so it does not cover the
standalone-candidate case. Exporting it is in scope here because it is the same
validation-module surface this refactor already touches.
