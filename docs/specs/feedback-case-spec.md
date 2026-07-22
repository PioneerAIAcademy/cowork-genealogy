# Feedback case spec — the contracts behind alpha-feedback triage

This is the **durable contract layer** for turning a submitted feedback zip
into a reproducible research project: what the capture guarantees, what the
case directory looks like, and what a skill must promise so the loop works.

**This is not the how-to.** Read these instead, and only come here when you are
changing the machinery itself:

| You want to… | Go to |
|---|---|
| Triage a submission, step by step | [`../alpha-feedback-guide.md`](../alpha-feedback-guide.md) |
| Improve a skill once you have a fix | [`../skill-lifecycle.md`](../skill-lifecycle.md) |
| Know what's in `feedback.json` | [`../../apps/electron/docs/feedback-json-spec.md`](../../apps/electron/docs/feedback-json-spec.md) — the authority for the submission schema |
| Know what a unit test looks like | [`unit-test-spec.md`](unit-test-spec.md) |

---

## 1. What a feedback case is

An alpha tester hits a defect while researching, clicks **Send Feedback**, and
the client bundles their project state plus a prose description of what went
wrong. That zip lands in a shared Drive folder.

A *case* is that zip unpacked into a working research project — not an archive.
The point of the shape below is that a triager can open the folder, re-issue
the tester's prompt, and watch the same failure happen against the same state.

Two producers emit the bundle — the Electron viewer
(`apps/electron/src/main/feedback.ts`) and the hosted web workbench
(`apps/server/app/feedback.py`). They emit the **same** structure so the triage
workflow consumes either unchanged; `feedback.json`'s `platform` field is what
tells you which one you have.

## 2. Capture-time guarantees

Two things are true of every bundle *before* it leaves the tester's machine or
sandbox. Both are the producer's job, not the triager's.

### 2.1 Living-person redaction

FamilySearch's terms forbid sharing living people's details, and a bundle is a
capture of a real family. Redaction happens at **capture** time, so living data
never reaches the Drive folder at all.

Implemented as `_redact_living` (`apps/server/app/feedback.py`) and
`redactLivingPersons` (`apps/electron/src/main/feedback.ts`). The rule:

- **A person is living unless `living` is exactly `false`.** A *missing* flag
  counts as living. `living` is optional in simplified GedcomX, and defaulting
  an absent flag to "probably deceased" is the wrong bet for data about to
  leave the machine. This is the same rule as the e2e fixture gate
  (`eval/harness/e2e/author.py::living_gate`).
- A redacted person keeps `id` — relationships reference it, so removing the
  person would dangle every edge — and keeps `gender`.
- Their `names` become a single `{id, given: "Living", surname}` placeholder,
  `facts` becomes `[]`, and `ark` is dropped.
- **Surname is retained deliberately.** The tree schema requires `given` *and*
  `surname` on every name with `minItems: 1` on `names`, so the placeholder
  cannot omit it; the surname is already inferable from the deceased relatives
  around them; and `Living Spriggs` is the convention FamilySearch itself
  displays, so a triager reads it as redaction rather than corrupt data. A
  person with no name at all gets surname `Unknown`.
- A `Couple` relationship touching a living person has its `facts` cleared — a
  marriage date and place are as identifying as a birth.
- An unparseable or unexpectedly-shaped tree is **passed through untouched**.
  This is a privacy filter, not a validator, and it must never be the reason a
  report fails to send.
- The count is reported in the bundle's `FEEDBACK.md`, so a triager reads
  `Living Spriggs` as intentional rather than as a bug.

The redacted tree still validates against
[`schemas/tree-gedcomx.schema.json`](schemas/tree-gedcomx.schema.json). Tests:
`apps/server/tests/test_feedback.py` and
`apps/electron/src/main/__tests__/feedback.test.ts` — kept at parity, including
a leak test asserting no redacted name, date, place or ark survives anywhere in
the bundled tree.

**Scope.** This covers `tree.gedcomx.json` — the structured, high-density store
of person data. It does not scrub free text in `research.json`, `results/`, or
the session transcript. That is accepted: researchers work on deceased people,
and agent narration does not reach a committed test.

### 2.2 The session transcript

The bundle carries the Claude Code session JSONL at
`_feedback/session-log.jsonl`. It holds the narration, full tool I/O, and the
agent's reasoning that the persisted project files do not — for diagnosing
*why* the agent did something, it is the highest-value file in the bundle.

## 3. The case directory contract

Produced by `scripts/setup-feedback-case.sh` (and its `.bat` counterpart),
wrapped by `make feedback-case ZIP=…`. Pinned by
`eval/harness/tests/unit/test_setup_feedback_case.py`.

Given a zip, the setup script MUST:

