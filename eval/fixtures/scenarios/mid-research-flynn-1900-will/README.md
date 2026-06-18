# mid-research-flynn-1900-will

Patrick Flynn parentage research, mid-project — extends `mid-research-flynn`
with a **1900 census** and **Thomas Flynn's will**, to exercise two
assertion-classification special cases that the base scenario lacks:

1. **Pre-1940 census, information quality (Layer 2).** The 1900 census
   (src_005) records no respondent. `a_014` (Patrick's age) is correctly
   `indeterminate`. `a_015` (the *father's* birthplace) is stored naively
   as `indeterminate` too — but no household member could have witnessed
   the grandfather's birth, so it must be **forced to `secondary`**
   regardless of who answered. That upgrade is the test.
2. **Negative evidence (Layer 3).** Thomas Flynn's 1880 will (src_006,
   reusing tree source S4) names children Mary, John, and Bridget — and
   **not** Patrick. `a_016` stores the named-children fact with a naive
   `indirect` evidence type; against q_001 (parentage) Patrick's
   meaningful absence from a complete list of heirs is **negative
   evidence**, not "no evidence" and not indirect. That reclassification
   is the test.

Everything else is inherited from `mid-research-flynn` unchanged.

- **Objective:** Identify the parents of Patrick Flynn (b. ~1845, d. 1908)
- **Questions:** q_001 (parentage, in_progress), q_002 (1850 census placement, resolved)
- **Plans:** pl_001 (1850 census, completed), pl_002 (parentage evidence, active — adds pli_004 1900 census, pli_005 will)
- **Log:** 7 entries (adds log_006 1900 census, log_007 will)
- **Sources:** 6 (adds src_005 1900 census → S5, src_006 will → S4)
- **Assertions:** 16 (adds a_014 age=indeterminate, a_015 father's-birthplace=indeterminate→should be secondary, a_016 will-children=indirect→should be negative)
- **Conflicts:** 1 resolved (birthplace: Ireland vs Pennsylvania)
- **GedcomX persons:** I1 (Patrick Flynn), I2 (Thomas Flynn)
- **GedcomX sources:** S1–S5 (adds S5 1900 census)

Validated: `validate_research_schema` passes (valid, no warnings).
