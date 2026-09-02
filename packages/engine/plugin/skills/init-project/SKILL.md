---
name: init-project
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
  - project_create
  - research_append
---

# Init Project

**Guard clause — run BEFORE anything else, including file reads:**
If `research.json` already exists, do not initialize: make no MCP tool call and read no project file. Hand the turn off instead — **project-status** for status/resume wording, **question-selection** for next-question wording — and stop. If you cannot delegate, reply with exactly this and stop:
> "This project already has a `research.json` — use **question-selection** to add a research question, or **project-status** to review the current state."

**Narration** (initialize path only — the guard clause above reads nothing): read `researcher_profile.narration_guidance` from `research.json` and apply it. If absent (new project being initialized), default to a one-line preamble per action.

**Places:** Follow `references/places-guidance.md`. Keep the `standard_place` a `person_read` fact carries; resolve anything else — hand-entered, or a fact returned with `place` and no `standard_place` — with `place_search`.

## Opening-turn questions

Ask three things in the opening turn, alongside the person ID/name request: the research objective, experience level, and access (`researcher_profile` stores the latter two). **Never stop and wait for any of them. Complete the full initialization in a single pass:**

1. **If the user's message already states an answer** to one or more of the three — map and normalize it and keep going.
2. **For anything left unanswered, ask it in this same opening-turn message, but do not wait for a reply before proceeding:**
   - No stated objective → store this exact text, verbatim, as `objective`: "General research: build out the tree and identify gaps and next steps." Never invent, infer, or default a *specific* research direction (a migration story, a disputed relationship, a name-origin theory) from the person's data alone — this verbatim generic default is the only fallback, the same way a defaulted `narration_guidance` is stored verbatim, not paraphrased.
   - No stated experience level → default to `intermediate`.
   - No stated access → default to `["none"]`.
   Write the files now with whatever mix of stated answers and defaults applies, and tell the user in the final summary exactly which fields were defaulted. Optionally repeat the questions *after* both files are written — never as a turn-ending prompt.

Asking a question and then stopping to wait is a failure: the project never gets created.

### Question 1 — Experience level

> How would you describe your genealogy experience?
> (a) just starting out → `novice`
> (b) some research under my belt → `intermediate`
> (c) experienced → `experienced`
> (d) professional/certified → `professional`

### Question 2 — Access

> What access do you have to genealogy sites? (or "none") — a paid subscription
> (Ancestry, MyHeritage, FindMyPast, Newspapers.com, GenealogyBank, FindAGrave-Plus, other),
> free access through a FamilySearch partnership, or access via a library or
> family history centre.

**Normalize before storing** (downstream skills do exact-equality lookups):
- Canonical enum: `Ancestry`, `MyHeritage`, `FindMyPast`, `Newspapers.com`, `GenealogyBank`, `FindAGrave-Plus`, `FamilySearch-Partner`, `LibraryAccess`, `other`, `none`.
- Case-fold, trim, dedupe.
- Aliases: `ancestry.com` → `Ancestry`; `findmypast.com`/`find my past` → `FindMyPast`; `myheritage.com` → `MyHeritage`; `newspapers` → `Newspapers.com`; `genealogybank.com` → `GenealogyBank`; `findagrave`/`findagrave+` → `FindAGrave-Plus`; `FamilySearch partnership`/`FamilySearch partner`/`partner subscription` → `FamilySearch-Partner`; `library`/`library card`/`family history centre`/`family history center`/`FHC`/`affiliate library` → `LibraryAccess`.
- **A plain FamilySearch account is the baseline every researcher has — never store it.** Bare `FamilySearch`/`familysearch.org`, with no partnership or library mentioned, drops from the list; if nothing else remains, store `["none"]`.
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

## Setting up a forget-and-rederive test

