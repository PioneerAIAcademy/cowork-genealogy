# Exposing MCP Endpoints to Claude Skills for a Genealogy Research Assistant on Claude Cowork

## TL;DR
- **Do not 1:1‑map skills to MCP endpoints.** Anthropic's own guidance is that MCP is plumbing and Skills are recipes; the right pattern for an accuracy‑critical genealogy assistant is a **hybrid**: ~12–16 workflow / GPS‑phase skills that hide the 20–25 MCP endpoints, plus 3–5 thin "atomic guardrail" skills (schema validator, warnings, calendar converter, match gate, transcription review) that wrap individually dangerous endpoints with deterministic Python checks.
- **Discoverability is dominated by description quality, not skill count.** Write "pushy," third‑person SKILL.md descriptions that name GPS phases and trigger phrases; namespace MCP tool names by domain (`tree_*`, `record_*`, `wiki_*`, `place_*`, `image_*`, `text_*`); keep each SKILL.md under ~500 lines with details in `references/`; and bundle scripts for any check that must be deterministic, because Anthropic's Complete Guide states "code is deterministic; language interpretation isn't."
- **In Cowork, skill composition is model‑driven, not programmatic.** Cowork (unlike Claude Code) does not document a `Skill` tool, a `Task` tool, or `context: fork` / `agent:` frontmatter; orchestration happens through Claude reading skill descriptions and invoking them based on instructions in an orchestrator SKILL.md. Make `tree.gedcomx.json` and `research.json` the auditable source of truth that every skill reads at the start and writes (then validates) at the end — do not rely on Cowork's project "memory" for genealogical facts.

## Key Findings

### 1. Anthropic's official position: Skills ≠ MCP tools, and 1:1 mapping is an anti‑pattern
Anthropic's product blog "Extending Claude's capabilities with skills and MCP" frames the relationship explicitly: *"MCP handles connectivity… Skills handle expertise: the domain knowledge and workflow logic that turn raw tool access into reliable outcomes… A single skill can orchestrate multiple MCP servers, while a single MCP server can support dozens of different skills."* The 33‑page Complete Guide to Building Skills for Claude states the kitchen analogy: *"MCP provides the professional kitchen… Skills provide the recipes,"* and the Sentry skill is held up as the canonical reference for MCP + skill composition: it *"coordinates multiple MCP calls in sequence, embeds domain expertise, provides context users would otherwise need to specify, [and adds] error handling for common MCP issues."*

This means the **GPS workflow** ("choose research question → plan → execute → analyze → resolve discrepancies → conclude") is the natural skill boundary, not the MCP endpoint list.

### 2. Tool‑count and accuracy data from Anthropic
From "Code execution with MCP: building more efficient AI agents" (Anthropic Engineering, Adam Jones and Conor Kelly): *"Today developers routinely build agents with access to hundreds or thousands of tools across dozens of MCP servers. However, as the number of connected tools grows, loading all tool definitions upfront and passing intermediate results through the context window slows down agents and increases costs."* In their canonical example, a Salesforce + Google Drive workflow that *"previously consumed about 150,000 tokens… used about 2,000 tokens [with code execution] — a 98.7% reduction."*

Anthropic's "Introducing advanced tool use on the Claude Developer Platform" (Nov 24, 2025) gives concrete tool‑selection accuracy numbers: *"Internal testing showed significant accuracy improvements on MCP evaluations when working with large tool libraries. Opus 4 improved from 49% to 74%, and Opus 4.5 improved from 79.5% to 88.1% with Tool Search Tool enabled."* The most common failure modes named are *"wrong tool selection and incorrect parameters, especially when tools have similar names like `notification-send-user` vs. `notification-send-channel`."* The same article gives an explicit threshold for opting into Tool Search: it is recommended once **tool definitions consume more than 10K tokens**.

For ~20 endpoints with tight descriptions, you are well below that threshold — but several pairs in the canonical list (`wiki_search`/`wiki_read`, `image_search`/`image_read`, `record_search` near `fulltext_search`) are exactly the similar‑named pairs Anthropic flags as confusion sources, so naming and disambiguation in tool descriptions matter even at small scale.

