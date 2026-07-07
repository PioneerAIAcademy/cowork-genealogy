# Genealogy Research

A Claude Cowork plugin and desktop extension for GPS-conformant
genealogy research. The project ships two coupled artifacts from this
single repo:

1. **MCP Server** (`packages/engine/mcp-server/`) — A TypeScript MCP server packaged
   as a Claude Desktop Extension (.mcpb). Runs on the host machine
   with full network access. Wraps genealogy and reference APIs
   (FamilySearch, Wikipedia) and exposes them as MCP tools.
2. **Cowork Plugin** (`packages/engine/plugin/`) — Skills and templates that run
   inside Cowork's sandboxed VM. Teaches Claude when and how to use
   the MCP server's tools.

The two communicate only through MCP tool calls — structured JSON in,
structured JSON out. The MCP server runs on the host because the
Cowork VM has restricted egress; anything that touches the network
has to live in the server.

> **Hosted web workbench (POC).** This repo is
> also a pnpm/turbo monorepo for a browser version of the product — a chat agent
> beside a live project viewer. The engine above is reused as-is (the MCP server
> runs under the Claude Agent SDK in a per-user sandbox; the viewer is shared
> with the Electron app via `packages/viewer-ui`). It runs fully on mocks with
> `make install && make server-mock && make web-dev` — no E2B/Anthropic/OAuth needed.
> See **`docs/plan/hosted-web-workbench-POC-status.md`** for the run guide,
> what-works table, and provisioning checklist, and `make help` for commands.

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

The MCP server exposes 31 tools.

### FamilySearch records and places

| Tool | Purpose | Auth |
|------|---------|------|
| `place_search` | FamilySearch place data + Wikipedia enrichment | None |
| `place_search_all` | Like `place_search`, but expands each match to every jurisdiction the place has belonged to over time — for boundary or parent-jurisdiction changes across a research period | None |
| `collections_search` | Lists FamilySearch record collections for a place (returns the derived `scope`); optional `startYear`/`endYear` filter | OAuth |
| `collection_read` | Full detail for a single FamilySearch collection by `id` (FS Research Wiki page converted to markdown) | OAuth |
| `record_search` | FamilySearch historical-record search for a person | OAuth |
| `record_read` | Fetch a FamilySearch historical record by ARK or entity ID — returns full simplified GEDCOMX | OAuth |
| `person_search` | FamilySearch Family Tree search for a person — ranked candidate tree persons to pick and research (chains into `person_read`) | OAuth |
| `fulltext_search` | Full-text search of FS AI-transcribed document images — finds non-principal mentions (witnesses, neighbors, heirs) | OAuth |
| `image_search` | Lists the image IDs inside a single image group (digitized volume) given its image group number — feeds `image_read`. (Place + year-range volume discovery lives in `volume_search`.) | OAuth |
| `same_person` | Asks FamilySearch whether two record extractions describe the same person — match confidence + score | OAuth |
| `person_record_matches` | Historical-record matches for a tree person (accepted/pending/rejected) | OAuth |
| `record_person_matches` | Tree-person matches for a historical record persona | OAuth |
| `person_person_matches` | Possible-duplicate tree-person matches for a tree person | OAuth |
| `record_record_matches` | Other historical records describing the same individual | OAuth |
| `person_read` | FamilySearch Family Tree person data — relatives and attached sources | OAuth |
| `person_ancestors` | FamilySearch Family Tree pedigree — a person (or, when no ID is given, the logged-in user) plus up to N generations of ancestors, each tagged with its Ahnentafel (ascendancy) number | OAuth |
| `source_attachments` | Check whether source ARKs are already attached to tree persons | OAuth |
| `volume_search` | Search FamilySearch's Records Management Service for digitized volumes (image groups) by place and year range — returns coverage metadata, `recordSearchablePercent`, and `fulltextSearchable` per volume | OAuth |
| `external_links_search` | FS-curated third-party genealogy URLs by place; optional year filter | None |

### FamilySearch Wiki content

| Tool | Purpose | Auth |
|------|---------|------|
| `wiki_search` | Natural-language RAG search of the FS Wiki via a separate `wiki-query-api` server | None (v1) |
| `wiki_read` | Fetch a specific pre-crawled wiki markdown page | None |
| `wiki_place_page` | A FamilySearch Research Wiki page for a place (country, US state, or Canadian province) — `section` is one of `home`, `getting_started`, `online_records`, `research_tips` | None |

### Reference and context

