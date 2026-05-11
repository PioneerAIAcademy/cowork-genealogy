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
     |                    (writes files to disk)                 |
     |                              |                            |
     |                    close browser tab                      |
     |                              |                            |
     |                                          double-click ----+
     |                                          runs tests,
     |                                          writes result files,
     |                                          exits Python
     |                              |                            |
     |                    open browser tab                       |
     |                    view results in app                    |
     |                              |                            |
     |                    iterate until happy                    |
     |                              |                            |
  commit + push                done for now                      |
```

Your local test runs are for fast iteration. They are drafts. The canonical test run happens during the PR review process (see below).

---

## PR Workflow

Each updated skill (tests, prompts, annotations) is a separate PR:

1. **Junior** iterates locally: edit tests, run them, review results, repeat.
2. **Junior** pushes branch and opens a PR when satisfied.
3. **Dev** reviews the PR and runs the canonical test suite once (consistent environment, centralized API key).
4. **Dev** commits the canonical result files to the PR branch.
5. **Junior** grades the canonical results: annotates result files.
6. **Junior** pushes annotations.
7. **Dev** reviews annotations and merges.

This approach avoids nightly CI runs. You only pay API costs for skills that actually changed. The canonical run eliminates "my machine gave different output" ambiguity.

---

## Model Pinning

To minimize variance between local and canonical runs, the test runner pins a specific model version (e.g., `claude-sonnet-4-6-20250514`). Local results won't match canonical results exactly, but pinning the model version keeps them close.

---

## Batch Files

Three `.bat` files live in the repository root. Juniors interact with these instead of the terminal.

### `Setup.bat` — run once after cloning

Installs uv (Python package manager), installs all dependencies, and prompts for the Anthropic API key.

```bat
@echo off
cd %~dp0

echo === GeneFun Eval Setup ===
echo.
echo Installing Python package manager (uv)...
powershell -Command "irm https://astral.sh/uv/install.ps1 | iex"

echo.
echo Installing Node.js dependencies...
call npm install

echo.
echo Installing Python dependencies...
call uv sync

echo.
set /p APIKEY="Paste your Anthropic API key: "
echo ANTHROPIC_API_KEY=%APIKEY%> .env

echo.
echo === Setup complete! ===
echo Double-click Start.bat to launch the test-creation app.
pause
```

### `Start.bat` — launch the test-creation app

Starts the Next.js dev server and opens the app in the default browser.

```bat
@echo off
cd %~dp0

echo Starting test-creation app...
echo Close this window to stop the app.
echo.

start http://localhost:3000
call npm run dev
```

### `RunTests.bat` — execute tests and write results

Runs the Python test harness, writes result files to the local repo, and exits.

```bat
@echo off
cd %~dp0

echo Running tests...
echo.

call uv run python run_tests.py

echo.
echo Done. Result files have been written.
echo Review them in the test-creation app, then commit via GitHub Desktop.
pause
```

---

## Troubleshooting

If something isn't working:

- **"npm is not recognized"** — Node.js wasn't installed, or you need to restart your computer after installing it.
- **"python is not recognized"** — Python wasn't installed with "Add to PATH" checked. Reinstall Python and check that box.
- **"uv is not recognized"** — Run `Setup.bat` again, then restart your computer.
- **App won't start** — Make sure no other program is using port 3000. Close any other `Start.bat` windows and try again.
- **Tests fail with an API error** — Your API key may be invalid or expired. Re-run `Setup.bat` to enter a new one.
