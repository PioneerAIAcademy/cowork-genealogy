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

**Guard clause — run BEFORE anything else, including file reads:**
If `research.json` already exists, respond with exactly this and stop — no tool calls, no file reads:
> "This project already has a `research.json` — use **question-selection** to add a research question, or **project-status** to review the current state."
Do NOT call any tool or read any file. Stop immediately.

**Narration:** Read `researcher_profile.narration_guidance` from `research.json` and apply it. If absent (new project being initialized), default to a one-line preamble per action.

**Places:** Follow `references/places-guidance.md`. Facts from `person_read` already carry `standard_place`; for hand-entered places, resolve with `place_search`.

## Researcher profile interview

Captures experience level and paid subscriptions in `researcher_profile`.

**Never stop and wait for answers. Complete the full initialization in a single pass:**

1. **If the user's message already states answers** (experience level and/or subscriptions) — map and normalize them and keep going.
2. **Otherwise, use defaults** (`intermediate`, `["none"]`), write files now, and tell the user in the final summary that defaults were assumed. Optionally include the questions *after* both files are written — never as a turn-ending prompt.

Asking questions and stopping is a failure: the project never gets created.

### Question 1 — Experience level

> How would you describe your genealogy experience?
> (a) just starting out → `novice`
> (b) some research under my belt → `intermediate`
> (c) experienced → `experienced`
> (d) professional/certified → `professional`

### Question 2 — Paid subscriptions

> Which paid genealogy subscriptions do you have? (or "none"):
> Ancestry, MyHeritage, FindMyPast, Newspapers.com, GenealogyBank, FindAGrave-Plus, other.

**Normalize before storing** (downstream skills do exact-equality lookups):
- Canonical enum: `Ancestry`, `MyHeritage`, `FindMyPast`, `Newspapers.com`, `GenealogyBank`, `FindAGrave-Plus`, `other`, `none`.
- Case-fold, trim, dedupe.
- Aliases: `ancestry.com` → `Ancestry`; `findmypast.com`/`find my past` → `FindMyPast`; `myheritage.com` → `MyHeritage`; `newspapers` → `Newspapers.com`; `genealogybank.com` → `GenealogyBank`; `findagrave`/`findagrave+` → `FindAGrave-Plus`.
- Unrecognized → `other`. Show normalized result and confirm.
- Empty → `["none"]`.

### Derive `narration_guidance`

Store the matching text verbatim into `researcher_profile.narration_guidance`:

| Experience level | `narration_guidance` |
|---|---|
| novice | "Narrate the *why* before each action. Define genealogy terms inline when first introduced. Explain which GPS step you are executing and what it produces. Err on the side of more context — the user is learning." |
| intermediate | "One-line preamble per skill invocation explaining what you're about to do. Assume basic GPS vocabulary. Define unusual or specialized terminology inline." |
| experienced | "No preambles. Do the work and report results concisely. Assume fluency with GPS and standard genealogy terminology." |
| professional | "No preambles. Do the work and report results concisely. Assume fluency with GPS, BCG standards, and standard genealogy terminology." |

Store `experience_level`, `subscriptions`, `narration_guidance` in `research.json` `researcher_profile` (Step 4). The user can edit the profile directly later.

## Known-holdings survey

Surveys what the researcher already holds (family Bible, certificates, prior GEDCOM, oral history). GPS Step 2 requires this alongside the FamilySearch tree fetch.

**Same non-blocking rule — never pause to ask and wait:**
1. If the user volunteers holdings, record each as a `known_holdings` entry in Step 4.
2. Otherwise, write `known_holdings: []` and continue. Invite additions in the closing summary only.

This is user-reported only — never invent holdings. Asking and stopping is the failure mode.

Map each item to `holding_type`:

| Researcher said | `holding_type` |
|---|---|
| certificate, Bible, will, deed, letter | `document` |
| notes, research binder, prior report | `prior_research` |
| GEDCOM file, tree export | `gedcom` |
| photo, portrait | `photo` |
| relative told me, family lore | `oral_knowledge` |
| heirloom, quilt, headstone rubbing | `artifact` |
| anything else | `other` |

Confidence: "I'm sure / definitely" → `confident`; "I think / maybe" → `unsure`. Default: `confident`.

