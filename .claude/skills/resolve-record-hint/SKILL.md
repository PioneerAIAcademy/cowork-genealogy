---
name: resolve-record-hint
model: claude-sonnet-4-6
description: Resolves a draft `genre: "record-hint"` e2e fixture that was assigned via a GitHub issue titled "test <slug>". The fixture's expected-findings.json currently just transcribes an unverified FamilySearch hint record; this skill walks the genealogist through confirming or refuting the hint (the research itself is done by hand on familysearch.org — this skill never fetches anything), then writes the correct expected-findings.json, updates the README's "Notes for reviewers" and fixture.json's notes, and validates the result. Use when the user says "resolve this fixture", "adjudicate this fixture", "I was assigned test <slug>", "review this record hint", pastes a "test <slug>" GitHub issue, or asks to encode the outcome in expected-findings.json for a record-hint fixture. Do NOT use to author a brand-new fixture from a FamilySearch PID or research document (use author-e2e-fixture), to interpret or grade a completed e2e run (use interpret-e2e-result / grade-e2e-run), or to mine a unit test from a miss (use mine-unit-test).
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Glob
---

# Resolve Record Hint

**Narration:** default to concise — this is developer/genealogist-facing fixture work, not research narration.

A `record-hint` fixture starts as a guess: FamilySearch's own hinting matched a
historical record to a tree person with unverified confidence, and
`expected-findings.json` just transcribes that guess. Resolving it means doing
the real genealogical work to confirm or refute it, then making the fixture
state the truth. **The genealogist does the research and makes the call; this
skill only does the writing**, so no one hand-edits the JSON.

## Step 1 — Find the issue and the fixture

Get a GitHub issue number/URL or a fixture slug from the user; ask if you have
neither.

- Given an issue: `gh issue view <n> --json title,body`. Pull the slug (from
  the title, `test <slug>`) and the hint record's `familysearch.org/ark:/...`
  URL — that URL lives **only** in the issue body, never in the fixture
  folder.
- Read `eval/tests/e2e/<slug>/README.md`'s "Notes for reviewers" — what the
  original author already found (the tree's existing sources, the
  match-strength argument for and against).
- Read the fixture's current `expected-findings.json` and `fixture.json`.

## Step 2 — Send the genealogist to do the research

Tell them to open the hint record at the issue's URL on **familysearch.org**,
by hand, and look for corroborating or contradicting evidence the same way
they would for any genealogical proof — reading the attached sources,
searching independently for the person, checking dates and places against
what the tree already has. This is the actual GPS work the benchmark exists
to measure; there is no tool shortcut for it, and this skill does not fetch
the record for them.

If the call is borderline, tell them to ask a genealogist for a second
opinion rather than guess alone.

Wait for their conclusion before continuing.

## Step 3 — Get the outcome

Ask which of the three applies, and collect only what that outcome needs:

1. **True match** — nothing further needed.
2. **Answerable, but differently** — what's actually true (a different date,
   record, or person) in place of what's there now.
3. **False match, no findable substitute** — the specific claim the agent
   must not assert, plus confirmation that the search came up empty (or
   turned up contradicting evidence).

In all three cases, also ask for their reasoning in plain language — this
becomes the README's new "Notes for reviewers."

## Step 4 — Write the files

- **`expected-findings.json`**
  - Outcome 1: leave unchanged.
  - Outcome 2: edit the existing finding(s)' `description` / `details` /
    `supporting_sources` to the corrected answer.
  - Outcome 3: replace the findings with a `"polarity": "avoid"` finding
    naming the wrong claim, paired with a `required: true` finding
    documenting the negative conclusion. Follow
    `eval/tests/e2e/thomas-seaver-other-wife/expected-findings.json` as the
    worked shape.

  Only use the fields spec §3.4 defines: `id`, `type`, `description`,
  `details`, `polarity`, `supporting_sources`, `required`. **Never write
  `"expectation"`** — it isn't a real field. An unrecognized field silently
  no-ops instead of grading anything, and `make e2e-validate` hard-fails on
  it anyway.

- **`README.md`** — replace the "DRAFT PENDING ADJUDICATION" paragraph under
  "Notes for reviewers" with the genealogist's conclusion and reasoning.
  Match the level of detail in `thomas-seaver-other-wife`'s or
  `heinrich-dewus-children-death`'s README.

- **`fixture.json`** — update `notes` if it still describes the fixture as
  an unverified draft.

**Never touch** `starting-tree.gedcomx.json`, `unstripped-tree.gedcomx.json`,
or `starting-research.json` — this task only edits the three files above;
those three are already correct and immutable.

## Step 5 — Validate

```bash
cd eval/harness && uv run python -m e2e.validate_fixture <slug>
# equivalently, from the repo root: make e2e-validate TEST=<slug>
```

This is a record-hint fixture, so a `WARN` naming the fixture's own subject
person is **expected, not a problem** — the subject legitimately stays in
the tree, since nothing was ever stripped. A hard `ERROR` means something
structural is actually wrong — fix it before handing off.

## Step 6 — Hand off

Tell the user the fixture is resolved. The next step is **Step 4** of
`docs/e2e-testing-guide.md` (debug live in Cowork) — Steps 2 and 3 don't
apply to this genre, because nothing was stripped and Step 5 above already
validated it.

## What you do not do

- Don't fetch or read the hint record yourself — the genealogist does that
  research by hand; you write up their conclusion.
- Don't touch `starting-tree.gedcomx.json`, `unstripped-tree.gedcomx.json`,
  or `starting-research.json`.
- Don't write any finding field spec §3.4 doesn't define.
- Don't skip Step 5 — an unvalidated fixture can silently ship a structural
  error.

## Re-invocation behavior

**Writes:** `expected-findings.json`, `README.md`'s "Notes for reviewers",
and `fixture.json`'s `notes`, all under `eval/tests/e2e/<slug>/`.

**On repeat invocation:** re-running re-resolves from the fixture's
current state — safe, since the current state (not history) is always the
starting point. If the fixture was already resolved (no "DRAFT PENDING
ADJUDICATION" left), confirm with the user before overwriting a settled
conclusion.
