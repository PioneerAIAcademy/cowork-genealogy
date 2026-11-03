# MCP App viewer: research cards and views inside Claude

**Status:** Not started (2026-11-03).
**Owner:** the lead, building it himself, independent of the beta's timeline.

## Goal

1. **A demo that convinces our UI designer** that a dedicated MCP App is the
   right way to show research in Claude: real project data, rendered inside the
   conversation, with search results and page images opening in place and a
   fullscreen view of everything.
2. **A build that can be adopted later** into the beta's remote connector, or
   dropped, without having touched anyone else's work in the meantime.

## Decisions (lead, 2026-11-03)

1. **Remote connector only.** No web viewer: the web app's viewer is for alpha
   testing. Electron stays the local alpha's viewer, untouched.
2. **A card is a picture, never a reply.** Nothing on a card posts a message or
   runs a step. The reply stays with the platform's own carrier (step mode's
   `AskUserQuestion` in Cowork, the prototype's buttons). At a stopping point
   the order is: the step report, the card, then the reply.
3. **A step card at every stopping point:** setup, plan, search, link,
   conflict, hypothesis, assess, conclusion. Fallback if Cowork asks for
   approval on every card and "always allow" does not stick: setup, search,
   link (only when it asks an identity question), conflict, hypothesis,
   conclusion.
4. **Views on request,** opened from a button inside a card (in place or
   fullscreen) or by asking: a search's results, a page image, a transcription,
   the log for a question or a planned search, the family now, one person, a
   person's timeline, the full proof with the reviewer's notes.
5. **A fullscreen "everything" view for senior researchers:** today's section
   browser.
6. **The conclusion card shows recorded doubt only:** the rating in words, the
   shortfall, what was not searched, any unsettled conflict, the engine's
   unregistered-disagreement check, and the reviewer's verdict in one line. No
   heuristics of the card's own.
7. **No live progress in the first version.** Steps will run under five
   minutes; polling is on the later list.
8. **Build regardless of whether Cowork renders it.** Desktop chat and
   claude.ai chat are documented to render MCP Apps and serve "show me my
   project". Only the router lines wait on Cowork.
9. **The demo shows page images.** The demo project is run so that the pages
   that matter are transcribed and attached (see "Data").

## Not in scope

