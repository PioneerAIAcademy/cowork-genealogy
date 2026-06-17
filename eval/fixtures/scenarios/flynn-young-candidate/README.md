# flynn-young-candidate

Patrick Flynn parentage research with a single father candidate who
turns out to be too young to be the biological father.

The 1850 census lists Thomas Flynn as head of household, age
approximately 20 (born ~1830), with Patrick Flynn age 5 in the same
dwelling. At face value, a man born ~1830 could be Patrick's father
(~15 at Patrick's birth). However, an Irish baptism register has been
found showing Thomas Flynn was baptized on 12 March 1835 in Dungarvan,
County Waterford, Ireland. This makes Thomas only ~10 years old when
Patrick was born (~1845) — a biological impossibility.

The key design: the baptism assertion (a_006) exists in the assertions
array and is linked to Thomas (I2) via person_evidence (pe_005), but
it is NOT linked to h_001's contradicting_assertion_ids. Claude must
read the data, perform the age arithmetic (1845 - 1835 = 10), conclude
biological impossibility, and rule out the hypothesis.

- **Objective:** Identify the parents of Patrick Flynn (b. ~1845, d. 1908)
- **Questions:** q_001 (parentage, in_progress)
- **Plans:** pl_001 (active, 2 items)
- **Log:** 2 entries (1850 census search + Irish baptism search)
- **Sources:** 2 (1850 census + Irish baptism register)
- **Assertions:** 7 (census name/birth/relationship/residence + Thomas name/birth + baptism)
- **Person evidence:** 5 links (3 for Patrick, 2 for Thomas)
- **Conflicts:** none
- **Hypotheses:** h_001 (Thomas of Schuylkill, active, supporting: [a_003], contradicting: [])
- **GedcomX persons:** I1 (Patrick Flynn), I2 (Thomas Flynn)
- **GedcomX relationships:** R1 (ParentChild, Thomas -> Patrick)
