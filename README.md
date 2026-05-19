# Genealogy Research

A Claude Cowork plugin and desktop extension for GPS-conformant
genealogy research. The project ships two coupled artifacts from this
single repo:

1. **MCP Server** (`mcp-server/`) — A TypeScript MCP server packaged
   as a Claude Desktop Extension (.mcpb). Runs on the host machine
   with full network access. Wraps genealogy and reference APIs
   (FamilySearch, Wikipedia) and exposes them as MCP tools.
2. **Cowork Plugin** (`plugin/`) — Skills, slash commands, and
   templates that run inside Cowork's sandboxed VM. Teaches Claude
   when and how to use the MCP server's tools.

The two communicate only through MCP tool calls — structured JSON in,
structured JSON out. The MCP server runs on the host because the
Cowork VM has restricted egress; anything that touches the network
has to live in the server.

The plugin manages two project files:

- **`research.json`** — The GPS audit trail. Questions, plans, search
  log, assertions, conflicts, hypotheses, timelines, and proof
  summaries.
- **`tree.gedcomx.json`** — The deliverable. Resolved persons,
  relationships, and facts in simplified GedcomX format.

Skills read from and write to these files. There is no programmatic
skill-to-skill invocation — Claude reads skill descriptions and
decides what to invoke based on file state and your intent.

## A note on responsibility

These tools assist your research; they do not replace it. Every record
returned, every match suggested, every conflict resolution is a starting
point for you to verify against original sources. The Genealogical Proof
Standard requires the researcher — not the tool — to weigh evidence,
resolve conflicts, and reach conclusions. Outputs from this plugin are
working drafts in your research process, not citable conclusions.

This applies across the full spectrum of users — from someone starting
their first family tree to a Certified Genealogist preparing a case for
a Board for Certification of Genealogists peer review. The standard is
the same; the tools just help you meet it faster.

## MCP tools

The MCP server exposes 18 tools.

### FamilySearch records and places

| Tool | Purpose | Auth |
|------|---------|------|
| `places` | FamilySearch place data + Wikipedia enrichment | None |
| `collections` | FamilySearch record collections for a place | OAuth |
| `search` | FamilySearch historical-record search for a person | OAuth |
| `tree_read` | FamilySearch Family Tree person data — relatives and attached sources | OAuth |
| `external_links` | FS-curated third-party genealogy URLs by place + year | None |

### FamilySearch Wiki content

| Tool | Purpose | Auth |
|------|---------|------|
| `search_wiki` | Natural-language RAG search of the FS Wiki via a separate `wiki-query-api` server | None (v1) |
| `wiki_fetch_page` | Fetch a specific pre-crawled wiki markdown page | None |
| `wiki_country_home` | Country wiki home page | None |
| `wiki_country_getting_started` | Country "getting started" page | None |
| `wiki_country_records` | Country "records" page | None |
| `wiki_country_research_tips` | Country "research tips" page | None |

### Reference and context

| Tool | Purpose | Auth |
|------|---------|------|
| `wikipedia_search` | Wikipedia article summary lookup | None |
| `population` | Historical population data + indexed record counts | None |
| `place_distance` | Distance between two FamilySearch places | None |
| `image_read` | Read an image file and return bytes + metadata | None |

### Auth (FamilySearch OAuth 2.0 + PKCE)

| Tool | Purpose |
|------|---------|
| `login` | Spin up local callback server, open browser, exchange code for tokens |
| `logout` | Clear stored FamilySearch tokens |
| `auth_status` | Report current FamilySearch session state |

The `population` tool combines data from populstat (234 countries),
gapminder, and FamilySearch indexed birth records. The `search_wiki`
tool runs RAG retrieval over the FamilySearch Wiki. Both call hosted
sidecar APIs (Pop Stats and `wiki-query-api`); no local setup required
for end users.

Tool specs live in `docs/specs/<tool>-tool-spec.md`.

## Skills

The plugin ships 23 skills covering the full GPS research cycle. Skills
are listed in roughly the order you'd use them in a research project.

### Starting and resuming

| Skill | What it does | Say this |
|-------|-------------|----------|
| **init-project** | Creates a new project from a FamilySearch person ID. Fetches the person and their relatives to seed the tree. | "Start a new project for person KWCJ-RN4" |
| **project-status** | Summarizes project progress with GPS state + conversational narrative. Recommends the next step. | "Where are we?" / "What's next?" / "Status" |

### Planning the research

| Skill | What it does | Say this |
|-------|-------------|----------|
| **question-selection** | Picks the highest-value next research question. Also evaluates whether a question's research is exhaustive. | "What should I research next?" / "Is this research exhaustive?" |
| **research-plan** | Creates a sequenced plan of record sets to search, with repositories, rationale, and fallbacks. | "Plan research for this question" |

### Executing searches

