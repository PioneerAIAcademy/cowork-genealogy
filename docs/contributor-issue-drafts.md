# Contributor issue drafts

Starter work a mentor can hand a Contributor when they have no piece of their
own work that nothing is waiting on (`docs/contributor-program.md`). Not filed:
file one when a mentor needs it, with labels `developer` and `contributor`, and
delete its draft here. Holding unfiled drafts here is a lead-approved exception
to the no-queue-file rule in `CLAUDE.md`.

The lead files V0 before week 1; everyone starts with it. The headings group drafts that touch the same files;
give two Contributors drafts from different groups. V10 waits on V1, V9 and
V12.

### V0. DEVELOPMENT.md: fix it from a fresh clone

**Touches:** `DEVELOPMENT.md`, `packages/engine/mcp-server/dev/smoke-calls.ts`

Clone fresh, follow `DEVELOPMENT.md` to a running `make server-mock` +
`make web-dev`, and fix what is wrong. Known: no prerequisites section
(Node 22 from `.nvmrc`, pnpm 9.15.9 from the root `packageManager`, npm 11,
uv); the build example names `tests/tools/places.test.ts`, which is
`place-search.test.ts`; "four auth exclusions" in `DEVELOPMENT.md` and the
`smoke-calls.ts` header, where there are three.

**Done when:** a second Contributor follows the fixed doc from a fresh clone
without help. One Contributor lands it; the others each follow it and review
it.

### Session list and web shell

#### V1. Session cards are keyboard-operable

**Touches:** `apps/web/src/components/SessionList.tsx`, `apps/web/src/styles.css`

Each card is an `<li onClick>` with no role, tabIndex or key handler, and
the delete ✕ is `opacity: 0` until hover. Use a real button or link, add
`:focus-visible` styles, show ✕ on focus, give it an `aria-label`.

**Done when:** every session can be opened and deleted with Tab and Enter
alone; a Testing Library test drives it by keyboard.

#### V2. A failed delete tells the user

**Touches:** `apps/web/src/components/SessionList.tsx`

`api.deleteSession` has no try/catch, so a failure is an unhandled
rejection. Show an error, and add a Retry button to the load-error banner.

**Done when:** tests with a rejecting API show the error and retry.

#### V3. Rename a session

**Touches:** `apps/web/src/components/SessionList.tsx` (or the title in `SessionView.tsx`)

`api.patchSession(id, {title})` and its server route exist; the only caller
is the automatic title relay. Add inline edit.

**Done when:** a renamed session keeps its name after reload.

#### V4. Search and sort the session list

**Touches:** `apps/web/src/components/SessionList.tsx`

Add a text filter and sort by last active or title; show the absolute date
on hover beside the relative time.

#### V5. Browser tab shows the session title

**Touches:** `apps/web/src/App.tsx` or `SessionView.tsx`

No `document.title` is set anywhere; every tab reads "Genealogy Workbench".

#### V6. Browser smoke test of the web app

**Touches:** `apps/web/` (new Playwright config and test), `Makefile`

A Playwright test that starts `make server-mock` and `make web-dev`, signs
in, opens the sample project, sends a message, and sees the viewer render.
`eval/app/playwright.config.ts` is a pattern to copy. A `make` target only;
wiring it into CI is a separate call for the lead.

**Done when:** the test fails when the viewer is broken on purpose, and
passes again when restored.

#### V6a. Narrow-screen layout

**Touches:** `apps/web/src/styles.css`, `SessionView.tsx`

The session screen is a fixed three-column grid, and the only media queries
are for reduced motion. Below about 800px, stack chat and viewer or switch
between them with tabs.

**Done when:** a session is usable at 390px wide (iPhone) with no
horizontal scroll, checked in the browser's device mode and screenshotted
in the PR.

### Chat pane

#### V7. Copy button on assistant messages

**Touches:** `apps/web/src/components/ChatPane.tsx`, `apps/web/src/styles.css`

#### V8. Export the chat transcript as markdown

**Touches:** `apps/web/src/components/ChatPane.tsx` or `SessionView.tsx`

Built client-side from `messages`; tool chips become short lines.

#### V9. Chat accessibility

**Touches:** `apps/web/src/components/ChatPane.tsx`

