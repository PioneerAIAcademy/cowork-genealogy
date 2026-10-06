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

**Narration** (initialize path only — the guard clause above reads nothing): the house style under "Researcher profile" below, verbatim. No preamble per action; one report when the project is written.

**Places:** Follow `references/places-guidance.md` for places you enter by hand (stubs, the objective-only build): resolve each with `place_search`. Places from `person_read` are handled by `project_create`.

## Opening turn

Ask one thing in the opening turn, alongside the person ID/name request: the research objective. **Never stop and wait for it. Complete the full initialization in a single pass:**

1. **If the user's message already states an objective** — keep going.
2. **If not, ask it in this same opening-turn message, but do not wait for a reply before proceeding.** Store this exact text, verbatim, as `objective`: "General research: build out the tree and identify gaps and next steps." Never invent, infer, or default a *specific* research direction (a migration story, a disputed relationship, a name-origin theory) from the person's data alone — this verbatim generic default is the only fallback. Write the files now and say in the final summary that the objective was defaulted.

Asking a question and then stopping to wait is a failure: the project never gets created.

### Researcher profile — fixed, never asked

Do not ask about experience level or anything else about the researcher. Every project gets the same profile: `experience_level: "novice"` and this `narration_guidance`, stored verbatim:

> Plain language for someone who has never done genealogy. No identifiers, file names, tool names or field names. Never write GPS, proof, proved or exhaustive: say genealogy standards; call an answer a conclusion when it is well established and a finding otherwise; say what we searched and what we could not reach. Do not describe your own instructions or checks. Do not narrate between actions; report once when the step is done: what was found, in one paragraph, and what happens next in one sentence.

A stated level in the message ("I'm a professional genealogist") is not persisted. Store both fields in `research.json` `researcher_profile` (Step 4).

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

Create the project from the read exactly as you normally would: `project_create`
builds every person, relationship, and documentary fact from it, *including the
very slice they asked you to leave out*. Then finish init-project normally and tell the researcher the tree is
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

Call `person_read({ personId: "<id>", projectPath })`. It returns simplified GedcomX: person (name, gender, facts, and the person-level `sources` refs FamilySearch attached), relatives with IDs, relationships, and source descriptions. Auth error → tell user to log in.

**Pass `projectPath` too.** For a non-living subject the `sources` array also carries that person's **memories** — scanned wills, certificates, obituaries, family stories — each with `text` when the read transcribed it, `image_ref` when a scan was retained, and a `notes` entry when it was not. `projectPath` is what retains those scans; without it they are transcribed but not kept.

The response carries `staged.resultsRef`: the read, kept on the host. Step 4 passes it to `project_create`. If `staged` is absent or `null`, call `person_read` once more; if it is still missing, tell the user the project could not be created, quoting `stagingError` when present, and stop. Never type the tree out yourself.

