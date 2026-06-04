---
name: author-e2e-fixture
model: claude-sonnet-4-6
description: Authors an end-to-end test fixture for the GPS research benchmark. Produces the five files an e2e fixture needs (fixture.json, starting-research.json, starting-tree.gedcomx.json, expected-findings.json, README.md) in the user's working folder, ready to be moved into eval/tests/e2e/<slug>/. Primary path converts a just-completed research project into a fixture by stripping the answer from the tree and recording it as expected findings. Use when the user says "save this as an e2e test", "make a benchmark from this research", "create an e2e fixture", or "author an e2e test". Do NOT use to interpret the result of an e2e run (use interpret-e2e-result), to run a new research project (use init-project), or to interpret the result of a unit-test run (those are developer-facing JSON files).
allowed-tools:
  - validate_research_schema
---

# Author E2E Fixture

**Narration:** Read `researcher_profile.narration_guidance` from `research.json` and apply it as your narration style for this invocation. If absent, default to a one-line preamble per action.

Builds the five files an e2e benchmark fixture needs:

- `fixture.json` — metadata (research question, tags, caps, difficulty)
- `starting-research.json` — the project state the agent starts from
- `starting-tree.gedcomx.json` — the tree with the answer stripped
- `expected-findings.json` — what the agent should recover
- `README.md` — human notes (source PID, deceased line, stripping summary)

These are committed to `eval/tests/e2e/<slug>/` in the genealogy repo
and become a stakeholder-facing benchmark. They are **not** part of
the user's own research — this skill produces deliverables for the
benchmark suite, then leaves it to the user to land them in the repo.

## Two paths

1. **Convert a finished research project into a fixture** (preferred).
   The user has just finished researching a question in this project
   folder. The current `research.json` has proof_summaries; the
   current `tree.gedcomx.json` contains the answer. This skill snapshots
   the resolved state, strips the answer, and records what was stripped
   as expected findings.

2. **Author from scratch.** No active research project. The user
   describes a research question, the source PID, the expected
   findings, and the stripping pattern manually. Used when seeding
   the suite or capturing a fixture from outside this folder.

Detect which path applies by checking whether `research.json` and
`tree.gedcomx.json` exist in the working folder and whether
`research.json` has at least one entry in `proof_summaries`.

## Preconditions

- The subject person must be **deceased**. FamilySearch ToS forbids
  committing fixtures about living persons. Confirm this with the user
  before writing files.
- Pick a focused research question with 1–5 expected findings. Larger
  fixtures are too expensive to grade and obscure regression causes.
  If the user has more than five findings in mind, ask which subset
  to capture.
- The fixture goes in the *test corpus*, not the user's research.
  Make this clear at the start: the user's `research.json` and
  `tree.gedcomx.json` are read-only inputs; outputs go to a separate
  subfolder.

## What to do

### Step 1 — Confirm path and gather metadata

If `research.json` + `tree.gedcomx.json` exist and `proof_summaries`
is non-empty, propose the **convert** path. Show the user a one-line
summary of each proof conclusion and ask: "Which of these should the
fixture's agent be asked to recover?" One question per fixture.

