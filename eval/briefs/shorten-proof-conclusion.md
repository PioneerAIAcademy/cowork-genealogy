# Shorten: proof-conclusion

**Bucket:** A (dead-mechanics removal) — large protected craft core
**Primary owner:** both (developer strips mechanics; **genealogist signs off
on the GPS reasoning, tier judgment, and the question-ownership boundary**)
**Current size:** 407 lines → **Target:** ~230–250 lines (~40% reduction)
**Tool migration:** **done** — frontmatter calls `research_append`,
`tree_edit`, `merge_tree_persons`, `merge_record_into_tree`. No leftover
post-write `validate_research_schema` call (lines 339–341 already state there
is no separate post-write validation step).
**Still needed as a skill?** **Yes, unambiguously** — the tools persist; the
skill supplies the entire GPS proof (tier selection, form selection, narrative
reasoning) and is the *only* place that holds the "do NOT resolve the question
here" ownership boundary. No tool enforces that boundary positively.

## TL;DR
The migration is complete — don't change *what* it calls. Cut the verbose
`tree_edit({ ... })` / `research_append({ ... })` JSON example blocks (the
schemas document them), the per-step "tool assigns ids / swaps primary /
validates-before-persist" narration (state it once), and the redundant
restatements of the no-questions-write rule. **Do NOT cut** the GPS proof
reasoning, the tier-assignment table + decision rules, the proof-form selection
judgment, the known-gap hand-writes (the `S` source entry and `project.status`),
or — most critically — §7 "Do not modify the question." That boundary is backed
by a deterministic test (see below) and is the single most important KEEP.

## Why this skill is shortenable
`research_append` now assigns the `ps_NNN` id, validates the whole project
before writing, and writes nothing on failure. `tree_edit` assigns fact/
relationship ids, swaps `primary`/`preferred` flags, resolves `standard_place`,
validates-before-persist, and writes atomically. The merge tools fold data,
repoint every `research.json` person-id reference, and remove the collapsed
person. A lot of the Step 5/6 prose narrates that clerical work and embeds full
JSON payloads that duplicate the tool schemas. That's dead — the tools guarantee
it. The post-write `validate_research_schema` step is already gone (replaced by
the "tools validate-before-persist" note); nothing left to cut there.

## The floor: what the unit tests actually grade

- **Deterministic validators** (`eval/harness/validators/test_proof_conclusion.py`
  + universal):
  - `test_no_mcp_tools_called` — proof-conclusion must call no *research* MCP
    tools beyond its allowlist (`validate_research_schema` exempted as a
    universal audit). Don't reintroduce ad-hoc tool calls.
  - `test_positive_test_creates_a_proof_summary` / `test_new_proof_summary_has_narrative`
    — every positive (non-`no-new-proof-expected`) run writes a new
    `proof_summaries` entry with a **non-empty `narrative_markdown`**.
  - Tag-gated tier verdicts: `test_q001_probable_tier`, `…proved…`,
    `…possible…`, `…not_proved…`, `…disproved…` — the tier the skill writes
    must match the scenario's evidence strength. (The tier *table* + decision
    rules are what produce these; they are load-bearing, not cuttable.)
  - Tree write-back invariant: `test_no_tree_write_below_probable` (tag
    `no-tree-write`) — at possible/not_proved/disproved the tree must be
    **byte-identical** before/after; `test_tree_write_present_at_probable_plus`
    (tag `tree-write-expected`) — at probable/proved the concluded ParentChild
    (parent I2 → child I1) must be present. The "tier ≥ probable" gate in Step 6
    backs both.
  - `test_reinvocation_no_duplicate_proof` (tag `reinvocation-dedup`) — exactly
    **one** proof_summary for q_001 after re-invocation (update in place).
  - `test_conflict_blocks_proved` (tag `conflict-blocks-proved`) — must not
    declare `proved` while an unresolved conflict blocks the question.
  - **Universal `test_ownership_table` — THE question-boundary enforcer.**
    `OWNERSHIP_TABLE` (test_universal.py) maps `questions →
    {question-selection, research-exhaustiveness}` — **proof-conclusion is NOT
    in that set.** It permits proof-conclusion only `project` and
    `proof_summaries`. So any write to the `questions` section fails this test
    deterministically. `test_tree_ownership_table` permits proof-conclusion
    `persons` / `relationships` / `sources` on the tree.
  - Universal foreign-keys (`test_id_references_resolve`): the new
    `proof_summaries[].question_id` must resolve.

