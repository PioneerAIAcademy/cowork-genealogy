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
| **Lives in** | `packages/engine/plugin/skills/` | `.claude/skills/` (repo-local dev tooling) |
| **Ships in the Cowork plugin?** | Yes | **No** — not under `plugin/skills/`, so never packaged |
| **Eval shape** | Unit tests vs. MCP fixtures + neighbor negatives | Synthetic run-log / finished-project artifacts; no MCP-fixture corpus |
| **Deep-dive brief?** | Yes (`eval/briefs/<skill>.md`) | **No** — the brief format doesn't fit; this plan replaces it |

These two skills live in **`.claude/skills/`**, alongside the other repo-local dev
skills `compare-state` and `draft-unit-test`. Because the plugin packager
(`scripts/package-plugin.sh`) only zips `packages/engine/plugin/skills/`, and the
e2e harness (`eval/harness/e2e/orchestrator.py`, `DEFAULT_PLUGIN_SKILLS`) only
copies that same directory into the agent-under-test workspace, this location
keeps them out of **both** the shipped plugin and the `/research` benchmark run —
structurally, with no exclusion list to maintain. Claude Code still loads
`.claude/skills/` in this checkout, so the benchmark teams invoke them normally.

## Treat the same

- They remain real SKILL.md files following skill-authoring conventions
  (frontmatter, narration line, "Do NOT use" routing) — just under `.claude/skills/`
  rather than the plugin tree.
- They *can* be exercised by the eval harness for routing + output quality, like
  any skill — the harness loads `setting_sources=["project"]` and doesn't care
  whether a skill ships in the plugin (point the harness's `skills_dir` at
  `.claude/skills/` if a unit suite is stood up for them).

## Treat differently

1. **Don't ship them in the Cowork plugin.** Done — they live in `.claude/skills/`,
   outside the `packages/engine/plugin/skills/` tree the packager zips, so the
   exclusion is structural. No `zip -x` list to keep in sync.
2. **No deep-dive brief.** They are intentionally absent from `eval/briefs/`; the
   README there carries a pointer to this plan instead.
3. **Their "fixtures" are not `eval/fixtures/mcp/` mocks.** `author-e2e-fixture`
   needs a *finished-project* input state; `interpret-e2e-result` needs a
   *synthetic run-log* input. Both are heavier to stand up than a normal skill's
   mock responses, and neither uses the MCP-fixture machinery.

## Three cadences (and where the judge sits)

E2e is one of three independent testing cadences. Keeping them separate is the
single most important framing in this plan — most of the earlier confusion came
from collapsing them.

| Cadence | What runs | Cost | Trigger |
|---|---|---|---|
| **Unit evals** | Skills vs **mocked** MCP (`eval/tests/unit/`) | cheap | per-PR |
| **Judge calibration** | The judge vs a **frozen, hand-graded** set of `(finding, tree, human_verdict)` pairs | cheap (one LLM call per pair) | only when the judge prompt or model changes |
| **E2e snapshots** | `/research --autonomous` vs **live** FamilySearch + the judge | expensive ($3–10, 20–60 min/run) | periodic / on-demand |

The judge appears in **two** of these: it is *graded by* calibration and *used in*
e2e. That is why its accuracy must be established in the cheap calibration loop —
never inferred from the expensive e2e runs. We do **not** re-run e2e tests when a
prompt changes; that is what unit evals are for. E2e runs are periodic capability
snapshots only.

## Current state

- **The harness is built and unit-tested.** `eval/harness/e2e/` contains
  `orchestrator.py`, `judge.py` (+ `judge_prompt.md`), `stop_checker.py`,
  `result.py`, `report.py`, and `run_e2e.py`, with coverage under
  `eval/harness/tests/unit/test_e2e_*.py`. The canonical `run-<ts>.json` shape is
  the `E2eResult` dataclass in `result.py` — **read it; do not re-derive it from
  the spec.** Each `tool_calls[]` entry is `{ tool, args, response_summary }`.
- Both skills have complete SKILL.md bodies and live in `.claude/skills/`, but
  have **no eval coverage**: no `eval/tests/unit/author-e2e-fixture/` or
  `eval/tests/unit/interpret-e2e-result/` directory, and no `rubric.md`.
- The e2e corpus is empty: `eval/tests/e2e/` and `eval/runlogs/e2e/` contain only
  `.gitkeep`. There is no fixture to diff against and **no real run log to
  interpret** — which is the dependency the work below has to break first.

