# Skill Deep-Dive Briefs

These are the per-skill maps for the **skill deep-dive** — one team
(1 genealogist + 1 developer) per skill, hardening tests and docs for
one day.

**Read the generic process first:** [`eval/JUNIOR-WALKTHROUGH.md`](../JUNIOR-WALKTHROUGH.md)
(edit skill → run harness → review judge scores in the CRUD UI → PR) and
[`eval/SENIOR-WALKTHROUGH.md`](../SENIOR-WALKTHROUGH.md). Each brief here
is the *map* for one skill: what it does, what's already tested, what's
missing, the neighbor skills to write negative tests against, and how
much fixture work the gaps imply.

## The 26 skills

"Where the work concentrates" tells each team where to expect the day to
go — toward **genealogical** judgment (record reading, citation craft,
domain correctness) or toward **test mechanics** (fixtures, JSON,
schema). Most skills are a mix.

The briefs are grouped by GPS phase so a team can pick up a coherent slice.
The first batch (the original 10) is the most polished; the rest were
mapped in a second pass against the same skill + test state.

### Project lifecycle

| Skill | Where the work concentrates | Brief |
|-------|------------------------------|-------|
| `init-project` | Both — mostly rubric work (11-line rubric for a 5-job skill) + one missing `place_search` fixture; also folds in the known-holdings survey feature change (schema landed, SKILL.md + ~1 test remain) | [init-project.md](init-project.md) |
| `project-status` | Mechanics — no MCP tools, but the headline broken-FK detection needs a crafted dangling-reference scenario | [project-status.md](project-status.md) |
| `research` | **Greenfield** — no tests/rubric yet; router, so per-routing-row state tests + a net-new Routing Correctness dimension | [research.md](research.md) |

### GPS Step 1 — Reasonably exhaustive research (plan & execute)

| Skill | Where the work concentrates | Brief |
|-------|------------------------------|-------|
| `question-selection` | Genealogical — the 7-level priority ladder + "finish what's open"; fixture-light | [question-selection.md](question-selection.md) |
| `research-plan` | **Fixture-heavy** — 9 tools, 5 of them with no fixture anywhere; survey-call mechanics gate the day | [research-plan.md](research-plan.md) |
| `research-exhaustiveness` | Genealogical — thinnest coverage (2 tests); needs the affirmative `declared` positive | [research-exhaustiveness.md](research-exhaustiveness.md) |
| `search-records` | Both, mechanics dominate — `record_search`/`record_read`/`source_attachments` fixtures + match-triage | [search-records.md](search-records.md) |
| `search-full-text` | Both, mechanics dominate — `fulltext_search` Lucene syntax + the FAN lens need careful fixtures | [search-full-text.md](search-full-text.md) |
| `search-external-sites` | Mechanics — URLs, capture, logging; largest SKILL.md | [search-external-sites.md](search-external-sites.md) |
| `locality-guide` | Both heavy — records knowledge **and** the most fixtures (≈11 tools) | [locality-guide.md](locality-guide.md) |
| `locality-guide` (`volume_search`) | Change-scoped — wire the `volume_search` tool into the skill; one new fixture | [locality-guide2.md](locality-guide2.md) |
| `search-familysearch-wiki` | Mechanics — fixtures, template, slug rules; needs a rubric | [search-familysearch-wiki.md](search-familysearch-wiki.md) |
| `search-wikipedia` | Mechanics — reference skill, already best-covered; needs a rubric | [search-wikipedia.md](search-wikipedia.md) |

### GPS Steps 2–3 — Citation, analysis & correlation

| Skill | Where the work concentrates | Brief |
|-------|------------------------------|-------|
| `record-extraction` | Both, mechanics-leaning — largest SKILL.md (619 lines); fixturing record-type variety dominates | [record-extraction.md](record-extraction.md) |
| `citation` | Genealogical — Evidence Explained craft; light mechanics | [citation.md](citation.md) |
| `assertion-classification` | Genealogical — three-layer taxonomy craft; fixture-light (scenarios, not mocks) | [assertion-classification.md](assertion-classification.md) |
| `person-evidence` | Genealogical — identity-resolution reasoning; best-covered analysis skill (7 tests) | [person-evidence.md](person-evidence.md) |
| `timeline` | Genealogical, with a catch — impossibility detection + `place_distance` feasibility are never fired | [timeline.md](timeline.md) |
| `historical-context` | Genealogical knowledge; moderate fixtures (2 tools unfixtured) | [historical-context.md](historical-context.md) |
| `convert-dates` | Genealogical — calendar rules; output-only (drift fixed) | [convert-dates.md](convert-dates.md) |
| `translation` | Genealogical — paleography/translation; near-zero mechanics | [translation.md](translation.md) |

### GPS Steps 3–5 — Resolution, hypotheses & conclusion

