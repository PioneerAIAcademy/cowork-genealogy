# Deep-Dive Brief — `interpret-e2e-result`

> Per-skill map for the deep-dive. Generic process: [`eval/JUNIOR-WALKTHROUGH.md`](../JUNIOR-WALKTHROUGH.md).

**Effort profile:** Greenfield — no tests, no rubric exist yet; the day's job is to stand up the first `eval/tests/unit/interpret-e2e-result/` directory + rubric + initial tests from scratch. This is pure **interpretation** of run-log artifacts, so each test needs a synthetic run-log + expected-findings pair as input. The dominant cost is **fabricating representative run-log artifacts** — no real e2e run exists (`eval/runlogs/e2e/` is `.gitkeep`-only and there's no run-log schema fixture to copy), so the synthetic JSON must come first. Genealogical judgment is moderate (reading expected-vs-found); the bulk of the effort is artifact authoring.
**Files:** SKILL.md (180 lines) · references ×0 · templates ×0 · tests ×0 (NONE) · rubric ✗ (missing — no test dir).

## What this skill does
Reads an e2e benchmark run log (`run-<ts>.json` + `.transcript.md` + `.final-tree.gedcomx.json` + `.final-research.json` under `eval/runlogs/e2e/<id>/`) plus the fixture's `expected-findings.json`, then explains in plain language: the **verdict** (`pass`/`partial`/`fail`/`skipped`), the **stop_reason** (`completed`/`natural_end`/`inactivity`/`timeout`/`tool_cap`/`cost_cap`/`max_turns`/`error`), an **expected-vs-found** comparison (matched / missed / recorded-elsewhere), the single **most likely failure cause** (agent reasoning regression / `/research` routing regression / sub-skill regression / FamilySearch data drift / single-run jitter), and the **cheapest decisive next action**. It is **read-only** — `allowed-tools` is empty; it calls **no MCP tools**, writes nothing, edits no fixtures or skills. Key invariant: a passing run gets a one-line summary; it does not over-claim a cause when evidence is thin (it says so instead).

## Where everything lives
- `plugin/skills/interpret-e2e-result/SKILL.md`
- references: none · templates: none
- `eval/tests/unit/interpret-e2e-result/` — **does not exist yet**; the deep-dive creates it (test JSONs + `rubric.md` + the crafted run-log artifacts each test points at).
- Scenarios: this skill's "fixtures" are **crafted run-log JSON files** placed under a scenario, NOT `eval/fixtures/mcp/` entries — a different animal from the search/extraction skills.

## Current tests (0) — greenfield
> ⚠️ This skill is **unevaluated**: zero tests, no `rubric.md`, and no `eval/tests/unit/interpret-e2e-result/` directory at all. Worse, `eval/runlogs/e2e/` is empty (`.gitkeep` only) and there's **no run-log schema fixture to copy** — so authoring the synthetic `run-<ts>.json` + matching `expected-findings.json` artifacts is the dominant cost and must come first, before any test JSON can reference them.

## Tests to author (none exist yet)
**Positive (one test per case-shape; each needs a crafted `run-<ts>.json` + minimal transcript + matching `expected-findings.json`):**
- **Clean pass** — `verdict: pass` → skill gives a one-line summary, no over-analysis.
- **Partial with one missed finding** — skill correctly *names the specific missed finding*.
- **Fail + `tool_cap`** — skill diagnoses a loop (e.g. near-duplicate `place_search` queries) from the last tool calls.
- **Skipped / crashed** — skill reads the crash from the transcript (judge didn't run, no judge output).
- **FamilySearch data drift** — same tool calls, different results → skill attributes to **data drift, not the agent**.

**Negative (boundaries from the description):**
- → `author-e2e-fixture`: "Save this run / fix this fixture's findings." — author/modify a fixture, not interpret.
- → developer-facing unit-test scratch runs: "Read this unit-test run log." — read the JSON directly, not this skill.
- → `timeline` / `conflict-resolution` (live-project analysis): "Grade this research question in my project." — use the analysis skills, not e2e interpretation.

## ⚠️ Known issues
- **No artifacts to point at.** There is no example e2e run and no run-log schema fixture; the synthetic `run-<ts>.json` must be hand-built to match `docs/specs/schemas/run-log.schema.json` (v2) shape — get this right first or every test is built on sand.
- **Cause-attribution is judgment-graded, not deterministic** — the rubric must reward *plausible, hedged* attribution and penalize over-claiming when the crafted evidence is intentionally thin (the jitter and drift cases are designed to be ambiguous).
- **"Fixtures" here are run-log JSON, not MCP mocks** — be explicit in the test corpus so a future maintainer doesn't look for `eval/fixtures/mcp/` entries that will never exist (the skill calls no MCP tools).

## Fixture work
No MCP fixtures — the skill calls no tools, so `eval/fixtures/mcp/` is irrelevant. The fixture work is **entirely net-new crafted run-log artifacts**: one `run-<ts>.json` (with `verdict`, `stop_reason`, `judge_output`, `usage`, `tool_calls[]`) + a minimal `.transcript.md` + a matching `expected-findings.json` per case-shape above, placed under the test's scenario. These double as the first concrete examples of the (currently empty) e2e run-log format and should be authored to the v2 run-log schema.

## Definition of done
Hand-build the five synthetic run-log + expected-findings artifact sets (pass / partial / tool_cap loop / skipped-crash / FS-drift) to the v2 run-log schema → stand up `eval/tests/unit/interpret-e2e-result/` with a first `rubric.md` grading **verdict read correctly, stop_reason translated correctly, missed-findings identified, cause plausibly (not over-) attributed, next-action is the cheapest decisive one** → add one positive test per case-shape + the three neighbor negatives → first full harness pass + CRUD grade-correction + PR.
