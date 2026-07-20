# Alpha feedback guide — how to triage a submission

You have a user feedback zip and you need to fix the bug and lock the fix
in with a regression test. This page is the step-by-step for the part
that's specific to a **feedback zip**: unpacking it, reproducing the bug,
and iterating on a fix against the user's own project state.

**Three companion docs, and when to reach for each:**

| Doc | What it gives you |
|---|---|
| [`alpha-feedback-example.md`](alpha-feedback-example.md) | The same flow as one **worked story**, start to finish. Read this first if you've never done it. |
| [`skill-lifecycle.md`](skill-lifecycle.md) | What happens **after** you have a fix: mine the test, run it, annotate, improve, gate, release. Shared with every other on-ramp — this page hands off to it at step 4. |
| [`specs/feedback-case-spec.md`](specs/feedback-case-spec.md) | The **why**: rationale, contracts, lints. Read only when changing the workflow itself. |

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

**Make your branch first.** The setup script stamps a marker with your
checkout *as it is when you run it*, and the test you mine later lands on
whichever branch is checked out then. Run setup while still on `main` and
your test ends up on `main`.

```bash
cd ~/cowork-genealogy && git checkout -b feedback/2026-05-25T18-22-31
```

Windows (GitHub Desktop): Current Branch → **New branch…** → base it on
`main` → **Create branch**.

Then download the feedback zip from the dev Drive folder and run the setup
helper for your platform:

**macOS / Linux (Terminal):**

```bash
make feedback-case ZIP=~/Downloads/feedback-2026-05-25T18-22-31.zip

# or call the script directly:
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

### 4. Promote the fix into a regression test

When the verdict is `matches`:

```
/draft-unit-test
```

The skill writes a test, a scenario directory, and MCP fixtures into the
**main repo** (not your case directory — it finds the repo via the
`.feedback-repo-root` marker). It prints the absolute paths of every file it
wrote and the exact command to run the test next — copy that command.

> **Scrub the scenario for PII before you commit it.** This is the one step
> unique to feedback cases and the reason they can't be treated like any
> other test source: the scenario is carved from a **real person's research**.
> The auto-scrub is best-effort. Open the scenario and generalize anything
> that slipped through — names → `Person A`, exact dates → the decade,
> specific places → the county. A committed test lives in the repo forever.

### 5. From here, follow the standard loop

Everything after this point is the same regardless of where the bug came
from, so it lives in one place:

**→ [`skill-lifecycle.md`](skill-lifecycle.md)**

It covers: refining the draft in the CRUD UI, running the skill's tests,
annotating the failing dimension, auditing the rubric, improving the
`SKILL.md` body, gating the edit, and producing the release run the PR
needs. Two things there are easy to skip and will fail CI if you do —
grading **every** dimension, and doing a **full run after** your skill edit
so the committed run log matches the edited skill.

Come back here for step 6 when the PR is ready.

### 6. Commit on your branch

Don't commit to `main`. If you didn't already make a branch in step 1, make
one now.

**macOS / Linux (Terminal):**

```bash
cd ~/cowork-genealogy
git checkout -b feedback/2026-05-25T18-22-31    # use your case's timestamp
git add packages/engine/plugin/skills/<name>/ \
        eval/tests/unit/<name>/ \
        eval/fixtures/scenarios/<slug>/ \
        eval/fixtures/mcp/ \
        eval/runlogs/unit/<name>/
git commit -m "fix: <one-line summary of the bug>"
```

**Windows (GitHub Desktop):**

1. Use the top-left repository picker to switch to **cowork-genealogy**
   (not the case directory).
2. Current Branch dropdown → **New branch…** → name it
   `feedback/2026-05-25T18-22-31` (use your case's timestamp) → base it on
   `main` → **Create branch**.
3. The **Changes** tab lists every file you edited *plus* everything
   `/draft-unit-test` and the test run created.
4. Tick **only** these and untick anything else:
   - `packages/engine/plugin/skills/<name>/…` — the SKILL.md you edited
   - `eval/tests/unit/<name>/…` — the new test JSON
   - `eval/fixtures/scenarios/<slug>/…` — the new scenario directory
   - `eval/fixtures/mcp/<tool>/<slug>/…` — the new MCP fixtures
   - `eval/runlogs/unit/<name>/…` — the run log **and** its `.ann.json`
5. In the **Summary** box, type: `fix: <one-line summary of the bug>`
6. Click **Commit to feedback/…**.
7. **Do not click "Push origin"** yet — a developer pushes and opens the PR
   with you in step 7.

The commit message *is* the lesson — explain what went wrong and what
changed. There's no separate lesson file by design.

### 7. Pair with a developer for the PR

Ping a developer when you're ready. Together you'll open the PR and confirm
the fix holds. If you want to see it working in the real product first, the
worked example shows how — replay the case folder against your edited skill
and check it with `/compare-state --against=desired`
([`alpha-feedback-example.md`](alpha-feedback-example.md) step 8).

The senior genealogist reviews and merges.

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
(`apps/electron/docs/feedback-json-spec.md`).

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