| Tool | Purpose | Auth |
|------|---------|------|
| `wikipedia_search` | Wikipedia article summary lookup | None |
| `place_population` | Historical population data + indexed record counts | None |
| `place_distance` | Distance between two FamilySearch places | None |
| `image_read` | Read a FamilySearch image by imageId (NUMBER_NUMBER) or by ark (a document-image ARK, resolver URL, or resolved distribution URL) and return bytes + metadata | OAuth |
| `person_warnings` | Flags impossible or unlikely facts (death before birth, event after death, implausibly young parent) for a person and their one-hop relatives, reading the local tree — offline | None |
| `validate_research_schema` | Validate research.json and tree.gedcomx.json against published schemas | None |

### Auth (FamilySearch OAuth 2.0 + PKCE)

| Tool | Purpose |
|------|---------|
| `login` | Spin up local callback server, open browser, exchange code for tokens |
| `logout` | Clear stored FamilySearch tokens |
| `auth_status` | Report current FamilySearch session state |

`logout` and `auth_status` are direct-invocation tools — Claude calls
them in response to the user ("log me out", "am I logged in?") rather
than as part of any skill workflow. `login` is invoked both directly
and by the `init-project`, `search-records`, and `search-external-sites`
skills when a tool call needs authentication.

The `place_population` tool combines data from populstat (234 countries),
gapminder, and FamilySearch indexed birth records. The `wiki_search`
tool runs RAG retrieval over the FamilySearch Wiki. Both call hosted
sidecar APIs (Pop Stats and `wiki-query-api`); no local setup required
for end users.

Tool specs live in `docs/specs/<tool>-tool-spec.md`.

## Skills

The plugin ships 28 skills covering the full GPS research cycle. Skills
are listed in roughly the order you'd use them in a research project.

### Starting and resuming

| Skill | What it does | Say this |
|-------|-------------|----------|
| **init-project** | Creates a new project from a FamilySearch person ID. If no ID is known, searches the Family Tree by name using `person_search` to find the right person first. Fetches the person and their relatives to seed the tree. | "Start a new project for person KWCJ-RN4" / "Start a project for Patrick Flynn, born 1845 Ireland — I don't have his ID" |
| **project-status** | Summarizes project progress with GPS state + conversational narrative. Recommends the next step. | "Where are we?" / "What's next?" / "Status" |
| **research** | Drives the full GPS workflow on a research objective, invoking the right sub-skills based on `research.json` state and iterating until the question is resolved. For beginners who don't know which sub-skill to invoke when. The `--autonomous` flag exists only for end-to-end automated testing of the workflow; it is not intended as a way to let the AI do your family history for you. Genealogy requires *your* judgment on evidence, conflicts, and conclusions — see "A note on responsibility" above. | "/research find John Smith's parents" / "Research who Patrick Flynn's father was" |

### Planning the research

| Skill | What it does | Say this |
|-------|-------------|----------|
| **question-selection** | Picks the highest-value next research question. | "What should I research next?" |
| **research-plan** | Creates a sequenced plan of record sets to search, with repositories, rationale, and fallbacks. | "Plan research for this question" |
| **research-exhaustiveness** | The gate before proof. Runs *after* all plan items for a question are `completed` or `skipped` and the resulting evidence has been extracted, classified, person-linked, and conflict-resolved. Applies the GPS 5 threshold questions and 7-point stop criteria; either writes the question's `exhaustive_declaration` or explains what's missing so you can extend the plan (`research-plan`) or pivot to FAN (`question-selection`). | "Is this research exhaustive?" / "Are we done?" / "Can we declare exhaustive?" |

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
| **search-familysearch-wiki** | Searches the FamilySearch Research Wiki for genealogy how-to guidance and saves the findings as a markdown file. | "Search the FamilySearch wiki for how to find Italian birth records" |
| **search-wikipedia** | Reference example skill — fetches a Wikipedia summary and saves it as a markdown file. | "Look up Albert Einstein on Wikipedia" |

### Internal (guardrails)

These enforce correctness. Most are invoked automatically by other
skills per the validation protocol.