Print and GEDCOM export (the card's sandbox allows neither); feedback; any
button that posts; progress polling; fetching unsaved page images from
FamilySearch; the main MCP server's tool list; main's research router; the beta
plan; Electron; `apps/web`.

## Architecture

### A second MCP server, outside `src/`

- **Where:** `packages/engine/mcp-server/viewer/`, run with `tsx`, as
  `dev/probe-connector-server.ts` is. Outside `src/`, so `tsc` never compiles it
  into `build/` and neither the `.mcpb` nor `eb-tools.zip` ships it. Add
  `"viewer/**/*"` to `tsconfig.typecheck.json`'s `include` so
  `npm run typecheck` covers it. Its tests live in
  `packages/engine/mcp-server/tests/viewer/`, where the engine's vitest and
  `engine-tests.yml` reach them. No test there may skip: `vitest-pg` fails any
  skipped test.
- **What it shares:** it imports the engine's own modules —
  `src/utils/project-io.ts` (`readProjectJson`), `src/utils/question-state.ts`
  (`questionStatus`, `unregisteredDisagreements`),
  `src/utils/awaiting-hand-offs.ts`, `src/utils/starting-tree.ts`
  (`readStartingTree`), `src/tools/tree-diff.ts` (`treeDiff`),
  `src/store/paths.ts` (`isInsideProject`) — and reads every project document
  through the existing `ProjectStore`, so the same code reads Postgres/S3 when
  adopted.
- **What it never touches:** `allToolSchemas`, `manifest.json`,
  `dev/smoke-calls.ts`, the plugin hook's tool maps, any eval. Its tools live in
  `viewer/`, not `src/tools/`, so the packaging tests that scan `src/tools/`
  never see them.
- **Transport:** Streamable HTTP, stateless, plain JSON, one `Server` per
  request, as `src/http-server.ts` and the MCP Apps examples do. Binds
  `127.0.0.1`; reached through a public HTTPS tunnel.
- **Command line:** `--secret <random> --root <dir> --public-url <https origin>
  [--port 8090] [--allow-origin <origin>]`.
  - `--public-url` is the tunnel's origin, as the probe's `PROBE_PUBLIC_URL` is.
    The CSP entry and every image link are built from it, never from the Host
    header.
  - `--allow-origin` is off by default. For local iteration with ext-apps'
    browser-based `basic-host`, pass `http://localhost:8080`: OPTIONS on the MCP
    route then answers 204 with the CORS headers, and every response from that
    route carries `Access-Control-Allow-Origin` and `Vary: Origin`.
  - The server factory takes the page's HTML as a parameter. Only the CLI entry
    reads `viewer/page/viewer.html`, and it refuses to start, naming
    `make mcp-viewer-build`, when the file is missing.
- **Access:** no sign-in. The MCP route lives under the secret
  (`/<secret>/mcp`); every other path is 404 except `/img/<token>`.
  - **The account:** the connector is added from a personal Pro or Max account
    outside the team's Enterprise organization, and that same account is used
    for Desktop chat, claude.ai chat and Cowork. An organization connector
    reaches every member, so the secret path would protect nothing there.
  - **The OAuth variant**, if only an organization account is available or
    Claude will not add an authless connector: the probe server's OAuth code
    with its routes as they are (`/mcp`, `/.well-known/oauth-protected-resource`
    and `/…/mcp`, `/.well-known/oauth-authorization-server`, `/authorize`,
    `/authorize/approve`, `/token`), so the secret appears in no URL, no
    metadata and no log. One change: the Approve form asks for the `--secret`
    and refuses a wrong one (as copied, it grants a token to anyone,
    `dev/probe-connector-server.ts:291-319`). Those routes are then the other
    exceptions to the 404 rule.
  - **Containment:** `--root` is realpath'd once at startup. Every call
    realpaths its project folder, refuses on any error, refuses unless
    `isInsideProject(rootReal, real)` holds, and passes `real` on to the store
    and into image tokens.
- **Project resolution** (both tools, same rule): `projectPath` is optional. An
  absolute path is used as given (then contained). A bare folder name is a
  folder under `--root`. Omitted: `--root` itself if it holds `research.json`;
  otherwise the call is refused with the list of project folders under `--root`,
  so the model can ask. The tool description says all of this. For the demo,
  start the server with `--root` set to the demo project.
- **Logging:** one JSON line per request to stdout: method, tool, `clientInfo`,
  the client's declared extensions, result size, and whether the call is
  `show_project` or `read_project_view` (the second only ever comes from the
  card). Never the raw path or the token.

### Tools

Both tools carry the annotation `readOnlyHint: true`; Claude sets its
auto-permissions from it, and an unannotated tool defaults to "not read-only".

- **`show_project`** — visible to the model. Input (camelCase): optional
  `projectPath`, `show`, and optional `questionId`, `logId`, `personId`,
  `planItemId`, `sourceId` (`src_NNN`, for `image` and `transcription`).
  - `show` is one of: `setup`, `plan`, `search`, `link`, `conflict`,
    `hypothesis`, `assess`, `conclusion` (step cards); `search_results`,
    `image`, `transcription`, `log`, `family`, `person`, `timeline`, `proof`,
    `everything` (views); `latest` (the newest step card for the current
    question, for "where are we").
  - `_meta.ui.resourceUri: "ui://genealogy/viewer.html"`. The description tells
    the model that the researcher sees the card and it must not restate it.
  - **Result shape.** Claude Code, and so Cowork, gives the model a result's
    `structuredContent` in place of its `content`. So the projection travels in
    the result's `_meta` under `genealogy/card`, `structuredContent` is
    omitted, and `content` is one line for the model.
  - **The page reads its projection through one function, which fetches at most
    once per mount.** Only the first tool result for the mount counts. If it
    carries `_meta["genealogy/card"]`, that is the projection. If it is
    `isError`, the card shows its text and fetches nothing. Otherwise, or if no
    result arrives shortly after the tool input (a host need not send one to a
    card mounted after the call finished), it makes one `read_project_view`
    call (`part: "projection"`, same `show` and ids, from the tool input). A
    cancellation clears the timer and the card says the call was stopped. Later
    tool-input and tool-result events are ignored. This is keyed on absence, not
    a per-host switch, so a reopened conversation that drops `_meta` still
    renders, from the project as it is now (the documents carry no turn
    boundaries, so it cannot be the state at that step).
- **`read_project_view`** — `_meta.ui.visibility: ["app"]`, so the model never
  sees it. The card calls it with the same project rule and `part`, `id`,
  `cursor`, and gets one page of:
  - `projection`: a card's or view's projection (the fallback above);
  - `results`: a search's results by log id; `transcription`; `log`;
  - `document`: a page of a whole document, `id` one of `research`, `tree`,
    `collections` or `results/<logId>`, returning `{text, cursor, version}`,
    where `version` is a hash of the whole serialized document;
  - `image`: `id` is a source's `image_filename` ref (`images/<name>.jpg`),
    signed only if it matches `^images/[A-Za-z0-9._-]+\.jpg$` (Electron's
    `IMAGE_REF_PATTERN`, `apps/electron/src/main/image.ts`), otherwise refused;
    returns one freshly signed link on `--public-url`.

  Read-only, because the plugin hook almost certainly never sees a card's calls.
- **The page resource:** `ui://genealogy/viewer.html`, MIME
  `text/html;profile=mcp-app`, listed by `resources/list` and served by
  `resources/read`. `_meta.ui.csp.resourceDomains` (the `--public-url` origin,
  plus `https://assets.claude.ai` if the page uses the host's fonts) goes on the
  `resources/read` content item, where the spec and Claude's quickstart read
  it; a copy on the list entry is optional.
- **Images:** `/img/<token>`, outside the secret, reads the signed
  `image_filename` ref through the store. The token is an HMAC, with a
  per-process key, over the project's path relative to `--root`, that ref and a
  10-minute expiry, so a copied image link exposes one page for at most ten
  minutes and never the secret. Projections and slices carry the source's
  `image_filename`, never a URL; the page asks `read_project_view`
  (`part: "image"`) for a fresh link each time it shows an image, so a card
  replayed from history or after a server restart still loads it.
- **No ext-apps on the server:** SDK 1.30 already carries tool `_meta`, result
  `_meta`, the resources capability and `ReadResource`. The server sets the MIME
  constant and the `_meta` keys itself.

### The projection (`viewer/projection/`)

Pure functions from `(research, tree, starting tree, external collections,
evaluations, results index)` to each card's and view's JSON shape. The starting
tree is read with `readStartingTree`. The results index (record id → the
`record_search` log entry whose results file holds it, ids compared with
`arkToBareId` from `src/utils/ark.ts`) is built by the server from the
`record_search` results files, only for the conclusion and search cards.

The reviewer is the evaluation whose `target_id` is the proof and whose
`superseded_by` is null. Its notes are read through the store from that
entry's `file_path`, as `sidecar_read` does; a missing file falls back to the
verdict alone.

- **Ids in fields are resolved; ids in prose are dropped.** An id field (`S1`,
  `I19`, `q_001`, `a_003`, `pe_060`) becomes the person, source, question or
  record it names. Prose is never rewritten with names: in any prose shown,
  every bracketed or parenthesised group containing an id is dropped, then any
  remaining bare id with its adjacent separator.
- **Structured fields first.** Search card: each plan item's record type,
  jurisdiction, date range and status, and each log entry's outcome and
  results examined. An unsettled conflict: the disputed attribute and each
  competing assertion's value, date, place and record. Not searched: each
  `not_reached` entry's kind (labelled), its `description` under the prose rule,
  and its `wiki_title` when present. Reviewer: that evaluation's `verdict`.
- **The conclusion line** is the paragraph under the narrative's first markdown
  heading, or first line opening with a bold run, whose text contains
  "conclusion" in any case, with or without words after it (`### Conclusion`,
  `**Conclusion (Probable):**`, `## Probable Conclusion`); otherwise the
  question text with the tier in words. When `claims[]` is present, each claim
  shows as a row with its label and its own tier.
- **What the conclusion changed in the tree** comes from `treeDiff` between the
  starting tree and the current tree: persons added and relationships added or
  changed, kept only where they touch a person linked by person-evidence to one
  of the proof's supporting assertions. With no starting tree, the line is
  omitted.
- **A record's search** is the source's `log_entry_id` when that entry's tool
  is `record_search` or `fulltext_search` (full-text hits, absences and older
  projects); otherwise it is the results index's entry for the assertion's
  `record_id`. A record whose source has an `image_filename` offers "See the
  page".
- **Stored values, not labels.** Enum values pass through as stored; the page
  labels them with viewer-ui's `statusLabel`.
- **Tolerant of real data:** duplicate person-evidence links collapse to the
  strongest; duplicate `ParentChild` edges dedupe; dates in mixed formats
  (`12May1879`, `1887-09-24`, `12 July 1848`) normalize for display; older
  document shapes are read, never repaired.
- **A step card shows the current question's state for that step's concern,
  not a diff of the turn.** The documents carry no turn boundaries.
- **Size budget:** each `show_project` result stays under 100,000 characters
  serialized. Anything bigger pages through `read_project_view`.

### The page (`apps/mcp-viewer/`)

- A pnpm workspace member: add `apps/mcp-viewer` to `pnpm-workspace.yaml` (it
  lists apps by name) and `|^apps/mcp-viewer/` to the workspace job's
  `PATTERNS` in `.github/workflows/js-tests.yml`, so a PR touching only the
  page still runs its checks. The page has `test` and `typecheck` scripts for
  turbo. Any page script that starts vite begins with
  `pnpm --filter @genealogy/schema generate &&`; if it is named `dev`, the
  page's package name joins the pinned list in
  `packages/viewer-ui/src/__tests__/dev-scripts-generate.test.ts`. The
  Makefile's `$(JS_DEPS)` already globs `apps/*`.
- React 19, Vite and `vite-plugin-singlefile`, so one self-contained HTML file.
  Depends on `@genealogy/viewer-ui` and `@genealogy/schema` (never on the
  engine), and `@modelcontextprotocol/ext-apps@1.7.5` for the `App` client.
- **Layouts:** eight step cards, the views, and the everything view.
- **Theme:** the host's CSS variables mapped onto viewer-ui's tokens, so light
  and dark follow Claude. Fonts inlined or the host's own; no Google Fonts.
- **Links:** a capture-phase listener on `document` is the only opener for
  anchors. On `click` (and on `auxclick` only when `event.button === 1`) it
  calls `preventDefault()` and `stopPropagation()` on every `a[href]` and passes
  https links to the App's `openLink` (`ui/open-link`). A link inside
  agent-written markdown therefore never replaces the card, and Linkify's own
  handler never fires a second open.
- **The everything view:** viewer-ui's `App`, given
  `McpAppResearchTransport` from `apps/mcp-viewer/src/transport/` (beside the
  web and Electron transports, tested with `assertTransportContract` from
  `@genealogy/viewer-ui/contract`). It implements `ResearchTransport` without
  changing it:
  - `getProjectState` pages each document through `read_project_view`
    (`part: "document"`) until `cursor` is null, restarts if a page's
    `version` differs, then parses and returns the whole snapshot. Its `label`
    is the project's title, else the folder name, never null (a null label
    shows the welcome screen). So the provider gets the whole document it
    expects, whatever M0 finds about size limits.
  - `readSidecar` pages `results/<logId>` the same way, with a constant
    `mtime` (nothing is subscribed, so nothing races).
  - `getSourceImage` asks `read_project_view` for a fresh signed link and
    returns it as the `img` source.
  - `openExternal` and `openFamilySearch` are arrow-function properties, because
    the provider passes them unbound. `openExternal` → `openLink`, only for an
    https URL (as Electron's main process checks);
    `openFamilySearch` resolves the value with viewer-ui's
    `resolveFamilySearchTarget` and opens only what resolves, as
    `WsResearchTransport` does.
  - `submitFeedback` rejects with "not available here"; `selectFolder` and
    `getFeedbackContext` are absent; `subscribe` delivers nothing.
- **viewer-ui edits, both additive:** a `showHeaderActions` prop (default
  true) on `App` and `ViewerBody`, passed to `Header`, which then hides Export
  GEDCOM, Print and Send Feedback and the dialogs they mount; and a
  `statusLabel(value)` export from `StatusBadge.tsx`, re-exported from
  `src/index.ts`. The page passes `showHeaderActions={false}` and
  `showThemeToggle={false}`. Electron and the web app keep the defaults.
- **Build:** `make mcp-viewer-build` builds the page and copies it to
  `packages/engine/mcp-server/viewer/page/viewer.html` (gitignored), where the
  CLI entry reads it.

### Router lines (a variant plugin build, never a PR)

One line per stopping point in `skills/research/SKILL.md`: after the step
report, call `show_project` with the step, then the reply. The tool is found by
bare name (`+show_project` in ToolSearch).

- **Where they live:** a local branch, `mcp-app-router-variant`, holding only
  the router-line commit, rebased onto the viewer branch whenever the variant
  zip is rebuilt. The zip is built from that checkout with
  `scripts/package-plugin.mjs` and installed in the lead's personal Cowork
  account. No PR is ever opened from it; main's router and its evals are never
  touched.
- **Under Decision 3's fallback** (M0 records that `show_project` asks for
  approval every time and "always allow" does not stick): lines only for setup,
  search, conflict, hypothesis and conclusion, plus a link line only when the
  link step ends on a question for the researcher (no "Continue with …?" line).

## Data

- **Tests:** the McAndrew capture (`docs/captures/2026-09-29-mcandrew-children`)
  and the committed e2e end states
  (`eval/runlogs/e2e/<fixture>/run-*.final-research.json` with its
  `.final-tree.gedcomx.json`), assembled into temporary project folders with
  `eval/tests/e2e/<fixture>/starting-tree.gedcomx.json` as the starting tree.
  The McAndrew capture and `william-ferber-ancestry` have no starting tree, so
  their tree-change line is omitted. The largest committed end state is
  `hannah-earnest-children/run-2026-10-21_06-52-59` (441 KB). These have no
  `results/`, `images/` or `evaluations/`. The proof view's notes are tested
  over the three fixtures that pair a research.json with an evaluation file:
  `eval/fixtures/scenarios/compound-objective-fully-covered`,
  `compound-objective-part-unframed` and `flynn-prior-craft-verdict`.
- **The size budget, locally:** the largest real project is a tester's
  feedback bundle on the lead's machine, the one whose research.json is
  1,553,609 bytes (dated 2026-10-23, with `results/`). A local script,
  `viewer/measure-budget.ts <projectDir>`, runs the budget check over it. The
  bundle is never committed and never used in the demo.
- **The demo:** a fresh project the lead runs in Cowork with the alpha `.mcpb`.
  A page is saved and attached to its record only when the research reads a
  browsed page: search-images, then `image_transcribe` with `projectPath`, then
  record-structurer, whose `extraction_append` writes the source's
  `image_filename` and `transcription`. An indexed record never gets a page,
  and asking for a transcription afterwards saves the image without attaching
  it to the record (and the sweep removes uncited images after 24 hours). So
  the demo's objective is chosen so that a deciding record comes from a
  browse-only collection, while others come from indexed searches.

## Milestones

Each is one or more small PRs merged to main. Nothing calls the second server,
so merging changes nothing for anyone else.

### M0 — Skeleton, which is also the probe (2–3 days)

The server with the page resource, `show_project` returning a hello card that
echoes its input and takes a `pad` size, `read_project_view` returning a
payload of a requested size, a signed test image, and the request log. Then:

1. **Local, no Claude:** ext-apps' `basic-host` example against
   `http://127.0.0.1:<port>/<secret>/mcp` with `--allow-origin`. basic-host
   falls back to the list entry's CSP, so a local image load does not prove the
   CSP placement.
2. **Desktop chat and claude.ai chat** through the tunnel, as a custom
   connector on the personal account.
3. **Cowork**, the same connector, from a task's main thread, after a
   ToolSearch load, and with the variant plugin installed.

Record, in `docs/mcp-app-host-probe.md`, per host:
- does the card render; the client's declared extensions;
- **what the model receives:** put different canary strings in `content`, in
  the result's `_meta` and (in one test call) in `structuredContent`, and ask
  the model to quote each;
- does the card receive the result's `_meta` (this says how often the
  projection fallback fires);
