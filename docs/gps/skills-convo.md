I've grouped these into three tiers. The tier matters more than the within-tier ordering — tier 1 must exist before tier 2 is useful, tier 2 before tier 3.

**Tier 1 — Foundation (build first; nothing else works without these)**

1. **`gedcomx`** — Defines the file format that is the artifact. Specifies the FamilySearch GedcomX subset you use, the sidecar analytical schema (assertions, conflicts, hypotheses, log, proof) layered alongside it, file naming, id conventions, where the project state lives in the folder, and merge/append rules. This is the highest-leverage skill in the system because every other skill reads from and writes to these files. Without it, every session produces a slightly different file shape and your v2 UI has nothing stable to consume. Include validation rules and a self-check pattern Claude runs before writing.
2. **`research-log`** — Defines the log file format, the rule that every tool call produces an entry, and the rule that empty results are explicitly recorded as `outcome: negative`. This is what makes "reasonably exhaustive" provable rather than aspirational, and it's what gives session continuity when you come back to a project days later. Strict format, fixed location, simple append semantics — Claude follows this reliably if the skill is unambiguous.
3. **`assertion-extraction`** — Turns records into atomic `Subject | Fact | Value | Date | Source` claims, _and_ assigns the three-layer classifications (Original/Derivative/Authored, Primary/Secondary/Indeterminate, Direct/Indirect/Negative) and identifies the informant. Combined into one skill because these always happen together — you can't classify what you haven't extracted, and the informant evaluation is part of assigning Primary/Secondary. This is the granular unit everything downstream operates on.
4. **`citation`** — Evidence Explained templates per source type (census, vital, deed, probate, newspaper, church register, Find A Grave, etc.) with worked examples. GPS Element 2 is a hard requirement, and citation reliability is one of those things that silently degrades without a skill enforcing the patterns.

**Tier 2 — Core GPS conformance (build once tier 1 is stable)**

