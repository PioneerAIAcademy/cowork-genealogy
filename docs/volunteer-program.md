# Volunteer developer program

As of 2026-09-29.

Four very junior volunteer developers join for a three-month trial at about
10 hours a week each (about 120 hours per person), each with a Claude Code
subscription and FamilySearch and OpenRouter credentials. They get real
production experience, and we learn whether to hire them next year.

The issue drafts below are **not filed yet**, so no one on the team picks
them up by mistake. File them when the volunteers start, then delete the
drafts section from this doc. Holding unfiled issues here is a lead-approved
exception to the no-queue-file rule in `CLAUDE.md`, and it ends at filing.

## Summary

- **Months 1–2: their own lane in the hosted web workbench** (`apps/web`,
  `packages/viewer-ui`), one track per volunteer, plus one server/engine
  track. It runs locally with no keys (`make server-mock` + `make web-dev`,
  then "Open a sample project"). Tests are deterministic vitest. A reviewer
  can judge the work from a screenshot.
- **Month 3: one real issue each, run end to end** through
  `docs/task-lifecycle.md`: plan, `/critique-plan`, implement, review. Polish
  PRs show care; scoping and verifying a real issue shows judgment, which is
  the hiring signal.
- **Their cards carry a `volunteer` label**, which `/fill-ready` excludes, so
  they never enter the team's Ready pools.
- **Each volunteer has a senior mentor.** A volunteer runs `/review` on their
  own PR first; the mentor does the second review, and at the end gives the
  lead a hire / no-hire recommendation.

## Before week 1 (lead)

- Give the track 4 volunteer an Anthropic API key before month 2, for the
  off-topic guardrail's live check.
- Wait for PR #3004 to merge before the week-1 doc fix; it rewrites
  `DEVELOPMENT.md` and the install path.
- Assign each volunteer a senior mentor, who is also their second reviewer.
- Create the `volunteer` label and file the drafts below.

## Why the web workbench first

Access is not the constraint; dependency is. Of the 23 open, unassigned
`developer` issues without `senior` (counted 2026-09-29), about 5 are
junior-sized leaf work, and the current juniors draw from that pool. Skill
work shares an eval snapshot with other open issues on the same skill, so a
slow PR forces someone else's re-run.

The web lane is not fully isolated. issue #2788 (assigned) edits
`apps/web/src/styles.css`, which tracks 1 and 2 also touch — a merge nuisance
only.

## Needs your decision

- **The issue #2813 design (single-ask users).** Its draft design is marked
  "not approved". Approve items 1, 2 and 5, and they become drafts V21–V23
  below; items 3 and 4 change agent behaviour and stay with a senior.
- **A family view in the viewer.** No section shows the tree's people and
  relationships as a family group or pedigree chart. A strong month-2/3
  project; decide it alongside issue #2813, since both change what the viewer
  leads with.
- **Hebrew calendar in `convert_calendar`.** Useful for Jewish records and
  gravestones; it needs a spec before code. Say whether it is wanted.

## What not to give them

- issue #2988 (feedback-bundle redaction): high-priority privacy work.
- issue #2989 (bare image-ARK input): shares three files with
  issue #2987 and PR #2977.
- issue #2965 (person_warnings country rule) until issue #2941 and PR #2994
  land; then it is draft V20.
- Anything with a `cluster:` label or `needs-decision`, and any SKILL.md or
  agent-body edit except the one section in draft V19.

## Issue drafts

All carry `developer` and `volunteer`. Suggested order within each track is
top to bottom; V0 is everyone's first week.

### V0. DEVELOPMENT.md: fix it from a fresh clone

**Touches:** `DEVELOPMENT.md`, `packages/engine/mcp-server/dev/smoke-calls.ts`

