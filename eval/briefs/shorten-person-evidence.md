# Shorten: person-evidence

**Bucket:** A (dead-mechanics removal) — but with a large protected craft core
**Primary owner:** both (developer cuts the JSON blocks, id-allocation, and
supersede mechanics + boilerplate; **genealogist owns the match-threshold
policy and correlation judgment**)
**Current size:** 506 lines → **Target:** ~300–330 lines (~38% reduction)
**Tool migration:** **done** — Step-4 link `research_append({op:"append"})`,
Step-5 stub `tree_edit({operation:"add_person"})`, Step-6 revision
append-then-`op:"update"` `superseded_by`; plus `same_person` for scoring.
**Still needed as a skill?** **Yes, unambiguously** — identity resolution is
the highest-risk step in the system. The tools persist links and mint stubs but
will not refuse a name-only match, set the right confidence tier, or hold the
score-as-input-not-verdict line. That is all graded craft.

## TL;DR
The migration is complete and clean — the post-write `validate_research_schema`
call is already removed (Step 8 explicitly says no separate validate pass is
needed; the flow ends on `check-warnings`). Cut the three big
`research_append`/`tree_edit` JSON blocks (schema dupes), the "tool allocates
the `I`/`N` ids, stamps `created`, validates and writes nothing on errors"
narration (now structural), and the "Re-invocation behavior" boilerplate. State
the supersede-not-delete rule **once**. **Do not touch** the match-threshold
policy table, the score-discipline rules, multi-person cardinality, the
review-only mode contract, or stub confidence calibration — every one backs a
named validator or rubric dim. This is the biggest file in the pair; most of the
win is JSON blocks + de-duplicating the score rule, not the judgment.

## Why this skill is shortenable
`research_append` now assigns the `pe_` id, stamps `created`, nulls
`superseded_by`, and validates-before-persist; `tree_edit({add_person})`
allocates the synthetic `I`/`N` ids. So every passage that recites *how* ids are
allocated, that you must omit ids/created/superseded_by, and that the tool writes
nothing on `{ ok:false }` is redundant with the tools' own guarantees. The
identity-resolution judgment is not — it is the entire reason the skill exists.

## The floor: what the unit tests actually grade
- **Deterministic validators** (`eval/harness/validators/test_person_evidence.py`
  + universal):
  - `test_person_evidence_no_deletions` — never drop a `pe_` entry (this is what
    supersede-not-delete protects).
  - `test_new_person_evidence_references_valid_assertion` — every new entry's
    `assertion_id` resolves (universal foreign-keys).
  - `test_new_person_evidence_have_required_fields` — new entries need
    `person_id`, `assertion_id`, `confidence`, non-empty `rationale`.
  - `test_pe005_unchanged_when_review_confirms` / `test_no_unrelated_new_pe_in_focused_review`
    (tags `pe_005`, `confidence-calibration`) — a confirming **review writes
    nothing**.
  - `test_pe004_unchanged_when_adding_second_side` + `test_a010_has_second_side_link`
    (tags `multi-person-awareness`, `pe_004`, `a_010`) — adding the missing
    other-side link must not churn the existing side.
  - `test_match_score_persisted` / `test_fts_assertion_no_score`
    (tags `match-score`, `no-score-fallback`) — record_search link carries a
    non-null `match_score`; FTS link leaves it null.
  - `test_high_score_conflict_not_confident` (tag `score-conflict`) — high score
    + qualitative conflict must NOT yield `confident`.
  - `test_low_score_variant_still_links` (tag `score-variant`) — low score from a
    name variant must still create the link.
  - `test_stub_person_created_and_linked` (tag `stub-creation`) — mint a new
    well-formed stub (gender + name) in tree.gedcomx.json, link a_005 to it,
    `match_score` null.
  - `test_audit_review_makes_no_writes` (tag `audit-review`) — review/audit
    touches nothing.
  - Universal ownership table: writes `person_evidence` in research.json and
    `persons` in tree.gedcomx.json (stub grant), nothing else.
- **Rubric dims** (`eval/tests/unit/person-evidence/rubric.md`): *Confidence
  calibration*, *Rationale quality* (cite multiple attributes + disambiguate),
  *Multi-person awareness* (both sides of a relationship assertion),
  *Stub-person creation*, *Score discipline (advisory)*.
