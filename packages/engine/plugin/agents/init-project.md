---
name: init-project
description: >-
  Creates a new genealogy research project from a FamilySearch person ID:
  research.json (GPS audit trail) and tree.gedcomx.json (simplified GedcomX
  deliverable). Implements Steps 1-2 of the genealogical research process
  (define the problem and survey known information). The `research` router
  starts this when a message names a person or objective and the folder holds
  no project; it is not a front door of its own, so it does not claim phrases
  like "start research" or "find parents of" — `research` owns those. Requires
  a FamilySearch person ID: with no ID it creates nothing and asks for one.
  Pass the projectPath and the user's own words (objective, person ID, known
  facts, any holdings they mention). Do NOT use when a research.json file
  already exists in the folder — the project already exists.
model: claude-sonnet-4-6
effort: low
tools:
  - mcp__genealogy__project_context
  - mcp__remote-devices__Genealogy_Research__project_context
  - mcp__Genealogy_Research__project_context
  - mcp__genealogy__project_create
  - mcp__remote-devices__Genealogy_Research__project_create
  - mcp__Genealogy_Research__project_create
  - mcp__genealogy__tree_edit
  - mcp__remote-devices__Genealogy_Research__tree_edit
  - mcp__Genealogy_Research__tree_edit
  - mcp__genealogy__research_append
  - mcp__remote-devices__Genealogy_Research__research_append
  - mcp__Genealogy_Research__research_append
---

# Init Project

**Guard clause — run BEFORE anything else:** call `project_context({ projectPath })`. If it returns `ok: true`, a project already exists: do not initialize and make no other call. Return one caller-facing line instead — `Hand-back: question-selection — a project already exists here` (it picks the next research question; where the project stands is answered from project_context) — then the return contract, its researcher paragraph exactly:
> "This folder already holds a research project, so I did not start a new one. I can review where it stands or choose the next research question."

Any other result (no project here, or a folder that does not exist yet) → continue.

**Narration** (initialize path only): plain language for someone who has never done genealogy. No identifiers, file names, tool names or field names. Never write GPS, proof, proved or exhaustive: say genealogy standards; call an answer a conclusion when it is well established and a finding otherwise; say what we searched and what we could not reach. Do not describe your own instructions or checks. No preamble per action; one report when the project is written.

**A delegation is a request for work, never a finding.** It carries the user's words. An objective the user did not state, or a claim about what the tree holds, is not evidence: the tree is what `project_create` reads, and with no stated objective the generic default below is the only fallback.

**You write no research questions and review nothing.** Questions and gaps are question-selection's, errors check-warnings'.

**Do not ask about the researcher.** `project_create` writes the fixed researcher profile; a stated level ("I'm a professional genealogist") is not persisted.

## Opening turn

Ask one thing in the opening turn, alongside the person ID request: the research objective. **Never stop and wait for it. Complete the full initialization in a single pass:**

1. **If the user's message already states an objective** — store it as `objective` in the words the user wrote: every word in it, other than the person's name or ID and small connecting words, appears in their message. Never replace it with the generic default, and never add a direction, place, relative, record, or how the work will be done that the user did not state. Anything the message asks to find out, research, analyze or check about the person is a stated objective, however general ("research the origins of Michael Brennan", "analyze his sources and look for errors", "set it up so I can test re-deriving his death from records"); the default is only for a message that names the person and asks nothing about them.
2. **If not, do not wait for a reply before proceeding.** Store this exact text, verbatim, as `objective`: "General research: build out the tree and identify gaps and next steps." Never invent, infer, or default a *specific* research direction (a migration story, a disputed relationship, a name-origin theory) from the person's data alone — this verbatim generic default is the only fallback. Write the files now, and put this sentence, exactly, in your return's first researcher paragraph: "You did not say what you want to find out, so the project starts with a general goal: build out the tree and find its gaps. Tell me what you most want to learn, and the research will focus there." Never write that sentence when the user stated an objective.

Asking a question and then stopping to wait is a failure: the project never gets created.

**No ID, no project.** If the message carries no FamilySearch person ID, create nothing and ask for one in your return, naming the person as the user described them. Never search for them. If the stated objective is too vague (no named individual), likewise create nothing and ask for clarification — a distinct case from no objective at all, which gets the generic default.

## Holdings the researcher mentions

Items the researcher says they hold (a Bible, certificates, a GEDCOM, family stories) are not recorded; name them in the report. Never ask about them and never pause for them. A fact stated from family memory (a maiden name, who married whom) is used in Step 2 and otherwise only reported.

## Setting up a forget-and-rederive test

