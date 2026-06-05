---
name: init-project
model: claude-sonnet-4-6
description: Initializes a new genealogy research project with GPS-conformant
  file structures. Creates research.json (GPS audit trail) and
  tree.gedcomx.json (simplified GedcomX deliverable) from a FamilySearch
  person ID. If the user does not have a FamilySearch ID, searches the
  Family Tree by name using person_search to find the right person.
  Implements Steps 1-2 of the genealogical research process (define the
  problem and survey known information). Use when the user says "new
  project", "start research", "research [person]", "find parents of",
  "begin researching", "I don't have their FamilySearch ID", or provides
  a FamilySearch person ID to start working with. Do NOT use when a
  research.json file already exists in the folder — use project-status
  instead to resume an existing project.
allowed-tools:
  - person_read
  - person_search
  - place_search
---

# Init Project

**Guard clause — run this BEFORE anything else, including file reads:**
If `research.json` already exists in the current working directory, respond with exactly this one line and stop — no tool calls, no file reads, no further analysis:
> "This project already has a `research.json` — use **question-selection** to add a research question, or **project-status** to review the current state."
Do NOT call `validate_research_schema`, `person_read`, or any other tool. Do NOT read any project files. Stop immediately after that one-line response.

**Narration (new projects only):** Read `researcher_profile.narration_guidance` from `research.json` and apply it as your narration style for this invocation. If absent (e.g. this is a brand-new project still being initialized), default to a one-line preamble per action — the profile gets written in Step 4 and takes effect on the next skill invocation.

Creates a new genealogy research project by fetching a person from the
FamilySearch tree and initializing the two project files:

- `research.json` — the GPS audit trail (questions, plans, log,
  assertions, conflicts, hypotheses, timelines, proof summaries)
- `tree.gedcomx.json` — the simplified GedcomX deliverable (persons,
  relationships, sources)

This skill implements Steps 1 and 2 of the 6-step genealogical research
process: **defining the problem** and **surveying known information**.
The FamilySearch tree data serves as the preliminary survey — it is the
first compiled source to consult. All data imported here should be
treated as unverified starting points, not established conclusions.

See `references/research-process-init.md` for detailed GPS guidance.

## Preconditions

**Check for an existing project FIRST, before calling any tools.**

If `research.json` already exists in the current folder:
- Output a single-line decline immediately. Do NOT call `validate_research_schema`, `person_read`, or any other MCP tool.
- If the user wants to add a new research question, tell them to use **question-selection**.
- If the user wants to see the current project state, tell them to use **project-status**.
- Stop after that one-line response. Do not read project files, do not validate the schema, do not continue with initialization.

Example decline response:
> "This project already has a `research.json` — use **question-selection** to add a new research question, or **project-status** to review the current state."

- A FamilySearch person ID is preferred but not required. If an ID is
  provided, use `person_read` to seed known information. If no ID is
  available, call `person_search` to find the person by name and known
  facts, let the user pick the right candidate, then call `person_read`
  with the selected person ID. Fall back to local stub persons only if
  `person_search` returns no usable candidates.

## Researcher profile interview

After capturing the research objective and before writing
`research.json`, ask the user two short questions. The answers become
the `researcher_profile` section of `research.json` and adapt skill
narration density for the rest of this project. The whole interview
should take under a minute.

If you are in a single-turn evaluation or otherwise cannot get a
follow-up answer in the same invocation, skip the interview entirely:
use the defaults below (`intermediate` experience and `none`
subscriptions), continue the initialization, and note that the user can
edit `researcher_profile` later.

### Question 1 — Experience level

> How would you describe your genealogy experience?
> (a) just starting out
> (b) some research under my belt
> (c) experienced
> (d) professional/certified

Map the choice to `experience_level`:
- (a) → `novice`
- (b) → `intermediate`
- (c) → `experienced`
- (d) → `professional`

### Question 2 — Paid subscriptions

> Which paid genealogy subscriptions do you have? Choose any that apply
> (or say "none"): Ancestry, MyHeritage, FindMyPast, Newspapers.com,
> GenealogyBank, FindAGrave-Plus, other.

**Normalize the response before storing** so downstream skills can do
exact-equality lookups:

- Canonical enum: `Ancestry`, `MyHeritage`, `FindMyPast`,
  `Newspapers.com`, `GenealogyBank`, `FindAGrave-Plus`, `other`, `none`.
- Case-fold and trim whitespace. Dedupe.
- Map common aliases:
  - `ancestry`, `Ancestry.com`, `ancestry.com` → `Ancestry`
  - `findmypast`, `findmypast.com`, `find my past` → `FindMyPast`
  - `myheritage`, `myheritage.com` → `MyHeritage`
  - `newspapers`, `newspapers.com` → `Newspapers.com`
  - `genealogybank`, `genealogybank.com` → `GenealogyBank`
  - `findagrave`, `findagrave plus`, `findagrave+` → `FindAGrave-Plus`
