# Deep-Dive Brief — `check-warnings`

> Per-skill map for the deep-dive. Generic process: [`eval/JUNIOR-WALKTHROUGH.md`](../JUNIOR-WALKTHROUGH.md).

**Effort profile:** Even split — the warning rules are intuitive genealogy, and the work is crafting deliberately-impossible scenario fixtures to fire them.
**Files:** SKILL.md (207 lines) · references ×3 (394 lines) · tests ×3 · rubric ✓ (28 lines).

## What this skill does
A read-only guardrail that scans a person's assembled facts (birth, death, marriage, children's births, parent deaths, locations) for logical impossibilities and biological/temporal anomalies — married before 12, died after 120, child born after a parent's death, impossible dates, siblings born too close, jurisdiction didn't exist yet. It reports by severity (Critical/High/Medium/Low) and **never modifies files**. Its decision framework has three tiers: **Fundamental** (physical law → always warn), **Valid** (biological/social norm → warn with caveats), **Unsound** (unproven premise → never warn). Calls no MCP tools.

## Where everything lives
- `plugin/skills/check-warnings/SKILL.md`
- `references/assumption-categories.md` (96 — the warn/don't-warn decision rule), `warning-checks.md` (154 — all 17 checks + thresholds), `warnings-as-identity-signals.md` (144 — escalation logic)
- `eval/tests/unit/check-warnings/` — `check-flynn-assertions.json`, `check-resolved-project.json`, `negative-project-status.json`, `rubric.md`
- Scenarios: `mid-research-flynn`, `flynn-resolved` (both exist, both internally consistent by design)

## Current tests (3)
| id | covers | type |
|----|--------|------|
| ut_…_001 | Clean mid-research data → **no** warnings (false-positive avoidance) | positive |
| ut_…_002 | Resolved project → no fabricated warnings post-conclusion | positive |
| ut_…_003 | "Where is this project at?" → routes to `project-status` | negative |

> **Coverage is inverted:** every current test checks that the skill stays *quiet*. **Not one test actually fires a warning.** The detection logic — the whole point of the skill — is untested.

## Gaps — new tests to add (each needs a crafted-impossible scenario)
- **Critical: death before birth** — inverted dates.
- **High: child born after parent's death** — the skill's *own example* (Patrick born ~1845 after Thomas's claimed 1840 death), yet no test.
- **High: marriage before 12 / death after 120** — 130-year lifespan, or marriage 8 years after birth.
- **High: jurisdiction didn't exist** — birth recorded in "West Virginia" before 1863 (location-aware, not date arithmetic).
- **Medium: siblings born too close** — the 9-month sibling-gap check (compares two children of one mother).
- **Clustered/multiple warnings** — two High anomalies on one person → exercises the identity-confusion escalation table (1 High+Medium → timeline review; 2+ High → recommend identity split). The severity & actionability rubric dimensions only bite when something fires.

**Negative (boundaries):**
- → `validate-schema`: "Check that all required fields are filled in and research.json is well-formed."
- → `conflict-resolution`: "One census says Ireland, the death cert says County Cork — flag that mismatch." (source-vs-source disagreement, not a single-person impossibility).

## ⚠️ Known issues
- **Re-invocation section is a copy-paste error** — it describes "orphan IDs, missing required fields, schema violations" (that's *validate-schema*), contradicting the skill's own Important-rules and description.
- **Rubric example mismatch** — rubric name-checks "marriage at age 5, 150-year lifespan" but the spec thresholds are 12 and 120; align the rubric with `warning-checks.md`.
- **Thresholds only live in the reference** — SKILL.md doesn't summarize the key numbers inline, so a run that skips loading `warning-checks.md` has no fallback. Consider inlining the critical thresholds.
- **Approximate-date margin** ("combined uncertainty") is underspecified → the High-warning suppression for fuzzy dates is untestable without a concrete rule.

## Fixture work — the dominant cost
The Flynn scenarios are clean by design and can't be corrupted in place. Every detection test needs a **net-new scenario** with purpose-built impossible data (inverted dates, parent-death/child-birth, extreme lifespan, anachronistic jurisdiction, 6-month siblings), plus one combining two anomalies for the clustered test. Negative routing tests can reuse existing scenarios (content is irrelevant to routing).

## Definition of done
Fix the re-invocation/rubric errors → build ≥4 crafted-impossible scenarios + their detection tests (cover Critical, High, Medium, and a cluster) → add the 2 neighbor negatives → align rubric thresholds → full harness pass + CRUD review + PR.
