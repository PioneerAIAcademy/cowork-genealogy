# Genealogy Research Plugin

A Claude Cowork plugin for genealogy research.

The plugin currently contains one working reference skill
(`wiki-lookup`) and one command (`/wiki`) that demonstrate the full
plugin pipeline: calling an MCP tool, populating a markdown
template, and saving the result to a file. Use them as a template
for new skills as the project adds more tools.

Real skills wiring up the FamilySearch tools (`places`, OAuth) are
upcoming. See `../PROJECT-GOAL.md` for the roadmap.

## Skills

### wiki-lookup

Looks up a topic on Wikipedia (via the `wikipedia_search` MCP tool)
and saves the summary as a markdown file in the user's working
folder.

## Commands

### /wiki

Shortcut for the wiki-lookup skill. Usage: `/wiki Albert Einstein`