- Unrecognized inputs go under `other`. Show the user the normalized
  result and confirm before proceeding.
- Empty/no-subscription response → `["none"]`.

### Derive `narration_guidance`

Look up the experience level and store the matching text verbatim into
`researcher_profile.narration_guidance`:

| Experience level | `narration_guidance` |
|---|---|
| novice | "Narrate the *why* before each action. Define genealogy terms inline when first introduced. Explain which GPS step you are executing and what it produces. Err on the side of more context — the user is learning." |
| intermediate | "One-line preamble per skill invocation explaining what you're about to do. Assume basic GPS vocabulary. Define unusual or specialized terminology inline." |
| experienced | "No preambles. Do the work and report results concisely. Assume fluency with GPS and standard genealogy terminology." |
| professional | "No preambles. Do the work and report results concisely. Assume fluency with GPS, BCG standards, and standard genealogy terminology." |

Store the three fields (`experience_level`, `subscriptions`,
`narration_guidance`) in `research.json` `researcher_profile` when
writing the file in Step 4.

The user can edit `researcher_profile` directly in `research.json` later
if their situation changes (new subscription, more experience). No
special update flow.

## Steps

### 1. Get the research objective

Ask the user for:
- The FamilySearch person ID of the research subject (preferred), or
  their name and any known facts so you can find them via `person_search`
- The research objective in one sentence (e.g., "Identify the parents
  of Patrick Flynn, born ~1845 in Pennsylvania")

**Objectives are broad — do not narrow prematurely.** The objective is
the overarching goal, not a research question. Research questions come
later (question-selection skill). Accept broad objectives here.

**Classify as relationship or event.** Every objective seeks either a
**relationship** (who is connected to whom) or an **event** (what
happened, when, where). Use that classification in your narrative
summary to guide downstream record-type selection, but do not add a new
`objective_type` field to `research.json`.

If the user provides just a person ID, use it to fetch the person's
data and formulate a default objective based on what's missing (e.g.,
if the person has no parents in the tree, the objective is "Identify
the parents of [person name]").

**If no FamilySearch ID is provided**, search for the person by name
using `person_search` (see "Searching by name" below). Let the user
pick the right candidate before proceeding to `person_read`.

If the user's stated objective is too vague to be actionable (no named
individual, no distinguishing details), ask clarifying questions. But
do not require the precision of a research question — objectives are
allowed to be broader.

## Searching by name

When the user does not have a FamilySearch person ID, call
`person_search` with the name and any known facts:

```
person_search({
  surname: "Flynn",
  givenName: "Patrick",
  birthYearFrom: 1843,
  birthYearTo: 1847,
  birthPlace: "Ireland"
})
```

**Surname-plus-one rule:** `surname` is always required plus at least
one other qualifying field (given name, date, place, or relative name).

Present the ranked candidates to the user with their `personId`,
confidence, and key facts. In single-turn evaluation mode (no follow-up
available), select the top-scoring candidate and proceed. Once the user
confirms the right person (or the top candidate is selected), call
`person_read` with that `personId` and continue with the normal
initialization steps.

If `person_search` returns no candidates, or the user confirms none of
the candidates match, initialize from objective text only using local
stub persons (no `person_read` call).

### 2. Fetch person data from FamilySearch

Call the `person_read` tool with the person ID:

```
person_read({ personId: "<person-id>" })
```

For eval stability, call it with exactly that single required argument
(`personId`) and do not add optional flags.

The tool returns the person's data in simplified GedcomX format,
including:
- The person (name, gender, facts)
- Their relatives (parents, spouse, children) with person IDs
- Relationships (ParentChild, Couple)
- Source descriptions attached to the person

If the tool returns an authentication error, instruct the user to
log in: "Please authenticate with FamilySearch first. Type `login`
or ask me to log you in."

**Handling conflicts between user-stated facts and FamilySearch data:**
When FamilySearch data differs from what the user explicitly stated (e.g., the user says "born in Pennsylvania" but FamilySearch shows Ireland), use the FamilySearch data in the stub — it is the primary source being surveyed. Do NOT frame the user's information as an error. Note the discrepancy by putting the user's explicit statement first: "You stated [Y]; FamilySearch shows [X] — both will need verification during research." Never characterize the user's statement as merely "noted" or "mentioned" when the user explicitly stated a fact.

### 3. Create `tree.gedcomx.json`

Write the file using the data from `person_read`. The file follows the
simplified GedcomX format (see `references/simplified-gedcomx-summary.md`).