### 3. Skill‑to‑skill composition in Cowork is fundamentally different from Claude Code
This is the single most important Cowork‑specific finding for the user's architecture. Claude **Code** supports explicit skill composition through (a) a built‑in `Skill` tool that takes `command: "<skill-name>"` to invoke another skill mid‑conversation, (b) `context: fork` and `agent:` SKILL.md frontmatter that runs a skill in an isolated subagent (Explore, Plan, general‑purpose, or a custom `.claude/agents/*.md`), and (c) a `Task` tool for spawning parallel subagents.

Claude **Cowork** does not document any of these. The official Cowork support articles describe two — and only two — invocation paths: *"Claude applies relevant Skills automatically while you work—you don't need to invoke them separately"* and *"Type `/` in the sidebar to see available Skills and select one… Or describe your task naturally—Claude recognizes when a Skill applies and uses it."* Sub‑agent coordination in Cowork is described only as an implicit capability: *"Sub-agent coordination: Claude breaks complex work into smaller tasks and coordinates parallel workstreams to complete them."* Frontmatter fields like `context: fork`, `agent:`, and `disable-model-invocation:` are Claude Code extensions to the open Agent Skills standard; the open spec at agentskills.io defines only `name`, `description`, plus optional `license`, `compatibility`, and `metadata`.

**The practical consequence:** in Cowork, an orchestrator skill cannot programmatically call a child skill. It can only (a) tell Claude in prose "now invoke the analyze‑evidence skill" and rely on Claude's auto‑discovery picking it up from the description, (b) invoke MCP tools and bundled scripts directly, or (c) write to a shared file (`research.json`) that the next skill reads. The MindStudio Skill Collaboration writeup confirms this is the intended pattern: *"The skills themselves don't call each other directly. Instead, Claude reads the output of each tool, reasons about what to do with it, and decides which skill to invoke next."*

### 4. File‑based state in Cowork: project files, not "memory"
Anthropic's Cowork help‑center article on Projects describes per‑project *"files, context, instructions, and memory,"* with memory *"scoped to the project, so what Claude learns in one project doesn't carry over to others"* and *"stored locally on each user's computer."* Critically, Cowork does **not** document `CLAUDE.md` auto‑loading — that is a Claude Code feature only (per code.claude.com/docs/en/memory: *"Both [CLAUDE.md and auto memory] are loaded at the start of every conversation"*). For Cowork, the documented user‑editable, file‑like state is "Folder instructions" which *"add project‑specific context to Cowork when you select a local folder. Claude can also update these on its own during a session."*

For accuracy‑critical genealogy work, this is a feature, not a limitation: project memory is a black box that is not version‑controlled, not auditable, and not portable, and the GPS demands an auditable trail. The user's two‑file design (`tree.gedcomx.json`, `research.json`) is the right architecture: it is the single, schema‑validated source of truth, and every skill should read it at the start and write‑then‑validate at the end.

### 5. Skill description quality dominates discoverability
From Anthropic's Skill Authoring Best Practices (platform.claude.com): *"The 'name' and 'description' in your Skill's metadata are particularly critical. Claude uses these when deciding whether to trigger the Skill in response to the current task… Always write in third person… Be specific and include key terms. Include both what the Skill does and specific triggers/contexts for when to use it."* The `skill-creator` SKILL.md goes further: *"Currently Claude has a tendency to 'undertrigger' skills—to not use them when they'd be useful. To combat this, please make the skill descriptions a little bit 'pushy.' For instance, instead of 'How to build a simple fast dashboard,' you might write 'How to build a simple fast dashboard… Make sure to use this skill whenever the user mentions dashboards, data visualization, internal metrics, or wants to display any kind of company data.'"*

The Complete Guide also recommends the explicit anti‑pattern fix: *"Add negative triggers… Do NOT use for simple data exploration."* For accuracy‑critical work, negative triggers matter as much as positive ones — you do not want a place‑research skill firing for a person query.