| # | Guarantee |
|---|---|
| 1 | Unzip into `~/feedback/<slug>/` (`%USERPROFILE%\feedback\<slug>\` on Windows), where `<slug>` is the zip basename. An explicit destination may be passed instead. |
| 2 | Refuse a non-empty destination unless `--force` (`FORCE=1`) is given. |
| 3 | Write `.feedback-repo-root` containing the absolute path of the repo checkout it was run from. This is how the workflow skills find the repo to write test output into — they MUST resolve it from this marker rather than assuming the cwd. |
| 4 | Append `.claude/` to the case's `.gitignore`, preserving any existing entries, creating the file if absent. |
| 5 | `git init` and make exactly one commit titled **`imported`**. |
| 6 | Create `.claude/skills/` as a **real directory** (never a symlink) holding one symlink per skill — every skill in `packages/engine/plugin/skills/` and every dev skill in the repo's `.claude/skills/`. Symlinks mean a `SKILL.md` edit takes effect on the next run with no rebuild, which is what makes the fix loop cheap. |
| 7 | Print the tester's `user_prompt` verbatim, for first paste. |

Ordering matters: the marker and `.gitignore` are written **before** the commit
(so the marker is in the baseline), and the symlinks **after** it (so they stay
untracked and ignored).

## 4. Resetting a case

Running the agent mutates the case, so every attempt after the first must start
from a reset. `scripts/reset-feedback-case.sh` / `.bat`, wrapped by
`make feedback-reset CASE=…`, MUST:

- Restore every tracked file to the `imported` baseline and remove files the
  agent added.
- **Leave `.claude/` alone** — it is gitignored, so a plain `git clean -fd`
  already skips it. The symlinked skills must survive a reset.
- Refuse to run in any directory without a `.feedback-repo-root` marker, so it
  cannot be aimed at the repo checkout by mistake.

This is deliberately the **only** restore command a triager needs. The git
baseline underneath is an implementation detail of the setup script; the
workflow docs must not teach `git checkout` / `git clean` to genealogists.

A reset covers *data* only. The conversation is reset separately (`/clear` or a
fresh session) so the agent is not anchored on its own earlier bad reasoning.

## 5. Skill re-invocation contract

The state in the zip is the project **immediately after the failed run**. The
pre-failure state is not captured and cannot be synthesized from the zip, so
every iteration re-runs the prompt against state that may already contain
partial or incorrect work from the original failure.

The mitigation is a skill contract: every SKILL.md in
`packages/engine/plugin/skills/` must be safe under repeated invocation against
state containing its own prior output. "Safe" means:

- It produces a sensible result rather than an error.
- It does not duplicate entries that semantically already exist — it either
  supersedes the prior entry (e.g. mark the old `plan_` superseded and write a
  new one, per [`research-schema-spec.md`](research-schema-spec.md) §6) or
  refines in place.
- It detects and reports when it sees prior work from itself, so the model has
  context for deciding whether to extend or replace.

**Required SKILL.md section.** Every
`packages/engine/plugin/skills/<skill>/SKILL.md` must end with a
`## Re-invocation behavior` section documenting, in 1–3 sentences:

1. What this skill writes (which `research.json` sections, which GedcomX paths,
   which sidecar files).
2. What it does when invoked against state where it has already run: supersede
   prior entries by ID, refine in place, or no-op.
3. Any specific entries the model should *not* duplicate.

Stateless skills (read-only, narration-only, pure query) legitimately say "this
skill writes no project state; safe to re-invoke."

The section must live **inside SKILL.md**, not a separate file: Claude Code's
relative-path resolution from SKILL.md is unreliable (issue #17741), and Cowork
does not load `packages/engine/plugin/CLAUDE.md` as context — plugins
contribute context through skills, agents and hooks rather than CLAUDE.md.

**Enforced.** `eval/harness/tests/unit/test_reinvocation_sections.py` fails any
plugin SKILL.md missing the section with a non-empty body. It deliberately does
not judge the content — a placeholder gets caught at review, not by a regex.

## 6. The workflow skills

Both are repo-local dev skills under `.claude/skills/`, not part of the shipped
plugin. Their own `SKILL.md` is the authority for behavior; this section fixes
only the contract that touches the case directory.

| Skill | Contract |
|---|---|
| `compare-state` | Reads the case's current `research.json`, `tree.gedcomx.json` and `results/`, plus the recent transcript, and compares them against the tester's prose. `--against=what-went-wrong` targets `agent_did` (confirming the bug reproduces); `--against=desired` targets `agent_should_have` (verifying a fix). Returns `matches` / `partial` / `does-not-match`. Refuses to run outside a case directory. |
| `mine-unit-test` | Carves the mid-flow scenario the failing sub-skill actually saw, builds mock fixtures from the saved `results/`, and writes a **draft** test into the repo — located via `.feedback-repo-root`, never the cwd. Reads the tester's Did/Should (and `correct_answer`, when supplied) from `_feedback/feedback.json` rather than re-interviewing anyone. Output is a first cut the user refines in the CRUD UI. |

**Capture the test before the fix lands.** `make gate-skill` scores a candidate
SKILL.md edit against the *pre-edit* annotated baseline for that test. A test
mined after the fix cannot reproduce on the incumbent skill, so the gate
returns `INCONCLUSIVE` and proves nothing. This ordering is a property of the
gate, not a style preference.

## 7. What this spec does not cover

- **The submission schema** — `feedback.json` fields, constraints, versioning:
  [`../../apps/electron/docs/feedback-json-spec.md`](../../apps/electron/docs/feedback-json-spec.md).
- **The triage walkthrough** — roles, per-platform commands, the worked story:
  [`../alpha-feedback-guide.md`](../alpha-feedback-guide.md).
- **The improvement loop** — annotate, audit, improve, gate, release:
  [`../skill-lifecycle.md`](../skill-lifecycle.md).
- **Test format** — [`unit-test-spec.md`](unit-test-spec.md).
- **When a report should become an e2e fixture instead** — the guide's closing
  section, and [`e2e-test-spec.md`](e2e-test-spec.md).
