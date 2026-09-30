# Scenario: decisive-skip-unnecessary

Fork of `recent-birth-sealed`. **The reject half of the check-6' pair for
issue #1830** -- its accept twin is `decisive-skip-inaccessible`, whose
README carries the full rationale for the pair. The two `research.json`
files differ on three lines: the project id and the two new fields on
pli_004.

## What this fork asserts

pli_004 -- Alan's own 1936 Utah birth certificate, the decisive record
for a parentage question -- is `skipped` with
`skip_category: "unnecessary"` and a `skip_reason` that is a judgement
call: the censuses and the marriage already agree on both parents.

The gate's decisive-record rule allows a declaration only once that
record has been **searched** or **explicitly justified as inaccessible**.
This item is neither. `unnecessary` says it was disposed of on
judgement, not pursued -- so it does not reach the
pursued-and-unavailable exception, and the gate must refuse and send the
question back to `research-plan`.

**This is the half that makes the accept fork meaningful.** On its own,
"declares when the item is `inaccessible`" is satisfied by a gate that
declares whenever anything is skipped. The pair is what pins the
distinction.

## Why the judgement is plausible but still insufficient

The `skip_reason` here is not a strawman -- three sources really do agree
on the parents, and that is exactly the reasoning a researcher would
offer. It is still not enough: the decisive-record rule exists because
the subject's own birth record is the one source that could *overturn* a
convergence of derivative ones, and "the others agree" is the argument it
is designed to refuse. A run that accepts it has reproduced the failure
the rule was written for.

Do not "fix" this fixture by weakening its evidence. The accessible
evidence is sufficient on purpose, in both forks -- see the twin's README
for why an insufficient-evidence variant would be refused for an
unrelated reason and collapse the distinction.

## Neutralized prose

As in the twin: pli_004's `rationale` states only what the record would
show, and log_004 is removed. Neither fork says anything in prose about
whether the certificate can be obtained, so the new fields are the only
thing a gate can read to tell them apart.

Used by: ut_research_exhaustiveness_d9i (unnecessary decisive record blocks).
