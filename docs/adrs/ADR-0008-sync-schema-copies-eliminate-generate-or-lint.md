# ADR-0008: Sync the schema copies by elimination, automatic generation, or lint

> **Read before you:** see four copies of one enum and reach for codegen · add a
> generate step to a build · wonder why `packages/schema` generates its enums but
> the engine doesn't · wonder why an app's `dev` script starts with a generate ·
> propose defining the schema in Zod and emitting JSON Schema · add a fifth copy ·
> write "run `npm run generate` after editing the schema" in a doc.

- **Status:** Accepted
- **Decided:** 2026-08-04
- **Last updated:** 2026-08-05 (#PR)
- **Deciders:** Dallan Quass
- **Supersedes:** —
- **Superseded by:** —
- **Applies to:** `docs/specs/schemas`, `packages/schema/scripts/gen-enums.mjs`, `packages/engine/mcp-server/tests/packaging/enum-drift.test.ts`, `packages/engine/mcp-server/tests/packaging/tool-schema-enums.test.ts`, `packages/engine/mcp-server/tests/packaging/research-append-examples.test.ts`, `packages/engine/mcp-server/tests/validation/tree-shape-drift.test.ts`, `packages/viewer-ui/src/__tests__/schema-interface-drift.test.ts`, `packages/viewer-ui/src/__tests__/dev-scripts-generate.test.ts`, `eval/harness/tests/unit/test_schema_mirrors.py`
- **Related:** issues #1087, #1015, #1014, #1165, #1166, #1268, #1270; `docs/architecture.md` §6

## Context

`enums.schema.json` and `research.schema.json` are copied by hand into four-plus
places: the `packages/schema/schemas/` mirror, `CLOSED_ENUMS`/`VALIDATOR_ENUMS` in
`validator.ts`, the TS unions and interfaces in `packages/schema/src/index.ts`,
the field allow-lists in `tree-shape.ts`, prose tables in specs and skill bodies,
and, until this ADR landed, five literal enum arrays inside MCP tool input
schemas.

**Nothing can import its way out of this.** Four dependency islands: the pnpm
workspace (`packages/schema`, `packages/viewer-ui`, `apps/web`, `apps/electron`);
the engine, excluded by the `!packages/engine/**` negation in
`pnpm-workspace.yaml` so the `.mcpb` pipeline stays npm-managed; `eval/app`, with
its own `package-lock.json` and not a workspace member; and Python
(`eval/harness`, `apps/server`). No TS import crosses a boundary.

The copies are not equivalent, so one blanket answer is wrong for some of them:

- Some can simply be **deleted** — a consumer in the same island can import the
  value. Five of the seven hand-typed enum arrays in `src/tools/` were this.
- Some sit where regeneration is **already automatic**. `turbo.json` declares
  `typecheck` and `test` as `dependsOn: ["^build"]`, so every consumer of
  `@genealogy/schema` runs its `build` first. A generator wired into that build
  cannot be skipped.
- Some are **prose wrapped around values**, not data. `validator.ts` hand-writes
  LLM-actionable error text per enum; that is the reason it exists and it is not
  generatable output. Same for the `∈` value lists inline in `SKILL.md` bodies,
  which are prompt-token-budgeted and hand-phrased.

One claim worth killing before someone re-derives it: **`--ignore-scripts` does
not block codegen in the engine.** `scripts/build-mcpb.mjs:26-27` and
`apps/server/sandbox/build-image.sh:41` both run `npm install && npm run build`
in the engine with lifecycle scripts *enabled*, before the `--ignore-scripts`
install into an already-compiled staging tree. A `prebuild` hook would work. The
engine does not generate for the reasons above, not because it can't.

## Decision

**Every copy is assigned one of three tiers, and manual regeneration is never
one of them.**

1. **Eliminate** — if a consumer in the same island can import the value, delete
   the copy and import it.
2. **Generate** — where regeneration is automatic: no human types a command, and
   no entry point can forget it. Today this is the pnpm island only:
   `packages/schema/scripts/gen-enums.mjs` emits `src/enums.generated.ts` from
   the local `schemas/enums.schema.json` mirror, chained into `build`,
   `typecheck`, and each app's `dev`, output gitignored.
3. **Lint** — everything else. A test reads the master and diffs the copy.

A generate step that a human must remember to run is worse than a lint, because
a lint fails loudly and a forgotten regenerate ships silently.

**"No entry point can forget it" has to be enumerated, because two mechanisms
cover most of them and neither covers all.** turbo's `dependsOn: ["^build"]`
carries `build`, `typecheck`, and `test` for every consumer of
`@genealogy/schema`; `packages/schema`'s `postinstall` carries a fresh
`pnpm install`. The dev servers reach neither — `pnpm --filter <app> dev` is
not turbo, and an install only reruns when a manifest changes. The gap was live
from the moment tier 2 shipped: a checkout that pulled #1271 without
reinstalling had no
generated file and no path that would write one, so the Research Viewer opened
on vite's `Failed to resolve import "./enums.generated.js"`. Each app's `dev`
now chains the generator, which heals `make electron`, `eval\Viewer.bat`, and
the raw `pnpm --filter @genealogy/electron dev` the alpha guide gives
macOS/Linux users, all from the one script they share.

Two mechanical constraints shape tier 2 and will bite anyone who ignores them:
turbo `inputs` are package-relative, so the generator reads
`packages/schema/schemas/` (proven byte-identical by `test_schema_mirrors.py`)
rather than reaching up to `docs/specs/schemas/`, or turbo's hash goes blind to
schema edits and serves a stale file from cache. And pnpm 9's
`enable-pre-post-scripts` defaults to **false**, so the generator is chained with
explicit `&&` — a `prebuild` hook would silently never fire.

## Alternatives considered

| Option | Why rejected | Evidence |
|---|---|---|
| Generate every copy, engine included | The engine's copies are either eliminable (tool schemas — import the const) or are LLM-actionable error prose wrapped around the values, which is not generatable output. It would also add a pre-step to two independent build entry points that must each keep it | `validator.ts` bespoke error strings; `scripts/build-mcpb.mjs:26-27`, `apps/server/sandbox/build-image.sh:41` — feasible, so this is a cost/benefit rejection, not a mechanical one |
| Generate with a **committed** artifact plus a regenerate-and-diff CI check | That check is a lint with a writer bolted on, and it adds a stale-commit failure mode that gitignored output does not have | argued, not measured |
| Generate with a **manual** regenerate command | A step a human must remember is exactly the risk this ADR exists to avoid. The repo's one instance already documents the workaround its own users need when the hook is skipped | `eval/app/scripts/gen-zod.ts` header; `eval/app/package.json:15-16` |
| Invert the master: define in Zod/TypeBox, emit JSON Schema | The JSON Schema files are reviewed spec artifacts carrying prose `description`s and `examples`-based **open** enums (`*_recommended`); zod-emitted schema is not reviewable as a spec and loses that structure. Two of four islands (Python, the engine) consume the JSON directly | `enums.schema.json` — 10 of 35 `$defs` are open `*_recommended`/`iso_*`; `eval/harness/harness/schema_validator.py` |
| Runtime schema loading; derive the value sets at startup and drop the TS copies | Runtime data cannot produce compile-time types, so the unions stay generated or hand-written either way. It reaches only the `Set`-shaped copies, which are already the best-guarded | `validator.ts`; argued, not measured |
| One shared TS module every consumer imports | No import crosses the island boundaries: the engine is out of the pnpm workspace for `.mcpb` reasons, `eval/app` has its own lockfile, and two consumers are Python | `pnpm-workspace.yaml`, `eval/app/package-lock.json` |
| Leave the copies unguarded and rely on the multi-site edit lists in `CLAUDE.md` | Measured failure: `packages/schema/src/index.ts` had two interface fields silently drifted, and five closed enums had no TS union at all | #1165; `date_certainty` typed `string` at `packages/schema/src/index.ts:269`; missing — `date_certainty_timeline`, `severity`, `external_site`, `gender`, `relationship_type` |
| `--ignore-scripts` on the shipping builds makes engine codegen impossible | **Factually wrong**, recorded so it is not re-derived: those installs run against an already-compiled tree; the engine's own `npm run build` runs earlier with scripts enabled | `scripts/build-mcpb.mjs:26-27`, `apps/server/sandbox/build-image.sh:41` |

## Consequences

**Gains.** The copy that had measurably drifted stops existing. Nothing in the
sync path asks a human to run a command. The engine keeps its hand-written
validator and its LLM-actionable error text, and gains no build step. Adding a
guard elsewhere costs a test file, not a pipeline change.

**Costs, knowingly accepted.** Field-name checking is not type checking — the
interface lint reads names out of the source with a regex, so a field typed
`string` where a union exists still passes. Two mechanisms instead of one: a contributor
editing a closed enum regenerates automatically on the pnpm side but still
hand-edits `validator.ts` and the prose tables, so the three-case edit table in
`CLAUDE.md` stays. The pnpm side now has a build-order dependency that did not
exist before — `packages/schema`'s `typecheck` runs its own generator, a future
task added there must keep the `&&` chain, and a new app, or a new script that
starts vite outside turbo, has to chain it too. `eval/app` is not a pnpm
member, so its forked unions are reached by neither tier and stay hand-written
until that fork is resolved.

**Risks.** A lint that passes on arrival reads as coverage; each new one must be
broken by hand before commit and its failure message recorded (this repo produced
three false-green lints in a single session — a grep excluding its own tree, a
`git grep` skipping untracked files, a field-name collision). Per-copy parsers
accumulate: each copy *shape* — `Set` literal, `.tsx` map, markdown table —
needs its own extractor. And the tier-2/tier-3 boundary is a judgement call that
will be re-argued; the test is "can a human forget it," not "is it convenient."

## Enforcement

> `eval/harness/tests/unit/test_schema_mirrors.py` — the two schema trees are
> byte-identical. This is also what licenses the generator to read the local
> mirror, which is why `.github/workflows/eval-harness-tests.yml` matches
> **both** `docs/specs/schemas/` and `packages/schema/schemas/`: a PR editing
> only the mirror must still run this.
> `packages/engine/mcp-server/tests/packaging/enum-drift.test.ts` —
> `VALIDATOR_ENUMS` and the prose `∈` tables against `enums.schema.json`.
> `packages/engine/mcp-server/tests/packaging/tool-schema-enums.test.ts` — no
> hand-typed closed-enum array in an MCP tool input schema. Matches a **stale**
> copy as well as an exact one; exact equality alone goes blind at the moment a
> copy drifts, which is the moment that matters.
> `packages/engine/mcp-server/tests/validation/tree-shape-drift.test.ts` and
> `validator.test.ts`'s `RESEARCH_SHAPES` guard — field allow-lists against the
> schemas' `additionalProperties: false` subschemas.
> `packages/viewer-ui/src/__tests__/schema-interface-drift.test.ts` — the
> hand-written interfaces in `packages/schema/src/index.ts` against
> **both** `research.schema.json` and `tree-gedcomx.schema.json`. Field
> **names** only.
> `packages/engine/mcp-server/tests/packaging/research-append-examples.test.ts` —
> the worked payloads the model is shown on a rejection: field names against
> the `$def`, enum **values** against the enum each field is bound to, and one
> example per writable section.
> `apps/server/tests/test_mock_agent_schema.py` — the mock agent's emitted
> `research.json` (both states) and `tree.gedcomx.json`.
> `packages/viewer-ui/src/__tests__/gen-enums-guards.test.ts` — the generator's
> own two refusals.
> `packages/viewer-ui/src/__tests__/dev-scripts-generate.test.ts` — every app's
> `dev` script chains the generator before starting vite, and `generate` runs
> every generator in `packages/schema/scripts/`, so a second one cannot be added
> to a path the dev servers don't take.

Tier 2 needs no test for *drift* — a generated file cannot drift from its
input. It does need two for things that are not drift. Its **guards**: both
refusals in `gen-enums.mjs` exist because the failure they prevent is silent
(`export *` shadows a name with no tsc error), so nothing else would report a
guard that had stopped working — `gen-enums-guards.test.ts`. And its **entry
points**: the tier's whole claim is that none can forget, which is a property of
the callers, not of the generator, and is what broke — `dev-scripts-generate.test.ts`.

What this does **not** catch: interface **types** — optionality, `| null`, and
`date_certainty: string` in `packages/schema/src/index.ts` — which need the
TypeScript compiler API (#1165); the enum tables in
`docs/specs/research-schema-spec.md`, whose markdown-table format needs its own
parser; the sixth inline enum `locality.pages_read[].section`, re-typed in
`packages/engine/mcp-server/src/tools/wiki-place-page.ts` and bound to no
validator entry to collapse into (#1270); and the `eval/app` fork.

*Linted: every path in this section must resolve.*

## Revisit when

- **`eval/app` joins the pnpm workspace**, or its fork of `packages/viewer-ui` is
  resolved — its hand-written unions then fall inside tier 2 for free.
- **`packages/schema`'s interfaces start drifting faster than #1165's lint
  catches**, which would make generating them — and moving their doc comments
  into `research.schema.json`, where Python and the fixtures would also see them
  — the better trade.
- **The engine acquires a generate step for some other reason.** The marginal
  cost of moving `CLOSED_ENUMS` to tier 2 drops to near zero, and only the
  error-prose argument would still stand.
