# record-extraction reliability via a tolerant tool boundary — plan (v2)

> **Status:** v2 after adversarial 4-lens review (2026-07-16). v1's verdict was
> **go-with-revisions**; two change items were unsound and are corrected/cut
> here, the `p^N` framing is retired as numerology, and the pass-rate ceiling is
> revised sharply down and made honest. Review findings incorporated inline; the
> panel's full memo is summarized in §12. Reviewers were right on the substance —
> this v2 is a much smaller, better-grounded change than v1.
>
> **Implementation status (branch `rx-tool-boundary`, off main):** the THREE
> grounded core items are IMPLEMENTED + unit-tested (234 Vitest green across the
> four touched files): **4.3** (`plan_item_id` reject + validator prefix-gap),
> **4.4** (`name`→`names[]` lift + both-present guard), **4.6** (`access_date`
> ISO normalizer). **4.1' and 4.5 were CUT** — a runlog audit found *zero* of
> 230 `date_certainty` values and *zero* enum-casing rejects across all 5 runs,
> so both were speculative fixes with no failure grounding (the session's core
> lesson: don't build unmotivated fixes). Every implemented item was verified
> against the actual runlogs before coding: 4.4 hit 19/129 `add_person` calls,
> 4.6 hit 6/75 `access_date` values, 4.3 hit ut_002/013 every run.

## 1. The problem, stated as data

record-extraction passes at **38%** on its latest releasable runlog — a
**38-point outlier** (next-worst skill 76%; 14 of 26 skills at 100%). It is the
only skill in trouble, so the cause is not the harness/judge/rubric conventions
25 other skills share. Across five full-suite runs today, **12 of 16 tests flap**;
two byte-identical Haiku runs swung **6 fails → 0 fails**.

## 2. Root cause — corrected (v1's `p^N` was numerology)

**What is structurally unique (measured):** record-extraction makes ~5 tool
calls and writes **~12 assertion objects** per test; every other writer makes
0.6–1.2 writes and zero multi-field assertion objects. It hand-serializes far
more strict-schema surface than any peer.

**But the failures are NOT ~100 independent coin-flips** (v1's `0.99^100≈37%`
story). The review re-classified all 48 non-pass events across the 5 runs and
found the drivers are **a handful of discrete, correlated, reproducible shape
habits plus genuine judgment variance** — not per-field randomness:

- `access_date` in the wrong format (`"12 July 2026"` vs ISO) failed **4
  source-writing tests at once** in one run — one habit, correlated.
- `plan_item_id: "q_001"` fails identically in ut_002 across multiple runs.
- `name`/`nameForms` vs `names[]` on `add_person` recurs.
- **Zero** runs show a random enum-casing/synonym reject.

The corrected thesis: **a small set of systematic serialization habits accounts
for the deterministic shape failures; the rest is real judgment variance** on the
classification the LLM is actually doing. That reframing narrows the fix from a
broad tolerant boundary to **a few targeted coercions**, and — critically — bounds
what the fix can achieve (§8).

## 3. Design principle (unchanged — but v1 misapplied it)

**LLM supplies judgment/content; tool owns shape/derivation.** SHAPE =
serialization form, casing, id-format, array-vs-scalar wrapping. JUDGMENT = the
*value* of a graded field (`evidence_type`, `informant_proximity`,
`information_quality`, the `_inferred` axis, the `value` text). The line is
load-bearing for §7 — and v1 filed two items (`_inferred` derivation, the
closed-judgment-enum synonym map) on the *shape* side when they sit on the
*judgment* side. v2 moves them back.

## 4. The change list (v2)

### KEEP — genuine shape fixes, grounded in the failure data

**4.3 — `plan_item_id` (`research-log-append.ts` + `validator.ts`).**
- **Close the validator gap:** `validator.ts`'s log-entry loop validates
  `question_id`/`log_entry_id`/`source_id` but **never** `plan_item_id` against
  `ids.plan_items` — add the `^pli_`/ref check so the tool-side and
  schema-side validators agree (the drift CLAUDE.md warns about). **Keep this.**
- **Tool coercion — REJECT, do not null.** v1 said "coerce a non-`pli_` value
  to null" and justified it with "the question link lives in
  `extracted_for_question_ids`." **That justification is factually false:** log
  entries have no `extracted_for_question_ids` field (only assertions do —
  `validator.ts:391`), so nulling a `q_001` silently discards the LLM's only
  expressed search→question link. **Corrected:** keep the existing `"null"`→null
  string coercion (lossless); for a `q_`/free-text/non-`pli_` value, **return an
  actionable error** ("that is a question id — supply the `pli_` plan-item under
  it, or null"). Deterministically fixes ut_002/ut_013's schema fail by making
  the bad write impossible-and-explained rather than silently persisted.
- **Note (document-global tightening):** `validate_research_schema` runs the
  whole log on every write from every skill, so a pre-existing dangling `pli_`
  in a *live project* newly fails the next write by *any* skill. Fixtures are
  clean, so eval CI won't surface this — flag it in the spec + release notes.

**4.4 — `name`→`names[]` lift (`tree-edit.ts add_person`).** Accept a singular
`name: {given, surname, preferred?}` (or `nameForms`) and lift to `names: [{…}]`
before validation. Shape-only (object→single-element array; NOT flat-string
parsing). **Guard (review):** if the caller supplies **both** `name` and
`names`, reject loudly rather than silently pick one (the downstream
one-preferred normalizer would otherwise get ambiguous input). Kills the #1
recovered-retry driver (ut_001/ut_003).

**4.6 — `access_date` normalizer (NEW — `research-append.ts` source op).** v1's
own headline example was never in v1's fix list: `normalizeDateFields` only
touches `date`/`standard_date`, never a source's `access_date`, which the
validator requires as ISO `^\d{4}-\d{2}-\d{2}$`. A free-text `access_date`
(`"12 July 2026"`) tanked 4 tests in one run. Add a source-op date normalizer
(parse common human forms → ISO; leave already-ISO untouched; reject only the
genuinely unparseable). Highest-value shape fix by observed incidence, and it
was missing.

**4.1′ — `date_certainty` casing only (`research-append.ts`).** Trim + lowercase
`date_certainty` (safe: `Estimated`→`estimated` is the same value). **CUT the
synonym map on the three closed judgment enums** (`evidence_type`,
`informant_proximity`, `information_quality`): zero runs failed on their casing;
every enum failure is a wrong *value* (judgment 4.1 doesn't touch); and they are
exactly what the rubric grades byte-exact — highest risk, zero measured benefit.
Defer until a real casing reject is ever observed.

### CUT — v1 items that were unsound or valueless

**4.2 (derive `_inferred` from `evidence_type`) — CUT.** The blocker: `_inferred`
(relationship deduced from household position — no relationship column, 1790–1870
census) and `evidence_type: indirect` (any indirect evidence) are **orthogonal
axes** per `research-schema-spec.md`. Deriving one from the other silently mints
`father_inferred` on an explicitly-named death-cert parent and strips a correct
`child_inferred` whenever the LLM marks the assertion `direct` — a **value
change** that violates §7's own invariant and propagates to conflict-resolution,
which consumes `structured_value.relationship_type`. The `_inferred` decision is
**genuine judgment**; the tool cannot reliably derive it (it can't reliably know
the census year, and can't derive the base token child/spouse/parent at all).
**The correct lane is the agent-body `_inferred` prose edit already in this
branch** (it demonstrably stopped ut_013 failing `test_1850_census_uses_inferred_suffix`),
with that deterministic validator retained as the independent coherence check.
Do NOT auto-fill a validated field from a sibling judgment field.

**4.5 (default `extracted_for_question_ids` → `[]`) — CUT.** Flips zero tests;
not worth the surface. (Trivially foldable later if ever wanted.)

## 5. Corrected blast radius (§6 of v1 was wrong)

- **Web mirror: ZERO sites fire.** v1 claimed 4.3 hits a hand-maintained
  `validate_research_schema` in `packages/schema` — **that file does not exist**;
  the web side has only a declarative JSON Schema + hand-typed TS types (no
  runtime validator). `validator.ts` is the sole hand-maintained runtime
  validator. No schema/enum value is added, so the mirror blast radius does not
  fire at all.
- **Code:** `research-append.ts`, `research-log-append.ts`, `tree-edit.ts`,
  `validation/validator.ts` — all have Vitest suites; extend them.
- **Specs:** research-append, tree-edit, research-schema (`plan_item_id`
  validation + the document-global note).
- **Other callers** (proof-conclusion, person-evidence, merge tools, tree-edit
  skill, `/research`): normalization is additive/idempotent (a caller already
  canonical is a no-op), so behavior is unchanged — CI + spot-checks confirm.

## 6. Anti-gaming (v2 — now covers the deterministic validators too)

v1's §7 argued only against *rubric* dimensions; the review correctly noted
record-extraction also ships **deterministic Python validators**
(`test_record_extraction.py`), one of which grades the `_inferred` suffix
directly. The v2 change list only touches genuine shape (`plan_item_id` format,
`name` array-wrapping, `access_date` ISO form, `date_certainty` casing) — **none
of which any rubric dimension OR any deterministic validator grades as a
judgment.** The two v1 items that *did* touch a validated/graded value
(`_inferred` derivation; closed-enum synonyms) are cut. So the eval retains full
power to fail a skill on: wrong `evidence_type`/`informant`/`information_quality`
*value*, non-atomic assertions, missing persons, and the `_inferred` coherence
check. We remove only the eval's power to fail on serialization form, which was
never a quality signal.

## 7. (folded into §6)

## 8. Honest ceiling — this reaches ~50–75%, and judgment dominates the rest

The review's grounded projection over the 5 runlogs, respecting the harness rule
that a run passes **only if every dimension scores 3** (`orchestrator.py:848`):

- **v2 shape fixes (4.3+4.4+4.6) applied perfectly → ~50% run-level / ~44% modal
  pass**, up from 40%/25%. They convert deterministic *fails* → *partials/passes*
  on the two-three tests whose blocker is pure shape (ut_001/002/003/013).
- **Whole-program ceiling (every shape issue removed, incl. the deferred geocode
  bug) → ~66% run-level / ~75% modal.** Four tests (ut_009/010/014/016) are
  blocked on **pure judgment** (wrong `evidence_type`/informant *values*) that no
  tool change touches.

**Conclusion the user must weigh:** even done perfectly, this work gets
record-extraction to **reliably pass-or-partial on shape, ~50–75% pass, with the
residual concentrated on genuine classification calls.** That is the honest
end-state — green on plumbing, still discriminating on craft, which is what a
good eval for a hard 12-assertion task should look like — but it is **not** the
75–90% v1 promised, and it is **not** "always pass." Reaching higher means
craft/rubric work on the judgment fields (§9), not more tool tolerance.

## 9. Re-evaluation of the earlier recs 2–4

- **Rec 2 (geocode quality bug): SEQUENCE AHEAD of the low-value items, not
  after.** It drives ut_005/006/009/010 partials, normalization can't fix a wrong
  geocode, and it's part of the 66–75% ceiling. Batch country cross-check /
  sidecar staging. Higher priority than v1 gave it.
- **Rec 3 (split the skill / remove tree-mutation): still DEFERRED.** 4.4 handles
  the tree-write shape reject; the residual is 1/5 jitter. Only split if
  tree-writes still fail after 4.4.
- **Rec 4 (recovered-retry scoring): the real partial→pass lever, sequenced after
  the shape fixes.** With rejections turned to normalizations, re-measure whether
  the policy still manufactures partials; it, plus judgment craft, is what could
  push past the 75% ceiling.

## 10. Sequencing, DoD, and a FIXED acceptance test

**Sequence:** 4.3 (validator gap + reject) → 4.4 (name-lift, guarded) → 4.6
(access_date) → 4.1′ (date_certainty casing). Each with a Vitest proving
reject→normalize/error and value-preservation. Then the geocode fix (rec 2).
Full engine Vitest green; other skills' suites unaffected.

**Acceptance test (v1's was un-falsifiable — corrected):**
- **Predict ~50% run-level for the shape fixes; 66–75% whole-program ceiling.**
- **Three branches, not two:** ~50% with residual partials on *judgment*
  dimensions = **on-target** (thesis confirmed); ~100% green = **over-reach**
  (a shape fix leaked into judgment — roll back); **barely moved from 40%** =
  **shape was not the dominant driver** — pivot to judgment craft + rec 4.
- **Per-fixture over-reach signal**, not an aggregate threshold: check that
  fixtures which *should* discriminate on judgment (ut_009/010) did **not** go
  green. Aggregate ~100% is masked by judgment variance and is a weak signal.
- **Run the acceptance re-run N>1** (a scratch multi-run, not a committed
  `runs_per_test` bump) — a single run on a flapping suite proves nothing.

**DoD:** ut_002/ut_013 no longer fail on `plan_item_id`; the `name`/`names` and
`access_date` recovered-retry/reject classes are gone from the run log; a
correct-judgment run persists byte-identical `research.json`/`tree.gedcomx.json`
to the pre-change canonical form (proves shape-only, no fabricated content).

## 11. Risks

- **Still only ~50–75% even if perfect** — accepted and surfaced (§8); the user
  decides whether that's the bar for this suite before we build.
- **`access_date` parser mis-parses an exotic date** — reject-not-guess on
  unparseable; Vitest the common forms.
- **Document-global `validator.ts` tightening** hits live projects with a
  dangling `pli_` — noted in spec/release notes; not a CI-visible regression.
- **Measurement noise at N=1** — the fixes reduce the shape share of the noise;
  residual judgment variance is the (smaller) remaining case for multi-run
  aggregation, a separate decision.

## 12. Adversarial review disposition (4 lenses)

Verdict: **go-with-revisions, high confidence.** Blockers, all incorporated:
**B1** — 4.2 conflates orthogonal axes and corrupts a graded value (CUT; agent
prose already covers it). **B2** — 4.3 silently discards the search→question link
and its justification was false (REJECT-not-null; false mitigation deleted).
Biggest hole — the acceptance test couldn't tell success from failure and the
75–90% prediction was ~25 points high (FIXED: ~50% prediction, 3-branch
per-fixture N>1 test). Factual corrections — no web-mirror validator exists
(zero mirror sites, not one); `access_date` was cited but unfixed (added as 4.6);
several "shape" partials are the deferred geocode bug (excluded from the count,
geocode sequenced ahead). Cheaper-scope finding — 4.3+4.4(+4.6) capture the
entire realized lift; 4.1-enums and 4.5 flip zero tests (cut).
