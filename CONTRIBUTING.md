# Contributing

Two kinds of contributions are welcome.

## First, sign the CLA

Everyone who contributes signs the
[Individual Contributor License Agreement](./CLA.md) — outside
contributors and maintainers alike. You keep the copyright in what you
write; the agreement gives the project permission to use it.

Signing means adding one row to [SIGNERS.md](./SIGNERS.md). If you are
contributing from outside the team, **add that row in the same pull
request as your contribution** — there is no separate signing step to
wait on. You do this once; later pull requests need nothing.

If you are on the team — organization membership, repository write
access, or access to project credentials or alpha-tester data — you sign
a second agreement as well, the [Team Agreement](./TEAM-AGREEMENT.md),
covering confidentiality, API keys, and the personal data of living
people in alpha-tester feedback. That one is signed during onboarding,
before your access is granted, rather than alongside a contribution.
Outside contributors do not sign it at all.

Full instructions for both paths are in [SIGNERS.md](./SIGNERS.md).

## Skill contributions (the common case)

Most contributions will be skills, not MCP servers. Locality guides for
a region you know well, a specialized record-type extractor (Quaker
meeting records, Italian state archive `atti notarili`, U.S. land
patents), a language-specific paleography helper, a regional research-
tips reference. Anything that helps Claude follow a research procedure
better for a specific kind of work.

Constraints to keep in mind:

- **Skills run inside the Cowork VM with no network access.** Anything
  that needs the network has to live in the MCP server, not the skill.
  Skills can read project files, write to project files via the
  research.json schema, format output for the user, and call MCP
  tools — but they cannot make HTTP calls themselves. See
  [CLAUDE.md](./CLAUDE.md) for the full architecture rule.
- **Frontmatter shapes routing.** Each `SKILL.md` needs a
  `description` that tells Claude *when* to fire and *when not to* (the
  positive-trigger + negative-guard pattern most of the 23 existing
  skills use). `citation/SKILL.md` and `record-extraction/SKILL.md`
  are good templates for the richer pattern; `search-wikipedia/SKILL.md`
  is intentionally minimal as a copy-from starter.
- **The researcher profile is extensible.** If your skill needs new
  per-project context (e.g., `dna_companies` for a DNA-specialty
  skill, or `region_focus` for a regional researcher's profile),
  propose the schema extension in your PR — add the field to
  `docs/specs/schemas/research.schema.json`, the
  `docs/specs/research-schema-spec.md` table, and the validator at
  the TypeScript validator at `packages/engine/mcp-server/src/validation/validator.ts`.
- **Validation.** Add an `init-project` interview question if your
  field needs to be captured at project start, or read the field
  with a sensible default if absent.

To submit: fork, add the skill directory under `packages/engine/plugin/skills/`, write
the `SKILL.md`, add any reference docs under
`packages/engine/plugin/skills/<your-skill>/references/`, and open a PR.
Skills are verified by the eval harness rather than by a hand-written
testing guide — see `docs/skill-lifecycle.md` for how a new skill gets
tests and a rubric.

## MCP server contributions (rarer, higher leverage)

For sites that expose an API. The criteria mirror what makes a good
research MCP in general:

- **Read-heavy tools** — search, fetch, list. Any mutating tool needs
  an explicit confirmation prompt on the client side.
- **Provenance in results** — return the source, date retrieved, and
  a citation-ready identifier. The plugin tags every cite by source;
  your tool should make that possible.
- **No instruction-like content in results** — return data, not
  commands. If metadata could be confused for directives, mark it
  explicitly.
- **Graceful errors** — clean error structures beat timeouts.

To submit: publish your MCP server, document its tools and auth flow,
open a PR adding it to `packages/engine/mcp-server/` (if first-party) or to the
plugin's MCP config (if vendor-hosted), and note which workflows it
serves.

## Sites where an MCP server would help

Sites where an MCP server would replace the current click-capture-
analyze workflow with automated retrieval. None of these currently
expose public APIs, so a contribution might be a vendor-built MCP, a
sanctioned scraping MCP, or a future API integration:

- FindAGrave — cemetery records, currently click-capture only
- GenealogyBank — newspapers, books, documents
- Newspapers.com — historical newspapers
- MyHeritage — broad indexed records and family trees
- FindMyPast — UK and Ireland records

The current `search-external-sites` skill works around the API gap by
guiding the user through manual captures. An MCP would make those
workflows direct.

## Developer setup

For building from source, running tests, smoke-testing tools, and the
eval harness, see [DEVELOPMENT.md](./DEVELOPMENT.md).
