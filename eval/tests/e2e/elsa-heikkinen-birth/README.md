# Elsa Brita Heikkinen — birth in May 1832, Iisalmi, Kuopio, Finland

**Source PID:** `M76V-5PF`
**Elsa Brita Heikkinen is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) Christened 16 June 1832 in Iisalmi rural parish, Kuopio; the tree carries no birth and an undated Death fact. Her baptism names her parents as Anders Johan ("And Joh") Heikkinen and Lisa Pardanen; the tree also attaches Maria Eskelinen, who died in 1826, as a second mother.

## Research question

> When and where was Elsa Brita Heikkinen, christened 16 June 1832 in Iisalmi, Kuopio, Finland, daughter of Anders Johan Heikkinen and Lisa Pardanen, born?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-10-12, PID `M76V-5PF` with relatives). Nothing was
stripped (`"genre": "record-hint"` in `fixture.json`):
`starting-tree.gedcomx.json` is the snapshot as-is (written by
`strip --none`), and `unstripped-tree.gedcomx.json` is committed
identical to it so `snapshot --check` can audit upstream drift.
`validate` enforces the equality and skips the presence mirror
(the record-hint genre in `docs/specs/e2e-test-spec.md`).

## Expected difficulty

medium — see "Notes for reviewers" below for the reviewer's read on
match strength.

## Notes for reviewers

**DRAFT PENDING ADJUDICATION.** This fixture comes from a hint batch
(`filtered-list-samples-3.csv` row 10, `hint-samples.csv` row 359,
flag `adds_birth`, confidence 3) in which roughly half the hint records are
**false matches**, and the authors do not know which.
`expected-findings.json` was transcribed from the hint record — "Finland, Church Census and Pre-Confirmation Books, 1600-1916", an 1851–1860 communion-book entry for Elsa Brita Heickinen in the village of Kilpisaari, Iisalmi rural parish, born May 1832; the index gives no parents, household or birthplace.
The genealogist + developer teams must decide (a) true match — keep the
findings; (b) different answer — edit `expected-findings.json`; or (c) no
findable answer — replace the findings with a `"polarity": "avoid"` guard
naming the May 1832 birth, plus a `required` finding that the report documents
the rejection.

A likely match on name, date and parish. The index spells her Heickinen, the parish's Swedish-form spelling the tree's 1822 baptism of Anna Greta Heickinen, attached under the same father, also uses; a May 1832 birth falls a few weeks before the 16 June 1832 baptism the tree cites (`ark:/61903/1:1:XBFJ-HS6`, Iisalmen mlk, parents And Joh Heikkinen and Lisa Pardanen); and the census is from the same parish. That baptism index carries no birth date, so no existing tree source is a re-index of this one. Note that "May 1832" is already in the tree on another person: L83R-7VP "Elsa Riitta Heikkinen" (Riitta is the Finnish form of Brita), attached as the subject's sister under Anders Johan Heikkinen and Maria Eskelinen, is very likely a duplicate of the subject. An agent that spots and reasons from that duplicate is on the right track, not off it.

What is thin is everything beyond the name and month: Heikkinen households were numerous in Iisalmi, and the index alone cannot exclude a second Elsa Brita born in 1832. The tree's parentage is also muddled — Maria Eskelinen died in February 1826, six years before this birth, while the baptism names Lisa Pardanen — so the Eskelinen link should not be used to test this record. The discriminating check is the communion-book page image linked from the hint record: a rippikirja gives the full birth date and lists the household. A day in May 1832 with Elsa Brita in the household of Anders Johan Heikkinen and Lisa Pardanen would settle it; a different household or birth day would make her another Elsa Brita.
