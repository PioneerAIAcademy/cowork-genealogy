# Match + Merge Workflow — Implementation Plan

**Status:** DRAFT for eng review · 2026-06-21 · branch TBD (feature branch off `main`)

**Read with:** `docs/specs/match-merge-workflow-spec.md` (the *what* — this plan
is the *how*). Also `merge-gedcomx-spec.md`, `person-warnings-tool-spec.md`,
`same-person-tool-spec.md`, and `warnings.java` (the warnings reference).
**Reviewers:** Dallan + eng reviewer.

This sequences the build of the match + merge workflow. The spec owns behavior
and decisions; this plan owns ordering, build/commit order, risk, effort, and
test strategy. No design is re-opened here — see spec §15 for settled decisions.

## Context

The spec adds two things to the existing record→tree pipeline without a new
skill: a **household-matching contract** (person-evidence) and a **coherence
gate** backed by a new **merge-mode warnings** MCP tool (`merge_warnings`).
Everything else is referenced, unchanged. Skill blast radius (spec §5.0): two
skills do real work (`person-evidence`, `proof-conclusion`), two get doc tweaks
(`check-warnings`, `tree-edit`), the rest are untouched.

## Prerequisites (human-provided — the implementing agent cannot obtain these)

- **`warnings.java`** — the production-proven source of truth for every ported
  check. Not in the repo (FamilySearch-internal). It must be made available to
  the implementer (attach to the tracking issue, or drop into a gitignored
  reference dir); do **not** commit it.
Only `warnings.java` is required. The one check whose FS source we lack —
`hasEventsOutsideLifespan` — is **defined directly in this plan** (M2/A2), not
ported, so it needs no external source.

`warnings.java` must be in hand before Phase 2 starts; Phase 0 only *confirms* it
is. If it is missing, stop and request it — do not improvise the checks from memory.

**Build & verify (commands for the implementing agent):**
- MCP unit tests: `make engine-test` (or `cd packages/engine/mcp-server && npm test`;
  single file: `npx vitest run tests/tools/person-warnings.test.ts`).
- Package + drift test: `make mcpb`.
- Skill evals: see `DEVELOPMENT.md` §"Running the eval test suite" (`eval/`).
- New-tool wiring (per CLAUDE.md): schema in `tool-schemas.ts`, dispatch in
  `index.ts`, name in `manifest.json` — the packaging drift test
  (`tests/packaging/manifest.test.ts`) enforces the last.

## Guiding principles

- **warnings.java is the source of truth — and the only production-proven code
  here.** `warnings.java` has been in production at FamilySearch; none of the
  current repo TS has shipped. Both paths follow `warnings.java`'s structure
  exactly. Where the current TS port diverges — a single-mob orchestrator that
  ignores `isFinalWarnings`, with 13 merge-only checks folded into the always-run
  list (`person-warnings.ts:217-228`) — the port is corrected to match
  `warnings.java`, not the other way around (Phase 2, A0). Dropping those 13 from
  single-person mode is **not** a production regression — that surfacing never
  shipped; we align the unshipped port to the proven behavior. The one check
  whose FS source we lack, `hasEventsOutsideLifespan`, is **defined in this plan**
  (M2/A2) rather than ported — an intentional, documented divergence to reconcile
  if the source ever surfaces.
- **Riskiest-first.** The single biggest unknown is whether the data needed for
  `hasSameCensus` (source collection titles, both sides) is actually present.
  A spike (Phase 0) settles it before we commit to the full warnings build.
- **Build standalone increments (one PR).** The matching contract (Phase 1) and
  the warnings tool (Phase 2) are independent surfaces, each independently
  verifiable — but per Dallan they all land in **one PR**. The phase/milestone
  (`M*`) labels below are commit boundaries within that PR, not separate pull
  requests.
- **Single PR ⇒ commit hygiene is load-bearing.** Since the reviewer can't split
  the work into PRs, the only way to isolate the riskiest change is by commit.
  **A0 must be an isolable commit pair** — (a) a behavior-preserving reshape to
  the `(target, candidate, merged, isFinalWarnings)` / two-method shape, then
  (b) the 13-check move + test re-home — never interleaved with the new tool,
  data-model, or skill edits.
- **The tool exists before the skill calls it.** `merge_warnings` (Phase 2)
  lands and is independently verifiable before `proof-conclusion` depends on it
  (Phase 3).
