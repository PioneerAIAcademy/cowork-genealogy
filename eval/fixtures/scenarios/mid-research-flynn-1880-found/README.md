# mid-research-flynn-1880-found

**DRAFT variant of `mid-research-flynn` — genealogist review needed.**

Same mid-project Patrick Flynn parentage research as `mid-research-flynn`, with one
difference: the **1880 census has just been located and logged (plan item `pli_007`,
log entry `log_006`) but NOT yet extracted** — there are no 1880 assertions, sources,
or tree facts. It encodes the "found, awaiting extraction" state.

Used by `ut_tree_edit_003` (negative test): the user says *"I just found the 1880
census… add the facts to the tree,"* and tree-edit should **decline** and route to
record-extraction (facts flow extraction → proof-conclusion → tree, never directly
from a raw record).

> ⚠️ **Placeholder.** The 1880 household in `log_006`'s notes (Patrick as head of
> household, ~35, Schuylkill County) is invented scaffolding. A genealogist should
> set the real household composition, ages, and 1880 relationship-column detail —
> then re-run `--skill tree-edit` and re-annotate — before this is released.

- **Objective:** Identify the parents of Patrick Flynn (b. ~1845, d. 1908)
- **Questions:** q_001 (parentage, in_progress), q_002 (1850 census placement, resolved)
- **Plans:** pl_001 (1850 census, completed), pl_002 (parentage evidence, active — now incl. `pli_007`, 1880 census)
- **Log:** 6 entries — 1850 (FS/Ancestry/MyHeritage), 1860, death cert, **1880 census found (`log_006`, unextracted)**
- **Sources:** 4 (no 1880 source yet — created at extraction)
- **Assertions:** 13 (no 1880 assertions yet — extraction pending)
- **Person evidence:** 6 links (Patrick → I1, Thomas → I2)
- **Conflicts:** 1 resolved (birthplace: Ireland vs Pennsylvania)
- **Hypotheses:** h_001 (Thomas is Patrick's father, supported)
- **Timelines:** t_001 (Patrick, 4 events, 1 gap)
- **Proof summaries:** ps_001 (parentage, probable; note updated: 1880 located, extraction pending)
- **GedcomX persons:** I1 (Patrick Flynn), I2 (Thomas Flynn)
- **GedcomX relationships:** R1 (ParentChild, Thomas → Patrick)
