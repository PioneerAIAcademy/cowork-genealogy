# Shorten: conflict-resolution

**Bucket:** A (dead-mechanics removal) — but with a large protected craft core
**Primary owner:** both (developer strips the JSON blocks and the duplicated
tool-mechanics/validate narration; **genealogist must sign off** on the
weighing/independence/informant judgment that stays — this is real GPS craft)
**Current size:** 487 lines → **Target:** ~290–320 lines (~37% reduction)
**Tool migration:** **done** — calls `research_append`
(`op: "append"` to create, `op: "update"` to resolve), `convert_calendar` for
the calendar-artifact offset, and `place_search` / `place_search_all` /
`place_distance` for identity-conflict travel feasibility.
**Still needed as a skill?** **Yes, unambiguously** — the tool stores the
conflict and enforces shape invariants, but it does *none* of the GPS work:
independence analysis, the seven-factor weighing, informant analysis, the
four-part rationale, or the resolve-vs-defer judgment. That's the entire skill,
and all three rubric dims grade it.

## TL;DR
The migration is complete — don't change *what* it calls. Cut the three verbose
`research_append({ ... })` JSON blocks (the schema documents them), the
re-derived "the tool enforces resolved-completeness + `preferred ∈ competing`"
narration that's stated ~3 times (tool owns it), the by-hand calendar arithmetic
(now `convert_calendar`, already migrated — verify no stray "10/11/12/13 days"
math remains), and the boilerplate Re-invocation section. **Keep** the
independence/weighing/informant/four-part-rationale judgment, the calendar-
*recognition* note, the travel-distance method, `references/historical-
contradictions.md`, and every routing boundary — the negative tests fail loudly
if you cut routing.

## Why this skill is shortenable
`research_append` now assigns the `c_` id, validates the whole project, and on
`op:"update"` enforces the resolved-completeness invariant (all four resolved
fields non-null) and `preferred_assertion_id ∈ competing_assertion_ids`, writing
nothing on `{ ok:false }`. `convert_calendar` does the day-offset arithmetic.
So the prose that re-explains "make sure preferred is one of the competing,"
"fill all four fields before setting resolved," the post-write validate step
(§7), and any hand offset computation is dead — the tools guarantee it. What the
tools do **not** do is the analysis, and that's most of the file's value.

## The floor: what the unit tests actually grade
- **Deterministic validators**
  (`eval/harness/validators/test_conflict_resolution.py` + universal
  ownership/foreign-key):
  - `test_fact_conflicts_have_competing_assertions` — `conflict_type:"fact"`
    needs ≥2 `competing_assertion_ids` (identity may have 1).
  - `test_resolved_conflicts_have_required_fields` — `status:"resolved"` ⇒
    `preferred_assertion_id` + `resolution_rationale` present. *(Tool enforces
    the full four-field invariant; don't re-derive it — but the **judge** grades
    rationale quality, so keep the four-part structure.)*
  - `test_preferred_assertion_is_in_competing` — `preferred ∈ competing`. *(Tool
    enforces; cut the prose that re-explains the check.)*
  - `test_competing_assertions_exist` / `test_no_new_conflicts_without_competing`
    — foreign-key + non-empty competing on new conflicts.
  - Tag-gated: `test_resolved_flynn_birthplace` (`resolved-flynn-birthplace` →
    the Ireland-vs-Pennsylvania conflict resolved with `preferred ∈
    {a_002, a_009}`, the Ireland census assertions).
  - Universal ownership table + the comment at lines 33–42: conflict-resolution
    writes **only** the `conflicts` section, and its allowlist legitimately
    includes `place_search` / `place_distance` / `convert_calendar` (+ the
    validate-schema sub-skill path). Don't narrow the allowlist.
- **Rubric dims** (`eval/tests/unit/conflict-resolution/rubric.md`): *Source
  independence analysis*, *Evidence weighing*, *Resolution completeness* — all
  pure GPS craft, all judge-graded (read the narrative).
- **Base dims:** Correctness, Completeness, Tool Arguments.
- **Negative/boundary tests (REAL — five of them):**
  `negative-assertion-classification` (ut_010, route classify-evidence →
  assertion-classification), `negative-person-evidence-audit` (ut_009, route
  link-audit → person-evidence), `negative-proof-conclusion` (ut_012, route
  write-up → proof-conclusion), `negative-search-request` (ut_004, route
  "search for more records" → search skill), `negative-timeline-request`
  (ut_011, route "build a timeline" → timeline). These are why the description's
  "Do NOT use…" clauses and the per-step "recommend the owning skill" lines are
  load-bearing — **cutting them flips these red.**
