# Alpha Walkthrough — authoring e2e research tests

> **For alpha senior genealogists** — the external experts helping us build the
> e2e research-test suite during the alpha. You author an **end-to-end research
> test** (a "fixture") from a real FamilySearch person, watch Claude attempt it
> live to sanity-check it, and open a PR. You **don't** run the expensive scored
> version or grade it — the internal genealogist + developer teams do that once
> your fixture lands. ~30–45 minutes per fixture once you're set up.
>
> Keep this file open during your first few fixtures — every step is referenced here.

## Your role vs. the teams'

| You (external senior genealogist) | The internal teams |
|---|---|
| Pick a well-researched person and a research question. | Run the scored, headless test (`RunE2E.bat`). |
| Author the fixture, validate it, watch a live run. | Grade the result and calibrate the judge. |
| Open a PR with the fixture files. | Review, run, grade, and merge. |

You are the genealogy expert who decides **what makes a good test**. The
mechanics below are just enough to get a solid fixture into a PR.

## What an e2e fixture is

An e2e test takes a real, **well-researched, deceased** FamilySearch person,
**strips out the answer** to one focused research question (say, who their
parents were), and asks Claude to recover it **from records** — it can't read
the answer back off the live tree. It's how we measure whether the AI can
actually *do the research*, not just look things up.

Author **both kinds**:

- **Positive** fixtures test **recall** — strip a fact, check the agent
  recovers it. (The default.)
- **Negative** fixtures test **restraint** — name a plausible-but-*wrong*
  candidate the agent should decline to conclude. This is the only way we
  catch over-claiming, the failure that matters most in genealogy (a wrong
  parent silently corrupts an entire upstream tree).

Aim, across your fixtures, for a spread of question types (parents, death,
siblings, migration…), eras, and geographies.

---

## One-time install (Windows)

You install a few things outside the repo, then run three batch files inside it.
You only do this once per machine.