Clone fresh, follow `DEVELOPMENT.md` to a running `make server-mock` +
`make web-dev`, and fix what is wrong. Known: no prerequisites section
(Node 22 from `.nvmrc`, pnpm 9.15.9 from the root `packageManager`, npm 11,
uv); the build example names `tests/tools/places.test.ts`, which is
`place-search.test.ts`; "four auth exclusions" in `DEVELOPMENT.md` and the
`smoke-calls.ts` header, where there are three. After PR #3004 merges.

**Done when:** a second volunteer follows the fixed doc from a fresh clone
without help. One volunteer lands it; the other three review it.

### Track 1: session list and web shell

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
between them with tabs. A month-2 project.

**Done when:** a session is usable at 390px wide (iPhone) with no
horizontal scroll, checked in the browser's device mode and screenshotted
in the PR.

### Track 2: chat pane and GEDCOM export

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

#### V11. Download the tree as GEDCOM

**Touches:** new `packages/viewer-ui/src/lib/gedcom-export.ts`, a download button in the viewer

Genealogists move research between programs as GEDCOM. Convert
`tree.gedcomx.json` (`docs/specs/simplified-gedcomx-spec.md`) to GEDCOM 5.5.1
in the browser. The viewer is shared with Electron, so both get it. Write a
short spec in `docs/specs/` first, for lead approval. A month-2 project.

**Done when:** the sample project's tree exports, and the file imports
cleanly into a desktop genealogy program (RootsMagic, Gramps, or
FamilySearch's GEDCOM upload); unit tests cover names, dates, places,
families and sources.

### Track 3: research viewer

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
`volunteer` label to the existing issue rather than filing a new one.

#### V15. Tests for the viewer components that have none

**Touches:** `packages/viewer-ui/src/components/**/__tests__/`

HypothesesSection, PlansSection, ProofSummariesSection, `layout/Header`,
`layout/ProgressPipeline`, `shared/CrossLink`, DetailPanel, StatusBadge.
After V14, which edits StatusBadge and ProofSummariesSection.

#### V16. Print stylesheet for the viewer

**Touches:** viewer-ui and `apps/web` CSS

Hide the sidebar and chat, expand the cards, so a researcher can print or
save a PDF of their project.

### Track 4: server and engine

#### V17. Unit tests for untested engine utilities

**Touches:** `packages/engine/mcp-server/tests/`

`utils/gedcomx-ids.ts`, `utils/source-ref-resolver.ts`,
`utils/coerce-json-arg.ts`, and the error branches of `tools/wikipedia.ts`
and `tools/validate-research-schema.ts` have no tests of their own. Add a
`dev/try-convert-calendar.ts` smoke script (offline; copy
`try-place-distance.ts`) and list it in `DEVELOPMENT.md`.

#### V18. Keep the hosted agent on genealogy (month 2)

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

Add the `volunteer` label to the existing issue. The tool half is pure
arithmetic with a complete test table. The issue also replaces one section
of `convert-dates/SKILL.md` and names one `make eval-skill SKILL=convert-dates`
run; a genealogist reviews that part. A month-2 task.

#### V20. Take issue #2965 (event in a different country)

Once issue #2941 and PR #2994 land. Template-like: one more `check*`
function in `person-warnings.ts`, reusing `countryConsistency`.

### Issue #2813 split (months 2–3, once the lead approves its design)

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

## Month 3: one real issue each

Each volunteer takes one issue and runs it through `docs/task-lifecycle.md`
themselves. Candidates:

- issue #3002 (the eval scenario viewer is missing three sections), after
  PR #3004 merges;
- a tester-reported web or viewer item from the Feedback column, once
  triaged;
- a decision from "Needs your decision" above, if the lead says yes;
- something they found themselves in months 1–2.

## What mentors watch for the hiring decision

Each mentor gives the lead a hire / no-hire recommendation at the end of
month 3. With Claude Code, speed says little. Every PR carries a screenshot and a
"how I verified this" section. Watch:

- PR size, and whether they split work sensibly;
- whether they checked the change in a browser, not just in tests;
- whether they read the tests they changed;
- how they respond to review;
- in month 3, whether their plan survives `/critique-plan` and whether they
  ask the right question when stuck.
