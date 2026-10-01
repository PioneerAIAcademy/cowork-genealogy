# Contributor program

As of 2026-09-30.

Up to seven very junior developers, called Contributors, all starting together, each at
about 10 hours a week for three months, each with a Claude Code subscription
and FamilySearch and OpenRouter credentials.

The program exists for the Contributors: real production experience, and
exposure to a mentor who can recommend them. Each Contributor has one assigned
mentor, a developer on this project who also works at another company. At the
end, the mentor can recommend them to that company from first-hand
experience. The program is not a hiring pipeline for this project, and the
Contributors are not there to lighten their mentors' load.

The issue drafts below are **not filed yet**, so no one on the team picks
them up by mistake. File them when the Contributors start, then delete the
drafts section from this doc. Holding unfiled issues here is a lead-approved
exception to the no-queue-file rule in `CLAUDE.md`, and it ends at filing.

## Summary

- **Each Contributor owns a track** of issues below, and no two tracks touch the
  same files. Pick each Contributor's track to match the kind of work their
  mentor's company does: web tracks for a frontend shop, engine and server
  tracks for a backend one.
- **Months 1–2: their own track.** Most of it is in the hosted web workbench
  (`apps/web`, `packages/viewer-ui`), which runs locally with no keys
  (`make server-mock` + `make web-dev`, then "Open a sample project"), with
  deterministic vitest tests. Two tracks are server and engine work.
- **Month 3: one real issue, end to end.** The Contributor runs it through
  `docs/task-lifecycle.md` themselves: plan, `/critique-plan`, implement,
  review. Ideally it comes from the mentor's own area of this project.
- **Every Contributor card carries a `contributor` label**, which `/fill-ready`
  excludes, so none of it enters the team's Ready pools.
- **Review:** the Contributor runs `/review` on their own PR first; the mentor
  does the required second review. Each week, every Contributor also reviews one
  other Contributor's PR, as practice; that review comments only and gates
  nothing.
- **A 30-minute call with the mentor every week**: what they did, what is
  next, where they are stuck. This is the mentor's main commitment, and it is
  what the recommendation rests on.
- **A demo at the end.** In the last week, each Contributor shows the team what
  they built in ten minutes, with their mentor present.

## Before week 1 (lead)

- Assign each Contributor a mentor and a track (see "Tracks" below). With fewer
  than seven Contributors, leave the lowest tracks unassigned; their drafts stay
  unfiled.
- Brief each mentor on "Work from the mentor" and "What the mentor needs for a
  recommendation" below.
- Create the `contributor` label and file the drafts for the assigned tracks.
- Wait for PR #3004 to merge before V0; it rewrites `DEVELOPMENT.md` and the
  install path.
- Give the track F Contributor an Anthropic API key before month 2, for the
  off-topic guardrail's live check.

## Work from the mentor

A mentor may also hand their Contributor a piece of their own work, for the
experience of working inside something real and in flight. It is optional,
and the Contributor's track comes first. The piece must be something **nothing
is waiting on**: at 10 hours a week a Contributor can take two weeks, so the
mentor's own PR must never be blocked on it. Good pieces:

- tests for code the mentor just wrote;
- a `dev/try-*.ts` smoke script for the mentor's tool;
- the viewer or web piece of a feature whose engine half the mentor owns;
- reproducing a bug report and writing down exactly what happens;
- running the "Done when" check on the mentor's PR, in a browser.

Each is its own issue, labelled `developer` and `contributor`, and its own PR to
main. Never a branch stacked on the mentor's branch.

Never give a Contributor, from a track or from a mentor:

- anything on a Beta critical path;
- any SKILL.md or agent-body edit (V19 has the one exception);
- anything with a `cluster:` label or `needs-decision`;
- issue #2988 (feedback-bundle redaction): high-priority privacy work;
- issue #2989 (bare image-ARK input): shares three files with
  issue #2987 and PR #2977;
- issue #2965 (person_warnings country rule) until issue #2941 and PR #2994
  land; then it is draft V20.

## Needs your decision

- **The issue #2813 design (single-ask users).** Its draft design is marked
  "not approved". Approve items 1, 2 and 5, and they become drafts V21–V23
  below, as month-3 issues; items 3 and 4 change agent behaviour and stay
  with a senior.
- **A family view in the viewer.** No section shows the tree's people and
  relationships as a family group or pedigree chart. A strong month-3
  project; decide it alongside issue #2813, since both change what the viewer
  leads with.
- **Hebrew calendar in `convert_calendar`.** Useful for Jewish records and
  gravestones; it needs a spec before code. If wanted, it is track G's
  month-3 issue.

## Tracks

Seven tracks, one per Contributor, listed in the order to assign them. Within a
track, work top to bottom. Everyone starts with V0.

