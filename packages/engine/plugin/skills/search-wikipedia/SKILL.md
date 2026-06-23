---
name: search-wikipedia
model: claude-sonnet-4-6
description: Look up a topic on Wikipedia — the general-purpose encyclopedia — and save the summary as a markdown file in the user's working folder. Use when the user explicitly names Wikipedia, or asks to look up or save general background on a topic, person, place, or historical event. Do NOT use when the user names the FamilySearch Research Wiki or "FamilySearch wiki" (use search-familysearch-wiki), wants a locality records-availability guide — what records exist for a place and where they are held (use locality-guide), or wants narrative genealogical history such as migration patterns or boundary changes (use historical-context).
allowed-tools:
  - wikipedia_search
---

# Wikipedia Lookup

## Scope guard

If the user's request is not about looking up a topic on Wikipedia — for example, a general
programming question, a math problem, or anything unrelated to research —
**decline politely** and explain that the request is outside the toolkit's scope.

## What to do

1. Call the `wikipedia_search` MCP tool with the topic as the
   `query` parameter.
2. Read the template at `templates/wiki-summary.md` (relative to
   this skill directory).
3. Fill in the template — replace `{{title}}`, `{{extract}}`, and
   `{{url}}` with the corresponding fields from the tool result.
   **Use the exact values from the tool response. Do not paraphrase,
   summarize, truncate, or editorialize the extract. Copy it verbatim.**
4. Save the result as `<title-slug>.md` in the user's current
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
5. Tell the user the file was created. One sentence only — for example:
   "Saved the Wikipedia summary to `schuylkill-county-pennsylvania.md`."
   Do not restate, summarize, or paraphrase the article content.