- does tapping a button make a hidden call, does that call prompt for
  approval, and does "always allow" stick on `show_project` and on
  `read_project_view` (does the second tap prompt again);
- the largest result accepted on mount (`pad`) and on a hidden call (40k, 160k,
  400k, 1M characters), and what happens past it. Desktop chat and claude.ai
  document about 150,000; Cowork is the one to measure;
- does the image load from the declared host;
- does `ui/open-link` show Claude's confirmation each time;
- does the plugin load in claude.ai and Desktop chat (if it does, the research
  skill's "without an `Agent` tool … stops" line would turn away a view
  request);
- is the `projectPath` the model passes in Cowork readable on the Mac.

**Done when:** every item above has a recorded answer, and the server's tests
pass, each with a stub page HTML:
- `tools/list` carries `_meta.ui.resourceUri` on `show_project`,
  `visibility: ["app"]` on `read_project_view`, and `readOnlyHint: true` on
  both;
- `resources/read` returns the stub with `text/html;profile=mcp-app` and
  `contents[0]._meta.ui.csp.resourceDomains` containing the public origin;
- every path off the secret gets 404 except `/img/<valid, unexpired token>`
  (and, in the OAuth variant, the OAuth routes listed under Access); a bad or
  expired token gets 404;
- `part: "image"` refuses an `id` outside the image-ref pattern
  (`../research.json`, `research.json`, `images/x.png`);
