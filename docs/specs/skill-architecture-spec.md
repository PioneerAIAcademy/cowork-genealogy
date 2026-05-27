# Skill Architecture Specification

This document captures the architectural decisions and design rationale
behind the GPS genealogy skill system. For the actual skill definitions,
see the SKILL.md files in `plugin/skills/*/`. For the skill catalog and
workflow, see the root `README.md`.

---

## 1. Architecture Summary

Skills fall into three categories:

- **Workflow skills** — Triggered by user intent. Each maps to a phase or transition in the Genealogical Proof Standard. They read from and write to `research.json` and `tree.gedcomx.json`.
- **Reference documents** — Not triggered directly. Embedded as `references/` files inside workflow skills that need their rules. They encode strict behavioral mandates (like the research log protocol) that multiple skills must follow identically.
- **Guardrail skills** — Enforce schema conformance and catch errors. Cowork does not have auto-triggers or post-write hooks, so guardrail enforcement is embedded as instructions within each writing skill's SKILL.md: "After writing to research.json, invoke validate-schema." Enforcement depends on Claude's compliance with these instructions, not on mechanical triggers.

Skills communicate through the two project files — `research.json` and `tree.gedcomx.json`. There is no programmatic skill-to-skill invocation in Cowork. Orchestration happens through Claude reading skill descriptions and deciding what to invoke next based on the file state and user intent.

### Handoff mechanism

When one skill produces data that another skill needs (e.g., search-records finds a record that record-extraction should process), the handoff happens through Claude's context — Claude holds the record data from the MCP tool response and processes it when the next skill fires. There is no file-based queue for pending work. If Claude's context is lost between sessions, the user must re-fetch the record (by re-running `record_search` or by re-uploading a PDF capture). A "session" corresponds to a single Cowork conversation — starting a new conversation clears Claude's context. Within a conversation, context persists across skill invocations.

### Canonical MCP tool names

Skills reference MCP tools by these canonical names. This is the authoritative list; `tools.md` and `mcp-endpoints.md` are being brought into line with it.

Names follow a `noun_verb` convention, with `search` (not `query`) as the verb for retrieval operations that return a list of candidates, and `read` for operations that return the full content of a single resource.

| Canonical name | Description |
|---------------|-------------|
| `record_search` | Search historical records by person attributes |
| `fulltext_search` | Search full-text collections |
| `image_search` | Search for record images by metadata |
| `image_read` | Read/transcribe a record image |
| `tree_read` | Read person data from the FamilySearch tree |
| `wiki_search` | Search the FamilySearch wiki for research methodology |
| `wiki_read` | Read a full FamilySearch wiki page |
| `wikipedia_search` | Search Wikipedia |
| `place_search` | Look up place information and jurisdictional hierarchy |
| `place_population` | Get population statistics for a place/time |
| `place_collections` | Find FamilySearch collections covering a place (list mode), or get detail for a single collection (detail mode, via `id`) |
| `place_external_links` | Get external record collection links for a place |
| `place_distance` | Calculate distance between two places |
| `wiki_country_home` | Get the FamilySearch wiki country home page for a place id |
| `wiki_country_getting_started` | Get the "getting started" wiki section for a place id |
| `wiki_country_online_records` | List online record sources for a place id |
| `wiki_country_research_tips` | Get country-specific research tips for a place id |
| `match_two_examples` | Compare two record extractions for whether they describe the same person |
| `convert_calendar` | Convert between Julian/Gregorian/Quaker date systems |

The four `wiki_country_*` tools are distinct from `wiki_read` because they accept a place id (not a wiki page title) and resolve the place to the right wiki page server-side.

**Infrastructure tools** — not called by skills directly. Called by Claude when authenticated tools return an auth error, or by the user to manage their session.

| Canonical name | Description |
|---------------|-------------|
| `login` | OAuth 2.0 + PKCE login to FamilySearch |
| `logout` | Clears the FamilySearch session |
| `auth_status` | Reports whether the user is authenticated |

**Current → canonical rename map.** Several tools are currently registered under non-canonical names and will be renamed:

| Current | Canonical |
|---------|-----------|
| `search` | `record_search` |
| `tree` | `tree_read` |
| `places` | `place_search` |
| `collections` | `place_collections` (also absorbs the detail-mode behavior previously specced as a separate `collection-detail` tool) |
| `external_links` | `place_external_links` |
| `search_wiki` | `wiki_search` |
| `wiki_fetch_page` | `wiki_read` |
| `wiki_country_records` | `wiki_country_online_records` |

