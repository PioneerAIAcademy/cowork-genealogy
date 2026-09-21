# PLAN — #2593: rename `artifactUrl` to `artifact_url`

**Status:** proposed, not started. Governing instruction: @chesworthrm on PR #2586,
2026-09-17, "Where this lands is my call, not yours: do it in #2593, not here."

## Why here and not #2586

`init-project/SKILL.md` and `eval/fixtures/mcp/person-read-flynn-family.json` are
snapshot-tracked, so renaming on #2586 invalidates its run log and buys another paid
`init-project` run ($4.67). #2593 already has a run budgeted, so it is free here.

## The rule being applied

CLAUDE.md, "Identifier casing": API/wire surfaces are camelCase; **persisted documents
are snake_case**. `person_read` returns simplified-GedcomX, a persisted-document shape,
so its fields are snake_case. This PR's own `imageRef` -> `image_ref` rename set the
precedent; `artifactUrl` landed later on the same object and is the only camelCase field
on it.

## ORDERING — this is the part that is not optional

#2593 is **125 commits behind its base** and its head carries the field in only 7 of the
10 files. Three sites arrived in the base after #2593 diverged:

- `eval/fixtures/mcp/person-read-flynn-family.json`
- `eval/harness/tests/unit/test_init_project_provenance_validators.py`
- `packages/engine/plugin/skills/init-project/SKILL.md`

So the catch-up merge must land FIRST. Renaming before it produces a half-done rename
that looks complete on this head and is not: the three missing sites arrive later still
spelled camelCase, and nothing fails, because no check compares the two spellings.

Step 0 is therefore: merge `origin/1689-person-read-memories` into
`1689-person-read-siblings` and resolve. The known conflict is
`init-project/SKILL.md` around the "minus `notes`, `text`, `image_ref`" clause, which
both sides edited (#2593 added "siblings" to the relatives list; the base added
`artifactUrl` to the dropped-field list). Both edits are kept.

## Sites: RENAME (10 occurrences across 8 files)

The field is the one on `TreeSource`, the `person_read` response object.

1. `packages/engine/mcp-server/src/types/person-read.ts` — `artifactUrl?: string` on
   `TreeSource`, plus its doc comment.
2. `packages/engine/mcp-server/src/tools/person-read.ts` — the emitted key in
   `toTreeSource`: `{ artifactUrl: m.artifactUrl }` becomes
   `{ artifact_url: m.artifactUrl }`. The right-hand side stays camelCase; it reads the
   internal `Memory`.
3. `docs/specs/person-read-tool-spec.md` — three places (the `sources[]` field-table row
   and two prose mentions).
4. `packages/engine/plugin/skills/init-project/SKILL.md` — the dropped-field clause.
5. `eval/fixtures/mcp/person-read-flynn-family.json` — both memory rows and the
   `description` prose that names the field.
6. `eval/harness/validators/test_init_project.py` — the V6 allow-list discriminator.
7. `eval/harness/tests/unit/test_init_project_provenance_validators.py` — the meta-tests'
   fixtures and docstrings.
8. `packages/engine/mcp-server/tests/tools/person-read-memories.test.ts` — the assertions
   on a returned source, and the comment above them.

## Sites: DO NOT RENAME

- `packages/engine/mcp-server/src/utils/memories.ts` — `Memory.artifactUrl` (5 sites).
  chesworthrm: "Leave `Memory.artifactUrl` as it is, that one mirrors the upstream field,
  which is the correct side of the boundary." It holds `sourceDescriptions[].about`
  verbatim off the FamilySearch API, which is camelCase by the same rule.
- `packages/engine/mcp-server/tests/utils/memories.test.ts` — tests that `Memory` shape.
- **`memoryArtifactUrl` (45 occurrences) and `isMemoryArtifactUrl` (6).** These are an MCP
  tool INPUT parameter and a function name. Both are correctly camelCase and both CONTAIN
  the string being renamed, so a substring replace corrupts all 51.

## Method

Word-boundary replace only, never a bare substring:

    perl -pi -e 's/(?<![A-Za-z])artifactUrl\b/artifact_url/g'

applied to the eight files above. `(?<![A-Za-z])` is what protects `memoryArtifactUrl`
and `isMemoryArtifactUrl`; `\b` alone does not, because there is no word boundary inside
`memoryArtifactUrl`.

## Acceptance — each falsifiable

1. `git grep -n 'artifactUrl'` returns hits ONLY in `utils/memories.ts`,
   `tests/utils/memories.test.ts`, and as part of `memoryArtifactUrl` /
   `isMemoryArtifactUrl`. Verified by a grep that excludes those two spellings.
2. `memoryArtifactUrl` count is unchanged at 45; `isMemoryArtifactUrl` at 6.
3. `make engine-test` passes (build + typecheck + vitest). Typecheck is what catches a
   half-renamed field, since `TreeSource` is a typed interface.
4. `make harness-test` passes — the two validator files are Python and typecheck cannot
   reach them, so this is the check that guards sites 6 and 7.
5. The V6 allow-list test still discriminates: it is written against the allow-list
   `{id, title, citation, author, url}`, so `artifact_url` must still be rejected as a
   tree-source field. Break-test: add `artifact_url` to a written tree source and confirm
   the meta-test reds.
6. `check_runlogs.py` reds for a stale snapshot, which is EXPECTED and is why the run is
   budgeted. It is not clean until the paid run and its annotation land.

## What this costs

One paid `make eval-skill SKILL=init-project` run (~$4.70) plus a genealogist annotation,
because sites 4 and 5 are snapshot-tracked. chesworthrm budgeted this run to #2593.

## Not in scope

- Half 1's sibling fan-out itself, which is what #2593 is for and is already built.
- Any change to `Memory`, `memoryArtifactUrl`, or the MCP input schema.
