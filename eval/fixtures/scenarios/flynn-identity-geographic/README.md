# flynn-identity-geographic

Patrick Flynn parentage research with **three** unresolved conflicts. A copy of `flynn-multi-conflict` plus a third conflict (`c_003`) purpose-built to exercise the skill's geographic-impossibility / travel-feasibility reasoning (`place_search` → `place_distance`).

- **Conflicts:**
  - `c_001` — birthplace (Ireland vs Pennsylvania), fact conflict, status: `unresolved`
  - `c_002` — identity (which Patrick Flynn in 1850 Schuylkill County is the subject?), identity conflict, status: `unresolved`
  - `c_003` — **identity (geographic):** an 1870 U.S. Census record (`src_005`, assertion `a_014`) places a Patrick Flynn in **Allegheny County** (~320 km west of the subject's documented **Schuylkill County** residences). Is this the subject (who would have moved west) or a same-named individual? status: `unresolved`
- **All conflicts have:** null `preferred_assertion_id`, `independence_analysis`, `weighing_analysis`, `resolution_rationale`. All list `q_001` in `blocks_question_ids`.
- **Supporting entries added for `c_003`:** `src_005` (1870 Allegheny census), `a_014` (residence, Allegheny County, 1870), `pe_007` (speculative person_evidence link → I1), `log_006` (the 1870 search).

## Used by

- `conflict-resolution` **geographic-impossibility** test — resolving `c_003` requires resolving each event's location to a `standardPlace` (`place_search`) and calling `place_distance` to quantify the Schuylkill↔Allegheny gap (~320 km), then judging move feasibility for the era rather than asserting "distant." Requires the `place-search-allegheny`, `place-search-schuylkill-county`, and `place-distance-schuylkill-allegheny` / `place-distance-allegheny-schuylkill` fixtures.
- Also usable for prioritization / identity tests (three simultaneous conflicts, two of them identity).

## Conflict shapes present

- **Fact conflict (c_001):** ≥2 competing assertions, named `disputed_attribute`, null `identity_question`.
- **Identity conflict (c_002, c_003):** ≥1 competing assertion, null `disputed_attribute`, populated `identity_question`. `c_003` adds a geographic dimension — the competing assertion is a residence whose location is far from the subject's known residences.