- **Base dims:** Correctness, Completeness, Tool Arguments.
- **Negative/boundary tests:** `negative-merge-persons` → tree-edit;
  `negative-resolve-competing-identities` → conflict-resolution (the nearest
  neighbor, the most important boundary); `negative-extract-from-record` →
  record-extraction; `negative-search-for-records` → search-records.
- **Key test files:** `link-death-cert-to-patrick`,
  `link-relationship-to-both-persons`, `audit-surfaces-unlinked-role`,
  `stub-creation-new-son`, `match-score-persisted`,
  `fts-assertion-qualitative-fallback`, `high-score-conflict-not-auto-linked`,
  `low-score-strong-correlation-still-links`.

## CUT — safe to remove
- **[~266–279] the Step-4 `research_append({...})` JSON block** — the schema
  documents the params. Keep one line naming the call and the required fields
  (the validator's four: `assertion_id`, `person_id`, `confidence`, `rationale`,
  plus `match_score`). The field-guidance bullets [~281–299] can stay as a
  *short* list (rationale + match_score guidance is judgment), but drop the
  `superseded_by` mechanics bullet here — fold into the single supersede rule.
- **[~258–264] "Supply the entry WITHOUT an `id`, `created`, or `superseded_by`
  — the tool assigns the next `pe_` id, stamps `created`, validates before
  persisting, and writes nothing on `{ ok:false, errors }`"** — all structural
  now. Replace with: *"The tool assigns the `pe_` id and validates; surface
  `{ ok:false, errors }`."* (state once, reuse for tree_edit).
- **[~310–319] the Step-5 `tree_edit({...})` JSON block** — schema dupe. Keep
  the minimal-stub *requirements* (gender, one name with a surname) as prose;
  drop the JSON.
- **[~321–326] "The tool assigns synthetic ids (`I5`/`N5`, etc.) — never supply
  ids"** id-allocation narration — the tool owns this. Keep only the genuinely
  judgmental half: "never use FamilySearch IDs for a new stub" (one clause).
- **[~358–366] the Step-6 `op:"update"` `superseded_by` JSON block** — schema
  dupe. The supersede flow (append corrected link, then update old entry's
  `superseded_by`, never delete) is load-bearing as a **rule** — state it in one
  or two sentences, no JSON.
- **[~492–506] "Re-invocation behavior"** — boilerplate. The "don't duplicate a
  pe for the same assertion-person pair / update in place" point already lives in
  "Important rules" and `test_person_evidence_no_deletions`. Delete the section.
- **Repeated "tool validates-before-persist, writes nothing on errors" narration**
  — appears in Steps 4, 5, and 8. State once.

## KEEP — load-bearing judgment (do NOT cut)
- **Step 0 "Identify the request mode" (Linking vs Review-only)** and the
  Review-only contract (produce written analysis only; no writes; confirm before
  acting; close-the-review-then-ask) — backs `test_audit_review_makes_no_writes`,
  the *Multi-person awareness* review clause, and `audit-surfaces-unlinked-role`.
  Keep in full; tighten prose only.
- **"Cardinality" + Step 7 "Systematic record linking"** (one assertion can bear
  on multiple persons; one `pe_` per person; link all roles) — *Multi-person
  awareness*; backs `test_a010_has_second_side_link` and
  `link-relationship-to-both-persons`.
- **Step 2 "Assess match strength" + correlation techniques + the `same_person`
  scoring procedure** (resolve the record via the sidecar, build a *subset*
  tree-side document, when a score is/ isn't available) — *Rationale quality* +
  *Score discipline*. The subset-not-whole-tree instruction is a real
  operational constraint; keep it (tighten). Backs `match-score-persisted` /
  `fts-assertion-qualitative-fallback`.
- **Step 3 "Match threshold policy" — the whole table + "score is an input, never
  a substitute" rules** (qualitative conflict caps confidence regardless of
  score; no score → correlation stands alone; weak → pause for user) — the spine
  of *Confidence calibration* + *Score discipline*; backs
  `high-score-conflict-not-auto-linked` and `low-score-strong-correlation-still-links`.
  **This section is the reason the skill exists.** Keep in full.
