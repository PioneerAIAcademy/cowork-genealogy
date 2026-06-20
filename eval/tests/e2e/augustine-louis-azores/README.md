# Augustine Louis (Agostinho Luiz) — Azorean origin and baptism (1876)

**Source PID:** `PID-TODO`
**Augustine Louis (Agostinho Luiz) is deceased.**

## Research question

> Where was Augustine Louis (Agostinho Luiz) born and baptized in the Azores, and who were his parents?

## What was removed from the starting tree

The starting tree is constructed from the Hawaii/US side only — what was knowable before the Azorean records were found:

- Subject known as "Augustinho, age 3" on the Highflyer passenger manifest (arrived Honolulu 24 Jan 1880), traveling with father Eugenio Luis and mother Francisca Amelia.
- Father Eugenio Luiz included with known birth date (5 Jul 1840, São Pedro) and marriage date (10 Nov 1867, São Pedro), anchored by the Azores marriage record that is on FamilySearch.
- Mother Francisca Amelia included with known birth date (22 Jan 1847, São Pedro).

**Withheld (the answer):**
- Augustine's specific birth parish (Fajã de Baixo, not São Pedro).
- Augustine's exact birth date (19 Jun 1876) and baptism date (20 Jul 1876).
- The Fajã de Baixo baptism record identifying his parents and paternal grandparents (João Luiz and Maria dos Anjos).
- The Azores passport record documenting the family's emigration from Belem, Ponta Delgada.

## Expected difficulty

**hard** — The baptism is in Fajã de Baixo parish (Nossa Senhora dos Anjos), not São Pedro where the parents married and where most other family records are. The key emigration record is in an Azores-hosted passport register (culturacores.azores.gov.pt) that is not in FamilySearch. The Hawaii passenger manifest is the only FamilySearch-accessible anchor. The agent must work from the Hawaii arrival backward to locate Azorean parish records, navigating name variants (Augustine / Augustinho / Agostinho) and a parish shift between the parents and the subject.

## Notes for reviewers

Required findings f1–f4 cover: baptism date and parish, father identity, mother identity, and Hawaii arrival. Finding f5 (passport emigration record) is marked non-required because the culturacores.azores.gov.pt record is unlikely to be reachable by MCP tools.

Grade on the recovered facts (birth parish = Fajã de Baixo; parents = Eugenio Luiz and Francisca Amelia; baptism date = 20 Jul 1876), not on which source the agent cites. The Fajã de Baixo baptism record is partially indexed on FamilySearch and may be reachable via `person_search` or `record_search` if the agent searches broadly enough.

**Authoring note (PID-less / Path 3):** Built from the bundled research document(s) (DebbieGurtler/Portugal Research Log + Augustine Louis pedigree + FGRs) with no FamilySearch access, so the starting tree was *constructed* from the document rather than captured from a live `person_read` snapshot — sanity-check its fidelity before relying on it. `source_pid` is an unused placeholder (`PID-TODO`): §6.1 blocks every person-keyed tool, so neither the benchmark run nor the judge ever reads the PID — it is provenance only, and may optionally be filled in later if a re-snapshot or provenance link is wanted. The landing gate is the same as for every fixture (Path 1 included): a committed §14 validity run that passes (`uv run python -m e2e.validate_fixture augustine-louis-azores`). Recoverability from FamilySearch records is flagged in the reviewer notes above.