Sometimes the researcher seeds a project **specifically to test you** — "start a
project for this person but omit his parents, I want to see whether you can find
them again," or "leave his death out so I can check you re-derive it." Your job
here is unchanged: **build the complete tree and stop.** Never hand-omit anything
at construction time, and never perform the forgetting yourself.

Build the tree exactly as you normally would — every person, relationship, and
documentary fact the survey turns up, *including the very slice they asked you to
leave out*. Then finish init-project normally and tell the researcher the tree is
complete and that forgetting is a **separate next step** they run with the
**forget-and-rederive** skill. In this skill you do **not**:

- strip, omit, or leave out the fact or relationship under test;
- write a `.tree-before-forget…` restore file or any partial tree;
- call `tree_forget` or `project_context`, or otherwise begin forget-and-rederive
  in this turn — you don't have those tools, and the forgetting is not your step.

Why the strip belongs to `tree_forget`, not a hand-omit: a conclusion is recorded
in two places at once — as structure (a ParentChild or Couple relationship) *and*
as a documentary fact on the subject's own record (a `Parents` or `Marriage` fact
whose value names the relatives). Omit at build time and you drop the structure
but keep the fact, so the answer survives. `tree_forget` removes both, writes a
restore file so the researcher can undo it, and reports counts-only so the answer
never re-enters context. A partial hand-build has none of that — which is why the
**complete** tree, not a stripped one, is what init-project delivers. Do not treat
"omit X" as an instruction to skip X during construction.

## Steps

> These steps run ONLY for a brand-new project. If `research.json` exists, you stopped at the guard clause.

### 1. Get the research objective

The objective was captured in the opening-turn questions above (stated by the user, or the generic default if they didn't answer) — this step just uses it. You need a FamilySearch person ID (preferred) or name + known facts for `person_search` alongside it.

Do NOT call `person_read` before the opening turn's questions are asked — asking about "this person" needs no lookup. Do NOT invent, assume, or default a *specific* objective from the person's data (e.g., a hallucinated "trace migration from Upper Canada" guessed from a birthplace fact) — the generic default from the opening-turn rule above is the only fallback; a wrong specific assumption sends the whole project in a direction the user didn't ask for.

Objectives are broad (overarching goal, not a research question — those come later via question-selection). Classify as **relationship** or **event** for narrative guidance. If no ID, search by name (see below). If the stated objective is too vague (no named individual), ask for clarification — this is a distinct case from no objective at all, which gets the generic default, not a clarification request.

### Searching by name

Call `person_search` with camelCase params: `surname` (required), plus one or more of `givenName`, `birthPlace`, `birthYearFrom`/`birthYearTo`, `residencePlace`, or a relative name (`fatherGivenName`, `motherGivenName`, `spouseGivenName`). Do NOT use snake_case (`given`, `birth_year`, `birth_place`) — those are not recognized params and the call is rejected. **Surname-plus-one rule:** `surname` required plus at least one other qualifying field (given name, date, place, or relative name).

Present ranked candidates with `personId`, confidence, key facts. In single-turn mode, select the top candidate. Once confirmed, call `person_read` and continue. If no candidates match, initialize from objective text only using local stub persons.

### 2. Fetch person data

Call `person_read({ personId: "<id>", relatives: true, sourceDescriptions: true })`. **Both flags are required** — they default to `false`, and without them the call returns ONLY the subject's own facts (`relationships: []`, `sources: []`), which imports a subject-only tree with no spouse, children, or sources (issue #1475). With the flags it returns simplified GedcomX: person (name, gender, facts), relatives with IDs, relationships, and source descriptions. Auth error → tell user to log in.

**User-stated facts vs. FamilySearch conflicts:**
- **tree.gedcomx.json:** use FamilySearch data (the source being surveyed)
- **Research objective:** use user's stated facts (reflects user's understanding)
- **Flag the discrepancy** with user's statement first: "You stated [Y]; FamilySearch shows [X] — both will need verification."
- Never frame the user's information as an error.

