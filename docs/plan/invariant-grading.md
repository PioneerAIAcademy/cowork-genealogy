# Invariant grading for routing-flaky negatives

**Status:** mechanism merged (#580); application in progress (this branch).
**Scope:** `negative.grade_on_invariant` boolean; `_compute_outcome`; schema; 2 tests.

## Problem

A handful of negative tests are *routing-flaky*: the correct behavior is
"don't harm state," but which skill fires legitimately varies run to run.
Their real invariant ("no new source is fabricated," "no `record_search`,
no writes") is deterministic and always holds — but the harness graded
them on **routing** (did the skill under test activate / did an accepted
`correct_skill` fire), so single-run routing variance flipped them
red/green and they had to be parked as `xfail`.

Two tests are in this bucket:

| Test | Invariant that always holds |
|---|---|
| citation `_012` (refuse-new-source) | citation never inserts a new `src_` |
| search-records `_005` (negative-research-plan-request) | no `record_search`, no new search log / sidecar |

`correct_skill: []` (out-of-scope) can't express them either — several
routes are *acceptable*, not zero, so the "skills_invoked must be []"
rule structurally fails them.

**Excluded — citation `_011` (evidence-quality routing).** An earlier
draft listed `_011` here too, but it has no state-mutating invariant to
grade on. citation's `allowed-tools` is `[validate_research_schema]`, so
no citation run can write a source; and `_011`'s scenario (a "is this
informant primary or secondary?" question) routes to
assertion-classification, which writes only `assertions`, never a `src_`.
The `no-new-source` validator therefore *can never fail* on `_011`, so
`grade_on_invariant` would be a guaranteed green that asserts nothing
(the vacuous-pass mode below) — strictly worse than `xfail`, because it
hides that the routing is still unverified. `_011` stays `xfail`: its
flake is pure routing with no deterministic invariant underneath.

## Options considered

1. **Leave as `xfail`** — permanent blind spots; the invariant is never
   actually asserted, just ignored.
2. **New `test.type: "invariant"` enum** — cleanest conceptually but
   ripples into the schema `allOf` conditionals, the loader, the judge
   routing, *and* the CRUD authoring UI (form + generated Zod + hand
   types). Heavy for three tests.
3. **`negative.grade_on_invariant` boolean** *(chosen)* — a negative test
   that opts into being graded on its deterministic validator(s) alone.
   One schema field, one `_compute_outcome` branch, no new type, no
   required CRUD-UI work.

We chose (3): minimal blast radius, and it composes with the existing
negative-test machinery (a `grade_on_invariant` test is still a negative
test with `correct_skill`/`explanation`, just graded differently).

## Mechanism

`negative.grade_on_invariant: true` (optional, default false). When set,
`_compute_outcome`'s negative branch returns `pass` as soon as it is
reached — which, by construction, means **not aborted** and
**`validators_passed`** (both gate earlier in the function). Routing and
activation are intentionally not consulted.

```python
else:  # negative
    if (spec.negative or {}).get("grade_on_invariant"):
        return "pass"   # graded solely on validators, which gated above
    if activated:
        return "fail"
    ...
```

The boolean rides inside the `negative` dict, which `TestSpec` already
carries wholesale — so no loader dataclass change is needed.

## The one sharp edge: the invariant must actually be enforced

`grade_on_invariant` makes the **validators the sole gate**. If a test
sets the flag but has no tag-gated validator that actually runs, then
`validators_passed` is vacuously true and the test **always passes** —
a silent blind spot worse than `xfail`.

So the contract is: **every `grade_on_invariant` test must carry a tag
that gates a real, non-skipped invariant validator** in
`eval/harness/validators/test_<skill>.py`.

- citation `_012`: the `no-new-source` validator (asserts no new `src_`
  id appears) — un-skipped for any `no-new-source`-tagged negative.
- search-records `_005`: the `no-search-no-write` validator (asserts no
  `record_search` call, no new search log entry, and no `results/`
  sidecar) — added with this change, gated on the `no-search-no-write`
  tag. It deliberately does *not* flag `plans`/`questions` writes, so a
  correct route to research-plan still passes.

This constraint is currently enforced by review + convention. If it
proves fragile we can add a lint (a `grade_on_invariant` test must carry
a recognized invariant tag) or pass validator-ran-count into
`_compute_outcome`; deliberately deferred to keep the first cut minimal.

## Failure modes are safe

- **Flag dropped by a UI round-trip.** The CRUD form doesn't model the
  field; `writeTest` preserves it, but a future form rewrite could drop
  it. If dropped, the test reverts to *routing-gated* grading — strictly
  **stricter**. Worst case it reintroduces the flake we removed; it can
  never produce a false green.
- **Missing validator (the sharp edge above).** Vacuous pass — the only
  unsafe mode, hence the hard contract above.

## Rollout

- **Mechanism** (this change): schema field + orchestrator branch +
  harness unit tests + this note. All outside the runlog snapshot →
  **no skill re-runs**, gate stays green.
- **Application** (the 2 tests + the search-records validator): edits
  test JSON → flips citation + search-records runlogs inactive → owes a
  re-run + re-annotation. Batch per skill.
- **#578 + #580 (done):** citation `_012` was un-xfailed and re-annotated
  on #578; the mechanism landed on #580. This branch was cut from `main`
  after both, so `_012` starts un-xfailed and `grade_on_invariant` is
  available — no conflict, single citation re-run.
