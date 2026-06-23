---
name: author-e2e-fixture
model: claude-sonnet-4-6
description: Authors an end-to-end test fixture for the GPS research benchmark. Produces the five files an e2e fixture needs (fixture.json, starting-research.json, starting-tree.gedcomx.json, expected-findings.json, README.md) in the user's working folder, ready to be moved into a per-test directory under eval/tests/e2e/. Primary path starts from a FamilySearch person ID — reads the well-researched tree via person_read, strips a focused subset (the "answer"), and records what was stripped as expected findings. Two secondary paths: convert a just-completed research project, or — when there is no FamilySearch access — build PID-less from a bundled research document (report, research log, proof article), constructing the starting tree from the document and using a placeholder source_pid the author resolves before landing. Use when the user says "save this as an e2e test", "make a benchmark from this PID/research/report", "create an e2e fixture", or "author an e2e test". Do NOT use to interpret the result of an e2e run (use interpret-e2e-result), to run a new research project (use init-project), or to interpret the result of a unit-test run (those are developer-facing JSON files).
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

These live in `eval/tests/e2e/<slug>/` in the genealogy repo and become
a stakeholder-facing benchmark. They are **not** part of the user's own
research — this skill produces deliverables for the benchmark suite,
then leaves it to the user to validate, run, and commit them.

## Three paths

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

3. **Build PID-less from a research document** (secondary, no
   FamilySearch access). The user hands you a finished genealogy
   research artifact — a research report, research log, proof article,
   or family group record — instead of a PID. There is no `person_read`
   call: the **document is the ground truth**. You read the subject's
   known starting context and the documented conclusion straight out of
   the artifact, *construct* the starting tree from that known context
   (rather than stripping a `person_read` snapshot), and record the
   documented conclusion as the expected findings. Because no live
   person was read, `source_pid` is a **placeholder** (`PID-TODO`) —
   `subject_person_ids` and `source_pid` are free-form strings the
   schema does not constrain to a PID format, so a placeholder
   validates. Use this path when FamilySearch is unreachable (e.g. the
   skill is running outside the host) or the user only has a document.
   The PID value is inert — §6.1 blocks every person-keyed tool, so the
   run and the judge never read it; `source_pid` is provenance only and a
   Path-3 fixture is the **same kind of test** as a Path-1 one. Like
   *every* fixture (Path 1 included), it is a draft until a committed §14
   validity run passes (see the authoring note below). The only
   Path-3-specific care: the starting tree is *constructed*, not
   snapshotted, so check its fidelity, and flag any answer leaning on
   non-FamilySearch evidence.

