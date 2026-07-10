# Heinrich Dewus — death date and additional children (Milwaukee, 1936)

**Source PID:** `9VX4-1C3`
**Heinrich Dewus is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) Born in
Pommerania, Preussen, Germany (undated in the tree; the obituary says
about 1850); the tree carries an undated Death fact.

## Research question

> When did Heinrich Dewus of Milwaukee, Wisconsin (born about 1850 in
> Pommerania, Germany) die, and did he and his wife Augusta have
> children besides the four already in the tree?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture (`"genre": "record-hint"`
in `fixture.json`, spec §3.6): the expected answers never appeared in
the FamilySearch tree. `starting-tree.gedcomx.json` is the live
snapshot as-is (captured 2026-07-10, PID `9VX4-1C3` with relatives,
written by `strip --none`), and `unstripped-tree.gedcomx.json` is
committed identical to it so `snapshot --check` can audit upstream
drift. The starting tree has Heinrich, his wife Augusta Arndt, and four
children — Alma (b. 1882), Adela (b. 1883), Hedwig (b. 1885), and
Heinrich Charles (b. 1889), all Milwaukee — with an **undated** Death
fact on Heinrich and no Walter, Ida, or Eleanor.

**Known advisory WARNs:** the stripping linter flags finding `f1`
twice. Against the subject `9VX4-1C3` because he is still in the tree
with a Death fact — by design: the tree's Death fact is *undated*, and
`f1` asks for the death **date**. And against his son Heinrich Charles
Dewus (`KJW8-43Q`), who shares the name tokens and carries his own
(dated, 1958) death — a different person, not the answer. Nothing
should be removed.

## Expected difficulty

medium — The family is well-anchored in Milwaukee (four children with
Wisconsin birth/christening records already attached), and the obituary
is reachable through record search. The work is in the variants: the
obituary is jointly indexed under **Dewus** and **Downs** (with
children indexed as Dewes/Downs), children appear under married names
(Schmidt, Kniophoff, Henke), and the agent must separate the three
genuinely new children from the four it already has.

## Notes for reviewers

**DRAFT PENDING ADJUDICATION.** This fixture comes from a hint batch
(`filtered-list-samples.csv` row 1, flags
`adds_son,adds_daughter,adds_death`, confidence 3) in which roughly
half the hint records are **false matches**, and the authors do not
know which. `expected-findings.json` was transcribed from the hint
record — United States, GenealogyBank Historical Newspaper Obituaries,
1815-2013: obituary of 28 Aug 1936, Milwaukee (6906 W. Lloyd St.),
Henry Dewus / Henry Downs, carpenter/builder, born about 1850 in
Germany, naming seven children. The genealogist + developer teams must
decide:

- **(a) true match** — keep the findings as written;
- **(b) different answer** — some findings are right and others wrong
  (e.g. the death date holds but a named child belongs to another
  family): edit `expected-findings.json` accordingly;
- **(c) no findable answer** — the obituary belongs to a different
  Henry Dewus/Downs: replace the findings with `"polarity": "avoid"`
  guards naming the wrong claims (spec §3.4.1 — the harness
  mechanically fails a run whose final tree contains an avoided claim)
  plus a `required` finding that the agent's report documents what
  could not be established and why the hint record was rejected.

Evidence for the match a reviewer will want: four of the obituary's
seven children align with the tree's four (Mrs **Alma Schmidt** ↔ Alma
b. 1882; Mrs **Adele Kniophoff** ↔ Adela b. 1883; Mrs **Hattie Henke**
↔ Hedwig b. 1885; **Henry C** ↔ Heinrich Charles b. 1889), and the
birth (about 1850, Germany) squares with the tree's Pommerania origin.
Oddities: the obituary is double-indexed under two head-of-entry
personas (Henry **Dewus**, carpenter / Henry **Downs**, builder — same
birth and death data, almost certainly one man), and Eleanor is indexed
only under the Downs variant, from Chicago — the weakest of the three
new-children claims, hence `required: false` on `f4`.
