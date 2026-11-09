# mid-research-flynn-linked

Patrick Flynn parentage research, mid-project.

- **Objective:** Identify the parents of Patrick Flynn (b. ~1845, d. 1908)
- **Questions:** q_001 (parentage, in_progress), q_002 (1850 census placement, resolved)
- **Plans:** pl_001 (1850 census search, completed), pl_002 (parentage evidence, active)
- **Log:** 5 entries — 1850 census on FamilySearch/Ancestry/MyHeritage, 1860 census, death cert
- **Sources:** 9 sources. Four are logged and extracted — src_001 (1850 census FS),
  src_002 (1850 census Ancestry), src_003 (1860 census), src_004 (death cert). Five
  were added later and are deliberately unworked: src_005 (St. Mary's baptism, 1845),
  src_006 (Thomas Flynn will, 1881), src_007 (Mary Elizabeth Flynn birth cert, 1905),
  src_008 (Thomas → Patrick deed, 1881), src_009 (Patrick Flynn obituary, 1908). Each
  of those five has `log_entry_id: null` and no extracted assertions — that is the
  intended mid-research state, **not** a missing or fabricated source.
- **Assertions:** 13 assertions, all drawn from the four logged sources (src_001 ×5,
  src_002 ×2, src_003 ×3, src_004 ×3). src_005–src_009 have none yet.
- **Person evidence:** 6 links (Patrick → I1, Thomas → I2)
- **Conflicts:** 1 resolved (birthplace: Ireland vs Pennsylvania)
- **Hypotheses:** h_001 (Thomas is Patrick's father, supported)
- **Timelines:** t_001 (Patrick, 4 events, 1 gap)
- **Proof summaries:** ps_001 (parentage, probable)
- **GedcomX persons:** I1 (Patrick Flynn), I2 (Thomas Flynn), I3 (Mary Flynn, sister), I4 (James Flynn, brother)
- **GedcomX relationships:** R1 (Thomas → Patrick), R2 (Thomas → Mary), R3 (Thomas → James) — all ParentChild
- **Note on siblings:** Mary and James are stub entries (preferred name + gender only, no facts).
  They are **prior-research children**: R2/R3 cite the St. Mary's baptismal registers (S5 —
  baptisms of 1841 and 1847), NOT the 1850 census. They represent the canonical shape Dallan
  called for: when researching Patrick on a household census, already-documented siblings exist
  as persons in `tree.gedcomx.json` so warnings like `relativesChildBirthRange40` and skills
  like `person-evidence` can reach them. Mary and James do not appear in the 1850 census
  household (which lists Bridget, Patrick, and John as children) — a record-vs-tree
  discrepancy that is deliberate: extraction from that census should stub the new children and
  surface the discrepancy as an identity question, never rename existing persons.

## Why this copy exists, and what its links are

A copy of `mid-research-flynn` in which Patrick's own facts are linked, rather than only
the relationship assertions that name him. In `mid-research-flynn` his 1860 census entry
and his death certificate are reached ONLY through two-party relationship
assertions (a_010, a_013), so a strict reading of "the assertions linked to
this person" finds him no 1860 residence and no death.

Twelve live `person_evidence` rows. Six are the original scenario's. The six
added here are of two kinds, and the distinction is the point of the copy:

**Agent-written links** — what a researcher's person-evidence pass produces:

| row | assertion | record entry |
|---|---|---|
| pe_007 | a_008 (name) | 1860 census, child_2 |
| pe_009 | a_011 (death) | 1908 death certificate, deceased |

**Tool-derived rows** — written by `research_append` because a link claims the
whole record entry, not the one fact it names. Each carries no `match_score`
and a rationale naming the link it came from:

| row | assertion | derived from | record entry |
|---|---|---|---|
| pe_011 | a_002 (birth) | a_001 | 1850 census, child_1 |
| pe_012 | a_003 (residence) | a_001 | 1850 census, child_1 |
| pe_008 | a_009 (birth) | a_008 | 1860 census, child_2 |
| pe_010 | a_012 (birth) | a_011 | 1908 death certificate, deceased |

a_012 ("Born 1845, Pennsylvania") is the rejected side of conflict c_001. It is
linked here deliberately: a timeline must leave it out because the conflict
rejected it, not because nothing linked it.