### 6. Deterministic validation belongs in scripts, not prose
The Complete Guide is unambiguous: *"For critical validations, consider bundling a script that performs the checks programmatically rather than relying on language instructions. Code is deterministic; language interpretation isn't."* The corollary for genealogy: schema validation, the sanity warnings checks ("married before 12, died after 120"), calendar conversion at Julian/Gregorian boundaries, and ML match thresholding should all be scripts inside a skill's `scripts/` directory — not free‑form Claude reasoning over the MCP response.

This also addresses the user's `allowed-tools` question: as documented by Anthropic and confirmed by open GitHub issues `anthropics/claude-code#18837` ("Bug: allowed-tools in skill frontmatter not enforced") and `anthropics/claude-code#37683` (*"When a skill specifies allowed-tools in its YAML frontmatter, Claude still has unrestricted access to all tools. The allowed-tools field appears to be parsed but not enforced"*), `allowed-tools` is **not enforced** as a sandbox; it only pre‑approves tools without prompting. Real tool restriction in Cowork must come from the agent SDK's `permission_mode: "dontAsk"` plus an explicit `allowed_tools` allowlist (in the SDK case) or from prompt‑level discipline plus Cowork's "Ask before acting" mode in a chat session.

## Details

### Recommended skill architecture for the user's GPS assistant

**Reject 1:1 skills↔endpoints.** A skill per endpoint would create 20–25 thin wrappers whose descriptions overlap heavily ("search records," "search images," "search full text," "search wiki," "search Wikipedia," "search collections") — exactly the failure mode Anthropic identifies as causing wrong‑tool selection. It would also force the LLM to do GPS reasoning at every step instead of inheriting it from a workflow skill.

**The recommended hybrid is three layers:**

**Layer A — GPS workflow skills (12–16 skills, the primary surface).** These are the skills Claude triggers from user intent. Each maps to a phase or transition in the Genealogical Proof Standard and orchestrates several MCP endpoints.

| Skill | MCP endpoints it orchestrates | When it triggers |
|---|---|---|
| `framing-research-question` | (none — pure workflow) | "I want to research X," "trace ancestors of," "prove parentage of" |
| `creating-research-plan` | `wiki_country_research_tips`, `wiki_country_online_records`, `place_search`, `place_population`, `place_collections`, `place_external_links` | After question is framed; "plan research" |
| `executing-search-by-place` | `place_search`, `place_distance`, `place_collections`, `place_external_links`, `record_search` | Plan calls for searching a jurisdiction |
| `executing-search-by-person` | `tree_read`, `record_search`, `fulltext_search`, `match_persons` (read‑only) | Plan calls for finding records about a named person |
| `searching-images` | `image_search`, `place_search` | Plan calls for image/microfilm work |
| `transcribing-image` | `image_read`, `convert_calendar`, `place_search` | An image record needs structured data extracted |
| `searching-full-text` | `fulltext_search` | Narrative / biographical sources |
| `consulting-wiki` | `wiki_search`, `wiki_read`, `wikipedia_search`, `wiki_country_home`, `wiki_country_getting_started` | Methodology, place context, jurisdictional history |
| `analyzing-evidence` | `match_persons` (read‑only), `check_warnings`, `convert_calendar` | After new records are gathered |
| `resolving-discrepancies` | `match_persons`, `check_warnings`, `place_distance`, `convert_calendar` | Two sources disagree |
| `correlating-evidence` | `match_persons`, `fulltext_search`, `record_search` | GPS step 4 |
| `writing-conclusion` | (reads research.json) | GPS step 5 |
| `executing-research-plan` | Calls the executing‑* skills | "Run my plan" |
| `auto-research` | Orchestrates all of the above | "Research this person from scratch" |

Notice that `tree_read`, `place_search`, `wiki_search`, etc. appear inside multiple skills. That is correct — Anthropic's blog explicitly endorses this: *"a single MCP server can support dozens of different skills."*

**Layer B — Atomic guardrail skills (3–5 skills, accuracy‑critical).** These are the only places a 1:1 skill↔endpoint mapping is justified, because each wraps an endpoint whose misuse silently corrupts the project file:

