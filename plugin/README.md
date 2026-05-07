# Genealogy Research Plugin — Skill Catalog

A Claude Cowork plugin for GPS-conformant genealogy research. This plugin teaches Claude how to conduct rigorous genealogical research following the Genealogical Proof Standard (GPS) — the industry methodology for establishing the credibility of family history conclusions.

## How it works

The plugin manages two project files:

- **`research.json`** — The GPS audit trail. Questions, plans, search log, assertions, conflicts, hypotheses, timelines, and proof summaries.
- **`tree.gedcomx.json`** — The deliverable. Resolved persons, relationships, and facts in simplified GedcomX format.

Skills read from and write to these files. There is no programmatic skill-to-skill invocation — Claude reads skill descriptions and decides what to invoke based on the file state and your intent.

## Recommended workflow

```
1. init-project         Start with a FamilySearch person ID
2. question-selection   "What should I research next?"
3. research-plan        "How do I answer this question?"
4. search-records       Execute indexed searches on FamilySearch
   search-full-text       ...or full-text search for witnesses/FAN mentions
   search-external-sites  ...or on Ancestry/MyHeritage/FindMyPast
5. record-extraction    Extract assertions from found records
6. assertion-classification  Refine evidence classifications
7. citation             Polish citations to Evidence Explained standards
8. person-evidence      Link assertions to persons in the tree
9. timeline             Build chronological timeline, find gaps
10. conflict-resolution  Resolve disagreements between sources
11. hypothesis-tracking  Track competing candidates
12. proof-conclusion     Write the GPS conclusion
    tree-edit            Merge persons, correct facts
13. project-status       "Where are we? What's next?"
```

This is the ideal GPS cycle. In practice, you can invoke any skill at any time — each checks its own preconditions and guides you if prerequisites are missing.

---

## User-facing skills

These are the skills you interact with directly. They're listed in the order you'd typically use them in a research project.

### Starting and resuming

| Skill | What it does | Say this |
|-------|-------------|----------|
| **init-project** | Creates a new project from a FamilySearch person ID. Fetches the person and their relatives to seed the tree. | "Start a new project for person KWCJ-RN4" |
| **project-status** | Summarizes project progress with detailed GPS state + a conversational narrative. Recommends the next step. | "Where are we?" / "What's next?" / "Status" |

### Planning the research

| Skill | What it does | Say this |
|-------|-------------|----------|
| **question-selection** | Picks the most valuable next research question. Also evaluates whether a question's research is exhaustive. | "What should I research next?" / "Is this research exhaustive?" |
| **research-plan** | Creates a sequenced plan of record sets to search, with repositories, rationale, and fallbacks. | "Plan research for this question" / "What records should I search?" |

### Executing searches

| Skill | What it does | Say this |
|-------|-------------|----------|
| **search-records** | Searches FamilySearch indexed records (census, vital records, probate, etc.). Triages results by match quality. | "Search for Patrick Flynn in the 1850 census" / "Execute the plan" |
| **search-full-text** | Full-text searches of FamilySearch AI-transcribed document images. Finds witnesses, neighbors, heirs, and other non-principal mentions that indexed search misses. | "Full-text search for Flynn in Schuylkill County deeds" / "Search for witnesses" |
| **search-external-sites** | Generates search URLs for Ancestry, MyHeritage, FindMyPast, FindAGrave, Newspapers.com. Walks you through the click-capture-analyze loop. | "Search Ancestry for Thomas Flynn" |

### Analyzing evidence

| Skill | What it does | Say this |
|-------|-------------|----------|
| **record-extraction** | Extracts atomic assertions from a record (MCP response, uploaded PDF, or image transcription). | "Analyze this record" / "Extract assertions" |
| **assertion-classification** | Refines three-layer GPS classifications (Primary/Secondary/Indeterminate, Direct/Indirect/Negative). | "Classify this evidence" / "Primary or secondary?" |
| **citation** | Polishes citations to Evidence Explained standards (Who/What/When/Where/Where-within). | "Fix citations" / "Evidence Explained format" |

### Identity resolution and analysis

| Skill | What it does | Say this |
|-------|-------------|----------|
| **person-evidence** | Links assertions to persons. Evaluates identity matches with threshold enforcement. Creates stub persons when needed. | "Is this the same person?" / "Link all roles in this record" |
| **timeline** | Builds chronological timelines. Surfaces gaps and impossibilities. Tests whether records cohere into one life. | "Build a timeline" / "Do these events fit one life?" |
| **conflict-resolution** | Analyzes conflicting evidence — independence analysis + preponderance hierarchy. | "These sources disagree" / "Resolve this conflict" |
| **hypothesis-tracking** | Tracks competing candidates with evidence for/against each. Manages elimination process. | "Could this be the same person?" / "Track this hypothesis" |

### Concluding

| Skill | What it does | Say this |
|-------|-------------|----------|
| **proof-conclusion** | Writes the GPS proof conclusion — tier, vehicle, self-contained narrative. Updates the tree when confidence reaches Probable or higher. | "Write the conclusion" / "What's the proof?" |
| **tree-edit** | Direct corrections to the tree file. Also executes person merges after proof-conclusion confirms identity. | "Fix this name" / "Merge these two persons" |

### Reference and context

| Skill | What it does | Say this |
|-------|-------------|----------|
| **locality-guide** | Produces a structured research guide for a place/time — what records exist and where they're held. | "What records exist for Schuylkill County?" |
| **historical-context** | Explains boundary changes, naming conventions, migration patterns, and cultural context affecting records. | "Why does the birthplace differ?" / "Naming conventions" |
| **translation** | Genealogy-specific translation for German, French, Spanish, Italian, Dutch, Latin, Portuguese. Period handwriting and abbreviations. | "Translate this German church record" |

---

## Internal skills (guardrails)

These skills enforce correctness. They're invoked by other skills per the validation protocol, or by you directly when you want to check the project.

| Skill | What it does | Triggered by |
|-------|-------------|-------------|
| **validate-schema** | Validates both project files against the published schemas. Checks required fields, enum values, ID prefixes, cross-references. | Every writing skill invokes this after writing. You can also say "validate the files." |
| **check-warnings** | Checks for genealogical impossibilities (married before 12, died after 120, child born after parent's death). | Writing skills invoke after adding assertions/person_evidence. You can say "check for warnings." |
| **convert-dates** | Converts dates at calendar boundaries — Julian/Gregorian, Old Style/New Style, Quaker double-dating. | When dates from pre-Gregorian periods are encountered. You can say "convert this date." |

---

## Commands

### /wiki

Shortcut for the wiki-lookup reference skill. Looks up a topic on Wikipedia and saves the summary as a markdown file.

Usage: `/wiki Albert Einstein`

---

## Project files reference

| File | Purpose | Updated by |
|------|---------|-----------|
| `research.json` | GPS audit trail — all analytical state | Most skills |
| `tree.gedcomx.json` | Simplified GedcomX — resolved persons, relationships, sources | init-project, record-extraction (sources), person-evidence (stubs), proof-conclusion (facts/relationships), tree-edit |

Specs: `docs/specs/research-schema-spec.md` and `docs/specs/simplified-gedcomx-spec.md`

---

## What's not built yet

The skills are designed against the full MCP tool set described in `docs/specs/skill-list-spec.md`. Many MCP tools are not yet implemented. Skills that depend on unbuilt tools will guide you to alternative approaches or inform you when a tool is unavailable. See `PROJECT-GOAL.md` for the MCP server build progress.
