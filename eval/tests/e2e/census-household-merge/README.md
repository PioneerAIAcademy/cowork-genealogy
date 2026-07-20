# Census-household merge (match → coherence gate → merge)

> **Status: SKELETON — not yet captured.** This directory intentionally has
> **no `fixture.json` / `expected-findings.json`**, so it is invisible to
> `make e2e-run` (needs `fixture.json`) and `make e2e-validate --all` (needs
> `expected-findings.json`). It documents the happy-path e2e fixture for the
> match + merge workflow (`docs/specs/match-merge-workflow-spec.md` §13) and
> exactly how to capture it. Capturing requires live FamilySearch auth, which
> the implementing agent did not have — see "How to capture" below.

## What this fixture proves

The full match + merge chain against live FamilySearch, end to end:

1. `search-records` / `record-extraction` find and extract a **census record**
   that enumerates a household (head + spouse + children).
2. `person-evidence` assembles the matching mob (focus + parents + spouses +
   children + **siblings**, capped at 40), scores each persona with
   `same_person`, runs the cross-person consistency check, and **always-pairs**
   every persona — matching the head/spouse/known-children to the tree and
   **stubbing the one child who is in the census but missing from the tree**.
3. `person-evidence` runs the **coherence gate** (`merge_warnings`) on the
   proposed merges, sees it clean, confirms at the plan level, and **materializes
   each linked persona** with `materialize_facts` (create-or-enrich mints the
   missing child *with* her facts; census facts land on the head/spouse/known
   children, each carrying a provenance ref). `proof-conclusion` then concludes.
4. Post-materialization: the missing child is added **once**, and the
   head/spouse/known children gain the census residence facts.

This is the **happy** path (gate clean). The gate's *blocking* behavior is
already covered deterministically by the unit + integration tests
(`tests/tools/merge-warnings.test.ts`,
`tests/integration/match-merge-workflow.test.ts` — planted impossibility +
`hasSameCensus`); a planted contradiction is unreliable against live FS data
(`eval/README.md` §"E2e tests"), so it is deliberately NOT an e2e.

## Choosing a subject (constraints)

- **Deceased** subject and household (FamilySearch ToS — same rule as
  `kenneth-quass-death`).
- A **well-anchored** person: parents, spouse, several children, and at least
  one **census** already attached, so the agent has a strong search start.
- A census in which **one household member (ideally a child) is present in the
  record but absent from the starting tree** — that missing person is the
  primary "finding" the agent must recover (mirrors Mary in spec §3).
- Ideally a child whose census given name is a **nickname/variant** of the tree
  name (e.g. "Bill" ↔ "William") so the match exercises nickname identity.

## How to capture (needs `make e2e-login`)

Preferred — use the authoring skill against a real PID:

```
# 1. Authenticate (≈24h token, shared by all e2e runs)
make e2e-login

# 2. From a working project, run the author-e2e-fixture skill with the PID of
#    the well-anchored census-household subject. It reads the tree via
#    person_read, strips the focused subset (the missing child + the census
#    facts on the others) as the "answer", and writes the five fixture files.
#    Drop them into THIS directory (eval/tests/e2e/census-household-merge/).
```

Then lint and run:

```
make e2e-validate TEST=census-household-merge   # stripping linter
make e2e-run      TEST=census-household-merge   # live FS, ~20–60 min, $3–10
make e2e-validate                                # (omit TEST) all fixtures
```

## Files to produce (5, mirroring `kenneth-quass-death/`)

- `fixture.json` — `id` = `census-household-merge`, `source_pid`,
  `researcher_question` (e.g. "Who were the members of <head>'s household in the
  <year> census, and is any child missing from the tree?"), `tags`
  (`question_type: household_reconstruction`, era, geography), `model`,
  `difficulty`, `notes`.
- `starting-research.json` — subject project state, passing
  `validate_research_schema`.
- `starting-tree.gedcomx.json` — the tree **with the missing child removed** and
  the census facts/sources stripped from the head/spouse/known children. Must
  validate.
- `expected-findings.json` — the stripped answer: the missing child (name +
  approximate birth), and the census residence facts the survivors should
  regain. The `e2e-validate` linter checks these are genuinely absent from the
  starting tree.
- `provided-documents/` — only if the census capture isn't reachable by the FS
  tools (bundle the image/transcript), as `kenneth-quass-death` does for its
  Find A Grave / Ancestry captures.

See `eval/tests/e2e/kenneth-quass-death/` for a complete worked example of all
five files and the normalization notes.
