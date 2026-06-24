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
  guide (use locality-guide), or wants narrative historical background such as
  migration patterns or boundary changes (use historical-context).
allowed-tools:
  - wiki_search
---

# search-familysearch-wiki

**Narration:** Read `researcher_profile.narration_guidance` from `research.json` and apply it as your narration style for this invocation. If absent, default to a one-line preamble per action.

Searches the FamilySearch Research Wiki — the FamilySearch-curated genealogy reference — and saves the guidance as a markdown file. The FamilySearch Wiki covers genealogical research *methods* (how to find a record type, what records a jurisdiction holds, how to use a repository). For general-encyclopedia topics (people, places, events), use the `search-wikipedia` skill instead.

## What to do

**Always search first.** Never answer a genealogy research question from your training knowledge — call the tool and synthesize only from what it returns.

1. Call `wiki_search` with the user's research question as the `query` parameter (e.g. `"How do I find Italian birth records?"`).
2. The tool returns `{ query, results, ... }`. Each entry has `page_title`, `section_heading`, `chunk_text`, and `source_url`, ranked by relevance.
3. If `results` is empty, tell the user no wiki guidance was found and stop — do not save a file.
4. Read and fill `templates/wiki-search-summary.md`. Save the filled template as `<topic-slug>.md` in the user's working folder.
   - `<topic-slug>`: lowercase + hyphens, no leading/trailing hyphens (e.g. "Italian birth records" → `italian-birth-records.md`).
   - Summary: synthesize only from `chunk_text` — every sentence must trace to a specific chunk; do not add dates, repository names, or guidance not present verbatim in the chunks, and do not strengthen the source's wording. Plain prose paragraphs only; no lists, sub-headers, or URLs in the body.
   - Sources: one bullet per result — `- [page_title — section_heading](source_url)` — using the exact values from the tool response.
5. Tell the user the filename. Keep it brief.

For general-encyclopedia topics use `search-wikipedia`; for a locality records-availability survey use `locality-guide`; for migration patterns or narrative history use `historical-context`.