## Cross-cutting harness fixes (do these first — they are bugs)

These predate the skill work and gate the trustworthiness of every verdict:

- **Force structured judge output.** `judge.py::_extract_json` currently
  best-effort regex-scrapes JSON from the model's prose and silently brace-scans
  on failure — it can return a malformed verdict that still parses. Replace it with
  a forced response schema (tool-use / structured output), **validate the parsed
  object against the expected keys, and fail loud** (surface a harness error /
  non-grading verdict) on violation. The whole point of forcing structure is lost
  if a silent fallback remains.
- **Default the judge model to Opus.** Semantic equivalence of persons / dates /
  places is the core judgment and a smaller judge is weakest exactly there. The
  judge runs once per fixture and e2e is periodic, so judge cost is negligible by
  construction. Change the **default** in `judge.py`; keep it overridable via
  `fixture.json::model.judge` (the field already exists) so a future sweep can drop
  to a cheaper model without a code change. Do not hardcode the model.
- **Fix the missing `cost_cap` branch.** `orchestrator.py` sets
  `aborted_reason = "cost_cap"` when cost exceeds the cap, but
  `stop_checker.py::derive_stop_reason` has no branch for it — a cost-capped run
  can mislabel as `natural_end`/`completed`. Add the branch and a unit test.
- **Grade the tree, by design.** The judge reads `final-tree.gedcomx.json` only.
  Make "the answer must land in the tree" an **explicit, documented success
  criterion** of the GPS flow (the tree is the deliverable). With that decided,
  `interpret-e2e-result`'s "recorded elsewhere" case is a documented *agent*
  failure, not a judge blind spot — say so in the judge prompt and the spec.

## Judge calibration set (standalone artifact)

A committed, offline dataset that establishes judge-vs-human agreement,
**decoupled from the e2e pipeline** (no agent, no live FS):

- **Runner: done** — `eval/harness/e2e/calibrate_judge.py` (tested in
  `tests/unit/test_e2e_calibrate_judge.py`). Calls **only the judge** against a
  frozen set, reports per-finding + per-run agreement, lists every disagreement,
  and gates on the ≥80% per-finding target. `--dry-run` lints the set without API
  calls. Run `uv run python -m e2e.calibrate_judge`.
- **Set: pending the first real run** — `eval/tests/e2e/calibration/cases.json`,
  ~15–20 hand-graded cases covering the hard ones (especially `partial`-boundary
  and per-finding `matched` calls), not just obvious passes. Each case pins a real
  `(research_question, expected_findings, final_tree)` plus the human's per-run
  `verdict` and per-finding `matched` labels. Shape documented in the
  `calibrate_judge.py` module docstring. Seed the trees from the first real e2e run
  (below) plus hand-authored edge cases, so they're real simplified-GedcomX, not
  invented shapes.
- **Target: ≥80% agreement, measured per-finding** (not per-run verdict — the
  per-run label is dominated by easy passes and inflates the number). 80% ≈ human
  inter-rater agreement. Inspect every disagreement.

## Work to flesh them out

### `author-e2e-fixture`

- **Stripping-completeness validator (the one non-negotiable gate).** *(Done —
  `eval/harness/e2e/validate_fixture.py`, tested in
  `tests/unit/test_e2e_validate_fixture.py`.)* A standalone fixture linter — **not**
  under `eval/harness/validators/` (those are unit-skill validators wired to
  `validator_runner.py`; this lints a fixture's static files with no skill run). For
  each entry in `expected-findings.json` it checks whether the named target person /
  fact is still **present** in `starting-tree.gedcomx.json` via name-token overlap
  (requires both a given- and surname-token match; subject persons that legitimately
  remain are excluded by reading target names from `details`, not the description
  prose). **Warn, don't block:** it surfaces suspects for the author to review (exit
  0) and hard-fails (exit 2) only on structurally broken fixture files. Run
  `uv run python -m e2e.validate_fixture <slug>` or `--all`.
- **Stand up `eval/tests/unit/author-e2e-fixture/` + `rubric.md`** (thin — see
  scope note below). Dimensions: all five files produced and parse; deceased-subject
  precondition enforced (FS ToS); question is natural-language (no ARK/record-locator
  literals); slug / `fixture.json::id` / subdirectory consistency. Stripping
  completeness is covered by the validator above, not a rubric dimension.