1. **`validating-project-schema`** (wraps Schema validator). Bundled Python script. Mandatory final step of every skill that writes to `tree.gedcomx.json` or `research.json`. Description: *"Validates the genealogy project files against the published GEDCOM‑X and research‑log schemas. MUST be invoked after any change to tree.gedcomx.json or research.json. Use whenever a record is merged, a person is added, evidence is logged, or before any conclusion is drafted."*
2. **`checking-genealogical-warnings`** (wraps Warnings). Bundled script that exits non‑zero on red‑flag conditions. Mandatory after any merge or birth/death/marriage date addition. Description should list specific warnings ("married before 12, died after 120, child born after parent's death, two events on impossible dates").
3. **`converting-historical-dates`** (wraps Calendar converter). Auto‑triggered by date strings near regime boundaries (Julian→Gregorian transitions vary by jurisdiction, 1582–1923; Quaker double dates 1582–1752; Old Style/New Style English dates pre‑1752).
4. **`gating-person-matches`** (wraps Match). Refuses to assert identity below a configurable confidence threshold, logs the score and feature breakdown to `research.json`, and never auto‑merges. The skill, not the MCP endpoint, owns the threshold policy.
5. **`reviewing-transcription`** (wraps Image transcription with a human‑in‑the‑loop review prompt). Writes the transcript and source image hash to `research.json` and pauses for user confirmation before promoting any extracted fact into `tree.gedcomx.json`.

**Layer C — Hidden endpoints (the rest, never exposed as their own skill).** `tree_read`, `place_search`, `place_population`, `place_collections`, `place_external_links`, `wiki_search`/`wiki_read`, `wikipedia_search`, `record_search`, `image_search`/`image_read`, `fulltext_search`, `place_distance`, the four `wiki_country_*` tools — these are MCP tools only. They are called from inside Layer A skills. Their *MCP tool descriptions* still need to be excellent (because Claude must select among them inside a skill), but they do not deserve their own SKILL.md.

This produces roughly 17–20 skills (12–16 workflow + 3–5 guardrails) — comfortably under the 20–50 simultaneously‑enabled threshold the Complete Guide flags as a context‑pressure ceiling.

### Skill description writing for accuracy

For each Layer A skill, the description should follow this template:

```
description: <Third-person what-it-does, naming the GPS phase>. Use when
the user <specific trigger phrases>, mentions <domain keywords>, is working
with <file types: .gedcomx.json, .gedcom, image scans, transcriptions>, or
when the project is at <GPS phase>. Do NOT use for <near-miss alternatives>.
Always invoke validating-project-schema and checking-genealogical-warnings
after any write.
```

Concrete example for `analyzing-evidence`:

```yaml
---
name: analyzing-evidence
description: Analyzes newly gathered genealogical evidence for an active
  research question, scoring relevance, directness, and independence per
  the Genealogical Proof Standard. Use when the user says "analyze this
  evidence", "evaluate these records", "score these sources", or after
  any executing-* skill has added candidate records to research.json. Also
  use when the user mentions "direct vs. indirect evidence", "primary vs.
  secondary information", or "negative evidence". Do NOT use for initial
  record discovery (use executing-search-by-person) or for resolving two
  conflicting facts (use resolving-discrepancies). Always end by invoking
  validating-project-schema and checking-genealogical-warnings.
---
```

The negative triggers are the most under‑used technique in this domain because every workflow skill sounds vaguely like every other. Be ruthless: list the near‑miss skill name in "Do NOT use for…"

### MCP server design for the 20–25 endpoints

Anthropic's "Writing effective tools for agents — with agents" gives the strongest guidance here. Apply it as follows:

