---
name: wiki-lookup
model: claude-sonnet-4-6
description: Look up a topic on Wikipedia and save the summary as a markdown file in the user's working folder. Use this when the user asks to look up, save, or research information about a topic, person, or place.
allowed-tools:
  - wikipedia_search
---

# Wikipedia Lookup

*(This skill is intentionally minimal — it's the simplified reference example for new contributors. For the richer pattern with positive triggers and negative guards, see `citation/SKILL.md` or `record-extraction/SKILL.md`.)*

**Narration:** Read `researcher_profile.narration_guidance` from `research.json` and apply it as your narration style for this invocation. If absent, default to a one-line preamble per action.

A reference skill demonstrating the full plugin pipeline: calling an
MCP tool, populating a markdown template with the result, and saving
the file to disk. Copy this structure when wiring a new skill to one
of the other MCP tools.

## What to do

When the user asks to look up a topic:

1. Call the `wikipedia_search` MCP tool with the topic as the
   `query` parameter.
2. The tool returns `{ title, extract, url }`.
3. Read the template at `templates/wiki-summary.md` (relative to
   this skill directory).
4. Fill in the template — replace `{{title}}`, `{{extract}}`, and
   `{{url}}` with the corresponding fields from the tool result.
5. Save the result as `<title-slug>.md` in the user's current
   working folder. Build `<title-slug>` from the article title by:
   - lowercasing the title;
   - replacing every run of non-alphanumeric characters (spaces, commas,
     periods, apostrophes, parentheses, etc.) with a single hyphen;
   - trimming leading/trailing hyphens.

   Examples:
   - `"Albert Einstein"` → `albert-einstein`
   - `"Schuylkill County, Pennsylvania"` → `schuylkill-county-pennsylvania`
     (the comma collapses with the surrounding space into one hyphen)
   - `"O'Brien (surname)"` → `o-brien-surname`
6. Tell the user the file was created.

## Example

User: "Look up Albert Einstein"

You should:
1. Call `wikipedia_search({ query: "Albert Einstein" })`
2. Receive `{ title: "Albert Einstein", extract: "Albert Einstein was a German-born theoretical physicist...", url: "https://en.wikipedia.org/wiki/Albert_Einstein" }`
3. Fill in the template
4. Write `albert-einstein.md` to the working folder
5. Tell the user the file was created