### 3. Build the tree from `person_read`

Build the simplified-GedcomX document in memory — you pass it to `project_create` in Step 4, which writes it. Do NOT write either project file yourself; `Write` on them is blocked. Follow `references/simplified-gedcomx-summary.md`.

**`person_read` already returns this format** — `{ "persons": [], "relationships": [], "sources": [] }`, snake_case, no field renaming. What it returns is still not persistable as-is: its ids, its source `notes`, and its missing source refs all need work below. Everything else — including both standardized sidecars — is carried through untouched.

**Include:** subject person (names, facts — source refs live on each fact, never as a person-level property), all relatives (parents, spouse, children), all relationships, all source descriptions in the top-level `sources` array — minus `notes`, which is not an allowed source field and fails the write. A person object allows only `id`, `ark`, `living`, `gender`, `names`, `facts`. `ark` is what marks a person as being *in* the FamilySearch tree, so every person read from it carries `ark: "ark:/61903/4:1:<their FamilySearch person ID>"` — that exact form, which is what `person_search` returns for the same person. Omit the key entirely on local stubs. Never a page URL, never a bare ID.

**ID conventions:** ALL persons get local `I` IDs (`I1`, `I2`…) — including FamilySearch-seeded persons. Do NOT use FamilySearch PIDs as person IDs. Names `N1`…; facts `F1`…; relationships `R1`…; sources `S1`… — mint any the tool did not supply (it returns no name or relationship IDs), and rewrite every relationship endpoint to the new person IDs.

**Source every FamilySearch fact with `quality: 1`** (questionable — compiled/unverified tree data). Create one source description for the FamilySearch tree using only the schema-allowed fields (`id`, `title`, `citation`, `author`, `url` — NO `quality`, `notes`, `repository`, or `accessed`). Then attach a source reference to every fact and relationship (`quality` goes here, on fact-level refs, not on source descriptions):
```json
{ "id": "F1", "type": "Birth", "date": "~1845", "standard_date": "Abt 1845", "place": "Ireland", "standard_place": "Ireland", "sources": [{ "ref": "S1", "quality": 1 }] }
```

The top-level `sources[]` array you already surveyed above is not the same thing as this per-fact `sources` ref — a fact with no ref yet just means you haven't attached one, not that no sources exist at all. If `person_read`'s result is too large to `Read` directly, count `len(sources)` on the top-level array before drawing any conclusion about how many sources are attached.

`person_read` facts arrive with two standardized sidecars — `standard_place` and `standard_date`. **Carry both through exactly as returned; never re-derive either from the raw `place`/`date`.** Hand-entered places, and any returned fact with a `place` but no `standard_place`: resolve with `place_search` and use `standardPlace` from the first result. Never copy `place` into `standard_place`.

Do NOT call data "unsourced" — it IS sourced to the FamilySearch tree. `quality: 1` signals it's unverified.

**With no FamilySearch data (objective-only build), the researcher's own statement is the source.** Create one source description for it and attach a `quality: 1` reference to every fact and relationship built from it, exactly as for a tree import. Do not leave hand-built facts with no `sources` array: a sourceless fact reads downstream as a claim with no provenance, and it is not what "unsourced" means here.

**Simplified GedcomX rules:** gender as flat string (`Male`/`Female`/`Unknown`); names with `given`, `surname`, optional `preferred: true`; facts with PascalCase `type`; ParentChild uses `parent`/`child`; Couple uses `person1`/`person2`; `preferred`/`primary` omit-when-false.