- in the OAuth variant, POST `/authorize/approve` with a valid pending id and a
  wrong or missing secret gets no redirect carrying a `code`, and with the right
  secret it does;
- the page's projection function fetches at most once per mount, and a
  cancelled call paints no card;
- refused: a project outside `--root`, a sibling whose name starts with the
  root's (`<root>-x/proj`), and a symlinked project folder pointing out of
  `--root`; accepted: the same project reached through a symlink to the root,
  which the test creates (CI runs Linux, where `/tmp` is no alias);
- an omitted `projectPath` resolves to `--root` when it is a project, and
  otherwise is refused with the list of folders;
- with `--allow-origin`, OPTIONS from that origin gets 204 with the header and
  from any other origin does not.

### M1 — The designer demo (10–12 days)

- The projection and layouts for the **setup, search and conclusion cards**,
  plus `latest`.
- In-card views: a search's **results**, the **page image**, its
  **transcription**.
- The **everything view**, with the paging transport and the two viewer-ui
  props.
- **The demo script** (Desktop chat, which renders today; the server started
  with `--root` at the demo project): "Where does the research stand?" → the
  conclusion card with its recorded doubt → tap an indexed supporting record →
  the search that returned it, in place → tap the browsed supporting record →
  "See the page" → the image fullscreen with its transcription → the
  everything view. Light and dark. If M0 showed Cowork renders, also a live
  Cowork run with the variant plugin calling the setup, search and conclusion
  cards.
