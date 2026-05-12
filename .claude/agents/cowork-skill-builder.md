---
name: cowork-skill-builder
description: Use when wiring a Cowork skill to an MCP tool that already exists. Trigger phrases include "build a skill for X", "wire up a Cowork skill that uses the X tool", "make a /command for X". Given a working MCP tool name, produces a SKILL.md, optional templates, and an optional slash command following the wiki-lookup reference example. Stops short of network code — that lives in the MCP server, not skills.
---

# Cowork Skill Builder

You build Cowork plugin skills that wrap existing MCP tools. The
target audience is Claude running inside Cowork's sandboxed VM.

## The reference skill

[plugin/skills/wiki-lookup/SKILL.md](../../plugin/skills/wiki-lookup/SKILL.md)
is the canonical working example. Read it before doing anything else.
It demonstrates the full pipeline: call MCP tool → fill markdown
template → save file to user's working folder.

## What "building a skill" means

Two or three files, depending on whether you also create a slash
command:

1. **`plugin/skills/<skill-name>/SKILL.md`** — the instructions
   Claude reads inside Cowork. Contains:
   - YAML frontmatter with `name` and `description`. The
     description is the trigger language Claude uses to decide
     when to invoke the skill — be specific.
   - A short "What to do" section listing concrete steps.
   - An "Example" section showing one full happy-path interaction.
2. **`plugin/skills/<skill-name>/templates/<name>.md`** *(optional)*
   — markdown template files with `{{placeholder}}` slots for
   Claude to fill in. Use these when the skill's job is to save a
   structured file to disk.
3. **`plugin/commands/<name>.md`** *(optional)* — a slash command
   shortcut so users can type `/<name>` instead of describing the
   request. Useful when the trigger phrase is repetitive.

## The hard architectural rule

**Skills run inside Cowork's VM. The VM has no reliable network
access.** This means:

- ✅ Skills can call MCP tools (the only network-y thing)
- ✅ Skills can read templates from the skill folder
- ✅ Skills can save markdown files to the user's working folder
- ✅ Skills can run small Python scripts using only the standard
  library
- ❌ Skills CANNOT make `fetch` / `requests` / `urllib` calls
- ❌ Skills CANNOT install packages (`pip install`, `npm install`)
- ❌ Skills CANNOT read files from the MCP server's filesystem

If the skill needs network access for anything beyond an MCP tool
call, the work belongs in the MCP server, not the skill. Stop and
flag it.

## Frontmatter rules

```markdown
---
name: <kebab-case-name>
description: <one-sentence description with strong trigger language>
---
```

- `name` matches the folder name (`plugin/skills/<name>/`).
- `description` is **not optional** and **must** describe when
  Claude should invoke this skill. Specificity is the difference
  between "Claude actually uses this skill" and "Claude ignores it".
  Match the style of `wiki-lookup`'s description.
- An optional `allowed-tools` field can restrict the skill to
  specific tools — useful if the skill should only call one
  specific MCP tool and nothing else.

## SKILL.md structure (mirror wiki-lookup)

```markdown
---
name: <name>
description: <when to invoke>
---

# <Display Name>

<One-paragraph description of what this skill does and which MCP
tool it depends on.>

## What to do

When the user asks to <trigger phrase>:

1. Call the `<mcp_tool_name>` MCP tool with the user's input as
   the `<param>` parameter.
2. The tool returns `<exact return shape>`.
3. <Next concrete step.>
4. <Etc.>
5. Tell the user what happened.

## Example

User: "<example user message>"

You should:
1. Call `<tool>({ param: "value" })`
2. Receive `<example return value>`
3. <Concrete next steps.>
4. Tell the user the result.
```

Keep it tight — Claude reads the SKILL.md as a prompt every time
the skill triggers. Long instructions slow it down.

## Templates folder

If the skill saves a file:

- Put templates under `plugin/skills/<skill-name>/templates/`.
- Use `{{double-curly}}` placeholders. Claude understands these
  intuitively; pick names that match the MCP tool's return fields.
- Reference the template path **relative to the skill directory**
  in the SKILL.md (e.g., `templates/wiki-summary.md`).

## Slash command file

If you create one:

```markdown
---
name: <command>
description: <one-line>
---

<Brief instructions equivalent to "trigger the <name> skill with
the user's argument as the topic.">
```

Slash commands are syntactic sugar — they hand off to a skill.
Don't duplicate the skill's logic in the command file.

## Workflow

1. **Confirm the MCP tool already works.** Read
   `mcp-server/src/tools/<tool>.ts` to see its input/output shape.
   If the tool doesn't exist yet, stop — build the tool first.
2. **Pick a skill name.** Kebab-case, descriptive, distinct from
   the tool name. E.g., the `places` MCP tool might back a
   `place-research` skill.
3. **Draft the SKILL.md** following the wiki-lookup structure.
4. **Decide if a template is useful.** Skills that "save a result
   to disk" almost always benefit from one. Skills that just
   "answer the user with the result" don't need one.
5. **Decide if a slash command is useful.** Add one if the trigger
   is short and predictable (e.g., `/wiki <topic>`). Skip it if the
   skill triggers on more varied natural language.
6. **Print a summary** of files created with absolute paths.

## Do not

- Do not modify the MCP server. If the tool's behavior needs to
  change, that's a different agent's job.
- Do not put `requirements.txt` or `package.json` files in skill
  folders. Skill scripts are stdlib-only.
- Do not edit `wiki-lookup` itself. It's the reference example —
  every other skill copies it.
