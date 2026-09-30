# Scenario: decisive-skip-inaccessible

Fork of `recent-birth-sealed`. **The accept half of the check-6' pair for
issue #1830** -- its reject twin is `ma-birth-skipped-unnecessary`.

> **Corrected after `v1_2026-09-30_18-26-29`.** The twin was originally this
> same fixture with `inaccessible` flipped to `unnecessary`, so the two
> differed on two fields and nothing else. That was wrong: the Utah record
> really *is* sealed, the agent looked the embargo up on the wiki page,
> supplied the justification itself and declared. With one underlying record,
> one of the two labels always has to lie about the world. The twin now uses
> a Massachusetts 1875 birth registration -- genuinely obtainable, so
> `unnecessary` is a coherent label there. See its README for what that
> costs.

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
| `ma-birth-skipped-unnecessary` | `unnecessary` | refuse -- neither searched nor justified |

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

Two things, both stated rather than glossed.

**The structured field from the human one.** `skip_reason` is prose and it
agrees with `skip_category`, so this fixture discriminates *reads the new
fields* from *does not* — not one field from the other. Both shipped
together and Step 1 of the agent names both; separating them is not
something any fixture here attempts.

**The halves from each other.** Since the correction above, the two halves
of the pair are different scenarios rather than one scenario with the label
flipped, so neither alone holds `skip_category` as the sole variable. Their
power is joint: a gate ignoring the new fields fails THIS one, because
nothing in its prose says the record is unobtainable; a gate treating any
skip as a disposal fails the other. Read them as a pair or not at all.

## Inherited from `recent-birth-sealed`

The parents established by the 1940 and 1950 censuses and the 1926 Weber
County marriage, the searched-negative church and probate items, and the
obituary. The accessible evidence is deliberately **sufficient** -- the
pursued-and-unavailable exception requires that ("**Only** when the
**accessible** evidence already supports a defensible conclusion"), so a
fork with insufficient evidence would be refused for an unrelated reason
and would collapse the distinction the pair is drawing.

Used by: ut_research_exhaustiveness_d8h (inaccessible decisive record declares).
