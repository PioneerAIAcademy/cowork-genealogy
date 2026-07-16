# Feedback case workflow — how to triage a submission

> **Superseded by [`docs/skill-lifecycle.md`](skill-lifecycle.md)** as the
> canonical create → test → improve flow. This page remains the detailed
> click-path for one specific on-ramp: triaging a **user-submitted feedback
> zip** end to end (the per-platform setup, state reset, and commit steps).
> The *discipline* it teaches — reproduce the bug live first, reset both the
> conversation and the case data between attempts, and promote the fix into
> a regression test — is summarized in the lifecycle doc's step 5; come here
> for the actual zip-triage mechanics.

You have a user feedback zip and you need to fix the bug and lock the
fix in with a regression test. This page is the step-by-step. The
spec at `docs/specs/feedback-case-spec.md` carries the rationale and
contracts — read that only when you need the *why*.

## Who does what

| Role | What they do |
|---|---|
| **You** (junior genealogist or any contributor) | Everything from "download the zip" through "commit the fix on a feature branch." |
| **Developer** | Pairs with you at PR time to build the plugin `.zip`, install it into Cowork, walk through a fresh Cowork verification, and open the PR. |
| **Senior genealogist** | Reviews the PR — skill changes, rubric quality, the new unit test — and approves the merge. |

If you get stuck mid-flow, ask a developer. The spec is precise about
which steps benefit from pairing.

## One-time setup (per machine)

Already done? Skip ahead.

- Cowork installed with the genealogy plugin + MCP server. See the
  "Installation" section of `README.md`.
- Claude Code installed and signed in.
- FamilySearch tokens in `~/.familysearch-mcp/tokens.json`. If you've
  used the plugin from Cowork, this exists already; otherwise run
  the `login` tool once.
- This repo cloned. The walk-through below assumes `~/cowork-genealogy`
  on macOS/Linux and `%USERPROFILE%\cowork-genealogy\` on Windows;
  adjust paths if yours is elsewhere. (GitHub Desktop's default clone
  location is `%USERPROFILE%\Documents\GitHub\cowork-genealogy\` —
  use whichever path you actually cloned to.)
- Windows users: GitHub Desktop installed and signed in. You don't
  need to know git from the command line; the workflow uses the
  GitHub Desktop GUI for resetting state and committing.

## Per case

### 1. Set up the case directory

Download the feedback zip from the dev Drive folder. Then run the
setup helper for your platform:

**macOS / Linux (Terminal):**

```bash
~/cowork-genealogy/scripts/setup-feedback-case.sh \
    ~/Downloads/feedback-2026-05-25T18-22-31.zip
```

**Windows (Command Prompt):**

```bat
%USERPROFILE%\cowork-genealogy\scripts\setup-feedback-case.bat ^
    "%USERPROFILE%\Downloads\feedback-2026-05-25T18-22-31.zip"
