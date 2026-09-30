# flynn-skip-categorized

Fork of `flynn-skipped-death-cert` with exactly two changes: each of its
two skipped items gains the `skip_category` and `skip_reason` that issue
#1830 added to `plan_item`. Nothing else differs -- same evidence, same
log, same tree.

- **pli_005** (death certificate): `skip_category: "inaccessible"`.
  Schuylkill County's pre-1906 death records burned in the 1920
  courthouse fire, the State Archives holds no duplicates for this
  county and period, and no online or mail-order path exists. The
  source was pursued and could not be reached.
- **pli_009** (naturalization): `skip_category: "unnecessary"`.
  Naturalization records rarely name children and three independent
  sources already establish the parentage. The source was disposed of
  on judgement, not pursued.

Both `skip_reason` strings restate what each item's own `rationale`
already said in prose. That is deliberate -- the fields carry the same
claim in a form the gate can read, and the scenario is here to show the
gate reading them.

**What it tests (issue #1830, Defect 1).** Two things at once:

1. **The accept direction.** A plan carrying `skip_category` on several
   items still reaches a declaration. The categories are new and
   optional; adding them must not make a declarable question
   undeclarable.
2. **The categories land on opposite arms.** `inaccessible` on pli_005 is
   eligible for the *pursued-and-unavailable* exception, whose own
   conditions (only-known-avenue, accessible evidence already
   sufficient) still decide. `unnecessary` on pli_009 is not eligible
   for it at all -- but pli_009 needs no exception, since nothing turns
   on it.

**Why this is a fork and not an edit of `flynn-skipped-death-cert`.**
That scenario's README says `ut_research_exhaustiveness_012` "grades
exactly one distinction -- whether a skipped record type's non-existence
is *confirmed* or merely *assumed*". Writing `skip_category:
"inaccessible"` onto pli_005 in place would hand `_012` the answer to
the only question it asks. The original is left untouched.

**Inherited from `flynn-skipped-death-cert`**: the will (src_005) as the
direct primary evidence replacing the death certificate, the removed
birthplace conflict, and pli_008 searched rather than skipped. See that
scenario's README for each.

Used by: ut_research_exhaustiveness_d7g (categorized skips still declare).