| Skill | Where the work concentrates | Brief |
|-------|------------------------------|-------|
| `conflict-resolution` | Mostly genealogical, with the one real place-fixture surface (`place_search`/`place_distance`) | [conflict-resolution.md](conflict-resolution.md) |
| `hypothesis-tracking` | Genealogical — hypothesis lifecycle craft; fixture-light | [hypothesis-tracking.md](hypothesis-tracking.md) |
| `check-warnings` | Even split — intuitive rules + crafting impossible-data fixtures | [check-warnings.md](check-warnings.md) |
| `proof-conclusion` | Genealogical — proof-writing craft; untested lower tiers + tree write-back; fixture-light | [proof-conclusion.md](proof-conclusion.md) |
| `tree-edit` | Both — the headline person-merge and every real mutating edit are untested; thin rubric | [tree-edit.md](tree-edit.md) |
| `validate-schema` | Mechanics — map `validator.ts` checks to tests; needs a rubric | [validate-schema.md](validate-schema.md) |

> **Not covered by a brief: the two e2e-benchmark skills.** `author-e2e-fixture`
> and `interpret-e2e-result` are tooling for the genealogist+developer benchmark
> teams — they operate on the e2e test corpus (`eval/tests/e2e/`, run logs), not
> on a researcher's project, and a deep-dive brief (built around hardening a
> skill's unit-test coverage against neighbor skills and MCP fixtures) is the wrong
> shape for them. They live in `.claude/skills/` (repo-local dev tooling, not the
> shipped plugin). Their home is the e2e docs: [`docs/e2e-testing-guide.md`](../../docs/e2e-testing-guide.md)
> and the spec [`docs/specs/e2e-test-spec.md`](../../docs/specs/e2e-test-spec.md);
> an implementation plan for fleshing them out lives at
> [`docs/plan/e2e-skills.md`](../../docs/plan/e2e-skills.md).

## Cross-cutting findings (worth a quick all-hands)

These surfaced across multiple skills during prep — fixing them is
higher-leverage than any single new test:

- **`convert-dates` drift — fixed 2026-06-05.** Its SKILL.md called an
  unimplemented `convert_calendar` tool and described writing invalid
  `date_*` fields, contradicting its own output-only frontmatter. It's
  now coherently output-only (no tool, no writes). See
  [convert-dates.md](convert-dates.md). *(Kept here as a record; no
  longer a blocker.)*
- **Three skills have no `rubric.md`:** `search-familysearch-wiki`, `search-wikipedia`,
  `validate-schema`. Without it the judge falls back to base dimensions
  only (Correctness, Completeness, Tool Arguments) — no skill-specific
  grading. Authoring these is a clean task.
- **Two skills have inverted coverage:** `check-warnings` and
  `validate-schema` only ever test the *quiet* path — no existing test
  fires a warning or a validation error, so the skills' headline behavior
  is untested. Both need crafted-broken scenario fixtures.
- **`validation-protocol.md` slug drift.** Several skills' reference docs
  say to invoke `validate-schema` / `check-warnings` by *slug*, but the
  actual MCP tool is `validate_research_schema`. Harmless to the model,
  confusing to a human reader — worth normalizing.
- **Stale re-invocation / frontmatter notes.** `check-warnings`'s
  re-invocation section describes *validate-schema* behavior (copy-paste
  error); `historical-context`'s YAML description has a mid-sentence line
  break. Quick fixes, good first-PR material.

## Tight neighbor cluster — coordinate negative tests

Four skills route into each other and share a boundary; their teams
should compare near-miss prompts so the negative tests stay consistent:

```
search-wikipedia  ←→  search-familysearch-wiki  ←→  locality-guide  ←→  historical-context
   (general Wikipedia)  (FS Research Wiki)  (records-availability)  (narrative context)
```

A "what records exist for X" prompt belongs to `locality-guide`; a
"how do I research X" prompt to `search-familysearch-wiki`; a "why did X happen /
what did this term mean" prompt to `historical-context`; an explicit
"look up X on Wikipedia" to `search-wikipedia`. Each team should own the
negative test that routes *away* from its skill toward the others.

## Definition of done (every team)

1. Read SKILL.md + all references; fire the skill 5–6 ways via the harness.
2. Fix any **Known issues** called out in your brief first.
3. Audit existing test JSONs — stale `judge_context`, wrong fixtures, thin coverage.
4. Add **positive** tests for the gaps your brief lists (aim 3–5 new).
5. Add **negative** tests for each neighbor in the "Do NOT use" boundary.
6. Author/refresh `rubric.md` if missing or thin.
7. Tighten SKILL.md trigger phrases and reference docs where the brief flags it.
8. Run the full `--skill` harness pass, review every dimension in the CRUD UI, open a PR.

> Briefs generated 2026-06-05 from the then-current skill + test state.
> If a file count or test list here disagrees with the repo, trust the repo.