Structure:
```json
{
  "persons": [ ... ],
  "relationships": [ ... ],
  "sources": [ ... ]
}
```

**ID conventions:**
- Person IDs: use local `I` IDs (`I1`, `I2`, ...). This includes
  persons seeded from FamilySearch data.
- Name IDs: `N` prefix + sequential number (`N1`, `N2`, ...)
- Fact IDs: `F` prefix + sequential number (`F1`, `F2`, ...)
- Relationship IDs: `R` prefix + sequential number (`R1`, `R2`, ...)
- Source IDs: `S` prefix + sequential number (`S1`, `S2`, ...)

**What to include:**
- The subject person with all their names, facts, and source references
- All relatives returned by `person_read` (parents, spouse, children)
  with their names and facts
- All relationships (ParentChild, Couple) with source references
- All source descriptions referenced by facts and relationships

**Sourcing FamilySearch-derived facts:**
Create one source description entry (e.g., `S1`) for the FamilySearch tree using only the schema-allowed fields (`id`, `title`, `citation`, `author`, `url`). Then attach a source reference to EVERY fact and relationship that came from FamilySearch, using `quality: 1` (questionable — compiled/unverified tree data):

```json
"sources": [
  { "id": "S1", "title": "FamilySearch Family Tree — <PersonID>", "url": "https://www.familysearch.org/tree/person/details/<PersonID>" }
]
```

And on each fact:
```json
{ "id": "F1", "type": "Birth", "date": "~1845", "place": "Ireland", "standard_place": "Ireland", "sources": [{ "ref": "S1", "quality": 1 }] }
```

Facts that come straight from `person_read` already carry a
`standard_place` (the read tool resolves it) — keep it. For any fact whose
`place` you enter or adjust by hand, set `standard_place` by calling
`place_search({ placeName: "<place>" })` and using the first result's
`standardPlace` field (null if nothing resolves).

Do NOT describe the data as "unsourced" — it IS sourced to the FamilySearch tree. What matters is that it is an unverified compiled source, not a primary record. Use `quality: 1` (questionable) to signal this in the GedcomX data itself.

**Simplified GedcomX rules:**
- Gender as a flat string: `Male`, `Female`, `Unknown`
- Names with `given`, `surname`, optional `preferred: true`
- Facts with `type` in PascalCase (`Birth`, `Death`, `Marriage`, etc.)
- ParentChild relationships use `parent`/`child` (not person1/person2)
- Couple relationships use `person1`/`person2`
- Source references use `ref`, `page`, optional `quality`
- `preferred` and `primary` are omit-when-false (do not write `false`)

### 4. Create `research.json`

Write the file using the template at `templates/research.json`.

Fill in the project section:

- `id`: `rp_001`
- `objective`: the research objective from step 1
- `subject_person_ids`: array containing the local GedcomX person ID
  of the primary research subject (for example `I1`)
- `status`: `active`
- `created`: today's date in ISO 8601 format
- `updated`: same as created

Fill in the `researcher_profile` section using the answers from the
researcher-profile interview (see the section above):

- `experience_level`: one of `novice`, `intermediate`, `experienced`,
  `professional`
- `subscriptions`: the normalized array
- `narration_guidance`: the verbatim text from the level-to-guidance
  table

All other sections remain as empty arrays.

### 5. Validate

After writing both files, call `validate_research_schema({ projectPath: "<absolute-path-to-project-directory>" })`
to verify both research.json and tree.gedcomx.json are valid. If validation
fails, fix the errors before proceeding.

### 6. Pedigree analysis and project summary

Perform a quick pedigree analysis on the imported data before presenting
results. This analysis identifies gaps and errors that inform the first
research question.

**Minimum information check** — for each person, note whether they have:
- A full name (given + surname)
- At least one specific date (not just an approximate year)
- A reasonably specific place (county/parish level, not just a country)

**Gap detection:**
- Which ancestors are missing (no parents in tree)?
- Which persons lack key life events?
- Which persons have only vague information?

**Obvious error detection** — flag for the user:
- Birth after death, or parent-child age gaps outside 15-50 years
- Children born in locations inconsistent with parents' residence
- Dates referencing jurisdictions that did not yet exist
- Sibling births less than 9 months apart

**Historical context signals** — note research leads from dates/places:
- Was the person of military age during a major conflict? (military
  records may exist)
- Was the area experiencing significant migration during this period?
- Did the stated jurisdiction exist at the recorded date?

**Source evaluation** — note which facts have source citations and
which are unsourced. Unsourced claims from collaborative trees need
verification as a priority.

**Present to the user:**
- The research objective
- The subject person (name, key facts)
- Known relatives found in the FamilySearch tree
- Pedigree analysis findings (gaps, errors, unsourced claims)
- What's missing or unknown (this informs the first research question)
- Suggest the next step: "Would you like me to select the first
  research question?" (which invokes question-selection)