1. **Namespacing.** Group endpoints by resource: `tree_read`, `record_search`, `fulltext_search`, `image_search`, `image_read`, `wiki_search`, `wiki_read`, `wikipedia_search`, `place_search`, `place_population`, `place_collections`, `place_external_links`, `place_distance`, `wiki_country_home`, `wiki_country_getting_started`, `wiki_country_online_records`, `wiki_country_research_tips`, `match_persons`, `check_warnings`, `convert_calendar`. One consistent prefix scheme. Anthropic states namespacing *"can help agents select the right tools at the right time."* (The authoritative list lives in [`docs/specs/skill-architecture-spec.md`](../specs/skill-architecture-spec.md).)
2. **Disambiguate the dangerous near‑pairs.** `record_search` returns FamilySearch record results; `image_read` returns an image. Make this explicit in both names and descriptions. The "wrong tool selection" failure mode Anthropic names happens precisely with pairs like `notification-send-user` vs. `notification-send-channel`.
3. **Tool descriptions ≥ schemas.** Anthropic: *"Even small refinements to tool descriptions can yield dramatic improvements. Claude Sonnet 3.5 achieved state‑of‑the‑art performance on the SWE‑bench Verified evaluation after we made precise refinements to tool descriptions."* Each description should include: purpose, when to use, when *not* to use, parameter expectations with units (date format, place ID format), and a one‑line example.
4. **Server instructions field.** From Claude Code's MCP docs: *"Server instructions help Claude understand when to search for your tools, similar to how skills work."* Fill it in.
5. **If you grow past ~30 endpoints, opt into Tool Search.** Anthropic's threshold is *"tool definitions consuming more than 10K tokens."* The beta header is `advanced-tool-use-2025-11-20`; tools opt in via `defer_loading: true`; in Claude Code the env var `ENABLE_TOOL_SEARCH=auto:N` overrides the default. For 20–25 endpoints today, eager loading is fine.
6. **Return structured but compact results.** Anthropic's principle 4 (token efficiency): *"include the expense description and category—not just a UUID the agent would need to look up with another tool call."* For `record_search`, return canonical fields plus the FamilySearch URL; don't dump the full XML.
7. **Code‑execution‑with‑MCP for batch loops.** For an autoresearch run that calls `record_search` 50 times, the Anthropic pattern is to expose tools as code on the filesystem so the model writes a script that loops, instead of taking 50 individual tool turns. This is the long‑run path; not required for v1.

### Composability and the autoresearch orchestrator

Because Cowork lacks an explicit `Skill` tool, the autoresearch skill cannot be a programmatic dispatcher. It must be a written workflow that names sibling skills and relies on auto‑discovery. The pattern that works:

```yaml
---
name: auto-research
description: End-to-end automated genealogical research from a single
  question. Use when the user says "auto-research", "research this person
  from scratch", "do the GPS process for me", or provides a person ID and
  a research question with no plan. Coordinates framing, planning, search,
  evidence analysis, and conclusion. Pauses for human review at every
  identity merge and every contradicting evidence resolution.
---

# Auto-research orchestration

Read tree.gedcomx.json and research.json at the start of every iteration.

## Phase 1: Frame the question
Invoke the framing-research-question skill if research.json has no active
question, otherwise load the active question.

## Phase 2: Plan
Invoke creating-research-plan. It writes a plan to research.json.

## Phase 3: Execute
For each step in the plan, invoke the appropriate executing-* skill:
- Place-bound steps → executing-search-by-place
- Person-bound steps → executing-search-by-person
- Image steps → searching-images then transcribing-image
- Full-text steps → searching-full-text
After each step, invoke validating-project-schema and
checking-genealogical-warnings. STOP on any non-zero warning.

## Phase 4: Analyze
Invoke analyzing-evidence on every record added in Phase 3.

## Phase 5: Resolve discrepancies
For any unresolved conflict, invoke resolving-discrepancies.
For any candidate identity merge, invoke gating-person-matches and PAUSE
for human confirmation before merging.

## Phase 6: Conclude
Invoke writing-conclusion. The conclusion writes a soundly-reasoned
proof argument to research.json and validates the schema one last time.

## Stopping conditions
- Schema validation fails twice in a row.
- Any sanity warning fires that is not waived in research.json.
- Confidence on any merge is below the threshold in
  research.json/config/match_threshold.
- The plan is exhausted.
```

