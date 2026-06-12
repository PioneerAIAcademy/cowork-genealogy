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

Searches the FamilySearch Research Wiki — the FamilySearch-curated
genealogy reference — and saves the guidance as a markdown file. The
FamilySearch Wiki covers genealogical research *methods* better than
Wikipedia: how to find a record type, what records a jurisdiction
holds, how to use a repository. For general-encyclopedia topics
(people, places, events), use the `search-wikipedia` skill instead.

## What to do

**Always call `wiki_search` first.** Never answer a genealogy research
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
4. Write `<topic-slug>.md` to the user's working folder. The summary
   section only — no Sources yet:

   ```
   # FamilySearch Wiki: <topic>

   <2–4 paragraph summary synthesized from chunk_text only>
   ```

   Rules for the summary:
   - `<topic>` — short noun phrase (e.g. "marriage records").
   - Paraphrase only what `chunk_text` explicitly states. Do not
     infer, elaborate, or fill gaps. Write in **plain prose
     paragraphs only** — no tables, no bullet lists, no `###`
     section headers inside the summary.
   - `<topic-slug>`: lowercase + hyphens
     (e.g. "marriage records" → `marriage-records.md`).

5. **Append the Sources section** to the file using Edit. This step
   is mandatory — do not skip it, do not proceed to step 7 until it
   is done:

   ```
   ## Sources

   - [<page_title> — <section_heading>](<source_url>)
   ```

   One bullet per result, using the exact `page_title`,
   `section_heading`, and `source_url` values from the tool response.

6. Read the file back. Confirm it ends with a `## Sources` section
   containing at least one link. If not, Edit to append it now.
7. Tell the user the file was created — only after steps 5 and 6 are
   complete.

## Example

User: "Search the FamilySearch wiki for how to find Italian birth records"

You should:
1. Call `wiki_search({ query: "How do I find Italian birth records?" })`
2. Receive ranked wiki sections about Italian civil registration.
3. Write `italian-birth-records.md` with the required structure:
   ```
   # FamilySearch Wiki: Italian birth records

   Civil registration began in 1866...

   ## Sources

   - [Italy Civil Registration — Birth Records](https://www.familysearch.org/en/wiki/Italy_Civil_Registration#Birth_Records)
   ```
4. Tell the user the file was created.

## Re-invocation behavior

**Writes:** a markdown file at `<topic-slug>.md` in the user's working
folder, containing the FamilySearch Research Wiki findings. Does not
modify `research.json` or `tree.gedcomx.json`.

**On repeat invocation:** overwrites the existing same-named markdown
file with refreshed wiki content. Other locality/topic files in the
folder are untouched.

**Do not duplicate:** if a wiki summary file already exists for the same
topic slug, refresh it in place — do not create a parallel file
with a numeric suffix.