**No placeholder unknown-person stubs.** Create stubs only for people with at least one concrete identifying detail. A known surname alone qualifies — when a maiden name is stated, it fixes a surname in that woman's **parental line**, but does not by itself tell you *which* parent carries it. Assuming it is the father assumes patrilineal surname descent without evidence — an unsound assumption of exactly the kind `check-warnings/references/assumption-categories.md` names as its canonical example ("a bride's surname is the same as her parents' surname"); unsound assumptions need positive evidence, not a default. Create one stub for that parent, sex left unspecified, linked via a `ParentChild` relationship — do not label or default it as "father." **Spell the unknown given name as `given: ""` — do NOT omit the key.** `given` is required on every name; a surname-only stub is `{"id": "N1", "preferred": true, "given": "", "surname": "Donovan"}`. **Set this person's `gender` to `"Unknown"` — do NOT omit the key.** `gender` is required on every person; a stub missing it fails the write for both project files, not just this person.

**Stub only the people the user actually named or directly implied — no others.** A stated maiden name implies exactly one new person: that woman's parent (not specifically her father).

**Correction path.** If evidence later identifies which parent it actually is, use `tree_correct`'s `remove` operation (`{ relationshipId }` — this never deletes the person) to drop the incorrect `ParentChild` relationship, then `tree_edit`'s `add_relationship` to link the correct parent. Do not use `merge_tree_persons` for this — that operation is for person-identity merges, not relationship reclassification.

Worked example: "the maternal grandmother of Sarah Hennessy; Sarah's mother's maiden name was Mary Donovan" →

**DO create:**
- **Sarah Hennessy** — named by the user.
- **Mary Donovan** — named (full name stated).
- **Mary Donovan's parent** — surname `Donovan`, `given: ""`, `gender: "Unknown"`. Maiden name fixes the surname in her parental line, not which parent carries it.

**Do NOT create:**
- Sarah's father — never mentioned, surname not implied.
- The maternal grandmother — unknown research target (no identifying detail).

When unsure: did the user name them, or is their surname fixed by a stated maiden name? If neither, no stub.

### 4. Create the project

**Call `project_create` once.** It writes both files together, validated against each other. It assigns `id`, `status`, `created` and `updated` — do not supply them.

```
project_create({ projectPath, objective, title, subjectPersonIds: ["I1"], tree: <Step 3> })
```

`objective` from Step 1; `title` a concise 3-6 word session name (e.g. "Patrick Flynn's parents"); `subjectPersonIds` the primary subject's local tree ID. It refuses a subject ID your tree does not contain, and refuses if a project already exists.

Then relay to the user that the project was created, naming the folder.

### 4a. Profile and holdings

`research_append` runs after `project_create` — never before, and never bundled into it. Two sections to write; one call each or one call carrying both in an `ops` array, either is fine.

**`researcher_profile`** — `research_append({ section: "researcher_profile", op: "update", fields: {...} })`. Scan the opening message for a stated experience level and access first. Map `experience_level`; normalize `subscriptions` to the canonical enum (alias table above); store the verbatim `narration_guidance` for that level (table above). When the message supplied answers, never persist the `intermediate` / `["none"]` default in their place. Since the opening-turn rule above always asks and always proceeds, this call always writes — with whichever mix of stated answers and defaults applies, matching what the final summary told the user was defaulted.

