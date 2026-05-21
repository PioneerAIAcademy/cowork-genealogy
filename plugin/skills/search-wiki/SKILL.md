---
name: search-wiki
model: claude-sonnet-4-6
description: Search the FamilySearch Research Wiki for genealogy research guidance and save the findings as a markdown file in the user's working folder. Use when the user asks to "search the FamilySearch wiki", "check the FS research wiki", or asks a how-to research question — how to find a record type (birth, marriage, death, census, immigration, military, church, land, probate), how to research ancestors from a specific country or region, or how to use a FamilySearch resource or repository. Do NOT use when the user explicitly names Wikipedia (use search-wikipedia), wants a comprehensive locality records-availability guide (use locality-guide), or wants narrative historical background such as migration patterns or boundary changes (use historical-context).
allowed-tools:
  - wiki_search
---

# Search FamilySearch Wiki

**Narration:** Read `researcher_profile.narration_guidance` from `research.json` and apply it as your narration style for this invocation. If absent, default to a one-line preamble per action.

Searches the FamilySearch Research Wiki — the FamilySearch-curated
genealogy reference — and saves the guidance as a markdown file. The
FamilySearch Wiki covers genealogical research *methods* better than
Wikipedia: how to find a record type, what records a jurisdiction
holds, how to use a repository. For general-encyclopedia topics
(people, places, events), use the `search-wikipedia` skill instead.

## What to do

When the user asks a genealogy research question, or asks to search
the FamilySearch wiki:

1. Call the `wiki_search` MCP tool, passing the user's research
   question as the `query` parameter. Phrase it as a natural-language
   question (e.g. "How do I find Italian birth records?").
2. The tool returns `{ query, results, ... }`. Each entry in
   `results` has `page_title`, `section_heading`, `chunk_text`, and
   `source_url`, ranked by relevance.
3. If `results` is empty, tell the user no wiki guidance was found
   and stop — do not save a file.
4. Read the template at `templates/wiki-search-summary.md` (relative
   to this skill directory).
5. Fill in the template:
   - `{{topic}}` — a short noun phrase naming the research topic.
   - `{{summary}}` — synthesize the guidance from the top-ranked
     results into 2–4 short paragraphs. Draw only from the returned
     `chunk_text`; do not add facts the wiki did not provide.
   - `{{sources}}` — one bullet per result you drew from, formatted
     `- [{{page_title}} — {{section_heading}}]({{source_url}})`.
6. Save the result as `<topic-slug>.md` in the user's current
   working folder. Build `<topic-slug>` by lowercasing the topic,
   replacing every run of non-alphanumeric characters with a single
   hyphen, and trimming leading/trailing hyphens.
7. Tell the user the file was created.

## Example

User: "Search the FamilySearch wiki for how to find Italian birth records"

You should:
1. Call `wiki_search({ query: "How do I find Italian birth records?" })`
2. Receive ranked wiki sections about Italian civil registration and
   parish records.
3. Fill the template — topic "Italian birth records", a synthesized
   summary, and a source list.
4. Write `italian-birth-records.md` to the working folder.
5. Tell the user the file was created.
