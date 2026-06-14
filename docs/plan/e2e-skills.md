# E2E benchmark skills — implementation plan

> Plan for fleshing out the two e2e-benchmark skills, `author-e2e-fixture`
> and `interpret-e2e-result`, and treating them as a distinct class from the
> Cowork research skills. Companion docs: the usage playbook
> [`docs/e2e-testing-guide.md`](../e2e-testing-guide.md) and the test-format
> spec [`docs/specs/e2e-test-spec.md`](specs/e2e-test-spec.md).

## What these skills are

The e2e benchmark snapshots a real, well-researched FamilySearch person's
tree, strips a focused subset (the "answer"), and asks the agent — via
`/research --autonomous` — to recover what was removed; a judge compares the
agent's final `tree.gedcomx.json` against the committed `expected-findings.json`.
Two skills wrap the human ends of that loop:

- **`author-e2e-fixture`** — produces the five files a fixture needs
  (`fixture.json`, `starting-research.json`, `starting-tree.gedcomx.json`,
  `expected-findings.json`, `README.md`) into a `<slug>/` subfolder, ready to be
  moved into `eval/tests/e2e/<slug>/`. Preferred path: convert a just-finished
  project into a fixture by stripping the answer and recording it as expected
  findings. Calls `validate_research_schema`.
- **`interpret-e2e-result`** — reads an e2e run log (`run-<ts>.json` +
  transcript + final tree/research) plus the fixture's `expected-findings.json`
  and explains the verdict, stop reason, expected-vs-found, the single most
  likely failure cause, and the cheapest next action. Read-only, no MCP tools.

## Why they are a different class from the research skills

| Dimension | Research skills (the other 26) | E2E benchmark skills |
|---|---|---|
| **Audience** | Cowork end users (genealogists doing research) | Internal genealogist+developer **benchmark teams** only |
| **Operates on** | The user's `research.json` / `tree.gedcomx.json` | The eval **test corpus** (`eval/tests/e2e/`, `eval/runlogs/e2e/`) |
| **Ships in the Cowork plugin?** | Yes | **No** — excluded from `releases/genealogy-plugin.zip` |
| **Eval shape** | Unit tests vs. MCP fixtures + neighbor negatives | Synthetic run-log / finished-project artifacts; no MCP-fixture corpus |
| **Deep-dive brief?** | Yes (`eval/briefs/<skill>.md`) | **No** — the brief format doesn't fit; this plan replaces it |

The packaging exclusion is enforced in `scripts/package-plugin.sh` (the two skill
directories are passed as `zip -x` patterns). A normal-skill build still ships;
these two do not.

## Treat the same

- They remain real SKILL.md files under `packages/engine/plugin/skills/` and
  follow skill-authoring conventions (frontmatter, narration line, "Do NOT use"
  routing). Keeping them co-located avoids a parallel skill loader.
- They *can* be exercised by the eval harness for routing + output quality, like
  any skill — the harness loads `setting_sources=["project"]` and doesn't care
  whether a skill ships in the plugin.

## Treat differently

1. **Don't ship them in the Cowork plugin.** Done — see the `zip -x` exclusion in
   `scripts/package-plugin.sh`. Any future skill-packaging change must preserve it.
2. **No deep-dive brief.** They are intentionally absent from `eval/briefs/`; the
   README there carries a pointer to this plan instead.
3. **Their "fixtures" are not `eval/fixtures/mcp/` mocks.** `author-e2e-fixture`
   needs a *finished-project* input state; `interpret-e2e-result` needs a
   *synthetic run-log* input. Both are heavier to stand up than a normal skill's
   mock responses, and neither uses the MCP-fixture machinery.

## Current state (greenfield)

- Both skills have complete SKILL.md bodies and are wired into the plugin's skill
  set, but have **no eval coverage**: no `eval/tests/unit/author-e2e-fixture/` or
  `eval/tests/unit/interpret-e2e-result/` directory, and no `rubric.md`.
- The e2e corpus itself is empty: `eval/tests/e2e/` and `eval/runlogs/e2e/`
  contain only `.gitkeep`. There is no example fixture to diff against and no real
  run log to interpret.

## Work to flesh them out

### `author-e2e-fixture`

- **Stand up `eval/tests/unit/author-e2e-fixture/` + `rubric.md`.** First rubric
  dimensions: all five files produced and parse; **stripping completeness** (each
  expected finding is genuinely absent from `starting-tree.gedcomx.json` after the
  strip — the crux); deceased-subject precondition enforced (FS ToS); question is
  natural-language (no ARK/record-locator literals); slug/`fixture.json::id`/
  subdirectory consistency.
- **Tests:** a convert-path test (a finished Flynn-style project → five files;
  assert the answer is stripped and recorded); a scratch-path test (no
  `research.json` → skill asks for PID/question/findings and builds from
  templates); a living-subject refusal; a >5-findings "ask which subset" test.
  The convert-path test needs a finished-project scenario with `proof_summaries`
  and an answer-bearing tree.
- **Produce the first real e2e fixture** under `eval/tests/e2e/<slug>/` — this
  doubles as the example `interpret-e2e-result` can be tested against.

### `interpret-e2e-result`

- **Stand up `eval/tests/unit/interpret-e2e-result/` + `rubric.md`.** First rubric
  dimensions: verdict correctly read; stop_reason correctly translated;
  missed-findings correctly identified; cause plausibly attributed (not
  over-claimed when evidence is thin); next-action is the cheapest decisive one.
- **Fabricate synthetic run-log artifacts** as inputs — one per case shape: a
  clean pass; a partial with one missed finding; a `tool_cap` loop; a
  skipped/crashed run; an FS-data-drift case (same tool calls, different results).
  No real e2e run exists yet, so authoring these JSON inputs is the dominant cost
  and gates every test. Establish a minimal `run-<ts>.json` shape from
  `docs/specs/e2e-test-spec.md` / the harness's result writer.

## Definition of done

- The packaging exclusion is in place and covered by a note here. *(Done.)*
- A `docs/plan/e2e-skills.md` plan exists and the briefs README points at it.
  *(Done.)*
- Each skill has a `eval/tests/unit/<skill>/` directory with a `rubric.md` and an
  initial test set per the lists above.
- At least one real e2e fixture exists under `eval/tests/e2e/<slug>/`, authored by
  `author-e2e-fixture`, that `interpret-e2e-result`'s tests can reference.

## Open questions

- **Can the harness exercise a fixture-authoring skill end-to-end**, or do these
  tests assert intermediate file production only? `author-e2e-fixture` writes
  files and reads a finished project; the unit harness may need a finished-project
  scenario fixture to feed it.
- **What is the canonical `run-<ts>.json` shape** the synthetic inputs must match?
  Pin it to the harness's e2e result writer (`eval/harness/e2e/`) so the
  interpreter tests don't drift from real output.
- **Should these skills move to a dedicated `skills/` subtree** (e.g. a `dev/`
  marker) so the packaging exclusion is structural rather than a hard-coded pair
  of `-x` patterns? Revisit if a third team-only skill appears.
