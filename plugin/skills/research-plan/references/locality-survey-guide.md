# Research Log and Contingency Planning Guide

This reference covers research logs (documenting plan execution) and
contingency planning (anticipating failures). For the locality survey
process itself, use the `locality-guide` skill.

---

## Research Logs

A research log documents every search performed, with enough detail
that another researcher could recreate the exact same search. Logs
are the proof that research was exhaustive.

### Nine elements of a log entry

1. **Date of research**
2. **Repository or source searched** (with full identifying details)
3. **Full source citation** (collection title, call number, URL)
4. **Search method** (terms used, filters applied, pages browsed,
   spelling variants tried)
5. **Purpose** (link to plan item and research question)
6. **Results** — including negative results (what was NOT found)
7. **Document identifiers** (call numbers, image numbers, page numbers)
8. **Comments/analysis** (significance, potential leads, concerns)
9. **Follow-up actions** (new plan items, verification needed)

### Negative results are findings

A search that finds nothing is evidence that the record does not exist
in that source. Always log negative results with the same detail as
positive results. "Searched and found nothing" is insufficient —
record exactly what was searched, how, and what was expected.

### Mapping to research.json

| Log element | research.json field |
|-------------|-------------------|
| Date | `date` |
| Repository + citation | `source` + `repository` |
| Search method | `search_params` |
| Purpose | `question_id` + `plan_item_id` |
| Results | `results` + `found_records` |
| Comments + follow-up | `notes` |

---

## Research Plan Chart Template

Present plans in this format for user review:

| # | Record Type | Jurisdiction | Date Range | Repository | Access | Rationale | Fallback |
|---|---|---|---|---|---|---|---|
| 1 | Probate | Schuylkill Co., PA | 1875-1890 | FamilySearch | Online, indexed | Will naming heirs = direct evidence of parentage | -- |
| 2 | Probate | Schuylkill Co., PA | 1875-1890 | Ancestry | Online, indexed | Cross-check separate index | -- |
| 3 | Land | Schuylkill Co., PA | 1850-1885 | FamilySearch | Images, not indexed | Heirs named in deed transfers; FAN witnesses | Fallback for #1 |

---

## Contingency Planning

Every plan should anticipate failure and specify fallbacks.

**Types of contingencies:**

1. **Record destroyed or nonexistent.** Plan substitute sources
   (church records if civil vital records are destroyed, tax lists
   if census is missing).
2. **Subject not found in expected record.** Plan variant spellings,
   adjacent jurisdictions, or FAN member searches.
3. **Record inaccessible.** Plan alternative access (microfilm loan,
   correspondence, local agent) or mark as "deferred pending access."
4. **Evidence contradicts the hypothesis.** Plan items to test the
   alternative hypothesis suggested by the contradiction.
5. **Nothing found anywhere.** Plan broadening: wider date range,
   parent jurisdiction, collateral relatives, contextual/occupational
   records.

Link contingencies using the `fallback_for` field in plan items.