No `aria-live` region exists in `apps/web`. Put `role="status"` on the
status and outcome lines, a label on the message textarea, and labels on
the ⟳/✓ tool chips and 📎 icon.

#### V10. Automated accessibility check

**Touches:** `apps/web` and `packages/viewer-ui` test setup

Add an axe-core check (for example `vitest-axe`) over the main components,
after V1, V9 and V12 land so it starts green.

**Done when:** removing one `aria-label` makes it fail.

### Research viewer

#### V12. Viewer cards are keyboard-operable

**Touches:** `packages/viewer-ui/src/components/shared/Card.tsx`

The expandable header is a clickable `div` with no role, tabIndex or
`aria-expanded`. Fixing Card fixes every section.

#### V13. The research log shows queries, not raw JSON

**Touches:** `packages/viewer-ui/src/components/sections/ResearchLogSection.tsx`

It renders `JSON.stringify(entry.query)` outside dev mode; show a key/value
list.

#### V15. Tests for the viewer components that have none

**Touches:** `packages/viewer-ui/src/components/**/__tests__/`

HypothesesSection, PlansSection, `layout/Header`,
`layout/ProgressPipeline`, `shared/CrossLink`, DetailPanel.

#### V16. Print stylesheet for the viewer

**Touches:** viewer-ui and `apps/web` CSS

Hide the sidebar and chat, expand the cards, so a researcher can print or
save a PDF of their project.

### Export

#### V11. Download the tree as GEDCOM

**Touches:** new `packages/viewer-ui/src/lib/gedcom-export.ts`, a download button in the viewer

Genealogists move research between programs as GEDCOM. Convert
`tree.gedcomx.json` (`docs/specs/simplified-gedcomx-spec.md`) to GEDCOM 5.5.1
in the browser. The viewer is shared with Electron, so both get it. Write a
short spec in `docs/specs/` first, for lead approval.

**Done when:** the sample project's tree exports, and the file imports
cleanly into a desktop genealogy program (RootsMagic, Gramps, or
FamilySearch's GEDCOM upload); unit tests cover names, dates, places,
families and sources.

### Server and engine

#### V17. Unit tests for untested engine code

**Touches:** `packages/engine/mcp-server/tests/`, `packages/engine/mcp-server/dev/`, `DEVELOPMENT.md`

File as three issues:

- `utils/gedcomx-ids.ts`, `utils/source-ref-resolver.ts` and
  `utils/coerce-json-arg.ts` have no tests of their own.
- The error branches of `tools/wikipedia.ts` and
  `tools/validate-research-schema.ts` have no tests.
- Add a `dev/try-convert-calendar.ts` smoke script (offline;
  copy `try-place-distance.ts`) and list it in `DEVELOPMENT.md`.

#### V18. Keep the hosted agent on genealogy

**Touches:** `apps/server/app/agent/real_agent.py`, `apps/server/proto/worker/options.py`, their tests

Add one instruction to the hosted system prompt: help only with genealogy
and family-history work, and politely decline unrelated tasks. Define the
text once beside `project_note` in `real_agent.py` and import it in
`options.py`, which already imports from `app.agent`.

In scope, and must not be refused: local and social history, geography and
boundary changes, migration, DNA and relationship math, translating and
reading old documents and handwriting, occupations, causes of death, naming
customs, family narratives, obituaries and letters to relatives, and
converting a GEDCOM or spreadsheet. Short follow-ups ("yes", "explain that")
are always in scope. Out of scope for this issue: a classifier, spend caps,
any hard block, and Cowork, where an off-topic chat makes no tool call for
a hook to see.

**Done when:** about 20 prompts, half genealogy asks that look off-topic and
half clearly off-topic (homework, general coding), are run by hand against a
real hosted session (needs an Anthropic API key; `make server-mock` has no
model), with each outcome recorded in the PR. The lead reviews the wording;
this changes every hosted turn.

#### V19. Take issue #1621 (French Republican calendar)

Add the `contributor` label to the existing issue. The tool half is pure
arithmetic with a complete test table. The issue also replaces one section
of `agents/convert-dates.md` and names one `make eval-skill SKILL=convert-dates`
run; a genealogist reviews that part.
