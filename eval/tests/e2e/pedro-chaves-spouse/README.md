# Pedro Pablo Chaves — wife Juana Flores (m. 1859, Buenos Aires)

**Source PID:** `2761-R34`
**Pedro Pablo Chaves is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) Christened 1 July 1836 at Nuestra Señora del Socorro, Buenos Aires; death date not recorded in the tree.

## Research question

> Did Pedro Pablo Chaves, christened 1 July 1836 in Buenos Aires, marry Juana Flores, and if so when and where?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-09-07, PID `2761-R34` with relatives). Nothing was
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

**Resolved: true match.** The hint record — "Argentina, Buenos Aires, registros
parroquiales, 1635-2017", a 30 August 1859 marriage at Asuncion de Maria
Santisima, Avellaneda, for Pedro Chaves (b. 1836) and Juana Flores (b. 1835),
naming his parents Isidro Chaves and Andrea Guerra and hers Sebastian Flores and
Isabel Rivero (https://familysearch.org/ark:/61903/1:1:QP84-TH55) — does belong
to Pedro Pablo Chaves (`2761-R34`), and the draft finding is confirmed with one
correction to the place.

**What decided it.** Three things, in order of weight.

1. **The parent pair is unique in the index, not merely matching.** An
   Argentina-wide search for a Pedro Chaves with father Isidro Chaves *and*
   mother Andrea Guerra returns only two events: this 1859 marriage, indexed
   three or four times, and the 1 July 1836 baptism at Nuestra Senora del
   Socorro, indexed twice (`1:1:XN9Y-ZHZ` and `1:1:XNSL-1LM`, which is why the
   tree carries a duplicated father). No second Pedro Chaves of that parentage
   exists in the corpus, so there is no rival candidate the hint could be
   confusing this Pedro with.
2. **An independent child baptism places the couple in the right city.**
   Casildo Chaves, baptised 17 June 1865 at Nuestra Senora de La Merced, Ciudad
   de Buenos Aires, father Pedro Chaves, mother Juana Flores
   (https://familysearch.org/ark:/61903/1:1:XN63-7VR). Different collection,
   different parish, different event type, six years after the marriage. This is
   the corroboration that does not come from the hint algorithm's own input.
3. **The stated birth year matches exactly** — the marriage index gives Pedro's
   birth as 1836, against the tree's 1 July 1836 christening. Year only, with no
   birthplace on the record, so on its own this is weak; it earns its place only
   alongside the two points above.

**The draft's own argument was wrong on one point, and it is corrected here.**
The draft said the birth year matched a christening "in the same city". It does
not: the christening is Nuestra Senora del Socorro in Buenos Aires City, and the
hint's marriage is at Avellaneda, in Buenos Aires province across the Riachuelo.
`expected-findings.json` now names Avellaneda. What bridges the two
jurisdictions is the 1865 baptism above, not the marriage record.

**Two apparent contradictions, both resolved.** A second index of the same
couple (https://familysearch.org/ark:/61903/1:1:QJRM-GV8V) dates the marriage
14 September 1859 at Buenos Aires City rather than 30 August at Avellaneda;
banns and ceremony, or two parishes recording one union, is the ordinary reading,
and that index agrees with the christening's city. The same index gives Pedro's
birthplace as Avellaneda — but it gives Juana the *identical* birthplace, which
is the signature of an indexer copying the event place into the birthplace field
rather than a real datum. Neither is treated as evidence against the match.

**What was searched and came up empty.** No marriage was attached to
`2761-R34` before this hint, and the tree records no spouse and no children, so
the draft's "re-index of a record already attached" caution cannot apply to a
marriage entry. `1:1:XFTB-FS4` ("Argentina matrimonios, 1722-1911") carries the
same parent pair and is very likely a third index of this same marriage; it was
not opened, because nothing turned on it once the couple was established.

**Not edited, deliberately.** The duplicated father in the tree (`275H-YL3`
Sargento Isidro Chaves and `2761-R3H` Isidoro Chaves, each with an Andrea
Guerra) is an artefact of the 1836 baptism being indexed twice. It did not
affect the call, since the identification rests on the pair being unique rather
than on which of the two duplicates matched, and `starting-tree.gedcomx.json`
and `unstripped-tree.gedcomx.json` are left as captured.
