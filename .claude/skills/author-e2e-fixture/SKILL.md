---
name: author-e2e-fixture
model: claude-sonnet-4-6
description: Authors an end-to-end test fixture for the GPS research benchmark. Produces the five files an e2e fixture needs (fixture.json, starting-research.json, starting-tree.gedcomx.json, expected-findings.json, README.md) in the user's working folder, ready to be moved into a per-test directory under eval/tests/e2e/. Primary path starts from a FamilySearch person ID — reads the well-researched tree via person_read, strips a focused subset (the "answer"), and records what was stripped as expected findings. Secondary path converts a just-completed research project. Use when the user says "save this as an e2e test", "make a benchmark from this PID/research", "create an e2e fixture", or "author an e2e test". Do NOT use to interpret the result of an e2e run (use interpret-e2e-result), to run a new research project (use init-project), or to interpret the result of a unit-test run (those are developer-facing JSON files).
allowed-tools:
  - person_read
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

1. **Start from a FamilySearch PID** (primary). The user gives a
   person ID for a well-researched, deceased person. This skill reads
   that person's tree directly from FamilySearch via `person_read`,
   the user picks a focused subset to strip (the "answer"), and the
   skill strips it and records what was stripped as expected findings.
   The well-researched tree on FamilySearch **is** the ground truth —
   no prior research project, no `proof_summaries`, and no finished GPS
   work are required. This is the path for seeding the benchmark suite.

2. **Convert a finished research project** (secondary). The user has
   just finished researching a question in this project folder, so the
   current `research.json` has `proof_summaries` and the current
   `tree.gedcomx.json` already contains the answer. This skill reuses
   those `proof_summaries` as a ready-made statement of the answer
   (saving you from deciding what to strip), then strips it from the
   project's tree. Use this only when such a finished project is open.

