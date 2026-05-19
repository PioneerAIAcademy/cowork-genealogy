# Tool catalog (informal descriptions)

These descriptions are organized in roughly the order the tools were
brainstormed. The authoritative list of canonical names lives in
[`docs/specs/skill-architecture-spec.md`](../specs/skill-architecture-spec.md).
Where this file uses old informal names, they are mapped to canonical
names below.

- `tree_read`: given a person ID, return all information about that person found in the FamilySearch tree, including sources
- `wiki_country_research_tips`: given a place id, return country-specific research tips from the FamilySearch wiki
- `wiki_country_online_records`: given a place id, return a list of online record sources for the country
- `wiki_country_getting_started`: given a place id, return the "getting started" wiki section for that country
- `wiki_country_home`: given a place id, return the FamilySearch wiki country home page
- `wiki_search`: given a question about how to do genealogy research, return relevant sections from the FamilySearch wiki as a list of markdown texts
- `wiki_read`: given a FamilySearch wiki page title, return the entire markdown for that page (includes library resources and learning center videos)
- `wikipedia_search`: given a search query, use the Wikipedia API to find relevant page titles plus summaries on Wikipedia
- `place_search`: given a place name, return information about the place, including its id and its jurisdictional hierarchy over time
- `place_population`: given a place id and time period, return population statistics about the number of people living in that place during that time period
- `place_collections`: given a place name (list mode) or a collection id (detail mode), return collections at FamilySearch covering that place, or the detailed FS response for a specific collection
- `place_external_links`: given a place id, return links to record collections or other information outside of FamilySearch about that place
- `place_distance`: given two place ids, return the distance between them
- `record_search`: given a structured genealogy search (names, dates, places, and relationships about a person and optional collection id), return matching records, including record ids, from FamilySearch historical records
- `image_search`: given a structured genealogy metadata search (date, place, and required collection id), return the matching image ids
- `image_read`: given an image id, return the image data plus a transcription
- `fulltext_search`: given a textual genealogy search query, return matching full-text chunks, including page ids, from FamilySearch full texts
- `match_persons`: given data (names, dates, places, and relationships) about one person or record and a second person or record, return the likelihood that they are the same person (based on an ML model)
- `check_warnings`: given data (names, dates, places, and relationships) about a person, return warnings if the data is likely incorrect; e.g., the person married before 12 years old, died after 120 years old
- `convert_calendar`: Julian↔Gregorian, Old Style/New Style, Quaker double-dating. Country-specific transition dates (England 1752, etc.)

Schema validation is **not** an MCP tool — it is implemented as a
bundled Python script inside the validate-schema skill. Deterministic
validation belongs in scripts, not in tool calls that route through
the LLM.