**Family knowledge counts as a holding too.** When the user states something from family memory (a maiden name, who married whom), record it as `oral_knowledge` *in addition* to using it in the tree. The two are not mutually exclusive: "Mary Donovan" both creates Mary's stub and is itself oral knowledge worth surveying. Do not let "I used it in the tree" drop it from `known_holdings`. (Only facts from family/personal knowledge, not the bare research target.)

## Steps

> These steps run ONLY for a brand-new project. If `research.json` exists, you stopped at the guard clause.

### 1. Get the research objective

Get from the user: a FamilySearch person ID (preferred), or name + known facts for `person_search`; and the research objective in one sentence.

Objectives are broad (overarching goal, not a research question — those come later via question-selection). Classify as **relationship** or **event** for narrative guidance. If the user provides just an ID, formulate a default objective from what's missing. If no ID, search by name (see below). If too vague (no named individual), ask for clarification.

### Searching by name

Call `person_search` with name + known facts. **Surname-plus-one rule:** `surname` required plus at least one other qualifying field (given name, date, place, or relative name).

Present ranked candidates with `personId`, confidence, key facts. In single-turn mode, select the top candidate. Once confirmed, call `person_read` and continue. If no candidates match, initialize from objective text only using local stub persons.

### 2. Fetch person data

Call `person_read({ personId: "<id>" })` with exactly that single argument (no optional flags). Returns simplified GedcomX: person (name, gender, facts), relatives with IDs, relationships, source descriptions. Auth error → tell user to log in.

**User-stated facts vs. FamilySearch conflicts:**
- **tree.gedcomx.json:** use FamilySearch data (primary source being surveyed)
- **Research objective:** use user's stated facts (reflects user's understanding)
- **Flag the discrepancy** with user's statement first: "You stated [Y]; FamilySearch shows [X] — both will need verification."
- Never frame the user's information as an error.

### 3. Create `tree.gedcomx.json`

Write using data from `person_read`. Follow `references/simplified-gedcomx-summary.md`.

**Simplified GedcomX is NOT the same as full GedcomX.** `person_read` returns full GedcomX — you must convert. Key differences: top-level array is `sources` (NOT `sourceDescriptions`); persons have no `fsid` or `extracted` fields; use snake_case for all field names (`standard_place`, not `standardPlace`). Structure: `{ "persons": [], "relationships": [], "sources": [] }`.

**Include:** subject person (names, facts, source references), all relatives (parents, spouse, children), all relationships, all source descriptions.

**ID conventions (overrides the reference doc):** ALL persons get local `I` IDs (`I1`, `I2`…) — including FamilySearch-seeded persons. Do NOT use FamilySearch PIDs as person IDs. Names `N1`…; facts `F1`…; relationships `R1`…; sources `S1`….

**Source every FamilySearch fact with `quality: 1`** (questionable — compiled/unverified tree data). Create one source description for the FamilySearch tree using only the schema-allowed fields (`id`, `title`, `citation`, `author`, `url` — NO `quality`, `notes`, `repository`, or `accessed`). Then attach a source reference to every fact and relationship (`quality` goes here, on fact-level refs, not on source descriptions):
```json
{ "id": "F1", "type": "Birth", "date": "~1845", "place": "Ireland", "standard_place": "Ireland", "sources": [{ "ref": "S1", "quality": 1 }] }
```

Facts from `person_read` already carry `standard_place` — keep it. Hand-entered places: resolve with `place_search`, use `standardPlace` from the first result.

Do NOT call data "unsourced" — it IS sourced to the FamilySearch tree. `quality: 1` signals it's unverified.

**Simplified GedcomX rules:** gender as flat string (`Male`/`Female`/`Unknown`); names with `given`, `surname`, optional `preferred: true`; facts with PascalCase `type`; ParentChild uses `parent`/`child`; Couple uses `person1`/`person2`; `preferred`/`primary` omit-when-false.

**No placeholder unknown-person stubs.** Create stubs only for people with at least one concrete identifying detail. A known surname alone qualifies — when a maiden name is stated, create a stub for that woman's father using only the surname. **Omit the `given` key entirely — do NOT write `given: ""`.** A name needs only `id` and `surname`.

**Stub only the people the user actually named or directly implied — no others.** A stated maiden name implies exactly one new person: that woman's father.

Worked example: "the maternal grandmother of Sarah Hennessy; Sarah's mother's maiden name was Mary Donovan" →

**DO create:**
- **Sarah Hennessy** — named by the user.
- **Mary Donovan** — named (full name stated).
- **Mary Donovan's father** — surname `Donovan`, given omitted. Maiden name fixes father's surname.

