# Locality Guide Rubric

Grading dimensions for locality-guide unit tests. Evaluated by the LLM judge alongside the base rubric (correctness, completeness).

## Jurisdiction accuracy

Did the skill correctly identify the relevant jurisdictions for the place and time period? County boundaries, state formations, and name changes over time must be accounted for.

The agent may state a formation date, a parent jurisdiction or a boundary change only from a tool result in this run: its place records (`place_search`, `place_search_all` date ranges) or a page the survey or a wiki tool returned. Grade against what those results contain. When no tool result gives the history, a guide that names the jurisdiction and says the history was not confirmed by this survey meets the pass standard; do not require history known only from general knowledge, such as a parent county, an annexation or a colonial predecessor that no result names. A date range or boundary change a tool result did give, and the guide left out, still counts against it.

- **pass:** Jurisdictions correctly reflect what existed in the target time period (e.g., "Schuylkill County, formed 1811 from Berks and Northampton") and any subsequent boundary changes relevant to record-set splits.
- **partial:** Modern jurisdictions are named correctly but historical boundary changes that affect record location are missed.
- **fail:** Jurisdiction names are wrong, or the skill recommends searching in places that didn't exist in the target period.

## Record availability

Did the skill identify which record types are available for this jurisdiction and time period, and where they are held (FamilySearch, state archives, county courthouse)?

Repositories and start dates count only as a tool result in this run supplies them. A row whose repository or start date no tool result gives, and which says so, meets the pass standard for that row; do not require a repository known only from general knowledge. A repository or start date a tool result named, and the guide left out, still counts against it.

- **pass:** Names specific record classes (vital records, probate, land, church, military) with start dates and current repositories; distinguishes what's indexed/imaged from what requires onsite research.
- **partial:** Lists record classes but is vague about start dates or current repositories ("most county records exist for this period").
- **fail:** Record classes are wrong for the jurisdiction (e.g., recommending state vital records before the state began registering them) or repositories are misidentified.

## Research strategy

Did the skill provide actionable guidance on how to search effectively in this locality, including common pitfalls and alternative repositories?

Collection IDs and Wiki pages count only as the tool results in this run supply them. When the survey returned no collections, a strategy built on the image groups, catalog entries or pages it did return meets the pass standard; do not mark it down for collection IDs that do not exist in the results.

- **pass:** Strategy includes search order (start with X because it's indexed and free, then Y), specific FamilySearch collection IDs or Wiki page references, and at least one pitfall (alternative spellings, religious record holdings, courthouse fires).
- **partial:** Strategy is provided but generic — search order without specific collections, or pitfalls without specific examples.
- **fail:** Strategy reduces to "search FamilySearch" without specifics, or omits a known pitfall that would mislead a researcher.
