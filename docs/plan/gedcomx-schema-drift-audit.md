# Simplified-GedcomX drift audit

**Status:** implemented — see the *Implementation status* appendix at the
bottom for what landed where, plus the independent re-audit's deltas.
**Branch:** `gedcomx-schema-drift`, cut from `worktree-optimize-author-e2e`
(PR #627). Rebase onto `main` once that merges.
**Date:** 2026-07-09.

## Why this exists

PR #627 discovered that the tree-gedcomx JSON Schema was never enforced
anywhere, and that 25 of the 26 committed e2e starting trees failed it. It
fixed that by making the schema describe the documents the producers
actually emit. The obvious next question is whether the schema now
describes them *completely* — and whether it agrees with the other four
descriptions of the same format.

There are five, and they drift:

| | Description | Enforced when? |
|---|---|---|
| **A** | `docs/specs/schemas/tree-gedcomx.schema.json` (+ byte-identical mirror at `packages/schema/schemas/`) | fixture lint (`e2e/validate_fixture.py`) |
| **B** | `packages/engine/mcp-server/src/validation/validator.ts` | **every `tree_edit` call**, hard-fail |
| **C** | `packages/schema/src/index.ts` (TS interfaces) | `tsc`, for viewer-ui / web / server |
| **D** | `docs/specs/simplified-gedcomx-spec.md` (prose) | never |
| **E** | the producers: `person-read.ts`, `gedcomx-convert.ts`, `e2e/author.py` | — |

The dangerous class is **A accepts what B rejects**. A fixture lints clean,
ships, and then the agent hits a `tree_edit` hard-fail mid-run and has to
repair our fixture before it can write. That is not hypothetical — it is
precisely the `person1`/`person2` bug PR #627 fixed, found in two committed
*passing* transcripts.

**No drift below is tripped by the committed corpus today.** All are latent.
They are ranked by how likely a hand-authoring genealogist is to trip them.

## Method, and how much to trust it

A 147-agent workflow swept all five descriptions field-by-field, then put
each candidate drift through a high-effort verifier and three adversarial
refuters (correctness / reachability / consequence lenses), each instructed
to default to "refuted" when uncertain. 32 claims in; 6 distinct drifts out.

Two caveats a reader should carry:

- Fifteen refuters died on a structured-output retry cap, so some drifts
  faced a two-refuter jury. The top findings survived those juries
  *unanimously* (0 of 2 refuting), which is stronger than a contested 1-of-3.
- Where the sweeps produced near-duplicate claims for one drift, the
  refuters sometimes split — `ts-fact-missing-fields` was killed 2/3 while
  its twin survived. Since refuters default to "refuted," a kill on a
  types-only drift means *"real but inconsequential,"* not *"does not exist."*

So the votes are a filter, not the evidence. **Everything in Tier 1 below was
reproduced by hand**, against a deliberately-invalid control document proving
neither checker was silently no-opping:

```
                 JSON Schema (A)   validator.ts (B)
  mononym        SCHEMA OK    →    missing required field 'given'
                                   fact type 'death' should be PascalCase
  sane           SCHEMA OK    →    VALIDATOR OK
  bogus (ctrl)   2 errors     →    3 errors
```

`validateGedcomx(data, report)` takes **two** arguments. A three-argument
call silently reports success. Any future audit must include a negative
control for this reason.

---

## Tier 1 — A accepts, B rejects. Two-line schema tightenings.

### 1. A name with no `given` lints clean and hard-fails `tree_edit`

- **A:** `tree-gedcomx.schema.json:61` — `"required": ["id", "surname"]`
- **B:** `validator.ts:858` — `checkRequired(name, ["id", "given", "surname"], …)`
- **Corpus:** not tripped. Every name in all 26 fixtures and all scenario
  trees has a `given` key. `kenneth-quass` carries `given: ""`, which passes
  both — `checkRequired` tests key *presence*, not emptiness.
- **Why it matters:** a mononym is an ordinary genealogical case (early
  Scottish and Dutch records, enslaved persons in US records). A Path-3
  fixture built by hand from a research document is exactly where one
  appears.
- **Fix:** add `"given"` to `name.required` at line 61, in **both** schema
  trees. Do **not** add `minLength: 1` — `given: ""` must keep working.
- **Files:** `docs/specs/schemas/tree-gedcomx.schema.json`,
  `packages/schema/schemas/tree-gedcomx.schema.json`. Nothing else: B, C and
  D already agree that `given` is expected.

### 2. A lowercase fact `type` lints clean and hard-fails `tree_edit`

- **A:** `enums.schema.json:179` — `gedcomx_fact_type_recommended` is
  `{"type": "string", "examples": [...]}`, an open enum with no pattern.
- **B:** `validator.ts:878` — rejects any type whose first character is not
  uppercase.
- **Corpus:** not tripped. Every fact type is upper-initial.
- **Why it matters:** `research.json` uses lowercase fact types (`birth`).
  An author copying that convention across into a tree trips this.
- **Fix:** add `"pattern": "^[A-Z]"` to `gedcomx_fact_type_recommended` in
  **both** enum trees. Tighten A rather than relax B — PascalCase is
  deliberate ("preserved from GedcomX URI suffixes") and is already in the
  prose.
- **Blast radius:** this is a `pattern` add on an *open* (`recommended`)
  enum, **not** a new value on a closed one. Per CLAUDE.md the closed-enum
  rule pulls in `CLOSED_ENUMS` in `validator.ts`, the TS union, and the prose
  table — none of that applies here. Two files.

### 3. Referential integrity: A is structurally blind, B enforces

- **A** validates `parent` / `child` / `person1` / `person2` and every source
  `ref` as *non-empty strings only*.
- **B** resolves each against the document's own `persons[]` and `sources[]`
  and rejects danglers.
- **Corpus:** not tripped — all 79 committed trees resolve clean.
- **This one cannot be fixed in the schema.** JSON Schema 2020-12 has no way
  to express an intra-document reference. A typo'd `child` id will always
  lint clean and hard-fail `tree_edit`.
- **Options, in order of preference:**
  1. Have the fixture gate call `validateGedcomx` in addition to the JSON
     Schema. Correct by construction, but crosses a Python→TS boundary.
  2. Port the person/source existence checks into Python beside
     `harness/schema_validator.py`. Cheap, and duplicates ~30 lines of logic
     that must then stay in sync — the exact failure mode this document is
     about.
  3. At minimum, state in `simplified-gedcomx-spec.md` that the schema is
     intentionally weaker than the runtime validator on cross-references and
     must never be the sole fixture gate.

  Recommend (1). `author.py` already shells out to nothing; adding an
  `npx tsx` call to the `validate` subcommand is a small, honest dependency,
  and it makes the fixture gate *identical* to the runtime gate instead of
  merely similar. If that's unacceptable, (2) plus a shared test vector.

---

## Tier 2 — B accepts, A rejects. Runtime-behavior changes; own PR.

These change what `tree_edit` accepts. They should not ride along with a
schema or fixture change, and they want their own review and exercise.
None is tripped by the corpus.

### 4. `validator.ts` never enforces `additionalProperties: false`

A closes person / name / fact / both relationship types / source_reference.
B closes property sets **only for tree sources** (`TREE_SOURCE_FIELDS`,
`validator.ts:289`, used at `:822`). So `tree_edit` will cheerfully write a
person with `standrad_date` on a fact, return `ok: true`, and the document
then fails the fixture lint later, far from the typo.

The comment above `TREE_SOURCE_FIELDS` says the guard exists to catch
exactly this. It was never extended past sources.

**Fix:** add closed-key sets for the remaining objects, mirroring A's
subschemas (and `author.py`'s existing allow-lists, which already encode
them). One file: `validator.ts`.

### 5. `preferred` / `primary` / source-ref locator fields unvalidated by B

A pins `preferred` and `primary` to `const: true`, constrains `page` to a
string and `quality` to an integer 0–3. B inspects none of them, so
`preferred: false` or `quality: 5` passes `tree_edit` and fails the lint.

Bundle with #4 — same file, same character of fix, low priority.

---

## Tier 3 — types-only. Cosmetic; trivial PR whenever.

### 6. `GedcomxFact` is missing three fields the corpus uses heavily

`packages/schema/src/index.ts:370` declares `GedcomxFact` with
`id / type / primary / date / place / sources`. It omits `standard_date`,
`standard_place` and `value`, all three of which A, D, `gedcomx-convert.ts`
and the corpus carry: **587** facts across the 26 fixtures have
`standard_date`, and **42** have `value`.

No runtime or lint failure — a `tsc` gap for a future viewer/web consumer
that reads them. None does today.

**Fix:** three optional fields. One file.

### 7. Person-level `sources` — delete from the schema, don't add to the type

A permits `person.sources`. C omits it. D's table omits it. And **zero**
persons in the corpus use it; source references hang off facts and names.

This is the one place where the right move is to *narrow* A rather than
widen C. Per the repo's YAGNI convention — when two mechanisms do one job,
keep the one the real user uses — drop `sources` from `$defs/person` in both
schema trees. Confirm first that `gedcomx-convert.ts` never emits it.

### 8. `person_read` emits `source.notes`, which every other description rejects

`person-read.ts` emits a `notes` array on sources; A, B, C and D all reject
it, and `author.py`'s `normalize_tree` strips it. Both gates reject it
symmetrically, so an agent that copies a `person_read` source verbatim into
`tree_edit` gets a retry, not a silent ship. Loud, therefore low priority.

**Fix:** either stop emitting `notes` from the persisted-shaped return, or
document it as a read-only field that must be dropped before persisting.

---

## Not drifts (investigated, dismissed)

- **The two schema trees have diverged.** They have not: `cmp` reports them
  byte-identical. But nothing enforces it — no test, no Makefile target, no
  CI job — and `harness/schema_validator.py` reads only the `docs/specs/`
  copy, so a divergence would be invisible to the harness. **A one-line
  `cmp` test is worth adding** with whichever PR lands first.
## One promised test is genuinely missing

The refuters ruled 3/3 that the author-e2e plan's promised golden test was
implemented. **They were wrong, and I checked by hand.** What exists is
`test_normalization_is_idempotent` (`test_e2e_author.py:172`), which
satisfies the plan's separate *determinism* promise. The **corpus
invariant** — "for every fixture directory that has an
`unstripped-tree.gedcomx.json`, assert its `starting-tree.gedcomx.json` is a
strict subset of it, and that both validate" — does not exist. No test
iterates the fixture corpus at all.

It would be **vacuous today**: zero of the 26 fixtures carry an unstripped
tree, exactly as the plan anticipated ("Zero fixtures at first, ~50 after
the new batch lands"). So this is an unimplemented promise, not a
regression. Write it now anyway, while the reasoning is fresh — it is
self-populating, and a test that passes vacuously today is what catches the
first fixture authored next month.

This is also the clearest illustration of the caveat above: a 3/3 refuter
consensus is not evidence. Check the claim.

## Suggested sequencing

1. Tier 1 items 1 and 2 — two files each, mechanical, no behavior change to
   any existing document. Land first.
2. Tier 1 item 3 — the real work, and the one that closes the class of bug
   that motivated PR #627.
3. Tier 2 items 4 and 5 as one `validator.ts`-tightening PR.
4. Tier 3 whenever.

Add the `cmp` mirror test and the corpus-invariant test to whichever lands
first.

## Files this touches, all told

| File | Items |
|---|---|
| `docs/specs/schemas/tree-gedcomx.schema.json` | 1, 7 |
| `packages/schema/schemas/tree-gedcomx.schema.json` | 1, 7 |
| `docs/specs/schemas/enums.schema.json` | 2 |
| `packages/schema/schemas/enums.schema.json` | 2 |
| `packages/engine/mcp-server/src/validation/validator.ts` | 4, 5 |
| `packages/schema/src/index.ts` | 6 |
| `eval/harness/e2e/author.py` or `harness/schema_validator.py` | 3 |
| `docs/specs/simplified-gedcomx-spec.md` | 3, 6, 7, 8 |
| `packages/engine/mcp-server/src/tools/person-read.ts` | 8 |
| `eval/harness/tests/unit/test_e2e_author.py` | corpus invariant |

---

## Independent re-audit (2026-07-09)

A from-scratch re-audit reproduced every finding above by hand (probe
battery against both validators, with positive and negative controls;
fresh corpus scan of all 79 committed trees). Line-number cites all
verified. Three deltas:

1. **Finding #3 overstated B.** `validateGedcomx` had two referential
   blind spots of its own: it never walked person-level `sources[].ref`,
   and never validated facts on Couple relationships at all — a dangling
   source ref inside a Marriage fact passed *both* gates (silent
   corruption, worse than the Tier-1 class).
2. **Missed drift: `places`.** `merge_record_into_tree` persisted a
   top-level `places[]` section (mandated by merge-gedcomx-spec §6.7 rev. 3)
   that the tree schema, TS types, and prose spec all reject — an
   A-rejects-B-accepts drift through a shipped tool.
3. **Missed drift: `quality`'s type.** gedcomx-convert-spec Rule 10 and the
   engine's `SimplifiedSourceReference` said *string*; A, C, and D say
   integer 0–3. `toGedcomX` silently dropped every integer quality on the
   upload path (round-trip loss on the deliverable file).

The count in #6 was also low: 616 fixture facts carry `standard_date`
(587 person facts + 29 Couple facts the sweep missed).

## Implementation status (2026-07-10)

Already on `main` before implementation began (landed with the final
revisions of PR #627, after this audit's snapshot was taken):

- **#1** — `given` required in both schema trees.
- **#3** — implemented as option (2): `tree_integrity_errors` in
  `eval/harness/e2e/validate_fixture.py` (reference integrity, id
  uniqueness, living-person ToS), wired into the fixture lint, `strip`,
  and `validate`.
- The **corpus-invariant test** (`test_e2e_fixture_corpus.py`) and the
  full-corpus hard-gate test.

Landed by the follow-up PR (branch `gedcomx-schema-drift`):

- **#2** — `pattern: ^[A-Z]` on `gedcomx_fact_type_recommended` (both
  enum trees); the now-redundant PascalCase mirror deleted from
  `validate_fixture.py`.
- **#4/#5 + re-audit delta 1** — `validateGedcomx` mirrors every
  `additionalProperties: false` subschema (top level, person, name, fact,
  both relationship types, source refs), pins `preferred`/`primary` to
  true-or-absent, bounds `quality` to an integer 0–3, type-checks scalars,
  rejects non-array sections, and fully validates Couple facts including
  their source refs. The tightening immediately caught a live producer
  bug: `mergeNames` wrote `preferred: false` on every non-preferred merged
  name.
- **#6** — `GedcomxFact` gains `standard_date`/`standard_place`/`value`.
- **#7** — `sources` removed from `$defs/person` (both trees), from
  `author.py`'s allow-list, and from the merge core; the merge tools strip
  person-level refs from candidates with a warning (`sanitizeCandidate`).
- **#8** — documented in simplified-gedcomx-spec §4.3: `person_read`
  returns are not directly persistable (source `notes`, id-less
  names/relationships).
- **Re-audit delta 2** — the merge core no longer carries candidate
  `places[]`; merge-gedcomx-spec §5, §5b.2, §6.3, §6.7, §6.8 updated.
- **Re-audit delta 3** — `quality` is the QUAY integer end-to-end;
  gedcomx-convert-spec Rule 10 updated (string encoding lives only inside
  the `fsmcp:quality` qualifier).
- **Cross-gate agreement** — shared vectors at
  `docs/specs/schemas/tree-gate-vectors.json` (with passes-all and
  fails-all controls, per the negative-control lesson above), consumed by
  `eval/harness/tests/unit/test_gate_vectors.py` (schema + integrity
  gates) and `packages/engine/mcp-server/tests/validation/gate-vectors.test.ts`
  (runtime gate). Intentional seams (duplicate ids and the living-person
  rules are fixture-gate-only) are encoded as expectations, not hidden.
- **The mirror `cmp` test** — `test_schema_mirrors.py`. On its first run it
  caught two schema files already diverged on `main`
  (`run-log.schema.json`, `unit-test.schema.json` — the
  `holdout`/`grade_on_invariant` additions never reached the
  `packages/schema` mirror); both re-synced from `docs/specs/schemas/`.
