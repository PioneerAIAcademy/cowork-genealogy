# Deep-Dive Brief — `timeline`

> Per-skill map for the deep-dive. Generic process: [`eval/JUNIOR-WALKTHROUGH.md`](../JUNIOR-WALKTHROUGH.md).

**Effort profile:** Genealogical-judgment-heavy with a real test-mechanics catch: the headline feature — detecting a chronological **impossibility** and the geographic-feasibility check via `place_distance` — is never fired by the current tests. The day's dominant cost is crafting the impossibility/two-lives scenarios and the matching `place_search`/`place_distance` fixtures.
**Files:** SKILL.md (418 lines) · references ×3 (361 lines) · tests ×3 · rubric ✓ (27 lines).

## What this skill does
GPS Step 3 (chronological analysis). It builds candidate timelines from assertions and writes them into `research.json`, surfaces gaps and chronological impossibilities, and supports **identity-testing** — checking whether a set of records coheres into one life or splits into two. It uses `place_search`/`place_distance` for geographic-feasibility checks (could one person be in both places given the dates?). Rejected assertions (e.g. `a_012`) are excluded from the timeline. Calls `validate_research_schema` after writing.

## Where everything lives
- `plugin/skills/timeline/SKILL.md`
- `plugin/skills/timeline/references/places-guidance.md` (81 lines)
- `plugin/skills/timeline/references/timeline-analysis-guide.md` (266 lines)
- `plugin/skills/timeline/references/validation-protocol.md` (14 lines)
- `eval/tests/unit/timeline/` — `build-patrick-timeline.json`, `timeline-with-multi-conflict.json`, `negative-conflict-resolution.json`, `rubric.md`
- Scenarios used: `mid-research-flynn`, `flynn-multi-conflict`, `flynn-with-birthplace-conflict`.

## Current tests (3)
| id | covers | type | tools/fixtures |
|----|--------|------|----------------|
| ut_timeline_001 | Build Patrick Flynn's timeline; gap detection; rejected `a_012` excluded; **no impossibilities expected** | positive | 6 place-search Ireland/Schuylkill variants |
| ut_timeline_002 | Timeline with unresolved conflicts; show competing possibilities; **no impossibilities expected** | positive | 9 place-search Ireland/Schuylkill/Pennsylvania variants |
| ut_timeline_003 | "Resolve this birthplace conflict" → routes to `conflict-resolution` | negative | — |

> Coverage shape is inverted: BOTH positives are tagged "no-impossibilities-expected," so the skill's signature output — a detected chronological impossibility, and a `place_distance`-driven "one person can't be in two places at once" — is never exercised. The identity-testing "one life vs. two lives" use case has no dedicated test, and `place_distance` may have no fixture at all (both positives only feed `place_search`).

## Gaps — new tests to add
**Positive (fire the features the current tests deliberately avoid):**
- **Chronological impossibility** — a scenario where two assertions are temporally incompatible (e.g. an event dated before the person's birth, or two simultaneous events too far apart). Require the timeline to flag the impossibility, not silently absorb it. This is the skill's headline feature and is untested.
- **Geographic-feasibility failure via `place_distance`** — two place-bound events whose dates are too close for the travel distance; require a `place_distance` call and an infeasibility conclusion. This is the only path that exercises `place_distance` — likely no fixture exists yet.
- **Identity-testing: two lives** — records that do NOT cohere into one life; require the timeline to conclude "these fit two people," distinct from the gap/competing-possibility framing in `_001`/`_002`.
- **Identity-testing: one life confirmed** — the positive mirror: scattered records that DO cohere; require an explicit one-person conclusion.

**Negative (boundaries from the description):**
- → `conflict-resolution`: "Resolve this birthplace conflict" — **covered** (`ut_timeline_003`).
- → `person-evidence`: "Link these census events to the right person in the tree."
- → `proof-conclusion`: "Write up the conclusion now that the timeline is built."

## ⚠️ Known issues
- **Impossibility detection is never fired** — both positives carry `no-impossibilities-expected`. The single most important behavior of the skill is ungraded.
- **`place_distance` has no exercising test** — both positives only mock `place_search`. Check `tools/coverage` (the warn-only `check_tool_coverage.py`) likely flags this: an `allowed-tools` entry with no fixture in the corpus.
- **Identity-testing (one life vs. two)** is described in `timeline-analysis-guide.md` (266 lines) but has no dedicated test.
- Two of three named neighbors (`person-evidence`, `proof-conclusion`) have **no negative test**.

## Fixture work
Net-new fixtures are the bulk of the day. The two existing positives already supply `place_search` Ireland/Schuylkill/Pennsylvania variants — reusable for the new scenarios. The impossibility and geographic tests need **new project-state scenarios** (assertions with incompatible dates / distant simultaneous places) plus, critically, a **`place_distance` fixture** with a distance large enough to make the travel infeasible — the gap that closes the tool-coverage warning. Identity-testing tests are mostly scenario work (which records are present) and can reuse existing place fixtures. Neighbor negatives need no fixtures.

## Definition of done
Add the `place_distance` fixture + impossibility scenario → add the impossibility positive, the geographic-infeasibility positive, and the two identity-testing positives (one-life / two-lives) → add the `person-evidence` and `proof-conclusion` negatives → rubric polish so impossibility and feasibility are graded → full harness pass + CRUD review + PR.