Choose the path: if the user gives a PID (or asks to build "from a
person/PID"), use **path 1**. Use **path 2** only when `research.json`
and `tree.gedcomx.json` exist in the working folder **and**
`research.json` has at least one `proof_summaries` entry — and the user
wants to reuse that finished research. Use **path 3** when the user
provides a research *document* but no PID, or when `person_read` is
unavailable. When in doubt between 1 and 3, prefer path 1 if a PID and
FamilySearch access are both available; otherwise path 3.

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

**Path 3 — from a research document (secondary, PID-less).** The user
gives a research artifact (report / log / proof article / FGR) and no
PID. Do **not** call `person_read`.

- Confirm the subject is **deceased** from the document (era alone is
  usually decisive — 19th/early-20th-century subjects are deceased) and
  state it in the README.
- Read the document end to end. Separate two things: the **known
  starting context** (what the researcher already had going in — the
  "Background" / "Starting Point" / prior-research section) and the
  **documented conclusion** (the "Research Summary" / "Results" — the
  *answer* the agent must recover). The known context becomes the
  constructed starting tree (Step 4); the conclusion becomes the
  expected findings (Step 3).
- `source_pid` is the placeholder `PID-TODO`; the subject person's `id`
  in the constructed tree uses the same placeholder so the files agree.

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

`subject_person_ids` and `source_pid` are **not** pattern-constrained by
the schema, so on path 3 the placeholder `PID-TODO` validates — leave it
as the single entry in `subject_person_ids`. Its value is never read
during the run or by the judge (§6.1); it is a local join key plus
provenance, nothing more.

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

**Path 3 (from document).** Pull names/dates/places from the document's
**conclusion** section (Research Summary / Results / proof argument).
Cite the document's own source references under `supporting_sources`
(verbatim is fine — they are judge context only). Flag in `notes`
whenever the conclusion leans on evidence the FamilySearch tools cannot
reach (Ancestry, Find A Grave, county-clerk or overseas archives) — that
shapes the later validity run and may need bundled provided-documents
(spec §6.2).

The template at `templates/expected-findings.json` has placeholders for
the common fields. Keep findings short and judge-friendly. Avoid
record-locator literals like "ARK 1:1:XXXX" — the agent may find the
right answer via a different source path.

### Step 4 — Build `starting-tree.gedcomx.json`

**Paths 1 and 2 (strip an existing tree).** Take the **unstripped
tree** — the `person_read` result from Step 1 (path 1) or the project's
current `tree.gedcomx.json` (path 2) — write it to the output folder,
then strip the items that correspond to each expected finding. For each
finding:

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

**Path 3 (construct, don't strip).** There is no unstripped tree to
start from — you build one. Emit the simplified-GedcomX shape
(`{persons, relationships, sources}`, per `simplified-gedcomx-spec.md`)
containing **only the known starting context** from the document:

- The subject person (`id` = `PID-TODO`, `living: false`) with the
  facts the researcher already had going in (name, and known vitals /
  residences that are *not* the answer).
- Known relatives that anchor the search but are not themselves the
  answer, with `Couple` / `ParentChild` relationships (parent =
  `person1`, child = `person2`).
- `sources` may be a short list of `{id, title}` for the records the
  starting context rests on, or empty.

Use synthetic string ids throughout (`p-spouse`, `rel-1`, any unique
fact/name id). The point is the same as stripping: the constructed tree
must **not** contain any expected finding, so the agent has to recover
it from records. Because you are building rather than removing, the risk
is *adding* the answer by accident — double-check that no constructed
fact or relative is one of the findings.

After stripping (paths 1–2) or constructing (path 3), sanity-check:
every expected finding should be genuinely absent from the resulting
tree. Re-read the tree and confirm before writing. The mechanical check
is the stripping linter — once the fixture is under
`eval/tests/e2e/<slug>/`, the user runs `ValidateFixture.bat` (enter the
slug) or `make e2e-validate TEST=<slug>` and resolves any `WARN` before
committing.

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

**Path 3 only — add an authoring note.** Append a short paragraph to the
README stating that the starting tree was *constructed from the bundled
research document* (name it) rather than a live `person_read` snapshot,
so its fidelity should be sanity-checked; that `source_pid` is an unused
placeholder — provenance only, since §6.1 blocks every person-keyed tool
so neither the run nor the judge reads the PID — which the author may
fill in later if a re-snapshot or provenance link is wanted; and that
the landing gate is the same as for every fixture (Path 1 included): a
passing §14 validity run (a real passing run plus the stripping linter).
Flag any answer that leans on non-FamilySearch evidence.

### Step 6 — Write the files

Choose the output directory, where `<slug>` is the fixture id:

- **Inside the genealogy repo (normal case):** if `eval/tests/e2e/`
  exists under the working folder, write the five files **directly**
  into `eval/tests/e2e/<slug>/`. No move needed — the linter and runner
  both resolve fixtures by slug from `eval/tests/e2e/`.
- **Otherwise** (e.g. path 2 run from a research-project folder that
  isn't the repo): write them into a `<slug>/` subdirectory of the
  working folder and tell the user to move it into
  `eval/tests/e2e/<slug>/` (this skill cannot write outside the working
  folder).

End by listing the files written and the next step. When written in
place under the repo:

> Five fixture files written to `eval/tests/e2e/<slug>/`:
>   - `fixture.json`
>   - `starting-research.json`
>   - `starting-tree.gedcomx.json`
>   - `expected-findings.json`
>   - `README.md`
>
> Next steps (your call — not run yet):
> 1. **Lint** — `ValidateFixture.bat` (enter `<slug>`) or
>    `make e2e-validate TEST=<slug>`; resolve any `WARN`.
> 2. **Run once** — `RunE2E.bat` (enter `<slug>`) or
>    `make e2e-run TEST=<slug>` (live; 20–60 min, $3–10).
> 3. **Verdict** — `/interpret-e2e-result`.
> 4. If it passes, commit the fixture (and its run log) and open a PR.

(If you wrote to a `<slug>/` subfolder instead, tell the user to move
`<slug>/` into `eval/tests/e2e/<slug>/` first, then run the linter.)

## Sanity checks before reporting done

- All four JSON files parse without error.
- `expected-findings.json` describes findings genuinely absent from
  `starting-tree.gedcomx.json` — re-read the stripped tree once more.
  The mechanical gate is the stripping linter (above); recommend it.
- The research question is natural-language (no record-locator
  literals).
- `fixture.json::difficulty` matches `README.md`'s difficulty line.
- The `<slug>` matches `fixture.json::id` and the output directory name.

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
7. Report the files written (in place under `eval/tests/e2e/<slug>/`)
   and point the user at the linter, the run (`make e2e-run` /
   `RunE2E.bat`), and `/interpret-e2e-result`.

*Path 2 (convert a finished project)* differs only at the start: instead
of a PID + `person_read`, detect an open project whose `research.json`
has `proof_summaries`, pick which proof conclusion to capture, and use
the project's current `tree.gedcomx.json` as the unstripped tree. Steps
3–7 are the same.

*Path 3 (from a research document, PID-less)* also skips `person_read`:
read the artifact, split it into known starting context vs. documented
conclusion, **construct** the starting tree from the known context
(Step 4, path-3 branch), record the conclusion as expected findings, and
use the `PID-TODO` placeholder for `source_pid`. Skip step 6's
schema-validation only if `validate_research_schema` is unavailable in
the environment; otherwise validate as usual. Add the path-3 authoring
note to the README and flag any non-FamilySearch evidence in `notes`.

## Re-invocation behavior

**Writes:** five files — `fixture.json`, `starting-research.json`,
`starting-tree.gedcomx.json`, `expected-findings.json`, and
`README.md` — into `eval/tests/e2e/<slug>/` when run inside the repo
(otherwise a `<slug>/` subdirectory of the working folder). Path 1
reads only FamilySearch (via `person_read`) and writes nothing but the
outputs. Path 2 additionally reads the project's `research.json` and
`tree.gedcomx.json` as read-only inputs and never modifies them. Path 3
reads only the supplied research document (read-only) and calls no MCP
tools — its `source_pid` is an unused placeholder, and like any fresh
fixture it is a draft until a §14 validity run passes (the PID is
provenance, not a gate). The outputs are benchmark deliverables, not the
user's project state.

**On repeat invocation:** re-running with the same `<slug>` overwrites
the five files in that `<slug>/` directory with a fresh capture. A
different `<slug>` produces a separate directory and leaves the prior
one untouched.

**Do not duplicate:** keep one `<slug>/` directory per fixture. If a
directory for the slug already exists, refresh its files in place
rather than creating a suffixed parallel copy.