- A short screen recording for the designer.

**Done when:**
- before recording, in the demo project, at least one supporting assertion's
  source has an `image_filename` that exists under `images/` and a non-empty
  `transcription`, and at least one supporting assertion's `record_id` appears
  in the results file of a `record_search` log entry under `results/`;
- the demo script runs end to end on the demo project;
- the projection tests pass over the McAndrew capture and every committed e2e
  end state;
- the id-leak check passes on all of them, and is shown failing on three
  planted shapes (`S28` in a citation, `I19` in a name, an id inside a
  sentence) and passing names and dates that contain digits;
- every `show_project` result is under the 100,000-character budget over the
  committed corpus, and `viewer/measure-budget.ts` reports the same over the
  1.55 MB bundle;
- clicking a planted `[x](https://evil.example)` and a bare URL in a proof
  narrative, a Linkify URL in a research-log note, and an "Open in
  FamilySearch" button each produce exactly one `openLink` call with an https
  URL, none navigates the frame, and an `http:` source URL on the Sources
  button produces none;
- `McpAppResearchTransport` passes `assertTransportContract`, and
  `getProjectState` assembles a document from three pages, restarts when a
  page's `version` changes, and returns a non-null `label` for a project with
  no title.

### M2 — Trust test (2 days, plus people)

