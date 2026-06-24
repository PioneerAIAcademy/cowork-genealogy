---
name: search-familysearch-wiki
model: claude-sonnet-4-6
description: >-
  Search the FamilySearch Research Wiki for genealogy research guidance and save
  the findings as a markdown file in the user's working folder. Use when the
  user asks to "search the FamilySearch wiki", "check the FS research wiki", OR
  asks any how-to genealogy research question such as "how do I find marriage
  records", "how do I find death records", "how do I find census records",
  "how do I find military records", "how do I find land records",
  "how do I find probate records", "how do I find church records",
  "how do I find immigration records", or asks how to research ancestors from a
  specific country or region, or how to use a FamilySearch resource. Always use
  this skill for any "how do I find [record type]" question even when the user
  does not explicitly name the FamilySearch wiki — do not answer from training
  knowledge. Do NOT use when the user explicitly names Wikipedia
  (use search-wikipedia), wants a comprehensive locality records-availability
  guide (use locality-guide — typical phrasings: "what records exist for
  [place]", "where are records held for [place]", "what genealogy records
  are available for [county/state/country]"), or wants narrative historical
  background such as migration patterns or boundary changes (use historical-context).
allowed-tools:
  - wiki_search
---

# search-familysearch-wiki

**Narration:** Read `researcher_profile.narration_guidance` from `research.json` and apply it as your narration style for this invocation. If absent, default to a one-line preamble per action.

Searches the FamilySearch Research Wiki — the FamilySearch-curated
genealogy reference — and saves the guidance as a markdown file. The
FamilySearch Wiki covers genealogical research *methods* better than
Wikipedia: how to find a record type, what records a jurisdiction
holds, how to use a repository. For general-encyclopedia topics
(people, places, events), use the `search-wikipedia` skill instead.

## What to do

**Always search the FamilySearch Wiki first.** Never answer a genealogy research
question from your training knowledge — the wiki provides current,
sourced guidance that you must retrieve. Even if you believe you know
the answer, call the tool and synthesize only from what it returns.

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
4. Read and fill `templates/wiki-search-summary.md`. **Actually invoke the file-write tool to save it** (don't just describe the save) as `<topic-slug>.md` in the user's working folder.
   - `<topic-slug>`: extract the **core noun phrase** from the user's question — the record type and any qualifying jurisdiction/origin — and skip leading verbs/qualifiers like "how to use", "search for", "find", "tracing". Lowercase + hyphens, no leading/trailing hyphens. Examples: "how to use census records to trace my family" → `census-records.md`; "How do I find Italian birth records?" → `italian-birth-records.md`; "How do I find German church records?" → `german-church-records.md`.
   - Summary: synthesize **only** from `chunk_text` — every sentence must trace to a specific chunk. Do NOT add facts (dates, repository names, URLs), do NOT interpret beyond the text (e.g., what a record's contents "frequently imply" or "point to"), do NOT strengthen the source's wording. Plain prose paragraphs only; no lists, sub-headers, or URLs in the body.
   - Sources: one bullet per result — `- [page_title — section_heading](source_url)` — using the exact values from the tool response.
5. Tell the user the filename. Keep it brief.

For general-encyclopedia topics use `search-wikipedia`; for a locality records-availability survey use `locality-guide`; for migration patterns or narrative history use `historical-context`.

## Re-invocation behavior

**Writes:** a single `<topic-slug>.md` file in the user's working folder. Does not write `research.json` or `tree.gedcomx.json`.

**On repeat invocation:** if the same `<topic-slug>.md` already exists, overwrite it in place with the fresh `wiki_search` result for the new query.

**Never duplicate:** do not create a second file for the same topic-slug. Empty results → write no file.
