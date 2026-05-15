# Locality Guide Rubric

Grading dimensions for locality-guide unit tests. Evaluated by the LLM judge alongside the base rubric (correctness, completeness).

## Jurisdiction accuracy

Did the skill correctly identify the relevant jurisdictions for the place and time period? County boundaries, state formations, and name changes over time must be accounted for.

- **pass:** Jurisdictions correctly reflect what existed in the target time period (e.g., "Schuylkill County, formed 1811 from Berks and Northampton") and any subsequent boundary changes relevant to record-set splits.
- **partial:** Modern jurisdictions are named correctly but historical boundary changes that affect record location are missed.
- **fail:** Jurisdiction names are wrong, or the skill recommends searching in places that didn't exist in the target period.

## Record availability

Did the skill identify which record types are available for this jurisdiction and time period, and where they are held (FamilySearch, state archives, county courthouse)?

- **pass:** Names specific record classes (vital records, probate, land, church, military) with start dates and current repositories; distinguishes what's indexed/imaged from what requires onsite research.
- **partial:** Lists record classes but is vague about start dates or current repositories ("most county records exist for this period").
- **fail:** Record classes are wrong for the jurisdiction (e.g., recommending state vital records before the state began registering them) or repositories are misidentified.

## Research strategy

Did the skill provide actionable guidance on how to search effectively in this locality, including common pitfalls and alternative repositories?

- **pass:** Strategy includes search order (start with X because it's indexed and free, then Y), specific FamilySearch collection IDs or Wiki page references, and at least one pitfall (alternative spellings, religious record holdings, courthouse fires).
- **partial:** Strategy is provided but generic — search order without specific collections, or pitfalls without specific examples.
- **fail:** Strategy reduces to "search FamilySearch" without specifics, or omits a known pitfall that would mislead a researcher.