- **Tests:** a convert-path test (a finished Flynn-style project → five files;
  assert the answer is stripped and recorded); a scratch-path test (no
  `research.json` → skill asks for PID/question/findings and builds from
  templates); a living-subject refusal; a >5-findings "ask which subset" test.
  The convert-path test needs a finished-project scenario with `proof_summaries`
  and an answer-bearing tree.
- **Produce the first real e2e fixture** under `eval/tests/e2e/<slug>/` — it
  doubles as the source of real artifacts for the interpreter's tests and the
  calibration set.

### Break the circular dependency: run the first fixture for real

The interpreter's tests need run logs; real run logs need a fixture + a live
`/research` run. Break it once, deliberately:

1. Author the first fixture (above).
2. Run `uv run python -m e2e.run_e2e --test <slug>` **once for real** and commit
   the resulting run log. This also validates the harness end-to-end as a side
   effect, and seeds the calibration set with real trees.
3. **Hand-edit 3–4 copies** of that one real run log to produce the other case
   shapes the interpreter must handle (partial / `tool_cap` loop / crashed-or-
   skipped / FS-data-drift). Because they are edits of real harness output, they
   cannot drift from the `E2eResult` schema.

> **Non-goal — do not build a synthetic run-log generator.** Three or four
> hand-edited copies of one real run log is the entire deliverable. A generator is
> over-engineering for two rarely-run dev skills and reintroduces exactly the
> schema-drift these fixes eliminate.

### `interpret-e2e-result`

- **Stand up `eval/tests/unit/interpret-e2e-result/` + `rubric.md`.** Dimensions:
  verdict correctly read; stop_reason correctly translated; missed-findings
  correctly identified; cause plausibly attributed (not over-claimed when evidence
  is thin); next-action is the cheapest decisive one.
- **Inputs are the hand-edited real run logs from the step above**, each authored
  **cause-first**: pin the ground-truth diagnosis per case (e.g. "this is a
  `tool_cap` loop → correct cause is X") and grade whether the skill reaches it.
  Without a pinned ground truth, the "cause plausibly attributed" dimension can't
  discriminate good interpretations from confident-but-wrong ones.

## Definition of done

- The skills live in `.claude/skills/`, structurally outside the shipped plugin
  and the `/research` benchmark workspace. *(Done.)*
- A `docs/plan/e2e-skills.md` plan exists and the briefs README, the main README,
  and the e2e testing guide all point at the new location. *(Done.)*
- **Harness fixes landed:** structured-output judge with fail-loud validation;
  judge default = Opus, overridable per fixture; `cost_cap` branch in
  `derive_stop_reason` with a test; tree-is-the-deliverable documented in the
  judge prompt and spec.
- **Judge calibration runner exists** (`eval/harness/e2e/calibrate_judge.py`,
  reports ≥80% per-finding agreement). *(Done.)* The committed set
  (`eval/tests/e2e/calibration/cases.json`) is seeded from the first real run.
- A **stripping-completeness validator** exists (`eval/harness/e2e/validate_fixture.py`)
  and is run against every fixture. *(Done.)*
- At least one **real e2e fixture and one committed real run log** exist, authored
  by `author-e2e-fixture` and produced by one live run — the source for the
  interpreter's hand-edited test inputs.
- Each skill has a `eval/tests/unit/<skill>/` directory with a `rubric.md` and an
  initial test set per the lists above.

## Scope discipline

These are two rarely-run **internal dev skills**, not shipped product. Match the
investment: the mechanical stripping validator and the harness bug-fixes earn
their keep (they prevent silently-broken benchmarks and mislabeled verdicts); a
heavy LLM rubric with released run logs and `.ann` annotations for the two skills
themselves likely does not. Ship the validator + thin smoke tests and stop there
unless the skills prove flaky in use.

## Resolved (formerly open)

- *Canonical `run-<ts>.json` shape* — the `E2eResult` dataclass in
  `eval/harness/e2e/result.py`. The harness is built; read the dataclass rather
  than re-deriving a shape from the spec.
- *Can the unit harness exercise these skills* — yes, like any skill
  (`setting_sources=["project"]`); point `skills_dir` at `.claude/skills/`. The
  convert-path test needs a finished-project scenario fixture (`research.json` with
  `proof_summaries` + an answer-bearing tree) to feed `author-e2e-fixture`.
- *Where these skills live* — `.claude/skills/`, the established home for
  repo-local dev skills (`compare-state`, `draft-unit-test`) — outside both the
  plugin packager's and the e2e harness's `plugin/skills/` scope.