| Track | Theme | Month 1 | Month 2 | Kind of work |
|---|---|---|---|---|
| A | Session list | V1, V2 | V3, V4 | React, accessibility |
| B | Viewer | V12, V13 | V14, V15 | React, testing |
| C | Chat pane | V7, V9 | V8, V10 | React, accessibility tooling |
| D | Web shell | V5, V6 | V6a | Browser testing, responsive CSS |
| E | Engine | V17 (utilities) | V20 | TypeScript, unit testing |
| F | Server | V17 (tool error branches) | V18 | Python, prompt work |
| G | Dates and export | V17 (calendar smoke) | V19, then V11 or V16 | Algorithms, file formats |

Track A and track D both touch `apps/web/src/styles.css`; a merge nuisance
only. V10 waits on V1, V9 and V12.

## Issue drafts

All carry `developer` and `contributor`.

### V0. DEVELOPMENT.md: fix it from a fresh clone

**Touches:** `DEVELOPMENT.md`, `packages/engine/mcp-server/dev/smoke-calls.ts`

Clone fresh, follow `DEVELOPMENT.md` to a running `make server-mock` +
`make web-dev`, and fix what is wrong. Known: no prerequisites section
(Node 22 from `.nvmrc`, pnpm 9.15.9 from the root `packageManager`, npm 11,
uv); the build example names `tests/tools/places.test.ts`, which is
`place-search.test.ts`; "four auth exclusions" in `DEVELOPMENT.md` and the
`smoke-calls.ts` header, where there are three. After PR #3004 merges.

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

#### V14. Take issue #2493 (plain labels in the viewer)

Already vetted and junior-sized, from a real tester complaint. Add the
`contributor` label to the existing issue rather than filing a new one.

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

File as three issues, one per track:

- **Track E:** `utils/gedcomx-ids.ts`, `utils/source-ref-resolver.ts` and
  `utils/coerce-json-arg.ts` have no tests of their own.
- **Track F:** the error branches of `tools/wikipedia.ts` and
  `tools/validate-research-schema.ts` have no tests.
- **Track G:** add a `dev/try-convert-calendar.ts` smoke script (offline;
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

#### V20. Take issue #2965 (event in a different country)

Once issue #2941 and PR #2994 land. Template-like: one more `check*`
function in `person-warnings.ts`, reusing `countryConsistency`.

### Issue #2813 split (month 3, once the lead approves its design)

These replace issue #2813's viewer half. File them as new issues and close
issue #2813 into them.

#### V21. Group the research tabs and show counts

**Touches:** `packages/viewer-ui/src/components/layout/Sidebar.tsx`, `packages/viewer-ui/src/App.tsx`

Always show the tabs any activity can fill (Sources, Log, the tree's people).
Group Questions, Plans, Localities, Hypotheses and Proof under "Research",
collapsed until the first question exists, with a count on each tab.

**Done when:** the sample project and an empty project both render sensibly,
with screenshots of each in the PR.

#### V22. Empty tabs explain what fills them

**Touches:** `packages/viewer-ui/src/components/sections/` (the empty states)

Each empty tab says in one line what fills it. `emptyStates.test.tsx` is the
existing test to extend. Once V23 lands, add a "Start research on <person>"
button that uses its send method.

#### V23. Actions on a person card

**Touches:** `packages/viewer-ui/src/components/shared/PersonCard.tsx`

Offer the single-ask tasks from issue #2813 ("verify this person's sources",
"verify this person's facts") as buttons on a person card that send a
prepared request to the chat. This needs one new method on
`ResearchTransport` (`packages/viewer-ui/src/transport.ts`), implemented by
both the web app and Electron, and a matching check in `contract.ts`; the
mentor reviews that interface change first.

## Month 3: one real issue

Each Contributor takes one real issue and runs it through
`docs/task-lifecycle.md` themselves: plan, `/critique-plan`, implement,
review. Best is an issue from the mentor's own area of this project, because
the mentor then judges the work against something they know well. Otherwise:

- issue #3002 (the eval scenario viewer is missing three sections), after
  PR #3004 merges;
- one of V21–V23, if the lead approves the issue #2813 design;
- the family view or the Hebrew calendar, if the lead says yes;
- a tester-reported web or viewer item from the Feedback column, once
  triaged;
- something they found themselves earlier in the program.

## What the mentor needs for a recommendation

The mentor writes the recommendation to their own company; it is theirs, not
the lead's. With Claude Code, speed says little. Every PR carries a
screenshot and a "how I verified this" section. What makes a recommendation
credible:

- PR size, and whether they split work sensibly;
- whether they checked the change in a browser, not just in tests;
- whether they read the tests they changed;
- how they respond to review, and how useful their reviews of other
  Contributors' PRs are;
- in month 3, whether their plan survives `/critique-plan` and whether they
  ask the right question when stuck;
- the end-of-program demo.