- **Key positive test files:** `birthplace-ireland-vs-pennsylvania.json`
  (ut_001, three-source fact conflict, informant weighting, tag-gated),
  `historical-context-in-rationale.json` (ut_008, part-4 must name the
  *historical mechanism* from historical-contradictions.md — delayed birth
  certificate / Irish-born-parents pattern — not "informants make mistakes"),
  `geographic-identity-conflict.json` (ut_005, `place_distance` travel
  feasibility), `defer-insufficient-evidence.json` (ut_007, same-name → defer,
  name the decisive record), `multi-conflict-prioritization.json` (ut_002,
  one-per-turn prioritization), `three-conflict-prioritization.json`.

## CUT — safe to remove
- **[lines 109–128] the fact-conflict create `research_append({ ... })` JSON
  block** — schema documents the entry shape. Keep a one-line call signature +
  the snake-case + "no id (tool assigns `c_`)" note.
- **[lines 132–151] the identity-conflict create JSON block** — collapse to one
  line: "identity conflicts use `conflict_type:"identity"` + `identity_question`,
  and may have a single `competing_assertion_ids` entry." (Keep the fact-vs-
  identity *distinction* in §"Two types"; cut the second JSON dump.)
- **[lines 229–243] the resolve `research_append({ op:"update" })` JSON block** —
  keep one line: "on resolve, pass all four resolved fields + `status:"resolved"`
  on a single `op:"update"` by `entryId`." Drop the block.
