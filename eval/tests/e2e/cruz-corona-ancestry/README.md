# Mauro Cruz Corona — parents (1910)

**Source PID:** `PID-TODO`
**Mauro Cruz Corona is deceased.** (Born about 1910; death recorded 21 April 1999 in
Nueva Italia, Michoacán, Mexico per the José Sóstenes Cruz FGR. FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.)

## Research question

> Who were the parents of Mauro Cruz Corona, born about 1910 in or near Nueva Italia, Michoacán, Mexico?

## What was withheld from the starting tree

- Mauro's **exact birth** (22 November 1910, La Unión, Montes de Oca, Guerrero, Mexico)
  replaced with an approximate birth (~1910, near Nueva Italia, Michoacán).
- His **father** Sóstenes Cruz (José Sóstenes Cruz Basurto) is absent from the tree.
- His **mother** Apolinar Corona (Maria Apolinar Corona Mercado) is absent from the tree.
- His **paternal grandparents** Jesús Cruz and Donaciana Basurto are absent from the tree.
- His **maternal grandparents** Miguel Corona and Jesús Mercado are absent from the tree.
- No ParentChild relationships are recorded for Mauro.

The starting tree retains Mauro himself with an approximate birth and 1930-census residence,
plus three of his siblings (Miguel, Liborio, Facundo) who appeared with him in the 1930
census household of Erculano Hernandez in Nueva Italia. The siblings share birth states
(Guerrero) in the census, which gives the agent a geographic lead without naming the parents.
The 1930 census source is included as the one known anchor record.

## Expected difficulty

moderate — Mexican civil registration and parish records for Guerrero (1860–1996) are heavily
indexed on FamilySearch, and the Guerrero birth record for Mauro (ark:/61903/1:1:QGWQ-MCFP)
names both parents and all four grandparents in a single document. The agent must bridge the
geographic gap between Mauro's later Michoacán residence and his Guerrero birth area. Sibling
records (Margarito, Rufina, Miguel, Liborio, Facundo) corroborate the parentage and provide
additional search hooks.

## Notes for reviewers

**2026-11-04 — re-scoped for step mode (issue #4143).** The old question asked
two independent facts (his parents, and his exact birth date/place): "Who were
the parents of Mauro Cruz Corona, born about 1910 in or near Nueva Italia,
Michoacán, Mexico, and what were his exact birth date and place?" Reworded
`researcher_question` to the parents only (matching `tags.question_type`);
demoted `f1` (exact birth date/place) to `required: false`, so a run that
recovers it anyway still gets credit. No finding wording changed.

**Re-grading the 9 stamped annotations this demotion affects.** `f1`'s own
content/evidence is unchanged — only its scoring weight — so every existing
`per_finding` label for `f1` on these annotations is still the correct answer
to "does the tree show this birth fact," and was carried forward rather than
re-litigated. Before carrying anything forward, every annotation on this
fixture was independently re-audited against its final tree/research.json
(not merely trusted): two annotations' per-finding grades (`run-2026-09-25_11-30-49`,
`run-2026-10-05_16-58-04`) were corrected — both had graded the parents `true`/
`partial` when the parents were in fact linked to an unmerged duplicate stub
rather than the subject, the identical defect already correctly graded `false`
on `run-2026-09-21_23-54-48` — and two annotations' `proof_quality_score`
(`run-2026-09-16_08-50-32`, `run-2026-10-20_11-02-46`) were corrected from 2→1
and 3→1 for crediting a source as "original"/"read as an image" when no
`image_read`/`image_transcribe` call exists anywhere in either run. See each
annotation's own notes for the full reasoning.

The three required findings are now: (f2) his father Sóstenes Cruz; (f3) his
mother Apolinar Corona; `f1` is a bonus along with `f4`/`f5` (paternal and
maternal grandparents) — grade them if recovered but do not penalize their
absence. The agent may reach the same conclusions through sibling records
(Rufina 1906, Margarito 1908) rather than the direct birth record — grade on
recovered facts, not on which specific record was cited.

**Authoring note (PID-less / Path 3):** Built from the bundled research document(s) (DebbieGurtler/Mexico AG Research report + Cruz FGRs) with no FamilySearch access, so the starting tree was *constructed* from the document rather than captured from a live `person_read` snapshot — sanity-check its fidelity before relying on it. `source_pid` is an unused placeholder (`PID-TODO`): §6.1 blocks every person-keyed tool, so neither the benchmark run nor the judge ever reads the PID — it is provenance only, and may optionally be filled in later if a re-snapshot or provenance link is wanted. The landing gate is the same as for every fixture (Path 1 included): a committed §14 validity run that passes (`uv run python -m e2e.validate_fixture cruz-corona-ancestry`). Recoverability from FamilySearch records is flagged in the reviewer notes above.
