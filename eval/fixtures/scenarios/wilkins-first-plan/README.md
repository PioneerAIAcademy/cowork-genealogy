# Scenario: wilkins-first-plan

A death question whose wording **presupposes a record type that cannot
answer it** — the state immediately after question-selection, no plan yet.

- **Subject:** Elijah Wilkins (`I1`), born c. 1814 Kentucky; last documented
  alive in the 1870 census (Muhlenberg County). No death information in the
  tree, no relationships, no sources.
- **q_001** (`in_progress`): "Using Kentucky death certificates, what were
  the date and place of death…?" — but the companion MCP fixtures (matching
  live FamilySearch) show statewide Kentucky death registration **began in
  1911**, decades after the subject's likely 1870s death, while county
  probate/estate records for the era are richly available.
- `plans` is empty: research-plan should create the first plan (Add-new
  path, validator tag `research-plan-new-plan-for-q-001`).

The point of this scenario: a record type named in the question is a lead,
not a scope limit. A sound plan searches the presupposed certificate
collections AND the other primary death record types — **probate/estate
records** above all (plus church burials/cemetery) — ideally noting the
era/coverage mismatch in a rationale. A certificates-only plan is the
failure this scenario guards against.

Derived from the `wilkins-death-kentucky` e2e fixture (issue #657), whose
two headless runs each grabbed a different same-named man's certificate
after planning only certificate collections.