Tools whose current names already match canonical (no rename needed): `fulltext_search`, `match_two_examples`, `image_read`, `wikipedia_search`, `place_distance`, `place_population`, `wiki_country_home`, `wiki_country_getting_started`, `wiki_country_research_tips`, `login`, `logout`, `auth_status`.

Tools not yet implemented: `image_search`, `convert_calendar`.

**Schema validator:** Implemented as a bundled Python script inside the validate-schema skill, not as an MCP tool. Deterministic validation belongs in scripts, not in tool calls that route through the LLM.

**Warning checks:** Specced earlier as a `check_warnings` MCP tool but never built as one. Genealogical impossibility checks (married before 12, died after 120, child born after a parent's death) are simple date arithmetic done by the check-warnings skill reasoning over the project files.

---

## 2. Design Decisions

**Why record-extraction and assertion-classification are separate skills.** Extraction is deterministic-ish — "read this record, list its claims." Classification is taxonomic reasoning — evaluating informant proximity, determining whether information is primary or secondary, deciding whether evidence is direct or indirect. Bundling them makes a single skill file cover both, which makes worked examples crowd each other and makes the skill too long for reliable LLM execution. The tradeoff: assertions temporarily exist with best-effort classifications (written by record-extraction) until assertion-classification refines them. The schema's `information_quality` and `evidence_type` fields are required, so record-extraction fills them with initial values — not placeholders, but genuine first-pass classifications that assertion-classification may upgrade or correct.

**Why research-log is a reference document, not a skill.** The "every search produces a log entry, nil results are recorded explicitly" rule is a strict behavioral mandate that must be followed by search-records, search-external-sites, and record-extraction. In Claude Code, this could be a skill invoked by other skills. In Cowork, one skill cannot invoke another. The options are: (a) a standalone skill that Claude auto-discovers (unreliable — nothing guarantees it fires), (b) duplicate the rules in each search skill (consistent but redundant), or (c) a reference document included in each search skill's `references/` directory. Option (c) gives a single source of truth without depending on auto-discovery.

**Why hypothesis-tracking is tier 2, not tier 3.** The earlier design placed hypothesis-tracking in tier 3 as a "hard problem" feature. It was promoted to tier 2 because: (a) the identity-resolution design (assertions → person_evidence → persons) means hypotheses about person identity arise in any non-trivial project, not just "hard" ones, and (b) proof-conclusion needs hypothesis state to write conclusions about competing candidates.

**Why there is no separate fan-research skill.** "'Should we shift to FAN research now?' is a question-selection judgment." FAN pivot is a value in the `selection_basis` enum. When question-selection decides direct evidence is exhausted, it creates a FAN-directed question (e.g., "Who witnessed Thomas Flynn's land deeds in Schuylkill County?"). That question flows through research-plan → search-records → record-extraction like any other question. A separate fan-research skill would violate the single-writer principle on questions and plans, and would duplicate the search/extraction pipeline.

**Why there is no orchestrator skill in v1.** Cowork lacks programmatic skill invocation (`Skill` tool, `context: fork`, named subagents). An orchestrator skill can only name child skills in prose and rely on Claude's auto-discovery — which is unreliable for multi-step chains. The project-status skill partially fills this gap by reading state and recommending the next step. A full orchestrator becomes viable when the system moves to Claude Code (which has the `Skill` tool and `Task` tool) or when Cowork adds programmatic composition.

**Why the search→extraction handoff is context-based, not file-based.** File-based handoff would require a "pending records" section in research.json — adding schema complexity for a transient state. In practice, Claude holds the MCP tool response in its context window and processes it immediately. If context is lost (session ends), the record can be re-fetched by re-running `record_search`. This is simpler and avoids polluting the audit trail with transient state.

---

## 3. Intentionally Deferred Features

- **`fan-pattern-analysis`** — Proactive FAN (Family, Associates, Neighbors) pattern detection over assembled assertions — surfacing patterns like "this witness appears on three consecutive land deeds." Deferred because it requires a critical mass of assertions to be useful. In v1, FAN search decisions are made by question-selection, and FAN assertions are linked to hypotheses via `supporting_assertion_ids`.
- **`record_browse` MCP tool** — Browse neighboring records in a collection given a starting record ID. Required for effective FAN research — discovering unknown neighbors by browsing the census page rather than searching by name.
- **`chronicling_america` MCP tool** — Search the Library of Congress Chronicling America newspaper database via its free public API.
- **Stale search detection** — project-status could note the age of each log entry and suggest re-running searches older than N months, since FamilySearch adds millions of records annually.
- **`auto-research` orchestrator** — End-to-end orchestration skill that reads project state and chains skills through the full GPS cycle. Deferred to v2. In v1, the user drives the cycle manually with project-status recommending the next step.
