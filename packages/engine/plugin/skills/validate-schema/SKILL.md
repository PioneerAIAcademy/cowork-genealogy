---
name: validate-schema
model: claude-sonnet-4-6
allowed-tools:
  - validate_research_schema
description: Validates genealogy project files (research.json and
  tree.gedcomx.json) against the published schemas. Checks required fields,
  valid enum values, ID prefix conventions, and cross-reference integrity.
  Use when any skill writes to research.json or tree.gedcomx.json, when the
  user says "validate", "check the files", "is the schema valid?", or when
  another skill's validation-protocol instructions say to invoke this skill.
  Do NOT use for checking genealogical impossibilities (use check-warnings)
  or for checking GPS compliance (use proof-conclusion).
---

# Validate Schema

**Narration:** Read `researcher_profile.narration_guidance` from `research.json` and apply it as your narration style for this invocation. If absent, default to a one-line preamble per action.

Validates `research.json` and `tree.gedcomx.json` against the schemas
defined in `research-schema-spec.md` and `simplified-gedcomx-spec.md`.

This is a guardrail skill. It is not auto-triggered — every skill that
writes to either file must explicitly invoke this skill after writing
(per the validation-protocol embedded in each writing skill).

## What to do

1. Call the `validate_research_schema` MCP tool with the project directory path:
   ```
   validate_research_schema({ projectPath: "<absolute-path-to-project-directory>" })
   ```
   The tool validates both research.json and tree.gedcomx.json in the
   specified directory.

2. If the tool reports errors:
   - Show the errors to the user
   - Explain what each error means
   - Suggest fixes
   - Do NOT silently fix errors — the user should understand what's wrong

3. If the tool reports no errors:
   - Briefly confirm: "Both project files are valid."

4. If either file doesn't exist:
   - The tool reports which file is missing
   - If research.json is missing, suggest using init-project
   - If tree.gedcomx.json is missing, this is a serious error — both
     files should be created together by init-project

## What the validator checks

### research.json

- All 11 required top-level sections exist
- `project` is an object with required fields (id, objective, status, created, updated)
- `researcher_profile` (optional) — if present, validates `experience_level` enum, `subscriptions` array against the canonical site enum, and `narration_guidance` type
- All IDs use correct prefixes (q_, pl_, pli_, log_, src_, a_, pe_, c_, h_, t_, ps_)
- All enum values are valid (see the enum tables in the script)
- Required fields are present and non-null on every object
- `exhaustive_declaration` has correct structure
- `stop_criteria` is present when `exhaustive_declaration.declared` is true
- `log` entries have `external_site` object when `tool` is `external_site`
- Cross-references resolve (e.g., every `source_id` on an assertion
  references an existing source, every `question_id` on a plan
  references an existing question)

### tree.gedcomx.json

- Three top-level sections exist (persons, relationships, sources)
- Persons have required fields (id, gender, names with given/surname)
- Gender is a valid value
- Fact types are PascalCase
- ParentChild relationships use parent/child
- Couple relationships use person1/person2
- Source references have valid ref fields
- All source refs reference existing source IDs

### Cross-file checks

- Every `gedcomx_source_description_id` in research.json references
  an existing source in tree.gedcomx.json
- Every `person_id` in person_evidence references an existing person
  in tree.gedcomx.json
- Every person in `subject_person_ids` exists in tree.gedcomx.json
  (when not null)

## Re-invocation behavior

**Writes:** nothing. This skill calls the `validate_research_schema`
MCP tool, which reads `research.json` and `tree.gedcomx.json` and
reports errors — it does not modify either file.

**On repeat invocation:** safe to run as often as needed. Each call is a
fresh read against the workspace's current state.

**Do not duplicate:** N/A — no writes.