If those files are absent or `proof_summaries` is empty, fall back to
the **scratch** path. Ask the user to provide:
- the source FamilySearch person ID
- the research question (natural language)
- the expected findings (free-text — you'll structure them in Step 3)

Then ask for the rest of the metadata in one batch:
- **Slug** — short kebab-case identifier (e.g., `smith-parents-1850`).
- **Question type tag** — one of `parents`, `children`, `siblings`,
  `spouse`, `birth_date`, `death_date`, `marriage`, `migration`,
  `occupation`, `other`.
- **Era tag** — decade or century (e.g., `1850s`, `1800s`).
- **Geography tag** — ISO-style region code (e.g., `US-VA`, `IE`).
- **Difficulty** — `easy`, `moderate`, or `hard`.
- **Notes** — one or two sentences for someone reviewing a failed run.

Use these answers to fill `fixture.json` from
`templates/fixture.json`. Default `captured` to today's date in
`YYYY-MM-DD` form.

### Step 2 — Build `starting-research.json`

Read `templates/starting-research.json`. Substitute the placeholders
with the values gathered in Step 1. All array fields stay empty —
the agent starts from a clean slate. `narration_guidance` is hard-coded
to `"concise"` in the template so narration style doesn't vary across
runs.

After writing, call `validate_research_schema` on the file. If it
fails, fix the issue and re-validate before proceeding.

### Step 3 — Build `expected-findings.json`

**Convert path.** Read the relevant `proof_summaries` entry from the
user's current `research.json`. For each conclusion that the agent
should recover, emit one finding:

- `type`: `relationship` for person-to-person links, `fact` for
  vitals (birth, death, marriage dates/places), `person` for new
  persons, `source` for record attachments.
- `description`: a plain-language sentence the judge reads.
- `details`: structured data — shape varies by type. Pull names,
  dates, places from the proof summary.
- `supporting_sources`: free-text source descriptions for the judge's
  context (it doesn't strict-match these). One or two is enough.
- `required`: `true` for findings the agent must produce to pass,
  `false` for bonus credit.

**Scratch path.** Walk the user through one finding at a time, asking
for the same fields. The template at
`templates/expected-findings.json` has placeholders for the common
fields.

Keep findings short and judge-friendly. Avoid record-locator literals
like "ARK 1:1:XXXX" — the agent may find the right answer via a
different source path.

### Step 4 — Build `starting-tree.gedcomx.json`

**Convert path.** Copy the current `tree.gedcomx.json` to the output
folder, then strip the items that correspond to each expected
finding. For each finding:

- Type `relationship` → remove the relationship entries that link the
  subject and target persons. If the target person exists *only*
  because of this relationship and isn't anchored by other evidence,
  remove the target person too. Remove sources that attest the
  relationship.
- Type `fact` → remove the fact from the subject person's `facts`
  array. Remove sources that attest the fact.
- Type `person` → remove the person and any relationships referencing
  them, plus sources that attest them.
- Type `source` → remove the source entry and any assertions citing
  it. (Rare — a fixture usually strips facts/persons, not bare
  sources.)

After stripping, sanity-check: every expected finding should be
genuinely absent from the resulting tree. Re-read the tree and
confirm before writing.

**Scratch path.** The user provides the unstripped tree (e.g., from
a previous `tree_read` call). Apply the same stripping logic. If
they don't have a tree on hand, explain that the e2e suite is rooted
in real FS persons and they need to run `tree_read` first in a
project that has a `research.json` — then come back to this skill.

### Step 5 — Build `README.md`

Read `templates/README.md`. Fill in:
- `{{name}}` and `{{source_pid}}` from `fixture.json`.
- `{{primary_person_name}}` — the subject person.
- `{{researcher_question}}`.
- `{{stripped_summary}}` — one bullet per stripped item, e.g.
  "Removed parent person Robert Smith (PID XXXX-YYY) and the
  parent-child relationship to John Smith. Removed two 1850 census
  sources that attested the parentage."
- `{{difficulty}}` and `{{difficulty_reason}}` — restate the
  difficulty and give a one-line rationale.
- `{{notes}}` from the metadata gathered in Step 1.

### Step 6 — Write the files

Write all five files into a `<slug>/` subdirectory of the user's
working folder, where `<slug>` is the fixture id. The user then moves
the directory into `eval/tests/e2e/<slug>/` in the genealogy repo
(this skill cannot write outside the working folder).

End by listing the files written and the next step:

> Five fixture files written to `<slug>/`:
>   - `fixture.json`
>   - `starting-research.json`
>   - `starting-tree.gedcomx.json`
>   - `expected-findings.json`
>   - `README.md`
>
> To land this in the benchmark, move `<slug>/` into
> `eval/tests/e2e/<slug>/` in the genealogy repo and open a PR.

## Sanity checks before reporting done

- All four JSON files parse without error.
- `expected-findings.json` describes findings genuinely absent from
  `starting-tree.gedcomx.json` — re-read the stripped tree once more.
- The research question is natural-language (no record-locator
  literals).
- `fixture.json::difficulty` matches `README.md`'s difficulty line.
- The `<slug>` matches `fixture.json::id` and the subdirectory name.

If any check fails, fix the file before reporting done.

## Example

User: "Save this research as an e2e fixture."

You should:
1. Detect that `research.json` has a completed `proof_summaries` entry
   resolving "Who was Patrick Flynn's father?"
2. Confirm the subject (Patrick Flynn) is deceased.
3. Ask the user to confirm the research question and pick which proof
   conclusion to capture.
4. Gather metadata: slug (`flynn-father-1850`), tags (parents / 1850s
   / US-PA), difficulty (`moderate`), notes.
5. Build the four JSON files and the README using the templates.
6. Validate `starting-research.json` against the schema.
7. Report the files written and tell the user to move the folder into
   the genealogy repo.
