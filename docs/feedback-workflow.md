# Feedback case workflow — how to triage a submission

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
- This repo cloned. The walk-through below assumes `~/cowork-genealogy`;
  adjust paths if yours is elsewhere.

## Per case

### 1. Set up the case directory

Download the feedback zip from the dev Drive folder. Then:

```bash
~/cowork-genealogy/scripts/setup-feedback-case.sh \
    ~/Downloads/feedback-2026-05-25T18-22-31.zip
```

The script:

- unzips into `~/feedback/<slug>/` (slug = the zip basename),
- initializes a git baseline (so you can reset state between
  iterations),
- writes a marker file that tells the workflow skills where your
  repo lives,
- wires symlinks so Claude Code finds both the plugin skills you're
  debugging and the workflow skills,
- prints the user's prompt — copy it to your clipboard.

### 2. Confirm the bug reproduces

```bash
cd ~/feedback/feedback-2026-05-25T18-22-31    # use your case's slug
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

1. **Edit** the relevant `plugin/skills/<name>/SKILL.md` in your
   repo checkout. (Or an MCP tool source, or a skill template — most
   bugs are SKILL.md prose.)
2. **Reset case state:**
   ```bash
   git checkout . && git clean -fd
   ```
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
(marked DRAFT). Edit it:

- **Tighten the `judge_context` bullets** so they're specific
  assertions, not vague hopes.
- **Prune the scenario** to the minimum that exhibits the bug.
- **Refine the MCP fixture** `args` predicates and `response`
  placeholders if the auto-extracted values look off.
- **Flip `pii_review_required` to `false`** after you've reviewed
  the scenario for personal data that needs generalizing (names →
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

Don't commit to `main`.

```bash
cd ~/cowork-genealogy
git checkout -b feedback/2026-05-25T18-22-31    # use your case's timestamp
git add plugin/skills/<name>/ \
        eval/tests/unit/<name>/ \
        eval/fixtures/scenarios/<slug>/ \
        eval/fixtures/mcp/...
git commit -m "fix: <one-line summary of the bug>"
```

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
