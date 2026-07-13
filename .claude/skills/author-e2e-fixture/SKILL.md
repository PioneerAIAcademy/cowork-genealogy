---
name: author-e2e-fixture
model: claude-sonnet-4-6
description: Authors an end-to-end test fixture for the GPS research benchmark. Produces the files an e2e fixture needs (fixture.json, starting-research.json, starting-tree.gedcomx.json, expected-findings.json, README.md, and — on the FamilySearch path — unstripped-tree.gedcomx.json) directly in eval/tests/e2e/<slug>/. Primary path starts from a FamilySearch person ID — snapshots the well-researched tree, strips a focused subset (the "answer"), and records what was stripped as expected findings. One secondary path: when there is no FamilySearch access, build PID-less from a bundled research document (report, research log, proof article), constructing the starting tree from the document and using a placeholder source_pid the author resolves before landing. Use when the user says "save this as an e2e test", "make a benchmark from this PID/research/report", "create an e2e fixture", or "author an e2e test". Do NOT use to interpret the result of an e2e run (use interpret-e2e-result), to run a new research project (use init-project), or to interpret the result of a unit-test run (those are developer-facing JSON files).
allowed-tools:
  - Bash
  - Read
  - Write
  - Glob
---

# Author E2E Fixture

**Narration:** Read `researcher_profile.narration_guidance` from `research.json` and apply it as your narration style for this invocation. If absent, default to a one-line preamble per action.

An e2e fixture is a research question whose answer has been removed
from a real tree, so a benchmark run can be scored on whether the
agent recovers it. You write the judgement calls; a script does the
mechanical work.

**You must be in the genealogy repo.** Every command below is run from
the repo root, and the files are written straight into
`eval/tests/e2e/<slug>/`. If `eval/tests/e2e/` doesn't exist under the
working folder, stop and tell the user to run this from the repo.

**The subject must be deceased.** FamilySearch's terms forbid
committing fixtures about living persons, and this fixture will be
committed. Confirm it with the user **before** you fetch anything. The
`snapshot` script re-checks every person in the tree — not just the
subject — and refuses on any who are living or unmarked.

## Two paths

1. **From a FamilySearch PID** (primary — "the PID path"). The user
   names a well-researched, deceased person. The FamilySearch tree
   **is** the ground truth — no prior research project needed. This is
   how the benchmark suite gets seeded.
2. **From a research document, PID-less** (secondary). The user hands
   you a report / research log / proof article / family group record
   and no PID. The **document** is the ground truth. You *construct* the
   starting tree from the document's known starting context rather than
   stripping a snapshot, so there is no unstripped tree and no `strip`
   step.

Prefer the PID path whenever a PID and FamilySearch access are both
available. Converting a **finished research project** is the PID path
too: use the subject's PID, and read the project's `proof_summaries`
entry first — it is a ready-made statement of the answer. Only when
FamilySearch does not reflect the project's conclusions does the
project's report become a PID-less document instead.

## Step 1 — Agree on the question and the metadata

**PID path.** Confirm the person is deceased, then snapshot:

```
cd eval/harness && uv run python -m e2e.author snapshot --slug <slug> --pid <PID>
```

This fetches the tree, normalizes it, writes
`eval/tests/e2e/<slug>/unstripped-tree.gedcomx.json`, and prints an id
index: every person, relationship, fact and source, with the ids that
`strip` selects by. **Read the ids off the index; never guess them.**
FamilySearch's own ids are preserved verbatim, so a fact id is usually a
UUID and a source id a PID; only names and relationships, which
FamilySearch does not identify, get short synthesized ids.
(Not signed in? Tell the user to run
`Login.bat`, or `make e2e-login` for developers, then retry.)

**PID-less.** No snapshot — there is nothing to fetch. Read the document
end to end and separate two things: the **known starting context** (the
"Background" / "Starting Point" section — what the researcher already
had) from the **documented conclusion** (the "Research Summary" /
"Results" — the answer the agent must recover).

Then, in **one** message, summarize what the subject is well-attested
for and ask the user for everything you still need:

- Which one focused subset should the agent recover? (One research
  question, 1–5 findings. More than five is too expensive to grade and
  obscures the cause of a regression.)
- **Slug** — kebab-case, e.g. `smith-parents-1850`.
- **Question type** — `parents`, `children`, `siblings`, `spouse`,
  `birth_date`, `death_date`, `marriage`, `migration`, `occupation`, `other`.
