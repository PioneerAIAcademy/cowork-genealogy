# Catalog: tools, skills and agents

Every MCP tool, skill and agent the project ships, with what each does. For
what the product does and how to install it, start at the
[README](../README.md).

The project ships two coupled artifacts:

1. **MCP server** (`packages/engine/mcp-server/`) — a TypeScript MCP server
   packaged as a Claude Desktop Extension (`.mcpb`). Runs on the host with full
   network access and wraps the genealogy and reference APIs as MCP tools.
2. **Cowork plugin** (`packages/engine/plugin/`) — the skills, agents and hooks
   that run inside Cowork's sandboxed VM and teach Claude when and how to use
   the tools.

The plugin manages two project files: **`research.json`**, the research audit
trail (questions, plans, search log, assertions, conflicts, hypotheses,
timelines, proof summaries), and **`tree.gedcomx.json`**, the deliverable
(resolved persons, relationships and facts in simplified GedcomX).

## MCP tools

The MCP server exposes 56 tools.

### FamilySearch records and places

| Tool | Purpose | Auth |
|------|---------|------|
| `place_search` | FamilySearch place data + Wikipedia enrichment | None |
| `place_search_all` | Like `place_search`, but expands each match to every jurisdiction the place has belonged to over time — for boundary or parent-jurisdiction changes across a research period | None |
| `collections_search` | Lists FamilySearch record collections for a place (returns the derived `scope`); optional `startYear`/`endYear` filter | OAuth |
| `catalog_search` | Searches the FamilySearch **Catalog** — microfilm, books, manuscripts and finding aids — and hydrates its top hits with holdings detail: where the originals are held, and an `imageGroupNumber` for `image_search`/`fulltext_search` where one was filmed. A different index from `collections_search` | OAuth |
| `record_search` | FamilySearch historical-record search for a person | OAuth |
| `record_read` | Fetch a FamilySearch historical record by its record-persona ARK (`1:1:`, i.e. `record_search`'s `recordId`) or bare entity ID — returns full simplified GEDCOMX; with `projectPath` the record is also staged (`staged.resultsRef`) so `research_log_append` retains it as a sidecar | OAuth |
| `person_search` | FamilySearch Family Tree search for a person — ranked candidate tree persons to pick and research (chains into `person_read`) | OAuth |
| `fulltext_search` | Full-text search of FS AI-transcribed document images — finds non-principal mentions (witnesses, neighbors, heirs) | OAuth |
| `image_search` | Lists the image IDs inside a single image group (digitized volume) given its image group number — feeds `image_read`. With `item` / `itemImage` on a bare film number, resolves a "DGS 004528134, Item 5, Image 10" citation to its image ID. (Place + year-range volume discovery lives in `volume_search`.) | OAuth |
| `same_person` | Asks FamilySearch whether two people are the same — match confidence + score. Takes either two GedcomX documents, or project references (`projectPath`, `assertionId`, `treePersonId`) and assembles both sides itself, recording the score it computed | OAuth |
| `person_record_matches` | Historical-record matches for a tree person (accepted/pending/rejected) | OAuth |
| `record_person_matches` | Tree-person matches for a historical record persona | OAuth |
| `person_person_matches` | Possible-duplicate tree-person matches for a tree person | OAuth |
| `record_record_matches` | Other historical records describing the same individual | OAuth |
| `person_read` | FamilySearch Family Tree person data — relatives (including **siblings**, fetched via each parent) and attached sources, and for a non-living subject their source-style **memories** (scanned wills, certificates, obituaries), transcribed inline where the read's time budget allowed | OAuth |
| `tree_gaps` | Survey a FamilySearch tree for holes it likely has records for (parents missing before a line ends, couples with no children, gaps between births, a wife with no surname, a person with no birth date or place, a deceased adult with no spouse or death date) across up to 8 generations of ancestors and 4 of descendants; returns the holes with a search year range, place, collection coverage (with census years and place level) and `pendingHints` (how many of FamilySearch's pending record hints are about the event the hole is missing, read from the collection title, with a census counted only if taken in the hole's window), holes with a fitting hint first, never the tree; living people never carry a hole | OAuth |
| `person_ancestors` | FamilySearch Family Tree pedigree — a person (or, when no ID is given, the logged-in user) plus up to N generations of ancestors, each tagged with its Ahnentafel (ascendancy) number; relationships are endpoint-closed, and `notes[]` reports any edge dropped for naming a person not returned | OAuth |
| `source_attachments` | Check whether source ARKs are already attached to tree persons | OAuth |
| `volume_search` | Search FamilySearch's Records Management Service for digitized volumes (image groups) by place and year range, optionally filtered to one or more `recordTypeGroups` (selecting a group also returns the groups nested beneath it) — returns coverage metadata, `recordSearchablePercent`, and `fulltextSearchable` per volume. With `summary: true` on the first page it also counts every matching volume by record-type group (browse-only and full-text-only included) | OAuth |
| `volume_bisect` | Bisect a browse-only image volume toward a target year — reads **one** page per call, folds its year into the bracket built from the readings so far, and returns the narrowed bracket plus the next image to probe. Refuses a bare image-group prefix (use `volume_search` to pick a sub-volume first) | OAuth + OpenRouter |
| `external_links_search` | FS-curated third-party genealogy URLs by place; optional year filter | None |

### FamilySearch Wiki content

| Tool | Purpose | Auth |
|------|---------|------|
| `wiki_search` | Natural-language RAG search of the FS Wiki via a separate `wiki-query-api` server | None (v1) |
| `wiki_read` | Fetch a specific pre-crawled wiki markdown page | None |
| `wiki_place_page` | A FamilySearch Research Wiki page for a place — `section` is one of `home`, `getting_started`, `online_records`, `research_tips`. `home` resolves the place's own page at any level the wiki has one (country, state or province, county, parish, independent city); the other three exist only for a country or a state/province | None |

### Project state (structured read/write)

Everything that reads or writes `research.json` and `tree.gedcomx.json` goes
through these. The writers validate the **whole** project in memory and write
nothing on failure, and they assign every id — callers never predict one. Raw
`Write`/`Edit` on either file is denied by a hook, so this table is the only
way project state changes.

| Tool | Purpose | Auth |
|------|---------|------|
| `project_create` | Create a new project — writes `research.json` and `tree.gedcomx.json` together, validated against each other. The only way to bring a project into being. Given a `personId`, it reads the person from FamilySearch, builds the starting tree, writes the house profile and the transcribed memories, and returns a short summary | FamilySearch (with `personId`); none otherwise |
| `research_append` | Append to a `research.json` section (questions, sources, assertions, person_evidence, conflicts, proof_summaries), single or batched `ops` | None |
| `research_query` | Paged, filtered read of a `research.json` section without loading the whole document | None |
| `sidecar_read` | Paged read of a project sidecar text file — a gps-mentor verdict body under `evaluations/`, a text upload under `uploads/`, or a staged transcription under `results/` — one file, or several at once by `refs`. Refuses a staged search result, images, `research.json` and the tree with a pointer to the tool that serves each | None |
| `research_log_append` | Append a research-log entry, including a search's result sidecar | None |
| `research_delivered` | Signal that a bounded request has been delivered and the turn is stopping on purpose. A pure signal: writes nothing. BOTH hosted planes end the turn on this tool's name via a `PreToolUse` hook, the prototype worker and the hosted alpha; in Cowork and e2e no such hook binds, so it returns a harmless acknowledgement and the run carries on | None |
| `extraction_append` | Extracts records in code: FamilySearch records by `recordIds` (read, logged and classified from the extraction table), any other source as a structured document from the `record-structurer` agent, a nil search as negative evidence by `absences`, and, by `personId`, every indexed record FamilySearch has attached to one tree person, each linked to that person as an unverified candidate. Classifications are set here and are final | None |
| `materialize_facts` | Project extracted assertions onto tree persons | None |
| `tree_edit` | Add or amend persons, facts, names and relationships on the local tree | None |
| `tree_correct` | Correct an existing tree assertion in place | None |
| `tree_forget` | Strip a slice of the local tree to stage a practice run (project-start only; refused once a plan exists) | None |
| `merge_tree_persons` | Merge two local tree persons | None |
| `merge_warnings` | Pre-merge conflict report for two tree persons | None |
| `person_quality` | FamilySearch's data-quality score for a tree person, as plain-English issues in four categories. `detail: true` adds the per-fact breakdown — which attached sources touch each fact and whether each agrees, plus the disagreements between sources | OAuth |
| `rank_search_matches` | Rank search results against a named subject | None |
| `convert_calendar` | Convert between Julian/Gregorian, Quaker, and French Republican dates | None |
| `census_children_gap` | From a mother's 1900/1910 US census children-born and children-living counts, work out how many of her children the tree is missing and each one's exact birth window, bounded by the census days | None |
| `timeline_build` | Build or refresh a person's timeline in code from the records linked to them (never tree facts): one event per record and event, with the gaps a researcher would chase — census years FamilySearch has indexed for the place (a table in code, never the catalog), a missing marriage, 20+ silent years, a death without a burial — written to `research.json` `timelines` | None |
| `build_external_search_url` | Build a pre-filled search URL for a supported external genealogy site (Ancestry, MyHeritage, FindMyPast, FindAGrave, Newspapers.com, Chronicling America, a state/regional digital newspaper archive, the National Archives Catalog, Internet Archive, BillionGraves, Digitalarkivet, Portale Antenati, Library and Archives Canada, American Ancestors, the Italian Genealogy forum, or Open Archieven for Dutch records) from structured search attributes, or a parish-page link for the Archion and Matricula church-book browse sites, including each site's access classification (free, free-but-bot-protected, or subscription) | None |

### Reference and context

| Tool | Purpose | Auth |
|------|---------|------|
| `wikipedia_search` | Wikipedia article summary lookup | None |
| `place_population` | Historical population data + indexed record counts | None |
| `place_distance` | Distance between two FamilySearch places | None |
| `image_read` | Read a FamilySearch image by imageId (NUMBER_NUMBER) or by ark (a document-image ARK, resolver URL, or resolved distribution URL) and return bytes + metadata; optional `projectPath` saves the scan and returns `imageRef`. Refuses scans over ~700 KB raw. Kept for the Issue #28 OCR-comparison pipeline — no skill or agent calls it, and the eval harness denies it on the main thread. | OAuth |
| `image_transcribe` | OCR a FamilySearch image by imageId or ark, a memory (its artifact URL or its `photos/artifacts/<id>` / `memories/<id>` page URL), or an **uploaded image/PDF inside the project folder** (`file`, e.g. `uploads/scan.jpg` — no FamilySearch login) host-side (Gemini Flash via OpenRouter). Requires `projectPath`: the page is staged and the tool returns `staged.resultsRef`, a `digest` and `found`, not the text — read it with `sidecar_read`, extract it by handing the ref to `record-structurer`. No bytes cross the MCP transport; inputs over 14 MiB are refused with the remedy. | OpenRouter (+ OAuth for imageId/ark) |
| `person_warnings` | Flags impossible or unlikely facts (death before birth, event after death, implausibly young parent) for a person and their one-hop relatives. Reads tree.gedcomx.json from the local project; offline except one check that looks up place coordinates and is skipped when the lookup fails | None |
| `validate_research_schema` | Validate research.json and tree.gedcomx.json against published schemas | None |
| `project_context` | Read-only compact projection of research.json + tree.gedcomx.json (open questions, persons with cited sources, sources with record ids) — the context call agents make instead of reading project files | None |
| `project_list` | Which projects this server keeps. On the desktop extension the task's working folder is the project; on a hosted server it lists the caller's projects (objective, subjects, status) and, when one can be started, the `newProjectPath` for it. The research router's first call when a conversation names no project | None |
| `get_name_variants` | Look up a given name's alternate forms (nicknames, diminutives, formal forms) from a bundled bidirectional table. Given names only, no caller yet | None |

### Auth (FamilySearch OAuth 2.0 + PKCE)

| Tool | Purpose |
|------|---------|
| `login` | Spin up local callback server, open browser, exchange code for tokens |
| `logout` | Clear stored FamilySearch tokens |
| `auth_status` | Report current FamilySearch session state |

`logout` and `auth_status` are direct-invocation tools — Claude calls
them in response to the user ("log me out", "am I logged in?") rather
than as part of any skill workflow. `login` is invoked the same way, in
response to the user. No agent holds it: `search-records` tells the user to
ask for a login when a search fails on authentication.

The `place_population` tool combines data from populstat (234 countries),
gapminder, and FamilySearch indexed birth records. The `wiki_search`
tool runs RAG retrieval over the FamilySearch Wiki. Both call hosted
sidecar APIs (Pop Stats and `wiki-query-api`) that have no public
deployment yet: the compiled-in defaults point at one developer's machine.
`wikiApiUrl` and `popStatsUrl` in `~/.familysearch-mcp/config.json` override
them (CLAUDE.md, "External service dependencies").

The `image_transcribe` tool OCRs page scans host-side via OpenRouter
(default model `google/gemini-3.7-flash`). It needs an
OpenRouter API key, entered in the extension's install dialog or saved in
`~/.familysearch-mcp/config.json` (`openRouterApiKey`); if the key is missing
or rejected, the error directs the user to one of those two places (never a
tool call). The e2e harness and the
hosted web server bridge the key from their own environment (see
CLAUDE.md).

Tool specs live in `docs/specs/<tool>-tool-spec.md`.

## Skills

The plugin ships 2 skills covering the full GPS research cycle. Skills
are listed in roughly the order you'd use them in a research project.
For a plain-language account of the research method itself — the GPS
cycle, the judgment made at each stage, and what to expect from a
session — see [gps-research-flow.md](gps-research-flow.md).

### Starting and resuming

| Skill | What it does | Say this |
|-------|-------------|----------|
| **research** | Drives the full GPS workflow on a research objective, invoking the right sub-skills based on `research.json` state and iterating until the question is resolved. For beginners who don't know which sub-skill to invoke when. The `--autonomous` flag exists only for end-to-end automated testing of the workflow; it is not intended as a way to let the AI do your family history for you. Genealogy requires *your* judgment on evidence, conflicts, and conclusions — see "A note on responsibility" in the [README](../README.md#a-note-on-responsibility). | "/research find John Smith's parents" / "Research who Patrick Flynn's father was" |
| **forget-and-rederive** | Sets up a practice run: strips information you already have out of the project tree so it has to be re-derived from records. Always dry-runs first and reports only redacted counts. Requires you to also not look the answer back up — the FamilySearch tree still has it, so the FS tree-reading tools are off-limits for those people afterward. | "Forget what you know about Patrick's parents and find them again" / "Hide his parents and see if you can re-derive them" |

### Planning the research

Planning is an agent rather than a skill — see `research-plan` in the agent
table below.

### Identity resolution and analysis

Building a timeline is an agent rather than a skill — see `timeline` in the
agent table below.

### Concluding

Writing the conclusion itself is an agent rather than a skill — see
`proof-conclusion` in the agent table below. So is resolving conflicting
evidence — see `conflict-resolution` there.

### Benchmark suite (not shipped — repo-local dev tooling)

For contributors capturing or diagnosing fixtures in the project's
end-to-end benchmark. These three skills are **not** part of the Cowork
plugin — they are tooling for the internal genealogist+developer benchmark
teams and live in [`.claude/skills/`](../.claude/skills/) (loaded by Claude
Code in this checkout), alongside the other dev skills `compare-state` and
`mine-unit-test`. The usage playbook is
[e2e-testing-guide.md](e2e-testing-guide.md); the fixture format is
specified in [specs/e2e-test-spec.md](specs/e2e-test-spec.md).

| Skill | What it does | Say this |
|-------|-------------|----------|
| **author-e2e-fixture** | Turns a finished research project into an e2e benchmark fixture — snapshots the resolved state, strips the answer from the tree, records what was stripped as expected findings. Produces the five files in a `<slug>/` subfolder of the working directory, ready to move into `eval/tests/e2e/`. | "Save this research as an e2e test" / "Make a benchmark from this" |
| **interpret-e2e-result** | Reads an e2e run log and explains what the agent recovered and missed (from its final tree), why it stopped, and the most likely cause (agent regression, FS data drift, single-run jitter, etc.) — blind to the judge's own grades — pointing at the exact tool call and narration turn. | "Why did this fixture fail?" / "Interpret the latest e2e run" |
| **grade-e2e-run** | Grades an e2e run into its calibration annotation: presents each expected finding + the agent's evidence (blind to the judge's grades), collects the genealogist's true/partial/false labels, and writes `run-<ts>.ann.json`. | "Grade this e2e run" / "Annotate this run for calibration" |