```

(Adjust the script path if you cloned the repo somewhere other than
`%USERPROFILE%\cowork-genealogy\`. Run from Command Prompt — not by
double-clicking — so you can see the user prompt the script prints
at the end.)

The script (either platform):

- unzips into `~/feedback/<slug>/` on macOS/Linux, or
  `%USERPROFILE%\feedback\<slug>\` on Windows (slug = the zip basename),
- initializes a git baseline (so you can reset state between
  iterations),
- writes a marker file that tells the workflow skills where your
  repo lives,
- wires per-skill links (symlinks on macOS/Linux, directory junctions
  on Windows) so Claude Code finds both the plugin skills you're
  debugging and the workflow skills,
- prints the user's prompt — copy it to your clipboard.

### 2. Confirm the bug reproduces

Use the exact `cd` and `claude` commands the setup script just
printed (they're already platform-correct). They look like:

```bash
# macOS / Linux
cd ~/feedback/feedback-2026-05-25T18-22-31    # use your case's slug
claude
```

```bat
:: Windows
cd /d "%USERPROFILE%\feedback\feedback-2026-05-25T18-22-31"
claude
```

In Claude Code:

1. Paste the user prompt printed by the setup script.
2. Wait for the agent to finish.
3. Run `/compare-state --against=what-went-wrong`.

The verdict:

- **`matches`** → the bug reproduces. Continue.
- **`does-not-match`** + the agent produced an *acceptable* result →
  the bug is intermittent or already fixed. Note the date and move
  on.
- **`does-not-match`** + the agent did something different but
  still wrong → re-run once (live APIs are noisy). Still wrong?
  Escalate as "user-reported bug that doesn't reproduce locally"
  with a developer.

### 3. Fix the bug — iterate

Repeat until `/compare-state --against=desired` says `matches`:

1. **Edit** the relevant `packages/engine/plugin/skills/<name>/SKILL.md` in your
   repo checkout. (Or an MCP tool source, or a skill template — most
   bugs are SKILL.md prose.) Write to the prose standard in
   [`skill-authoring-guide.md`](skill-authoring-guide.md) — explain the
   *why* behind a fix rather than bolting on another rule.
2. **Reset case state** — discard every change in the case directory
   so it's back at the `imported` baseline the setup script created.

   **macOS / Linux (Terminal, inside the case directory):**
   ```bash
   git checkout . && git clean -fd
   ```

   **Windows (GitHub Desktop):**
   1. Open GitHub Desktop.
   2. On the first iteration only: **File → Add Local Repository →**
      browse to `%USERPROFILE%\feedback\<slug>\` (the case directory
      the setup script created) and add it. GitHub Desktop now lists
      the case directory alongside `cowork-genealogy` in its
      repository picker.
   3. Use the top-left repository picker to select the case directory.
   4. Open the **Changes** tab. You'll see every file the agent
      modified, added, or deleted during the last run.
   5. Click the gear / "⋯" menu at the top of the file list →
      **Discard all changes…** → confirm.
   6. The Changes tab is now empty. The case directory is back at
      the `imported` baseline, ready for the next iteration.
3. **Fresh Claude Code session.** Exit and re-launch, or `/clear`.
   This resets the *conversation* — Claude needs to come at the
   problem fresh, not see its own prior bad reasoning. (SKILL.md
   edits flow into the next invocation automatically; no restart
   needed for that.)
4. **Paste the user prompt** again. (It's at the top of the previous
   `/compare-state` output if you need to grab it.)
5. **Verify:**
   ```
   /compare-state --against=desired
   ```

Each cycle is a fresh session and a fresh state baseline — no
contamination between attempts.

### 4. Promote: scaffold the unit test

When the verdict is `matches`:

```
/draft-unit-test
```

The skill writes a test, a scenario directory, and MCP fixtures into
the main repo (not your case directory). It prints the absolute paths
of every file it wrote and the exact command to run the test next —
copy that command.

### 5. Edit the draft

```bash
cd ~/cowork-genealogy/eval/app && npm run dev
```

Open the URL the dev server prints. Find the new test in the list
(a first cut — the files are schema-clean, so they run as-is). Refine it:

- **Tighten the `judge_context` bullets** so they're specific
  assertions, not vague hopes.
- **Prune the scenario** to the minimum that exhibits the bug.
- **Refine the MCP fixture** `args` predicates and `response`
  placeholders if the auto-extracted values look off.
- **Review the scenario for PII** before committing — the auto-scrub is
  best-effort, so generalize anything that slipped through (names →
  `Person A`, exact dates → decade, specific places → county).

### 6. Run the test

The exact command was printed by `/draft-unit-test`. It looks like:

```bash
cd ~/cowork-genealogy/eval/harness
uv run python run_tests.py --test ut_record_search_004
```

It should pass. If it fails, ask a developer to look at the error
together — the diagnosis is usually a fixture-args mismatch or a
judge-context phrasing the LLM rejected.

### 7. Commit on a feature branch

Don't commit to `main`. Work on a feature branch — a developer will
push it and open the PR when you pair in step 8.

**macOS / Linux (Terminal):**

```bash
cd ~/cowork-genealogy
git checkout -b feedback/2026-05-25T18-22-31    # use your case's timestamp
git add packages/engine/plugin/skills/<name>/ \
        eval/tests/unit/<name>/ \
        eval/fixtures/scenarios/<slug>/ \
        eval/fixtures/mcp/...
