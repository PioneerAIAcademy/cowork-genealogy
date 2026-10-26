# Where Else To Search Rubric

Grading dimensions for where-else-to-search unit tests. Evaluated by the LLM judge alongside the base rubric (correctness, completeness, tool arguments).

where-else-to-search runs after a FamilySearch historical-records search, with no project. It resolves the place with `place_search`, makes one `external_links_search` call, picks at most 8 curated rows whose host the URL builder supports, and builds each with `build_external_search_url` (the row's `url` as `baseUrl`). It holds no writer, reads no project file, and never passes `projectPath`.

## Selection

Did the agent pick the right curated rows, and only curated rows?

- **pass:** Every suggestion was built from a row `external_links_search` returned, on a host in the agent's table, with that row's `url` as `baseUrl`. Rows whose `linkText` names the searched record type or collection come first, then dated rows overlapping the searched years. There are at most 8. With zero rows returned, the agent built nothing and said no curated collection was found.
- **partial:** The suggestions are all curated and buildable, but a clearly matching row (named by the test's context) was passed over for an unrelated one, or an undated row outranks a dated overlapping one with no reason.
- **fail:** A suggestion names a site or collection no tool returned, a non-buildable host was passed to `build_external_search_url`, more than 8 suggestions were given, or the agent padded a short or empty list with sites of its own choosing.

## Grounding

Is each reason drawn from what the tools returned? This dimension needs a genealogist's annotation.

- **pass:** Each reason gives the row's `linkText`, its years (or says it is undated) and how they cover the searched years, and whether the site is free or needs a subscription, as `access` reported it. Nothing else is asserted about the site, the place or the record set. With fewer than 3 suggestions, the reply says that is all FamilySearch lists for that place and period.
- **partial:** A reason omits the years or the access, or calls a dated row's coverage wrong (e.g. says it covers a year outside its span).
- **fail:** A reason states a fact about a site, place or collection that no tool returned, or a generic line ("Ancestry has many records") stands in for the grounded one.

## Links

Is every link one a tool returned, and does the user get it?

- **pass:** Every link is a `url` from a tool response in this run, unaltered. Every suggestion's link appears in full after the final `---`. Unbuildable rows, if listed, appear separately as opening the collection without a prefilled search.
- **partial:** A link is present above the `---` but missing below it, or an unbuildable row is presented as a prefilled search.
- **fail:** A link was written or edited by hand, or the user-facing block carries no links.

## Prose

Is the user-facing block readable by a beginner?

- **pass:** Below the `---`, one short plain paragraph per suggestion, then one closing sentence. No ids, file names, tool names or field names. Above it, only the place searched, the years used and the counts.
- **partial:** The block names a tool or field, or runs to an essay.
- **fail:** There is no `---` block, or the agent created a project, read `research.json`, or called a writer.