5. Research plan
	a. **`question-selection`** — Given current project state (timeline, assertions, conflicts, hypotheses, log of what's been searched, the overall objective), output the next research question with rationale. Inputs are mostly internal: the GedcomX file, the assertions sidecar, the timeline, the unresolved conflicts list. The reasoning is "what gap, when filled, would most advance the objective" — gap analysis, value-ranking (which gaps unblock the most), and conflict-prioritization (a contested identification has to be resolved before downstream work is safe). Output is a single well-formed question with a verifiable answer, plus rationale, plus what it depends on or unblocks. 
		"Should we shift to FAN research now?" is a question-selection judgment ("direct evidence is exhausted; the next productive question is about associates, not the subject"). Once that's decided, the plan for a FAN question is just a plan like any other.
	b. **`research-plan`** — Given a specific research question, output a concrete plan to answer it. Inputs are mostly external: jurisdiction lookups, `wiki_search` for record availability, `place_collections`, `place_population` for context, `place_search` for boundaries. The reasoning is "what records exist for this place and time that could answer this question, in what search order, with what fallback if the primary record set yields nothing." Output is a sequenced list of plan items.
6. **`timeline`** — Builds timelines from assertions, surfaces gaps, flags chronological impossibilities. Drives the "what's missing" half of research planning. Output structured (array of timeline events) so the planning skill can consume it without re-parsing prose.
7. **`conflict-resolution`** — Conflict surfacing, source-independence checking, informant evaluation, and the weighing protocol from your knowledge base, all in one skill because they're a single reasoning chain. Outputs structured `conflict` objects per the schema, including the explicit "unresolved" state when preponderance isn't clear.
8. **`proof-conclusion`** — Proof tier classification (Proved/Probable/Possible/Not Proved), vehicle selection (Statement/Summary/Argument), and templates for writing the conclusion narrative. Direct mapping from your AI Output Selection Guide.

**Tier 3 — Extensions (build when use cases demand them)**

9. **`fan-club`** — FAN identification and pattern analysis over assembled records. Tier 3 not because it's unimportant — your knowledge base correctly flags it as the brick-wall workhorse — but because it only fires once direct evidence is exhausted, and an MVP can defer it.
10. **`hypothesis-tracking`** — Competing-candidate state with evidence for/against each. Same persistence pattern as the research log; the skill defines the file format and update rules. Becomes critical on hard problems where multiple John Smiths are in play, but a simple project doesn't need it.
11. **`locality-research`** — Wraps `wiki_search`, `place_population`, `place_external_links`, and `place_collections` into a structured locality guide for a place/time. Could fold into `research-planning`; I'd split it once you find yourself wanting standalone "tell me about records in Augusta County 1820–1850" workflows.
12. **`translation`** — Genealogy-specific glossaries for German, French, Spanish, Italian, Dutch, Latin (the languages you'd actually hit in 1600+ Western Europe). Period orthography notes — Sütterlin, Latin abbreviations in parish registers. Tier 3 because monolingual English-record projects don't need it.

**Sequencing note**

I'd build tier 1 end-to-end and run it on a real research question before touching tier 2. Tier 1 is where most of the design discoveries happen — particularly in the GedcomX skill, where the sidecar schema will want a few iterations once you see Claude actually using it. The temptation will be to build all of tier 1 in parallel; resist it. Build `gedcomx` first, then `research-log`, then put real records through `assertion-extraction` before you commit to its output shape. The `citation` skill can come last in tier 1 because it's the most independent.

---
**Issues with the schema**

_The biggest issue: `subject_person_id` everywhere assumes person identity is settled, which contradicts the entire point of the GPS._ Most genealogy research is precisely about deciding whether two records refer to the same person. If I'm researching whether John Smith of Augusta County is the same as John Smith of Rockingham County, I have two GedcomX persons that may or may not merge. Assertions extracted from records before that resolution can't be cleanly attached to one or the other. The current schema either forces premature identity decisions or silently corrupts when persons get merged.

The fix: assertions attach to a `record_id` and a `record_role` (the role-within-record — "head of household," "father of bride," "deceased"), not directly to a person. Person attachment becomes a separate `person_evidence` linking step that can be revised. This mirrors how GedcomX itself handles it (Persona vs. Person) and how careful researchers actually work.

_Timelines keyed by `subject_person_id` have the same problem._ Timeline construction is itself an identity-resolution exercise — you build a candidate timeline to test whether records cohere into one life. Better to key timelines by `hypothesis_id` or a free-form `timeline_id` with a label, so you can build a timeline for "John Smith assuming Augusta and Rockingham are the same person" and another for the alternative.

_The `conflicts` section is too narrow._ I scoped it to fact-level conflicts (three different birthplaces). But the most consequential conflicts in genealogy are identity-level — "this 1850 census John Smith might be our subject, or might be a different John Smith of the same age." That's a conflict about person merging, not a fact value. Either broaden conflicts to include identity conflicts or add a separate `identity_questions` section.

_`fan_evidence_ids` on hypotheses references an undefined entity._ I introduced FAN evidence in the hypothesis schema but never defined what a FAN evidence object looks like. Either remove it (FAN findings are just regular assertions about the subject's associates, and hypothesis support links to those assertions) or define a FAN cluster section explicitly.

_Source `source_type` of `original`/`derivative`/`authored` belongs at the source level, but `information_quality` of `primary`/`secondary` belongs at the assertion level — which I got right — but I conflated them in places._ A single derivative source can contain primary information (a transcript of a self-reported birth date) and a single original source can contain secondary information (a death certificate where the informant is reporting hearsay birth facts). The schema enforces this correctly but I should call it out so the skill writers don't collapse them.

_No representation of "reasonably exhaustive" completion._ The log captures what was searched, but there's no place where the agent declares "I believe research on question Q is reasonably exhaustive because I searched X, Y, Z." That declaration is itself an analytical claim the GPS requires, and it should live in the proof summary or in a dedicated field on the question, with explicit reference to the log entries that justify it.

_Status enums are scattered and inconsistent._ `questions.status` is `open|resolved`, `plans.status` is `in_progress|superseded`, plan items are `planned`, conflicts are `unresolved`, hypotheses are `active|ruled_out`. Worth defining these as explicit enum lists in the gedcomx skill so they don't drift.

_No version field._ Schema will evolve. A `schema_version` at the top level lets the gedcomx skill detect old files and migrate or refuse them. Cheap to add now, painful to retrofit.

**Issues with the skill list**

_`assertion-extraction` is doing too much._ I bundled extraction, three-axis classification, and informant identification into one skill on the grounds that they happen together. Reconsidering: extraction is deterministic-ish ("read this record, list its claims"), three-axis classification is taxonomic reasoning, informant identification is record-type-specific judgment. Bundling them means a single skill file has to cover all three, which makes it long and makes the worked examples crowd each other. I'd split into:

- **`record-extraction`** — read a record, emit assertions with `record_id`/`record_role`, do source-level Original/Derivative/Authored classification.
- **`assertion-classification`** — given assertions, assign Primary/Secondary/Indeterminate (with informant analysis) and Direct/Indirect/Negative.

That puts informant identification with the Primary/Secondary judgment where it belongs (since that's the axis it directly determines).

> **Status note (2026-07):** this split was later reversed — `assertion-classification` was merged back into `record-extraction`. Classification is now **first-and-final at extraction** (the record-extractor agent applies the full three-layer rigor in the same pass that extracts), and classification-refinement requests route back through `record-extraction`. The `assertion-classification` references in the tier lists and build order below are historical.

_`citation` should be tier 1, but it's not as foundational as I implied._ Citations get generated from sources, and sources are a relatively thin record of where data came from. Worth keeping in tier 1 for GPS conformance, but it's the most independent of the four — could realistically be deferred a week without breaking anything else. My earlier "build it last in tier 1" note was right and I shouldn't have flagged it as more critical than it is.

_Missing skill: `person-evidence`._ If assertions attach to records and records get linked to persons separately (per the schema fix above), there needs to be a skill that does that linking — evaluating whether the John Smith in this 1850 census is our subject. This is the identity-resolution work that the Match tool supports but doesn't fully automate. Belongs in tier 2, between question-selection and conflict-resolution.

_Missing skill or pattern: schema validation._ The gedcomx skill defines the schema; something needs to enforce it. Two options: a validation skill that Claude runs before writing, or a small MCP tool that validates against a JSON schema. The tool is more reliable. I'd add a second tool to the MCP list.

**Revised tool list**

1. **`convert_calendar`** (Calendar converter, as before)
2. **Schema validator** — given a project file, validate against the published schema and return errors. Cheap to build, prevents an entire class of silent corruption, and gives you a hook for schema migration later. *(Note: in the final architecture this is a bundled Python script in the validate-schema skill, not an MCP tool.)*
3. **`image_read`** (image transcription, as you've already committed)

**Revised skill list**

Tier 1:

1. `gedcomx` (now also publishes the JSON schema the validator tool consumes)
2. `research-log`
3. `record-extraction` (was part of `assertion-extraction`)
4. `assertion-classification` (was part of `assertion-extraction`)
5. `citation`

Tier 2: 6. `question-selection` 7. `research-plan` 8. `timeline` 9. `person-evidence` (new — handles the record-to-person linking that the schema fix requires) 10. `conflict-resolution` 11. `proof-conclusion`

Tier 3: 12. `fan-club` 13. `hypothesis-tracking` 14. `locality-research` 15. `translation`

_Drop the schema version field._ You don't need it if migration isn't a goal. If the schema changes, old project files just stop working, and that's acceptable during the build-out phase. One less thing for the gedcomx skill to manage.

_Drop the schema validator tool._ I added it primarily as a hook for migration and silent-corruption detection. Without migration, the value drops a lot — Claude reads the file, the gedcomx skill defines the format, and if the file is malformed Claude will notice immediately when trying to use it. Validation-as-a-tool only earns its keep when you have many readers/writers or strict format contracts; you have neither. Skip it.

---
_The "upload to FamilySearch when complete" goal sharpens what the two files are for._ `tree.gedcomx.json` is the deliverable — what eventually goes to FamilySearch as Persons, Relationships, Sources, and the conclusion-model facts. `research.json` is the working artifact — questions, plans, log, assertions, conflicts, hypotheses, proof summaries — that proves the conclusions in the GedcomX file are GPS-conformant. The research log specifically is uploadable to FamilySearch (they accept research logs as part of the Memories/Documents flow, and conclusions can cite them).

That has one downstream implication worth naming: the proof summaries and the conclusion narratives in `research.json` should be written in a form that can be uploaded as standalone documents. Markdown narrative is fine for that. The `proof-conclusion` skill should produce narratives that read as self-contained documents, not as "fragments that only make sense alongside the JSON." That's a small framing change but it affects how the skill prompts for narrative generation.

_The identity-resolution issue I raised gets cleaner too._ If the GedcomX file is the deliverable, then by the time you upload, all the Person merging is settled — that file has resolved persons. The `research.json` is where the messy intermediate state lives. So the schema fix I proposed (assertions attach to record + role, linked to persons separately via `person-evidence`) is exactly right: it's the working state during research, and at upload time the resolved person identities flow into the GedcomX file while the assertion-to-record-role linkages stay in research.json as the audit trail.

Skills, tier 1:

1. `gedcomx` (defines both files, their schemas, ownership rules, and upload-time mapping)
2. `research-log`
3. `record-extraction`
4. `assertion-classification`
5. `citation`

Skills, tier 2: 6. `question-selection` 7. `research-plan` 8. `timeline` 9. `person-evidence` 10. `conflict-resolution` 11. `proof-conclusion`

Skills, tier 3: 12. `fan-club` 13. `hypothesis-tracking` 14. `locality-research` 15. `translation`

Schema sections in `research.json` as previously laid out, minus the `schema_version` field, with the identity-resolution fixes (assertions on records/roles, timelines keyed by hypothesis or label, identity conflicts as first-class), the explicit "reasonably exhaustive" declaration on questions, and consistent status enums defined in the `gedcomx` skill.

The biggest decision left in front of you is what the `gedcomx` skill's first version actually contains — that's where I'd spend the most time before writing any other skill, because every other skill reads from or writes to the schema it defines. Worth treating the gedcomx skill itself as the v1 deliverable and putting one real research question through it before building anything else.

---
**`gedcomx` skill** — defines `tree.gedcomx.json` only. The FamilySearch GedcomX subset, how Persons/Relationships/Facts/Sources are structured, id conventions for GedcomX entities, and the upload-time format requirements. Single responsibility: produce GedcomX that round-trips cleanly with FamilySearch.

**`research-file` skill** (new, replacing the over-broad scope I gave `gedcomx`) — defines `research.json`. The sidecar schema, all its sections (questions, plans, log, sources, assertions, conflicts, hypotheses, timelines, proof_summaries), ownership rules for which skill writes which section, status enums, and cross-references into GedcomX entity ids.

The two skills coordinate at one boundary: the `research-file` skill specifies "this field references a GedcomX Person id" and the `gedcomx` skill specifies what those ids look like. Otherwise they're independent.

This split also makes the skills easier to write. `gedcomx` becomes a focused reference for a specific external format — GedcomX is well-documented, FamilySearch's subset is well-defined, and the skill is essentially "here's the subset we use, here are examples." `research-file` is where all your novel design decisions live, and isolating them makes it easier to iterate on the sidecar schema without touching the GedcomX skill.

**Updated tier 1**

1. `gedcomx` — `tree.gedcomx.json` format
2. `research-file` — `research.json` schema and ownership rules
3. `research-log` — append rules for the log section (could fold into `research-file`, but the append-only rule is strict enough that a dedicated skill keeps it from getting buried)
4. `record-extraction`
5. `assertion-classification`
6. `citation`

One judgment call: `research-log` could be a subsection of `research-file` rather than its own skill. I'd keep it separate because the "every tool call produces a log entry, empty results are explicitly negative" rule is exactly the kind of behavioral mandate that gets diluted when buried in a larger schema doc. A short, focused skill that Claude consults whenever it's about to call a tool is more likely to actually fire than a paragraph inside a longer skill.

Build order within tier 1: `gedcomx` and `research-file` in parallel (they coordinate at one well-defined boundary), then `research-log`, then `record-extraction` + `assertion-classification` together (they're tightly coupled and you'll want to iterate on both at once), then `citation` last.
