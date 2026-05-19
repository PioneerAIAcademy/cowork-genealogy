# Development

Developer guide for building, testing, and extending this repository.
For architecture and conventions Claude needs when editing the code,
see [CLAUDE.md](./CLAUDE.md). For end-user installation and usage, see
[README.md](./README.md). For contribution criteria, see
[CONTRIBUTING.md](./CONTRIBUTING.md).

## Build commands

```bash
cd mcp-server && npm install && npm run build       # Build MCP server
cd mcp-server && npm test                            # Run all tests (vitest)
cd mcp-server && npx vitest run tests/tools/places.test.ts   # Run a single test file
cd mcp-server && npx vitest run -t "test name"       # Run tests matching a name
./scripts/build-mcpb.sh                              # Package .mcpb extension (→ releases/)
./scripts/package-plugin.sh                          # Package plugin .zip (→ releases/)
```

After building, both artifacts land in `releases/`:

```bash
ls releases/
```

## Smoke-test tools against live APIs

Bypass the MCP harness to debug a tool in isolation:

```bash
cd mcp-server && npx tsx dev/try-wikipedia.ts "Albert Einstein"
cd mcp-server && npx tsx dev/try-places.ts "Ohio"
cd mcp-server && npx tsx dev/try-search-wiki.ts "How do I find Italian birth records?"
cd mcp-server && npx tsx dev/try-population.ts 1927069 --year 1960
cd mcp-server && npx tsx dev/try-search.ts Lincoln Abraham --birth-year 1809
```

The `wiki-query-api` and Pop Stats API services are hosted; the smoke
scripts hit them over the public network, no local setup needed.

## How to add a new feature

Example: adding a "list providers" feature.

1. **Add the tool to the MCP server.**
   - Create `mcp-server/src/tools/list-providers.ts`
   - Register it in `mcp-server/src/index.ts`
   - Run `npm run build` in `mcp-server/`
   - Create `mcp-server/dev/try-list-providers.ts` — a one-shot smoke
     script that invokes the tool directly against live APIs. Follows
     the pattern of `try-wikipedia.ts` / `try-places.ts`. Critical for
     debugging when the MCP harness hides real errors.

2. **Add or update a skill that uses it.**
   - Create `plugin/skills/list-providers/SKILL.md`
   - In the SKILL.md, instruct Claude to call the new tool when the
     user asks what providers are available

3. **(Optional) Add a slash command.**
   - Create `plugin/commands/providers.md`

4. **Rebuild both artifacts.**
   ```bash
   cd mcp-server && npm run build && cd ..
   ./scripts/build-mcpb.sh
   ./scripts/package-plugin.sh
   ```

5. **Manually test by installing both artifacts in Claude Desktop.**

The `mcp-tool-scaffolder` and `cowork-skill-builder` subagents (under
`.claude/agents/`) generate the boilerplate for steps 1 and 2.
`spec-review` checks the implementation against the spec before PR.

## How to test a new tool end-to-end

For non-trivial tools, write a testing guide at
`docs/testing-guides/<tool>-tool-testing-guide.md` modeled on
`docs/testing-guides/oauth-tool-testing-guide.md` and
`docs/testing-guides/wikipedia-tool-testing-guide.md`. Four layers:

1. **MCP Inspector** — verifies the tool registers and behaves with
   no/dummy/real input.
2. **Claude Code** — verifies the tool description is good enough that
   the LLM picks it from natural language.
3. **Cowork via WSL2** — verifies the WSL2 → Claude Desktop bridge.
4. **Cowork via native Windows** — verifies the install path real
   users will take.

Both Layer 3 sub-layers are required for ship-readiness regardless of
which is your dev environment.

After building and installing both artifacts in Claude Desktop,
exercise the tool from inside a Cowork session — for example, ask
Claude to look up a place: "Find FamilySearch info for Ohio." Claude
should call the `place_search` tool, get structured JSON back, and — if a
skill tells it to — write a file to the selected folder. If that
round-trip works, the full pipeline is wired: host → MCP server → SDK
bridge → VM → Claude → file write.

The `wiki-lookup` skill and `/wiki` command in `plugin/` are a working
reference example showing the full plugin pipeline — they call the
`wikipedia_search` MCP tool, populate a markdown template, and save
the result to a file. Copy this structure when wiring a new skill to
one of the other tools. Don't mutate `wiki-lookup` itself; create a
new skill folder.

## Running the eval test suite

Skill evaluation lives under `eval/`. Quick start:

```bash
cd eval/harness
uv sync                                                  # first time only
uv run python run_tests.py --skill wiki-lookup           # run one skill's tests
uv run python run_tests.py --test ut_wiki_lookup_001     # run a single test
```

Run logs land under `eval/runlogs/unit/<skill>/<model>/<timestamp>.json`.
The harness has its own unit-test suite:

```bash
cd eval/harness && uv run pytest
```

See [`eval/README.md`](./eval/README.md) for the full guide including
prerequisites, useful flags, and Windows `.bat` shortcuts for
non-technical users.