**`known_holdings`** — one `{ section: "known_holdings", op: "append", entry: {...} }` per reported item: `holding_type` (from mapping table), `description` (researcher's own words), `relevant_facts` (what it supplies; `null` if not stated), `relates_to_person_ids` (local `I` IDs that exist in the tree; `[]` if none), `confidence` (`confident`/`unsure`), `promoted` (`false`). The tool assigns `id` and `created`. If no holdings were reported, call nothing.

### 5. Pedigree analysis and project summary

Analyze imported data before presenting results:

**Minimum information check** — per person: full name (given + surname)? Specific date (not just ~year)? Specific place (county/parish, not just country)?

**Gap detection:** missing ancestors (no parents)? Missing key life events? Only vague information?

**Obvious error detection:** birth after death; parent-child age gaps outside 15-50 years; children born in locations inconsistent with parents; dates referencing non-existent jurisdictions; sibling births <9 months apart. **This is the complete list — do not flag anything else as an error**, no matter how odd it looks (a missing relationship subtype, an absent Couple relationship, two people sharing a name, a thin source count, or anything else you notice). Such a pattern belongs in **Gap detection** above if it's a missing-ancestor/event/vague-information gap, or is simply not mentioned — never presented as a defect. A deeper data-integrity pass is check-warnings' (`person_warnings`/`person_quality`) job, not this step's. Auditing the sources already attached — whether each belongs, whether it was indexed correctly — is source-evaluation's; name it, never audit them here.

**Historical context signals** — per person, what the era and place imply about where the records will be. Were they of military age during a conflict that reached where they lived, so service, draft or pension files exist? Did a famine, emigration wave or internal migration move this population, leaving the records in the origin jurisdiction rather than the residence? Had civil registration begun there by the recorded date — before it, church registers are the only vitals? And did the named jurisdiction exist at that date, or does the record belong to the parent county or parish it was later split from?

**Source evaluation:** which facts have citations vs. unsourced claims needing priority verification?

**Known-holdings cross-check:**
- Fact researcher holds but tree lacks → already in hand, don't queue a search. Surface as head start.
- Holding disagrees with tree → flag as discrepancy (never frame user's holding as error).
- `oral_knowledge` lead → surface early; oral sources are cheapest and most perishable.

**When the objective disputes the existing relationship** — phrasing like
"correct parents", "the right parents", "parents are not correct" — do NOT
present the imported relationship as established. Frame the current
parent-child (or other disputed) assignment as **the relationship under
investigation**: an *unverified* (`quality: 1`) tree assertion that is the
hypothesis to be tested this project, not a settled fact. Say so in the tree
summary and findings, and never confirm it from the tree it came from
(issue #1471). Recording and testing the doubt is question-selection's job —
here, only the framing changes.

**Present to the user:**
- Research objective
- **Tree summary table** — one row per person: local ID, full name, gender, key facts. Example: `| I1 | Patrick Flynn | Male | Birth ~1845 Ireland · Death 1908 Schuylkill Co PA |`
- Pedigree analysis findings
- Known holdings recorded (if any) and what each contributes
- What's missing (informs first research question) — gaps on people the
  objective does not cover are context only, not proposed research.
- Suggest the next step as a plain-language offer, defining "objective" and
  "research question" on first use — never "use question-selection to…":
  "Your objective is the overall goal — <restate it>. The next step is the
  first research question: the single fact we go after first. Shall I?"

## Example

User: "Start a new research project for person KWCJ-RN4. I want to identify his parents."

1. Call `person_read({ personId: "KWCJ-RN4", relatives: true, sourceDescriptions: true })`
2. Receive: Patrick Flynn, Male, Birth ~1845 Ireland, Death 1908-03-12 Schuylkill County PA. No parents. Spouse: Mary Kelly. Children: James, Margaret. Attached sources.
3. Build the tree in memory — all persons, relationships, sources (quality: 1).
4. `project_create({ projectPath, objective, title, subjectPersonIds: ["I1"], tree })`. Tell the user where the project was created.
5. `research_append` for `researcher_profile` (from their answers, not defaults) and one per volunteered holding.
6. Pedigree analysis + summary. Mary Kelly and the children are tree context
   only — their gaps are noted, not queued. Offer the first research question
   in plain language.

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
- **Never persist a default `researcher_profile` when the opening message stated experience or subscriptions.** Normalize per the interview tables before writing `research.json`.

## Re-invocation behavior

**Writes:** via `project_create` — `research.json` (project metadata, empty section arrays) and `tree.gedcomx.json` (initial persons, relationships, sources); then via `research_append` — `researcher_profile` and `known_holdings`. Runs once at project creation.

**On repeat invocation:** the guard clause detects existing `research.json` and declines. Never overwrites existing `questions`/`plans`/`log`/`assertions`/`sources` content.
