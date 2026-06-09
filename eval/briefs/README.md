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

## The 10 skills

"Where the work concentrates" tells each team where to expect the day to
go — toward **genealogical** judgment (record reading, citation craft,
domain correctness) or toward **test mechanics** (fixtures, JSON,
schema). Most skills are a mix.

| Skill | Where the work concentrates | Brief |
|-------|------------------------------|-------|
| `check-warnings` | Even split — intuitive rules + crafting impossible-data fixtures | [check-warnings.md](check-warnings.md) |
| `citation` | Genealogical — Evidence Explained craft; light mechanics | [citation.md](citation.md) |
| `convert-dates` | Genealogical — calendar rules; output-only (drift fixed) | [convert-dates.md](convert-dates.md) |
| `historical-context` | Genealogical knowledge; moderate fixtures (2 tools unfixtured) | [historical-context.md](historical-context.md) |
| `locality-guide` | Both heavy — records knowledge **and** the most fixtures (≈11 tools) | [locality-guide.md](locality-guide.md) |
| `search-external-sites` | Mechanics — URLs, capture, logging; largest SKILL.md | [search-external-sites.md](search-external-sites.md) |
| `search-familysearch-wiki` | Mechanics — fixtures, template, slug rules; needs a rubric | [search-familysearch-wiki.md](search-familysearch-wiki.md) |
| `search-wikipedia` | Mechanics — reference skill, already best-covered; needs a rubric | [search-wikipedia.md](search-wikipedia.md) |
| `translation` | Genealogical — paleography/translation; near-zero mechanics | [translation.md](translation.md) |
| `validate-schema` | Mechanics — map `validator.ts` checks to tests; needs a rubric | [validate-schema.md](validate-schema.md) |

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
