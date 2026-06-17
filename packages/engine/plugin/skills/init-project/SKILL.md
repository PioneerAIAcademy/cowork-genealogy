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
  - validate_research_schema
---

# Init Project

**Guard clause — run this BEFORE anything else, including file reads:**
If `research.json` already exists in the current working directory, respond with exactly this one line and stop — no tool calls, no file reads, no further analysis:
> "This project already has a `research.json` — use **question-selection** to add a research question, or **project-status** to review the current state."
Do NOT call `validate_research_schema`, `person_read`, or any other tool. Do NOT read any project files. Stop immediately after that one-line response.

**Why declining is the *correct* answer, not just the in-scope one.** When `research.json` already exists and the user asks you to "add a research question," "add a source," "start research," "update the objective," or "investigate X," performing that action yourself would **produce broken data**. init-project has none of the logic those operations require: a real question entry needs question-selection's `selection_basis`, `priority`, and `depends_on`/`unblocks` linkage; a real source needs record-extraction's classification and provenance. If you hand-write a `q_`/`src_` entry here you will create a malformed, half-formed record that corrupts the project and the downstream skills that read it. So doing the work is not "being helpful" — it is the *wrong, damaging* outcome. A detailed, fleshed-out project in the folder is the strongest possible signal to decline. Do not read the project to "understand it first," do not add the entry yourself, do not touch `research.json`. The only correct, non-destructive action is to decline with the one line above and route the user to the right skill. Decline and stop.

**Narration (new projects only):** Read `researcher_profile.narration_guidance` from `research.json` and apply it as your narration style for this invocation. If absent (e.g. this is a brand-new project still being initialized), default to a one-line preamble per action — the profile gets written in Step 4 and takes effect on the next skill invocation.

**Places:** When resolving or writing places, follow `references/places-guidance.md` — facts from `person_read` already carry `standard_place`; for places you enter by hand, resolve with `place_search` and record the `standardPlace`.

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

The `researcher_profile` section of `research.json` captures two things —
experience level and paid subscriptions — and adapts skill narration
density for the rest of this project.

**Never stop and wait for answers. Complete the full initialization in a
single pass.** This is the most important rule in this section. Gathering
the profile must NOT block writing the files. Concretely:

1. **If the user's message already states the answers** — an experience
   level ("I'm a professional genealogist," "just getting started")
   and/or subscriptions ("I subscribe to Ancestry and Newspapers.com") —
   map and normalize them into `researcher_profile` and keep going.
2. **Otherwise, do NOT ask the questions and end your turn waiting for a
   reply.** Use the defaults (`intermediate` experience, `["none"]`
   subscriptions), write the files now, and tell the user in your final
   summary that you assumed defaults and they can edit `researcher_profile`
   (and answer the profile/holdings questions) anytime. Optionally include
   the questions in that closing summary — but only *after* both files are
   written, never as a turn-ending prompt that halts initialization.

Asking the two questions and then stopping is a failure: in a
non-interactive or single-turn context the project never gets created.
When in doubt, proceed with defaults and finish. The questions below
define how to map answers *when they are present*; they are not a reason
to pause.

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

## Known-holdings survey

The FamilySearch tree fetch surveys the *collaborative* record. It does
not survey what the **researcher already holds** — the family Bible, a
certificate in a drawer, a prior GEDCOM, courthouse-trip notes, or what a
living relative remembers. GPS Step 2 (survey known information) requires
gathering this too.

**Same non-blocking rule as the profile interview — never pause to ask
and wait.** Holdings are captured only from what the user *already* said:

1. **If the user's message already volunteers holdings** ("I have her
   death certificate and my aunt's typed family history"), record each as
   a `known_holdings` entry in Step 4.
2. **Otherwise, write `known_holdings: []` and continue** — do NOT ask
   "what do you have on hand?" and end your turn waiting for an answer.
   You may invite the user to add holdings later in your closing summary,
   but only *after* both files are written.

This is **user-reported only** — never invent holdings, and never call a
tool to look one up. Asking and stopping is the failure mode to avoid: it
prevents the project from being created at all.

Map each reported item to a `holding_type`:

| Researcher said | `holding_type` |
|---|---|
| a certificate, the family Bible, a will, a deed, a letter | `document` |
| notes, a research binder, a prior report, "what I've found so far" | `prior_research` |
| a GEDCOM file, a tree export | `gedcom` |
| a photo, a portrait | `photo` |
| a relative told me / family lore / oral history | `oral_knowledge` |
| an heirloom, a quilt, a headstone rubbing | `artifact` |
| anything that fits none of the above | `other` |