## Agents

The plugin ships thirty Cowork agents. Unlike skills, an agent runs in
fresh context and is invoked by the Cowork orchestrator, by `/research`
when you ask for a second opinion, or by the skill that delegates to it — you
don't load it explicitly.

| Agent | What it does | Say this |
|-------|-------------|----------|
| **init-project** | Creates a new project from a FamilySearch person ID. Fetches the person and their relatives to seed the tree. **A PID is required**: with no ID it creates nothing and asks for one, and it never searches by name. Started by the `research` router, not invoked directly. | "Start a new project for person KWCJ-RN4" |
| **translation** | Genealogy-specific translation for German, French, Spanish, Italian, Dutch, Latin, Portuguese. Period handwriting and abbreviations. Inside a project, saves its translation as one research-log entry; writes nothing else. | "Translate this German church record" |
| **gps-mentor** | A Board for Certification of Genealogists (BCG)-style senior genealogist who reviews your work against GPS standards and returns a structured verdict plus a mentoring narrative. Read-only — it never edits your tree and only appends its verdict to `research.json`. It runs only when you ask for it — at any time, including after the research is finished; its verdict is advisory and never blocks or re-opens a resolved question. | "Second opinion" / "Review my work" / "Is this defensible?" |
| **record-structurer** | Turns sources that are not FamilySearch indexed records — an image transcription, an uploaded PDF, pasted text — into structured documents (who is named, what each says about them) and hands them to `extraction_append` in one call. It sends no roles and no classifications: the code assigns those from the extraction table, so they are the same for every source of a type. | (not invoked directly — the search skills and `/research` delegate) |
| **timeline** | Builds chronological timelines with distances between consecutive events. Surfaces gaps and geographic feasibility (logical impossibilities are check-warnings' job). | "Build a timeline" / "Do these events fit one life?" |
| **proof-conclusion** | Writes the GPS proof conclusion for **one** question — selects the confidence tier and the proof form, writes the self-contained narrative, and encodes the conclusion into your tree once it reaches Probable or better. `/research` routes to it at the conclusion step, and you can ask for it directly; it is the only caller allowed to write the `proof_summaries` section, which is what keeps a conclusion from being hand-authored around the tier and citation rules. | "Write the conclusion" / "What's the proof?" |
| **research-exhaustiveness** | Judges whether the research on **one** question is reasonably exhaustive — applies the GPS 5 threshold questions and the 7-point stop criteria, then either declares the question exhaustive or names what is still missing. `/research` spawns it directly at the exhaustiveness step, and a user naming it reaches the same agent; it is the only caller allowed to declare a question exhaustive, which is what keeps that claim from being hand-authored around the criteria it rests on. | "Is the research on q_001 exhaustive?" / "Are we done?" / "Can we declare exhaustive?" |
| **person-evidence** | Resolves identity for **one** request — evaluates whether a record's person matches a tree person, writes the `person_evidence` links with their confidence and rationale, and creates stub persons when nothing matches. It is the only writer of `person_evidence`. | (spawned by `/research` directly via the agent description) |
| **search-full-text** | Full-text search of FS AI-transcribed document images. Finds witnesses, neighbors, heirs, and other non-principal mentions. Logs every search for the audit trail. | "Full-text search for Flynn in Schuylkill County deeds" |
| **search-images** | Browses a digitized FamilySearch volume page by page when the record set is neither indexed nor full-text searchable, and logs the browse. It finds the image groups covering a place and date range, lists the images inside one, and reads each page as text. | "Browse the images" / "page through the film" |
| **search-external-sites** | Builds pre-filled search URLs for Ancestry, MyHeritage, FindMyPast, FindAGrave, Newspapers.com, the Archion and Matricula church-book sites, and the rest of `build_external_search_url`'s site list; hands each over with exactly what to look for, and triages the capture you bring back. Logs every search, nil results included. | "Search Ancestry for Thomas Flynn" |
| **search-hints** | Reviews the FamilySearch hints (pending record matches) on one tree person. A first pass recommends accept, reject or not enough information for each hint, discloses FamilySearch's own confidence, and reads the record image before recommending against a hint; it writes nothing but the status of its plan item. Once you decide, a second pass logs your verdict on each hint, so an accepted hint flows on to extraction like any search result. On an identity or parentage question research-plan plans a hints review as the first item, run through this agent. | "Are these hints valid?" / "Accept hint 1, reject hint 2" |
| **citation** | Polishes the citations on sources that already exist to Evidence Explained standards (Who/What/When/Where/Where-within), and looks up the office that created a probate record on the FamilySearch wiki rather than carrying one jurisdiction's offices in its prompt. It never creates a source entry: asked to add a record, it declines and routes to extraction (`extraction_append`, or the `record-structurer` agent for a source that is not a FamilySearch record). | "Fix citations" / "Cite this source" |
| **question-selection** | Picks the highest-value next research question. | "What should I research next?" |
| **research-plan** | Creates, reviews and revises the sequenced plan for **one** question — which record sets to search, in what order, from which repositories, with fallbacks. | "Plan research for this question" |
| **check-warnings** | Flags genealogical impossibilities and implausible patterns in one person's own data (married before 12, died after 120, child born after parent's death), deterministically from your local tree. Given a mother's 1900 or 1910 US census counts of children born and living, it also reports which of her children the tree is missing and when each was born. With no project yet, it hands you to project creation first. Inside a project, saves its report as one research-log entry; writes nothing else. The tree writers refuse a write that introduces an unjustified warning, so it is no longer a step after every edit. | "Check for warnings" / "Any problems with his dates?" / "The 1900 census says she had 6 children, 5 living — who is missing?" |
| **locality-guide** | Produces a structured research guide for a place/time — what records exist and where they're held — and, inside a project, saves it so the research plan can use it. `/research` calls it when a question's place has not been surveyed yet. | "What records exist for Schuylkill County?" |
| **historical-context** | Explains boundary changes, naming conventions, migration patterns, and cultural context affecting records. Returns narrative context and, inside a project, logs it to the research log: one entry per wiki/Wikipedia lookup and one `historical_context` entry carrying the full overview, plus a Search implications block handed back to hypothesis-tracking and research-plan. Asked for a locality records survey, a record search, a translation, a date conversion, or a formal conflict resolution, it hands the request back by name. | "Why does the birthplace differ?" |
| **search-familysearch-wiki** | Searches the FamilySearch Research Wiki for **one** genealogy how-to question and records the guidance, citing the wiki pages it came from, as one entry in the project's research log (an empty search is logged as a nil entry). With no project it returns the guidance in the reply instead. Asked for Wikipedia, a locality records survey or narrative history, it does no search and hands the request back by name. | "Search the FamilySearch wiki for how to find Italian birth records" |
| **search-wikipedia** | Looks **one** topic up on Wikipedia — the general-purpose encyclopedia — and records the article summary as one entry in the project's research log. One lookup, a template it carries in its own body, one log entry. With no project it returns the filled template in the reply instead. Asked for narrative history, a locality records survey or the FamilySearch wiki, it does no lookup and hands the request back by name. | "Look up Albert Einstein on Wikipedia" |
| **convert-dates** | Converts **one** date, or compares dates, across calendar systems — Julian/Gregorian, Old Style/New Style year starts, Quaker numbered months, double-dated years — using the `convert_calendar` tool's adoption table for the record's jurisdiction. Inside a project, saves its result as one research-log entry; writes nothing else. Asked why a convention existed, whether a date string passes the schema, or about a same-calendar conflict, it hands the request back by name. | "Convert this date to Gregorian" / "Is 30 February 1712 a real date?" |
| **hypothesis-tracking** | Tracks competing candidates with evidence for/against each. Manages elimination. | "Could this be the same person?" |
| **conflict-resolution** | Resolves conflicting evidence — fact conflicts and identity conflicts where two candidate people genuinely compete. It analyses whether the sources are independent, weighs them by the preponderance hierarchy, and records how each conflict was settled: one record's version preferred, the tree's existing conclusion kept, or a value built from several records. It is the only caller allowed to record that analysis in the `conflicts` section; anything else may open a conflict but not resolve one. | "These sources disagree" / "Resolve this conflict" |
| **tree-edit** | Direct corrections to the tree file — add or correct a fact, create a person or relationship, list a person's attached records and record matches, and check possible duplicates. Also executes person merges after proof-conclusion confirms identity. A write that would introduce an unjustified genealogical warning is refused by the tool itself. | "Fix this name" / "Merge these two persons" |
| **validate-schema** | Validates both project files against the published schemas — required fields, enum values, ID prefixes, cross-references — and reports each error with a suggested fix. It never edits a file to fix an error; inside a project, saves its report as one research-log entry. The writer tools already validate before they persist, so this is an on-demand audit of the whole project. Asked about genealogical impossibilities or GPS quality, it hands the request back by name. | "Validate the project files" / "Is the schema valid?" |
| **search-records** | Searches FamilySearch indexed records (census, vital, probate, etc.) for one plan item or one search you name, ranks the results by match quality, flags namesakes for review, and logs every search including nil results. Hands back to `search-external-sites` after FamilySearch is exhausted. | "Search for Patrick Flynn in the 1850 census" / "Execute the plan" / "Run the next search" |
| **source-evaluation** | Audits the sources already attached to a person's FamilySearch profile. Classifies each finding as an indexing error (re-read the original and correct the index), a genuinely misattributed source (detach), or un-actionable FamilySearch backend metadata (not a to-do) — and where the evidence does not decide between the first two, says so rather than picking one. A source that merely states a fact more precisely than the profile is reported as an improvement, not a contradiction. A disagreement between two attached sources is characterised and handed on with no verdict, since weighing them belongs to the conflict workflow. When the project tree holds the person, also reports the impossible-date warnings `person_warnings` finds there, outside the findings count. Closes with FamilySearch's own profile checklist — its completeness and source-tagging suggestions, grouped by category and kept out of the findings count, because they are suggestions rather than errors. Inside a project, saves its report as one research-log entry; writes nothing else. | "Evaluate the sources on this profile" / "Are these sources right?" |
| **survey-surname** | Tabulates every household of a surname across a place's US federal censuses — one `record_search` per census year, staged results, a markdown table sectioned by year, recorded as one entry in the project's research log. Stops and asks for counties when a single year exceeds 600 matches. | "Find every Dixon family in Virginia" / "List all the Smiths in Ohio censuses 1820-1850" |
| **tree-survey** | Surveys a FamilySearch tree for holes it likely has records for before any project exists, checks what FamilySearch holds for the strongest ones, and suggests 3-5 people with one research question each. Writes nothing; the user picks one and `init-project` starts from it. | "What should I research in my tree?" / "Find gaps in my tree" / "Where should I start?" |
| **where-else-to-search** | After a FamilySearch records search, suggests 3-8 external collections FamilySearch curates for that place and period, each with a prefilled search link and the years it covers. Needs no project and writes nothing. | "Where else could I look for him?" / "Is this on Ancestry or MyHeritage?" |

