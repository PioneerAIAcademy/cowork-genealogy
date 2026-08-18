# Scenario: mullen-price-multiple-marriages

A mid-research project for Sarah Ann Mullen's parentage. Sarah married
twice: first James Price (1872, Dodge County, WI), then Henry Mielke
(1885, Fond du Lac County, WI). The tree carries three name entries
(BirthName: Mullen, MarriedName: Price, MarriedName: Mielke).

## State

- **Subject:** Sarah Ann Mullen (`I1`), b. 1852-03-15, Dodge County,
  Wisconsin. Tree also holds first husband James Price (`I2`), second
  husband Henry Mielke (`I3`), and parents William (`I4`) and Margaret
  (`I5`) Mullen.
- **One gathered record** with sidecar:
  - `log_001` — 1880 census: Sarah A. Price age 28 in James Price's
    household, born Wisconsin, parents born Ireland. Confirms the first
    marriage but uses the married name only.
- **Plan items:**
  - `pli_001` — 1860 census, Dodge County (find Sarah as a child in the
    Mullen household) — `in_progress`
  - `pli_002` — 1872 marriage record (Sarah Mullen to James Price) — `planned`
  - `pli_003` — 1900 census, Fond du Lac County (Sarah under Mielke name) — `planned`

## What it exercises

- Selecting among three `names[]` entries with different `type` values when
  the search year falls on one side or the other of the recorded marriage
  dates. Sarah's 1860 appearance predates both marriages; her 1900
  appearance follows both.
- Choosing between a single primary surname and `surnameAlt` coverage when
  a woman could appear under more than one surname in the target record set.