Confidence: map "I'm sure / definitely" → `confident`; "I think / maybe /
not certain" → `unsure`. When the researcher gives no signal either way,
default to `confident`.

**Family knowledge counts as a holding, even when you also use it to seed
the tree.** When the user states something they know from family memory
rather than from a record — a maiden name, who married whom, a relative's
birthplace, a family story — record it as an `oral_knowledge` holding in
addition to using it to build the relevant stub. The two are not mutually
exclusive: the maiden name "Mary Donovan" both creates Mary's stub *and*
is itself a piece of oral knowledge worth surveying. Do not let "I used it
in the tree" become a reason to drop it from `known_holdings`. (This does
not mean every objective detail is a holding — only facts the user clearly
holds from family/personal knowledge, not the bare research target.)

## Steps

> **These steps run ONLY for a brand-new project.** If `research.json`
> already exists, you have already stopped at the guard clause at the top
> of this file and declined — you never reach these steps. Everything
> below assumes there is no project yet. Do not run any of it against an
> existing project, no matter what the user asks.

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
When FamilySearch data differs from what the user explicitly stated (e.g., the user says "born in Pennsylvania" but FamilySearch shows Ireland):
- **In the stub (tree.gedcomx.json):** use the FamilySearch data — it is the primary source being surveyed.
- **In the research objective:** use the user's stated facts — the objective reflects the user's understanding of the problem, not the unverified FamilySearch data.
- **Flag the discrepancy** by putting the user's explicit statement first: "You stated [Y]; FamilySearch shows [X] — both will need verification during research."
- Do NOT frame the user's information as an error. Never characterize the user's statement as merely "noted" or "mentioned" when the user explicitly stated a fact.

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
- `title`: a concise session name (3-6 words) summarizing the
  objective, like a Claude chat title (e.g. "Patrick Flynn's parents",
  "Mary Sullivan's origins"). This is the label the user sees for this
  project in their session list — make it specific and human, not a
  restatement of the full objective sentence.

Fill in the `researcher_profile` section using the answers from the
researcher-profile interview (see the section above):

- `experience_level`: one of `novice`, `intermediate`, `experienced`,
  `professional`
- `subscriptions`: the normalized array
- `narration_guidance`: the verbatim text from the level-to-guidance
  table

Fill in the `known_holdings` section from the known-holdings survey (see
the section above). Write **one entry per item the researcher reported**:

- `id`: `kh_` prefix, sequential (`kh_001`, `kh_002`, ...)
- `holding_type`: from the mapping table in the survey section
- `description`: the researcher's own words for the item (e.g.
  "grandmother's death certificate", "aunt's typed family history")
- `relevant_facts`: any facts or leads the researcher said it supplies
  (e.g. "lists her parents' names"); `null` if they did not say
- `relates_to_person_ids`: the local `I` IDs of any person already in
  `tree.gedcomx.json` the item clearly concerns; `[]` if none. These
  must be IDs that exist in `tree.gedcomx.json` (the validator
  cross-checks them)
- `confidence`: `confident` or `unsure` from the survey
- `promoted`: always `false` at survey time (record-extraction/citation
  flip it later; never delete the entry)
- `created`: today's date in ISO 8601

Example entry:
```json
{
  "id": "kh_001",
  "holding_type": "document",
  "description": "Patrick Flynn's death certificate, kept in a family folder",
  "relevant_facts": "lists his parents' names and birthplace",
  "relates_to_person_ids": ["I1"],
  "confidence": "confident",
  "promoted": false,
  "created": "2026-06-15"
}
```

If the survey was skipped (single-turn, no holdings volunteered), write
`known_holdings: []`.

All other sections (`questions`, `plans`, `log`, `sources`, `assertions`,
`person_evidence`, `conflicts`, `hypotheses`, `timelines`,
`proof_summaries`, `evaluations`) remain as empty arrays.

### 5. Validate

After writing both files, call `validate_research_schema({ projectPath: "<absolute-path-to-project-directory>" })`
to verify both research.json and tree.gedcomx.json are valid. If validation
fails, fix the errors before proceeding.

If the tool call is denied or unavailable, note this briefly and continue —
do NOT claim to have performed a manual validation or structural check, as
that would be an unverifiable assertion. Simply say validation was not
available and the user can run it manually.

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

