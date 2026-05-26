# Feedback Case Workflow Specification

**Project:** Cowork Genealogy — an AI genealogy research assistant
**Scope:** Developer/genealogist workflow for turning end-user feedback
submissions into permanent unit tests. Distinct from the unit-test
regression framework in `eval/harness/`.

---

## 1. Overview

End users submit feedback through the Electron viewer when an agent
turn produces a bad result. Each submission is a zip containing the
user's full project folder at the moment of failure plus a structured
description of what they asked, what the agent did, and what it should
have done. Submissions land in a Google Drive folder accessible to
the dev team. The submission format is specified in
[`feedback-json-spec.md`](./feedback-json-spec.md).

This document specifies the **iteration workflow** a dev or
genealogist follows to turn one of those submissions into a fix plus
a regression test. Earlier drafts of this spec proposed a Python
"workbench" with import/run/promote CLI commands; that was over-
engineered for the actual job and has been dropped. The workflow now
uses Claude Code as the iteration environment, with two purpose-built
Claude Code skills doing the rubric matching and test scaffolding.

### What this workflow is

- A **bug-reproduction** loop. Each case is one user-reported failure
  with a complete state fixture.
- An **iteration aid**. Make it cheap to edit a SKILL.md, MCP tool,
  or prompt, and see whether the output got closer to what the user
  wanted.
- A **funnel into the unit-test layer**. The durable artifact is a
  unit test in `eval/tests/unit/`, plus a lesson commit message
  explaining the fix. The case fixture itself is ephemeral.

### What this workflow is not

- Not a regression suite. Cases are *current* failures; there is no
  known-good baseline.
- Not a replacement for `eval/harness/`. The unit-test harness keeps
  doing its job — versioned run logs, LLM judge, CRUD UI, CI gating.
- Not a place for end-user data in the public repo. Unzipped cases
  are gitignored.

### Quickstart

For people who have read this spec once and want the commands.
Assumes the repo is checked out at `~/cowork-genealogy` (adjust
paths if yours is elsewhere).

```bash
# One-time per machine: have the MCP server registered in Claude
# Code, and tokens in ~/.familysearch-mcp/.

# Per case (junior genealogist):
~/cowork-genealogy/scripts/setup-feedback-case.sh \
    ~/Downloads/feedback-2026-05-25T18-22-31.zip
cd ~/feedback/feedback-2026-05-25T18-22-31

claude                                          # launch Claude Code
# >>> paste user_prompt (printed by setup script's next-steps output)
/compare-state --against=what-went-wrong        # confirm repro

# Iterate (one cycle):
# 1. Edit plugin/skills/<skill>/SKILL.md (or MCP tool source).
# 2. Reset case state:
git checkout . && git clean -fd
# 3. Fresh Claude Code session (exit + relaunch, or /clear) —
#    resets conversation context; SKILL.md edits already flow live.
# 4. Paste user_prompt again (it's at the top of /compare-state's
#    output from the previous iteration).
# 5. Verify:
/compare-state --against=desired
# Repeat 1-5 until /compare-state says "matches".

# Promote:
/draft-unit-test                                # scaffold test + scenario + fixtures
# - the skill prints the absolute paths of every file it wrote AND
#   the exact run_tests.py command to run next.
# - edit drafts via the eval/app/ CRUD UI (flip pii_review_required → false)
# - run the test once to confirm it passes (§3.4 step 14):
cd ~/cowork-genealogy/eval/harness
uv run python run_tests.py --test <ut_… id printed by /draft-unit-test>
# - commit fix + test on a feature branch named feedback/<timestamp>:
cd ~/cowork-genealogy
git checkout -b feedback/<timestamp>

# Then pair with a developer to open the PR (§3.5 step 16). The
# developer builds the plugin .zip, installs it into Cowork, and
# walks through the fresh-unzip Cowork verification with you.
# Senior genealogist reviews the PR.

# Finally: delete both directories using your OS's file manager
# (or terminal if you prefer). For the example slug above, that's:
#   ~/feedback/feedback-2026-05-25T18-22-31/
#   ~/feedback/feedback-2026-05-25T18-22-31-cowork-check/
# (the second directory is the case slug + `-cowork-check` suffix)
```

Each command is explained in §3. The skills are specified in §4.
The re-invocation contract that makes step `git checkout .`-and-re-run
safe is in §5. The setup helper script is specified in §11.

---

## 2. Relationship to `eval/harness/`

| | Unit-test layer (`eval/harness/`) | Feedback workflow (this spec) |
|---|---|---|
| **Purpose** | Regression / quality bar | Iteration on current failures |
| **Source** | Authored by genealogists | Submitted by end users |
| **State fixture** | `eval/fixtures/scenarios/` (small, shared) | Full user project (large, per-case) |
| **MCP tools** | Mocked via `eval/fixtures/mcp/` | Real (live API) |
| **Grading** | LLM judge w/ rubric, scored 1–3 per dimension | Two Claude Code skills compare state against the user's prose |
| **CI?** | Yes (`check-runlogs.yml`) | No |
| **In repo?** | Yes (`eval/tests/`, `eval/runlogs/`) | No — unzipped cases are gitignored; Drive is source of truth |

A fixed case becomes a unit test. The flow is one-way: feedback case
→ root cause → unit test → discard case fixture.

---

## 3. Workflow

The workflow runs entirely in Claude Code, against an unzipped case
folder on your machine. There is no per-case database, no `case.json`,
no archived `attempts/`, no CLI. Each step is a manual action; the
two skills in §4 supply the AI-assisted parts.

### Roles

Three roles share the workflow:

- **Junior genealogist** owns the bulk of the loop: setup, repro,
  iteration, test scaffolding, commit (§3.1–§3.4).