git commit -m "fix: <one-line summary of the bug>"
```

**Windows (GitHub Desktop):**

1. In GitHub Desktop, use the top-left repository picker to switch
   to **cowork-genealogy** (not the case directory).
2. Make sure "Current Branch" reads `main`. Then click the
   Current Branch dropdown → **New branch…** → name it
   `feedback/2026-05-25T18-22-31` (use your case's timestamp) →
   base it on `main` → **Create branch**. The Current Branch
   indicator now shows your new branch.
3. The **Changes** tab lists every file you edited *plus* every
   file `/draft-unit-test` created.
4. Tick **only** these and untick anything else:
   - `packages/engine/plugin/skills/<name>/…` (the SKILL.md you edited)
   - `eval/tests/unit/<name>/…` (the new test JSON)
   - `eval/fixtures/scenarios/<slug>/…` (the new scenario directory)
   - `eval/fixtures/mcp/<tool>/<slug>/…` (the new MCP fixtures)
5. In the **Summary** box at the bottom-left, type:
   `fix: <one-line summary of the bug>`
6. Click **Commit to feedback/...**.
7. **Do not click "Push origin"** yet. The developer pushes and
   opens the PR in step 8.

The commit message *is* the lesson — explain what went wrong and
what changed. There's no separate lesson file by design.

### 8. Pair with a developer for the PR

Ping a developer when you're ready. Together you'll:

- Build the plugin `.zip` (`scripts/package-plugin.sh`).
- Re-install it into Cowork (see DEVELOPMENT.md
  § "Deploying a code change to Claude Desktop" — covers both
  macOS and Windows).
- Open the original feedback zip into a *fresh* folder, separate
  from your iteration directory, so Cowork sees the user's
  pristine state.
- Open that fresh folder in Cowork and re-issue the user prompt.
  Confirm the fix holds.
- The developer opens the PR.

The senior genealogist takes it from there.

### 9. Clean up

When the PR is merged, delete both case directories:

- `~/feedback/<slug>/` — your iteration workspace
- `~/feedback/<slug>-cowork-check/` — the fresh unzip from step 8

Use your OS's file manager or any delete method you trust. The
zip stays on the Drive folder as the immutable record.

## Common errors

**`/compare-state` says "Not a feedback-case directory."**
You're not in a directory set up by `setup-feedback-case.sh`. Run
the setup script first, then `cd` into the resulting directory.

**`/compare-state` says feedback.json has empty `<field>`.**
The user's submission was missing a required field. Ask them to
resubmit — that field is required by the submission format
(`cowork-genealogy-ui/docs/feedback-json-spec.md`).

**`/draft-unit-test` can't identify the failing skill.**
Run it as `/draft-unit-test --skill <name>` and pick the skill you
edited.

**`run_tests.py` says `fixture_not_found`.**
Your fix made the agent call a tool the failing transcript didn't.
The harness has no fixture for that call. Ask a developer to add
the fixture under `eval/fixtures/mcp/`.

**`/compare-state --against=desired` keeps saying `partial`.**
Two possibilities:

1. The fix really is incomplete — keep iterating.
2. Live-MCP noise — the same query returns slightly different
   results run to run. Try once more. If it stabilizes, you're
   good; if it oscillates, the rubric may be too tight and you'll
   want a developer's eye on it.

**Setup script says the destination already exists.**
You ran setup on the same zip before. Either delete the old case
directory or pass `--force` to overwrite (the script's commit
history was throwaway anyway).

## When you actually need the spec

The spec is `docs/specs/feedback-case-spec.md`. Read it when:

- You're proposing a change to the workflow itself.
- You're building or maintaining `/compare-state`,
  `/draft-unit-test`, or the setup script.
- You're adding a new skill and need to write its
  `## Re-invocation behavior` section.
- You hit an edge case this page doesn't cover and want to know
  what the contract says.

If you're just triaging a case, this page is enough. The spec is
1000 lines; this page is one screen for a reason.
