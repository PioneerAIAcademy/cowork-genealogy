---
name: say-hello
description: Greets a person by name and saves the greeting to a markdown file in the user's wiki folder. Use this when the user asks to say hello to someone, greet someone, or test the genealogy plugin.
---

# Say Hello

This is a hello-world skill that demonstrates the full plugin pipeline.

## What to do

When the user asks to say hello to someone:

1. Call the `hello` MCP tool with the person's name as the `name` parameter
2. The tool will return a `greeting` and `timestamp`
3. Read the template at `templates/greeting-page.md` (relative to this
   skill directory)
4. Fill in the template with the person's name, the greeting text,
   and the timestamp
5. Save the result as `hello-<name-slug>.md` in the user's current
   working folder, where `<name-slug>` is the person's name in
   lowercase with spaces replaced by hyphens

## Example

User: "Say hello to Aunt Mary"

You should:
1. Call `hello({ name: "Aunt Mary" })`
2. Receive `{ greeting: "Hello, Aunt Mary!", timestamp: "..." }`
3. Fill in the template
4. Write `hello-aunt-mary.md` to the working folder
5. Tell the user the file was created
