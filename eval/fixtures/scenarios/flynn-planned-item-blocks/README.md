# flynn-planned-item-blocks

Fork of `flynn-exhaustive-ready` with exactly two changes, both on `pl_002`:

- **`pl_002.status`**: `completed` -> **`active`**.
- **`pli_010`** added: St. Patrick's (Minersville) marriage register,
  `status: "planned"`, never executed. No log entry, no assertion, no
  source -- nothing was searched.

Everything else is identical to `flynn-exhaustive-ready`, which declares.
That is the point: the *only* difference between a scenario that declares
and this one is a single undisposed plan item on the active plan.

**What it tests (issue #1830, Defect 2).** The lead's 2026-09-02 ruling
is that a `planned` item blocks declaration. Until that ruling shipped,
the gate's precondition named `in_progress` alone, so a `planned` item
passed straight through and a declaration could be written over a source
nobody had searched. The evidence here is otherwise complete -- three
independent sources establish the parentage, the conflict is resolved,
both negatives are documented -- so a gate checking only `in_progress`
has every reason to declare. It must refuse and name `pli_010`.

**Why the added item is corroborating, not decisive.** `pli_010` would
*confirm* parentage already evidenced rather than being the only avenue
to it. That keeps the refusal attributable to the item's **status** and
not to an evidentiary hole. Had the unsearched item been decisive, the
pre-fix gate would have refused it too -- on `overturn_risk` or the
decisive-record rule -- and the test could not have failed in the
pre-fix direction, which is the direction it exists to prove.

**Not a skip.** `pli_010` carries no `skip_category` and no
`skip_reason`: it is `planned`, the undisposed state. The
category-bearing cases live in `flynn-skip-categorized`.

**Inherited from `flynn-exhaustive-ready`** -- the parentage evidence,
the resolved birthplace conflict, `ps_001` at `probable`, and the
searched-negative baptismal register (`log_007`, pli_008) that keeps the
refusal from being about an assumed-away record type. See that
scenario's README for why each of those is as it is.

Used by: ut_research_exhaustiveness_d6f (planned item blocks declaration).
