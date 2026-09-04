---
name: person-evidence
description: >-
  Links assertions to GedcomX persons — identity resolution. Evaluates whether
  a record's person matches a tree person, creates person_evidence entries with
  confidence and rationale, and creates stub persons when none match. Also
  reviews/audits existing person_evidence links, and builds out a record's
  household skeleton in the tree from extracted assertions. GPS Step 3 —
  Analysis and Correlation. Use when the user says "is this the same person?",
  "link this to [person]", "link all roles in this record", "build out this
  household in the tree", "audit the person_evidence entries", after assertions
  are extracted and need person assignment, or evaluate whether two records are
  the same individual using records in hand — never searching new ones. Do NOT
  use to find or gather more records (use search-records); extract assertions
  (use record-extraction); resolve a conflict where multiple candidates compete
  (use conflict-resolution); or merge confirmed-identical persons (use tree-edit
  after proof-conclusion).
allowed-tools:
  - project_context
---

# Person Evidence

**Narration:** Read `researcher_profile.narration_guidance` from `research.json` and apply it as your narration style for this invocation. If absent, default to a one-line preamble per action.

## 1. Resolve the request into the agent's arguments

Via `project_context`, resolve two things from the user's words:

- **Mode.** `linking` when new `person_evidence` entries are wanted — unlinked assertions, the roles in a multi-person record, a missing other-side link. `review` when existing `pe_` entries are to be evaluated ("is the confidence on pe_NNN appropriate?", "audit the person_evidence entries").
- **Target.** The record, source or assertion ids for `linking`; the `pe_` ids for `review`.

If the request names neither a record nor a `pe_` id, or matches more than one candidate, ask which before proceeding.

## 2. Delegate

Invoke `@plugin:person-evidence` with a delegation message carrying the mode, the ids resolved above, and `projectPath`, and asking it to **evaluate the identity of the record's persons against the tree and record the outcome** — or, in `review` mode, to **assess whether the named links are still warranted at their recorded confidence and report**.

One invocation per request.

## 3. Relay

Relay the agent's returned outcome as-is.

Then recommend the next step: links written → proof-conclusion, or record-extraction for the next record; a conflict where multiple candidates genuinely compete → conflict-resolution; a blocker the agent named → the skill it named.

## Re-invocation behavior

**Writes:** nothing. Every write is made by the `person-evidence` agent, whose own body states what it writes and how a repeat run refines it.

**Safe to re-invoke.** Delegating again re-evaluates the same request; it never duplicates a link.