## Example

User: "Start a new research project for person KWCJ-RN4. I want to
identify his parents."

1. Call `person_read({ personId: "KWCJ-RN4" })`
2. Receive person data: Patrick Flynn, Male, Birth ~1845 Ireland,
   Death 1908-03-12 Schuylkill County PA. No parents in tree.
   Spouse: Mary Kelly. Children: James Flynn, Margaret Flynn.
3. Write `tree.gedcomx.json` with Patrick, Mary, James, Margaret,
   their relationships, and source descriptions
4. Ask the two interview questions. User answers: (b) some research
   under my belt, subscriptions: "Ancestry, Newspapers". Normalize to
   `["Ancestry", "Newspapers.com"]` and confirm.
5. Write `research.json` with:
   ```json
   {
     "project": {
       "id": "rp_001",
       "objective": "Identify the parents of Patrick Flynn (KWCJ-RN4), born ~1845 in Ireland, died 1908 in Schuylkill County, PA",
       "subject_person_ids": ["KWCJ-RN4"],
       "status": "active",
       "created": "2026-05-19",
       "updated": "2026-05-19"
     },
     "researcher_profile": {
       "experience_level": "intermediate",
       "subscriptions": ["Ancestry", "Newspapers.com"],
       "narration_guidance": "One-line preamble per skill invocation explaining what you're about to do. Assume basic GPS vocabulary. Define unusual or specialized terminology inline."
     },
     "questions": [],
     "plans": [],
     "log": [],
     "sources": [],
     "assertions": [],
     "person_evidence": [],
     "conflicts": [],
     "hypotheses": [],
     "timelines": [],
     "proof_summaries": []
   }
   ```
6. Run validate-schema
7. Tell the user: "Project created. Patrick Flynn has no parents in
   the FamilySearch tree. His spouse Mary Kelly and children James and
   Margaret are included. Would you like me to select the first
   research question?"

## Important rules

- **Never overwrite an existing project.** If `research.json` exists,
  stop and tell the user.
- **v1 is read-only.** The tree.gedcomx.json file is for local research
  tracking. It is not uploaded back to FamilySearch.
- **Use local GedcomX IDs in project files.** In `tree.gedcomx.json`
  and `research.json` references, use local `I` person IDs (`I1`,
  `I2`, ...), including people seeded from FamilySearch.
- **Include relatives.** The FAN principle (Family, Associates,
  Neighbors) is central to genealogy research. Including known
  relatives from the start gives downstream skills (person-evidence,
  timeline, hypothesis-tracking) persons to link assertions to.
- **Treat imported data as unverified.** FamilySearch Family Tree is a
  collaborative, user-edited resource. Data quality varies. All facts
  imported during init are starting points for research, not established
  conclusions. Never silently correct apparent errors — flag them for
  the user so they become part of the research process.
- **Recording conventions.** Use maiden (birth) surnames for women.
  Format places from most specific to most general (City, County, State,
  Country). Record jurisdictions as they existed at the time of the
  event. In JSON data fields, use ISO 8601 dates.
- **Handle persons with no relatives.** If `person_read` returns a person
  with no parents, spouse, or children, still create the project. Note
  the isolation in the summary — a person with no linked relatives makes
  FAN research harder and increases reliance on direct records.
- **No FamilySearch ID — search first.** If no FamilySearch ID is
  provided, call `person_search` by name before falling back to local
  stubs. Only create stub-only projects when `person_search` returns
  nothing useful or the user confirms no candidate matches.
- **No placeholder unknown-person stubs.** If a target person is
  entirely unknown (for example "unknown maternal grandmother" with no
  name), do not create a placeholder person entry with empty name/date/
  place fields. Create stubs only for people with at least one concrete
  identifying detail.
- **Do not skip the preliminary survey.** The FamilySearch tree fetch IS
  the preliminary survey for this skill. Step 2 of the research process
  requires evaluating known information before planning new research.
  The pedigree analysis in step 6 fulfills this requirement.

## Re-invocation behavior

**Writes:** the `project` section of `research.json` (project metadata,
`researcher_profile`, initial empty `questions`/`plans`/`log`/etc.
arrays), and the initial structure of `tree.gedcomx.json`. This skill
is intended to run **once** at project creation.

**On repeat invocation:** detects an existing `project` section and
declines to overwrite. If the user explicitly asks to update the
researcher profile, refresh `researcher_profile.narration_guidance`
and `researcher_profile.updated` in place — but never reset the
project id, created date, or existing research state.

**Do not duplicate:** never wipe or replace existing
`questions`/`plans`/`log`/`assertions`/`sources` content. Anything
that already exists in the project survives a re-invocation unchanged.
