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

## 1. Identify the request

**Guard — wrong skill (decline):** If the user is asking to **find, search for, or pull new records** — even to *confirm*, *strengthen*, or *disprove* an identity ("find more records confirming X is the same person") — this is not a person-evidence task. Tell the user it belongs to **search-records**, which finds new records where this skill only evaluates records already gathered, and stop. Do not delegate.

Otherwise resolve, via `project_context`, which of two modes the request is and what it points at:

- **Linking mode (default)** — new `person_evidence` entries are wanted: unlinked assertions to persons, the roles in a multi-person record, a missing other-side link. Resolve the record, source or assertion ids the user means.
- **Review-only mode** — one or more *existing* `pe_` entries are to be evaluated ("is the confidence on pe_NNN appropriate?", "audit the person_evidence entries"). Resolve the `pe_` ids the user named.

The two modes are mutually exclusive for a single invocation. If the request names neither a record nor a `pe_` id, or matches more than one candidate, ask which before proceeding. Never fall back to "the only one left".

**Read nothing else, and judge nothing.** Do not query the assertions, the candidate persons, the existing links or their confidence, and do not form a view on whether a match holds. The match threshold policy, the candidate search, the profile and correlation work, stub creation and the warnings pass all belong to the agent, which declines and names the blocker when a precondition fails. A judgment made out here is a gate decided by the one participant that cannot see the evidence.

## 2. Delegate

Invoke `@plugin:person-evidence` with a delegation message carrying the mode, the ids resolved above, and `projectPath`.

- **Linking mode** — ask it to **evaluate the identity of the record's persons against the tree and record the outcome**, linking where the evidence supports it and creating stubs where nothing matches.
- **Review-only mode** — ask it to **assess whether the named links are still warranted at their recorded confidence and report**, and state that the mode is review-only.

**Do not ask it to "create the person_evidence entries" or to "link this person".** An instruction to link overrides the agent's own match threshold and it will write past a block it would otherwise have stopped on. Equally, do not ask it merely to "check whether you can link" — that invites a decline on evidence that in fact supports a link. Ask for the evaluation and let the body decide.

The agent owns every step from there: the request mode's own rules, unlinked-assertion discovery, candidate persons, the match threshold policy, the `person_evidence` writes, stub creation, link revisions, systematic record linking and the warnings pass.

One invocation per request.

## 3. Relay

Relay the agent's returned outcome as-is. Do not re-run the match threshold, re-argue a confidence, or re-state the correlation.

Then recommend the next step: links written → proof-conclusion, or record-extraction for the next record; a conflict where multiple candidates genuinely compete → conflict-resolution; a blocker the agent named → the skill it named.

## Re-invocation behavior

**Writes:** nothing directly. Every write is made by the `person-evidence` agent this skill delegates to — `person_evidence` entries (`pe_` links with their `confidence`, `rationale`, `superseded_by`) in `research.json`, and stub `persons` in `tree.gedcomx.json`. Nothing else.

**On repeat invocation for the same request:** delegate again, unchanged. The agent refines an existing link's `confidence`/`rationale` in place, or marks it `superseded_by` a correction; it never deletes one and never adds a second `pe_` for an assertion-person pair already linked.

**Safe to re-invoke.** A repeat run re-evaluates the same request; it never duplicates a link.

## Never

- Never write `research.json` or `tree.gedcomx.json` yourself — not a link, not a stub, not a confidence.
- Never decide, on the agent's behalf, that a precondition does not apply. If the agent declines and names a blocker, relay that — it is the correct outcome, not a failure to work around.
- Never clear a blocker the agent reports. An unclassified assertion is finished by record-extraction, a competing-candidate conflict by conflict-resolution; deciding one out here to unblock a link falsifies the record.
- Never roll a review-only request into linking work. Note the observation, then ask the user whether they want that work next.
- Never search for new records. That is search-records, and the guard above declines it.
