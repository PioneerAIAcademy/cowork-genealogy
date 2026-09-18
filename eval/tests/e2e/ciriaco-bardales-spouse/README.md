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

**NOT RESOLVED — do not treat the findings below as settled ground truth.** The
hint is *plausible but unproven*: the evidence divides two registers against two
on the only field that identifies the father. See "The unresolved tension"
below, which is the whole point of this file. The supporting evidence is a second,
independent registration of the same infant that the hint batch did not
surface, plus an earlier child of the same couple and the subject's own death
entry. The origin field is what carries the identification; one record
contradicts it, and that contradiction is argued down rather than eliminated.

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
declarant in the preceding partida "no sabe firmar". Note the limit of that
point: on the 13 Aug 1905 *death* entry this same man "no firmó", and every
entry on that death page says the same, so signature is only informative on
pages where the clerk actually varied it.

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

**An earlier child of the same couple.** A search for the couple turned up
Partida N.º 326 of 13 May 1896 (`ark:/61903/1:1:6K2Q-S4B2`), a Guatemala City
birth registration in which Ciriaco Bardales again appeared "como padre" to
register a son, also named Ciriaco, by Carmen Morales; that child also died in
infancy (`ark:/61903/1:1:Z95C-JY6Z`). Two people of these two names in one city,
both naming a son Ciriaco, is not a coincidence worth entertaining — 1896 and
1905 are the same couple. This makes the relationship a nine-year one rather
than a single incident, which answers the draft's central objection ("29
sources and not one names a Carmen Morales") far better than the 1905 pair
alone: a partner who bore two children who died in infancy, before a marriage
that produced nine surviving children, leaves exactly this trace.

**The unresolved tension — this is the crux, and it is NOT settled.** The origin
field is the only thing tying the tree person to this couple, and the four
registers that state it disagree two against two:

| Record | Origin stated | Register / clerk |
|---|---|---|
| 1896 birth, Partida 326 (`ark:/61903/1:1:6K2Q-S4B2`) | "originarios y vecinos de **esta ciudad**" | Guatemala City births |
| 1896 death, Partida 406 (`ark:/61903/1:1:Z95C-JY6Z`) | "originarios y vecinos de **esta ciudad**" | Guatemala City deaths — **independent clerk** |
| 1905 birth, Partida 1118 (`ark:/61903/1:1:6KNJ-27P8`) | "originarios de **Chiquimula la Sierra**" | Guatemala City births |
| 1905 death, Partida 680 (`ark:/61903/1:1:6D38-BQ8L`) | "de **Chiquimula**" | Guatemala City deaths |

If the 1896 pair is right, this couple were capital-born and the tree person
(b. Quezaltepeque, Chiquimula; "originario de Esquipulas" on his own 1933 death
entry) is **not** the father — the hint is a false match. If the 1905 pair is
right, the hint is true.

**A boilerplate defence of the 1905 reading was tried and failed.** The first
attempt argued that the 1896 clerk was reciting a formula. He was not: on the
facing page, same clerk, same day, Partida 328 reads "originarios y vecinos **de
aquel lugar**" and Partida 329 "y **de este vecindario**". He varied the field,
so his "esta ciudad" is real data. That argument is dead and should not be
revived.

**What is left is weaker and should be labelled as such.** Across these
registers, "originarios y vecinos de esta ciudad" appears to be a single
compound formula meaning *local*, while the split form "originario de X y de
este vecindario" is used when origin and residence differ — visible on the 1905
death page, where partidas 678 and 681 take the compound form and 677, 679 and
680 take the split form. A clerk who did not probe would default to the
compound. That would explain 1896 without impeaching 1905, but it is an
inference about habit, not evidence about the man, and it is not strong enough
to carry a ground-truth verdict on its own.

**Two readings remain open, and picking between them is the second opinion's
job, not this document's:**

1. *One couple, hint true.* The 1905 clerks probed and got Chiquimula; the 1896
   clerks defaulted to the compound. The tree person is the father.
2. *One couple, hint false.* The couple were capital-born as both 1896 registers
   independently state, and the 1905 "Chiquimula" is the anomaly. The tree
   person is not the father, and this is outcome (c).

A third reading — two distinct couples each named Ciriaco Bardales and Carmen
Morales, each naming a son Ciriaco, in one city — is not worth entertaining.

**What was NOT done and would settle it:** no record has been found stating the
tree person's own whereabouts between his 1870 Chiquimula birth and his
children's 1907 Chimaltenango / 1909 Guatemala City registrations. A record
placing him in Guatemala City in the 1890s, or placing him elsewhere in 1896 or
1905, would decide this outright. That search has not been run.

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
deciding evidence is a register image). The question to put to the reviewer is
the 1896-vs-1905 origin contradiction under "The unresolved tension" above: two
registers say this couple were capital-born, two say Chiquimula, and the hint is
true only on the second reading.