1. **Git + GitHub Desktop.** Git for Windows (<https://git-scm.com/download/win>,
   accept defaults) and GitHub Desktop (<https://desktop.github.com/>) for
   clickable clone/branch/commit — no command line needed for the daily flow.

2. **Node.js LTS.** <https://nodejs.org/> — pick **LTS**, accept defaults.

3. **Clone the repo.** GitHub Desktop → **File → Clone repository → click the
   URL tab.** ⚠️ The dialog opens on the **GitHub.com** tab — pasting a URL
   there errors with "repository can't be found." Switch to the **URL** tab
   *first*, paste `https://github.com/PioneerAIAcademy/cowork-genealogy`, pick a
   Local path, click **Clone**.

4. **Open the repo in Explorer.** Everything you run from here on is a
   double-clickable batch file inside the repo's `eval\` folder. In GitHub
   Desktop, with the repo selected, click **Show files in Explorer** (also at
   **Repository → Show in Explorer**). An Explorer window opens on the repo
   root — **double-click into the `eval` folder.** Leave that window open; you
   come back to it for every step below and for every fixture.

5. **Run `eval\Setup.bat`.** Get an Anthropic API key first from
   <https://console.anthropic.com/settings/keys> (looks like `sk-ant-…`; a new
   key is shown only once — save it) — the script prompts for it. In the `eval\`
   Explorer window from step 4, double-click `Setup.bat`. It installs `uv`, runs
   the npm installs, **builds the MCP server**, installs the viewer's
   dependencies, and saves your key to `eval\.env`.

   > If it stops with `'uv' is not recognized`, close the window and run
   > `Setup.bat` again — a known Windows PATH quirk. The completed steps are
   > no-ops the second time.

6. **Build + install the two Cowork artifacts.** These give Cowork the
   genealogy tools for the live run (steps 7–8 below). From the same `eval\`
   Explorer window:

   - Double-click **`BuildMcpb.bat`**. Then in Claude Desktop: **Settings →
     Extensions → Advanced Settings → Install extension** → choose
     `releases\genealogy-mcp.mcpb`.
   - Double-click **`BuildPlugin.bat`**. Then in Claude Desktop: **Cowork →
     Customize → Add → Upload Plugin** → choose `releases\genealogy-plugin.zip`.
   - **Fully quit and reopen Claude Desktop** after installing. Closing the
     window is not enough — use the system-tray icon → **Quit**, and confirm no
     `Claude.exe` remains in Task Manager.

   ⚠️ **Install the plugin from the Cowork tab, not the Code tab.** Cowork and
   Claude Code have *separate* plugin systems — Cowork loads the uploaded
   `.zip`, Claude Code loads loose skill folders from `~/.claude/skills/`. A
   plugin you added through the Code tab will not appear in Cowork, and vice
   versa. Use **Cowork → Customize** and nothing else.

   (The `.mcpb` extension is different: it installs once under **Settings →
   Extensions** and is shared by the whole Desktop app, Cowork and Code tabs
   alike. You install it once, not once per tab.)

### Updating after you pull

Any time you pull repo changes that touch the MCP server or the skills, redo
the build + install:

1. Double-click **`BuildMcpb.bat`** and **`BuildPlugin.bat`** again. `BuildMcpb`
   re-installs npm dependencies and recompiles the server, so it picks up
   whatever changed.
2. **The `.mcpb` extension: install straight over the old one.** No uninstall
   needed — Claude Desktop tracks one copy per extension and replaces it.
   Settings → Extensions → Advanced Settings → Install extension.
3. **The plugin: remove the old one first, then upload the new one.** In Cowork
   → Customize, **remove** the existing Genealogy Research plugin, *then*
   **Add → Upload Plugin** with the rebuilt `.zip`. Uploading on top of the old
   plugin may leave you running the old skills; removing first is the reliable
   way to be sure you got the new ones.
4. **Fully quit and reopen Claude Desktop.** The MCP server is only re-read on a
   real restart. Skipping this is the single most common reason a "reinstalled"
   extension still runs the old code.

> If a batch file now fails on a missing Python or npm dependency, the pull
> changed the harness dependencies too — re-run `Setup.bat` (have your Anthropic
> API key handy; it re-prompts and rewrites `eval\.env`).

---

## Each fixture (the flow)

### 1. Pull, then make a branch

GitHub Desktop → **Fetch origin → Pull origin** on `main`. Then **Current
Branch → New Branch**, based on `main`, named e.g.
`senior-<your-name>-<slug>` (the slug is your fixture's short name, like
`smith-parents-1850`).

### 2. Log in to FamilySearch (once a day)

Double-click **`eval\Login.bat`**. Your browser opens for FamilySearch
authorization; the token lasts ~24 hours and is shared by **both** the fixture
author (step 4) **and** the live Cowork run (step 7), so this one login covers
everything for the day.

### 3. (Recommended) Preflight

Double-click **`eval\CheckSetup.bat`**. It confirms your FamilySearch login,
the built MCP server, the API key, and the harness dependencies in one shot —
catching a setup gap before you spend time. Fix anything it flags.

### 4. Author the fixture

Open the **repo root** (`cowork-genealogy`) in the Claude Desktop **Code tab**.
On first open, **approve the `genealogy` MCP prompt** (if the session was
already open, restart it so the tools load).

Then run:

```
/author-e2e-fixture
```

- Give it a **deceased** person's FamilySearch **PID**. (Deceased is a
  FamilySearch requirement for committed test data — the skill confirms it.)
- It reads that person's tree, summarizes what they're well-attested for, and
  asks which **one** focused subset to strip (the "answer"). Keep it to **1–5
  findings**.
- Answer the metadata questions (slug, question type, era, geography,
  difficulty, notes).

It writes five files straight into `eval\tests\e2e\<slug>\` — no move needed:
`fixture.json`, `starting-research.json`, `starting-tree.gedcomx.json`,
`expected-findings.json`, `README.md`.

> Editing any of these by hand? Use **Notepad++**, not Word or WordPad — those
> insert "smart quotes" that break the JSON.

### 5. Validate the stripping

Double-click **`eval\ValidateFixture.bat`** and enter the slug. This linter is
the crux check: it confirms the answer is genuinely **absent** from the
starting tree. If the answer is still in there, the agent gets it for free and
the test silently "passes" every time. Resolve every **`WARN`** before moving
on (a `WARN` is occasionally a legitimate match — a common surname — but check
each one).

### 6. Seed an editable project to watch it run

Double-click **`eval\SeedProject.bat`** and enter the slug. This copies the
fixture's starting state into **`eval\e2e-project\<slug>\`** as a fresh,
editable project. (That folder is throwaway and never committed.)

### 7. Run it live in Cowork

Open **`eval\e2e-project\<slug>\`** in the Claude Desktop **Cowork tab** (plugin
installed, logged in to FamilySearch), and run:

```
/research
```

Watch it chain through the research steps.

### 8. Watch it in the Research Viewer

Double-click **`eval\Viewer.bat`** to launch the viewer, click **Open
Project**, and open the **same** `eval\e2e-project\<slug>\` folder. You'll see
the research log, assertions, and conflicts appear live. Ask the agent things
like *"why didn't you search X?"* or *"why direct, not indirect?"* as it works.

> ⚠️ **This live run is for understanding, not scoring.** Unlike the scored
> test the internal team runs, a live Cowork run does **not** block the
> tree-reading tools — so the agent *can* peek at the answer on the live tree.
> A live "it found it!" is **not** proof the fixture is solvable by research.
> The honest pass/fail is the headless run the team does later. Use this step
> to confirm the fixture is sensible and the question is answerable, not to
> certify it.

### 9. (Optional) Submit feedback

If the live run surfaced a problem worth the teams' attention (the agent
skipped an obvious search, mis-reasoned, stopped early), click **Submit
feedback** in the viewer. It bundles the project state plus your "what it did /
what it should have done" notes into a zip and uploads it to the shared Drive
folder for the genealogist + developer teams. Skip this if the run looked fine.

### 10. Open the PR

In GitHub Desktop:

1. In the **Changes** tab, tick **only** the five files under
   `eval\tests\e2e\<slug>\`. (The seeded project and viewer folders are
   gitignored, so they won't appear — that's correct.)
2. Summary: `e2e: add <slug> fixture`. Add a description covering the research
   question, what you stripped, and the difficulty.
3. **Commit to `senior-<your-name>-<slug>`**, then **Push origin**, then
   **Create Pull Request**.

You do **not** merge — the project owner does.

> **A fixture-only PR needs no scored run to land.** The `check-e2e-fixtures`
> check does **not** warn about a fixture that lacks a passing scored run — the
> internal team supplies that run when they pick it up. If that check shows
> *red*, it's the grading gate (a committed run missing its grade), not your
> fixture; ask a developer.

---

## What happens after your PR

The internal teams take it from there: they run the scored, headless test
(`RunE2E.bat`, 20–60 min, live FamilySearch), read the verdict, and grade it.
A **passing** scored run is what finally validates your fixture. If it fails,
that's still useful signal — a real capability gap to revisit — and they'll
follow up.

## When something's wrong

- **`/author-e2e-fixture` says you're not logged in.** Run `Login.bat` (step 2)
  and retry. The token may have aged past ~24h.
- **The Code tab has no genealogy tools.** You didn't approve the `genealogy`
  MCP prompt, or the session was open before you approved it. Restart the Code
  tab session.
- **Cowork has no genealogy tools / `/research` degrades to guessing.** The
  `.mcpb` and/or plugin aren't installed, or Desktop wasn't restarted after
  installing. Re-do install step 6 and **fully quit and reopen** Desktop.
- **The plugin is installed but Cowork can't see it.** You installed it in the
  **Code** tab. Cowork keeps its own plugin list — reinstall via **Cowork →
  Customize → Add → Upload Plugin** (install step 6).
- **You pulled, rebuilt, reinstalled — and Claude still runs the old code.**
  Desktop wasn't *fully* quit. Quit from the system tray, confirm no
  `Claude.exe` in Task Manager, then reopen. See "Updating after you pull".
- **`ValidateFixture.bat` prints `WARN` lines.** Each flags a finding that may
  still be present in the starting tree. Review and confirm it's genuinely
  stripped before committing (see step 5).
- **The live run "passed" but you're unsure it's real.** Right instinct — a
  live run can cheat via the live tree (step 8 caveat). Trust the honest
  headless verdict the team produces, not the live run.
- **The PR check is red (not yellow).** The yellow validity advisory is normal;
  a red check is a real problem. Ask a developer.

## What you don't do

- **You don't run the headless scorer or grade runs.** `RunE2E.bat`,
  `/grade-e2e-run`, and judge calibration are the internal teams' steps.
- **You don't commit a run log.** Your PR is fixture files only. (Committing a
  run log that produced a tree but no grade would actually *block* the PR — so
  don't.)
- **You don't merge.** The project owner does.
- **You don't hand-edit run logs or annotation (`.ann.json`) files.** Those are
  produced by tooling, never by hand.

## Files you'll touch

```
eval\tests\e2e\<slug>\fixture.json                 metadata (question, tags, difficulty)
eval\tests\e2e\<slug>\starting-research.json       the project state the agent starts from
eval\tests\e2e\<slug>\starting-tree.gedcomx.json   the tree with the answer stripped
eval\tests\e2e\<slug>\expected-findings.json       what the agent should recover
eval\tests\e2e\<slug>\README.md                    human notes (PID, deceased line, what was stripped)
```

Everything else — the seeded `eval\e2e-project\<slug>\`, the viewer, run logs —
is throwaway or the teams' job. If you're unsure whether a file belongs in the
PR, it probably doesn't; ask a developer.

---

## macOS / Linux equivalents

Every Windows batch file has a `make` target (run from the repo root):

| Windows | macOS / Linux |
|---|---|
| `Setup.bat` | `make install` (first time), `make engine-build` (rebuild after a pull) |
| `Login.bat` | `make e2e-login` |
| `CheckSetup.bat` | `make e2e-preflight` |
| `ValidateFixture.bat` | `make e2e-validate TEST=<slug>` |
| `SeedProject.bat` | `make e2e-project TEST=<slug>` |
| `Viewer.bat` | `make electron` |
| `BuildMcpb.bat` | `make mcpb` |
| `BuildPlugin.bat` | `make plugin` |

`/author-e2e-fixture`, `/research`, and Submit feedback are the same on every
platform. On macOS/Linux, put your Anthropic key in `eval/.env` or your shell.
