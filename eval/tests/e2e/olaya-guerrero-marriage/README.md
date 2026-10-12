# Olaya Guerrero — marriage in October 1768, Higüey, Dominican Republic

**Source PID:** `L17S-LBY`
**Olaya Guerrero is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) Born about 1732 in Higüey; the tree carries an undated Death fact and no parents. Her couple relationship with Baltazar Guerrero has no marriage fact; their daughter Rosa was born 2 September 1769 in Higüey. The tree also gives her a second husband, Patraiar Guerrero, who shares the daughter Maria Guerrero Guerrero with Baltazar.

## Research question

> When and where did Olaya Guerrero, born about 1732 in Higüey, marry Baltazar Guerrero, the father of her daughter Rosa born in Higüey in September 1769, and who were her parents?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-10-12, PID `L17S-LBY` with relatives). Nothing was
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
(`filtered-list-samples-3.csv` row 7, `hint-samples.csv` row 288,
flags `adds_father,adds_mother,adds_marriage`, confidence 3) in which roughly half the hint records are
**false matches**, and the authors do not know which.
`expected-findings.json` was transcribed from the hint record — "Dominican Republic, Marriages, 1743-1929", a marriage entry of 13 October 1768 at Higüey for Baltasar Guerrero, son of Gregorio Guerrero and Maria Ygnacia Garrido, and Olaya Vrtarte (that is, Urtarte), daughter of Gregorio Vrtarte and Baltasara de Reyna; the collection is an index with no linked image.
The genealogist + developer teams must decide (a) true match — keep the
findings; (b) different answer — edit `expected-findings.json`; or (c) no
findable answer — replace the findings with a `"polarity": "avoid"` guard
naming the October 1768 marriage, plus a `required` finding that the report documents
the rejection.

A strong candidate on context, and partly in the tree already. The tree's Baltazar Guerrero already cites the groom's persona of this very entry (`ark:/61903/1:1:XLLN-5J3`, "Baltasar Guerrero, Dominican Republic, Marriages, 1743-1929"); the hint is the bride's persona of the same entry, so it is not new evidence, but the tree records neither the marriage fact nor Olaya's parents. The fit is good: an uncommon given name, a groom of the right name in the same town, and the daughter Rosa born in Higüey eleven months after the wedding (the tree's 1507 christening date for Rosa is an indexing error for 1769).

What contradicts it is her surname. The bride is Olaya Urtarte, while every tree source calls her Guerrero: Rosa's baptism indexes the mother only as "Guerrero", and the 1790 Higüey marriage of her daughter Maria to Josef Garrido (`ark:/61903/1:1:6R89-C6L3`) names the bride's parents as Patraiar Guerrero and Olaya Guerrero. "Patraiar" reads like a misreading of Baltasar, which would make the tree's second husband a duplicate of Baltazar, and a wife entered under her husband's surname is not unusual in these registers; but if her maiden name really was Guerrero, the 1768 bride is a different Olaya. The check that would settle it is Rosa's 1769 baptism, already cited in the tree (`ark:/61903/1:1:6D5T-HK71`): a Higüey baptism of that period normally names the grandparents, and maternal grandparents Gregorio Urtarte and Baltasara de Reyna on the register image would confirm the match.