**User-stated facts vs. FamilySearch conflicts:**
- **tree.gedcomx.json:** use FamilySearch data (the source being surveyed)
- **Research objective:** use the user's stated facts, in the user's own wording (reflects user's understanding). Do not add the subject's vitals — birth/death dates or places — from `person_read`/FamilySearch to the `objective`, even when the user stated none: those belong in the tree, and the objective records the user's stated direction, not the record's
- **Flag the discrepancy** with user's statement first: "You stated [Y]; FamilySearch shows [X] — both will need verification."
- Never frame the user's information as an error.

### 3. Additions: people the researcher's statements imply

`project_create` builds the tree from the staged read: every person, relationship, and source, with its ids and source references. Do not copy the read into a tree. Your only tree input is **additions**, people the read does not contain that the researcher's own statements imply.

An addition is a person with a label `id` (`A1`, `A2`…), `gender`, and `names`; a relationship to someone from the read names that person by FamilySearch ID. Use `Male`/`Female`/`Unknown`; ParentChild uses `parent`/`child`, Couple uses `person1`/`person2`. Shape additions and an objective-only tree per `references/simplified-gedcomx-summary.md`.

Count attached sources from the read's top-level `sources` array, never from per-fact refs, and never call FamilySearch data "unsourced".

**With no FamilySearch data (objective-only build),** build the people the researcher stated as a tree, with local `I` ids for persons, and pass it as `tree`. `project_create` assigns any missing name, fact, or relationship id and cites the researcher's statement for anything unsourced.

**No placeholder unknown-person stubs.** Create stubs only for people with at least one concrete identifying detail. A known surname alone qualifies — when a maiden name is stated, it fixes a surname in that woman's **parental line**, but does not by itself tell you *which* parent carries it. Assuming it is the father assumes patrilineal surname descent without evidence — an unsound assumption, and the canonical example of one ("a bride's surname is the same as her parents' surname"); unsound assumptions need positive evidence, not a default. Create one stub for that parent, sex left unspecified, linked via a `ParentChild` relationship — do not label or default it as "father." **Spell the unknown given name as `given: ""` — do NOT omit the key.** `given` is required on every name; a surname-only stub is `{"id": "A1", "gender": "Unknown", "names": [{ "given": "", "surname": "Donovan" }]}` (an `I` id in the objective-only build). **Set this person's `gender` to `"Unknown"` — do NOT omit the key.** `gender` is required on every person; a stub missing it fails the write for both project files, not just this person.

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
project_create({ projectPath, objective, title, personReadRef: <staged.resultsRef>, subjectPersonIds: ["<subject's FamilySearch ID>"], tree: { persons: [<additions>], relationships: [<their links>] } })
```

`objective` from Step 1; `title` a concise 3-6 word session name (e.g. "Patrick Flynn's parents"); `personReadRef` the subject's `staged.resultsRef` (if you read more than one person, the subject's); `subjectPersonIds` the subject's FamilySearch ID. Omit `tree` when there are no additions. With no FamilySearch data, omit `personReadRef` and pass the Step 3 tree, with `subjectPersonIds` its local `I` id.

The result's `idMap` gives the tree ids assigned: `persons` (FamilySearch ID → `I` id), `sources` (FamilySearch source id → `S` id), `additions` (your labels → `I` ids). Use those ids in every later step.

If `project_create` refuses with `subject_person_ids contains '<the subject's FamilySearch ID>' which is not in tree.gedcomx.json persons`, the installed extension predates `personReadRef`: tell the user to update it, and stop. Any other refusal is about your call: fix it and call again.

Then relay to the user that the project was created, naming the folder.

### 4a. Profile and holdings

`research_append` runs after `project_create` — never before, and never bundled into it. Two sections to write; one call each or one call carrying both in an `ops` array, either is fine.

**`researcher_profile`** — `research_append({ section: "researcher_profile", op: "update", fields: { experience_level: "novice", narration_guidance: "<the fixed string above, verbatim>" } })`. Always the same two values; this call always writes.

**Do not ask about site access, and do not write `subscriptions`.** Access is assumed available; leave the field absent rather than defaulting it. `["none"]` asserts the researcher told us they have nothing, which is the opposite of what we now assume.

Record it **only** when the researcher volunteers access unprompted — the question was dropped, not the field. The enum is closed, so normalize before writing: case-fold and map to `Ancestry`, `MyHeritage`, `FindMyPast`, `Newspapers.com`, `GenealogyBank`, `FindAGrave-Plus`, `FamilySearch-Partner` (a partner subscription held through FamilySearch), `LibraryAccess` (public library, family history centre, or affiliate library), or `other` for anything unrecognized. A plain FamilySearch account is the baseline everyone has — never store it. If nothing survives normalization, omit the field; never write `["none"]` or `[]`.

**Memory sources** — for each `person_read` source that arrived with `text`, one `{ section: "sources", op: "append", entry: {...} }`. Put the `text` verbatim in `transcription`, the source's `image_ref` in `image_filename` (omit if absent), and point `gedcomx_source_description_id` at `idMap.sources[<that source's id>]` — never a second, duplicate entry for it. `source_classification` is `original` for a scanned record, `derivative` when the memory is a transcription or abstract of one, `authored` for a family-written story. Fill the rest from the memory itself:

```
{ "section": "sources", "op": "append", "entry": {
    "gedcomx_source_description_id": "S3",
    "citation": "\"Last Will and Testament of Almon G. Clegg,\" digital image, FamilySearch Memories (https://www.familysearch.org/memories/228755097 : accessed 15 September 2026), memory 228755097, uploaded to the profile of Almon Giles Clegg (KWCJ-RN4).",
    "citation_detail": { "who": "Almon G. Clegg (testator)", "what": "Last will and testament", "when_created": "1952", "when_accessed": "2026-09-15", "where": "FamilySearch Memories", "where_within": "memory 228755097" },
    "source_classification": "original",
    "repository": "FamilySearch Memories",
    "access_date": "2026-09-15",
    "url": "https://www.familysearch.org/memories/228755097",
    "transcription": "<the source's text, verbatim>",
    "image_filename": "images/228755097.jpg"
} }
```

A memory whose `notes` says it was not transcribed gets **no** `sources` entry — never one with `transcription: null`. It is already in `tree.gedcomx.json` with its title and URL, which is the lead; a `sources` entry would assert it was examined. Name each one in the Step 5 report, which has a bullet for them. If no memory was transcribed, `sources` stays empty.

**`known_holdings`** — one `{ section: "known_holdings", op: "append", entry: {...} }` per reported item: `holding_type` (from mapping table), `description` (researcher's own words), `relevant_facts` (what it supplies; `null` if not stated), `relates_to_person_ids` (`I` ids from `idMap`; `[]` if none), `confidence` (`confident`/`unsure`), `promoted` (`false`). The tool assigns `id` and `created`. If no holdings were reported, call nothing.

### 5. Pedigree analysis and project summary

**First, invoke `@plugin:check-warnings` once, naming the subject and every
imported relative by their tree `I` id from `idMap` (never the FamilySearch
PID or `ark`, even when the tree summary below lists both),
and asking it to check all of them.** Fold what it returns into the findings
below exactly as check-warnings frames it — never restate a timeline
impossibility as one more line on the "Obvious error detection" list below,
which is a smaller, separate check.

Analyze imported data before presenting results:

**Minimum information check** — per person: full name (given + surname)? Specific date (not just ~year)? Specific place (county/parish, not just country)?

**Gap detection:** missing ancestors (no parents)? Missing key life events? Only vague information?

**Census fertility gap:** when a 1900 or 1910 US census gives the mother's children-born and children-living counts, born minus living is the number of her children dead by that census; each one not already in the tree, having died before the census date, is a gap to research — a child born and died before that enumeration. Living minus the children already in the tree alive at that date is the number of living children still missing. Parity between the living count and the children in the tree does not close the deceased-child gap. The dead count is cumulative: a child dead by 1900 is still counted among the dead in 1910, not an additional one. Apply the same de-duplication to the living-missing count — a child missing at both 1900 and 1910 is one missing child, not two — but a pre-census deceased child and a between-census living child are distinct targets, never merged. Count every child she bore, including by an earlier husband.

**Obvious error detection:** birth after death; parent-child age gaps outside 15-50 years; children born in locations inconsistent with parents; dates referencing non-existent jurisdictions; sibling births <9 months apart. **This is the complete list — do not flag anything else as an error**, no matter how odd it looks (a missing relationship subtype, an absent Couple relationship, two people sharing a name, a thin source count, or anything else you notice). Such a pattern belongs in **Gap detection** above if it's a missing-ancestor/event/vague-information gap, or is simply not mentioned — never presented as a defect. A deeper data-integrity pass is check-warnings' (`person_warnings`) job, not this step's. Auditing the sources already attached — whether each belongs, whether it was indexed correctly — is source-evaluation's; name it, never audit them here.

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
summary and findings, and never confirm it from the tree it came from.
Recording and testing the doubt is question-selection's job —
here, only the framing changes.

**Present to the user** — one short report in the house style, no tree table.
- The objective in one sentence, and whether it was defaulted
- Any obvious error found (the closed list above), one sentence each
- The two or three gaps that set the first research question — gaps on people the
  objective does not cover are context only, not proposed research
- Known holdings recorded (if any) and what each contributes
- Any scanned documents or photos on the profile that could not be read this
  time — name each one and say they can be read later
- If `person_read` returned a top-level `notes` array, one sentence from it: a
  relative FamilySearch names but does not describe was left out. Say it in
  plain words — "FamilySearch lists a parent for him but gives no record for
  that person, so they are not in the tree" — never the count or the field name
- One sentence on what comes next, defining "objective" and "research
  question" on first use — never "use question-selection to…": "Your objective
  is the overall goal — <restate it>. The next step is the first research
  question: the single fact we go after first."
- Then name the next step as a statement and take it in the same turn — never as a
  question, and never as the last line of a reply that stops there.

## Example

User: "Start a new research project for person KWCJ-RN4. I want to identify his parents."

1. Call `person_read({ personId: "KWCJ-RN4", projectPath })`
2. Receive: Patrick Flynn, Male, Birth ~1845 Ireland, Death 1908-03-12 Schuylkill County PA. No parents. Spouse: Mary Kelly. Children: James, Margaret. Attached sources.
3. No additions: the user named no one the read lacks.
4. `project_create({ projectPath, objective, title, personReadRef: <staged.resultsRef>, subjectPersonIds: ["KWCJ-RN4"] })`. Tell the user where the project was created.
5. `research_append` for `researcher_profile` (the fixed novice profile) and one per volunteered holding.
6. `@plugin:check-warnings` for I1, Mary Kelly, James, and Margaret. Pedigree
   analysis + summary, folding in whatever it returns. Mary Kelly and the
   children are tree context only — their gaps are noted, not queued. Then name
   the first research question as the next step and go on to it.

## Important rules

- **Never overwrite an existing project.** Guard clause catches this.
- **v1 is read-only.** tree.gedcomx.json is not uploaded to FamilySearch.
- **The project files use local `I` ids**, assigned by `project_create`. Before it, name a person from the read by FamilySearch ID; after it, by the `I` id in `idMap`.
- **Include relatives** (FAN principle), **siblings included**. Known relatives from the start give downstream skills persons to link to. `person_read` returns siblings by reading each parent; a half-sibling comes back linked to the shared parent only, which is the truth of what was imported.
- **Treat imported data as unverified.** FamilySearch tree is collaborative, quality varies. Never silently correct errors — flag them.
- **Recording conventions:** maiden (birth) surnames for women; places most-specific to most-general; jurisdictions as they existed at event time; ISO 8601 dates in JSON.
- **Handle isolated persons.** If `person_read` returns no relatives, still create the project. Note isolation in summary.
- **No FamilySearch ID → search first.** Call `person_search` before falling back to stubs.
- **Do not skip the preliminary survey.** The tree fetch + known-holdings survey together ARE the preliminary survey (GPS Step 2).
- **The profile is fixed.** Always `novice` and the house-style string, verbatim; never ask, never map a stated level.

## Re-invocation behavior

**Writes:** via `project_create` — `research.json` (project metadata, empty section arrays) and `tree.gedcomx.json` (initial persons, relationships, sources); then via `research_append` — `researcher_profile` and `known_holdings`. Runs once at project creation.

**On repeat invocation:** the guard clause detects existing `research.json` and declines. Never overwrites existing `questions`/`plans`/`log`/`assertions`/`sources` content.
