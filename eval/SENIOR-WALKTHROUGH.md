# Senior Genealogist Walkthrough — reviewing a PR + releasing

> Reviewing a PR end-to-end: read the diff, compare against last released, agree-or-dispute the junior's corrections via PR comments, then release the candidate as the new canonical version. ~10–20 minutes per PR depending on size.
>
> Keep this file open during your first few reviews — every step is referenced here.

## One-time install (Windows)

You'll install three things outside the repo, then run a single batch file inside the repo. Same baseline as the junior walkthrough plus the GitHub CLI for review.

1. **Git for Windows** — <https://git-scm.com/download/win>. Accept the defaults. Optional but recommended: also install **GitHub Desktop** from <https://desktop.github.com/> for clickable repo + branch management.

2. **Node.js LTS** — <https://nodejs.org/> (pick "LTS"). Confirm with `node --version` in a new Command Prompt.

3. **GitHub CLI (`gh`)** — <https://cli.github.com/>. After install, open a new Command Prompt and run `gh auth login` — pick GitHub.com → HTTPS → Login with a web browser. This is what lets you check out PR branches with one command and post PR comments without leaving the terminal.

4. **The repo.** Clone it via GitHub Desktop (File → Clone repository) or:
   ```
   git clone <repo-url> C:\Users\you\genefun\
   ```

5. **Run `eval\Setup.bat`** by double-clicking it. It installs uv, runs `npm install`, runs `uv sync`, and prompts for your Anthropic API key. Get the key from <https://console.anthropic.com/settings/keys> first; format is `sk-ant-...`. The CRUD UI itself doesn't call Anthropic, but if you ever re-run the harness yourself, it'll need this.

You only do all this once per machine.

## One-time install (macOS / Linux)

```bash
# Git: usually pre-installed; if not: brew install git (macOS) / apt install git (Linux)
brew install node                                      # or nvm install --lts
brew install uv                                        # or curl -LsSf https://astral.sh/uv/install.sh | sh
brew install gh                                        # or follow https://cli.github.com/

gh auth login                                          # GitHub.com → HTTPS → web browser

git clone <repo-url> ~/genefun
cd ~/genefun/eval/harness && uv sync
cd ~/genefun/eval/app && npm install
echo "ANTHROPIC_API_KEY=sk-ant-..." > ~/genefun/eval/.env
```

## Each PR review (the daily flow)

## 1. Pull the PR branch locally

**GitHub Desktop:** "Current branch" dropdown at the top → click the search field → "Pull requests" tab → click the PR you want to review. GitHub Desktop checks out the branch for you.

**Terminal:**

```bash
gh pr checkout <pr-number>
# or:
gh pr checkout https://github.com/.../pull/<n>
```

Either way, your local working tree now reflects the junior's branch. The CRUD UI reads from the filesystem, so it sees whatever's on the branch.

## 2. Read the diff on GitHub

Skim the diff for:

- **Skill prompt changes** (`plugin/skills/<skill>/SKILL.md`, templates, references) — does the rewrite reflect what the PR description says it does? Any obvious quality issues (verbose where production needs concise, missing edge case from the rubric)?
- **Test changes** (`eval/tests/unit/<skill>/*.json`) — fair tests, clear inputs, no leakage in `additional_criteria`?
- **Rubric changes** (`eval/tests/unit/<skill>/rubric.md`) — only if the junior had to change grading dimensions to capture something new.
- **Scenario / fixture changes** — usually rare on a per-skill PR. If present, did they affect tests in other skills?

The CI `check-runlogs` action has already verified: ≤1 new released `v{N}.json`, latest run log is active on skill-side files, and its `.ann.json` is complete. If the action is green, you don't have to manually check these.

## 3. Launch the CRUD UI

**Windows:** double-click `eval\Start.bat`. A browser tab opens at <http://localhost:3000>; keep the black command window open while reviewing.

**macOS / Linux:** from `eval/app/`:

```bash
npm run dev
```

Then open <http://localhost:3000/results>. Find the skill the PR touches.

## 4. Read the junior's annotations

Click into their latest candidate run log (the highest `v{N}_<ts>.json`). The detail page shows every test with:

- The full trace (input, scenario state, tool calls + fixture responses, output).
- Each dimension's LLM score, the judge's rationale, the junior's correction, and the junior's comment if they disagreed.

A "reviewed" badge marks each dimension; the header shows `N/N reviewed`. If you see anything other than `N/N`, the PR shouldn't have made it past CI — ping the engineer.

For each test, focus on the dimensions where the junior **disagreed** with the LLM. Those are where their judgment is being exercised. Did they overrule a reasonable judge call? Did they let a bad call stand?

If you'd score a dimension differently from the junior, click the **📋 PR comment** button next to that dimension. It copies a markdown block to your clipboard:

```
**`ut_xxx_001`** — `rubric` / `assertion atomicity`
LLM: 3 → Junior: 2

> [judge's rationale, blockquoted]

Junior: [the junior's comment]
```

Paste it into a GitHub PR comment, add your own reasoning ("I'd actually go with 3 because…"), and submit. That's the entire senior-disagreement channel — no separate UI, no batch review, no statistical gate.