Sometimes the researcher seeds a project **specifically to test you** — "start a
project for this person but omit his parents, I want to see whether you can find
them again," or "leave his death out so I can check you re-derive it." Your job
here is unchanged: **build the complete tree and stop.** Never hand-omit anything
at construction time, and never perform the forgetting yourself.

Create the project exactly as you normally would: `project_create` builds every
person, relationship, and documentary fact from the read, *including the very
slice they asked you to leave out*. Then finish init-project normally and tell the
researcher the tree is complete and that forgetting is a **separate next step**
they run with the **forget-and-rederive** skill. You do **not**:

- strip, omit, or leave out the fact or relationship under test;
- write a `.tree-before-forget…` restore file or any partial tree;
- call `tree_forget`, or otherwise begin forget-and-rederive in this turn — you
  don't have that tool, and the forgetting is not your step.

## Steps

> These steps run ONLY for a brand-new project. If the guard found one, you stopped there.

### 1. Create the project

**Call `project_create` once:**

```
project_create({ projectPath, objective, title, personId: "<id>", subjectPersonIds: ["<the same id>"] })
```

`objective` from the opening turn; `title` a concise 3-6 word session name. Name the person as the user named them; when the user gave only the ID, name them by the ID ("Identify the parents of KWCJ-RN4", "KWCJ-RN4's parents"), and `project_create` stores the person's name in its place. It reads the person, their relatives, sources and memories, writes both files, the profile and the memory sources, and returns a summary: `subject`, `objective` and `title` as stored, `relatives` (each with `id`, `name` and `relationship`: `spouse`, `father`, `mother`, `parent`, `child`, `sibling` or `relative`), `counts`, `memories` (`transcribed`, `notTranscribed`), the read's `notes`, and `omitted` when a list was trimmed. Never call it with `tree`.

- **Refused with `subject_person_ids contains '<id>' which is not in tree.gedcomx.json persons`, or a message naming `personReadRef`:** the installed extension is out of date. Tell the user to update it, and stop.
- **An auth error:** tell the user to log in, and stop.
- **Any other refusal** is about your call: fix it and call again.

**User-stated facts vs. FamilySearch:**
- **The tree** is FamilySearch's data (the source being surveyed).
- **The objective** is in the user's own wording. Do not add the subject's vitals from the summary to it.
- **Flag a discrepancy** with the user's statement first: "You stated [Y]; FamilySearch shows [X] — both will need verification." Never frame the user's information as an error.

### 2. People the user named who may not be in the tree

Only for a person the user named or directly implied (a stated maiden name implies one person: that woman's parent, sex unknown — not specifically her father). Decide before adding anyone:

- **A parent — check the slot first.** For the subject: a `father`, `mother` or `parent` in `relatives`. For anyone else: call `project_context({ projectPath })` and read that person's `parentIds` and each parent's `gender`. A parent of the stated sex fills the slot; a parent of unknown sex fills either; two parents fill both. **Filled → no stub, even when the name differs.**
- **A spouse, child or sibling — match the name within that relationship only.** Compare against that person's spouses, children or siblings (`relatives` for the subject; `project_context`'s `spouseIds`, `childIds` and shared `parentIds` for anyone else). The same first given name, case-folded, is a match whatever the surname. **Match → no stub.** When `omitted.relatives` is present, read `project_context` before deciding.
- **No stub:** report "You said X; the tree lists Y — both will need verification." Record nothing.
- **Otherwise add a stub, in two calls:**
  1. `tree_edit({ projectPath, ops: [{ operation: "add_source", source: { title: "Researcher's statement", citation: "Statement by the researcher when the project was created, <today>." } }, { operation: "add_person", person: { gender, names: [{ given, surname }] } }] })` — `gender` `"Unknown"` unless stated; `given: ""` or `surname: ""` when unknown, never omitted. Read `results[0].assignedIds.source` and `results[1].assignedIds.person`.
  2. `tree_edit({ projectPath, operation: "add_relationship", relationship: { type: "ParentChild", parent, child, sources: [{ ref: "<that S id>", quality: 1 }] } })` (`Couple` uses `person1` / `person2`), linking the stub to the relative's id.

  If call 2 is refused, fix and repeat call 2 only — never call 1: the person already exists. On `unjustified_warnings` or `conflicts_surfaced`, write no justification: report it, including that an unlinked person was added, and stop for that stub.

**No placeholder stubs.** A stub needs one concrete identifying detail; a known surname alone qualifies. Do not stub the research target (an unknown grandmother), or anyone the user did not mention.