- **Developer** pairs with the junior at PR time to build and install
  the plugin artifacts, run the Cowork verification, and open the
  PR (§3.5). Also called in if pytest errors during scaffolding are
  unclear (§3.4) or if a missing MCP fixture needs creating.
- **Senior genealogist** reviews the PR — skill changes and rubric
  quality — and approves the merge. Not represented as a numbered
  step here because PR review is a separate process.

A junior genealogist working solo can complete §3.1–§3.4 without
help and shouldn't be blocked at §3.5: just queue the case for the
next pairing session with a developer. The spec is explicit about
where developer help is expected so juniors don't try to push past
their comfort zone alone.

### 3.1 Setup (once per case)

1. **Download** the feedback zip from the Drive folder.
2. **Run the setup helper:**
   ```bash
   ~/cowork-genealogy/scripts/setup-feedback-case.sh \
       ~/Downloads/feedback-<timestamp>.zip
   ```
   (Replace `~/cowork-genealogy` with wherever you have this repo
   checked out, if different.)
   The script unzips into `~/feedback/<slug>/`, initializes a
   git baseline, writes `.feedback-repo-root` (so
   `/draft-unit-test` can locate the main repo), wires per-skill
   symlinks for plugin + workflow skills, and prints the user's
   prompt for first-paste. **§11 is the single source of truth**
   for what the script does and why. If you're doing it by hand
   (no script available, debugging the script, etc.), follow §11
   step-by-step.
3. **Confirm MCP server is registered** in your Claude Code
   settings (one-time per machine, not per case). The
   genealogy MCP tools (`familysearch_login`, `record_search`,
   `tree_read`, etc.) must be available in the iteration session.
   See repo `README.md` for the install steps.

### 3.2 Reproduce (confirm the bug actually happens)

4. **Launch Claude Code** in the case directory:
   ```bash
   cd ~/feedback/<slug>
   claude
   ```
5. **Issue the user's prompt** verbatim. It was printed at the end
   of the setup script's output; you can also find it in
   `_feedback/feedback.json::user_prompt`.
6. **Confirm repro.** Once Claude has produced output:
   ```
   /compare-state --against=what-went-wrong
   ```
   The skill (§4.1) reads `_feedback/feedback.json::agent_did`,
   compares it against the current state of `research.json`,
   `tree.gedcomx.json`, and any new `results/log_NNN.json` sidecars,
   and tells you whether the same failure happened.

   - **If yes:** continue to §3.3.
   - **If no, but you got a different bad result:** the failure is
     non-deterministic (live API noise, model variance). Run again.
     If it still doesn't reproduce, escalate as "user-observed bug
     that doesn't reproduce locally" — separate investigation path.
   - **If you got an *acceptable* result:** the bug is intermittent
     or already fixed. Note the date and move on.

### 3.3 Iterate (fix it)

7. **Edit.** Modify the relevant `plugin/skills/<skill>/SKILL.md`,
    MCP tool source, or anything else likely to be the cause.
8. **Reset state.**
    ```bash
    git checkout . && git clean -fd
    ```
    `git checkout .` restores tracked files; `git clean -fd` removes
    untracked files (new `results/log_NNN.json` sidecars created
    during the iteration, new GedcomX person files, etc.). Without
    `git clean -fd` those untracked leftovers survive into the next
    iteration and defeat the whole baseline-reset idea.

    The setup script writes a `.gitignore` into the case directory
    listing `.claude/`, so `git clean -fd` (without `-x`) leaves the
    skill symlinks alone. Do **not** use `git clean -fdx`; that would
    also remove `.claude/skills/` and force a re-run of setup.
9. **New Claude Code session.** Exit the current session (or
    `/clear`). This resets the **conversation context** so the agent
    doesn't see its own prior bad reasoning — that contamination is
    the thing being cleared. SKILL.md edits don't need a session
    reset (see §4 "Skill reload"); the conversation does.
10. **Re-issue the user's prompt.**
11. **Verify the fix.**
    ```
    /compare-state --against=desired
    ```
    The skill reads `_feedback/feedback.json::agent_should_have` and
    compares state against the desired outcome.

    - **If acceptable:** continue to §3.4.
    - **If not:** go back to step 7.

### 3.4 Promote (lock in the fix)

This section uses several terms from the existing eval framework.
Brief glossary:

| Term | What it is |
|---|---|
| **Scenario** | The starting state a test runs against. A directory under `eval/fixtures/scenarios/` containing `research.json`, `tree.gedcomx.json`, `README.md`. |
| **Fixture** | A pre-canned MCP tool response, stored as a file under `eval/fixtures/mcp/`. The harness matches tool calls to fixtures by tool name + an `args` predicate. |
| **Predicate** | A pattern in a fixture's `args` block. `~Schuylkill` means "contains the substring Schuylkill"; `=Ohio` means "equals Ohio." |
| **Rubric** | Per-skill grading criteria in `eval/tests/unit/<skill>/rubric.md`. Lists named dimensions, each with pass/partial/fail bullets. Authored by senior genealogists; this workflow does **not** edit it. |
| **`judge_context`** | Per-test background bullets the LLM judge reads alongside the rubric. Not scored — just context for the judge. |
| **Harness** | The Python framework at `eval/harness/` that runs unit tests, mocks MCP, and invokes the LLM judge. |

Ask a developer if any of these are unclear in context.