**Known-holdings cross-check** — compare each `known_holdings` entry
against the tree:
- A fact the researcher already holds but the tree lacks → **already in
  hand; do not queue a search for it.** Surface it as a head start.
- A holding that disagrees with the tree → flag as a discrepancy to
  verify (the user-vs-tree tone rule above applies — never frame the
  user's holding as an error).
- An `oral_knowledge` lead → surface it in the summary; oral sources are
  the cheapest and most perishable, so they are worth acting on early.

**Present to the user:**
- The research objective
- A **tree summary table** listing every person written to
  `tree.gedcomx.json` — one row per person with their local ID,
  full name, gender, and key facts (birth/death date and place).
  This is the concrete record of what was written, not a paraphrase.
  Example row: `| I1 | Patrick Flynn | Male | Birth ~1845 Ireland · Death 1908 Schuylkill Co PA |`
- Pedigree analysis findings (gaps, errors, unsourced claims)
- **Known holdings recorded** (if any) and what each contributes —
  already-in-hand facts, leads to verify, oral leads to act on early
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
   `["Ancestry", "Newspapers.com"]` and confirm. The user also mentions
   "I have Patrick's death certificate" — record it as a `known_holdings`
   entry.
5. Write `research.json` with:
   ```json
   {
     "project": {
       "id": "rp_001",
       "objective": "Identify the parents of Patrick Flynn (KWCJ-RN4), born ~1845 in Ireland, died 1908 in Schuylkill County, PA",
       "subject_person_ids": ["KWCJ-RN4"],
       "status": "active",
       "created": "2026-05-19",
       "updated": "2026-05-19",
       "title": "Patrick Flynn's parents"
     },
     "researcher_profile": {
       "experience_level": "intermediate",
       "subscriptions": ["Ancestry", "Newspapers.com"],
       "narration_guidance": "One-line preamble per skill invocation explaining what you're about to do. Assume basic GPS vocabulary. Define unusual or specialized terminology inline."
     },
     "known_holdings": [
       {
         "id": "kh_001",
         "holding_type": "document",
         "description": "Patrick Flynn's death certificate",
         "relevant_facts": null,
         "relates_to_person_ids": ["I1"],
         "confidence": "confident",
         "promoted": false,
         "created": "2026-05-19"
       }
     ],
     "questions": [],
     "plans": [],
     "log": [],
     "sources": [],
     "assertions": [],
     "person_evidence": [],
     "conflicts": [],
     "hypotheses": [],
     "timelines": [],
     "proof_summaries": [],
     "evaluations": []
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
  name or surname), do not create a placeholder person entry with empty
  name/date/place fields. Create stubs only for people with at least one
  concrete identifying detail. **A known surname alone qualifies.** When
  a person's maiden name is stated, their father's surname is known —
  create a stub for that father using only the surname (omit the given
  name rather than inventing a placeholder). **Omit the `given` key
  entirely — do NOT write `given: ""`.** A name requires only `id` and
  `surname` in the simplified-GedcomX schema; an empty-string given is
  itself a placeholder and is the very thing this rule forbids. Leaving
  `given` out validates fine; if a write ever appears to fail, fix the
  real cause — never paper over it with an empty string. This applies to
  all confirmed relatives, regardless of whether they appear in the
  records being searched: all known information belongs in the tree from
  the start of every project.
- **Stub only the people the user actually named or directly implied —
  no others.** A stated maiden name implies exactly one new person: that
  woman's father (his surname = her maiden name). It does not license
  stubs for anyone else. Worked example: "the maternal grandmother of
  Sarah Hennessy; Sarah's mother's maiden name was Mary Donovan" →
  create stubs for **Sarah Hennessy**, **Mary Donovan**, and **Mary's
  father** (surname `Donovan`, given omitted). Do **not** create a stub
  for *Sarah's* father — he was never mentioned and his surname is not
  implied; inventing him is fabrication. Do **not** stub the maternal
  grandmother herself — she is the unknown research target. When unsure
  whether a person is "implied," ask: did the user name them, or is their
  surname fixed by a stated maiden name? If neither, no stub.
- **Do not skip the preliminary survey.** The FamilySearch tree fetch
  and the known-holdings survey together ARE the preliminary survey for
  this skill. Step 2 of the research process requires evaluating known
  information before planning new research — that includes what the
  researcher already holds, not just the collaborative tree. The pedigree
  analysis and holdings cross-check in step 6 fulfill this requirement.

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
