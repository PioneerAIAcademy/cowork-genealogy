# Junior Genealogist Walkthrough — your first PR

> One full pass: edit a skill, run the harness, review the LLM judge's scores in the CRUD UI, and open a PR. ~30 minutes once setup is complete; first-time setup adds ~30 minutes.
>
> Keep this file open during your first few PRs — every step is referenced here.

## One-time install (Windows)

You'll install three things outside the repo, then run a single batch file inside the repo.

1. **Git for Windows** — <https://git-scm.com/download/win>. Accept the defaults during the installer. Open "Git Bash" once from the Start menu to confirm it works.

   Optional but recommended for non-terminal users: also install **GitHub Desktop** from <https://desktop.github.com/>. It gives you a clickable interface for cloning, branches, commits, and pushes — no command-line typing for the daily flow.

2. **Node.js LTS** — <https://nodejs.org/> (pick "LTS"). Accept defaults. After installing, open a new Command Prompt and run `node --version` — you should see a version like `v20.x.x`.

3. **The repo itself — clone it to your computer.** Use **either** Option A (clickable) **or** Option B (terminal) — not both.

   **Option A — GitHub Desktop** (recommended if you don't use a terminal)

   1. Open GitHub Desktop.
   2. Click **File → Clone repository**.
   3. Click the **URL** tab. ⚠️ The dialog opens on the **GitHub.com** tab — pasting a URL there gives a "repository can't be found" error. You must switch to the **URL** tab *first*.
   4. Paste the repo URL: `https://github.com/PioneerAIAcademy/cowork-genealogy`
   5. Next to **Local path**, click **Choose...** and pick a folder (somewhere you'll easily find again). The **Local path** box then shows the exact spot where GitHub Desktop will put the repo — glance at it before moving on.
   6. Click **Clone** and wait for it to finish.

   **Option B — Terminal** (if you're comfortable with the command line)

   In Command Prompt (which opens at `C:\Users\<your-username>\` by default), run:

   ```
   git clone https://github.com/PioneerAIAcademy/cowork-genealogy
   cd cowork-genealogy
   ```

   The repo will end up at `C:\Users\<your-username>\cowork-genealogy\`.

   If you want the repo somewhere else (a Desktop folder, an existing projects folder, an external drive), get the real path first instead of guessing:

   1. Open File Explorer, navigate to the folder you want the repo inside.
   2. Click the address bar — it switches to the real path (e.g., `C:\Users\<your-username>\Desktop`).
   3. Copy that path.
   4. In Command Prompt, `cd` to it, then clone:

   ```
   cd <paste the path here>
   git clone https://github.com/PioneerAIAcademy/cowork-genealogy
   ```

   The repo will end up inside whatever folder you `cd`'d into.

4. **Run `eval/Setup.bat`.**

   **First — get your Anthropic API key.** `Setup.bat` asks for it partway through, so have it ready before you start. Get it from <https://console.anthropic.com/settings/keys> — use an existing key, or create a new one. It looks like `sk-ant-...`. ⚠️ A newly created key is shown **only once** — copy it right away and save it somewhere private (a password manager is ideal). If you lose it, you'll have to create another.

   > **For your current assessment, you don't need a real API key.** When Setup gets to the "Paste your Anthropic API key" prompt, you can simply close the Command Prompt window — everything you need for the assessment was installed in the earlier steps.

   **Then — run the script.** Use **either** Option A (clickable) **or** Option B (terminal) — not both.

   **Option A — Explorer** (recommended if you don't use a terminal)

   Open the cloned folder in Explorer, navigate into `eval\`, and double-click `Setup.bat`.

   **Option B — Terminal** (if you cloned via Option B above, you're already in `cowork-genealogy\`)

   ```
   cd eval
   Setup.bat
   ```

   Either way, the script will:
   - Install `uv` (the Python package manager) via PowerShell.
   - Run `npm install` in `eval/app/` (installs the CRUD UI's dependencies).
   - Run `npm install` and `npm run build` in `packages/engine/mcp-server/` (compiles the MCP server the harness loads).
   - Run `uv sync` in `eval/harness/` (installs Python dependencies and Python itself if needed).
   - Prompt you for your **Anthropic API key** — paste it in when asked. It gets saved to `eval/.env`.

   ### If Setup.bat stops with `'uv' is not recognized`

   You may see output like this near the end:

   ```
   Installing Python dependencies...
   'uv' is not recognized as an internal or external command,
   operable program or batch file.
   ERROR: uv sync failed. Setup aborted.
   Press any key to continue . . .
   Terminate batch job (Y/N)?
   ```

   This is a known Windows quirk: the installer just added `uv` to your user `PATH`, but the current Command Prompt window started *before* that change, so it can't see `uv` yet. The fix is two steps:

   1. Press any key to dismiss the prompt, then type `Y` and press Enter to terminate the batch job.
   2. **Close the Command Prompt window entirely.** Open a fresh Command Prompt (or just double-click `Setup.bat` again from Explorer) and re-run Setup. The previously-completed steps (uv install, `npm install`) are no-ops the second time, and `uv sync` will now find `uv` and finish the job.

   If a fresh window still says "not recognized," the installer didn't update your user PATH for some reason. Run this in the new window before re-running Setup:

   ```
   set Path=%USERPROFILE%\.local\bin;%Path%
   ```

   That prepends uv's install location for this one session. Then re-run Setup.bat.

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

**Windows:** use **either** Option A (clickable) **or** Option B (terminal) — not both.

**Option A — Explorer**

1. Open the repo folder in File Explorer. Either:
   - in GitHub Desktop, click **Repository → Show in Explorer**, or
   - open File Explorer yourself and go to the folder where you cloned the repo.
2. Open the `eval\` folder.
3. Double-click `RunTests.bat`.
4. When it asks which skill, type `search-wikipedia` and press Enter.

**Option B — Command Prompt** (if you're already in the repo folder from earlier steps)

```
cd eval
RunTests.bat
```

When it asks which skill, type `search-wikipedia` and press Enter.

`search-wikipedia` is the example skill for your first PR. Later you'll test other skills — type the skill name at the Windows prompt, or pass it to `--skill` on macOS/Linux. The harness works the same for any skill.

**macOS / Linux:** open a terminal and run:

```bash
cd ~/cowork-genealogy/eval/harness
uv run python run_tests.py --skill search-wikipedia
```

> **macOS note:** `uv run` may print `warning: VIRTUAL_ENV=... does not
> match the project environment path .venv and will be ignored` if a
> virtualenv is active in your shell. Harmless — `uv` uses the harness's
> own `.venv` regardless. Ignore it.

**What happens next — same on both platforms:**

- Claude runs against every test in `eval/tests/unit/search-wikipedia/`, using the model pinned in `plugin/skills/search-wikipedia/SKILL.md` (currently `claude-sonnet-4-6`).
- An LLM judge grades each run.
- **Time:** ~30 seconds per test, run one at a time — `search-wikipedia` has 8 tests, so ~4 minutes total.
- **Cost:** ~$0.50 of API credit per pass.

When it finishes, you'll see a summary table and a new run log at:

```
eval/runlogs/unit/search-wikipedia/v{N}_<timestamp>.json
```

This is a **candidate** — a full-skill iteration of v{N} that hasn't been released yet. `v{N}` only increments when a candidate gets released; until then, all your iterations stay on the same version line. On your first run against the skill, you'll see `v1_<ts>.json`.

A matching `.ann.json` will appear once you start reviewing scores in the UI (next step).

## 2. Review scores in the CRUD UI

**Windows:** use **either** Option A (clickable) **or** Option B (terminal) — not both.

- **Option A — Explorer:** double-click `eval\Start.bat`. A black command-prompt window opens, and a browser tab opens automatically.
- **Option B — Command Prompt** (if you're already in the repo folder):

  ```
  cd eval
  Start.bat
  ```

  A browser tab opens automatically.

Either way, **keep that command-prompt window open** the whole time you work — closing it stops the app.

**macOS / Linux:** open a second terminal and run:

```bash
cd ~/cowork-genealogy/eval/app
npm run dev
```

**Keep that terminal open** while you work — closing it (or pressing Ctrl-C) stops the app.

**Then, on both platforms:** go to <http://localhost:3000/results> in your browser.

You'll see the run logs grouped by skill. Click your latest `search-wikipedia` candidate.

The detail page shows every test in the run, with:

- A **trace** block — the skill's input, scenario state, tool calls + the fixture responses, and Claude's final output.
- A **grade** block per test — one row per dimension, showing the LLM judge's score (1–3), its rationale, and a score-picker for your correction.

Review every dimension. Three patterns:

| Situation | What to do |
|---|---|
| You agree with the judge | Pick the same score; leave the comment empty. |
| You disagree | Pick a different score and write a one-line comment explaining why. |
| The whole test is correct | Click **"Agree with all"** on the test header — marks every dimension reviewed in one click. |

**Keyboard shortcuts** (when a score picker is focused):

- `1` / `2` / `3` — set the focused dimension's score.
- `Tab` / `Shift-Tab` — move between dimensions.
- `?` — show shortcut help.

The completeness counter in the page header — e.g. `8/12 reviewed` — tracks how many dimensions you've explicitly touched. The GH Action requires **every dimension reviewed** before merge; the **Release** button stays disabled until the counter reads `N/N`.

Each correction saves to `<runlog>.ann.json` after a short debounce. You'll see "saved" in the header when it lands.

## 3. Iterate on the skill (optional)

If the scores reveal the skill is doing the wrong thing — bad tool args, missing edge case, weak prompt — edit `plugin/skills/<skill>/SKILL.md` (or `template.md`, references, etc.).

**Recommended editor: Notepad++.** It's free, handles markdown well, and doesn't add Word-style smart quotes that break things. Other editors (VS Code, Sublime) work too — just avoid Word/WordPad.

**Install Notepad++ (Windows):**

1. Go to <https://notepad-plus-plus.org/downloads/> and download the latest installer (pick the 64-bit Installer if your machine is 64-bit, which most modern Windows machines are).
2. Run the installer and accept the defaults.
3. *(Optional but handy for previewing Markdown.)* Open Notepad++ → **Plugins → Plugins Admin…** → search **MarkdownViewer++** → tick it → **Install**. Notepad++ restarts, and you'll get a side-by-side rendered preview via **Plugins → MarkdownViewer++ → MarkdownViewer++**.

**Open SKILL.md in Notepad++:**

1. Open File Explorer and go into `cowork-genealogy\plugin\skills\<skill>\` — e.g. `cowork-genealogy\plugin\skills\search-wikipedia\`.
2. Right-click `SKILL.md` → **Edit with Notepad++** (added automatically by the installer). If that option isn't there, right-click → **Open with** → **Notepad++**.
3. Edit, then **File → Save** (or Ctrl-S). Don't use **Save As** — it can change the file extension or the text encoding.

> ⚠️ Don't open the file in Word or WordPad — they silently turn straight quotes into curly "smart quotes" that break the skill. Notepad++ doesn't do this.

**macOS / Linux:** any plain-text editor works — TextEdit (with **Format → Make Plain Text** turned on), `nano`, or `vim`. Avoid rich-text editors.

Then re-run the harness — `RunTests.bat` again, or `uv run python run_tests.py --skill search-wikipedia` from `eval/harness/`.

The harness picks up the changes via the snapshot and writes a new candidate `v{N}_<ts2>.json`. Open the new one in the UI and review again. The earlier candidate stays on disk (with its `.ann.json`) as history.

Tip: a small skill edit often leaves most dimensions unchanged. The fastest review pattern is to scan the trace, then "Agree with all" on tests that look right, and only manually correct the ones you actually disagree with.

## 4. Commit + push

> ⚠️ **Never push directly to `main`.** Always push to your own feature branch (e.g. `junior-<your-name>-search-wikipedia`). If you ever see `git push origin main` (or `git push -u origin main`) in your terminal, or "Push to main" in GitHub Desktop, **stop** and double-check which branch you're on — in the terminal run `git branch` (the active branch has a `*` next to it); in GitHub Desktop look at the "Current branch" dropdown at the top. Pushes to `main` are blocked by GitHub anyway, but it's a sign you've drifted off your feature branch and your work will land in the wrong place.

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