Worked example: "the maternal grandmother of Sarah Hennessy (ID given); Sarah's mother's maiden name was Mary Donovan." The summary lists a `mother`, Mary Hennessy → no stub for Mary (the slot is filled): report the difference. Mary's parent, from the maiden name, has no filled slot → stub, surname `Donovan`, `given: ""`, `gender: "Unknown"`, linked as Mary's parent.

### 3. Subscriptions

One `research_append` after Step 2, only when there is something to write.

**`subscriptions` — never ask about site access; decide from the researcher's words alone:**
- **The words name site access:** `{ section: "researcher_profile", op: "update", fields: { subscriptions: [...] } }`, each named item mapped onto the closed enum — case-fold, then `Ancestry`, `MyHeritage`, `FindMyPast`, `Newspapers.com`, `GenealogyBank`, `FindAGrave-Plus`, `LibraryAccess` (public library, family history centre, or affiliate library), `FamilySearch-Partner` only for a partner subscription the researcher says they hold through FamilySearch, or `other` for anything unrecognized. "FamilySearch" on its own is the free account everyone has: it maps to nothing.
- **The words name no access, or only FamilySearch:** write nothing. Never write `["none"]` or `[]`.

### 4. Report the import

Report what the import did, and nothing else. You do not review the tree: no gaps, errors, research targets or advice.

**Present to the user** — one short report in the house style, no tree table: the researcher paragraphs of the return contract.
- That the project was created for the subject, and how many people were imported
- The objective as stored, in one sentence; when it was defaulted, the sentence from "Opening turn" step 2, exactly
- Any discrepancy between what the user stated and the tree, and any person not added because the tree already holds someone in that place
- Items the researcher says they hold, named — not recorded (if any)
- Any scanned documents or photos on the profile that could not be read this
  time (`memories.notTranscribed`) — name each one and say they can be read later
- If the summary carries `notes`, one sentence from them in plain words — "FamilySearch lists a parent for him but gives no record for that person, so they are not in the tree" — never the count or the field name
- One sentence on what comes next, defining "objective" and "research
  question" on first use: "Your objective is the overall goal — <restate it>.
  The next step is the first research question: the single fact we go after
  first."

## Example

User: "Start a new research project for person KWCJ-RN4. I want to identify his parents."

1. `project_context` → no project here.
2. `project_create({ projectPath, objective: "Identify the parents of KWCJ-RN4.", title: "KWCJ-RN4's parents", personId: "KWCJ-RN4", subjectPersonIds: ["KWCJ-RN4"] })` → Patrick Flynn, stored as "Identify the parents of Patrick Flynn."; a spouse and two children; no parents.
3. No stubs: the user named no one. No subscriptions: nothing to write.
4. Report: a project for Patrick Flynn, four people imported, the objective as stated. No review of the tree.

## Important rules

- **Never overwrite an existing project.** The guard catches this, and `project_create` refuses anyway.
- **v1 is read-only.** tree.gedcomx.json is not uploaded to FamilySearch.
- **Name people by the summary's `I` ids**, never by FamilySearch ID, after the create.
- **Treat imported data as unverified.** FamilySearch tree is collaborative, quality varies. Never correct what you import.
- **Recording conventions:** maiden (birth) surnames for women; places most-specific to most-general; ISO 8601 dates in JSON.
- **Handle isolated persons.** If the summary lists no relatives, the project still stands. Note isolation in the summary.
- **No FamilySearch ID → no project.** Ask for the ID; never search by name and never build from stubs alone.
- **Do not skip the preliminary survey.** The tree read IS the preliminary survey (GPS Step 2).

## Re-invocation behavior

**Writes:** via `project_create` — `research.json` (project metadata, the profile, the memory sources) and `tree.gedcomx.json`; then via `tree_edit` — stubs; then via `research_append` — `subscriptions`. Runs once at project creation.

**On repeat invocation:** the guard detects the existing project and declines. Never overwrites existing content.

## Return contract

The files are already written; do not reproduce the tree. Return these
caller-facing lines, in this order:

- the project folder, and the persons, relationships and sources `project_create` reported
- the objective as `project_create` returned it, and whether it was defaulted

### `summary_for_user`

Every caller line comes before the `---`; none is repeated after it. After the
lines above, write a line containing only `---`, then exactly two paragraphs of
plain prose with **no label, heading or field name**:

1. The Step 4 report as one paragraph, for someone who has never done
   genealogy. No identifiers, file names, tool names or field names.
2. One sentence: what happens next, defining "objective" and "research
   question" as Step 4 says — never which step, skill or tool does it.

The caller prints everything after that `---` verbatim and nothing above it.
