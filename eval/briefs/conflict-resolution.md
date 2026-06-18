# Deep-Dive Brief — `conflict-resolution`

> Per-skill map for the deep-dive. Generic process: [`eval/JUNIOR-WALKTHROUGH.md`](../JUNIOR-WALKTHROUGH.md).

**Effort profile:** Mostly genealogical judgment — source-independence analysis, the GPS preponderance hierarchy, four-part defensible rationales. NOT purely judgment, though: it calls `place_search` / `place_distance` for geographic-impossibility reasoning, so this is the one GPS-analysis skill in the batch with a real (currently empty) MCP-fixture surface. The dominant cost is crafting multi-conflict scenarios; the secondary cost is the first place-distance fixture.
**Files:** SKILL.md (350 lines) · references ×5 (512 lines) · tests ×4 · rubric ✓ (27 lines).

## What this skill does
GPS Step 4 (Resolution of Conflicting Evidence). Handles **both** fact-level conflicts (`conflict_type: "fact"` + `disputed_attribute` — e.g. three birthplaces) and identity-level conflicts (`conflict_type: "identity"` + `identity_question` — is the 1870 census record our subject or a same-named neighbor). For each it writes `independence_analysis` (Standard 46) as a step **separate** from `weighing_analysis` (the seven factors, Standard 47–48), then either resolves (four-part rationale, `status: "resolved"`) or honestly defers. Key invariants: a conflict goes `resolved` **only** when `independence_analysis`, `weighing_analysis`, `preferred_assertion_id`, and `resolution_rationale` are all non-null on the same write; it **never modifies `proof_summaries`** (that's proof-conclusion) and **never merges persons** to settle an identity conflict. For location-based identity reasoning it resolves each event to a `standardPlace` and calls `place_distance` to quantify travel impossibility. Calls `validate_research_schema` after writing.

## Where everything lives
- `plugin/skills/conflict-resolution/SKILL.md`
- references: `weighing-evidence.md` (121) — seven factors, four rationales, independence checklist · `historical-contradictions.md` (152) — calendar/boundary/term-meaning patterns · `resolution-writing.md` (144) — four-part structure + informant protocol · `places-guidance.md` (81) — `standardPlace` resolution · `validation-protocol.md` (14)
- `eval/tests/unit/conflict-resolution/` — `birthplace-ireland-vs-pennsylvania.json`, `multi-conflict-prioritization.json`, `identity-conflict-analysis.json`, `negative-search-request.json`, `rubric.md`
- Scenarios used: `flynn-with-birthplace-conflict`, `flynn-multi-conflict`

## Current tests (4)
| id | covers | type |
|----|--------|------|
| ut_conflict_resolution_001 | Resolve a 3-source birthplace conflict via informant proximity + temporal distance | positive |
| ut_conflict_resolution_002 | Prioritize among multiple unresolved conflicts (identity-vs-fact) | positive |
| ut_conflict_resolution_003 | Analyze identity conflict c_002 and either resolve or flag what's needed | positive |
| ut_conflict_resolution_004 | "Search for more 1860 census records…" → routes to `search-records` | negative |

> Both conflict types are exercised (good), and all three positives are Flynn. But the **`place_search` / `place_distance` path is not fixtured or tested at all** — no test drives the geographic "could one person be in both places" reasoning the SKILL specs in detail. Per the tool-coverage check, declaring these tools with no fixture is a warn.

## Gaps — new tests to add
**Positive (the place path and the resolved/deferred boundary are thin):**
- **Geographic-impossibility identity resolution** — two same-named events far apart in an era when the travel was infeasible; must call `place_distance` and cite the km figure, not a vague "distant." Needs the first place fixtures.
- **Defer when preponderance is unclear (Standard 49)** — leave `status: "unresolved"`, state exactly what evidence would decide it; the honest-unresolved path has no positive test.
- **Half-filled "resolved" must NOT happen** — drive a case where weighing is done but `preferred_assertion_id` is absent; correct behavior keeps it unresolved.
- **Three-way fact conflict** — resolution must explain why EACH non-preferred assertion loses (rubric "Resolution completeness"), not just why the winner wins.
- **Historical-contradiction explanation** — a conflict whose part-4 rationale needs a boundary-change or calendar reason from `historical-contradictions.md`.

**Negative (boundaries from the description):**
- → `search-records`: "Search for more 1860 census records…" — **already covered** by ut_conflict_resolution_004.
- → `person-evidence`: "Audit the person_evidence links and recalibrate their confidence." — the subtle boundary the description calls out, **no negative test yet** — highest-value addition.
- → `assertion-classification`: "Classify whether this informant is primary or secondary." (no negative test yet).
- → `timeline`: "Build a timeline of Patrick's events." (no negative test yet).
- → `proof-conclusion`: "Write the proof conclusion for the parentage question." (no negative test yet).

## ⚠️ Known issues
- **`Re-invocation behavior` describes a wrong id prefix.** It says conflicts use `cnf_` ids, but the Steps, the JSON examples, and `multi-conflict`'s `c_002` all use `c_`. Reconcile before grading or the never-duplicate rule reads against a phantom prefix.
- **Tool-coverage warn** — `place_search` and `place_distance` are declared in `allowed-tools` with zero fixtures in the corpus; the geographic positive above clears it.

## Fixture work
Scenarios `flynn-with-birthplace-conflict` and `flynn-multi-conflict` cover the three current positives and most proposed fact/identity/defer tests. Net-new: the **first `place_search` + `place_distance` MCP fixtures** in `eval/fixtures/mcp/` for the geographic-impossibility test (resolve two place names, return a km distance), and a scenario whose two same-named events sit far enough apart to make the argument bite. The person-evidence negative needs only a scenario with existing `person_evidence` links to bait the audit phrasing.

## Definition of done
Fix the id-prefix drift → add the place-distance positive (with its new MCP fixtures) + the defer / half-resolved / three-way / historical positives → add the four missing neighbor negatives (person-evidence first) → rubric/SKILL polish → full harness pass + CRUD review + PR.