| Skill | What it does | Say this |
|-------|-------------|----------|
| **search-records** | Searches FamilySearch indexed records (census, vital, probate, etc.). Triages results by match quality. | "Search for Patrick Flynn in the 1850 census" |
| **search-full-text** | Full-text search of FS AI-transcribed document images. Finds witnesses, neighbors, heirs, and other non-principal mentions. | "Full-text search for Flynn in Schuylkill County deeds" |
| **search-external-sites** | Generates search URLs for Ancestry, MyHeritage, FindMyPast, FindAGrave, Newspapers.com. Walks the click-capture-analyze loop. | "Search Ancestry for Thomas Flynn" |

### Analyzing evidence

| Skill | What it does | Say this |
|-------|-------------|----------|
| **record-extraction** | Extracts atomic assertions from a record (MCP response, uploaded PDF, or image transcription). | "Analyze this record" / "Extract assertions" |
| **assertion-classification** | Refines three-layer GPS classifications (Primary/Secondary/Indeterminate, Direct/Indirect/Negative). | "Classify this evidence" |
| **citation** | Polishes citations to Evidence Explained standards (Who/What/When/Where/Where-within). | "Fix citations" |

### Identity resolution and analysis

| Skill | What it does | Say this |
|-------|-------------|----------|
| **person-evidence** | Links assertions to persons. Evaluates identity matches with threshold enforcement. Creates stub persons when needed. | "Is this the same person?" / "Link all roles in this record" |
| **timeline** | Builds chronological timelines with distances between consecutive events. Surfaces gaps and impossibilities. | "Build a timeline" / "Do these events fit one life?" |
| **conflict-resolution** | Analyzes conflicting evidence — independence analysis + preponderance hierarchy. | "These sources disagree" |
| **hypothesis-tracking** | Tracks competing candidates with evidence for/against each. Manages elimination. | "Could this be the same person?" |

### Concluding

| Skill | What it does | Say this |
|-------|-------------|----------|
| **proof-conclusion** | Writes the GPS proof conclusion — tier, vehicle, self-contained narrative. Updates the tree when confidence reaches Probable or higher. | "Write the conclusion" |
| **tree-edit** | Direct corrections to the tree file. Also executes person merges after proof-conclusion confirms identity. | "Fix this name" / "Merge these two persons" |

### Reference and context

| Skill | What it does | Say this |
|-------|-------------|----------|
| **locality-guide** | Produces a structured research guide for a place/time — what records exist and where they're held. | "What records exist for Schuylkill County?" |
| **historical-context** | Explains boundary changes, naming conventions, migration patterns, and cultural context affecting records. | "Why does the birthplace differ?" |
| **translation** | Genealogy-specific translation for German, French, Spanish, Italian, Dutch, Latin, Portuguese. Period handwriting and abbreviations. | "Translate this German church record" |
| **wiki-lookup** | Reference example skill — fetches a Wikipedia summary and saves it as a markdown file. Also exposed as `/wiki`. | "Look up Albert Einstein on Wikipedia" |

### Internal (guardrails)

These enforce correctness. Most are invoked automatically by other
skills per the validation protocol.