**Do NOT create:**
- Sarah's father — never mentioned, surname not implied.
- The maternal grandmother — unknown research target (no identifying detail).

When unsure: did the user name them, or is their surname fixed by a stated maiden name? If neither, no stub.

### 4. Create `research.json`

Write using `templates/research.json`.

**Project section:** `id`: `rp_001`; `objective`: from Step 1; `subject_person_ids`: local GedcomX ID of primary subject (e.g. `["I1"]`); `status`: `active`; `created`/`updated`: today (ISO 8601); `title`: concise 3-6 word session name (e.g. "Patrick Flynn's parents").

**`researcher_profile`:** `experience_level`, `subscriptions`, `narration_guidance` from the interview.

**`known_holdings`:** one entry per reported item — `id` (`kh_001`…), `holding_type` (from mapping table), `description` (researcher's own words), `relevant_facts` (what it supplies; `null` if not stated), `relates_to_person_ids` (local `I` IDs that exist in tree.gedcomx.json; `[]` if none), `confidence` (`confident`/`unsure`), `promoted` (`false`), `created` (today ISO 8601). If no holdings, write `known_holdings: []`.

All other sections (`questions`, `plans`, `log`, `sources`, `assertions`, `person_evidence`, `conflicts`, `hypotheses`, `timelines`, `proof_summaries`, `evaluations`) remain as empty arrays.

### 5. Pedigree analysis and project summary

Analyze imported data before presenting results:

**Minimum information check** — per person: full name (given + surname)? Specific date (not just ~year)? Specific place (county/parish, not just country)?

**Gap detection:** missing ancestors (no parents)? Missing key life events? Only vague information?

**Obvious error detection:** birth after death; parent-child age gaps outside 15-50 years; children born in locations inconsistent with parents; dates referencing non-existent jurisdictions; sibling births <9 months apart.

**Historical context signals:** military age during major conflict? Significant migration in area? Jurisdiction existence at recorded date?

**Source evaluation:** which facts have citations vs. unsourced claims needing priority verification?

**Known-holdings cross-check:**
- Fact researcher holds but tree lacks → already in hand, don't queue a search. Surface as head start.
- Holding disagrees with tree → flag as discrepancy (never frame user's holding as error).
- `oral_knowledge` lead → surface early; oral sources are cheapest and most perishable.

**Present to the user:**
- Research objective
- **Tree summary table** — one row per person: local ID, full name, gender, key facts. Example: `| I1 | Patrick Flynn | Male | Birth ~1845 Ireland · Death 1908 Schuylkill Co PA |`
- Pedigree analysis findings
- Known holdings recorded (if any) and what each contributes
- What's missing (informs first research question)
- Suggest next step: "Would you like me to select the first research question?"

## Example

User: "Start a new research project for person KWCJ-RN4. I want to identify his parents."

1. Call `person_read({ personId: "KWCJ-RN4" })`
2. Receive: Patrick Flynn, Male, Birth ~1845 Ireland, Death 1908-03-12 Schuylkill County PA. No parents. Spouse: Mary Kelly. Children: James, Margaret.
3. Write `tree.gedcomx.json` with all persons, relationships, sources (quality: 1).
4. Map user answers (or defaults) to `researcher_profile`. Record any volunteered holdings.
5. Write `research.json` with project section, profile, holdings, empty arrays.
6. Pedigree analysis + summary. Suggest first research question.

## Important rules

- **Never overwrite an existing project.** Guard clause catches this.
- **v1 is read-only.** tree.gedcomx.json is not uploaded to FamilySearch.
- **Use local GedcomX IDs** (`I1`, `I2`…) in both project files, including FamilySearch-seeded persons.
- **Include relatives** (FAN principle). Known relatives from the start give downstream skills persons to link to.
- **Treat imported data as unverified.** FamilySearch tree is collaborative, quality varies. Never silently correct errors — flag them.
- **Recording conventions:** maiden (birth) surnames for women; places most-specific to most-general; jurisdictions as they existed at event time; ISO 8601 dates in JSON.
- **Handle isolated persons.** If `person_read` returns no relatives, still create the project. Note isolation in summary.
- **No FamilySearch ID → search first.** Call `person_search` before falling back to stubs.
- **Do not skip the preliminary survey.** The tree fetch + known-holdings survey together ARE the preliminary survey (GPS Step 2).
