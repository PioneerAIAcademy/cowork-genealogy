# Junior Genealogist Walkthrough — your first PR

> One full pass: edit a skill, run the harness, review the LLM judge's scores in the CRUD UI, and open a PR. ~30 minutes once setup is complete; first-time setup adds ~30 minutes.
>
> Keep this file open during your first few PRs — every step is referenced here.

## One-time install (Windows)

You'll install three things outside the repo, then run a single batch file inside the repo.

1. **Git for Windows** — <https://git-scm.com/download/win>. Accept the defaults during the installer. Open "Git Bash" once from the Start menu to confirm it works.

   Optional but recommended for non-terminal users: also install **GitHub Desktop** from <https://desktop.github.com/>. It gives you a clickable interface for cloning, branches, commits, and pushes — no command-line typing for the daily flow.

2. **Node.js LTS** — <https://nodejs.org/> (pick "LTS"). Accept defaults. After installing, open a new Command Prompt and run `node --version` — you should see a version like `v20.x.x`.

3. **The repo itself.** In GitHub Desktop: File → Clone repository → click the **URL** tab → paste the repo URL → pick a local folder (e.g., `C:\Users\you\cowork-genealogy\`). The dialog opens on the "GitHub.com" tab; pasting a URL there gives a "repository can't be found" error — you must switch to the **URL** tab first. From the terminal:
   ```
   git clone https://github.com/PioneerAIAcademy/cowork-genealogy C:\Users\you\cowork-genealogy\
   ```

4. **Run `eval/Setup.bat`.** Open the cloned folder in Explorer, navigate into `eval\`, and double-click `Setup.bat`. It will:
   - Install `uv` (the Python package manager) via PowerShell.
   - Run `npm install` in `eval/app/` (installs the CRUD UI's dependencies).
   - Run `uv sync` in `eval/harness/` (installs Python dependencies and Python itself if needed).
   - Prompt you for your **Anthropic API key** (paste it when asked — it gets saved to `eval/.env`).

   Get your API key from <https://console.anthropic.com/settings/keys> before running Setup.bat. Format: `sk-ant-...`.

You only do all this once per machine. After this point, daily work uses `Start.bat` and `RunTests.bat` — see below.

## One-time install (macOS / Linux)

```bash
# Git is usually pre-installed; if not: brew install git (macOS) or apt install git (Linux)
brew install node                                      # or: nvm install --lts
brew install uv                                        # or: curl -LsSf https://astral.sh/uv/install.sh | sh

git clone <repo-url> ~/cowork-genealogy
cd ~/cowork-genealogy/eval/harness && uv sync
cd ~/cowork-genealogy/eval/app && npm install

# Save your API key from https://console.anthropic.com/settings/keys
echo "ANTHROPIC_API_KEY=sk-ant-..." > ~/cowork-genealogy/eval/.env
```

## Each PR (the daily flow)

Open GitHub Desktop (or your terminal) and pull the latest `main`:

- **GitHub Desktop:** Fetch origin → Pull origin.
- **Terminal:** `git checkout main && git pull`.

Create a feature branch named after you and the skill you're working on:

- **GitHub Desktop:** Branch menu → New Branch → name it `junior-<your-name>-search-wikipedia`.
- **Terminal:** `git checkout -b junior-<your-name>-search-wikipedia`.

For your first PR, pick a skill with existing tests — `search-wikipedia` is the simplest reference.

## 1. Run the harness against the current skill

**Windows:** in GitHub Desktop, Repository → Show in Explorer to open the repo folder, go into `eval\`, and double-click `RunTests.bat`. When it asks which skill, type `search-wikipedia`.

**macOS / Linux:** from `eval/harness/`:

```bash
uv run python run_tests.py --skill search-wikipedia
```

> **macOS note:** `uv run` may print `warning: VIRTUAL_ENV=... does not
> match the project environment path .venv and will be ignored` if a
> virtualenv is active in your shell. This is harmless — `uv` uses the
> harness's own `.venv` regardless. Ignore it.

Both forms invoke Claude against every test in `eval/tests/unit/search-wikipedia/` using the model pinned in `plugin/skills/search-wikipedia/SKILL.md` (currently `claude-sonnet-4-6`). The LLM judge grades each run. Expect ~30 seconds per test serial — `search-wikipedia` has 8 tests, so ~4 minutes total. ~$0.50 of API credit per pass.

When it finishes, you'll see a summary table and a new run log at:

```
eval/runlogs/unit/search-wikipedia/v{N}_<timestamp>.json
```

This is a **candidate** — a full-skill iteration of v{N} that hasn't been released yet. The `v{N}` increments only when a candidate gets released; until then, all your iterations stay on the same version line. If this is the first time you've run the harness against the skill, you'll see `v1_<ts>.json`.

A matching `.ann.json` will appear once you start reviewing scores in the UI (next step).

## 2. Review scores in the CRUD UI

**Windows:** double-click `eval\Start.bat`. A browser tab opens at <http://localhost:3000>; keep the black command-prompt window open while you work (closing it stops the app).

**macOS / Linux:** in a second terminal, from `eval/app/`:

```bash
npm run dev
```

Then open <http://localhost:3000/results>.

You'll see the run logs grouped by skill. Click your latest `search-wikipedia` candidate.

The detail page shows every test in the run, with:

- A **trace** block — the skill's input, scenario state, tool calls + the fixture responses, and Claude's final output.
- A **grade** block per test — one row per dimension, showing the LLM judge's score (1–3), its rationale, and a score-picker for your correction.

Review every dimension. Three patterns:

| You agree with the judge | Pick the same score, leave the comment empty. |
| You disagree | Pick a different score and write a one-line comment explaining why. |
| Whole test is correct | Click **"Agree with all"** on the test header — marks every dimension reviewed in one click. |

**Keyboard shortcuts** (when a score picker is focused):

- `1` / `2` / `3` — set the focused dimension's score.
- `Tab` / `Shift-Tab` — move between dimensions.
- `?` — show shortcut help.

The completeness counter in the page header — e.g. `8/12 reviewed` — tracks how many dimensions you've explicitly touched. The GH Action requires **every dimension reviewed** before merge; the **Release** button stays disabled until the counter reads `N/N`.

Each correction saves to `<runlog>.ann.json` after a short debounce. You'll see "saved" in the header when it lands.

## 3. Iterate on the skill (optional)

If the scores reveal the skill is doing the wrong thing — bad tool args, missing edge case, weak prompt — edit `plugin/skills/<skill>/SKILL.md` (or `template.md`, references, etc.) using any text editor (VS Code, Notepad++, Sublime — anything that doesn't add Word-style smart quotes).

Then re-run the harness — `RunTests.bat` again, or `uv run python run_tests.py --skill search-wikipedia` from `eval/harness/`.

The harness picks up the changes via the snapshot and writes a new candidate `v{N}_<ts2>.json`. Open the new one in the UI and review again. The earlier candidate stays on disk (with its `.ann.json`) as history.

Tip: a small skill edit often leaves most dimensions unchanged. The fastest review pattern is to scan the trace, then "Agree with all" on tests that look right, and only manually correct the ones you actually disagree with.

## 4. Commit + push

Once your latest candidate has every dimension reviewed:

**GitHub Desktop:**

1. The left panel shows changed files. Tick the boxes next to the files you intend to commit — usually anything under `plugin/skills/search-wikipedia/` (if you edited the skill) and `eval/runlogs/unit/search-wikipedia/` (the candidate + its `.ann.json`).
2. Write a summary like `search-wikipedia: candidate v{N}` at the bottom-left, then click "Commit to junior-<your-name>-search-wikipedia".
3. Click "Push origin" at the top.
4. Click "Create Pull Request" — that opens GitHub in your browser. Add a one-paragraph description of what you changed and why, then click "Create pull request".

**Terminal alternative:**

```bash
git add plugin/skills/search-wikipedia/
git add eval/runlogs/unit/search-wikipedia/
git commit -m "search-wikipedia: candidate v{N}"
git push -u origin junior-<your-name>-search-wikipedia
# Then open the PR via GitHub's web UI or `gh pr create`.
``` The `check-runlogs` action will run automatically and check three things:

| ✓ | At most one newly added released `v{N}.json` per skill (a candidate PR adds zero). |
| ✓ | The latest full-skill run log is **active** — its embedded snapshot matches the skill files in the PR. |
| ✓ | The latest run log's `.ann.json` is **complete** — every dimension has a correction entry. |

If any of these fail, the action prints which files differ or which dimensions you missed. Fix and push again.

When the action is green, a senior genealogist will pick up the PR for review.

## What seniors see

Seniors review your PR using:

1. The GitHub diff for skill/test/scenario/fixture changes.
2. Your latest candidate in the CRUD UI for the corrected scores + rationale.
3. The compare page (`/results/compare`) to see your candidate vs the last released version side-by-side, with a "what changed" panel showing exactly which files moved between the two snapshots.

If they disagree with a specific correction, they'll click the 📋 button next to that dimension in the UI, paste the markdown into a PR comment, and add their reasoning. Address their comments by adjusting the correction (or pushing back on the comment with a reply); re-push when ready.

When the senior accepts, they'll click **Release** on your latest candidate in the UI. That renames `v{N}_<ts>.json` → `v{N}.json` and the matching `.ann.json` — a final dev iteration becomes the canonical released version. They push the rename to your branch, then approve the PR.

The project owner merges. Your skill is shipped at v{N}.

## Common stumbles

- **"Annotation incomplete" on push.** The completeness counter isn't `N/N`. Open the candidate in the UI and review the remaining dimensions. The `📋 PR comment` button stays visible; "Agree with all" is the fastest way to clear tests you've eyeballed.
- **"Run log is not active" on push.** You edited a skill file after the last harness run, so the snapshot embedded in the candidate doesn't match your working tree anymore. Re-run `uv run python run_tests.py --skill <skill>` and commit the fresh candidate.
- **"v{N} already exists."** Someone else released the same version on main while you were working. Pull, rebase, re-run the harness; your candidate becomes `v{N+1}_<ts>.json` automatically.
- **Wanted to test one specific test.** `uv run python run_tests.py --test ut_xxx` produces a `scratch_<ts>.json` run log — gitignored, local-only. It can't be released and won't show up in compare/trend; that's intentional. Use it for debugging; do a full `--skill` run before pushing.

## Files you'll touch

```
plugin/skills/<skill>/SKILL.md          edit prompt here
plugin/skills/<skill>/template.md       and supporting files
eval/tests/unit/<skill>/*.json          add/edit tests (rare on a first PR)
eval/tests/unit/<skill>/rubric.md       only if a rubric dimension needs revising
eval/fixtures/scenarios/<name>/         shared project-state fixtures (read-only on first PR)
eval/fixtures/mcp/<name>.json           shared tool-response fixtures (read-only on first PR)
eval/runlogs/unit/<skill>/v{N}_<ts>.json        harness writes this
eval/runlogs/unit/<skill>/v{N}_<ts>.ann.json    CRUD UI writes this as you review
```

Anything else, don't touch on your first PR — ask the senior engineer.
