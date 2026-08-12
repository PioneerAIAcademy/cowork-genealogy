# Concepción Alegre — birth, marriage and parents (Paraguay)

**Source PID:** `G384-ZCZ`
**Concepción Alegre is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) Born
not recorded in the tree; died not recorded in the tree.

## Research question

> When and where was Concepción Alegre of Altos, Cordillera, Paraguay born, who were her parents, and when did she marry Vicente Figueredo?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-07-24, PID `G384-ZCZ` with relatives). Nothing was
stripped (`"genre": "record-hint"` in `fixture.json`):
`starting-tree.gedcomx.json` is the snapshot as-is (written by
`strip --none`), and `unstripped-tree.gedcomx.json` is committed
identical to it so `snapshot --check` can audit upstream drift.
`validate` enforces the equality and skips the presence mirror
(spec §3.6).

## Expected difficulty

medium — see "Notes for reviewers" below for the reviewer's read on
match strength.

## Notes for reviewers

**Adjudicated 2026-08-12 (issue #875): the record is the right one, but its
indexed parent names are wrong.** The hint matched the correct marriage — and
the indexed parentage it carries is an indexing error, which is what makes this
fixture worth running.

**Verdict.** The 11 May 1940 marriage at San Lorenzo, Altos is Concepción
Alegre and Vicente Figueredo. Her birth (about 1917, Altos) and that marriage
are both recoverable and are kept as findings. Her parents are **Venancio
Alegre and María de la Paz Resquín** — *not* the Juan Delgado and Hipólita
Martínez the index names.

**What decided it.** The register page itself
(`ark:/61903/3:1:33SQ-GRG8-9G8C`, folio 222-223, third act) reads: *"bendije el
matrimonio de Vicente Figueredo, soltero de veinte y cuatro años … hijo legítimo
de Mauricio Higueredo y de Ramona Bagada, con Concepción Alegre, soltera de
veinte y tres años … e hija legítima de Venancio Alegre y de la Paz Resquín,
**siendo testigos Juan Delgado y su esposa Hipólita Martínez**, y legitimaron en
el acto a un hijo Marcelino de un año."* Delgado and Martínez are the
**witnesses** — a married couple standing for the bride and groom — promoted
into the bride's parent fields by FamilySearch's indexer. The father's name was
also read off the image directly; FamilySearch's AI transcription of the page
drops it, rendering the clause as "hija legítima y de la Paz Resquín".

**What corroborates it.** Three other marriages in the same register name
Venancio Alegre and María De la Paz Resquín as parents of children surnamed
Alegre — Benicio (1929), Tomasa (1934), Mónica (1936) — so Concepción is a
fourth. The naming convention agrees independently: she is recorded *Alegre*,
and two of her children appear in the tree as *Figueredo Alegre*, making her
paternal surname Alegre and ruling out Delgado. Her stated age of 23 gives a
birth about 1917; the groom's stated age of 24 matches `G384-Z5K` (b. 19 Jul
1915), and his parents — Mauricio (H)igueredo and Ramona Bagada — confirm the
"Vicente Figueredo **Bogado**" naming in the military-pension source already
attached to the tree.

**The 1938 wrinkle resolved.** The original draft flagged that the tree's eldest
recorded child, Paulino, was born two years before the marriage. The act settles
it: the couple *"legitimaron en el acto a un hijo Marcelino de un año"* — they
legitimised a one-year-old son at the ceremony, exactly the civil/consensual
union formalised later by the church that the draft hypothesised. (Marcelino is
not in the tree; neither are Adriano or Silvio, both named in attached military
registers. Out of scope here.)

**Why the fixture is shaped the way it is.** The indexed parents are encoded as
a `polarity: "avoid"` guard (f5) rather than simply deleted, because the wrong
answer is what FamilySearch actively pushes at the agent: the hint for
`G384-ZCZ` offers Delgado and Martínez as parents, and an agent that trusts it
will assert them. The paired required finding (f6) asks the agent to *document*
the conflict rather than silently route around it. The correct parents (f3, f4)
are reachable only by reading the register page — full-text search over the
image group, or the image itself — not from any indexed entry, so this fixture
tests whether the agent goes past the index when the index is what misled it.

**For the next reader.** Nothing in the index disambiguates witnesses from
parents; only the register text does. If this fixture is ever re-derived from
`ark:/61903/1:1:X9PK-5YNN` alone it will reproduce the original error.
