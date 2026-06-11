# Test Notes — search-external-sites

(This skill covers the paid/external sites only: **Ancestry, MyHeritage, FindMyPast,
FindAGrave, Newspapers.com**. Searching **FamilySearch** belongs to a different skill
(search-records) — so FamilySearch shows up here only as a "should NOT use this skill" test.
All tests use the existing project person: **Patrick Flynn, born about 1845,
Schuylkill County, Pennsylvania, Irish parents.**)

## Test 1 — FindMyPast (Irish records)
- Researcher asks → Search FindMyPast for Patrick Flynn's birth in Ireland, about 1845
- Skill should do → FindMyPast search URL, fields filled (name, ~1845, Ireland), log entry clear
- Instructions to user → open the link, save matching results as PDF, bring it back
- Partial/Wrong → wrong site, missing year/place, vague log entry

## Test 2 — FindAGrave (burial)
- Researcher asks → Look for Patrick Flynn's grave on FindAGrave (Pennsylvania, died after 1880)
- Skill should do → FindAGrave search URL, fields filled, log entry clear + a caution that
  FindAGrave memorials are a compiled source (can be wrong; check who created it and what
  sources it cites)
- Instructions to user → save the memorial page as PDF, bring it back
- Partial/Wrong → no compiled-source caution, vague log entry

## Test 3 — Newspapers.com (obituary)
- Researcher asks → Search Newspapers.com for Patrick Flynn's obituary, Schuylkill County, 1880s–1900s
- Skill should do → Newspapers.com search URL with name + date range + place, log entry clear
- Instructions to user → save the clipping/page as PDF, bring it back
- Partial/Wrong → missing date range or place, vague log entry

## Test 4 — Log written when the link is made
- Researcher asks → any search (e.g., Ancestry 1880 census for Patrick Flynn)
- Skill should do → write the research-log entry THE MOMENT the link is generated
  (marked "waiting for results"), not only after results come back
- Partial/Wrong → log written late, or not at all

## Test 5 — Nothing found (nil result)
- Researcher asks → user comes back: "I searched, zero matches"
- Skill should do → still record the search in the log, with a negative outcome —
  a search that finds nothing is evidence too (proves the research was exhaustive)
- Partial/Wrong → skips the log because "there was nothing to record"

## Test 6 — Subscriptions
- Researcher asks → "Where should I search for Patrick's marriage?" when the researcher
  profile says NO paid subscriptions (or only Ancestry)
- Skill should do → suggest free options first (FindAGrave), warn that Ancestry/MyHeritage
  links will hit a login/pay wall
- Partial/Wrong → recommends a paid site with no warning

## Test 7 — Messy link list
- Researcher asks → a search where the tool returns links for several sites mixed together, with duplicates
- Skill should do → use only the requested site's links, remove duplicates
- Partial/Wrong → uses another site's links, keeps duplicates

## Test 8 — WRONG SKILL: planning question
- Researcher asks → "What external sites should I search next to find Patrick's parents?"
- Skill should do → NOT run — this is a planning question (research-plan skill)
- Partial/Wrong → generates search URLs anyway

## Test 9 — WRONG SKILL: record already in hand
- Researcher asks → "Here's the Ancestry result PDF — extract the details"
- Skill should do → NOT run — analyzing a capture is record-extraction's job
- Partial/Wrong → starts a new search instead

(The existing test for "Search FamilySearch for Flynn" → routes to search-records — already
covers the FamilySearch case. Keep it.)

# Rubric Addition — Log Entry Rule
- **Pass:** Clear, specific entry naming site, person, place, year — written when the link is
  generated and updated when results come back (including "nothing found")
- **Partial:** Entry present but incomplete or vague (e.g., "searched records" without
  site/year), or only written after results came back
- **Fail:** No log entry, or incorrect/misleading