# Search Strategy for External Sites

## Two fundamental approaches

### "Less is more" (broad start)
Begin with minimal criteria — just a surname and a broad location.
This casts a wide net and prevents missing results that were indexed
with errors, spelling variations, or incomplete data.

**Best for:**
- Unusual surnames
- Uncertain details (approximate dates, unknown given name spelling)
- Initial exploration of what is available
- Situations where indexing quality is unknown

### "Kitchen sink" (narrow start)
Enter as many known details as possible — full name, dates, places,
and relative names — to filter out false matches immediately.

**Best for:**
- Very common names (Smith, Johnson, Brown)
- Well-documented individuals with known dates and places
- Sites that handle multiple parameters well (Ancestry)
- Second-pass searches after a broad search returned too many hits

## Choosing a strategy per search

Consider the name's uniqueness and your confidence in the details:
- Rare name + uncertain details → broad start
- Common name + strong details → narrow start
- Any name + first time on this site → broad start to assess what
  the collection contains
- Follow-up after too many results → add parameters incrementally

## Parameter iteration when results are poor

### Too many results (hundreds or thousands)
1. Add a relative name (spouse, father, or mother)
2. Narrow the geographic scope (state → county)
3. Restrict to a specific collection rather than site-wide
4. Add a date constraint if not already present

### Zero results
Try these adjustments in priority order:

1. **Remove the given name** — keep surname + place + date. The
   given name may be indexed as an initial, nickname, or in a
   different language.
2. **Broaden the date range** — if the site supports year ranges,
   widen to ±5 or ±10 years. Census ages are frequently inaccurate.
3. **Try spelling variants** — use wildcards if the site supports
   them (Sm*th, Eli?abeth), or manually try common variant spellings.
4. **Broaden the location** — move from county to state level.
5. **Remove the location entirely** — the ancestor may have been
   recorded in an unexpected jurisdiction.
6. **Search by a relative instead** — use the spouse's or parent's
   name as the primary search subject.
7. **Try a different event type** — if searching by birth location,
   try residence or death location instead.

### Still zero after all variations
The records may not exist in this database. Possible explanations:
- The collection does not cover the relevant time period or place
- The records exist but have not been digitized or indexed
- The individual was recorded under a significantly different name

Log the negative result and move to the next repository or suggest
checking physical holdings.

## Boolean and advanced search techniques

Some external sites support advanced query syntax:

| Technique | Where supported | Example |
|-----------|----------------|---------|
| Exact phrase matching | Newspapers.com, some Ancestry collections | "Patrick Flynn" |
| Wildcard characters | Ancestry (*, ?), FindMyPast | Fl?nn, Sm*th |
| OR for name variants | Newspapers.com | Flynn OR Flyn OR Flinn |
| Excluding terms | Newspapers.com | Flynn -advertisement |

Not all sites document their Boolean support clearly. When in doubt,
use simple single-term parameters and iterate rather than complex
queries that may not parse correctly.

## Research log requirements for search strategy

Every search URL generated must be logged with enough detail for
reproduction. The log entry must capture:

- The site searched
- The collection (if not site-wide)
- All parameters used (names, dates, places, filters)
- The strategy rationale (why these parameters were chosen)
- The result count and match quality summary
- For zero-hit searches: what variations were attempted and what
  was learned from the absence

This documentation proves that the researcher (a) searched
systematically rather than randomly, (b) tried reasonable
variations before declaring a collection exhausted, and (c)
understands the difference between "not found here" and "does
not exist."

## Exit criteria: when is an external-site search exhaustive?

A reasonably exhaustive search of a given external site has been
performed when:

- Searched under at least two name variants (original spelling
  plus one plausible alternative)
- Searched with and without relative names where applicable
- Searched at both the specific jurisdiction and one level broader
- Examined the results from each collection that returned hits
- Read the collection description to understand known coverage gaps
- Documented every search attempt including zero-hit searches
- Noted any access limitations (subscription required, collection
  not available in this region)

Meeting these criteria for one site does not make research
exhaustive overall — the same standards apply to each repository
in the research plan.