Choose the path: if the user gives a PID (or asks to build "from a
person/PID"), use **path 1**. Use **path 2** only when `research.json`
and `tree.gedcomx.json` exist in the working folder **and**
`research.json` has at least one `proof_summaries` entry — and the user
wants to reuse that finished research. When in doubt, prefer path 1.

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

**Path 1 — from a PID (primary).** The user gives a FamilySearch
person ID for a well-researched person.

- Confirm the person is **deceased** before reading or writing anything
  (FS ToS — see Preconditions).
- Call `person_read` with `personId` set to the PID and
  `relatives: true`, `sourceDescriptions: true`, so the returned tree
  includes parents/spouses/children and attached sources — the material
  a fixture strips. (`person_read` requires authentication; if it
  reports you're not logged in, tell the user to run the `login` tool
  on the host, then retry.)
- This returns simplified GEDCOMX (persons, relationships, sources) —
  the same shape as `tree.gedcomx.json`. Keep it; it is the
  *unstripped* tree you'll strip in Step 4.
- Summarize what the person is well-attested for (e.g. "parents Robert
  & Mary; death 1879 Augusta Co. VA; 1850/1860 census"), then ask the
  user: "Which one focused subset should the fixture's agent recover?"
  One research question per fixture, answerable with 1–5 findings.

**Path 2 — convert a finished project (secondary).** Use only when
`research.json` + `tree.gedcomx.json` exist in the working folder and
`research.json` has a non-empty `proof_summaries`, and the user wants
to reuse that research. Show a one-line summary of each proof
conclusion and ask: "Which of these should the fixture's agent be asked
to recover?" The current `tree.gedcomx.json` is the unstripped tree for
Step 4 (no `person_read` call needed — the answer is already in it).

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

`project.id` must match the schema's `^rp_` pattern: fill
`{{slug_underscored}}` with the fixture slug with hyphens replaced by
underscores (e.g. slug `kenneth-quass-death` → `rp_kenneth_quass_death`).

`validate_research_schema` reads files named exactly `research.json` and
`tree.gedcomx.json`, not the `starting-` prefixed names. To validate,
copy `starting-research.json` → `research.json` and
`starting-tree.gedcomx.json` → `tree.gedcomx.json` into a scratch dir,
point the validator at that dir, then delete the scratch copies. If it
fails, fix the issue and re-validate before proceeding.

### Step 3 — Build `expected-findings.json`

For each thing the agent should recover, emit one finding. The fields
are the same on both paths; only the *source* of the facts differs.

- `type`: `relationship` for person-to-person links, `fact` for
  vitals (birth, death, marriage dates/places), `person` for new
  persons, `source` for record attachments.
- `description`: a plain-language sentence the judge reads.
- `details`: structured data — shape varies by type.
- `supporting_sources`: free-text source descriptions for the judge's
  context (it doesn't strict-match these). One or two is enough.
- `required`: `true` for findings the agent must produce to pass,
  `false` for bonus credit.

**Path 1 (from PID).** Pull the names, dates, places, and relationships
straight from the `person_read` tree you read in Step 1 — for the
subset the user chose to strip. Each thing you're about to remove in
Step 4 becomes one finding here. (`details` shapes "vary by type"; put
the target person's name and key facts under a `target_person` /
`person` / `name` key so the stripping linter can find them.)

**Path 2 (convert project).** Read the relevant `proof_summaries` entry
from the user's current `research.json` and pull names/dates/places
from the proof summary instead.

The template at `templates/expected-findings.json` has placeholders for
the common fields. Keep findings short and judge-friendly. Avoid
record-locator literals like "ARK 1:1:XXXX" — the agent may find the
right answer via a different source path.

### Step 4 — Build `starting-tree.gedcomx.json`

Take the **unstripped tree** — the `person_read` result from Step 1
(path 1) or the project's current `tree.gedcomx.json` (path 2) — write
it to the output folder, then strip the items that correspond to each
expected finding. For each finding:

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
genuinely absent from the resulting tree. Re-read the tree and confirm
before writing. The mechanical check is the stripping linter — once the
fixture folder lands under `eval/tests/e2e/<slug>/`, the user runs
`uv run python -m e2e.validate_fixture <slug>` (from `eval/harness/`)
and resolves any `WARN` before committing.

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
> `eval/tests/e2e/<slug>/` in the genealogy repo, then run the stripping
> linter (`uv run python -m e2e.validate_fixture <slug>` from
> `eval/harness/`) and resolve any `WARN` before opening a PR.

## Sanity checks before reporting done

- All four JSON files parse without error.
- `expected-findings.json` describes findings genuinely absent from
  `starting-tree.gedcomx.json` — re-read the stripped tree once more.
  The mechanical gate is the stripping linter (above); recommend it.
- The research question is natural-language (no record-locator
  literals).
- `fixture.json::difficulty` matches `README.md`'s difficulty line.
- The `<slug>` matches `fixture.json::id` and the subdirectory name.

If any check fails, fix the file before reporting done.

## Example

User: "Make an e2e fixture from FamilySearch person KNDX-MKG."

You should (path 1 — from a PID):
1. Confirm the person (e.g. John Smith) is deceased before reading.
2. Call `person_read` with `personId: "KNDX-MKG"`, `relatives: true`,
   `sourceDescriptions: true`. (If it reports not-logged-in, ask the
   user to run the `login` tool on the host, then retry.)
3. Summarize what John is well-attested for and ask which subset to
   strip — say, "Who were John Smith's parents?".
4. Gather metadata: slug (`smith-parents-1850`), tags (parents / 1850s
   / US-VA), difficulty (`easy`), notes.
5. Build the four JSON files and the README: expected findings from the
   chosen subset of the `person_read` tree; the stripped tree by
   removing the parents (and their attesting sources) from that tree.
6. Validate `starting-research.json` against the schema.
7. Report the files written and tell the user to move the folder into
   the genealogy repo.

*Path 2 (convert a finished project)* differs only at the start: instead
of a PID + `person_read`, detect an open project whose `research.json`
has `proof_summaries`, pick which proof conclusion to capture, and use
the project's current `tree.gedcomx.json` as the unstripped tree. Steps
3–7 are the same.

## Re-invocation behavior

**Writes:** five files — `fixture.json`, `starting-research.json`,
`starting-tree.gedcomx.json`, `expected-findings.json`, and
`README.md` — into a `<slug>/` subdirectory of the user's working
folder. Path 1 reads only FamilySearch (via `person_read`) and writes
nothing but the outputs. Path 2 additionally reads the project's
`research.json` and `tree.gedcomx.json` as read-only inputs and never
modifies them. The outputs are benchmark deliverables, not the user's
project state.

**On repeat invocation:** re-running with the same `<slug>` overwrites
the five files in that `<slug>/` subdirectory with a fresh capture. A
different `<slug>` produces a separate subdirectory and leaves the
prior one untouched.

**Do not duplicate:** keep one `<slug>/` subdirectory per fixture. If a
subdirectory for the slug already exists, refresh its files in place
rather than creating a suffixed parallel copy.
