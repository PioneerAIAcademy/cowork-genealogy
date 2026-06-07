# Eval Setup Guide for Genealogists

**Audience:** Junior genealogists (non-technical Windows users) who create, run, and grade skill/MCP eval tests.

**Minimum requirement:** 8 GB RAM. Machines with 4 GB will struggle running the Next.js app and browser simultaneously.

---

## What You Install

Three programs, all standard GUI installers:

1. **GitHub Desktop** — [desktop.github.com](https://desktop.github.com). Handles all git operations (clone, branch, commit, push, pull) through a visual interface. No terminal needed.
2. **Node.js LTS** — [nodejs.org](https://nodejs.org). Download the `.msi` installer and accept all defaults. This runs the test-creation app.
3. **Python 3.12+** — [python.org/downloads](https://www.python.org/downloads/). Download the Windows installer. **Check "Add Python to PATH"** during installation.

After installing these three, clone the repository using GitHub Desktop and run `Setup.bat` once (see below).

---

## Daily Workflow

```
GitHub Desktop              Browser (localhost:3000)        RunTests.bat
     |                              |                            |
  pull latest                  Start.bat                         |
     |                   opens test-creation app                 |
     |                              |                            |
     |                    create/edit tests                      |
     |                    (writes JSON to disk)                  |
     |                              |                            |
     |                                          double-click ----+
     |                                          harness runs tests,
     |                                          writes run log to disk,
     |                                          shows live progress
     |                              |                            |
     |                    Results section auto-refreshes         |
     |                    when you switch back to the browser    |
     |                              |                            |
     |                    annotate run log (correct LLM grades)  |
     |                    side-by-side comparison vs main        |
     |                              |                            |
  commit + push                                                  |
  open PR                                                        |
```

Your local test runs are for iteration. The PR contains one final run log per skill + one `.ann` annotation file per skill. See "PR Workflow" below.

---

## PR Workflow

The team (you + your team's other junior + the dev pair) iterates on **one skill at a time**. When you submit a PR, it contains four artifacts per skill touched:

1. The updated skill prompt (`packages/engine/plugin/skills/<skill>/SKILL.md`)
2. Added/updated/deleted unit tests under `eval/tests/unit/<skill>/`
3. **One** run log under `eval/runlogs/unit/<skill>/<model>/<timestamp>.json` — the final one for this PR (delete earlier iteration runs before opening the PR; a GitHub Action will fail the PR if multiple run logs are added per skill)
4. **One** `.ann.json` file alongside the run log with your team's corrected grades

A senior genealogist reviews the PR via GitHub: the prompt diff, the test diff, the run log, and your corrected grades (in the CRUD UI's comparison view, which shows your run side-by-side with main). Their feedback comes as PR comments. You revise and push new commits until they accept.

The senior's accept decision is holistic — they read the prompt diff, the tests, your corrections, and the comparison-view numbers (weighted mean + count histogram). There's no statistical gate; if the weighted-mean delta is small (within ~0.3), the comparison view flags it as "within typical run-to-run variation" and the senior decides what to make of it.

For the full per-PR workflow including senior-side responsibilities, see [`docs/plan/per-pr-review-workflow.md`](../plan/per-pr-review-workflow.md).

---

## Grading Scale

The LLM judge grades each test on **three dimensions per test** (plus skill-specific rubric dimensions and any per-test additional criteria), using **1–3 numeric scores**:

- **3** = pass (the skill did the right thing on this dimension)
- **2** = partial (mostly right, some gap)
- **1** = fail (got it wrong)

You see both the LLM's score and an editable corrected score in the CRUD UI's annotation view. The corrected score defaults to the LLM's score — you only change the dimensions you disagree with. Optional comment per dimension; expected on disagreement.

---

## Model Pinning

To minimize variance between local and canonical runs, the test runner pins a specific model version (e.g., `claude-sonnet-4-6-20250514`). The run log records which model was used so cross-PR comparison can detect (and skip) comparisons across model upgrades.

---

## Test Content Hash

The harness writes a SHA-256 `test_content_hash` per test in each run log, covering the test JSON's grading-relevant fields plus the referenced scenario directory plus the referenced fixture files. When you edit a test, its hash changes, and the comparison view auto-excludes that test from cross-PR comparison for one PR (after the PR lands, the test is comparable again).

If you edit a test and the CRUD UI shows a "hash-change warning," the edit will exclude that test from comparison. Cosmetic edits (name, description, tags) don't trigger the warning. If the senior wants to keep comparison continuity, they'll ask you to revert the change in PR comments.

---

## Batch Files

Three `.bat` files live in `eval/`. Juniors interact with these instead of the terminal.

### `Setup.bat` — run once after cloning

Installs uv (Python package manager), installs all dependencies (both the Next.js app and the Python harness), and prompts for the Anthropic API key. The key is saved to `eval/.env`.

### `Start.bat` — launch the test-creation app

Starts the Next.js dev server in `eval/app/` and opens the app in your default browser at `http://localhost:3000`. Close the terminal window to stop the app.

### `RunTests.bat` — execute tests and write run logs

Runs the Python test harness from `eval/harness/`. By default it runs every test in the suite; this can take a long time. To run just one skill, edit the `.bat` file to add a `--skill <name>` argument, or run from the terminal:

```
cd eval/harness
uv run python run_tests.py --skill <skill-name>
```

When the harness finishes, switch back to the browser tab. The Results section will auto-refresh and your new run log will appear in the "Recent run logs" widget.

---

## CRUD UI: What You Can Do

The Next.js app at `http://localhost:3000` is your primary workspace. It lets you:

- **Tests section** — Create, edit, and delete unit tests. The form maps to the unit-test JSON schema; you don't write JSON by hand.
- **Scenarios + Fixtures sections** — Browse the project state and MCP fixtures that tests reference (read-only in Phase 1; full CRUD in Phase 2).
- **Results section** — View run logs, annotate them with corrected grades, and compare your PR's results against main side-by-side. The "Recent run logs" widget on the home page shows the latest activity across all skills; refresh-on-focus means new run logs appear automatically when you switch back to the browser from RunTests.bat.

Test execution itself happens via `RunTests.bat`, not via a button in the CRUD UI — multi-minute test runs are a poor fit for the browser. You alt-tab between the .bat window (for progress) and the CRUD UI (for everything else).

---

## Troubleshooting

If something isn't working:

- **"npm is not recognized"** — Node.js wasn't installed, or you need to restart your computer after installing it.
- **"python is not recognized"** — Python wasn't installed with "Add to PATH" checked. Reinstall Python and check that box.
- **"uv is not recognized"** — Run `Setup.bat` again, then restart your computer.
- **App won't start** — Make sure no other program is using port 3000. Close any other `Start.bat` windows and try again.
- **Tests fail with an API error** — Your API key may be invalid or expired. Re-run `Setup.bat` to enter a new one.
- **RunTests.bat fails with "run log already exists"** — Two test runs landed in the same second. Wait a second and re-run.
- **The CRUD UI says "this run has crashed judges; re-run before annotating"** — One or more tests in the run log have `judge.skipped: true`. The judge likely hit a transient API error after retries. Re-run via `RunTests.bat` until every test has judge scores before annotating.
