# Ciriaco Bardales — an earlier partner, Carmen Morales, and an infant son who died in 1905

**Source PID:** `KNYF-2Z8`
**Ciriaco Bardales is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) Born 1870, Quezaltepeque, Chiquimula; died 11 April 1933, Guatemala.

## Research question

> Before his marriage to Clara Amelia Palacios Oliva, did Ciriaco Bardales have a son by a Carmen Morales — an infant Ciriaco who died 12 August 1905 in Guatemala City?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-09-07, PID `KNYF-2Z8` with relatives). Nothing was
stripped (`"genre": "record-hint"` in `fixture.json`):
`starting-tree.gedcomx.json` is the snapshot as-is (written by
`strip --none`), and `unstripped-tree.gedcomx.json` is committed
identical to it so `snapshot --check` can audit upstream drift.
`validate` enforces the equality and skips the presence mirror
(the record-hint genre in `docs/specs/e2e-test-spec.md`).

## Expected difficulty

hard — see "Notes for reviewers" below for the reviewer's read on
match strength.

## Notes for reviewers

**Resolved: true match. The hint is confirmed.** The deciding evidence is a
second, independent registration of the same infant that the hint batch did not
surface, plus the subject's own death entry; together they place the father's
origin, literacy and marital status where the tree person's do.

**The hint record** (`ark:/61903/1:1:6D38-BQ8G`, father persona; principal
`ark:/61903/1:1:6D38-BQ8L`) is Partida N.º 680 of the Guatemala City death
register, 13 August 1905. The index carries no age, residence or birthplace for
the father — as the draft note above predicted — but the page does. Ciriaco
Bardales appeared **in person** to declare the death of Ciriaco, aged twelve
days, "hijo natural del exponente y de Carmen Morales, solteros, ladinos,
católicos, **de Chiquimula** y de este vecindario", at house 25, Avenida del
Golfo. The neighbouring partidas on the same page fill that origin slot
differently ("de San Juan", "originarios y vecinos de esta Ciudad"), so it is a
real origin field rather than boilerplate.

**The corroborating record** is the matching **birth** registration, Partida
N.º 1118 of 1 August 1905 (`ark:/61903/1:1:6KNJ-27P8`; the father's surname is
indexed as the typo "Bandales", which is why it never joined the hint batch). It
is a different register series, volume and page, so it is genuine independent
corroboration. The same father appeared, named Carmen Morales as the mother,
gave **the same address** (house 25, Avenida del Golfo), stated both parents
"solteros ... **originarios de Chiquimula la Sierra** y de este vecindario",
formally acknowledged the child as his own, and **signed the entry** — where the
declarants in the surrounding partidas "no firmó" or "no sabe firmar".

**The identity chain closes on the subject's own death registration**, Partida
N.º 1069 of 12 April 1933 (`ark:/61903/1:1:Z9YP-SKN2`): aged sixty-three
(→ b. ~1870 ✓), "casado con Amelia Palacios" ✓, "hijo de Josefa Bardales" ✓
(relationship `R2` in the starting tree), **"Coronel"**, and "originario de
**Esquipulas** y de este vecindario" — Esquipulas being a municipality of the
department of **Chiquimula**. An army colonel is literate, which is precisely why
this declarant could sign when his neighbours could not. Chiquimula origin +
Guatemala City residence + literate + unmarried in August 1905 + age fits: that
combination is the discriminator, and it is not shared by any other Ciriaco
Bardales found.

**Two corrections to the draft note above, and to the pre-handoff review.**

1. *Which marriage date the records support.* Both 1905 partidas describe the
   couple as **"solteros"**, so no marriage had taken place by 13 August 1905.
   The couple relationship `R1` carries three Marriage facts — `<1906>`
   (standardised `Bef 1906`) at Zacapa, `10 Jan 1907` with no place, and one
   bare fact. The records support the **10 Jan 1907** fact; the `Bef 1906` fact
   cannot be placing the marriage before the infant. Clara's first child
   (Ricardo, `KN77-6NK`, b. 7 Nov 1907) fits a January 1907 marriage. So the
   fixture's "before his marriage to Clara Amelia Palacios Oliva" framing is
   correct, but its warrant is the register's "solteros", not the tree's dates.
2. *The Guatemala City discriminator inverts.* The pre-handoff review suggested
   testing whether the subject was in Guatemala City in 1905, noting the earliest
   Guatemala City event in the family as Victor's birth on 5 Sep 1909. That is
   not quite right — his wife Clara (`L6PW-W6G`) was **born** in Guatemala City
   on 11 Jun 1886. More importantly the useful question is not "was he in
   Guatemala City" but "**was he from Chiquimula**", and both 1905 entries say he
   was. His Chiquimula → Zacapa → Chimaltenango → Guatemala City movement is what
   a career officer's postings look like.

**Why the tree's silence is not a counter-argument.** The draft's central
scepticism — twenty-nine sources and not one naming a Carmen Morales — is
answered rather than overridden. A brief pre-marital relationship whose only
child died at twelve days leaves no trace in a later marital record trail. The
live person page now carries thirty sources and none of them is
`6D38-BQ8G`/`6D38-BQ8L` or `6KNJ-27P8`, so the hint is genuinely new evidence
and not a re-indexing of a source already attached.

**What was searched and came up empty.** A record search of "Guatemala Registro
Civil, 1833-2009" and "Guatemala, Guatemala, Registro Civil, 1874-2008" for
given name Ciriaco, surname Bardales, country Guatemala returned 559 fuzzy hits,
of which 63 name a principal exactly "Ciriaco Bardales". None is a competing
adult Ciriaco Bardales resident in Guatemala City: the undated ones are the
subject himself appearing as father on his own children's registrations, the
1924/1925 ones are his son Ciriaco de Jesús Bardales Palacios, and the other
infant Ciriacos (d. 1896, d. 1897) were registered in **Chiquimula**, consistent
with the given name recurring in that surname group in that department rather
than in the capital. No marriage record for Ciriaco Bardales and Carmen Morales
was found, which is expected — both registrations call them "solteros".

**One trap worth recording.** `ark:/61903/1:1:Z92T-W2ZM` looks like a second
witness — it indexes a Ciriaco Bardales who died 12 August 1905 at Guatemala —
but it is a **duplicate index of the very same death partida** (same
Jun 1905–Jan 1906 volume) that names only the mother. It is not independent
corroboration and must not be cited as such.

**Second opinion:** _outstanding — to be named here and in the PR body before
merge._ The card makes it mandatory for this fixture (difficulty `hard`, and the
deciding evidence is a register image).
