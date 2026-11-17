# flynn-exhaustive-ready

Patrick Flynn parentage research with every planned search carried out and
the research genuinely exhaustive, but the `search_stop` not yet written.
This is the state immediately before research-exhaustiveness declares.

## What the project holds

Question `q_001`: who was the father of Patrick Flynn (b. ~1845, d. 1908)?
The mother is out of scope.

Plan `pl_002`, all items closed:

| Item | Search | Result |
|---|---|---|
| `pli_004` | 1860 census | Patrick, 15, in Thomas Flynn's household (`log_004`) |
| `pli_005` | 1908 death certificate | names Thomas Flynn as father; informant a son-in-law (`log_005`) |
| `pli_006` | probate 1860-1890 | Thomas Flynn's will, made 1881, filed 1882, names "my eldest son Patrick Flynn" (`log_006`) |
| `pli_007` | censuses 1870, 1880, 1900 | 1870 in Thomas's household; 1880 and 1900 head of his own; all give Ireland (`log_008`) |
| `pli_008` | Pottsville baptismal register 1845-1850 | read page by page, no entry (`log_007`) |
| `pli_009` | naturalization | `skipped`, `skip_category: "answered"`, with a recorded reason |
| `pli_010` | indexed Irish Catholic baptisms 1844-1846 | several candidates, none identifiable (`log_009`) |

The birthplace conflict `c_001` (Ireland in the censuses, Pennsylvania on
the death certificate) is resolved to Ireland. `ps_001` sits at `probable`
with `shortfall: "ceiling"`: the will is direct evidence, and identifying
its testator with the 1850-1870 head of household rests on name and county.

## Used by

- `ut_research_exhaustiveness_d5e`: the agent evaluates `q_001` and declares.
  The one skipped item, `pli_009`, carries a recorded reason, which the agent
  accepts as written.
- `ut_research_exhaustiveness_013`: the same declaration, reached past
  several unlinked assertions that only corroborate linked ones.

## Rebuilt 2026-11-17

Until this date the scenario skipped the 1870-1900 censuses as `answered`
("three independent sources already converge"), held a negative probate
search, and had no Irish search. Two genealogists were shown that case and
both said it was not ready to declare:

- The 1850 and 1860 censuses show co-residence only, and the death
  certificate, whose informant was a son-in-law, was the only source naming
  Thomas as father.
- 1880 is the first census with a relationship column, so skipping the later
  censuses because earlier sources agree was not a fair skip.
- Irish Catholic baptisms are name-indexed, so "parish unknown" was not a
  reason to leave them unsearched.
- The Pottsville register is worth reading for a different purpose than the
  one recorded: it tests the death certificate's Pennsylvania birthplace.

The agent, on a cheaper model, declined for the same reasons. The scenario
was the defect. The later censuses and the Irish index are now searched,
the probate search finds the will that `flynn-skipped-death-cert` already
uses for this family, `pli_008` and `log_007` state the purpose above, and
the proof summary's `shortfall` moved from `gap` to `ceiling`.

Scenarios forked from this one before 2026-11-17 (`flynn-planned-item-blocks`,
`flynn-skipped-death-cert`, `flynn-unresolved-conflict`) keep the earlier
evidence and are not changed.

## History

**pli_008 is searched, not assumed away (#2269).** It previously sat
`skipped` on the rationale that pre-1850 Irish Catholic parish records for
Schuylkill County are "fragmentary and largely unavailable", a
planning-time assumption no search tested, and a wrong one: St. John the
Baptist, Pottsville (est. 1827) has continuous registers across the window.
