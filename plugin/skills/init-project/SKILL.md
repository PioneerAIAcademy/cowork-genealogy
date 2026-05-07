---
name: init-project
description: Initializes a new genealogy research project with GPS-conformant
  file structures. Creates research.json (GPS audit trail) and
  tree.gedcomx.json (simplified GedcomX deliverable) from a FamilySearch
  person ID. Use when the user says "new project", "start research",
  "research [person]", "find parents of", "begin researching", or provides
  a FamilySearch person ID to start working with. Do NOT use when a
  research.json file already exists in the folder — use project-status
  instead to resume an existing project.
---

# Init Project

Creates a new genealogy research project by fetching a person from the
FamilySearch tree and initializing the two project files:

- `research.json` — the GPS audit trail (questions, plans, log,
  assertions, conflicts, hypotheses, timelines, proof summaries)
- `tree.gedcomx.json` — the simplified GedcomX deliverable (persons,
  relationships, sources)

## Preconditions

- No `research.json` exists in the current folder. If one exists, do
  NOT overwrite it — tell the user this is an existing project and
  suggest using project-status to resume.
- The user must provide a FamilySearch person ID (e.g., `KWCJ-RN4`).
  If they describe a person without an ID, ask them to find the person
  on FamilySearch and provide the ID. v1 requires starting from an
  existing FamilySearch tree person.

## Steps

### 1. Get the research objective

Ask the user for:
- The FamilySearch person ID of the research subject
- The research objective in one sentence (e.g., "Identify the parents
  of Patrick Flynn, born ~1845 in Pennsylvania")

If the user provides just a person ID, use it to fetch the person's
data and formulate a default objective based on what's missing (e.g.,
if the person has no parents in the tree, the objective is "Identify
the parents of [person name]").

### 2. Fetch person data from FamilySearch

Call the `tree_read` tool with the person ID:

```
tree_read({ personId: "<person-id>" })
```

The tool returns the person's data in simplified GedcomX format,
including:
- The person (name, gender, facts)
- Their relatives (parents, spouse, children) with person IDs
- Relationships (ParentChild, Couple)
- Source descriptions attached to the person

If the tool returns an authentication error, instruct the user to
log in: "Please authenticate with FamilySearch first. Type `login`
or ask me to log you in."

### 3. Create `tree.gedcomx.json`

Write the file using the data from `tree_read`. The file follows the
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
- Person IDs: use the FamilySearch person IDs as-is (e.g., `KWCJ-RN4`)
- Name IDs: `N` prefix + sequential number (`N1`, `N2`, ...)
- Fact IDs: `F` prefix + sequential number (`F1`, `F2`, ...)
- Relationship IDs: `R` prefix + sequential number (`R1`, `R2`, ...)
- Source IDs: `S` prefix + sequential number (`S1`, `S2`, ...)

**What to include:**
- The subject person with all their names, facts, and source references
- All relatives returned by `tree_read` (parents, spouse, children)
  with their names and facts
- All relationships (ParentChild, Couple) with source references
- All source descriptions referenced by facts and relationships

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
- `subject_person_ids`: array containing the FamilySearch person ID
  of the primary research subject
- `status`: `active`
- `created`: today's date in ISO 8601 format (e.g., `2026-05-04`)
- `updated`: same as created

All other sections remain as empty arrays.

### 5. Validate

After writing both files, invoke the `validate-schema` skill to verify
the files conform to the published schemas. If validation fails, fix
the errors before proceeding.

### 6. Present the project to the user

Summarize what was created:
- The research objective
- The subject person (name, key facts)
- Known relatives found in the FamilySearch tree
- What's missing or unknown (this informs the first research question)
- Suggest the next step: "Would you like me to select the first
  research question?" (which invokes question-selection)

## Example

User: "Start a new research project for person KWCJ-RN4. I want to
identify his parents."

1. Call `tree_read({ personId: "KWCJ-RN4" })`
2. Receive person data: Patrick Flynn, Male, Birth ~1845 Ireland,
   Death 1908-03-12 Schuylkill County PA. No parents in tree.
   Spouse: Mary Kelly. Children: James Flynn, Margaret Flynn.
3. Write `tree.gedcomx.json` with Patrick, Mary, James, Margaret,
   their relationships, and source descriptions
4. Write `research.json` with:
   ```json
   {
     "project": {
       "id": "rp_001",
       "objective": "Identify the parents of Patrick Flynn (KWCJ-RN4), born ~1845 in Ireland, died 1908 in Schuylkill County, PA",
       "subject_person_ids": ["KWCJ-RN4"],
       "status": "active",
       "created": "2026-05-04",
       "updated": "2026-05-04"
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
5. Run validate-schema
6. Tell the user: "Project created. Patrick Flynn has no parents in
   the FamilySearch tree. His spouse Mary Kelly and children James and
   Margaret are included. Would you like me to select the first
   research question?"

## Important rules

- **Never overwrite an existing project.** If `research.json` exists,
  stop and tell the user.
- **v1 is read-only.** The tree.gedcomx.json file is for local research
  tracking. It is not uploaded back to FamilySearch.
- **Use FamilySearch person IDs.** Do not generate synthetic IDs like
  `I1` for persons that come from FamilySearch — use their real IDs.
  Synthetic IDs (`I1`, `I2`, ...) are only for persons created locally
  during research (e.g., stub persons from record-extraction).
- **Include relatives.** The FAN principle (Family, Associates,
  Neighbors) is central to genealogy research. Including known
  relatives from the start gives downstream skills (person-evidence,
  timeline, hypothesis-tracking) persons to link assertions to.