- **Rubric dims** (`eval/tests/unit/proof-conclusion/rubric.md`):
  *Tier justification* (the narrative explains why this tier, naming what's
  missing for the next one up), *Narrative standalone* (readable as a GPS
  conclusion without the JSON — inline citations, evidence summary, conflict
  resolution, tier declaration), *Evidence completeness* (cites all relevant
  assertions + resolved conflicts; omitting inconvenient evidence is a GPS
  violation), *Proof-conclusion fit* (Statement/Summary/Argument matches the
  evidence shape).

- **Base dims:** Correctness, Completeness, Tool Arguments.

- **Negative/boundary tests:** `negative-question-selection` ("what to research
  next" → question-selection), `negative-project-status` ("where are we?" →
  project-status), `negative-conflict-resolution`, `negative-assertion-classification`
  (route, don't answer out of scope). `precondition-unresolved-conflict`
  (tag `conflict-blocks-proved`, `no-new-proof-expected`) — decline/route to
  conflict-resolution rather than declaring proved.

- **Key test files:** `write-parentage-proof.json` (probable + tree-write),
  `proved-tier-with-exhaustive-search.json`, `possible-tier-thin-evidence.json`,
  `not-proved-tier-rival-candidates.json`,
  `disproved-tier-chronological-impossibility.json`,
  `reinvocation-update-in-place.json`, `gps-review-existing-proof.json`,
  `precondition-unresolved-conflict.json`, the four `negative-*.json`.

## CUT — safe to remove

- **[lines 235–250] the full `research_append({ ... })` JSON example block** —
  the tool schema documents every param. Keep one compressed line: "Append the
  entry **without an `id`** via `research_append({ section: "proof_summaries",
  op: "append", entry })`; the tool assigns `ps_NNN` and validates before
  writing." (Lines 231–234 + 251–253 already say this in prose; the JSON is the
  dupe.)
- **[lines 275–282] the full `tree_edit({ operation: "add_fact", ... })` JSON
  example block** — schema dupe. Keep at most one tiny inline example or a
  one-line operation list (`add_fact` / `update_fact` / `add_relationship` /
  `remove`).
- **[lines 286–289] the hand `S`-entry instruction "copy the finalized
  research.json `sources[].citation` into the `S` entry's `citation`"** — this
  is the manual S-entry field-copy the spec §4.12 says to trim. BUT note the
  known gap below: the S write *itself* still happens by hand (no `tree_edit`
  source op). Reduce to **one line** flagging it as a known hand-write, don't
  expand it back into a field table.
- **[lines 290–294] the `quality` 3/2/1/0 mapping table on the source
  reference** — this re-derives source-reference scoring the tool/schema can
  carry; if kept at all, compress to one line. (Genealogist call: this is
  evidence-analysis judgment, so confirm before deleting — see Owner notes.)
- **[lines 273 partial, 264–267, 287] repeated "the tool assigns ids / swaps
  the primary flag / resolves standard_place / validates / writes nothing on
  `{ ok: false }`" narration** — appears in Step 5 (231–234), Step 6 intro
  (264–267), the add_fact bullet (270–274), and Step 9 (339–341). State **once**
  in a short Validation note. ~10–15 lines.