- **Era** — e.g. `1850s`. **Geography** — e.g. `US-VA`.
- **Difficulty** — `easy`, `medium`, or `hard`, and a one-line reason.
- **Notes** — one or two sentences for whoever reviews a failed run.

(Snapshot first, ask second: the index tells you what the person is
actually attested for, so the question you propose is a real one.)

## Step 2 — Scaffold

```
cd eval/harness && uv run python -m e2e.author scaffold --slug <slug> \
  --name "<display name>" --pid <PID> --question "<researcher question>" \
  --question-type parents --era 1850s --geography US-VA \
  --difficulty easy --notes "<notes>"
```

Writes `fixture.json` and `starting-research.json`. On the **PID-less path** omit
`--pid` and pass `--subject-id I1` instead. `source_pid` then stays the
placeholder `PID-TODO` — provenance only, since §6.1 blocks every
person-keyed tool, so neither the run nor the judge reads it — while
`subject_person_ids` points at a person id the tree schema accepts,
which `PID-TODO` is not.

## Step 3 — Write `expected-findings.json`

One finding per thing the agent should recover. This is yours to write;
fill in `templates/expected-findings.json` (under this skill's own
folder — `scaffold`'s two templates live in the harness instead).

- `type`: `relationship` for person-to-person links, `fact` for vitals,
  `person` for new persons, `source` for record attachments.
- `description`: a plain-language sentence the judge reads.
- `details`: put the **target** person's name under a `target_person` /
  `person` / `name` key, and the subject's under `subject_person` — the
  stripping linter reads exactly those keys to tell "the answer is still
  in the tree" from "a relative who shares a surname".
- `supporting_sources`: free text for the judge's context; one or two.
- `required`: `true` to pass, `false` for bonus credit.
- `polarity`: omit for a normal recover-this finding. `"avoid"` marks a
  claim the agent must **NOT** assert (spec §3.4.1) — the judge passes
  it when the claim is absent from the final tree, and the harness
  re-checks that mechanically (a matching person in the final tree
  forces the finding to fail). Pair a `required` avoid guard with a
  `required` recover finding that the agent documented the negative
  conclusion, so a run that does nothing does not pass by default.

Pull the names, dates and places from the id index (PID path) or the
document's conclusion section (PID-less). Keep findings short. Avoid record-locator literals like
"ARK 1:1:XXXX" — the agent may reach the right answer by a different
source path.

On the PID-less path, flag in `notes` any conclusion leaning on evidence the
FamilySearch tools cannot reach (Ancestry, Find A Grave, county-clerk or
overseas archives). That shapes the validity run and may need bundled
`provided-documents/` (spec §6.2).

## Step 4 — Build `starting-tree.gedcomx.json`

**PID path — strip.** Name every id from the index that must go.
The script cascades, validates, and lints:

```
cd eval/harness && uv run python -m e2e.author strip --slug <slug> \
  --persons L2QR-9XY,M4TT-2BC \
  --facts KNDX-MKG:9381f219-2889-4bfc-9b03-5527232282c1 --facts R4:F12 \
  --sources 7BL6-KLH,9V1G-YQQ
```

- Removing a **person** cascades to every relationship touching them —
  don't name those separately. Use `--relationships R7` only to sever a
  link while keeping both persons (e.g. hiding a marriage).
- `--facts` is `<owner>:<fact-id>`, where the owner is a person **or a
  relationship** (a `Marriage` lives on the `Couple` relationship).
- **Sources are never cascaded.** Whether a source attests the stripped
  fact is your judgement; name each one.
- Add `--dry-run` to see the removals without writing, before
  `expected-findings.json` exists.

It reads `unstripped-tree.gedcomx.json` and writes
`starting-tree.gedcomx.json` — never its own output, so you can re-run it
with a different selector set as many times as you like. It prints a
`stripped_summary` for the README, and a `WARN` for anything that looks
like an answer left behind. Resolve every `WARN`.

**PID-less — construct.** Build the simplified-GedcomX shape
(`{persons, relationships, sources}`, per `simplified-gedcomx-spec.md`)
holding **only the known starting context**:

- The subject (`id: "I1"`, `living: false`) with the facts the
  researcher already had — name, and vitals or residences that are *not*
  the answer.
- Relatives who anchor the search but are not themselves the answer.
  `ParentChild` uses the keys `parent` and `child`; `Couple` uses
  `person1` and `person2`.
- Names need both halves: `given` and `surname` are required. When one
  is genuinely unknown, use `""` — never omit the field.
- Ids: any non-empty string, unique within its collection. Nothing reads
  meaning out of an id's shape, so follow the convention — persons `I1`,
  `I2`, …; names `N1`…; facts `F1`…; relationships `R1`…; sources `S1`… —
  purely because it reads well. `sources` may be a short list of
  `{id, title}`, or empty.

Building rather than removing inverts the risk: the danger is *adding*
the answer by accident.

## Step 5 — Write `README.md`

Fill in `templates/README.md` (under this skill's own folder).
`{{stripped_summary}}` is the bullet list
`strip` printed (PID-less: describe what you constructed and from which
document instead). State plainly that the subject is deceased.

On the **PID-less path**, add a short authoring note: the starting tree was
constructed from the named document rather than snapshotted, so its
fidelity should be sanity-checked; `source_pid` is an unused
placeholder; and the landing gate is the same as for every fixture — a
passing §14 validity run.

## Step 6 — Validate, then hand off

```
cd eval/harness && uv run python -m e2e.author validate --slug <slug>
```

Checks both files against the JSON Schemas, re-runs the living-person
gate over the whole tree, re-runs the stripping linter, and — on the
PID path — confirms every expected finding was actually *present* in the
unstripped tree before you removed it. Fix anything it reports.

Then report the files written and stop. Do not run, commit, or push.

> Fixture written to `eval/tests/e2e/<slug>/`.
>
> Next steps (your call — not run yet):
> 1. **Seed an editable project** — `SeedProject.bat` (enter `<slug>`) or
>    `make e2e-project TEST=<slug>`. It copies the fixture's starting state
>    into `eval/e2e-project/<slug>/` (throwaway, never committed).
> 2. **Watch it run** — open `eval/e2e-project/<slug>/` in the Claude Desktop
>    **Cowork** tab and run `/research`. Open the same folder in the Research
>    Viewer (`Viewer.bat` / `make electron`) to follow along.
> 3. Commit the fixture directory and open a PR.

Do **not** tell the user to run the scored headless test — that is the internal
team's step, and they run it after the fixture lands. A live `/research` run
does not block the tree-reading tools, so the agent can read the answer off the
live tree: the live run tells you the fixture is *sensible and answerable*, it
is **not** a pass/fail verdict. Say so when you hand off step 2.

## Record-hint fixtures (`genre: "record-hint"`)

A third form of the PID path, for when the research objective comes
from a **record hint**: the answer was never in the tree — it lives in
a historical record matched to the tree person with unverified
confidence (spec §3.6). Differences from the strip flow:

1. `snapshot` as usual. The answer must **not** appear in the id
   index — if it does, this is a normal strip fixture instead.
2. `scaffold ... --genre record-hint`.
3. Write `expected-findings.json` from the record's content. When the
   hint is unverified, say in `notes` and the README that the findings
   are a draft pending genealogist adjudication — and that a false
   match converts them to a `polarity: "avoid"` guard plus a required
   documented-negative-conclusion finding (Step 3).
4. `strip --slug <slug> --none` — writes the starting tree as an exact
   copy of the snapshot. Keep `unstripped-tree.gedcomx.json`
   committed; `validate` requires the two files to be identical in
   this genre (and skips the presence mirror, since the findings are
   extra-tree by design).

## Re-invocation

**Writes** into `eval/tests/e2e/<slug>/`: `fixture.json`,
`starting-research.json`, `starting-tree.gedcomx.json`,
`expected-findings.json`, `README.md`, plus (PID path)
`unstripped-tree.gedcomx.json`. The PID-less path reads only the
supplied document.

A fixture is **snapshotted once**. `snapshot` refuses to overwrite an
existing `unstripped-tree.gedcomx.json`: re-fetching a mutable upstream
would silently rewrite the test, and a run's score would no longer be
comparable to last month's. To re-strip, just re-run `strip` — it always
works from the committed snapshot. To check whether FamilySearch has
drifted under a fixture, `snapshot --slug <slug> --pid <PID> --check`
reports the differences and writes nothing.

Keep one directory per fixture; refresh in place rather than creating a
suffixed parallel copy.