- **Step 5 stub confidence calibration** (a brand-new stub is `probable` at most,
  never `confident`; `speculative` when only circumstantial) and the
  when-to-stub-vs-skip rule — *Stub-person creation* dim; backs `stub-creation-new-son`.
- **Step 6 supersede-not-delete RULE** (append corrected link, update old
  entry's `superseded_by`, never delete — it's the audit trail) — backs
  `test_person_evidence_no_deletions`. State the rule once, no JSON.
- **"GPS Grounding" three rules** (name-match-alone is unsound; same informant =
  one evidence unit; identity rests on direct/indirect/negative) — frames
  *Rationale quality* + *Confidence calibration*. Keep, it's short.
- **"Important rules"** (never auto-merge; enforce threshold; score is input not
  verdict; transcription variants don't downgrade; rationale mandatory;
  relationship assertions link both parties) — these consolidate the negative
  tests and several dims. Keep; this is where to state each rule its single time.
- **Step 8 `check-warnings`** — genealogical plausibility the persistence step
  can't catch. Keep (only the post-write *validate* was cut, and it's already
  gone).
- **The two worked examples** (probate linking table; differentiating same-name
  individuals) — high-signal reference verdicts for *Rationale quality* and
  disambiguation. Keep both, but the probate example overlaps Step 7's census
  example — see TIGHTEN.

## TIGHTEN — keep the point, cut the words
- **The "score is an input, not a verdict" rule appears ~4 times** (Step 3 prose,
  the Step-3 table notes, Step-4 `match_score` field guidance, "Important rules,"
  and the "Transcription variants" bullet). State it **once** (Step 3) and have
  "Important rules" carry a single one-line pointer, not a re-argument.
- **"Never auto-merge"** appears in Step 3 and "Important rules" — state once.
- Step 7's census-household example and the "Example: Linking probate record"
  block both demonstrate multi-role linking; keep one full worked example and
  reduce the other to a 3-line list.
- "Edge cases and decision rules" partly restates Step 2/3 (age window,
  name variants, independent evaluation per record) — merge the non-redundant
  bullets into Step 2/3 and delete the duplicates.

## Suggested target structure (~315 lines)
1. Frontmatter + Narration + reference-load lines.
2. GPS Grounding (3 rules) + Cardinality.
3. Step 0 request mode (Linking vs Review-only) — kept, tightened.
4. Steps 1–3: identify unlinked → candidates + `same_person` scoring (subset
   tree-side) → **threshold policy table** (kept in full) with the score rule
   stated **once**.
5. Step 4: one-line `research_append` call + short field-guidance bullets (no
   JSON, no id-allocation narration).
6. Step 5: stub via `tree_edit` (requirements as prose, no JSON) + stub
   confidence calibration + when-to-stub.
7. Step 6: supersede-not-delete rule (1–2 sentences, no JSON).
8. Step 7 systematic linking (one worked example).
9. Step 8 `check-warnings` + present.
10. "Important rules" — each load-bearing rule stated once.
11. (Delete "Re-invocation behavior" entirely; keep one tightened worked example
    + the same-name disambiguation section.)

## Verify
```
cd eval/harness && uv run python run_tests.py --skill person-evidence
```
Watch *Confidence calibration* and *Score discipline*; confirm the tag-gated
validators stay green — `pe_005`/`pe_004` unchanged on review/second-side,
`match-score` persisted vs FTS null, `score-conflict` not-confident,
`score-variant` still-links, `stub-creation` mints a well-formed stub,
`audit-review` writes nothing — and that `negative-resolve-competing-identities`
still routes to conflict-resolution and `negative-merge-persons` to tree-edit.

## Owner notes
**Developer** safely cuts the three JSON blocks, the id-allocation/created/
validate narration, the supersede JSON, and "Re-invocation behavior," and
de-duplicates the score rule. **Genealogist** owns Step 0's review contract,
Step 2–3's correlation + threshold policy, stub confidence calibration, and the
worked examples — that is the graded craft and the data-safety guardrail behind
every tag-gated validator. The biggest line win is the JSON blocks plus stating
the score rule once, not touching the judgment. Don't chase a brittle minimum —
the corpus is LLM-judged with no `temperature=0`.
