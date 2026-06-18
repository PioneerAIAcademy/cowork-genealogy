---
name: search-wikipedia
model: claude-sonnet-4-6
description: Look up a topic on Wikipedia — the general-purpose encyclopedia — and save the summary as a markdown file in the user's working folder. Use when the user explicitly names Wikipedia, or asks to look up or save general background on a topic, person, place, or historical event. Do NOT use when the user names the FamilySearch Research Wiki or "FamilySearch wiki" (use search-familysearch-wiki), wants a locality records-availability guide — what records exist for a place and where they are held (use locality-guide), or wants narrative genealogical history such as migration patterns or boundary changes (use historical-context).
allowed-tools:
  - wikipedia_search
---

# Wikipedia Lookup

## Scope guard

This skill is part of a genealogy research toolkit. If the user's request
is not about looking up a topic on Wikipedia — for example, a general
programming question, a math problem, or anything unrelated to research —
**decline politely** and explain that the request is outside the toolkit's
scope. Do not attempt to answer the question or coerce it into a Wikipedia
lookup.

## What to do

When the user asks to look up a topic:

1. Call the `wikipedia_search` MCP tool with the topic as the
   `query` parameter.
2. The tool returns `{ title, extract, url }`.
3. Read the template at `templates/wiki-summary.md` (relative to
   this skill directory).
4. Fill in the template — replace `{{title}}`, `{{extract}}`, and
   `{{url}}` with the corresponding fields from the tool result.
   **Use the exact values from the tool response. Do not paraphrase,
   summarize, truncate, or editorialize the extract. Copy it verbatim.**
5. Save the result as `<title-slug>.md` in the user's current
   working folder using a file-write tool. **You must actually write
   the file — do not just describe it in your response.**
   Build `<title-slug>` from the article title by:
   - lowercasing the title;
   - replacing every run of non-alphanumeric characters (spaces, commas,
     periods, apostrophes, parentheses, etc.) with a single hyphen;
   - trimming leading/trailing hyphens.

   Examples:
   - `"Albert Einstein"` → `albert-einstein`
   - `"Schuylkill County, Pennsylvania"` → `schuylkill-county-pennsylvania`
     (the comma collapses with the surrounding space into one hyphen)
   - `"O'Brien (surname)"` → `o-brien-surname`
6. Tell the user the file was created. **Keep it brief** — state the
   filename and that it was saved. Do not restate, summarize, or
   paraphrase the article content in your response. The content is
   in the file; the user can read it there.

## Re-invocation behavior

**Writes:** a markdown file at `<title-slug>.md` in the user's working
folder, containing the Wikipedia summary. Does not modify `research.json`
or `tree.gedcomx.json`.

**On repeat invocation:** overwrites the existing same-named markdown file
with refreshed Wikipedia content. Other topic files in the folder are
untouched.

**Do not duplicate:** if a summary file already exists for the same title
slug, refresh it in place — do not create a parallel file with a numeric
suffix.