Render the setup, search and conclusion cards as static pages from 10–15
finished projects. A genealogist marks every wrong or misleading line; three
beginners read the McAndrew conclusion card and are asked "Should we add
Martin?". McAndrew's correct answer is pinned first.

**Done when:** every marked line has a fix or a recorded reason to keep it, and
at least two of the three beginners mention the birthplace disagreement or the
reviewer's "look again" when explaining their answer.

### M3 — The other step cards (8–10 days)

Plan, link (with the identity question side by side when it asks one),
conflict, hypothesis, assess. The variant plugin gains the remaining router
lines, or under Decision 3's fallback only conflict, hypothesis and the
conditional link line.

**Done when:** each card's projection has tests over the end states that reach
that step, and all eight cards show either in a live Cowork run (if it renders)
or in a Desktop-chat walk of a finished project. Under the fallback, the Cowork
run shows the cards it calls and the Desktop-chat walk shows plan and assess.

### M4 — The other views (5–6 days)

The log filtered to a question or planned search; the family now (research-added
people marked); one person with where each fact came from; a person's timeline;
the full proof with the reviewer's notes.

**Done when:** each view has projection tests and renders in Desktop chat on
the demo project, and the proof view shows the reviewer's notes on the three
evaluation fixtures and the verdict alone where the file is absent.

**Total:** roughly 6–8 weeks of the lead's time, M0 through M4.

## Later

Progress polling (the plan card ticking while searches run); fetching unsaved
page images from FamilySearch; a "Looks odd" check (better as an engine check
the agents also see); posting buttons of any kind.

## What adoption would take (a separate decision)

- **The beta's door (E1):** let `resources/list`, `resources/read` and `ping`
  through without a project on a valid token; bind `read_project_view` by
  `projectPath` like any call; serve the image route.
- **One connector or two:** stay a second connector (a second sign-in for beta
  users), or move the tools into `src/tools/` and `createServer` (then every
  new-tool site applies: `allToolSchemas`, `manifest.json`, the smoke rows, a
  spec, the catalog, the hook's classification).
- **The router lines on main,** with one paid `research` eval run.
- **Packaging:** build the page into `eb-tools.zip`; the release smoke checks
  `resources/read`.
- **The beta plan's viewer items** (W3's viewer routes, W4's viewer, polling
  and print view, D4 step 5, acceptance 2.2 and 2.6) change to the card.
