---
name: validate-schema
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

A read-only guardrail. It runs the schema validator over `research.json`
and `tree.gedcomx.json` and reports the result. It is also user-invokable
("validate", "check the files") — it is not auto-triggered.

## What to do

Call `validate_research_schema` with the project directory path. The tool
validates both files and reports the actual errors; your job is to read and
relay that result.

- **On errors:** surface each specific error (which object, field, and value)
  and explain it in plain terms, then suggest a concrete fix for each — e.g.
  for a bad enum, name the valid values; for a dangling/cross-file reference,
  point it at an existing target or add the missing one. Suggest a fix that
  clears the error without creating a new one (don't dangle a reference or drop
  a required field). If no clean fix is obvious, describe the problem and let
  the user decide. Don't guess required fields — a research.json source and a
  tree.gedcomx.json source are different shapes.
- **Read-only:** report only. Never edit a file to fix an error, and don't
  offer to apply the fix — the user fixes their own files.
- **On a clean project:** confirm the pass specifically — name both
  `research.json` and `tree.gedcomx.json` and note what validated cleanly
  (required fields, enum values, ID-prefix conventions, and cross-file
  references), so the user sees what was checked rather than a bare "valid."
- **On a missing file:** the tool reports which one. If `research.json` is
  missing, point the user to init-project (both files are created together).

## Scope

Schema only. Route logical impossibilities (birth after death, etc.) to
**check-warnings**, and proof/GPS-quality questions to **proof-conclusion** —
don't answer them with a schema-validation result.

## Re-invocation behavior

This skill writes no project state — it only reads `research.json` and
`tree.gedcomx.json` and reports. Safe to re-invoke as often as needed; each
call is a fresh read of the current files.
