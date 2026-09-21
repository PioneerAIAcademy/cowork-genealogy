# PLAN — #2593: rename `artifactUrl` to `artifact_url`

**Status:** step 0 (catch-up merge) DONE at `36d76c285`; rename not started.
Revised after plan-critic round 1, which found three blocking defects in the first draft.
Every correction below was re-verified by hand before being written in. Governing instruction: @chesworthrm on PR #2586,
2026-09-17, "Where this lands is my call, not yours: do it in #2593, not here."

## Why here and not #2586

`init-project/SKILL.md` and `eval/fixtures/mcp/person-read-flynn-family.json` are
snapshot-tracked, so renaming on #2586 invalidates its run log and buys another paid
`init-project` run ($4.67). #2593 already has a run budgeted, so it is free here.

## The rule being applied — narrower than the first draft said

chesworthrm's actual argument: `artifactUrl` is **the only camelCase field on
`TreeSource`**, sitting directly beside `image_ref`. That is the whole case and it holds.

The first draft justified it as "person_read returns a persisted-document shape, so its
fields are snake_case". That OVER-REACHES and is wrong here: `artifactUrl` is explicitly
NOT persisted — `TREE_SOURCE_FIELDS` is `{id, title, citation, author, url}`
(`tree-shape.ts:29`) and rejects it. The same repo ships `imageRef` camelCase on two other
tool responses carrying the same kind of value, so the broad rule would demand renames
nobody ruled on. Use the narrow argument.

(The `imageRef` -> `image_ref` precedent landed on #2586, not on this PR.)

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

## Sites: RENAME — 20 occurrences across 8 files

The first draft said 10. It is 20; per-file counts below, so the implementer has a
yardstick that is not off by 2x.

The field is the one on `TreeSource`, the `person_read` response object.

1. `packages/engine/mcp-server/src/types/person-read.ts` — `artifactUrl?: string` on
   `TreeSource`, plus its doc comment.
2. `packages/engine/mcp-server/src/tools/person-read.ts` — **HAND EDIT ONLY, 1 of its 6
   occurrences.** At `:382` change the object KEY and nothing else:
   `...(m.artifactUrl !== undefined ? { artifact_url: m.artifactUrl } : {})`.
   Lines `:236`, `:247` and `:256` are `m.artifactUrl` reads of the internal `Memory` and
   MUST NOT change; `:382` itself contains two more of them on the same line.
   **This file is excluded from the bulk replace.** Running the recipe over it rewrites all
   five Memory reads to `m.artifact_url`, which does not exist on `Memory`. Verified by
   running the recipe against the file.
3. `docs/specs/person-read-tool-spec.md` — three places (the `sources[]` field-table row
   and two prose mentions).
4. `packages/engine/plugin/skills/init-project/SKILL.md` — the dropped-field clause.
5. `eval/fixtures/mcp/person-read-flynn-family.json` — both memory rows and the
   `description` prose that names the field.
6. `eval/harness/validators/test_init_project.py` — **4 occurrences, and the first draft
   named the wrong one.** The live read is `s.get("artifactUrl")` at `:182`, inside
   `test_init_empty_sections`, with its docstring at `:165`. That is the discriminator that
   gates and bounds the whole memory-sources exemption. The two V6 mentions (`:687`, `:693`,
   inside `test_returned_sources_reach_the_tree_without_notes`) are docstring PROSE — V6's
   check is `set(s) - allowed` and never names the field.
   Leaving `:182` camelCase makes `memory_sources` empty on every run, so the validator
   red-flags a CORRECT init-project run — and it would do so inside the paid run.
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

    perl -pi -e 's/(?<![A-Za-z.])artifactUrl\b/artifact_url/g'

applied to SEVEN files — every site above EXCEPT `src/tools/person-read.ts`, which is a
hand edit.

The first draft's stated protection was false. `memoryArtifactUrl` and `isMemoryArtifactUrl`
are safe because they spell it `ArtifactUrl` with a capital A: **case protects them, not the
boundary**, and the lookbehind is inert against all 54. Proven by running the replace with
the lookbehind removed and watching both survive.

The real over-match is `m.artifactUrl`, a `.`-prefixed read of the internal `Memory`. That is
why `.` is now in the lookbehind class AND why `src/tools/person-read.ts` is excluded
entirely — belt and braces, because that file is where all five live.

## Acceptance — each falsifiable

1. Bare `artifactUrl` survives in EXACTLY three files, 13 occurrences:
   `src/utils/memories.ts` 5, `src/tools/person-read.ts` 5, `tests/utils/memories.test.ts` 3.
   The first draft's version of this check RED-FLAGGED A CORRECT RESULT, because it omitted
   `src/tools/person-read.ts` — and the way to make it green was to commit blocking defect 1.
2. `memoryArtifactUrl` unchanged at **54** (not 45 — the first draft counted only `*.ts`);
   `isMemoryArtifactUrl` at 6. `artifact_url` has zero pre-existing occurrences, so there is
   no collision to worry about.
3. `make engine-test` passes. **Do NOT rely on typecheck to catch a half-rename**: the
   conditional-spread form at `person-read.ts:382` is exempt from TypeScript's
   excess-property check, so renaming the interface and leaving the emit alone typechecks
   CLEAN while the tool silently keeps emitting the old key. The check that actually
   discriminates is `tests/tools/person-read-memories.test.ts` -> "carries the artifact URL,
   so the retry the note names is reachable", once site 8 is renamed.
4. `make harness-test` passes. Be precise about what this buys: it guards sites 6 and 7
   AGAINST EACH OTHER only. Both are Python with their own fixtures; nothing ties either to
   the engine's actual emitted key or to the flynn fixture.
5. The discriminating meta-test is
   `test_init_project_provenance_validators.py::test_acceptance_14_fires_when_an_untranscribed_memory_got_an_entry_anyway`.
   With site 6 renamed and site 7 not (or the reverse), `memory_sources` is empty, the
   exemption never engages, and its substring assertion fails. The first draft named a V6
   break-test that passes identically before and after the rename, i.e. measured nothing.
6. `check_runlogs.py` reds for a stale snapshot, which is EXPECTED and is why the run is
   budgeted. It is not clean until the paid run and its annotation land.

7. NEW GUARD, and it must be proven to fail both ways: extend the `person_read` fixture
   contract block in `eval/harness/tests/unit/test_fixtures.py` to assert no source key in
   any `person_read` fixture matches `^[a-z]+[A-Z]`. Today nothing ties the Python side to
   the engine's key, so renaming everything except the two Python files leaves BOTH suites
   green and the first symptom is a false red inside the paid run. Prove it: put
   `artifactUrl` back on one flynn row and watch it red, then confirm it still accepts
   `standard_place`, `image_ref` and `artifact_url`.

## What this costs

One paid `make eval-skill SKILL=init-project` run (~$4.70) plus a genealogist annotation,
because sites 4 and 5 are snapshot-tracked. chesworthrm budgeted this run to #2593.

## Not in scope

- Half 1's sibling fan-out itself, which is what #2593 is for and is already built.
- Any change to `Memory`, `memoryArtifactUrl`, or the MCP input schema.