This works in Cowork because: (a) the orchestrator names each child skill explicitly so Claude can find it via auto‑discovery; (b) each child writes its result to `research.json`, which the next child reads — the file *is* the inter‑skill protocol; (c) the validation gate is a script invocation, not free reasoning; (d) human pauses are explicit at the two highest‑risk points (merges, conflicts).

### File‑based protocol between skills

Adopt a strict convention every skill follows:

1. **Read** `tree.gedcomx.json` and `research.json` first thing.
2. **Write** all outputs back to `research.json` under a stable key path (e.g., `research.evidence[<id>]`, `research.plan.steps[<id>].status`).
3. **Validate** by invoking `validating-project-schema` as the last step.
4. **Log** the skill invocation, input args, and outcome to `research.audit_log[]` so the user can reconstruct provenance — a hard requirement for the GPS.

This is the same pattern Anthropic recommends in the Complete Guide for multi‑MCP coordination: *"Clear phase separation, data passing between MCPs, validation before moving to next phase, centralized error handling."* The two‑file project gives you all four for free.

### Cowork‑specific operational details

- **Skill location.** In Cowork, custom skills are uploaded via Customize > Skills (per‑user) or, on Team/Enterprise, provisioned org‑wide via Organization settings > Skills. Cowork plugins (a bundle of skills + connectors + sub‑agents) are the right packaging unit for distribution to other genealogists.
- **Code execution.** Skills require code execution to be enabled. The user's bundled Python scripts (schema validator, warnings checker, calendar converter) run inside Cowork's sandboxed VM, with file access scoped to the connected folder.
- **MCP connection.** The MCP server is configured as a custom connector (Settings > Connectors > Add custom connector) with a name and MCP server URL. For local development, register via Settings > Extensions or `claude mcp add`.
- **Permission gates.** Cowork has a mode selector ("Ask before acting" vs. autonomous modes). For accuracy‑critical work the recommendation is to keep "Ask before acting" on for any skill that writes to `tree.gedcomx.json`; reads can be autonomous.
- **Sub‑agents in Cowork.** Cowork's sub‑agent coordination is implicit and model‑driven. The user cannot define named subagents the way Claude Code can (`.claude/agents/*.md`), so workflow parallelism (e.g., searching 5 jurisdictions in parallel) currently happens via Claude's internal planning, not via developer‑addressable subagent definitions. Plan for sequential execution; treat parallelism as a bonus.
- **Project memory.** Cowork's project memory is local, not auditable, and not version‑controlled. Do not put genealogical facts there. Use it for user preferences (citation style, preferred place gazetteer, surname spelling preferences). Genealogical facts live in the two project files.

## Recommendations

**Stage 1 (build the skeleton, ~1 week).**
1. Stand up the MCP server with all 20–25 endpoints, namespaced as above. Write tight tool descriptions (purpose, when to use, when not to use, parameter format).
2. Build the 3–5 atomic guardrail skills first (`validating-project-schema`, `checking-genealogical-warnings`, `converting-historical-dates`, `gating-person-matches`, `reviewing-transcription`), each with a bundled Python script and a strict, "pushy" description.
3. Define and freeze the JSON Schema for `research.json` (plan, evidence list, audit log, conclusions). Publish it. The schema validator skill validates against this.
4. Build a single workflow skill end‑to‑end: `executing-search-by-person`. Iterate using `skill-creator` and the Skill Creator 2.0 eval‑driven workflow until it triggers correctly on 9/10 representative prompts and produces correct results vs. baseline.