12. **Scaffold a unit test.** From the case directory:
    ```
    /draft-unit-test
    ```
    The skill (§4.2) reads `_feedback/feedback.json::agent_should_have`,
    the current state, and the recent transcript, and produces (in
    the main repo at the path stored in `.feedback-repo-root`):
    - `eval/tests/unit/<skill>/<slug>.json` — the test JSON, marked DRAFT
    - `eval/fixtures/scenarios/<slug>/` — scenario directory
      (`README.md`, `research.json`, `tree.gedcomx.json`)
    - `eval/fixtures/mcp/<fixture-name>.json` (one or more) — MCP
      fixture files keyed by (tool, args predicate)

    The per-skill `rubric.md` is **not** regenerated; the
    re-invocation contract (§5) is carried by SKILL.md prose +
    the §9 step 7 lint, not by an auto-generated validator. Full
    output spec in §4.2.
13. **Edit the draft** via the existing CRUD UI in `eval/app/`.
    Launch it with:
    ```bash
    cd ~/cowork-genealogy/eval/app && npm run dev
    ```
    then open the URL the dev server prints. The new test appears
    in the unit-tests list, marked DRAFT. In the UI: tighten the
    test's `judge_context` bullets, prune the scenario to the
    minimum that exhibits the failure, refine the fixture `args`
    predicates and `response` placeholders. Flip
    `pii_review_required` to `false` after reviewing.

    **Fixture-coverage gap to watch for.** The skill emitted
    fixtures for the tools the *failing* agent called. If the fix
    causes the agent to call a tool the failing transcript didn't
    (a different search tool, an extra place lookup, etc.), the
    unit test will fail at step 14 with a `fixture_not_found`
    error. The harness never falls through to a live API. **Ask a
    developer to add the missing fixture** — fixture authoring
    requires knowing the tool's `args` matching semantics and the
    response shape, which isn't something junior genealogists need
    to learn.
14. **Run the test to confirm it passes.** `/draft-unit-test` prints
    the exact command to run when it finishes — copy-paste it. The
    command is of the form:
    ```bash
    cd ~/cowork-genealogy/eval/harness
    uv run python run_tests.py --test ut_<skill>_NNN
    # e.g.: uv run python run_tests.py --test ut_record_search_004
    ```
    Note: working directory is `eval/harness/`, not the repo root,
    and the invocation includes `python` between `uv run` and the
    script name. The `--test` selector takes the test's `ut_…` id
    (printed by `/draft-unit-test`), not the case slug — this is
    more reliable than pytest `-k` matching on tags. This is the
    only test invocation the workflow requires. If it fails, work with a
    developer to diagnose — usually it's a fixture-args mismatch
    or a rubric phrasing the LLM judge rejected. **No "trip-check"
    against pre-fix code** is part of this workflow: confirming
    the test would have caught the original failure is the senior
    genealogist's job at PR review, not a step you run locally.
    The git-stash flip-flop that a per-case trip-check requires is
    the most error-prone action in any version of this spec and is
    deliberately omitted.
15. **Commit on a feature branch.** First, create a feature branch
    so you don't commit directly to `main`. The branch is named
    after the timestamp portion of the slug (the slug already
    starts with `feedback-`, so embedding it again is awkward):
    ```bash
    cd ~/cowork-genealogy
    git checkout -b feedback/<timestamp>     # e.g. feedback/2026-05-25T18-22-31
    ```
    Then commit the fix (SKILL.md and/or MCP tool changes) and the
    unit test in a single commit. The commit message explains what
    went wrong and what changed — this *is* the lesson; no separate
    lesson file is needed because the test and the commit history
    together carry the durable record.

### 3.5 Cowork double-check

16. **Pair with a developer to verify in Cowork and open the PR.**
    This is the only step that requires a developer alongside you.
    Split into two sub-steps for clarity:

    **16a. Developer prep — build and install the plugin into Cowork.**
    The developer runs these commands; you read along.
    ```bash
    # Build the plugin .zip from the main repo. (No .mcpb build
    # needed unless the fix touched mcp-server/src; the developer
    # handles that case if it applies.)
    cd ~/cowork-genealogy
    scripts/package-plugin.sh

    # Re-install the plugin .zip into Cowork. See `DEVELOPMENT.md`
    # § "Deploying a code change to Claude Desktop" for the install
    # steps (covers macOS and Windows).
    ```

    **16b. Paired verification — confirm the fix in Cowork.**
    Both of you, together:
    ```bash
    # Unzip the original feedback zip into a FRESH folder, separate
    # from the iteration directory, so Cowork sees the pristine
    # user state.
    mkdir -p ~/feedback/<slug>-cowork-check
    unzip -d ~/feedback/<slug>-cowork-check ~/Downloads/feedback-<timestamp>.zip
    ```
    Open `~/feedback/<slug>-cowork-check/` in Cowork as a project
    folder. You re-issue the user's prompt verbatim. Both of you
    confirm the fix holds.

    No symlinks, no `.claude/skills/`, no git baseline — Cowork
    loads from its installed plugin bundle, so the fresh unzip is
    all it needs. If Cowork's UI doesn't directly support opening
    an existing folder, follow Cowork's workspace-creation flow and
    copy `research.json`, `tree.gedcomx.json`, `results/`, and any
    other top-level project files into the new workspace.

    If the fix doesn't hold in Cowork, see §6.1 — the bug may be
    Cowork-runtime-specific (plugin loader, viewer context
    injection, OS-specific file handling). Diagnose with the
    developer; do not ship the PR.

    Once Cowork verification passes, the developer opens the PR.
    The senior genealogist reviews skill changes, rubric quality,
    and the new unit test before approving the merge.