> **Why so lightweight?** Most PRs in steady state have a handful of dispute points at most. A heavyweight review UI would mostly be unused. PR comments are where the discussion needs to live anyway (so the rubric author + other seniors can chime in), so we send disagreements straight there.

## 5. Compare against the last released version

Open `/results/compare`. Pick the skill. The defaults are:

- **Recent**: the latest candidate (the one being released).
- **Previous**: the latest released `v{N-1}.json`.

You'll see:

- **Headline weighted-mean delta.** Tests with edits between the two versions are excluded automatically — only apples-to-apples test scores feed the headline. A `|Δ| < 0.3` advisory tells you the delta is within typical run-to-run variance (the model + judge are nondeterministic). Don't over-read small movements.
- **Histograms per side.** Distribution of 1/2/3 scores. Useful for spotting a shift in *what kind* of failure pattern moved — partial→pass is real progress; pass→fail is a regression.
- **Per-test rows.** Each test's score on both sides + delta. Edited tests show a gray "edited — excluded" badge.
- **What changed panel.** A file-level diff of the two snapshots — exactly which skill files, tests, scenarios, or fixtures moved between the two versions. The 📋 button on a dimension still works from this view if you spot something while comparing.

## 6. Decide: release or push back

**Push back:** Comment on the PR with your specific objections. The junior addresses them and re-pushes; CI re-runs; you come back here. Three rounds is the comfortable ceiling — if you're on round 4, escalate to the senior engineer; something else is going on.

**Release:** Open the latest candidate again in the UI. Click **Release v{N}**. The button is disabled until annotations are complete; the CI check requires the same, so if you got this far it should be enabled.

That rename happens locally: `v{N}_<ts>.json` → `v{N}.json` and the matching `.ann.json`. The UI navigates to the new released run log automatically.

## 7. Commit the release rename

The UI doesn't touch git. Commit + push the rename yourself.

**GitHub Desktop:** the left panel shows the renamed files. Tick the boxes. Summary: `<skill>: release v{N}`. Click "Commit to <branch>" → "Push origin".

**Terminal:**

```bash
git status
# you'll see something like:
#   renamed:    eval/runlogs/unit/<skill>/v3_2026-05-18-10-30-00.json -> eval/runlogs/unit/<skill>/v3.json
#   renamed:    eval/runlogs/unit/<skill>/v3_2026-05-18-10-30-00.ann.json -> eval/runlogs/unit/<skill>/v3.ann.json
#   modified:   eval/runlogs/unit/<skill>/v3.json   (released: false → true)
#   modified:   eval/runlogs/unit/<skill>/v3.ann.json (run_log filename updated)

git add eval/runlogs/unit/<skill>/
git commit -m "<skill>: release v{N}"
git push
```

The CI re-runs and rule 1 now sees one newly-added-or-renamed `v{N}.json` — that's the allowed maximum, so it stays green.

## 8. Approve the PR

**Browser:** open the PR on GitHub → "Files changed" tab → click "Review changes" → "Approve" → "Submit review".

**Terminal:**

```bash
gh pr review --approve --body "Release v{N} of <skill>."
```

The project owner merges. Done.

## When something's wrong

- **The release button is greyed out** — annotations aren't complete. Re-check the header counter. If it's complete but the button is still disabled, refresh the page (the active-state recompute is per request and can lag a save).
- **Compare shows an unexpected regression** — open the trace on the regressed test before jumping to "this PR is bad." Sometimes the model just happens to pick a different (still valid) approach, the judge marks one wrong, and the corrected scores would actually agree. If the regression is real, push back on the PR with the specific test ID and the trace excerpt.
- **The judge prompt changed since the last release** — you'll see a "judge prompt changed since this run" warning in the active badge. This is a warn-only signal. The numbers in the run log were scored against an older judge; a re-run would likely produce slightly different scores. Use your judgment — if the corrected scores look reasonable to you on inspection, release; if you're not sure, ask the junior to re-run.
- **You want to release a candidate that isn't the latest.** Activate the older candidate first (overwrites repo files from its snapshot, including SKILL.md frontmatter and the `model:` field). Then release that one. The newer candidate is still on disk and can be deleted (or kept as history) from its detail page.

## Cadence

Per `docs/plan/per-pr-review-workflow.md`: target 1 business day from PR open to senior response. If you're over capacity, escalate to the senior volunteer pool (see `docs/eval-rollout.md` for current names). If a PR sits for >2 days, the senior engineer takes it.

## What you don't do

- **You don't correct scores yourself.** The junior's corrections are the team's signal; your disagreements live in PR comments, not in the `.ann.json`. (One exception: if a correction is plainly mechanical — a typo in the comment, a swapped score — feel free to fix it in-line and note "fixed in-line" on the PR. Reserve this for unambiguous cases.)
- **You don't run the harness.** Re-running consumes API credits and time; if the run log on the branch is fine for evaluation, leave it. If you genuinely think a re-run is needed (you see a flaky pattern, the snapshot looks wrong), ask the junior to re-run.
- **You don't merge.** The project owner does the actual merge. Your job ends at approval.

## Files you'll touch

Only one: the run-log + annotation rename that the Release button produces, which you commit + push. Nothing else.