**Stage 2 (build the workflow layer, ~2–3 weeks).** Add the remaining Layer A skills one at a time, in this order: `framing-research-question` → `creating-research-plan` → `executing-search-by-place` → `searching-images` → `transcribing-image` → `searching-full-text` → `consulting-wiki` → `analyzing-evidence` → `resolving-discrepancies` → `correlating-evidence` → `writing-conclusion`. After each addition, re‑run the eval suite for *all* prior skills to catch trigger drift (a new skill stealing triggers from an old one is the #1 cause of regressions).

**Stage 3 (orchestrate).** Build `executing-research-plan` and then `auto-research`. The orchestrator's only job is to read state, name the next child skill, and gate on validation results.

**Stage 4 (harden for accuracy).** Add adversarial test cases: an Old Style date that should trigger calendar conversion, a place name that resolves to two jurisdictions, a Match call below threshold, a transcription with deliberate ambiguity. Every test must produce a deterministic outcome — if a script can't enforce it, write the script.

**Benchmarks that would change the plan:**
- If the cumulative MCP tool definitions exceed the 10K‑token threshold Anthropic names for Tool Search opt‑in, enable it (`advanced-tool-use-2025-11-20` beta header, `defer_loading: true`, or `ENABLE_TOOL_SEARCH` for Claude Code).
- If skill triggering accuracy drops below ~85% on the eval suite, split or merge skills based on the failure pattern (under‑triggering → make descriptions pushier; over‑triggering → add negative triggers and tighten scope).
- If autoresearch runs blow past a single Cowork session, migrate to the API + Agent SDK with `permission_mode: "dontAsk"` and a strict `allowed_tools` allowlist, and run autoresearch as a Routine (Anthropic's cloud‑hosted scheduled execution tier, introduced in research preview April 14, 2026).
- If you need true programmatic skill invocation (a `Skill` tool, named subagents, `context: fork`), the path is **Claude Code on the same project folder, not Cowork** — Claude Code's `Skill` tool, `Task` tool, and `context: fork` frontmatter give explicit composition that Cowork lacks today. The same SKILL.md files work in both surfaces (the open Agent Skills format is portable), so building skill content for Cowork does not block adopting Claude Code as the orchestration host later.

## Caveats

- **Cowork feature parity is moving.** Several features documented for Claude Code (the `Skill` tool, `context: fork`, named subagents, hooks) may land in Cowork; if and when they do, the orchestrator can become more programmatic. Track the Cowork release notes and the agentskills.io spec.
- **`allowed-tools` is not a sandbox.** Per open issues `anthropics/claude-code#18837` and `#37683`, `allowed-tools` in SKILL.md frontmatter pre‑approves tools but does not block unlisted ones. For real isolation, use the Agent SDK with `permission_mode: "dontAsk"` and an explicit `allowed_tools` allowlist, or rely on Cowork's permission mode and folder scoping.
- **Skill auto‑triggering is statistical.** Even a perfect description does not guarantee the right skill fires. Build the eval suite first and treat trigger rate as a measured KPI; expect to iterate descriptions over weeks. Skill Creator 2.0 (March 2026) ships test cases, blind comparisons, and a description optimizer specifically for this loop.
- **MCP version drift.** Per Armin Ronacher's December 2025 post on skills vs. dynamic MCP loadouts, MCP servers are increasingly trimming tool descriptions to save tokens. If you depend on long descriptions for guidance, embed that guidance in the skill SKILL.md (which you control) rather than in tool descriptions (which can change underneath you).
- **Genealogy‑specific risk.** The Match endpoint is the highest‑risk single component. Wrap it in a guardrail skill that *never* auto‑merges, always logs the confidence score, and always pauses for the user. The cost of a false‑positive merge in a family tree is exactly the multi‑year wasted research the user is trying to prevent.
- **Documentation provenance.** Several "Cowork" details widely circulated in third‑party tutorials (notably auto‑loaded `claude.md` and `memory.md` files) are conventions in third‑party content but are not stated in Anthropic's primary Cowork support articles, which describe only "instructions" and "memory" as managed features. Treat the file convention as undocumented and rely on your own project files (`tree.gedcomx.json`, `research.json`) as the single source of truth.
- **Tool‑count threshold framing.** Anthropic's published number is "tool definitions consuming more than 10K tokens" (from the Nov 24, 2025 Advanced Tool Use article); a separate widely‑repeated "10% of context window" figure originates with third‑party coverage citing an Anthropic engineer and is not the primary‑source threshold. Plan against the 10K‑token figure.
