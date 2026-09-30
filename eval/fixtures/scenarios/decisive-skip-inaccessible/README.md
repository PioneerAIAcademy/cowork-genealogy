# Scenario: decisive-skip-inaccessible

Fork of `recent-birth-sealed`. **The accept half of the check-6' pair for
issue #1830** -- its reject twin is `decisive-skip-unnecessary`, and the
two `research.json` files differ on three lines: the project id and the
two new fields on pli_004.

## Why the pair exists

The decisive record for a parentage question is the subject's own birth
record, and the gate's decisive-record rule says: *do not declare until
that record has been searched **or the declaration explicitly justifies
why it is inaccessible***. Here pli_004 -- Alan's own 1936 Utah birth
certificate -- is `skipped`, so that justification is the only route to
a declaration.

Issue #1830 gave the gate a structured way to read it:

| fork | `skip_category` | correct outcome |
|---|---|---|
| **this one** | `inaccessible` | declare, recording the limitation |
| `decisive-skip-unnecessary` | `unnecessary` | refuse -- neither searched nor justified |

## What was neutralized, and why that is the point

In `recent-birth-sealed` the access claim is stated twice in prose:
pli_004's `rationale` and log_004's `notes`. A fork that kept either
would be solvable without reading the new fields at all, so both forks
would come out the same and the pair could not discriminate. So:

- **pli_004's `rationale` is neutral** -- "Alan's own 1936 Utah birth
  certificate would name his parents directly." It says what the record
  would show and nothing about whether it can be had.
- **log_004 is removed.** A `record_search` log contradicts an item that
  was never pursued, which is what both forks now describe.

The access claim lives in `skip_reason`, which is where #1830 put it.
That is not an artificial arrangement: `rationale` means *why the item
was planned*, and the model was observed folding the skip reason into it
for want of anywhere else -- the defect the two fields exist to fix. This
fixture is the post-fix shape.

**A gate that ignores `skip_category` and `skip_reason` sees the same
neutral state in both forks and must refuse both** -- so it fails this
one. That is the pre-fix direction, and it is what makes the pair a real
check rather than a restatement.

## What this does NOT isolate

`skip_reason` is prose, and it agrees with `skip_category`. So the pair
discriminates *reads the new fields* from *does not* -- it does not
separate the structured field from the human one. Both shipped together
and Step 1 of the agent names both; separating them is not something any
fixture here attempts.

## Inherited from `recent-birth-sealed`

The parents established by the 1940 and 1950 censuses and the 1926 Weber
County marriage, the searched-negative church and probate items, and the
obituary. The accessible evidence is deliberately **sufficient** -- the
pursued-and-unavailable exception requires that ("**Only** when the
**accessible** evidence already supports a defensible conclusion"), so a
fork with insufficient evidence would be refused for an unrelated reason
and would collapse the distinction the pair is drawing.

Used by: ut_research_exhaustiveness_d8h (inaccessible decisive record declares).
