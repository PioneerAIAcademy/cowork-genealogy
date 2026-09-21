# Boundary Changes and Calendar Transitions

Boundary changes and calendar transitions are two of the most common
causes of apparent conflicts in genealogical records. Understanding
how they work prevents misinterpretation of records and directs the
researcher to the correct repository.

## Boundary changes

### Why boundaries matter for genealogy

When a jurisdiction's boundaries change, the person does not move
but the political geography around them shifts. This produces
records that appear to conflict:

- A person "born in Virginia" in one record and "born in West
  Virginia" in another may have been born in the same location.
  West Virginia separated from Virginia in 1863.
- A family appearing in County A in one census and County B in the
  next may not have moved. County B may have been carved out of
  County A between census years.
- Church records may be filed under a different parish than expected
  if parish boundaries were redrawn.

### Types of boundary changes

#### State and country formation

Formation dates for US states are confirmed from each state's
genealogy wiki page — the skill fetches `{State},_United_States_Genealogy`
(e.g. `West_Virginia,_United_States_Genealogy`,
`Kentucky,_United_States_Genealogy`, `Maine,_United_States_Genealogy`,
`Tennessee,_United_States_Genealogy`, `Vermont,_United_States_Genealogy`)
live in Step 3. Do not restate these dates from memory; read them from
the fetched page.

- European boundary changes after WWI (dissolution of
  Austria-Hungary, Ottoman Empire; creation of new states)
- European boundary changes after WWII (Poland shifted west,
  German territories reassigned, Baltic states absorbed into USSR)
- Partition of Ireland (1922) — confirmed from `Ireland_Genealogy`,
  fetched live in Step 3.

#### County formation

New counties are created from existing ones throughout American
history. This is extremely common and affects where records are
held:

- Records created before the split are held by the parent county
  (the county from which the new one was carved).
- After the split, records are held by whichever county now
  contains the relevant location.
- Some states created dozens of new counties over relatively short
  periods. Virginia and North Carolina are particularly complex.

**Research protocol:** When searching for records in a specific
county, always determine when that county was formed and which
county (or counties) preceded it. Search the parent county for
records predating the formation date.

#### Parish and township changes

- Church parishes were redrawn as populations shifted, especially
  during periods of rapid growth or decline.
- Township boundaries changed with county reorganization.
- These changes affect which repository holds church records and
  local government records for a given location and date.

#### City annexation

- Cities regularly annexed surrounding territory, sometimes moving
  a location from one county's jurisdiction to another.
- This affects which county holds vital records, court records, and
  property records for the annexed area.

### How to research boundary changes

1. **Always address county-level boundaries, not just state-level.**
   Records (deeds, tax lists, probate, court records) are filed at
   the county level. A researcher who knows the state but not the
   county won't know which courthouse or archive to contact.
2. **Direct researchers to historical boundary maps.** Resources
   like Historical Map Works and the FamilySearch locality guide
   show which county held jurisdiction over a specific location at
   a given point in time. This is the practical first step before
   searching any record repository.
3. Use MCP tools to look up the formation history of the
   jurisdiction in question.
4. Identify the parent jurisdiction(s) for the relevant date.
5. Search records in both the current and predecessor jurisdictions.
6. When a user encounters a place discrepancy, check whether a
   boundary change explains it before considering other causes.

## Calendar transitions

### French Republican calendar

France used the Republican calendar from 1793 to 1805. The month
names and year numbering (Year I = September 22, 1792) are on the
`French_Republican_Calendar` wiki page — the skill fetches it live
in Step 3 when French civil records from this period require
conversion to the Gregorian calendar. For Julian/Gregorian and
Quaker calendar conversions, redirect to the convert-dates skill.

## How to apply this reference

1. **Place conflicts:** When records disagree about a location,
   check for boundary changes at the relevant dates before
   concluding the records truly conflict.
2. **Date conflicts:** When dates disagree by exactly 10–13 days or
   by one year in the January–March range, a calendar-system
   difference is the most common cause. Redirect to convert-dates
   for the conversion.
3. **Missing records:** When records cannot be found in the expected
   jurisdiction, check whether a boundary change moved the
   location into a different jurisdiction. Search the predecessor
   or successor jurisdiction.
4. **French Republican calendar records (1793–1805):** When working
   with French civil records from this period, note that they use a
   different month-name system. The skill fetches
   `French_Republican_Calendar` live in Step 3 for the month names.