17. **Discard the case.** When you're done, delete both case
    directories — `~/feedback/<slug>/` (the iteration directory)
    and `~/feedback/<slug>-cowork-check/` (the fresh unzip from
    step 16). Use whatever method you're comfortable with: your
    OS's file manager, or terminal commands you trust on your
    platform. The spec deliberately doesn't ship a `rm -rf` line
    — both directories live under `~/feedback/` and accidentally
    deleting the wrong thing is too easy to recover from a typo.
    Both are local-only; the Drive copy of the zip remains as the
    immutable source of truth, so re-importing later is always
    possible.

---

## 4. Skills

> **For workflow runners:** If you're running a case, §3 is all you
> need. §4–§11 are reference material for people building or
> debugging the skills, scripts, lints, and contracts.

Two skills support the workflow. Both are **Claude Code skills**,
not Cowork plugin skills — they live in this repo's `.claude/skills/`
directory and don't ship in the Cowork plugin bundle.

**Discovery.** Claude Code auto-discovers skills in
`<cwd>/.claude/skills/` and `~/.claude/skills/`. When Claude Code
runs in the case directory (the workflow's normal pose), it sees
these two skills only because the setup script wired a per-skill
symlink into `<case>/.claude/skills/` (§11 step 7). A Claude Code
session started in a directory that wasn't bootstrapped by the
setup script will not find `/compare-state` or `/draft-unit-test`.

**Skill format.** Each skill is a `SKILL.md` file with YAML
frontmatter (`name`, `description`, optionally `allowed-tools`)
followed by Markdown instructions Claude reads on invocation. The
"Algorithm" subsections below describe the **prose instructions**
Claude follows when the skill is invoked — they are not code that
runs separately, and there is no Python process behind the skill.
When Claude is told to "read a file" or "validate a field", it
uses its own tools (Read, Bash, etc.). See the [Claude Code skills
docs](https://docs.claude.com/claude-code/skills) for the
canonical format.

**Skill reload.** Edits to a SKILL.md file flow into the next
`/skill` invocation in the same Claude Code session — no restart
or `/clear` is needed for the skill *content* to be re-read.
(Confirmed against the [Claude Code skills
docs](https://docs.claude.com/claude-code/skills): files are
re-read at each invocation, not cached after first read.) The
fresh-session requirement in §3.3 step 9 is about
**conversation-context** cleanliness — a separate concern from
skill reload, addressed there.

### 4.1 `/compare-state`

**Purpose.** Read the current state of the case folder
(`research.json`, `tree.gedcomx.json`, `results/log_*.json`) and
compare it against a prose specification from
`_feedback/feedback.json`. Report whether the state matches.

**Invocation.**

```
/compare-state --against=what-went-wrong
/compare-state --against=desired
```

The `--against` flag picks which field of `_feedback/feedback.json`
serves as the comparison target:

- `what-went-wrong` → `agent_did` (used in §3.2 to confirm repro)
- `desired` → `agent_should_have` (used in §3.3 to verify fix)

**Algorithm.**

1. Read `_feedback/feedback.json`. **Validate** that the file
   exists, parses, and that the target field (`agent_did` for
   `--against=what-went-wrong`, `agent_should_have` for
   `--against=desired`) is present and non-empty. On any failure,
   abort with a message that names the specific field and points
   you at `docs/specs/feedback-json-spec.md` §3. The skill is
   the first command you run; surfacing a bad case fixture
   here is much better than a downstream LLM call producing
   nonsense.
2. Read the case directory's state files. Specifically: every file
   that has a `git diff` against the baseline commit, plus the
   current `research.json` and `tree.gedcomx.json` regardless of
   diff.
3. Send a single LLM call with the target prose and the state
   diff. Prompt asks: "Does the state match this description?
   Identify specific discrepancies."
4. Output a structured verdict:
   - `matches` | `partial` | `does-not-match`
   - Bullet list of specific points (which timeline entries are
     present, which sources, which proof summaries; what's missing
     or different).

**Output format.** Markdown in the Claude Code session — no file
artifacts. The first line of output is
`**User prompt:** <user_prompt verbatim>`, so you have a stable
buffer to copy from when starting the next iteration without having
to re-open `_feedback/feedback.json`. Then the verdict and bullets.
You read the verdict and decide what to do.

**Cost.** One LLM call per invocation. Sonnet 4.6.

### 4.2 `/draft-unit-test`

**Purpose.** Generate a first-cut unit test plus its supporting
scenario and fixture, in the shape the existing unit-test framework
expects. Output is DRAFT; you edit via the CRUD UI before
committing.

**Invocation.**

```
/draft-unit-test [--skill <skill-name>]
```

If `--skill` is omitted, the skill infers which Cowork plugin skill
failed by inspecting the tool calls in the most recent transcript.

**Repo-root resolution.** `/draft-unit-test` runs from the case
directory (`~/feedback/<slug>/`) but writes its outputs into the
main repo (`<repo>/eval/...`). The setup script (§11) writes
`.feedback-repo-root` into the case directory; its contents are
the absolute path of the main repo. The skill reads this file
**first**; if it's missing or the path doesn't exist, the skill
aborts with: "No `.feedback-repo-root` found. This skill must run
in a case directory created by `scripts/setup-feedback-case.sh`.
See `docs/specs/feedback-case-spec.md` §11."

**Algorithm.**

1. Read `.feedback-repo-root` to find `<repo>`. Abort cleanly on
   missing/invalid (above).
2. Identify the failing skill (from `--skill` or by inspecting the
   recent transcript's tool calls — pick the skill whose
   `allowed-tools` overlap most with the tools the agent actually
   called).
3. Read `_feedback/feedback.json::agent_should_have` (the user's
   prose desired-behavior) and the current case-folder state plus
   recent transcript to identify which entities (persons, places,
   sources, plans) the failure involved.
4. **Extract a scenario.** Generate three files under
   `<repo>/eval/fixtures/scenarios/<slug>/`:
   - `README.md` — one paragraph describing the scenario and which
     bug it captures. References the case's `<slug>` and
     `submitted_at` for traceability.
   - `research.json` — minimal project state limited to the
     entities the failure touched. **Best-effort PII scrub:** names
     replaced with placeholders (`Person A`, `Person B`), specific
     dates rounded to the decade, place names generalized. The
     scrub is heuristic and unreliable for genealogy data
     specifically — historical ancestor names look indistinguishable
     from living-person names, and the model cannot tell which is
     which without external lookups. The dev's CRUD-UI edit pass
     (workflow step 13) is the real PII gate, not this step.
   - `tree.gedcomx.json` — minimal GedcomX, same scrub rules.
   The scrubbed scenario also carries a `pii_review_required: true`
   marker in `research.json` under a top-level `_draft` block; the
   CRUD UI surfaces it and **must** refuse to commit the scenario
   until you flip it to `false` after reviewing.
5. **Emit the test JSON** at
   `<repo>/eval/tests/unit/<skill>/<slug>.json`. Shape mirrors the
   existing tests in that directory:
   ```json
   {
     "test": {
       "id": "ut_<skill_with_underscores>_NNN",
       "skill": "<skill>",
       "name": "<one-line summary derived from agent_should_have>",
       "type": "positive",
       "description": "<2-3 sentence draft summarizing the failure mode and what the skill should do instead>",
       "tags": ["from-feedback", "<slug>", "re-invoke-safe"]
     },
     "input": {
       "user_message": "<user_prompt verbatim from feedback.json>",
       "scenario": "<slug>"
     },
     "judge_context": [
       "<one bullet per concrete behavior the skill should exhibit, derived from agent_should_have>",
       "..."
     ],
     "_draft": {
       "pii_review_required": true,
       "todo": [
         "Tighten judge_context bullets to specific assertions",
         "Confirm scenario captures the failure mode",
         "Review fixture args predicates"
       ]
     }
   }
   ```
   `NNN` is the next unused integer for that skill (scan existing
   `ut_<skill>_*` ids, pick `max + 1`, zero-pad to three digits).
   `judge_context` is background for the LLM judge, not a scored
   dimension — the rubric is per-skill (see step 7).
6. **Emit MCP fixtures.** For every distinct (tool, args-pattern)
   the failing agent called, write
   `<repo>/eval/fixtures/mcp/<fixture-name>.json` in the canonical
   shape:
   ```json
   {
     "tool": "<tool name from session-log.jsonl>",
     "description": "<short description for the reader — include <slug> for traceability>",
     "args": { "<arg>": "<predicate, e.g. ~Schuylkill>" },
     "input_schema": { "...": "..." },
     "response": { "<placeholder for dev>": "..." }
   }
   ```
   **Naming convention.** `<fixture-name>` is
   `<tool-short>-<descriptive-suffix>` matching existing
   `eval/fixtures/mcp/` files (e.g. `record-search-flynn-no-results.json`,
   `wiki-search-irish-immigration.json`). The skill derives
   `<tool-short>` from the tool name (dropping any
   `mcp__genealogy__` prefix and converting underscores to hyphens)
   and `<descriptive-suffix>` from the most-distinctive args value
   (a place name, person name, or query keyword), lowercased and
   hyphenated. Before writing, the skill scans existing
   `eval/fixtures/mcp/` files and uses **its own judgment** to
   decide whether an existing fixture's args predicate covers the
   call already — if it does, reuse the existing filename in the
   test's `judge_context` rather than emitting a duplicate. If the
   model is unsure or two fixtures look similar but might differ,
   write a new file with a `-2`/`-3` suffix and let you
   consolidate during the step 13 CRUD-UI review. Don't over-spec
   matching rules — you see and adjust.

   Pull `args` and `response` shapes from `session-log.jsonl` where
   present; otherwise emit placeholders you fill in. Skip
   `validate_research_schema` — it reads workspace state directly
   and is the only live tool in the harness; everything else needs
   a fixture.
7. **Do NOT generate or modify `rubric.md`.** The per-skill rubric
   at `<repo>/eval/tests/unit/<skill>/rubric.md` is the grading
   contract for all tests of that skill; it's opt-in and edited by
   the skill author by hand. The `judge_context` bullets in the
   test JSON carry per-test specifics.
8. **Re-invoke assertion.** Leave the `re-invoke-safe` tag in
   place (already shown in step 5) as metadata for future use, but
   do **not** auto-generate a per-skill validator. The
   re-invocation contract is enforced by:
   - the prose `## Re-invocation behavior` section in each SKILL.md
     (per §5 of this spec), and
   - the lint in §9 step 7 that confirms every SKILL.md carries
     that section.

   Generating Python validator code from a SKILL.md prose
   description is a place this skill would frequently be wrong;
   your manual check on the fix-applied iteration loop (§3.3
   step 11 — does the agent build on its own prior work cleanly?)
   covers the same ground at much lower risk. If a particular
   skill has complex write semantics worth automated regression
   testing, a developer adds the validator by hand as a normal
   eval-framework change — outside this workflow.
9. **Print output paths and the run command.** As the last thing
   the skill does, print to the Claude Code session:
   - The absolute path of every file written (test JSON, scenario
     `README.md`/`research.json`/`tree.gedcomx.json`, every MCP
     fixture). You're running from the case directory and won't
     see new files there — they're all in the main repo.
   - The exact command to run §3.4 step 14, with the assigned
     `ut_…` id substituted in:
     ```
     cd ~/cowork-genealogy/eval/harness
     uv run python run_tests.py --test <assigned ut_… id>
     ```
   Both are one-line printouts. Copy-paste-friendly.

**Output files.**

- `<repo>/eval/tests/unit/<skill>/<slug>.json` — the test (per
  step 5 above).
- `<repo>/eval/fixtures/scenarios/<slug>/README.md`, `research.json`,
  `tree.gedcomx.json` — the scenario directory (per step 4).
- `<repo>/eval/fixtures/mcp/<fixture-name>.json` (one or more) —
  fixtures (per step 6).

`/draft-unit-test` does NOT modify `rubric.md`, does NOT touch any
`eval/harness/validators/` file, and does NOT touch anything inside
the case directory.

**Verification.** Performed by you outside this skill, per §3.4
step 14 (single `run_tests.py --test` invocation against the fixed
code; no trip-check against pre-fix code).

**Cost.** Two or three LLM calls per invocation (skill inference,
scenario extraction + scrub, test JSON authoring). Sonnet 4.6.

---

## 5. Skill re-invocation contract

The case fixture in the zip is the project state **immediately after
the failed agent run**. The pre-failure state is not captured. Each
iteration of §3.3 therefore runs the prompt against state that may
already contain partial or incorrect work from the original failure.

This is irreducible — we cannot synthesize pre-failure state from
the zip alone. A viewer-side workaround (continuous pre-action
snapshots) was considered and rejected; see `feedback-json-spec.md`
§7.1 for the analysis.

The mitigation is a **skill contract**: every SKILL.md in
`plugin/skills/` must be safe under repeated invocation against
state containing its own prior output. "Safe" specifically means:

- The skill produces a sensible result rather than an error.
- The skill does not duplicate entries that semantically already
  exist; instead it either supersedes the prior entry (e.g. mark
  the old `plan_` `superseded` and write a new one — see
  `docs/specs/research-schema-spec.md` §6) or refines in place.
- The skill detects and reports when it sees prior work from itself,
  so the model has context for deciding whether to extend or replace.

**Required SKILL.md section.** Every `plugin/skills/<skill>/SKILL.md`
must end with a `## Re-invocation behavior` section that documents,
in 1–3 sentences:

1. What this skill writes (which `research.json` sections, which
   GedcomX paths, which sidecar files).
2. What it does when invoked against state where it has already
   run: supersede prior entries by ID, refine in place, or no-op.
3. Any specific entries the model should *not* duplicate (e.g.
   "do not create a second `plan_` for the same research
   question — if one exists, mark it superseded and write a new
   one").

This section must live inside SKILL.md itself, not in a separate
file. The repo's `CLAUDE.md` documents why: Claude Code's
relative-path resolution from SKILL.md is unreliable (issue #17741),
and **Cowork specifically does not load `plugin/CLAUDE.md`** — the
official Claude Code plugin reference states "A CLAUDE.md file at
the plugin root is not loaded as project context. Plugins contribute
context through skills, agents, and hooks rather than CLAUDE.md."
The re-invocation contract therefore has to live where the model
will actually see it: inside each SKILL.md.

**Test-side enforcement.** Every unit test scaffolded by
`/draft-unit-test` (§4.2) includes a **re-invoke assertion**: run
the skill against the fixture, snapshot the resulting state, run
the same skill again with no additional input, assert that the
second invocation does not error and does not produce duplicate
entries. This is the executable counterpart to the SKILL.md prose.

---

## 6. Limitations

### 6.1 Claude Code is not Cowork

The iteration loop in §3.3 runs under Claude Code, not under the
Cowork desktop runtime. Cowork has a different system prompt,
different plugin loader, different MCP wiring, possibly different
viewer-injected context. Bugs that depend on the Cowork runtime —
plugin-path resolution issues, viewer context truncation, OS-specific
file handling — will not reproduce in Claude Code.

Mitigations:

- §3.5 step 16 requires building and installing the fix-applied
  artifacts into Cowork and re-running the user's prompt before
  the PR is opened. This is the only Cowork interaction in the
  workflow.
- Bugs that pass in Claude Code but still fail in Cowork after
  step 16 are escalated as runtime issues, not skill issues.
- The workflow does **not** include an early "does this even repro
  in Cowork?" check before iteration. We trust the user's report;
  the cost of a failed Cowork verification at step 16 is small
  compared to the friction of an extra Cowork interaction per case.

This limitation is irreducible without a headless Cowork runtime,
which Anthropic does not currently ship.

### 6.2 Live-mode upstream noise

The MCP tools called during iteration (record_search, place_search,
etc.) hit live FamilySearch endpoints. Their responses change
between runs — same query can return different record ordering,
different fulltext scores, different highlight snippets. This means:

- Two consecutive runs of the same prompt can produce different
  output even with no SKILL.md changes.
- `/compare-state --against=desired` may flag a "partial" match on
  iteration N+1 that was a "match" on iteration N, purely from API
  noise.

Mitigations:

- When `/compare-state` reports a regression, re-run before
  concluding the SKILL.md edit broke something.
- For systematic protection, the eventual unit test uses fixture
  responses (§4.2 step 6), not live API calls. Iteration tolerates
  noise; regression tests do not.

### 6.3 Post-failure state in the imported zip

Per §5, the case fixture is post-failure state. The agent in
iteration cycles sees its predecessor's bad work. The skill
re-invocation contract is how we make this tolerable, but it does
not produce a perfect reproduction of the user's original
experience.

A viewer-side enhancement (continuous pre-action snapshots) was
considered and rejected; see `feedback-json-spec.md` §7.1.

---

## 7. Out of scope

- **A "feedback workbench" — CLI, harness, case database.** Earlier
  drafts proposed this. The two-skill + Claude Code workflow does
  the job with less infrastructure.
- **LLM-as-judge in this workflow.** The eval framework already has
  this (`eval/harness/harness/judge.py`); the feedback workflow
  funnels into it via unit-test promotion.
- **Per-PR CI on cases.** Cases are not green/red; nothing in CI
  looks at them. The unit tests they promote into are what PRs
  gate on.
- **Cross-case analytics.** No dashboard.
- **An automated "list open cases" tool.** With the expected volume
  (hundreds total, one at a time), a Drive folder and a folder
  convention on disk is enough. If volume grows, revisit.

---

## 8. Where the files live

| Artifact | Location | Checked in? |
|---|---|---|
| Feedback zip from UI | Google Drive folder | No |
| Unzipped case (one per person) | `~/feedback/<slug>/` | No |
| Per-skill symlinks in case dir | `~/feedback/<slug>/.claude/skills/<name>` → `<repo>/plugin/skills/<name>` (24 of these) and `→ <repo>/.claude/skills/{compare-state,draft-unit-test}` (2 of these) | No |
| Case-dir `.gitignore` | `~/feedback/<slug>/.gitignore` — `.claude/` appended (or created with) by setup script; preserves any pre-existing `.gitignore` from the zip | No |
| Repo-root marker | `~/feedback/<slug>/.feedback-repo-root` — absolute path of the main repo, written by setup script, read by `/draft-unit-test` to know where to emit eval-framework outputs | No |
| `/compare-state` skill | `.claude/skills/compare-state/SKILL.md` | Yes |
| `/draft-unit-test` skill | `.claude/skills/draft-unit-test/SKILL.md` | Yes |
| Re-invocation sections | Inside each `plugin/skills/<skill>/SKILL.md` | Yes |
| Setup helper | `scripts/setup-feedback-case.sh` (or similar) | Yes |
| Unit tests from cases | `eval/tests/unit/<skill>/<slug>.json` | Yes |
| Fix + lesson | Commit message on the feature branch | Yes (in git history) |

The repo `.gitignore` already covers `eval/feedback/` from the
earlier workbench draft; that entry can be removed since the
directory no longer exists.

---

## 9. Build order

1. **`feedback.json` emission in `cowork-genealogy-ui`.** Cross-repo
   change; gating dependency for every other step. Spec:
   [`feedback-json-spec.md`](./feedback-json-spec.md).
2. **Setup helper script.** `scripts/setup-feedback-case.sh
   <zip-path>` — unzip, git init, symlink plugin skills. Full
   contract in §11.
3. **`/compare-state` skill.** Build with `--against=what-went-wrong`
   first since that's what's used in §3.2 repro confirmation; add
   `--against=desired` immediately after (same skill, second flag
   value).
4. **`/draft-unit-test` skill.** Higher complexity (scenario-
   directory extraction with PII scrub, test JSON with
   `judge_context` derived from `agent_should_have`, MCP fixture
   files keyed by tool+args). Land in two passes: pass 1 generates
   just the test JSON; pass 2 adds the scenario directory and the
   MCP fixtures. The re-invoke assertion stays a tag-only metadata
   marker — no auto-generated validator file (see §4.2 step 8).
   See §4.2 for the full output contract.
5. **Re-invocation sections in all 24 existing skills under
   `plugin/skills/`.** Single PR. Mechanical edit per skill —
   each gets a `## Re-invocation behavior` section per §5 of this
   spec. Land as one PR rather than one-per-skill: the contract is
   uniform across skills, the diff is mostly templated, and a
   single review pass catches inconsistencies that per-skill PRs
   would let drift. The `spec-review` subagent can audit the
   batch. Sequencing-wise, this can land in parallel with steps
   3–4; it does not block them.
6. **Consolidate install docs.** The current `DEVELOPMENT.md §
   "Deploying a code change to Claude Desktop"` is Windows-only;
   macOS install steps live in `README.md`. §3.5 step 16 points at
   the DEVELOPMENT.md section as the single canonical source. Before
   the first end-to-end run of the workflow on macOS, generalize
   that section to cover both OSes (or move the macOS content into
   it). Same-repo doc PR; cheap to do, but blocks per-case use on
   macOS until done.
7. **Re-invocation-section lint.** Add a pytest in
   `eval/harness/tests/` that walks `plugin/skills/*/SKILL.md` and
   asserts each contains a `## Re-invocation behavior` heading
   with a non-empty body (at least one non-whitespace line of
   prose after the heading, before the next heading or EOF).

   The existing CI workflow already runs the eval harness tests,
   so a failure here blocks merge. Without this check the
   contract rots the next time someone adds a 25th skill without
   reading the spec. Land this in the same PR as step 5 so the
   lint and the section additions cover each other.

   We're not trying to enforce content quality — a contributor
   who writes a placeholder TODO will get caught at review time,
   not by a regex. Some skills are stateless (read-only, pure
   query, narration-only) and their re-invocation section
   legitimately says "this skill writes no project state; safe
   to re-invoke." A loose lint that catches "section missing
   entirely" without rejecting legitimate stateless cases is the
   right balance.

The workflow itself is documented in §3 of this spec. There is no
separate `docs/feedback-workflow.md` — the spec is the workflow
reference, and a quickstart for command-level lookup lives in the
introduction below.

---

## 10. Open questions

- **Drive notifications.** No mechanism notifies the dev team when a
  new case lands. With expected volume, periodic polling is fine.
  Revisit if cases pile up unread.
- **Authenticated tool calls during iteration.** Claude Code uses
  your `~/.familysearch-mcp/tokens.json`. Cases run as you, not
  as the user who reported the bug. Accepted — matches how local
  debugging already works.
- **Runtime version pinning.** Devs may want to know which plugin /
  MCP server version was running when the failure occurred. For v1
  the `viewer_version` field in `feedback.json` plus the submission
  timestamp plus `git log` is the answer. If this proves
  insufficient, the lowest-friction fix is for `init-project` to
  write `runtime_versions` into `research.json`; see
  `feedback-json-spec.md` §7.2.

---

## 11. Setup helper script

To save friction on every case, ship a short bash helper at
`scripts/setup-feedback-case.sh` that does §3.1's mechanical work.

**Contract.**

```bash
scripts/setup-feedback-case.sh <path-to-feedback.zip> [<dest-dir>]
```

Behavior:

1. Resolve `<dest-dir>` (default: `~/feedback/<slug>/`, where
   `<slug>` is the zip basename with `.zip` stripped and any
   timestamp suffix kept verbatim — uniqueness is guaranteed by
   the viewer's submission filename per `feedback-json-spec.md`
   discussions).
2. Refuse to overwrite an existing non-empty `<dest-dir>` unless
   `--force` is given. Print the existing path so you can
   investigate manually before clobbering.
3. Unzip into `<dest-dir>`.
4. **Write `.feedback-repo-root`** to `<dest-dir>/.feedback-repo-root`
   containing the absolute path of this repo (derived from
   `git rev-parse --show-toplevel` against `$(dirname "$0")`). The
   `/draft-unit-test` skill reads this file to know where to write
   its outputs; see §4.2 "Repo-root resolution."
5. **Update `.gitignore`** so `.claude/` is ignored. The unzipped
   project may already have a meaningful `.gitignore` from the
   user's normal workflow — preserve it:
   ```bash
   if [ -f .gitignore ] && ! grep -qxF '.claude/' .gitignore; then
     echo '.claude/' >> .gitignore
   elif [ ! -f .gitignore ]; then
     echo '.claude/' > .gitignore
   fi
   ```
   This must happen **before** `git init` so the ignore is in
   effect from the first commit.
6. `git init && git add . && git commit -m "imported"` inside
   `<dest-dir>`, suppressing the usual git init warnings.
7. **Wire skills via per-skill symlinks.** Create
   `<dest-dir>/.claude/skills/` as a real directory and populate
   it with one symlink per plugin skill plus one symlink per
   workflow skill:
   ```bash
   mkdir -p "$dest/.claude/skills"
   for d in "$repo_root"/plugin/skills/*/; do
     ln -s "$d" "$dest/.claude/skills/$(basename "$d")"
   done
   for d in "$repo_root"/.claude/skills/*/; do
     ln -s "$d" "$dest/.claude/skills/$(basename "$d")"
   done
   ```
   A single top-level symlink (`.claude/skills` → `<repo>/plugin/skills`)
   does **not** work: it would hide the workflow skills that live
   in `<repo>/.claude/skills/`. Per-skill symlinks give Claude Code
   one merged view of both sets while keeping every edit live. On Windows the script uses `mklink /D` (directory
   junction) instead of `ln -s`; the per-skill structure is
   identical. If symlink creation fails on your platform
   (rare; Windows with developer mode off), the script prints
   the manual commands you should run and exits with the
   other setup already complete.
8. **Print "next steps" with the user prompt inline** so you
   can copy it into your first Claude Code session without
   re-opening `_feedback/feedback.json`. Approximate output:
   ```
   ✓ Imported to ~/feedback/<slug>/

   Next steps:
     cd ~/feedback/<slug>
     claude

   User's prompt to issue first:
   ─────────────────────────────────────────────
   <user_prompt verbatim from feedback.json>
   ─────────────────────────────────────────────

   Then: /compare-state --against=what-went-wrong
   ```
   Read `user_prompt` from `<dest-dir>/_feedback/feedback.json`.
   The script may shell out to `jq` if available; if not, a
   minimal pure-bash JSON read (anchored on the `"user_prompt":`
   key) is acceptable since `feedback.json` is small and
   pretty-printed (per `feedback-json-spec.md` §3).

**Determining `<repo-root>`.** The script is invoked from a known
location inside this repo, so it can derive its own repo root via
`git rev-parse --show-toplevel` from `$(dirname "$0")`. If the
caller has cd'd elsewhere, the script still finds the right repo.

**What the script does not do.**

- Does **not** download the zip from Drive. You do that in
  a browser; per §6.3 of `feedback-json-spec.md` and the
  workflow's expected volume, automating Drive access is not
  worth the per-user auth setup.
- Does **not** register the MCP server. That's a one-time setup
  per machine, documented in the repo `README.md`.
- Does **not** validate the zip's shape (presence of
  `_feedback/feedback.json`, etc.). If the unzip succeeds and
  you launch Claude Code, the workflow's first command
  (`/compare-state`) will surface a missing-required-file error
  with a clear message — better there than in a bash pre-check
  that has to know the schema.

**Testing.** A pytest in `eval/harness/tests/` (e.g.
`test_setup_feedback_case.py`) constructs a fake zip with the
right shape, shells out to the script against a `tmp_path` fixture,
and asserts:

- The expected files exist (`research.json`, `_feedback/feedback.json`,
  the user-prompt fields parse, etc.).
- A `.git/` directory exists with one commit titled `imported`.
- `.claude/skills/` is a real directory containing per-skill
  symlinks, each resolving to a real directory under
  `<repo>/plugin/skills/` or `<repo>/.claude/skills/`.
- A `.gitignore` exists containing `.claude/`.
- Re-running against an existing non-empty dest fails without
  `--force`.

Using pytest keeps everything in one runner (no `bats` dependency)
and the test executes in CI alongside the existing harness tests.
The bash script itself stays portable; the test exercises it as a
black box.
