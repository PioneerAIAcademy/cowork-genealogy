# E2E Testing Guide — authoring and running a benchmark fixture

How to work an end-to-end research benchmark fixture: resolve one you've been
assigned, or author a new one from a FamilySearch person.

| You want to… | Go to |
|---|---|
| Fix a skill problem — whether you noticed it while researching or a run exposed it | [`skill-lifecycle.md`](skill-lifecycle.md) — mine a unit test, improve, gate, PR. That loop is the same wherever the problem came from, and Step 7 below hands off to it. |
| Look up an exact field, contract, or enum | [`specs/e2e-test-spec.md`](specs/e2e-test-spec.md) — the authoritative format. This guide stays task-shaped and sends you there for reference detail. |

---

## The workflow at a glance

Which steps are yours depends on how you got here:

- **Assigned a fixture** — a GitHub issue titled "test `<slug>`". This is the
  normal case. Do steps **0, 1a, then 4–9**.
- **Authoring a new fixture** — no issue, just a person you want to turn into a
  test. Do **every** step.

| Step | What you do | Where |
|---|---|---|
| 0 Branch | `git checkout -b <short-task-name>` | ⌨️ Terminal |
| 1 Choose your path | assigned a fixture → 1a; authoring a new one → 1b | 🤖 Claude Code |
| 1a Resolve *(the norm)* | `/resolve-record-hint` — verify the hint, write the truth | 🤖 Claude Code |
| 1b Author | `/author-e2e-fixture` — pick a deceased, stable person | 🤖 Claude Code |
| 2 Scope *(1b only)* | one question, 1–5 findings; keep the search anchors | 🤖 Claude Code |
| 3 Validate *(1b only)* | check the answer is findable; `make e2e-validate TEST=<slug>` | ⌨️ Terminal |
| 4 Debug live | `make e2e-project`, then `/research` in Cowork with the Viewer open | 🖥️ Cowork + Viewer |
| 5 Run | `make e2e-run TEST=<slug>` — one fixture, 20–60 min, $3–10 | ⌨️ Terminal |
| 6 Read | `/interpret-e2e-result`; `make e2e-view` for the visual pass | 🤖 Claude Code |
| 7 Attribute | read the transcript, fix in Step 4; `/mine-unit-test --e2e-run …` for a skill miss | 🤖 Claude Code |
| 8 Grade | `/grade-e2e-run` → commit the `.ann.json` (CI-enforced) | 🤖 Claude Code |
| 9 Land | commit fixture + run log + grade; open the PR | ⌨️ Terminal / GitHub |

## The three places you'll work