## Recommended workflow

```
1. init-project              Start with a FamilySearch person ID
2. question-selection (agent) "What should I research next?"
3. research-plan (agent)     "How do I answer this question?"
4. search-records            Execute indexed searches on FamilySearch
   search-full-text          ...or full-text search for witnesses/FAN mentions
   search-external-sites (agent) ...or on Ancestry/MyHeritage/FindMyPast
5. extraction                Extract assertions from found records
                             (`extraction_append`; classifications
                             are set in code and are final)
6. citation (agent)          Polish citations to Evidence Explained standards
7. timeline                  Build chronological timeline, find gaps
8. conflict-resolution (agent) Resolve disagreements between sources
9. hypothesis-tracking (agent) Track competing candidates
10. research-exhaustiveness  Gate before proof — applies the seven
                             stop criteria. If not yet exhaustive, loop
                             back to step 3 (extend plan) or step 2
                             (FAN pivot). If exhaustive, advance.
11. proof-conclusion         Write the GPS conclusion
    tree-edit (agent)        Merge persons, correct facts
12. Ask "where are we?"      Answered by the main thread from the project state
```

This is the ideal GPS cycle. In practice you can invoke any skill at
any time — each checks its own preconditions and guides you if
prerequisites are missing.

Note that `research-exhaustiveness` runs **once per question, after
all of that question's plan items are complete and the resulting
evidence has been analyzed** — not after every search. The agent
needs log entries and classified assertions to evaluate criteria
like *independent verification* and *evidence class*, so it sits
naturally between the analysis steps (5–11) and `proof-conclusion`.
The `/research` orchestrator handles this routing automatically.

## Project files

| File | Purpose | Updated by |
|------|---------|-----------|
| `research.json` | GPS audit trail — all analytical state | Most skills |
| `tree.gedcomx.json` | Simplified GedcomX — resolved persons, relationships, sources | init-project, extraction_append (sources), person-evidence agent (stubs), proof-conclusion (facts/relationships), tree-edit agent |

Specs: `docs/specs/research-schema-spec.md` and
`docs/specs/simplified-gedcomx-spec.md`.
