# ma-birth-skipped-answered

Fork of `ma-birth-record-unsearched` with **one change**: a sixth plan item,
`pli_006`, for Ida's own 1875 Taunton birth registration -- `skipped`, with
`skip_category: "answered"` and a `skip_reason` saying the 1946 death
registration already names both parents.

**The reject half of the check-6' pair for issue #1830.** The accept half is
`decisive-skip-inaccessible`.

## What it asserts

Massachusetts kept statewide civil registration from 1841, so Ida's own birth
registration **exists and can be obtained**. The decisive-record rule permits
a declaration only once that record has been *searched* or *explicitly
justified as inaccessible*. `answered` is neither: it records a disposal on
judgement. So the gate must refuse and route back to `research-plan`.

The judgement in `skip_reason` is not a strawman -- the death registration
really does name both parents, and that is exactly the argument a researcher
would offer. It is still not enough, which is the point: the decisive-record
rule exists because the subject's own birth record is the one source that
could overturn a derivative one, and "we already have it from elsewhere" is
the reasoning it is designed to refuse.

## Why this is not a fork of `recent-birth-sealed` (the first attempt, discarded)

The first version of this fixture relabelled a privacy-**sealed** Utah birth
certificate as `answered`, so that it and its accept twin differed on two
fields and nothing else. It failed on `v1_2026-09-30_18-26-29`, and the run
showed why: the agent read Utah's 100-year embargo off the wiki page,
**supplied the inaccessibility justification itself**, and declared. Its
`repository_breadth` assessment called the certificate "privacy-sealed... and
therefore inaccessible" though no prose in the fixture said so.

It was arguably right. The record really is sealed, so `answered` was a
lie about the world, and a label that contradicts a fact the agent can look up
can never bind. With one underlying record, one of the two labels always has
to lie -- which is why the pair now uses two records, each correctly
labelled, rather than one record with the label flipped.

**The cost, stated rather than glossed:** the two halves are no longer
identical-but-for-two-fields, so neither alone isolates `skip_category` as the
sole variable. Their discriminating power is joint. A gate that ignores the
new fields fails `decisive-skip-inaccessible`, because nothing in that
fixture's prose says the record is unobtainable. A gate that treats any skip
as a disposal fails this one. Together they pin the binding; separately
neither does.

## Inherited from `ma-birth-record-unsearched`

The five completed items (two censuses, the 1946 death registration, a
negative parish baptism, a negative probate), both candidate parents, and
`declared: false`. Note that `ut_research_exhaustiveness_018` and `_d2b`
already grade the source scenario on the *absence* of a birth-record item;
this fork adds one and disposes of it, which is the different question.
The source is left untouched.

Used by: ut_research_exhaustiveness_d9i (answered decisive record blocks).