- **No behavior change without per-check tests + an eval diff.** The A0 refactor
  (§7.3) alters existing `person_warnings` output by dropping 13 merge-only
  checks. We prove the delta with per-check merge/final unit tests and back it
  with a snapshot/diff. The diff alone is insufficient — it only catches checks
  the eval corpus happens to trigger.

---

## 1. Work breakdown & dependency graph

```
Phase 0  Spike: collection-title availability ───┐ (gates hasSameCensus + EventsOutsideLifespan src)
                                                  │
Phase 1  person-evidence matching contract  ──────┼─ independent, parallelizable
                                                  │
Phase 2  merge_warnings MCP tool  ◄───────────────┘
            A0 orchestrator refactor (3-mob/2-method, follows warnings.java) ◄─ FIRST
            A1 data-model (collection titles; title field likely already exists)
            A2 EventsOutsideLifespan port → A0's always-run set
            A3 complete non-final bucket (14 checks, hasSameCensus first)
            A4 merge_warnings tool wiring (built on pure mergeGedcomx)
            A5 verify final-mode delta (per-check tests + re-home ~36 refs)
                                                  │
Phase 3  proof-conclusion coherence gate  ◄───────┘ (depends on Phase 2)
            + check-warnings / tree-edit doc updates
                                                  │
Phase 4  end-to-end validation  ◄─────────────────┘ (depends on 1 + 3)
```

Phase 1 and Phase 2 run in parallel (different surfaces, different owners).
Phase 0 gates only A1–A3's data/sources (`hasSameCensus` + `EventsOutsideLifespan`),
not A0 (the bulk of Phase 2).

---

## 2. Phases & build order (single PR)

> **Single PR (per Dallan).** Everything below lands in one pull request. The
> `M0`/`M1`/`M2a`/… labels are commit milestones within that PR — build order
> and review checkpoints, not separate pull requests.

### Phase 0 — Spike: collection-title availability  *(Size: S, ~0.5 day)*

**Goal:** answer "do the tree person's sources and the candidate record carry a
usable collection title in simplified GedcomX?" — the precondition for
`hasSameCensus` (spec §8).

- Write a `dev/` probe that loads a real census `record_read` result and a tree
  with attached census sources, and inspects where (if anywhere) a collection
  title lives on each side.
- **Decision output:** either (a) titles are present → `hasSameCensus` reads
  them directly, or (b) absent → `merge_warnings` accepts target/candidate
  titles as an explicit side input. Record the answer in spec §8.