| Skill | What it does | Triggered by |
|-------|-------------|-------------|
| **validate-schema** | Validates both project files against the published schemas. Required fields, enum values, ID prefixes, cross-references. | Every writing skill invokes this after writing. You can also say "validate the files." |
| **check-warnings** | Flags genealogical impossibilities (married before 12, died after 120, child born after parent's death). | Writing skills invoke after adding assertions/person_evidence. You can say "check for warnings." |
| **convert-dates** | Converts dates at calendar boundaries — Julian/Gregorian, Old Style/New Style, Quaker double-dating. | When dates from pre-Gregorian periods are encountered. You can say "convert this date." |

### Benchmark suite (not shipped — repo-local dev tooling)

For contributors capturing or diagnosing fixtures in the project's
end-to-end benchmark. These two skills are **not** part of the Cowork
plugin — they are tooling for the internal genealogist+developer benchmark
teams and live in [`.claude/skills/`](./.claude/skills/) (loaded by Claude
Code in this checkout), alongside the other dev skills `compare-state` and
`draft-unit-test`. The implementation plan is at
[docs/plan/e2e-skills.md](./docs/plan/e2e-skills.md); the usage playbook is
[docs/e2e-testing-guide.md](./docs/e2e-testing-guide.md).

| Skill | What it does | Say this |
|-------|-------------|----------|
| **author-e2e-fixture** | Turns a finished research project into an e2e benchmark fixture — snapshots the resolved state, strips the answer from the tree, records what was stripped as expected findings. Produces the five files in a `<slug>/` subfolder of the working directory, ready to move into `eval/tests/e2e/`. | "Save this research as an e2e test" / "Make a benchmark from this" |
| **interpret-e2e-result** | Reads an e2e run log and explains what the agent recovered and missed (from its final tree), why it stopped, and the most likely cause (agent regression, FS data drift, single-run jitter, etc.) — blind to the judge's own grades — pointing at the relevant transcript section. | "Why did this fixture fail?" / "Interpret the latest e2e run" |
| **grade-e2e-run** | Grades an e2e run into its calibration annotation: presents each expected finding + the agent's evidence (blind to the judge's grades), collects the genealogist's true/partial/false labels, and writes `run-<ts>.ann.json`. | "Grade this e2e run" / "Annotate this run for calibration" |

## Agents

The plugin ships one Cowork agent. Unlike skills, an agent runs in
fresh context and is invoked by the Cowork orchestrator — or by
`/research` at GPS checkpoints — when its description matches; you
don't load it explicitly.

| Agent | What it does | Say this |
|-------|-------------|----------|
| **gps-mentor** | A Board for Certification of Genealogists (BCG)-style senior genealogist who reviews your work against GPS standards and returns a structured verdict plus a mentoring narrative. Read-only — it never edits your tree and only appends its verdict to `research.json`. `/research` calls it automatically before the exhaustiveness gate, before the proof conclusion, and after a conclusion is written. | "Review my work" / "Is this defensible?" / "Am I ready to conclude?" |

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
12. research-exhaustiveness  Gate before proof — applies the GPS 5
                             threshold questions and 7-point stop
                             criteria. If not yet exhaustive, loop
                             back to step 3 (extend plan) or step 2
                             (FAN pivot). If exhaustive, advance.
13. proof-conclusion         Write the GPS conclusion
    tree-edit                Merge persons, correct facts