- **[lines 296–298, 252–253] the duplicated "if it returns `{ ok: false,
  errors }`, surface and fix, don't retry blindly"** — stated twice (Step 5 and
  Step 6). State once.
- **[lines 388–406] "Re-invocation behavior"** — boilerplate "Writes:" /
  "On repeat invocation:" / "Do not duplicate:". The one real point
  (re-invoke → update the existing `ps_` in place, never a second summary for
  the same question; a downgrade removes the tree write) is already in Step 5
  (255–258) and the downgrade case in Step 6 (300–303). Fold to one line under
  Decision rules; cut the rest.
- **[lines 339–341] the "no separate post-write validation step" explanation** —
  true and correct, but it's explaining the *absence* of dead mechanics. Keep
  the `check-warnings` half (342–344); compress the validation-absence prose to
  the single Validation note.

## KEEP — load-bearing judgment (do NOT cut)

- **[lines 315–329] §7 "Do not modify the question" — KEEP VERBATIM. THE single
  most important KEEP.** This is the standing ownership boundary the spec §4.12
  explicitly warns must NOT be reversed (an earlier draft wrongly added a
  questions-update here). It is backed by the deterministic universal
  `test_ownership_table` (`questions` is owned by question-selection /
  research-exhaustiveness, **not** proof-conclusion) — a shortening pass that
  weakens it would flip that test red. Leave §7, **and** the matching
  "Never write to the `questions` section" rule at lines 379–386, intact. (You
  may merge the two into one statement to avoid the duplicate, but do not
  *dilute* the rule — keep the full enumeration of what NOT to set: `status`,
  `resolved`, `resolution_assertion_ids`, `exhaustive_declaration`.)
- **[lines 88–107] the confidence-tier table + decision rules** (Proved/Probable/
  Possible/Not Proved/Disproved; unresolved-conflict hard-block on Proved;
  hedging-blocks-Proved; "when in doubt, tier down") — directly produces the
  five tag-gated tier validators and the *Tier justification* rubric dim. Keep.
- **[lines 108–121] §3 proof-conclusion form selection** (Statement / Summary /
  Argument decision rule) — backs the *Proof-conclusion fit* rubric dim. Keep
  (it already defers detail to the reference; that's correct).
- **[lines 123–227] §4 narrative writing** (self-contained requirement; the
  three form templates; the key writing rules — organize logically, cite
  inline, name informants, state classifications, follow the evidence) — backs
  *Narrative standalone* + *Evidence completeness*. Keep the requirements + the
  writing rules; the three template skeletons can be **tightened** (see below)
  but the form distinctions must survive.
- **[lines 54–71] Preconditions** (assertions classified + linked + conflicts
  resolved/acknowledged; the route-to-other-skill behavior; preliminary
  conclusions allowed when not exhaustive) — backs the precondition + negative
  tests. Keep.
- **[lines 305–313] Person merging** (proof-conclusion decides WHETHER; the
  merge tool does the mechanical repointing) — keep the decision boundary; the
  two call lines can stay one line each.
- **Known-gap hand-writes — KEEP as explicit hand-write steps (do NOT "fix" by
  cutting):**
  - the `S` source-description entry in `tree.gedcomx.json` stays by hand —
    `tree_edit` has no source op (spec §5). One line.
  - `project.status` / `project.updated` (Step 8, lines 332–336) stays
    hand-done — `research_append` has no `project` section yet (spec §5 gap).
    Keep Step 8.
- **[lines 342–344] run `check-warnings` after any tree edit/merge** — the only
  surviving validation step (genealogical plausibility, not structural). Keep;
  it points at `references/validation-protocol.md`, which is correct.
- **[lines 358–386] "Important rules"** — narrative-authoritative, no-Proved-
  with-hedging, cite-everything, acknowledge-limitations, write-for-replication,
  never-fabricate, don't-resolve-conflicts-here, don't-evaluate-exhaustiveness-
  here, never-write-questions. Each maps onto a rubric dim or a boundary test.
  Keep the points; **tighten** by stating each once (several echo the steps).

## TIGHTEN — keep the point, cut the words

- **The "tool validates-before-persist / surface `{ ok: false }` / don't retry
  blindly" rule** appears ~3×. State it once in a short Validation note.
- **The "never write the `questions` section" rule** is in §7 (315–329) AND
  Important rules (379–386). Merge into one authoritative statement — but keep
  the full "do not set status/resolved/resolution_assertion_ids/
  exhaustive_declaration" enumeration (it's the boundary the test protects).
- **The three narrative templates (Statement / Summary / Argument, lines
  136–213)** can lose some of the bracketed inline annotations and blank lines
  while keeping the section headings that distinguish the forms. Don't collapse
  three forms into one — *Proof-conclusion fit* grades the distinction.
- **"What this skill produces" (35–53)** overlaps Steps 5/6/8. Compress to a
  3-bullet summary; let the Steps carry the detail.

## Suggested target structure (~240 lines)

1. Frontmatter (unchanged allowlist) + Narration + the "read
   `references/gps-proof-writing.md` first" line.
2. What it produces — 3 bullets.
3. Preconditions (keep) — route when unmet; preliminary conclusions allowed.
4. Step 1 Gather evidence (keep, tighten).
5. Step 2 Tier table + decision rules (KEEP).
6. Step 3 Form selection (KEEP, already lean).
7. Step 4 Narrative — self-contained rule + three tightened templates + writing
   rules (KEEP, tighten templates).
8. Step 5 Write `proof_summaries` — one line + no JSON block; one Validation
   note (validates-before-persist; surface errors; re-invoke updates in place).
9. Step 6 Tree updates (tier ≥ probable) — one minimal example or operation
   list; the merge decision boundary (2 lines); the two known hand-writes
   (`S` entry, downgrade-removal) one line each; "run check-warnings."
10. **Step 7 Do not modify the question — KEEP (the boundary; merge with the
    Important-rules echo but do not dilute).**
11. Step 8 project.status — keep (known hand-write gap).
12. Step 9 Present (keep the user-facing summary + next-step routing).
13. Important rules — one statement of each, no echoes.

## Verify
```
cd eval/harness && uv run python run_tests.py --skill proof-conclusion
```
Watch specifically:
- **`test_ownership_table` stays green** (no write to `questions`) — this is the
  question-ownership boundary; the most important thing not to break.
- All five tag-gated tier validators (`tier-probable/proved/possible/
  not-proved/disproved`) still match the scenarios.
- `no-tree-write` (byte-identical tree below probable) and `tree-write-expected`
  (ParentChild I2→I1 at probable+) both hold.
- `reinvocation-dedup` (one ps_ for q_001) and `conflict-blocks-proved`
  (no proved while c_001 unresolved) still pass.
- The four `negative-*` tests still route away.
- Confirm the known-gap hand-writes still happen: the `S` source entry lands in
  the tree and `project.status` updates — these are NOT tool-owned and a too-
  aggressive cut could drop them.
- The four rubric dims (Tier justification, Narrative standalone, Evidence
  completeness, Proof-conclusion fit) stay at pass.

## Owner notes
**Developer** safely cuts: the `research_append` / `tree_edit` JSON example
blocks, the repeated tool-mechanics narration, the duplicated `{ ok:false }`
rule, the "Re-invocation behavior" boilerplate, and the post-write-validation
absence prose. **Genealogist** owns and signs off on: the tier table + decision
rules, the proof-form selection, the narrative templates + writing rules, the
preconditions, and — non-negotiably — §7 "Do not modify the question." That
boundary is graded craft *and* a deterministic test; do not let a mechanical
pass weaken it. Genealogist also confirms whether the source-reference `quality`
mapping is craft worth keeping (it's borderline) before the developer deletes
it. Leave the two known-gap hand-writes (the `S` source entry, `project.status`)
in place — they are not tool-owned yet (spec §5).