- **[lines 225–228 + 245–248] the "the tool enforces resolved-completeness +
  `preferred ∈ competing`" narration** — the validator and the tool both enforce
  this; restating the check is re-derived validator logic. State **once** ("the
  tool rejects a half-filled `resolved` or a `preferred` outside the competing
  set — surface `{ ok:false }` and fix, don't retry blindly") and delete the
  repeat. The same point appears a **third** time in Important rules (418–439).
- **[lines 360–364] §7 "Present" preamble** — re-narrates the
  validate-before-persist contract a second time and adds a redundant "no
  separate validation pass." Cut to nothing; keep the bullet list of what to
  present (365–382).
- **[lines 474–488] "Re-invocation behavior"** — boilerplate; the one real point
  ("update an existing `c_` for the same assertion set; don't write a second")
  belongs as one line under Important rules.
- **By-hand calendar arithmetic** — already migrated to `convert_calendar` at
  §4 (210–219). Verify no residual "subtract 11 days / 10–13 day offset" math is
  computed in prose; the line "do not compute the 10/11/12/13-day offset by hand"
  is the *correct* guardrail and stays — but if any worked offset subtraction
  survives elsewhere, cut it.

## KEEP — load-bearing judgment (do NOT cut)
- **The three-step intellectual process (41–44)** and **the two-type taxonomy
  (54–75)** — fact vs identity drives `disputed_attribute` vs `identity_question`
  and the ≥2-vs-1 competing-assertion rule the validator checks. Keep.
- **§3 Source independence (161–176)** — the "are they truly independent / group
  related items / analyze per-conflict not per-source-pair" reasoning. Backs the
  *Source independence analysis* dim (which fails on generic "they're different
  documents"). Keep.
- **§4 Seven weighing factors + "don't mechanically score, write a narrative" +
  "articulate a defensible rationale (Standard 48), else unresolvable
  (Standard 49)" (178–196)** — the core of *Evidence weighing*. Keep.
- **§4 travel-distance method (198–207)** — resolve via `place_search`, call
  `place_distance`, compare to era travel norms. Backs ut_005
  (`geographic-identity-conflict`). Keep the method; it's a genuine tool-assisted
  judgment, not dead mechanics.
- **§4 calendar-artifact *recognition* note (209–219)** — "when you suspect a
  Julian→Gregorian artifact, call `convert_calendar` and read
  `applied[].offsetDays`; you still decide *whether* it applies." This is the
  migrated form — keep it (it's load-bearing for date conflicts and explicitly
  forbids hand arithmetic).
- **§5 four-part `resolution_rationale` structure (250–279)** — state the
  problem / lay out evidence in plain language / explain which is more reliable +
  why / explain why the less-reliable exists with a *named* historical pattern.
  Backs *Resolution completeness* and ut_008 (part-4 must name the mechanism).
  **Do not thin part 4** — the judge_context for ut_008 explicitly rejects
  "informants make mistakes." Keep.
- **Informant analysis (276–279, 449–451)** — proximity / time elapsed / motive /
  firsthand knowledge. Often the key to resolution; backs ut_001 and ut_008.
- **§5 defer path (288–306)** — deferral is a documented finding: fill
  independence + weighing anyway, keep `unresolved` + `preferred:null`, and name
  the decisive record types. Backs ut_007. Keep.
- **§6 identity-conflict resolution patterns (308–358)** — same-name
  disambiguation, co-enumeration rule, "do not confirm identity by absence of an
  alternative," and the three outcome shapes (same person → resolved; different
  person → stays unresolved, no preferred; insufficient → defer). These encode
  *why* a "different person" verdict can't be `resolved` under the schema — craft
  the validator can't express. Keep; tighten prose only.
- **Routing / "recommend the owning skill" lines (336–337, 345–347, 372–382,
  400–415)** — back the five negative tests. Keep every redirect target.
- **Important rules: ignore-nothing, one-conflict-per-turn (392–399), evidence
  integrity (Standard 43), assumptions check, negative evidence, historical
  context, don't-merge-to-resolve, err-toward-unresolved** — these are GPS
  craft, several map to specific tests (ut_002 prioritization). Keep; dedupe the
  resolved-completeness restatement out (covered once in §5).
- **Reference pointers (46–52)** to `weighing-evidence.md`,
  `historical-contradictions.md`, `resolution-writing.md` — the judge expects the
  named patterns from these. Keep.

## TIGHTEN — keep the point, cut the words
- State the `research_append` contract + the `{ ok:false }` handling **once** near
  the top: "All `conflicts` writes go through `research_append` (assigns `c_`,
  validates the whole project, writes atomically; on resolve it enforces all four
  resolved fields + `preferred ∈ competing`; on `{ ok:false }` nothing is written
  — surface and fix, don't retry). No separate `validate_research_schema` step."
  Then delete the per-step repeats (225–228, 245–248, 360–364) and the duplicate
  in Important rules (418–439, which restates the four-field invariant in full).
- The "A conflict transitions to `resolved` only when fully populated" rule
  (418–439) overlaps §5 and the §6 "different person" case — keep **one**
  authoritative statement (in §5), reduce the Important-rules copy to a pointer.
- §5's "If more evidence is needed" (288–301) and §6's "Insufficient evidence"
  (355–357) say the same defer protocol twice — state the defer protocol once,
  reference it from §6.
- Trim the §7 present-list to the five bullets; drop the preamble.

## Suggested target structure (~300 lines)
1. Frontmatter (keep the full allowlist) + Narration + Places line.
2. Three-step process + GPS Element 4 ("acknowledged-unresolved OK,
   unacknowledged = violation").
3. Reference pointers (3 files, one line).
4. Two types (fact vs identity) — the distinction + the field/competing-count
   rules. One JSON-free.
5. One-line `research_append` contract (covers create + resolve + `{ ok:false }`).
6. §1 Identify (kept, tight) → §2 create (one-line call) → §3 independence →
   §4 weighing (seven factors + defensible rationale + travel-distance method +
   calendar-recognition note) → §5 resolve/defer (four-part rationale + informant
   analysis + defer protocol, JSON-free) → §6 identity patterns (tightened) →
   §7 present (five bullets) + next-step routing.
7. Important rules — dedup the resolved-completeness restatement; keep the GPS
   craft rules + the five routing redirects.

## Verify
```
cd eval/harness && uv run python run_tests.py --skill conflict-resolution
```
Watch the three rubric dims (Source independence, Evidence weighing, Resolution
completeness) across the positives — especially ut_008 (part-4 names the
historical mechanism) and ut_001 (`resolved-flynn-birthplace`, `preferred ∈
{a_002, a_009}`). Confirm **all five negative tests still route out** (assertion-
classification, person-evidence, proof-conclusion, search, timeline). Confirm
ut_005 still uses `place_distance` and ut_007 still defers with a named decisive
record.

## Owner notes
**Developer** safely cuts the three JSON blocks, the repeated "tool enforces
resolved-completeness/`preferred ∈ competing`" narration, the §7 validate
preamble, and the Re-invocation boilerplate, and verifies no by-hand calendar
math survives. **Genealogist** owns §3–§6 (independence, weighing, informant
analysis, the four-part rationale, identity-conflict patterns, defer) and the
craft Important-rules — these are the graded GPS work and back ut_001/ut_005/
ut_007/ut_008 plus the five routing negatives. Don't let a mechanical pass thin
part 4 of the rationale or drop any redirect target.