14. project-status           "Where are we? What's next?"
```

This is the ideal GPS cycle. In practice you can invoke any skill at
any time — each checks its own preconditions and guides you if
prerequisites are missing.

Note that `research-exhaustiveness` runs **once per question, after
all of that question's plan items are complete and the resulting
evidence has been analyzed** — not after every search. The skill
needs log entries and classified assertions to evaluate criteria
like *independent verification* and *evidence class*, so it sits
naturally between the analysis steps (5–11) and `proof-conclusion`.
The `/research` orchestrator handles this routing automatically.

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
match the mapping table in `packages/engine/plugin/skills/init-project/SKILL.md`.

## Installation (for end users)

You need both pieces.

### 1. Install the desktop extension

1. Download `genealogy-mcp.mcpb` from the latest release
2. Open Claude Desktop → Settings → Extensions
3. Click "Install Extension..." and select the .mcpb file
4. The "Genealogy Research" extension should appear in your list

### 2. Install the Cowork plugin

1. Download `genealogy-plugin.zip` from the latest release
2. Open Claude Desktop → switch to Cowork tab
3. Click "Customize" in the left sidebar
4. Click "Browse plugins" → "Upload custom plugin"
5. Select the .zip file

### Alternative: install in Claude Code

The same two artifacts also work in Claude Code (CLI). The MCP server
runs as a local stdio process; the skills are loaded from
`~/.claude/skills/` instead of an uploaded zip.

**Install the MCP server.** Claude Code does not import `.mcpb` files
directly (that format is Claude Desktop only). Pick one of these
documented paths:

- *Already installed in Claude Desktop* (macOS / WSL only): pull the
  config across with

  ```bash
  claude mcp add-from-claude-desktop
  ```

- *Local build* (works everywhere, requires Node and a clone of this
  repo):

  ```bash
  cd packages/engine/mcp-server && npm install && npm run build
  claude mcp add --transport stdio genealogy -- node "$(pwd)/build/index.js"
  claude mcp list | grep genealogy   # expect ✓ Connected
  ```

  After rebuilding the server, run `/mcp` inside Claude Code to
  reconnect.

**Install the skills:**

1. Download `genealogy-plugin.zip` from the latest release
2. Unzip it into `~/.claude/skills/` so each skill folder
   (`init-project/`, `search-wikipedia/`, …) sits directly under
   `~/.claude/skills/`:

   ```bash
   mkdir -p ~/.claude/skills
   unzip -o genealogy-plugin.zip -d ~/.claude/skills
   ```

Claude Code watches `~/.claude/skills/` and picks up new skills in
the current session — no restart required.

Skills run on the host in Claude Code (unlike Cowork, where they run
in the sandboxed VM), so the host's network is available to skill
scripts. They still call the same MCP tools for everything that
touches a remote API.

### 3. Try it out

In a Cowork session, exercise any of:

> "Look up Albert Einstein on Wikipedia"

Triggers the `search-wikipedia` skill — calls Wikipedia, fills a
template, saves `albert-einstein.md` to your working folder.

> "Find FamilySearch info for Ohio."

Claude calls the `place_search` tool directly and reports what it learned.

> "Log me in to FamilySearch. My client ID is YOUR-DEV-KEY."

Exercises the OAuth flow. See
`docs/testing-guides/oauth-tool-testing-guide.md` for getting a
FamilySearch dev key and walking through the full flow.

> "What FamilySearch record collections cover Alabama?"

Once logged in, Claude calls the `collections_search` tool and reports the
matching record collections with their record, person, and image
counts.

> "How do I find Italian birth records?"

Triggers the `search-familysearch-wiki` skill — calls the `wiki_search` MCP tool,
which runs RAG retrieval over the FamilySearch Wiki via the hosted
`wiki-query-api` service, then saves the synthesized guidance to a
markdown file. See `docs/specs/wiki-search-tool-spec.md`.

> "What was the population of Utah in 1960?"

Claude chains `place_search` to resolve "Utah" to a FamilySearch place
ID, then calls `place_population` with that ID and returns Utah's
historical population from multiple sources, plus FamilySearch indexed
birth record coverage. Calls a hosted Pop Stats API.

> "Find Abraham Lincoln, born 1809 in Kentucky."

Claude calls the `record_search` tool with a tight birth-year range and
returns ranked persona records (name, dates and places, source
collection, and a clickable persistent URL). For collection-scoped
queries, Claude chains `collections_search` first to pick a `collectionId`,
then narrows the search.

## Project status

What's shipped:

- **31 MCP tools.** OAuth (`login`, `logout`, `auth_status`); public
  reference tools (`wikipedia_search`, `place_search`, `place_search_all`,
  `place_population`, `external_links_search`, `place_distance`); authenticated
  search/read tools (`collections_search`, `collection_read`, `record_search`,
  `record_read`, `person_search`, `fulltext_search`, `image_search`, `image_read`,
  `volume_search`, `same_person`, `person_record_matches`,
  `record_person_matches`, `person_person_matches`, `record_record_matches`,
  `person_read`, `person_ancestors`, `source_attachments`); FamilySearch Wiki
  tools (`wiki_search`, `wiki_read`, and `wiki_place_page`); local
  tools (`validate_research_schema`, `person_warnings`).
- **26 shipped skills.** Full GPS research cycle from `init-project`
  through `proof-conclusion`, plus reference skills (locality-guide,
  historical-context, translation, search-familysearch-wiki, search-wikipedia)
  and guardrails (validate-schema, check-warnings, convert-dates). The three
  e2e-benchmark skills (author-e2e-fixture, interpret-e2e-result, grade-e2e-run)
  are repo-local dev tooling under `.claude/skills/`, not shipped in the plugin.
- **1 Cowork agent.** `gps-mentor` — a BCG-style senior-genealogist
  review, invoked by `/research` at GPS checkpoints and on demand.
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
- [docs/feedback-workflow.md](./docs/feedback-workflow.md) — how to
  triage a user feedback submission, fix the bug, and lock it in
  with a regression test. Start here when a feedback zip lands.
- [eval/README.md](./eval/README.md) — eval harness for skill
  regression testing: how to run it, add cases, and interpret results.
- [docs/e2e-testing-guide.md](./docs/e2e-testing-guide.md) — end-to-end
  testing playbook covering the full plugin + MCP server flow.