| Skill | What it does | Triggered by |
|-------|-------------|-------------|
| **validate-schema** | Validates both project files against the published schemas. Required fields, enum values, ID prefixes, cross-references. | Every writing skill invokes this after writing. You can also say "validate the files." |
| **check-warnings** | Flags genealogical impossibilities (married before 12, died after 120, child born after parent's death). | Writing skills invoke after adding assertions/person_evidence. You can say "check for warnings." |
| **convert-dates** | Converts dates at calendar boundaries — Julian/Gregorian, Old Style/New Style, Quaker double-dating. | When dates from pre-Gregorian periods are encountered. You can say "convert this date." |

## Recommended workflow

```
1. init-project              Start with a FamilySearch person ID
2. question-selection        "What should I research next?"
3. research-plan             "How do I answer this question?"
4. search-records            Execute indexed searches on FamilySearch
   search-full-text          ...or full-text search for witnesses/FAN mentions
   search-external-sites     ...or on Ancestry/MyHeritage/FindMyPast
5. record-extraction         Extract assertions from found records
6. assertion-classification  Refine evidence classifications
7. citation                  Polish citations to Evidence Explained standards
8. person-evidence           Link assertions to persons in the tree
9. timeline                  Build chronological timeline, find gaps
10. conflict-resolution      Resolve disagreements between sources
11. hypothesis-tracking      Track competing candidates
12. proof-conclusion         Write the GPS conclusion
    tree-edit                Merge persons, correct facts
13. project-status           "Where are we? What's next?"
```

This is the ideal GPS cycle. In practice you can invoke any skill at
any time — each checks its own preconditions and guides you if
prerequisites are missing.

## Project files

| File | Purpose | Updated by |
|------|---------|-----------|
| `research.json` | GPS audit trail — all analytical state | Most skills |
| `tree.gedcomx.json` | Simplified GedcomX — resolved persons, relationships, sources | init-project, record-extraction (sources), person-evidence (stubs), proof-conclusion (facts/relationships), tree-edit |

Specs: `docs/specs/research-schema-spec.md` and
`docs/specs/simplified-gedcomx-spec.md`.

## Researcher profile

When you start a new project with `init-project`, the skill asks you two
short questions:

1. **Experience level** — *just starting out / some research under my
   belt / experienced / professional or certified*.
2. **Paid subscriptions** — Ancestry, MyHeritage, FindMyPast,
   Newspapers.com, GenealogyBank, FindAGrave-Plus, other, or none.

The answers are written to a `researcher_profile` section of
`research.json` alongside the rest of your project state. Every skill
reads from it:

- **Experience level** drives narration density. A novice gets
  step-by-step "why I'm doing this" narration; an experienced
  researcher gets concise reporting. Internally the level maps to a
  `narration_guidance` string that the skill reads and follows
  verbatim — one place defines the mapping (`init-project`), one place
  stores it (`research.json`), every skill reads it.
- **Subscriptions** guide `search-external-sites` URL prioritization.
  Subscribed sites land first; unsubscribed sites are still searchable
  but flagged.

The profile takes under a minute to capture. It lives in
`research.json` because Cowork sessions are ephemeral but the project
folder persists — embedding the profile in the project's own file is
the only storage that survives across sessions.

### Mid-session overrides

You can adjust narration on the fly without re-running the interview.
Natural-language phrases that work:

- "Be more verbose" / "explain that step in more detail"
- "Skip the explanations" / "just do it"
- "Define genealogy terms when you use them"
- "Drop the preambles"

These take effect for the rest of the session without modifying
`research.json`.

### Updating the profile

To change your experience level or subscriptions later, edit
`researcher_profile` directly in `research.json`. The fields are
straightforward — `experience_level` is one of the four enum values,
`subscriptions` is an array of the canonical site names listed above.
If you change `experience_level`, also update `narration_guidance` to
match the mapping table in `plugin/skills/init-project/SKILL.md`.

## Installation (for end users)

You need both pieces.

### 1. Install the desktop extension

1. Download `genealogy-mcp.mcpb` from the latest release
2. Open Claude Desktop → Settings → Extensions
3. Click "Install Extension..." and select the .mcpb file
4. The "Genealogy MCP" extension should appear in your list

### 2. Install the Cowork plugin

1. Download `genealogy-plugin.zip` from the latest release
2. Open Claude Desktop → switch to Cowork tab
3. Click "Customize" in the left sidebar
4. Click "Browse plugins" → "Upload custom plugin"
5. Select the .zip file

### 3. Try it out

In a Cowork session, exercise any of:

> `/wiki Albert Einstein`

Triggers the `wiki-lookup` skill — calls Wikipedia, fills a
template, saves `albert-einstein.md` to your working folder.

> "Find FamilySearch info for Ohio."

Claude calls the `places` tool directly and reports what it learned.

> "Log me in to FamilySearch. My client ID is YOUR-DEV-KEY."

Exercises the OAuth flow. See
`docs/testing-guides/oauth-tool-testing-guide.md` for getting a
FamilySearch dev key and walking through the full flow.

> "What FamilySearch record collections cover Alabama?"

Once logged in, Claude calls the `collections` tool and reports the
matching record collections with their record, person, and image
counts.

> "How do I find Italian birth records?"

Triggers the `search_wiki` tool — calls the hosted `wiki-query-api`
service, which runs RAG retrieval over the FamilySearch Wiki and
returns ranked sections with source URLs. See
`docs/specs/search-wiki-tool-spec.md`.

> "What is the population of place ID 1927069 in 1960?"

Claude calls the `population` tool and returns Nigeria's historical
population data from multiple sources, plus FamilySearch indexed
birth record coverage. Calls a hosted Pop Stats API.

> "Find Abraham Lincoln, born 1809 in Kentucky."

Claude calls the `search` tool with a tight birth-year range and
returns ranked persona records (name, dates and places, source
collection, and a clickable persistent URL). For collection-scoped
queries, Claude chains `collections` first to pick a `collectionId`,
then narrows the search.

## Project status

What's shipped:

- **18 MCP tools.** OAuth (`login`, `logout`, `auth_status`); public
  reference tools (`wikipedia_search`, `places`, `population`,
  `external_links`, `place_distance`, `image_read`); authenticated
  read tools (`collections`, `search`, `tree_read`); FamilySearch Wiki
  tools (`search_wiki`, `wiki_fetch_page`, and four country-page tools).
- **23 skills.** Full GPS research cycle from `init-project` through
  `proof-conclusion`, plus reference skills (locality-guide,
  historical-context, translation) and guardrails (validate-schema,
  check-warnings, convert-dates).
- **Researcher profile.** `init-project` captures experience level and
  paid subscriptions in two questions; every skill adapts narration
  density to the answer.
- **Eval harness** under `eval/` for skill regression testing.

## Developer and contributor docs

- [DEVELOPMENT.md](./DEVELOPMENT.md) — building, testing, smoke-tests,
  adding tools and skills, running the eval harness.
- [CONTRIBUTING.md](./CONTRIBUTING.md) — what kinds of contributions
  are welcome, constraints, and how to submit.
- [CLAUDE.md](./CLAUDE.md) — architecture and conventions Claude reads
  when editing the code.