- **Confirm `warnings.java` in hand (blocks A3).** Verify the human-provided
  `warnings.java` (see Prerequisites) is available; the implementing agent cannot
  obtain it. Confirm `hasSameCensus` + `MobMergeUtil.TITLE_DELIMITER` are fully
  covered by it, or flag what else is needed. (`hasEventsOutsideLifespan` needs no
  source — it's defined in A2.)

**M0:** probe script + confirmation `warnings.java` is in hand + a one-paragraph
finding appended to spec §8. No production code. *Exit:* the `hasSameCensus` data
path is decided and `warnings.java` is confirmed available.

### Phase 1 — person-evidence matching contract  *(Size: M, ~2–3 days)*

**Goal:** household-level matching (spec §5.3, §9), independent of the warnings
tool. **Standalone value:** higher-quality `same_person` scores → better `pe_`
evidence links right away. The always-paired `merges` set it emits has no
consumer until Phase 3, so that piece adds no standalone value yet.

- Matching-mob assembly (skill-side): focus + parents + spouses + children +
  siblings, capped at 40, for both `same_person` sides. **`person-evidence` is a
  VM skill — it cannot import the host `Mob` class.** It gathers siblings
  (children of the focus's parents) from `tree.gedcomx.json` by reasoning over
  the JSON, mirroring `getSiblings()` *semantics* (`mob.ts:228`), and applies the
  40-cap itself. `same_person` stays a pure pass-through (spec §9,
  same-person-spec:603); assembly is the caller's job, no tool change.
- Cross-person consistency check over the tentative pair-set (flag incoherent
  family assignments). **v1: feeds confidence, not a hard reject** (see §3 risk 3).
- stub-first + always-pair: unmatched personas become a stub then a *paired*
  merge entry; no unpaired carry-in.
- Update `person-evidence/SKILL.md` accordingly.

**M1:** SKILL.md + any matching-mob helper + tests. *Exit:* person-evidence
emits a coherent always-paired `merges` set; person-evidence eval green.

### Phase 2 — `merge_warnings` MCP tool  *(Size: L, ~4–5 days — the bulk)*

**Goal:** the merge-mode warnings primitive (spec §7), unit-tested and callable,
not yet wired into a skill.

> **Refactor first, then port** (Beck: make the change easy, then make the easy
> change). `warnings.java` is the source of truth. The current
> `calculateWarnings(mergedMob, isFinalWarnings)` ignores the flag (it's
> `eslint-disable`d unused, `person-warnings.ts:2186`) and deliberately folded
> the merge-only `relatives*` checks into the always-run list "since our tool has
> no separate merge-pass" (`person-warnings.ts:217-222`). This phase creates that
> pass, so those checks move back out — that is a structural reshape, not an
> additive gating tweak.

- **A0 — Orchestrator refactor (do this first; riskiest step).** Reshape
  `calculateWarnings` to `(target, candidate, merged, isFinalWarnings)` mirroring
  `warnings.java:129`, with `calculateNonFinalWarnings` split out as a `!isFinal`
  dispatch (`warnings.java:136-141`, body `:572-684`). Re-port the always-run
  checks that compare **target vs candidate separately** — today single-mob,
  wrong in merge mode: `missingFactsAndRelatives(target) ||
  missingFactsAndRelatives(candidate)` (`:143`, **stays** always-run),
  `hasEventsOutsideLifespanFar/Near(target, candidate)` (`:159`/`:237`, new — A2),
  and the `birthLikeRangeGreaterThan8(merged) && !hasSameMarriageDate(target,
  candidate)` guard (`:181`). **`hasEventsOutsideLifespanFar/Near` is a stubbed
  call-site in A0** (returns no warning); **A2 fills it** using the definition
  below — no external source needed, so A0 is never blocked.

  **Move exactly these 13 checks from always-run → merge-only** (Java's
  `calculateNonFinalWarnings`; all 13 are present in the current TS always-run
  list — pin the set **by name**, not by comment region, or an always-run check
  gets dropped by accident and the single-person guardrail silently loses it):
  - 10 `relatives*`: `relativesBirthLikeRangeGreaterThan8`,
    `relativesChildBirthRange40`, `relativesHasEarlyMarriage14`,
    `relativesTooManyBirthDates2`, `relativesTooManyDeathDates2`,
    `relativesHasBurialAfterDeath31`, `relativesHasLateMarriage90`,
    `relativesHasEventBeforeBirth365_2`, `relativesHasEventAfterDeath1`,
    `relativesHasBurialBeforeDeath`.
  - 3 non-relative: `missingSurnames`,
    `missingGivenNamesWithoutExactBirthLikeDate`, `hasCloseChildChristenings6_30`.

  **Everything else stays always-run** — in particular the ~17 always-run
  `relatives*` checks (`relativesDeathRangeGreaterThan2`,
  `relativesEarliestChildBirthToBirth12`, `maleRelativesEarliestChildBirthToBirth14`,
  `relativesHasAgeRangeGreaterThan120`, `maleRelativesHasDiffSurname`, …) do **not**
  move. (Note: `hasSameCensus` is the 14th non-final check but is **new** — A3 —
  not a move.)

  Single-person `personWarnings` keeps its behavior via `getWarnings(mob, mob,
  mob, isFinalWarnings=true)` (`warnings.java:118`) — final-mode output is
  unchanged **except** the intended drop of those 13, which A5 verifies.
  **Decision (settled, not open):** single-person `check-warnings` stops
  surfacing the 13, to match `warnings.java`. Not a production regression — the
  TS surfacing them never shipped (see guiding principles).
- **A1 — Data-model (collection titles for `hasSameCensus`)** per Phase 0's
  decision. Note: `SimplifiedSourceDescription.title` **already exists**
  (`gedcomx.ts:161`), so this is likely a near-no-op on the schema — Phase 0 is
  about title *population*, not adding a field. Touch the three places
  (`research.schema.json`, prose table, `validator.ts`) only if a new field
  turns out to be required.
- **A2 — Define `hasEventsOutsideLifespan`** (drives
  `hasEventsOutsideLifespanFar/Near`; fills the stub A0 created). We lack the FS
  source, so it is **defined here, not ported** — an intentional divergence,
  reusing existing helpers (`getSelfEventDayRanges`, `BIRTHLIKE`/`DEATHLIKE`,
  `getEarliest`/`getLatest`), no new primitives. It catches the
  *self-consistent-but-different-person* case the merged-mob after-death/
  before-birth checks miss (the union heals the contradiction; this compares the
  two mobs pre-merge).

  ```
  hasEventsOutsideLifespan(target, candidate) -> "none" | "near" | "far"
    lifespan(M) = [ earliestBirthLikeDay(M), latestDeathLikeDay(M) ]  // open if a bound is missing
    check BOTH directions: target events vs candidate lifespan, and candidate events vs target lifespan
    for each dated non-birth/death event day E vs window [lo, hi]:
        outside under STRICT (point) but inside under GENEROUS (range + imperfect-date fudge) -> NEAR
        outside even under GENEROUS                                                            -> FAR
    return the worst severity found      // FAR -> error/block, NEAR -> warning/advisory
  ```

  NEAR/FAR is keyed to **date precision** (strict vs generous interpretation),
  not an invented year cutoff — consistent with how every other check treats
  imperfect dates. Severities map to spec §10 (`…Far` error, `…Near` warning).
  Folds into A0's always-run set.
- **A3 — Complete the non-final bucket.** Port the genuinely-new checks into the
  `calculateNonFinalWarnings` slot A0 created — `hasSameCensus` first (spec §7.2,
  the strongest census bad-merge signal) — alongside the Tier A/B `relatives*`
  A0 moved in. 14 total.
- **A4 — `merge_warnings` tool.** Read-only `merge_warnings({ projectPath,
  candidateGedcomx, merges })` built on the pure `mergeGedcomx`. **Gate-validity
  invariant:** `merge_warnings` and `merge_record_into_tree` both call the same
  pure `mergeGedcomx` with the identical `merges` shape (`[treeId, candidateId]`),
  so the dry-run merged mob is identical to the persisted merge — that
  equivalence is what makes the coherence gate trustworthy. Wire into
  `tool-schemas.ts`, `index.ts`, `manifest.json`; add `dev/try-merge-warnings.ts`.
- **A5 — Verify the final-mode delta (regression-critical).** The behavior change
  is moving the 13 checks (A0) out of single-person output. The eval snapshot/diff
  is **necessary but not sufficient** — it only catches checks the corpus happens
  to trigger. Add per-check unit tests asserting each of the 13 moved checks + the
  new merge-only checks **fires in merge mode and is silent in final mode**.
  `person-warnings.test.ts` has **~36 references** to the moving checks (30 to the
  10 `relatives*`, 6 to `missingSurnames` /
  `missingGivenNamesWithoutExactBirthLikeDate`; `hasCloseChildChristenings6_30`
  currently has none) — re-home all of them (final-mode assertions flip to "silent
  in final, fires in merge"). Mandatory Phase-2 regression work, not a follow-up
  (IRON rule).

**M2a:** A0 (as the isolable commit pair — behavior-preserving reshape, then the
13-check move + test re-home) + A1 + A2 + the A5 verification of A0's final-mode
delta — the behavior change and its regression tests land together.
**M2b:** A3 + A4 (new checks + tool wiring + try-script + packaging). *Exit:*
`merge_warnings` returns correct warnings for the §3 scenario via
Inspector/try-script; `hasSameCensus` blocks same-census personas; single-person
`person_warnings` output changed only by the intended merge-only drop; packaging
drift test green.

### Phase 3 — Coherence gate wiring  *(Size: M, ~2 days)*

**Goal:** turn the capability into workflow behavior (spec §5.4, §6, §7.6).

- `proof-conclusion/SKILL.md`: call `merge_warnings` after the identity gate and
  before `merge_record_into_tree`; apply error-block (override, logged) /
  warning-advisory; drive tiered HITL (plan-confirm when clean, escalate on
  warning or low score). Add `merge_warnings` to `allowed-tools`.
- `check-warnings/SKILL.md`: remove the "does NOT cover merge-mode" caveat;
  point at the new pre-merge capability (one-line update; stays post-merge owner).
- `tree-edit/SKILL.md`: reframe the unpaired-carry-in note as "direct tree-edit
  use outside the pipeline."
- **Idempotency / re-merge no-op (spec §11).** Before merging, `proof-conclusion`
  checks `source_attachments` (already-attached detection) + research-log state
  so re-processing an already-merged census is a detected no-op, not a duplicate
  Mary. `hasSameCensus` is the backstop, not the primary guard. Without this the
  failure is silent: a second run duplicates the new person.

**M3:** the three SKILL.md updates + the idempotency guard in `proof-conclusion`.
*Exit:* proof-conclusion gates merges on coherence and re-merge is a detected
no-op; proof-conclusion eval green.

### Phase 4 — End-to-end validation  *(Size: S–M, ~1–2 days)*

**Goal:** prove the full chain.

- Integration test of the §3 scenario: match → coherence gate → merge →
  post-merge warnings; assert Mary added once, John/Susan/William updated.
- **Planted-impossibility test at the integration layer** (deterministic
  `merge_warnings` inputs — target + candidate + merges you fully control), e.g.
  a census event after the tree person's death → gate must block. **Not an e2e:**
  `eval/tests/e2e/` runs against live FamilySearch (`eval/README.md:213`), so a
  planted contradiction is unreliable and drifts with FS data.
- e2e fixture under `eval/tests/e2e/` for the **happy** census-household merge
  path (match → gate clean → merge), exercising the full chain against live FS.

**M4:** integration test + e2e fixture. *Exit:* both pass.

---

## 3. Risk register (ordered)

1. **Collection-title data absent** → `hasSameCensus` can't read titles. *Phase 0
   de-risks.* Fallback: side-input plumbing in `merge_warnings` (small added
   scope); `hasSameCensus` degrades to no-match when titles are absent (never
   throws).
2. **Orchestrator refactor regresses `person_warnings`.** Moving the 13 merge-only
   checks (10 `relatives*` + `missingSurnames` +
   `missingGivenNamesWithoutExactBirthLikeDate` + `hasCloseChildChristenings6_30`)
   out of single-person output is the intended A0 delta, but the snapshot/diff
   alone is insufficient — it only catches checks the eval corpus triggers.
   Mitigation: per-check merge/final unit tests (A5) + re-homing the ~36 existing
   test refs; pin the move-set by name (not by comment region) so no always-run
   check is dropped by accident. The diff is a backstop, not the proof.
3. **Cross-person consistency false-positives** (over-flagging coherent
   families). Mitigation: v1 feeds confidence rather than hard-rejecting; tune on
   the person-evidence eval corpus before considering a hard gate.
4. **`same_person` payload bloat** from large households. Mitigated by the 40-cap
   (§9); watch for API 400s on very large families.
5. **Non-English census titles** — `warnings.java` itself TODOs this. v1 ships
   the English `"Census"` substring test; note the gap, don't solve it now.
6. **Re-merge duplicates a new person** if idempotency isn't enforced (spec §11).
   Mitigation: the Phase 3 `source_attachments` pre-merge check; the failure is
   silent (a duplicate Mary) otherwise.

---

## 4. Sequencing & parallelism

- **Critical path:** A0 → A3/A4 → Phase 3 → Phase 4. Phase 0 is a **parallel
  ~0.5-day spike**, not on the critical path — it gates only the data/sources for
  `hasSameCensus` and `EventsOutsideLifespan` (A1–A3), not the A0 reshape (the
  bulk of the work).
- **Off critical path:** Phase 1 (matching) runs alongside Phases 0–2; it has no
  dependency on `merge_warnings`.
- A single implementing agent works the critical path in order (A0 → A3/A4 →
  Phase 3 → Phase 4); Phase 1 is independent and can be done before or after the
  warnings tool. (If split across two people: one takes Phase 1, one takes
  Phase 0→2, converging at Phase 3.)
- Rough total: ~2 weeks for one engineer/agent; ~1.5 weeks with a parallel split.
  (Eng review to calibrate.)

## 5. Definition of done

- `merge_warnings` shipped in the `.mcpb`, in `manifest.json`, drift test green.
- `person-evidence` emits coherent always-paired merges; `proof-conclusion`
  blocks on coherence `error`s with override; tiered HITL in place.
- Single-person `person_warnings` output unchanged except the intended removal of
  the 13 merge-only checks — proven by per-check merge/final unit tests (not the
  A5 eval diff alone) and the ~36 re-homed test refs.
- Re-merge of an already-attached census is a detected no-op (Phase 3
  idempotency guard).
- Integration + e2e (planted-impossibility) tests pass.
- spec §8 updated with the Phase 0 finding; spec §7.3 audit resolved.

## 6. Not in this plan (spec §14)

Selective field-level merge tooling; `tree_edit` source-write ops; per-sibling
relative-mobs; attach-source-only incorporation. Whole-fold remains the default.

## 7. Open questions for eng review

- Phase 0 outcome: direct title read vs. side input — confirm scope impact.
- Cross-person consistency: confidence-input (recommended v1) vs. hard reject —
  agree the v1 stance.
- Effort calibration and the one-vs-two-engineer split.
