# Shorten: tree-edit

**Bucket:** A (dead-mechanics removal) — but with a large protected core
**Primary owner:** both (developer strips mechanics; **genealogist must sign
off on what stays** — this is a real craft skill)
**Current size:** 324 lines → **Target:** ~150–180 lines (~45% reduction)
**Tool migration:** **done** — calls `tree_edit`, `merge_tree_persons`,
plus `person_record_matches` / `person_person_matches` for hint checking.
(`merge_record_into_tree` is retired by the tree-materialization spec §9 — the
record→tree path is `person-evidence` + `materialize_facts`, not a tree-edit fold.)
**Still needed as a skill?** **Yes, unambiguously** — it's the gatekeeper for
the deliverable. The tool alone won't refuse an unsourced edit or require
probable-tier proof before a merge.

## TL;DR
The migration is complete — don't change *what* it calls. Cut the verbose
per-operation `tree_edit({ ... })` JSON examples (the schema documents them),
the merge worked-example, and the "update ALL references" / "edits in place by
id" mechanics the tools now own. **Do not touch** the evidence-grounding
gatekeeping and decision rules — they map straight onto the rubric and the
negative tests.

## Why this skill is shortenable
`tree_edit` now assigns ids, swaps primary/preferred, resolves
`standard_place`, validates-before-persist, and writes atomically; the merge
tools repoint every reference across both files and remove the collapsed
person. A lot of the prose narrates that clerical work step by step. That's
dead — the tool guarantees it.

## The floor: what the unit tests actually grade
- **Deterministic validators** (`eval/harness/validators/test_tree_edit.py`):
  - `test_cross_file_person_references_resolve` — after a merge/delete,
    `research.json` refs (`project.subject_person_ids`,
    `person_evidence.person_id`, `timelines.person_ids`) must still resolve to
    persons in `tree.gedcomx.json`. *(The tool does this; don't re-explain it,
    but don't break the rule it enforces.)*
  - `test_tree_edit_noop` (tag `tree-edit-noop`) — a "verify it's already
    there" prompt must produce a **byte-identical** tree (no churn write).
  - Universal ownership table: tree-edit may write only
    persons/relationships/sources in `tree.gedcomx.json`, and **must not touch
    research.json** directly (the merge tools do that repointing).
- **Rubric dims** (`eval/tests/unit/tree-edit/rubric.md`):
  1. *Data preservation* — no facts/names/sources silently dropped; keep BOTH
     conflicting facts on a merge when no proof specifies a winner.
  2. *Edit minimality* — change only the requested field; no collateral edits.
  3. *Merge correctness* — all refs rewritten, deprecated person removed,
     post-merge validation clean.
  4. *Evidence grounding* — every add traces to a source; refuse/route edits
     below threshold.
- **Base dims:** Correctness, Completeness, Tool Arguments.
- **Negative/boundary tests:** `refuse-merge-without-proof` (merge needs a
  `probable`-tier `ps`), `negative-person-evidence`, `negative-proof-conclusion`,
  `negative-record-extraction` (route facts through the pipeline, don't write
  them ad-hoc here).
- **Other key tests:** `add-birth-fact`, `add-occupation-fact-with-place`,
  `add-relationship-after-proof`, `correct-typo-death-date`,
  `create-sibling-with-parentchild`, `person-merge-stub-into-fs-person`,
  `person-record-matches`, `person-person-matches`.

## CUT — safe to remove
- **[~96–124] full `add_person` and `add_relationship` JSON example blocks** —
  the `tree_edit` schema documents the params. Keep **one** minimal example
  (e.g. `add_fact`) and a one-line list of the other operations.
- **[~144–198] the merge worked-example + per-tool JSON for
  `merge_tree_persons`** — collapse to: "Call
  `merge_tree_persons({ projectPath, merges: [[survivorId, collapsedId]] })`.
  The tool folds data, repoints all refs, removes the collapsed person, and
  reports a summary." The blow-by-blow of *what gets repointed* is the tool's
  job now. (Drop any `merge_record_into_tree` "record_read candidate" branch —
  that tool is retired; folding a record into the tree is now
  `person-evidence` + `materialize_facts`.)
- **[~314–324] "Re-invocation behavior"** — the "do not duplicate / use
  update_* not add_*" point is real but belongs as one line under Decision
  rules; the rest is boilerplate.
- **[~64–82, ~244–253] the "tool assigns ids / swaps primary / resolves
  standard_place / validates-before-persist / `{ ok:false }`" narration** —
  state **once**, briefly. It's repeated across "Ad-hoc edits," each operation,
  and "Validation."

## KEEP — load-bearing judgment (do NOT cut)
- **"Important rules"** (merge is irreversible → confirm the plan; merge only
  on `probable`+ proof; preserve the more complete record; ad-hoc edits should
  be rare) — protects *Evidence grounding* + *Merge correctness* + the
  `refuse-merge-without-proof` negative test.
- **"Decision rules for ambiguous situations"** (conflicting facts → keep
  both; unknown relationship type → don't default to biological; edit without
  source → require a source; relationship threshold; unresolved conflict →
  don't pick a side; **requested state already satisfied → no-op, report it,
  add no extra fields**) — these map 1:1 onto *Data preservation*, *Edit
  minimality* (the no-op test), and *Evidence grounding*. **This section is the
  reason the skill exists.**
- **Survivor-selection convention** (FS id > synthetic; most complete; the id
  in `subject_person_ids`).
- **`check-warnings` after every edit/merge** — genealogical plausibility the
  structural validator can't catch. Keep.
- **Record/duplicate hint checking** (`person_record_matches`,
  `person_person_matches`, FS-id-only guard) — distinct user-facing behavior
  with its own tests; tighten the prose but keep it.
- **Places one-liner** (resolve via `place_search`, record `standardPlace`).

## TIGHTEN
- State the "tool validates-before-persist, surface `{ ok:false, errors }`
  rather than retrying" rule **once**, in a short Validation section, and
  delete the repeats.
- The two match-checking sections (`person_record_matches`,
  `person_person_matches`) repeat the "FS-id-only, synthetic `I` ids have no
  match data" caveat — state it once for both.

## Suggested target structure (~160 lines)
1. Frontmatter + Narration + Places line.
2. Two use cases (ad-hoc corrections; person merging) — 3 sentences.
3. Ad-hoc edits: one minimal `tree_edit` example + a one-line operation list +
   the single "tool does ids/place/validation" note.
4. Person merging: survivor convention + the two merge calls (1 line each) +
   "irreversible, confirm the plan, only on probable+ proof."
5. Match/duplicate checking: both tools, shared caveat.
6. Validation: one line + "run check-warnings after every edit."
7. **Important rules** + **Decision rules** — keep, tighten prose only.

## Verify
```
cd eval/harness && uv run python run_tests.py --skill tree-edit
```
Watch the four rubric dims especially; confirm `refuse-merge-without-proof`
still refuses and `tree-edit-noop` still produces an unchanged tree.

## Owner notes
**Developer** safely cuts the JSON examples, the merge worked-example, and the
repeated tool-mechanics narration. **Genealogist** owns "Important rules" +
"Decision rules" — the evidence-grounding thresholds and conflict handling are
craft, and they back the negative tests. Don't let a mechanical pass strip
them.
