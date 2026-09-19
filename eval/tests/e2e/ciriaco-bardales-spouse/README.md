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

**Resolved: true match, at *probable* confidence.** The identification rests on
the register's origin field, which divided 2–2 between capital and Chiquimula
until a third generation of records broke the tie: the couple's surviving son
identified through his own mother. The 1924 marriage register of the couple's
surviving son names the groom's **paternal grandparents as Ramón Sanabria and
Josefa Bardales** — and the tree person `KNYF-2Z8` is a son of **Josefa
Bardales** (relationship `R2`, and his own 1933 death entry reads "hijo de Josefa
Bardales"). The Ciriaco Bardales of the 1905 registrations and the tree person
are therefore both sons of the same woman.

**The identification does not rest on geography.** An earlier draft of this file
argued it from the register's origin field and made the 1924 Chiquimula
registration the deciding fact. That argument is **refuted** — see "The origin
field is context, not proof" below. The origin evidence is retained as context
and nothing more.

**The hint record** (`ark:/61903/1:1:6D38-BQ8G`, father persona; principal
`ark:/61903/1:1:6D38-BQ8L`) is Partida N.º 680 of the Guatemala City death
register, 13 August 1905. The index carries no age, residence or birthplace for
the father — which is why this had to be decided on the page, not the index. Ciriaco
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
this declarant could sign when his neighbours could not. Literacy and being
unmarried in August 1905 are consistent with the tree person, but they are
corroboration, not identification — what identifies him is the shared mother
below. Neither 1905 partida states the father's age, so **age is not part of the
match**: the only age evidence is the tree person's own 1933 entry, which is the
profile being matched *to*, not a point of correspondence.

**An earlier child of the same couple.** A search for the couple turned up
Partida N.º 326 of 13 May 1896 (`ark:/61903/1:1:6K2Q-S4B2`), a Guatemala City
birth registration in which Ciriaco Bardales again appeared "como padre" to
register a son, also named Ciriaco, by Carmen Morales; that child also died in
infancy (`ark:/61903/1:1:Z95C-JY6Z`). Two people of these two names in one city,
both naming a son Ciriaco, is not a coincidence worth entertaining — 1896 and
1905 are the same couple. This makes the relationship a nine-year one rather
than a single incident, which answers the original central objection ("29
sources and not one names a Carmen Morales") far better than the 1905 pair
alone: a partner who bore three children — two dying in infancy, one
(José Luis) surviving — before a marriage that produced nine more, leaves
exactly this trace.

**The origin field is context, not proof.** It divides two registers against two
for the same couple, and no reading of it settles the identification either way.
It is recorded here because a reader will find the contradiction and should know
it was examined, not because the verdict depends on it:

| Record | Origin / place | Register |
|---|---|---|
| 1896 birth, Partida 326 (`ark:/61903/1:1:6K2Q-S4B2`) | "originarios y vecinos de **esta ciudad**" | GC births |
| 1896 death, Partida 406 (`ark:/61903/1:1:Z95C-JY6Z`) | "originarios y vecinos de **esta ciudad**" | GC deaths — independent clerk |
| 1905 birth, Partida 1118 (`ark:/61903/1:1:6KNJ-27P8`) | "originarios de **Chiquimula la Sierra**" | GC births |
| 1905 death, Partida 680 (`ark:/61903/1:1:6D38-BQ8L`) | "de **Chiquimula**" | GC deaths |
| 1924 marriage of their surviving son (`ark:/61903/1:1:XSGQ-CNSC`) | registered at **Chiquimula, Chiquimula** | Chiquimula marriages |

**The couple had at least three children, not one.** Besides the 1905 infant,
Ciriaco Bardales and Carmen Morales registered a son Ciriaco on 13 May 1896 who
died at half an hour old, and a son **José Luis, born 1903, who survived**.

**The decisive record.** José Luis married Laura Calvinisti at Chiquimula on
10 June 1924, Partida N.º 77 (`ark:/61903/1:1:XSGQ-CNSC`; image
`ark:/61903/3:1:939J-DD98-8M`). The entry reads: "Don José Luis Bardales y la
Señorita Laura Calvinisti, ambos solteros, ladinos, con instrucción, originarios
de la Capital y vecinos de esta Ciudad, el primero de veintiun años edad,
mecánico, **hijo reconocido de Don Ciriaco Bardales y Carmen Morales, nieto por
linea paterna de Don Ramón Sanabria y Josefa Bardales**, y por la materna se
ignoran".

That paternal-grandmother line is the identification. The tree person `KNYF-2Z8`
is a son of **Josefa Bardales** on two independent footings — relationship `R2`
in the starting tree, and his own 1933 death entry ("hijo de Josefa Bardales",
`ark:/61903/1:1:Z9YP-SKN2`). So José Luis's father and the tree person are both
sons of Josefa Bardales. It also supplies a fact the tree lacks: the tree person's
own father, **Ramón Sanabria**, unnamed on his 1933 entry — consistent with
Ciriaco having been a natural child carrying his mother's surname, the same
pattern he repeated with Carmen Morales.

It gives José Luis's age as **21** in June 1924, so born ~1903, matching the
indexed 1903.

**And it refutes the geography argument this file previously rested on.** Both
bride and groom are "**originarios de la Capital** y vecinos de esta Ciudad" —
capital-born incomers *living* in Chiquimula. The marriage was registered there
because that is where the couple lived, not because the family came from there.
The earlier claim that "a capital-born family with no Chiquimula connection does
not marry its son off there" was **wrong**, and is recorded here so it is not
revived.

That parentage is independently confirmed half a century later. José Luis's own
death registration, 4 October 1954 (`ark:/61903/1:1:Z9GZ-P9PZ`; image
`ark:/61903/3:1:3Q9M-CS7W-CHN1`), records him as "hijo de Ciriaco Bardales y
Carmen Morales", married to Marta Castro, and the informant was **Alfredo
Chancilla — outside the family**, forty-nine years after the 1905 entries. It is
the strongest independent corroboration in this file that the couple existed and
had a surviving son. Two things it does **not** do: it gives his age as 56,
implying birth ~1898 rather than the indexed 1903; and it calls **José Luis
himself** "originario de esta Ciudad", which describes his own nativity, not his
parents' origin — he was born in the capital where the couple lived, so it
neither supports nor contradicts a Chiquimula-born father.

**Superseded — kept only so the reasoning is not retried.** A Guatemalan civil marriage is
normally registered in the **bride's** municipality, and Laura Calvinisti's own
residence has not been established. So a Chiquimula registration is
circumstantial support, not proof: it tips the balance, it is independent of the
1905 entries and postdates them by nineteen years, but the ordinary explanation
— that the bride was from Chiquimula — has not been ruled out. Ruling it out is
the single cheapest thing a reviewer could do to firm up this verdict.

**A boilerplate defence of the 1905 reading was tried and failed — do not revive
it.** The first attempt argued the 1896 clerk was reciting a formula. He was
not: on the facing page, same clerk, same day, Partida 328 reads "originarios y
vecinos **de aquel lugar**" and 329 "y **de este vecindario**". He varied the
field. What remains is the weaker observation that "originarios y vecinos de
esta ciudad" functions as a single compound meaning *local*, used when origin
and residence coincide, while the split form appears when they differ — visible
on the 1905 death page, where 678 and 681 take the compound and 677, 679 and 680
take the split. A clerk who did not probe would default to the compound. That
explains 1896 without impeaching 1905, but it is an inference about habit and
carries no weight now that identification comes from the shared mother rather
than from origin at all.

**The tree person's own marriage record was also located**
(`ark:/61903/1:1:X92L-7PCF`): **Ciriaco *Leonides* Bardales**, b. 1871, son of
**Josefa Bardales**, *soltero*, residing at **San Pedro Yepocapa**, married
**Clara Oliva** on 10 December 1907 at Santa Lucía Cotzumalguapa. Mother, bride
and residence match the tree independently, so this is the same man under a
fuller name the tree does not carry. (The birthplaces in that index entry are
the record's own parish, not the parties' birthplaces — Clara's tree birthplace
is Guatemala City.) It confirms he was still *soltero* in December 1907.

**Residual doubt, stated plainly.** The identification now rests on a named
paternal grandmother rather than on a contested origin field, which is a much
stronger footing — but three things remain open. First, `XSGQ-CNSC` is now the
single load-bearing record in this fixture and it is transcribed nowhere in the
committed run log; the agent never touched it, so **a reviewer should open the
image personally** (issue #1346 is the precedent for trusting an ark nobody
opened). Second, the 1896 pair still calls the couple capital-born and is
explained only by a reading of clerical habit — it no longer matters to the
verdict, but it is unexplained evidence. Third, nothing places the tree person
anywhere between his 1870 Chiquimula birth and his children's 1907/1909
registrations.

**This verdict was revised three times** — asserted on geography, withdrawn when
the 1896 pair surfaced, re-asserted on the 1924 Chiquimula registration, and then
re-founded on the grandmother line when that registration was actually read and
refuted the geography argument. Weigh the records, not this summary.

**Two corrections to the fixture's original framing and to the pre-handoff
review.**

1. *Which marriage date the records support.* Both 1905 partidas describe the
   couple as **"solteros"**, so no marriage had taken place by 13 August 1905.
   That, and not any tree date, is what makes the fixture's "before his marriage
   to Clara Amelia Palacios Oliva" framing correct. The dates themselves do not
   agree and should not be asserted: the couple relationship `R1` carries three
   Marriage facts (`Bef 1906` at Zacapa, `10 Jan 1907` with no place, and one
   bare fact); the civil registration (`ark:/61903/1:1:XSGW-BYGR`, registered
   late, in 1934) gives **10 Jan 1907**; and the church record
   (`ark:/61903/1:1:X92L-7PCF`) gives **10 Dec 1907**, still calling him
   *soltero*. Clara's first child (Ricardo, `KN77-6NK`) was born 7 Nov 1907 —
   *between* those two dates, so he corroborates neither. What all of them agree
   on, and all this finding needs, is that the marriage postdates August 1905.
   The `Bef 1906` fact cannot be placing it before the infant.
2. *The Guatemala City discriminator inverts.* The pre-handoff review suggested
   testing whether the subject was in Guatemala City in 1905, noting the earliest
   Guatemala City event in the family as Victor's birth on 5 Sep 1909. That is
   not quite right — his wife Clara (`L6PW-W6G`) was **born** in Guatemala City
   on 11 Jun 1886. More importantly the useful question is not "was he in
   Guatemala City" but "**was he from Chiquimula**", and both 1905 entries say he
   was. His Chiquimula → Zacapa → Chimaltenango → Guatemala City movement is what
   a career officer's postings look like.

**Why the tree's silence is not a counter-argument.** The original central
scepticism — twenty-nine sources and not one naming a Carmen Morales — is
answered rather than overridden. A pre-marital relationship whose two infants
died within days of birth, and whose surviving son was never added to this tree,
leaves no trace in a later marital record trail. The
live person page now carries thirty sources and none of them is
`6D38-BQ8G`/`6D38-BQ8L` or `6KNJ-27P8`, so the hint is genuinely new evidence
and not a re-indexing of a source already attached.

**What was searched and came up empty.** A record search of "Guatemala Registro
Civil, 1833-2009" and "Guatemala, Guatemala, Registro Civil, 1874-2008" for
given name Ciriaco, surname Bardales, country Guatemala returned 559 fuzzy hits,
of which 63 name a principal exactly "Ciriaco Bardales". None is a competing
adult Ciriaco Bardales resident in Guatemala City: the undated ones are the
subject himself appearing as father on his own children's registrations, and the
1924/1925 ones are his son Ciriaco de Jesús Bardales Palacios. Two further
infant Ciriacos, a birth registered Nov 1896 and a death in Jul 1897, are
**Chiquimula** registrations naming *different* parents (Juan/Juan José Bardales
and Trinidad Lopez/Lemus) — evidence that the given name recurs in that surname
group in that department, not a competing father. They are **not** the 1896
Guatemala City child discussed above, who is this couple's own. No marriage record for Ciriaco Bardales and Carmen Morales
was found, which is expected — both registrations call them "solteros".

**A one-day discrepancy, left as the registers have it.** The birth partida says
the child was born at 12.45 a.m. on 1 August 1905 ("nació hoy"); the death
partida says he died on 12 August "á la edad de doce días", which counts to
eleven, not twelve. `expected-findings.json` reports both as the registers state
them and is deliberately **not** being edited to reconcile them: it is
fingerprinted into the committed calibration annotation's `findings_hash`, so
changing it would invalidate an already-graded run.

**One trap worth recording.** `ark:/61903/1:1:Z92T-W2ZM` looks like a second
witness — it indexes a Ciriaco Bardales who died 12 August 1905 at Guatemala —
but it is a **duplicate index of the very same death partida** (same
Jun 1905–Jan 1906 volume) that names only the mother. It is not independent
corroboration and must not be cited as such.

**Second opinion given by: mercyokum.** The record was opened directly on
familysearch.org (not taken from the committed transcription) — image
`ark:/61903/3:1:939J-DD98-8M`, image 110 of 258 in "Chiquimula. Marriage
Records 1923–1925," entry for José Luis Bardales. The question put to the
reviewer was the same one the PR body asks:

> Does "nieto por linea paterna de Don Ramón Sanabria y **Josefa Bardales**" on
> the 1924 entry, set against the tree person being a documented son of Josefa
> Bardales, identify them as the same man — or is it a name coincidence inside
> one surname group in one city?

**Verdict: identification holds.** Three checks against the actual handwriting,
not the transcription:

1. "Josefa Bardales" is legible and unambiguous — the surname's letterforms
   match every other instance of "Bardales" in the same entry (the groom's own
   surname), in the same hand. No plausible alternative reading fits.
2. "Nieto por linea paterna" attaches grammatically to Ciriaco, not Carmen: the
   clause follows directly from naming Ciriaco as the father, and Carmen
   Morales's ancestry is not given in this entry at all. Josefa Bardales is
   unambiguously Ciriaco's mother.
3. No ink bleed, correction, overwriting, or damage in that passage — only
   normal pen-pressure variation, which introduces no ambiguity.

Combined with the tree's own independent naming of Josefa Bardales as
Ciriaco's mother (a separate 1933 death record, above), this is two unrelated
documents naming the same mother for the same man — a real identifier, not a
shared-surname coincidence. Do not re-open this question without new evidence.

The 1896 origin entries are **not** the question any more. An earlier revision of
this file put them here, when the identification still ran on geography; that
argument is refuted above and the origin field now decides nothing.
