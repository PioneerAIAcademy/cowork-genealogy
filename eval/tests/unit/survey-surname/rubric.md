# Survey Surname Rubric

Grading dimensions for survey-surname unit tests. Evaluated by the LLM judge alongside the base rubric (correctness, completeness, tool arguments).

survey-surname tabulates every household of a surname across a place's US federal censuses. It resolves the place with `place_search`, calls `record_search` per census year with `projectPath` for staging, logs each page with `research_log_append`, groups stubs by `recordArk` into households, sections by census year and collection title, and logs the table as one more research-log entry (`tool: "survey_surname"`) whose `notes` hold the whole markdown table, ending with the pre-1880 hedge sentence. That entry appears in the file changes summary as a new `log` entry. Its full content is checked **deterministically**, not here: `test_one_log_entry_appended` pins the entry's shape and the closing hedge sentence verbatim, and `test_table_has_rubric_columns` and `test_household_grouping_and_slave_schedule` read the whole table, which the summary may truncate.

## Place resolution

Did the agent resolve the place correctly and use it to scope the census searches?

- **pass:** The agent called `place_search` with the place from the delegation, and used the result to set `recordCountry`/`recordSubdivision` (for a state) or additionally `residencePlace` (for a county) on each `record_search` call.
- **partial:** The agent called `place_search` but mis-mapped the result to `record_search` parameters (e.g. put the state in `residencePlace` instead of `recordSubdivision`), or searched with a place that does not match the delegation.
- **fail:** The agent did not call `place_search`, or used a hardcoded place that does not match the delegation.

## Census coverage

Did the agent search the right census years within the requested span?

- **pass:** The agent called `record_search` once per US federal census year that falls within the delegation's year span (e.g. 1820, 1830, 1840 for a 1820-1840 span), with `residenceYearFrom` = `residenceYearTo` = that year, and `recordType: "census"`.
- **partial:** The agent searched most of the years but missed one, or searched a year outside the span, or used a year range instead of year-by-year calls.
- **fail:** The agent searched none of the years, or searched only one year when multiple were requested, or did not use `recordType: "census"`.

## Threshold compliance

Did the agent respect the 600 per-year `totalMatches` threshold?

This dimension grades only tests where at least one year is over the threshold. When no year exceeds 600, score `null`.

- **pass:** For each year where `totalMatches` exceeded 600, the agent fetched no additional pages and told the user the count, asking which counties to survey for that year. For years under 600, the agent paged normally (or all results fit on one page).
- **partial:** The agent noticed the high `totalMatches` but still fetched additional pages before stopping, or did not ask for counties.
- **fail:** The agent ignored the threshold entirely and paged through all results for a year over 600, or did not read `totalMatches` at all.

## Table structure

Did the agent produce a well-structured markdown table with the right columns and sectioning?

- **pass:** The agent logged a `survey_surname` entry whose notes hold a markdown table sectioned by census year and collection title, with columns for year, county, head of household, other surname members, record ARK, and a ruled-out column. Households are grouped by `recordArk` (for 1850+ censuses where multiple stubs share an ARK). Non-population schedules (e.g. slave schedules) are in their own sub-section.
- **partial:** The table has the right data but wrong structure (e.g. not sectioned by year, or non-population schedules mixed in with households), or is missing one column (e.g. no ruled-out column).
- **fail:** No table was logged, or the table is missing essential columns (no head of household, no county, no record ARK), or the agent returned the table in its reply without logging it.
