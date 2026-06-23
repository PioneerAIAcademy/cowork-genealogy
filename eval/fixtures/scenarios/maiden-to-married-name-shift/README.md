# Scenario: maiden-to-married-name-shift

A research project tracing a woman who changed her name pattern after
marriage: born "Sarah Ann Mullen", she became "Sarah Mullen Price"
(dropping "Ann", adopting her maiden surname "Mullen" as a middle name).

## State

- **Subject:** Sarah Ann Mullen / Sarah Mullen Price (`I1`), b. 1852,
  d. 1921. The tree carries two name entries:
  - BirthName: given "Sarah Ann", surname "Mullen"
  - MarriedName (preferred): given "Sarah Mullen", surname "Price"
- **Husband:** James Price (`I2`). **Father:** William Mullen (`I3`).
- **One gathered record:**
  - `log_001` — Death certificate: "Sarah Mullen Price", father William
    Mullen. This is the starting record.
- **Plan items:**
  - `pli_001` — 1860 census, Dodge County (find Sarah Ann Mullen as a
    child in the Mullen household) — `in_progress`
  - `pli_002` — 1880 census, Dodge County (find Sarah under Price surname
    post-marriage) — `planned`

## What it exercises

- The skill must search the **1860 census** under the BirthName
  (`surname: "Mullen"`, `givenName: "Sarah"` or `"Sarah Ann"`), not
  the MarriedName.
- The skill should use `surnameAlt` to also search under "Price" as a
  fallback, in case an 1860 record was indexed under a married name
  in error, or in case the family used the Price surname early.
- Tests whether the skill correctly selects the pre-marriage name for
  a pre-marriage time period, recognizing that "Mullen" in the married
  name's given field is the maiden surname, not a given name to search
  under as-is.
