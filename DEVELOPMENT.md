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
cd mcp-server && npx tsx dev/try-wiki-search.ts "How do I find Italian birth records?"
cd mcp-server && npx tsx dev/try-population.ts 1927069 --year 1960
cd mcp-server && npx tsx dev/try-search.ts Lincoln Abraham --birth-year 1809
cd mcp-server && npx tsx dev/try-fulltext-search.ts "+Patrick +Flynn" --place Pennsylvania
cd mcp-server && npx tsx dev/try-fulltext-search.ts --nl "Search for John Doe born in Austria"
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

## Troubleshooting

### `login` doesn't open a browser tab

**Symptom:** You ask Claude to log in to FamilySearch, the `login` tool
runs, but no browser tab appears. On older builds it then hangs ~5
minutes and reports a timeout.

**Cause:** `login` launches the browser with the `open` package, which
runs in whatever process context the MCP server lives in. In Cowork and
other sandboxed contexts that process often cannot surface a browser
window — and the failure is *silent* (no error is thrown), so nothing
is shown to the user.

**The fix is already in the code.** `performLogin()` is non-blocking: it
returns immediately with the authorization URL *in the result message*.
When the popup doesn't appear, Claude shows you that URL — copy it into
any browser, sign in, approve. So **don't wait for a popup; look for the
URL in Claude's reply.** The OAuth callback (`http://127.0.0.1:1837/callback`)
is local to the machine running the MCP server, so no port-forwarding is
needed when the MCP server and your browser are on the same machine.
Confirm the session afterward with the `auth_status` tool. A repeat
`login` call while a flow is in progress hands back the same URL.

Forcing a specific browser (`open(url, { app: ... })`) does **not** help
— if the process can't launch the default browser it can't launch a
named one either. The URL-in-the-response fallback is the reliable path.

### Deploying a code change to Claude Desktop (Windows)

The MCP server Claude Desktop runs is a *built* artifact. Editing source
or pulling new commits changes nothing until you rebuild **and** fully
restart. Order matters:

1. If Cowork shows "Not enough disk space," free space first — the
   workspace VM won't start otherwise.
2. `git pull` on the correct branch in the Windows clone.
3. `cd mcp-server && npm install && npm run build` — the `build/` output
   is what Claude Desktop actually loads, not the `src/` files.
4. **Fully quit Claude Desktop** — system tray → right-click → Quit.
   Closing the window is not enough; the MCP server is only re-read on a
   real restart.
5. Reopen Claude Desktop.

To confirm the build picked up your change, grep the built file for a
string unique to it, e.g.:

```powershell
Select-String -Path mcp-server\build\auth\login.js -Pattern "If no tab appeared"
```

A match means the new code is built; no match means the build is stale.

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
