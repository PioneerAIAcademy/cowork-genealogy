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

**Resolved: true match.** The hint belongs to Pedro Pablo Chaves (`2761-R34`),
and the finding is confirmed with two corrections: the marriage date and the
place.

## What the marriage actually was

Two entries exist for this couple, eleven working days apart, and they are two
document types rather than a conflict:

- **30 August 1859** — the *información matrimonial*, the premarital
  examination, entry no. 51, pages 193–194. Index
  https://familysearch.org/ark:/61903/1:1:QP84-TH55; images
  `ark:/61903/3:1:9Q97-YSRZ-XMC` (opens the acta on p. 193 and carries the
  groom's declaration) and `ark:/61903/3:1:9Q97-YSRZ-614` (closes it on p. 194).
- **14 September 1859** — the marriage itself, folio 77 entry no. 55. Index
  https://familysearch.org/ark:/61903/1:1:QJRM-GV8V; image
  `ark:/61903/3:1:9Q97-YSRZ-GWP`.

Both are at the Parroquia de Nuestra Señora de la Asunción, **Barracas al Sud**,
which is the historic name of **Avellaneda**, in Buenos Aires *province* across
the Riachuelo — not Capital Federal. FamilySearch indexes both document types as
"marriage", which is what manufactured the appearance of a date conflict, and
one index (`QJRM-GV8V`) additionally mislabels the place as Buenos Aires City.

## What decided the identification

**Three original register pages agree on both of the groom's parents.** Read
from the page images, not the indexes:

| | 1836 Socorro baptism | 1859 información | 1859 marriage register |
|---|---|---|---|
| Father | Ysidro Chaves | Ysidro Chaves, *finado* | Ysidro Chaves, *finado*, 65, natural de la Provincia de San Luis |
| Mother | Andrea Guerra | Andrea Guerra | Andrea Guerra, 60, nativa de Buenos Ayres |
| Index | `1:1:XN9Y-ZHZ`, `1:1:XNSL-1LM` | `1:1:QP84-TH55` | `1:1:QJRM-GV8V` |
| Image | `3:1:939D-RDBR-3`, `3:1:939D-RX4N-5` (pp. 456–457) | `3:1:9Q97-YSRZ-XMC` (p. 193), `3:1:9Q97-YSRZ-614` (p. 194) | `3:1:9Q97-YSRZ-GWP` (f. 77) |

Each image ark above resolves under `https://familysearch.org/ark:/61903/`. The
baptism's two image arks are **the same opening filmed twice**, not two
different pages, which is why that one baptism carries two index entries.

The register's own words for the groom: *hijo legitimo del finado D.n Ysidro
Chaves, de edad de sesenta y cinco años, natural de la Provincia de San Luis, y
de D.a Andrea Guerra, de edad de sesenta años, nativa de Buenos Ayres, y ambos
domiciliados en Barracas.* His stated age, 23 in September 1859, matches a birth
on 29 June 1836; the baptism is 1 July 1836.

## The one apparent contradiction, and why it is not one

The groom swears he is *natural y feligrés de Barracas al Sud*, while the
subject was christened at Nuestra Señora del Socorro in the capital. **He cannot
have been baptised at Barracas al Sud in 1836: no parish existed there then.**
The Avellaneda jurisdiction dates to 1852 and its registers begin in the 1850s,
so a south-bank family in 1836 baptised in a city parish. The register confirms
both parents were *domiciliados en Barracas* by 1859, so the man is naming where
he is from, not where he was christened.

## Two transcription traps, recorded so the next reader does not re-derive them

**The originals defeated machine transcription on exactly the name that
matters.** An OCR pass over the 1859 pages returned the father as *Pedro Chaves*
and the mother, on the register, as *Isidra Guerra*. Both are wrong. At high
magnification the father's initial is a blotted **Y** with a descender followed
by *sidro*, and the mother reads *Andrea* on both pages. The likely mechanism for
*Pedro* is bleed from *El D.n Pedro dijo* earlier in the same sentence. On the
1836 baptism the same failure appeared in mirror image: one pass returned the
father as *P.o P.lo Chaves*, which is the child's own name and the marginal
heading beside the entry.

**The indexes were right and the machine reading of the originals was wrong** —
the reverse of the usual assumption. All four index entries give Isidro or
Isidoro Chaves and Andrea Guerra, and they match the pages. This is worth
knowing before anyone treats an index-versus-original disagreement here as
settled in the original's favour on principle.

Note also what does **not** support the identification, so it is not mistaken for
evidence: the index entries agree with each other, but three of the four sit in
collection `1972912` and the fourth is a GSU index-only compilation, so their
agreement is common ancestry rather than independent corroboration. A 17 June
1865 baptism at Nuestra Señora de La Merced, Buenos Aires City, for a Casildo
Chaves son of a Pedro Chaves and a Juana Flores
(https://familysearch.org/ark:/61903/1:1:XN63-7VR) is consistent with this couple
but does not discriminate between them and any other couple of those names, so it
is not part of the basis.

## Not edited, deliberately

The tree carries duplicate parent couples — `275H-YL3` Sargento Isidro Chaves
and `2761-R3H` Isidoro Chaves, each paired with an Andrea Guerra. That is an
artefact of the one 1836 baptism being indexed twice, with the father's name
spelled two ways; both spellings are variants of the correct Ysidro. It did not
affect the call, and `starting-tree.gedcomx.json` and
`unstripped-tree.gedcomx.json` are left exactly as captured, per the
record-hint genre.

## Available for a future fixture, not asserted here

The marriage register yields facts the tree does not hold and this finding does
not claim: the father's origin (Provincia de San Luis), both parents' ages and
the mother's Buenos Aires birth, the couple's residence in Barracas, and the
stated ages of the bride's parents (Sebastian Flores 38, Isabel Rivero 30).
**Those two are ages at death, not ages in 1859.** Both are entered under
*los finados*, and this register writes a dead parent's age that way: entry
no. 54 on the same opening reads *fallecida a la edad de cincuenta y cinco
años*. The same sentence in entry 55 distinguishes the two cases — Ysidro is
*del finado* at 65, while Andrea carries 60 and is not marked dead
(*ambos domiciliados en Barracas*). Read as 1859 ages they would be
impossible: Isabel at 30 would have been 6 when Juana was born.
That they were both deceased by 1859 **is** asserted, in the finding's
`details.target_person.parents`, so it is not on this list. The finding is
scoped to the marriage, which is what the research question asks.