| Icon | Place | What it is | You use it to… |
|---|---|---|---|
| ⌨️ | **Terminal** | A plain shell where you type `make …` (Windows: double-click the matching `.bat` in `eval\`). | Set up, validate, seed, run, view. |
| 🤖 | **Claude Code** | The **Code tab** of the Claude desktop app opened on your **repo root**, or `claude` in a terminal there — either works, and the Code tab is the usual Windows path. **Not** Cowork. The `/`-commands below are repo-local dev skills under `.claude/skills/`, picked up automatically in this checkout and identical on every platform. | Author the fixture, interpret the result, grade the run. |
| 🖥️ | **Cowork** | The shipping product, with the plugin + MCP extension installed. | Watch `/research` work on the fixture live, before you spend money on a headless run. |

A fourth surface matters throughout: the **Research Viewer** (Electron,
`make electron`), which renders the research log, assertions, conflicts and
sources of whichever project folder you point it at. It's how you *see* what the
agent wrote instead of trusting the chat's summary of itself.

## What e2e tests are

An e2e test snapshots a real, well-researched FamilySearch person's tree,
strips a focused subset (the "answer"), and asks the agent — via
`/research --autonomous` — to recover what was removed. The judge grades the
final state `pass` / `partial` / `fail`.

**Runs are expensive: 20–60 minutes and $3–10 each. Run one at a time.**

This is a capability benchmark, not a regression suite — per-PR regression
coverage is the unit tests in `eval/tests/unit/`. The verdict measures *fact
recovery, not sound reasoning*, so don't quote it outside the team as proof that
the agent does sound, verifiable GPS research. Full framing: spec §1.

---

## Setup

**Run the preflight first** — it green-lights FamilySearch auth, the built MCP
server, the Anthropic API key, and the harness deps in one shot, so a setup gap
fails here instead of deep inside an expensive run:

```bash
make e2e-preflight                # Windows: eval\CheckSetup.bat
```

If it flags something:

- **FamilySearch login** — `make e2e-login` (Windows: `eval\Login.bat`). The
  token is host-global, shared by every e2e path, and lasts ~24h, so this is
  **once a day**, not once a run. Preflight warns when it's near expiry. If it
  does expire mid-run, FS calls fail loudly in the transcript — re-login and
  re-run; you won't get a silently bad result.
- **MCP server not built** — `make mcpb` (Windows: `eval\BuildMcpb.bat`). It
  compiles the server *and* packs the `.mcpb`, which is what you install in
  Cowork for the live-debugging loop in Step 4.
- **Harness deps** — `cd eval/harness && uv sync`.

---

## Step 0 — Branch ⌨️ Terminal

One task, one branch, always cut from an up-to-date `main` — you open a PR from
it at the end. Name it with a few hyphenated words describing the task — no
slashes, no timestamps.

**Terminal:**

```bash
git checkout main && git pull
git checkout -b spriggs-parents-fixture
```

**GitHub Desktop:** Current Branch dropdown → select **main** and
**Fetch/Pull** → **New branch…** → name it → base it on `main` → **Create
branch**.

Everything the rest of this produces — the fixture files, the run log, the
grade — lands on this one branch.

## Step 1 — Choose your path 🤖 Claude Code

- **Assigned a fixture?** A GitHub issue titled "test `<slug>`" means the
  fixture already exists, drafted from an unverified FamilySearch record
  hint. Go to **Step 1a**.
- **Authoring a brand-new fixture?** No issue — just a person (or research
  document) you want to turn into a test. Go to **Step 1b**.

## Step 1a — Resolve an assigned fixture 🤖 Claude Code

**What this is.** The fixture's answer was never in the FamilySearch tree — it
lives in a historical record that FamilySearch's own hinting matched to the tree
person with *unverified* confidence, and about half of those matches are wrong.
Your job is to decide whether this one is true, and leave the fixture stating
what you found instead of the raw hint.

**Start from the GitHub issue, not the fixture folder.** It links the two things
you need: the **tree person** on familysearch.org, and the **hint record** that
was matched to them.

**Do the research, in this order:**

1. **Open the tree person first** and read the sources already attached to them.
   That's the baseline the hint has to be consistent with — and it's how you
   catch a hint that is really just a re-indexing of a source the person already
   has.
2. **Read the fixture's README**, "Notes for reviewers" section, for what the
   original author already found (the tree's existing sources, the
   match-strength argument for and against).
3. **Open the hint record** and look, by hand, for corroborating or
   contradicting evidence — the same way you would for any genealogical proof.

This is the human GPS work the benchmark exists to measure; there's no tool
shortcut for it. **Ask a genealogist for a second opinion** if the call is
borderline — don't guess alone.

**Write the outcome with the skill — don't hand-edit the fixture files:**

```
/resolve-record-hint
```

Give it the issue (number or URL) or the slug. It asks what you found, writes
the fixture files, and validates the result. The three outcomes:

1. **The hint is right** — the fixture stays as it is.
2. **The answer is something else** — the skill rewrites the fixture's expected
   findings to the correct answer.
3. **The hint is wrong, and no other record answers the question** — the skill
   turns the fixture into a restraint test: the agent must *not* assert the
   wrong claim, and must document the negative conclusion.

Once the skill hands off, go straight to **Step 4** — Steps 2 and 3 don't apply
here (nothing was stripped, and the skill already validated).

> No fixture of this genre has been resolved and run end to end yet, so there's
> no finished one to copy. You are working an unexercised path: if a step doesn't
> behave the way this page says, that's worth reporting, not working around.

## Step 1b — Pick a person and author a new fixture 🤖 Claude Code

**The normal path is one command.** From a Claude Code session at the repo root,
logged in to FamilySearch:

```
/author-e2e-fixture
```

Give it a FamilySearch PID. It snapshots that person's well-researched tree,
prints an index of every person, relationship, fact and source, and asks you to
pick the subset to strip. It then strips it, records the removals as expected
findings, and writes the files into `eval/tests/e2e/<slug>/`.

The judgment is yours; the mechanics are the skill's. What makes a person worth
choosing:

- **Deceased.** Required by FamilySearch's terms. This is *enforced* — the
  authoring tool refuses a person marked living, and refuses one whose `living`
  field is simply absent (absent is not deceased).
- **Stable.** Older records, settled profiles — not ones being actively edited.

`eval/tests/e2e/spriggs-parents-1898/` is the worked example to read alongside
your own: *"Who were the parents of Reuben Spencer Spriggs?"* (PID `L64C-QQX`,
born 1898 in Maddock, Benson County, North Dakota), where the stripped answer is
his two parents and the census sources naming them.

> There's a second, secondary path for when you have no FamilySearch access:
> building PID-less from a bundled research document, with a placeholder
> `source_pid` you resolve before landing. `/author-e2e-fixture` covers it;
> everything below applies unchanged.

## Step 2 — Match the question to what you strip 🤖 Claude Code

*(Step 1b only — skip this and Step 3 if you came from Step 1a.)*

The research question is what the agent receives. The stripping decides what it
must recover. They have to line up:

| Question | Strip |
|---|---|
| "Who were John's parents?" | Parent persons, parent-child relationships, and the sources attesting parentage |
| "When did Mary die?" | The death event, death facts, death sources |
| "Find John's other children." | *Some* children + their attesting sources |

Keep it small: one focused question, **1–5 expected findings**, not 30. The
Spriggs fixture strips five things — two parents, two parent-child
relationships, the parents' own marriage, and the two census sources that name
them — while deliberately *keeping* Reuben's birth, death, residences, obituary,
burial, wife and children, so the agent has a strong anchor to search from.

**Leave the anchors in.** A fixture that strips both the answer and everything
you'd search from measures nothing but frustration.

### Author both positive and negative fixtures

- **Positive** (the default) tests **recall** — strip a fact, check it comes
  back.
- **Negative** tests **restraint** — a finding marked `polarity: "avoid"` names
  a plausible-but-wrong candidate the agent should *not* conclude. It scores as
  matched when the agent correctly declined. (`hole-parents-negative` is the
  worked instance in the repo.)

Negative fixtures are the only way this benchmark sees **over-claiming**, the
failure that matters most in genealogy. Aim for the suite as a whole to cover
both, across a spread of question types, eras and geographies. Details: spec
§3.4.1.

## Step 3 — Prove the answer is findable ⌨️ Terminal

*(Step 1b only — Step 1a's skill already validated for you.)*

Stripping your local copy isn't enough — **live FamilySearch still has the
answer.** The harness blocks these tools for the whole run, so the agent can't
read the answer back off the tree:

```
person_read   person_search   person_ancestors
person_record_matches   person_person_matches
```

So the question you pick must be recoverable through **records** the agent can
still reach:

| Route | How the agent gets there |
|---|---|
| **Indexed records** | `record_search` → `record_read` — the default route |
| **Full text** | `fulltext_search` over unindexed books, deeds, probate, newspapers |
| **Images** | `image_search` / `image_read` / `image_transcribe` on an unindexed film |
| **Off-FamilySearch sources** | `external_links_search` finds *where* a record lives (Ancestry, FindAGrave, a county archive) — the agent has no browser during a run, so if it needs to *read* the page, capture it yourself into the fixture's `provided-documents/` (spec §6.2) |
| **Indirect evidence** | Assembled from several sources (e.g. a marriage-record age + a census + a burial) |

If the only route to the answer runs through the live tree, the fixture can't
measure anything and won't land.

**Then run the stripping linter** — the crux check:

```bash
make e2e-validate TEST=<slug>       # Windows: eval\ValidateFixture.bat
```

It **hard-fails (exit 2) only on structural problems**: a missing or
unparseable file, a schema violation, a dangling relationship endpoint or
source `ref`. A `WARN` about a finding's answer possibly still being present is
for you to judge — sometimes it's a legitimate name collision, not a real
problem. Omit `TEST=` to lint every fixture.

Field tables, the hand-authoring path, cascade rules, and `provided-documents/`
detail: spec §§2–3, §6.2.

## Step 4 — Debug `/research` live, before you pay for a run 🖥️ Cowork + Viewer

A headless run can't show you *why* the agent stopped or skipped a step — and
it charges you 20–60 minutes to not tell you. Watch a run live in Cowork, fix
what you see, and save the headless run for the verdict.

1. **Build and install both artifacts**, so Cowork has the genealogy tools.
   This is the step that costs an hour when it's skipped:

   ```bash
   make cowork-install             # Windows: eval\CoworkInstall.bat
   ```

   It builds both and prints where to install each: the `.mcpb` in Claude
   Desktop → Settings → Extensions → Advanced Settings → Install extension
   (straight over the old copy — no uninstall needed), and the `.zip` in Cowork
   → Customize, **removing any existing Genealogy Research plugin first**, via
   Add → Upload Plugin — from the **Cowork** tab rather than the Code tab, since
   they keep separate plugin lists. Then **fully quit and reopen** Claude
   Desktop. Redo this after any MCP-server or skill change; without it
   `/research` degrades to guessing, which is a missing install, not a
   `/research` bug. (Full rules:
   [`skill-lifecycle.md`](skill-lifecycle.md#rebuilding-and-reinstalling).)

2. Seed an editable project from the fixture's starting state:

   ```bash
   make e2e-project TEST=<slug>    # Windows: eval\SeedProject.bat
   ```

3. Open `eval/e2e-project/<slug>/` in Cowork and run `/research`. Open the
   **same folder** in the Research Viewer (`make electron`, Windows:
   `eval\Viewer.bat`) to watch the research log, assertions and conflicts
   appear live — and ask Claude *"why didn't you search X?"* as it works.

Full walkthrough: `eval/README.md` → "Debug a fixture interactively".

> **This doesn't block the tree-reading tools** the way a benchmark run does.
> Calling them by hand reads the live tree — fine for debugging, but don't let
> a hand-run "pass" that way convince you the fixture is solvable. A real run
> can't do that.

**Land any skill fixes this exposes before you run.** That's
[`skill-lifecycle.md`](skill-lifecycle.md), not this page.

## Step 5 — Run it ⌨️ Terminal

**This is the expensive confirmation at the *end* of the loop, not a debugging
tool.** One fixture at a time:

```bash
make e2e-run TEST=<slug>            # Windows: eval\RunE2E.bat
```

## Step 6 — Read the result 🤖 Claude Code

**The easy path — run the interpreter skill** on the run, in a Claude Code
session in this checkout:

```
/interpret-e2e-result
```

It reads the run-log files and explains in plain language: which expected
findings the tree actually contains and which it doesn't, what proof
conclusion the agent wrote (described, not scored), any blocked tree-reads
(did it try to shortcut?), whether a finding came from a bundled PDF rather
than live research, the stop reason translated into something actionable,
any GPS guardrail skills the run bypassed, and — when findings are missing —
the most likely cause.

It deliberately does **not** report the judge's grade: not the verdict, not
the `proof_quality` score, not the `outcome` gate. You grade the run blind
right afterwards with `/grade-e2e-run`, and seeing the judge's labels first
would corrupt the calibration number. For the same reason `make e2e-run`
prints only the stop reason and the compliance result when a run finishes.

If you'd rather read the files yourself, each run writes four:

| File | What's in it |
|---|---|
| `run-<ts>.json` | The structured result: the three axes (`verdict` = genealogy, `compliance` = guardrails, `outcome` = the combined gate), stop reason, judge output, usage, tool calls, blocked tree-reads. If you are about to grade this run, read the two `final-*` files instead — this one holds the judge's grade |
| `run-<ts>.transcript.md` | Readable transcript of the agent's turns |
| `run-<ts>.final-tree.gedcomx.json` | The agent's final tree — what the judge graded |
| `run-<ts>.final-research.json` | The agent's final `research.json` |

To page through that final state visually instead of in JSON:

```bash
make e2e-view TEST=<slug>           # Windows: eval\ViewE2E.bat
```

It copies the newest run's final tree + `research.json` into `eval/e2e-view/`
for the Research Viewer (`make electron`, Windows: `eval\Viewer.bat`).

**Verdict:** `pass` (all required findings matched) / `partial` (some) / `fail`
(none) / `skipped` (the judge never ran).

**Stop reason** — what each one means, as opposed to what triggers it
(spec §6):

| | |
|---|---|
| `completed` | Happy path — proof-conclusion fired and set the project completed |
| `natural_end` | The agent thought it was done; GPS may or may not agree |
| `inactivity` / `timeout` | It stalled — the transcript shows where |
| `tool_cap` / `max_turns` | It may be looping — look for repeated tool calls near the end |
| `cost_cap` | Hit the per-run cost limit |
| `error` | SDK or harness exception; check `result.error` |

Full field reference: spec §8.

## Step 7 — When it fails ⌨️ / 🤖

Read the transcript first — most failures are obvious from it. If something
needs fixing, fix it in **Step 4** (Cowork + Viewer) and re-run, rather than
guessing blind from the run log alone.

One trap worth naming: if the agent found the right answer but recorded it
*only* in `research.json` and not in the tree, that is an **agent failure, not
a judge miss** — landing the answer in the tree is a required GPS success
criterion.

**When it's a skill problem, capture it before you fix it.** In Claude Code:

```
/mine-unit-test --e2e-run eval/runlogs/e2e/<slug>
```

That turns the miss into a unit test and drops you into
[`skill-lifecycle.md`](skill-lifecycle.md) at step 3 — that's where the rest of
the fix-and-verify loop lives; this guide doesn't repeat it.

When a fixture's behavior shifts meaningfully, add a dated line to its
`README.md` saying what changed. Next person to run it reads that first.

## Step 8 — Grade the run 🤖 Claude Code

Every committed run gets graded in the same PR — **this one is CI-enforced.**
The `check-e2e-fixtures` gate blocks any run log *added* in your PR that
produced a final tree but ships no `run-<ts>.ann.json` beside it. (A treeless
run — crashed or skipped before a final tree — is exempt; there's nothing to
grade.)

```
/grade-e2e-run
```

It shows you each expected finding plus the agent's evidence, and writes
`run-<ts>.ann.json` with your labels. It reads the fixture and the run's final
tree — deliberately **not** the judge's own grades — so you label blind. Commit
the `.ann.json`.

Annotation format, the ≥80% agreement gate, and how to read a calibration
report: spec §7.4.

## Step 9 — Land it ⌨️ Terminal / GitHub

Commit the fixture directory, the run log, and its `.ann.json` together, push
the Step-0 branch, and open the PR.

**Terminal:**

```bash
git add eval/tests/e2e/<slug>/ eval/runlogs/e2e/<slug>/
git commit -m "e2e: add the <slug> fixture"
git push -u origin <your-branch>
gh pr create                            # or open the PR from GitHub's web UI
```

**GitHub Desktop:** make sure the repository picker says **cowork-genealogy**,
tick the fixture directory plus the run log **and** its `.ann.json`, type a
summary, **Commit to `<your-branch>`**, then **Push origin** and **Create Pull
Request** (it opens GitHub in your browser with the branch pre-filled).

**Commit a passing run, from the branch you're landing.** Stripping proves the
answer isn't *in* the starting tree; only a run proves it's *recoverable from
live FS*. If you fixed something in Step 7 and re-ran, the earlier run log is
stale — commit the new one. Landing a fixture without a passing run is a
judgment call you should be able to defend in review.

> **Resolved a fixture to "the hint is wrong" (Step 1a)?** "Passing" means
> something different there: there's no fact to recover, so what you're looking
> for in the run is **restraint** — the agent searched, came up empty (or found
> the same contradicting evidence you did), and documented that negative
> conclusion instead of asserting the hint's claim. Read the transcript for
> restraint, not recall, before committing the run log.

---

## Windows equivalents

Every `make` target above has a batch file in `eval\`. Double-click it or run
it from that folder; each prompts for what it needs instead of taking
`TEST=`-style arguments, and builds the MCP server first where that matters.

| Instead of | Double-click |
|---|---|
| `make e2e-preflight` | `eval\CheckSetup.bat` |
| `make e2e-login` | `eval\Login.bat` |
| `make cowork-install` | `eval\CoworkInstall.bat` |
| `make mcpb` *(one artifact only)* | `eval\BuildMcpb.bat` |
| `make plugin` *(one artifact only)* | `eval\BuildPlugin.bat` |
| `make e2e-validate TEST=<slug>` | `eval\ValidateFixture.bat` |
| `make e2e-project TEST=<slug>` | `eval\SeedProject.bat` |
| `make e2e-run TEST=<slug>` | `eval\RunE2E.bat` |
| `make e2e-view TEST=<slug>` | `eval\ViewE2E.bat` |
| `make electron` | `eval\Viewer.bat` |
| `git checkout -b <short-task-name>` | GitHub Desktop → Current Branch → **New branch…** |

The `/`-commands (`/author-e2e-fixture`, `/resolve-record-hint`,
`/interpret-e2e-result`, `/grade-e2e-run`, `/mine-unit-test`) are typed into
Claude Code and are the same everywhere.

## Related docs

- [`specs/e2e-test-spec.md`](specs/e2e-test-spec.md) — the authoritative
  format: fixture fields, execution pipeline, judge contract, calibration,
  failure attribution
- [`skill-lifecycle.md`](skill-lifecycle.md) — turning a noticed problem into
  a committed skill fix
- [`eval/README.md`](../eval/README.md) — harness conventions, interactive
  debugging in Cowork
- [`alpha-user-guide.md`](alpha-user-guide.md) — what alpha testers do (they
  research in the hosted app; they don't author fixtures)
- [`alpha-feedback-guide.md`](alpha-feedback-guide.md) — triaging a feedback
  zip into a fix, and when a report should become an e2e fixture instead
- [`specs/research-schema-spec.md`](specs/research-schema-spec.md),
  [`specs/simplified-gedcomx-spec.md`](specs/simplified-gedcomx-spec.md) —
  schemas behind the starting state
