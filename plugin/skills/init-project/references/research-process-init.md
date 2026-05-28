# Research Process: Initialization Phase

Guidance for Steps 1-2 of the genealogical research process, which are
the steps relevant to project initialization.

## Step 1: Defining the Problem

### Objective vs. Question

These two concepts are distinct and must not be conflated:

- **Research objective**: The overarching goal of the entire project.
  Broad in scope. Example: "Identify all children of James and Mary
  Thompson of Fayette County, Kentucky."
- **Research question**: A specific, narrowly scoped question that
  contributes toward the objective. Example: "What is the birth date
  and birthplace of Sarah Thompson, daughter of James and Mary?"

At project initialization, the user provides the **objective**. Research
questions are formulated later (by the question-selection skill) as
discrete, answerable sub-problems.

### Two Fundamental Categories

Every genealogical problem ultimately seeks one of two things:
- **A relationship** -- who is connected to whom (parentage, marriage,
  siblings)
- **An event** -- something that happened at a specific time and place
  (birth, death, marriage, migration, land purchase)

When formulating an objective, classify it as relationship-focused or
event-focused. This classification guides which record types will be
most productive.

## Step 2: Surveying Known Information

### Why This Step Matters

The answer to the research question -- or at least the pathway to the
answer -- often already exists in previously gathered information.
Skipping this step leads to redundant work and missed clues.

### Preliminary Survey Sources

Before searching original records, check these compiled/derivative
sources for existing information:

- FamilySearch Family Tree (the starting point for this skill)
- Other online trees (Ancestry, MyHeritage)
- Published family histories and genealogies
- Local and county histories with biographical sketches
- Genealogical society periodicals
- Find A Grave memorials
- Informal online sources (blogs, forums, Wikipedia)

### Evaluating What You Find

Never accept prior research at face value. Apply these checks:

- Is there enough detail to confirm you have the right individual?
- Are claims supported by cited sources?
- Do the citations reference original records, or only other compiled
  sources?
- Are specific dates present (suggesting actual records were consulted)
  or only round numbers/estimates?
- Does the information pass basic plausibility checks (reasonable ages,
  consistent locations, logical timelines)?

### FamilySearch Tree Data Specifically

The FamilySearch Family Tree is a collaborative, user-edited resource.
Data quality varies enormously. When importing tree data at project
initialization:

- Treat all facts as **unverified starting points**, not established
  conclusions
- Note which facts have source citations attached and which do not
- Flag any obvious inconsistencies (impossible dates, contradictory
  locations) for investigation
- Record the data as-is for now -- verification happens during the
  research process, not at initialization

## Pedigree Analysis at Init Time

The SKILL.md step 6 contains the full checklist for pedigree analysis.
This section provides supplementary rationale.

### Why Analyze at Init

Pedigree analysis serves two purposes during initialization:
1. It identifies what is missing, which directly informs the first
   research question (handled by question-selection).
2. It surfaces obvious errors that might otherwise be accepted as
   fact during downstream research.

### Interpreting Vague Data

- A birth year of "about 1845" likely derives from census age
  subtraction, not a vital record. This is a clue, not a fact.
- A birthplace of just "Ireland" or "Germany" suggests no one has
  located an original record specifying the actual parish or town.
- Round death years (e.g., "1900") without a month/day often come
  from Find A Grave memorials or unsourced tree entries.

### Context for Error Flags

Not every anomaly is an error. Parent-child gaps near 50 years are
unusual but not impossible. Sibling intervals under 9 months can
indicate twins, step-siblings, or data-entry mistakes. Present
anomalies as "flags for investigation," not as definitive errors.

## Recording Conventions

See the "Important rules" section of SKILL.md for the authoritative
list. Key point for reference: use ISO 8601 dates in JSON data fields
but day-month-year in human-readable output.

## Decision Rules for Init

| Situation | Action |
|-----------|--------|
| User gives a clear objective + person ID | Proceed directly with fetch and file creation |
| User gives only a person ID | Fetch data, analyze gaps, propose a default objective based on what is missing |
| User's stated objective is too vague | Help narrow it: ensure it identifies a specific person and a specific goal |
| User's objective conflates multiple questions | Accept it as the broad objective, note that individual questions will be formulated later |
| person_read returns a person with no gaps | Still create the project -- the user may want to verify existing information or extend the tree |
| person_read returns obvious errors in dates/places | Note them in the project summary; do not silently correct them |
| User wants to skip straight to searching records | Explain the value of Step 2 (surveying known info) but do not block them |
| Data from FamilySearch lacks source citations | Flag this in the summary -- unsourced claims need verification |
| person_read returns a person with no relatives | Create the project; note isolation in summary and that FAN research will be harder |
| User has no FamilySearch person ID | Explain v1 requires starting from an existing tree person; suggest they create one on FamilySearch |
