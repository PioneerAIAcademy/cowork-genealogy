# Scenario: elena-pre-register-birth

Swedish birthplace-and-parentage question with **no plan yet**, and a birth
that likely **predates the register** of the parish she came from.

- **Subject:** Elena Asmundsdotter (`I1`). No birth or death in the tree.
- **Known:** her marriage to Jöns Jönsson (`I2`), 29 Dec 1712, **Västra Karaby**,
  and their son Asmund (`I3`), christened 11 Sep 1718 and died 4 Feb 1768,
  **Barsebäck**.
- **q_001:** where was she born, and who were her parents? Birth estimated
  c. 1680-1692 from the marriage and the son.
- `loc_002` (Västra Karaby) records that the parish's birth register begins
  **1688**: the fact the death-record route keys on. `loc_001` (Barsebäck)
  records a register reaching back to 1648 — her later parish, where she died.

The point: when no baptism can be expected, the plan must work back from the
end of her life. It needs her own death or burial entry (Barsebäck, after 1718)
as its own item, and must not be all church-baptism items.

Derived from the `elena-asmundsdotter-origin` e2e fixture (issue #2676, merged
into #2251). The answer (her 1745 Barsebäck death entry states her birthplace)
is deliberately absent: nothing here names her birth farm, her parents or her
death date. Place, volume, collection and link fixtures were captured live
2026-10-02.
