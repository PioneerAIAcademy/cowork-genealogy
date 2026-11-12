# MCP App viewer: research cards and a case file inside Claude

**Status:** Adopted. M0 is closed: every row of `docs/mcp-app-host-probe.md`'s record has
an answer (2026-11-08). The fold's skeleton is built and tested on the connector path, but
no card has drawn through the door yet, so the fold is not done (see "The fold"). The
demo scope is not built.
**Owner:** the MCP App session, full-time. A second session, remote-server, owns the
door, sign-in, `project_list` and the self-hosted stack. The lead merges.

## Goal

1. **The demo:** real project data in the conversation, on cards with a case file
   behind them, served from the self-hosted server behind FamilySearch sign-in.
2. **The beta's UI.** The cards fold into the remote connector and replace the
   browser viewer for a very limited beta on the same server (see "The fold").
3. **One viewer to maintain,** with a case file a senior researcher would choose over
   today's viewer. That file is in the demo (M3).

## Decisions (lead, 2026-11-03 to 2026-11-06)

1. **claude.ai chat and Desktop Chat are the primary surfaces.** Project data lives on the
   remote server, so nothing ties a user to a Cowork task. Cards are checked on those two,
   the same page and server on each. Cowork is not tested further.
2. **A card is a picture, never a reply.** Nothing on a card posts a message or
   runs a step. The reply stays with the platform's own carrier (in Cowork today,
   the "Continue with …?" line). At a stopping point the order is: the step report,
   the card, then the reply.
3. **A step card at every stopping point:** setup, plan, search, link,
   conflict, hypothesis, assess, conclusion. Fallback if Cowork asks for
   approval on every card and "always allow" does not stick: setup, search,
   link (only when it asks an identity question), conflict, hypothesis,
   conclusion.
4. **Two surfaces: cards for the moment, the case file for depth.** Everything
   someone asks to see (a search's results, a page image, a transcription, the
   log, the family, a person, a timeline, the proof) is a page of the case file,
   opened from a card or by asking.
5. **The case file replaces today's section browser.** It is designed for senior
   researchers and open to everyone. It does not copy the 15 sections. The first
   build uses viewer-ui's `ViewerBody` in fullscreen, and the new file replaces it before
   the demo (M3).
6. **The conclusion card shows recorded doubt only:** the rating in words, the
   shortfall, what was not searched, any unsettled conflict, the engine's
   unregistered-disagreement check, and the reviewer's verdict when there is one.
   No heuristics of the card's own.
7. **No live watching.** Steps will run under five minutes.
8. **M0 gates the fold.** M0 stays open until every row in
   `docs/mcp-app-host-probe.md`'s record has an answer, the Artifact rows included, and a
   failure is an answer. Five answers gate the fold: does `_meta` reach the model (the
   canary), the fullscreen events and remount, the mount size past 300 KB, `openLink`, and
   `projectPath`. Each needs an answer in claude.ai chat and Desktop Chat.
9. **The demo shows page images.** The demo project is run so that the pages
   that matter are transcribed and attached (see "Data").
10. **FamilySearch links replace identifiers.** Wherever the project holds an
    ARK, a tree person id or a familysearch.org URL, the reader sees a named
    link, never the identifier.
11. **This folds into the remote connector.** There is one connector, named exactly
    `Genealogy Research`, with real FamilySearch sign-in. `Genealogy Viewer` retires
    once the fold works.
12. **Cards replace the browser viewer for the beta.** Nothing is deleted: the Fly
    alpha, the handoff's chat and Electron stay through the demo, with fixes only.
13. **The server is self-hosted,** with Postgres and MinIO and no AWS. It carries the
    demo, then a very limited beta.
14. **No feedback tool.** Users email the lead with the conversation pasted in.
15. **Uploads are a plain web page** (issue #4001), not a card.

## Not in scope

Feedback; print and GEDCOM export; any button that posts; progress polling;
fetching unsaved page images from FamilySearch; uploads; `allToolSchemas` and
`manifest.json`; sign-in and `project_list`; `apps/web`. Main's research
router is issue #4297. Electron and the web viewer stay as they are
through the demo, with fixes only.

## Scope for the demo

- **In:** every step card (M1, M2); the new case file with the evidence grid and Compare
  with FamilySearch (M3); and the display rules, on Postgres and MinIO behind sign-in.
- **Out:** a feedback flag, and removing Electron or the web viewer.
- **`ViewerBody`** is the case file for the first runs, so the cards and sign-in get real
  use early. It keeps its ids, its retired rows and its section order until M3 replaces
  it, and the display rules apply to the cards until then.

## Surfaces

- **Cards** sit in the conversation. Claude's limits apply: height fits the
  content, at most 4–5 data points, at most 2 actions, no drill-ins, no menus, no
  inner scrolling. A card that has more to say shows the most serious items and
  says how many more are in the case file.
- **The case file** opens from a card's button in MCP App fullscreen: the same
  frame, the message box stays, and closing returns to the same place in the
  conversation. Fullscreen covers the transcript, and MCP Apps have no side-panel
  mode (the modes are inline, fullscreen and picture-in-picture), so side-by-side
  work happens inside the file, in its right-hand pane. A card the model sends while
  the file is open takes over the view as a new mount, already in fullscreen, so what
  the researcher had open there does not carry over by itself.
- **An artifact beside the conversation** is the only true side panel, and M0 tests it
  either way. Claude's help centre says an artifact opens beside the conversation
  and can use custom connectors, and its page can read a connector's read-only
  tools as the viewer. Its limits: it does not arrive with the connector, and a
  connected artifact can be shared inside the organization but not by link. If
  fullscreen does not work, the case file runs as an artifact, the same page on a
  second host. Otherwise, using one as well is a separate decision after M0.

## The case file

This is the file that replaces `ViewerBody` before the demo. Five pages, each shown
only if it has content, with a search box over the whole file. Clicking a person, record or source opens it in a right-hand pane without
leaving the page, so a researcher can compare without losing their place.

- **The case** (the default): one question read top to bottom as a proof, with a
  switch when the project has more than one.
  - The conclusion, its rating in words, and what it changed in the tree. Until
    there is a conclusion, **So far** takes its place: the records kept, the searches
    done and still open, and the step the research is on, all from the documents.
  - The reviewer's verdict and notes.
  - **What each record says:** the evidence grid. Rows are the facts at issue;
    columns are the tree before the research and then each supporting record in
    date order, with who said it and what was read (index or original page). Cells
    hold the record's own words. A cell is tinted only when a conflict or the
    engine's disagreement check names its assertion; the grid does not say which
    is right.
  - Conflicts and competing identities, settled or not, side by side.
  - **What was searched:** the plan as a checklist with what each item found.
  - **Leads:** what is still worth trying, each with why it was not searched and
    "needs you" when only the researcher can reach it. A recorded high overturn risk
    heads the list as "could change the answer".
- **Compare with FamilySearch:** by person, what this research found against the tree
  as it stood when the project started: people, facts and relationships. The page shows
  that date, because the viewer makes no FamilySearch calls, and opens with a count, such
  as "1 possible relative, 3 people with new findings". Each finding sits beside the
  tree's value with one tag: **Already in tree** when they agree or the finding says
  less; **Improved** when it is the same fact told more exactly, a year becoming a full
  date in that year or a country a town inside it; **Differs** when a birth,
  christening, death or burial already had another value; and **New** otherwise.
  Agreement is shown because it is evidence too. Each finding names its record
  with the link strength of each person on it, and its link opens the record on
  FamilySearch, where the researcher can attach it; nothing here writes to the tree.
  A research-added person shows their link strength in words, and one with only
  speculative links, or none, is listed as a possible relative.
- **People:** the family drawn as parents, couple and children, with
  research-added people marked, each labelled by relationship to the question's
  subject ("Mary's son"). A person's page is their life in time order, each fact
  with the evidence behind it and how strongly it is linked, the gaps, and any
  namesakes they are not.
- **Sources,** in three groups:
  - **Direct mentions:** every record with its full citation and classification,
    and a chip per person with their link strength. There is no confidence badge per
    source: the same register can be confident for the child and speculative for the
    mother. The pane shows the page image beside its transcription, then the record's
    findings as labelled facts.
  - **Leads:** the list from The case.
  - **Background:** the locality guides and outside collections.
- **Log:** every search in time order in plain words, filterable by question and
  outcome, opening its results.

Every one of today's 15 sections has a home here. Gone: the schema-order
sidebar, collapsed cards, raw ids, enum text, empty tabs, the researcher-profile
block and the raw-JSON toggle.

If M0 shows the host supports `ui/update-model-context`, selecting a row tells
Claude what the researcher is looking at, so a question in the message box needs
no explaining. It posts nothing.

## Architecture

### A thin server, outside `src/`

This section describes M0's probe server and the `make viewer` loop. "The fold" says
what changes on the tool server. The server supplies documents and the few facts only
the engine can compute. All display logic lives in the page, in one place, so cards
and the case file cannot disagree.

- **Where:** `packages/engine/mcp-server/viewer/`, run with `tsx`, as
  `dev/probe-connector-server.ts` is. Outside `src/`, so `tsc` never compiles it
  into `build/` and neither the `.mcpb` nor `eb-tools.zip` ships it. Add
  `"viewer/**/*"` to `tsconfig.typecheck.json`'s `include`. Its tests live in
  `packages/engine/mcp-server/tests/viewer/`, where the engine's vitest and
  `engine-tests.yml` reach them. No test there may skip: `vitest-pg` fails any
  skipped test.
- **What it shares:** the engine's own modules, `src/utils/project-io.ts`,
  `src/utils/question-state.ts`, `src/utils/awaiting-hand-offs.ts`,
  `src/utils/starting-tree.ts`, `src/tools/tree-diff.ts` and
  `src/store/paths.ts`, and every read goes through `ProjectStore`, so the same
  code reads Postgres and MinIO once folded in.
- **What it never touches:** `allToolSchemas`, `manifest.json`, the plugin hook's tool
  maps, any eval. The tools' core is `src/tools/project-view.ts`, shared with the tool
  server, and `viewer/tools.ts` adds M0's probes around it.
- **Transport:** Streamable HTTP, stateless, plain JSON, one `Server` per
  request, as `src/http-server.ts` and the MCP Apps examples do. Binds
  `127.0.0.1`; reached through a public HTTPS tunnel.
- **Command line:** `--secret <random> --root <dir> --public-url <https origin>
  [--port 8090]`, or `--local --root <dir> [--port 8090]`.
  - `--public-url` is the tunnel's origin. The CSP entry and every image link are
    built from it, never from the Host header.
  - `--local` generates its own secret with `randomBytes(32)`, uses
    `http://127.0.0.1:<port>` as the public URL, serves the page at `/<secret>/` and
    opens the browser there (see "Local testing"). The page response carries
    `Content-Security-Policy: default-src 'none'; script-src 'unsafe-inline';
    style-src 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:;
    connect-src 'self'; base-uri 'none'; form-action 'none'`, so agent-written text
    cannot load a remote image. The server sends no CORS headers in any mode.
  - The server factory takes the page's HTML as a parameter. Only the CLI entry
    reads `viewer/page/viewer.html`, and it refuses to start, naming
    `make mcp-viewer-build`, when the file is missing.
- **Access:** no sign-in on the thin server (a custom connector can be added with
  none). The `Genealogy Research` connector has real sign-in.
  - The lead adds the connector to the organization. Every member who connects
    it reaches this server, so `--root` holds only what the team may see.
  - The MCP route lives under the secret (`/<secret>/mcp`); every other path is
    404 except `/img/<token>`. The secret keeps strangers out of a public tunnel; it
    is not a per-person lock.
  - One connector is one URL, so it reaches one machine's folders.
  - `--root` is realpath'd once at startup. Every call realpaths its project
    folder, refuses on any error, refuses unless `isInsideProject(rootReal, real)`
    holds, and passes `real` on to the store. Image tokens carry the path relative to
    `--root`.
- **Project resolution** (both tools, same rule): `projectPath` is optional. An
  absolute path is used as given (then contained). A bare folder name is a folder
  under `--root`. Omitted: `--root` itself if it holds `research.json`; otherwise
  the call is refused with the list of project folders under `--root`. The tool
  description says all of this. A live run that creates a project needs `--root` at
  its parent, because a project cannot nest inside another.
- **Logging:** one JSON line per request to stdout: method, tool, result size, and
  `clientInfo` and the declared extensions from the `initialize` request body. Never
  the raw path or a token.

### Tools

Both carry the annotation `readOnlyHint: true`; Claude sets its auto-permissions
from it, and an unannotated tool defaults to "not read-only".

- **`show_project`** — visible to the model. Input (camelCase): optional
  `projectPath`; `show`, one of `setup`, `plan`, `search`, `link`, `conflict`,
  `hypothesis`, `assess`, `conclusion`, `latest` (for "where are we") or `file`; and optional `page` (`case`, `compare`, `people`, `sources`,
  `log`), `questionId`, `logId`, `personId`, `planItemId`, `sourceId`.
  - `_meta.ui.resourceUri: "ui://genealogy/viewer.html"`. The description tells
    the model that the researcher sees the card and it must not restate it.
  - **Result shape.** On all three surfaces the model sees a result's `content`, and
    neither its `structuredContent` nor its `_meta`. `structuredContent` is omitted
    and `content` is one line for the model. The result's `_meta` under
    `genealogy/project` carries `research`, `tree`, `startingTree`, `collections`
    and `derived`. A card is therefore a true snapshot of the project at that step.
    The host drops `_meta` with no error somewhere past 1 MB. So above 1,000,000 bytes
    `show_project` leaves the documents out of `_meta` and keeps the rest, which is small
    and holds the `projectPath` the call named. The card then reads the project as it
    is now, with that id.
  - **`derived`** is what only the engine can compute: question states
    (`questionStatus`), unregistered disagreements, hand-offs awaiting the
    researcher, the tree changes from `treeDiff` against the starting tree, each
    live evaluation's body by id with its `craft` flag, and the project's folder
    name.
- **`read_project_view`** — `_meta.ui.visibility: ["app"]`, so the model never
  sees it, and its data travels in `structuredContent`, which an artifact can read.
  The page calls it with the same project rule and `part`, `id`:
  - `document`: the current `research`, `tree`, `startingTree`, `collections` and
    `derived`;
  - `results`: one results file, or `{ found: false }` when it is absent, which is
    not an error; `id` must match `^log_[a-zA-Z0-9_-]+$` (Electron's
    `LOG_ID_PATTERN`), otherwise refused;
  - `recordSearch`: `id` is a record id; returns the `record_search` log id whose
    results file holds it, ids compared by the ARK's bare id, so finding a record's
    search costs one call;
  - `image`: `id` is a source's `image_filename` ref (`images/<name>.jpg`), signed
    only if it matches `^images/[A-Za-z0-9._-]+\.jpg$` (Electron's
    `IMAGE_REF_PATTERN`), otherwise refused; returns one freshly signed link.

  Read-only, because the plugin hook almost certainly never sees a card's calls.
  If M0 shows an artifact cannot reach an app-only tool, its visibility becomes
  `["model", "app"]` with a description telling the model not to call it.
- **The page resource:** `ui://genealogy/viewer.html`, MIME
  `text/html;profile=mcp-app`, listed by `resources/list` and served by
  `resources/read`. `_meta.ui.csp.resourceDomains` (the `--public-url` origin, plus
  `https://assets.claude.ai` if the page uses the host's fonts) goes on the
  `resources/read` content item, where the spec and Claude's quickstart read it.
  Claude caches the page per connector and app (the record's **Card renders**), so M1
  puts the build in the URI: a deploy, or a rollback, then reaches cards that already
  read the page.
- **Images:** on the thin server, `/img/<token>`, outside the secret, reads the signed
  `image_filename` ref through the store. The token is an HMAC, with a per-process
  key, over the project's path relative to `--root`, that ref and a 10-minute
  expiry, so a copied link exposes one page for ten minutes and never the secret.
  The page asks for a fresh link each time it shows an image. On the tool server the
  route is `/img?t=<token>`, and the token signs the project id (see "The fold").
- **No ext-apps on the server:** SDK 1.30 already carries tool `_meta`, result
  `_meta`, the resources capability and `ReadResource`.

### The page (`apps/mcp-viewer/`)

- A pnpm workspace member: add `apps/mcp-viewer` to `pnpm-workspace.yaml` and
  `|^apps/mcp-viewer/` to the workspace job's `PATTERNS` in
  `.github/workflows/js-tests.yml`. The page has `test` and `typecheck` scripts for
  turbo. Any page script that starts vite begins with
  `pnpm --filter @genealogy/schema generate &&`; if it is named `dev`, the
  package name joins the pinned list in
  `packages/viewer-ui/src/__tests__/dev-scripts-generate.test.ts`.
- React 19, Vite and `vite-plugin-singlefile`, so one self-contained HTML file.
  Depends on `@genealogy/viewer-ui` and `@genealogy/schema` (never on the engine),
  and `@modelcontextprotocol/ext-apps@1.7.5` for the `App` client.
- **Three hosts, chosen at boot,** before anything connects, checked in this
  order: an artifact (`typeof window.claude?.use === "function"`), a browser tab
  (`window.parent === window`), otherwise the MCP App `App`. If `connect` takes over
  10 seconds or `use("mcp")` resolves null, the page says it cannot reach its host.
  Each host supplies `call(tool, args)`, `openLink`, fullscreen and its input,
  and a tool failure reaches the page in one shape. In a tab, `show` comes from the
  URL, loading is one `document` call, `openLink` is `window.open`, and the POST
  sends both Accept types. An artifact also loads by one `document` call.
- **Display modes:** the `App` declares
  `availableDisplayModes: ["inline", "fullscreen"]`. The page keeps one `mode`, set by
  `hostContext.displayMode` at connect, by a `hostcontextchanged` only when it carries
  `displayMode`, and by what `requestDisplayMode` returns; the last to arrive wins, and
  a rejected request leaves it alone. The layout and the open button read `mode`, never
  `getHostContext()`. The open button is hidden when fullscreen is not offered.
- **Loading the project in a card, once per mount.** Only the first tool result
  counts. If its `_meta["genealogy/project"]` holds `research`, that is the snapshot. If
  it is `isError`, the card shows its text and fetches nothing. Otherwise, or if no
  result arrives shortly after the tool input (a host need not send one to a card
  mounted after the call finished), it makes one `read_project_view` call
  (`part: "document"`), and an entry with no `research` gives the card its `echo` as
  input if it has none. A cancellation clears the timer and the card says the call
  was stopped. Later tool-input and tool-result events are ignored.
- **Opening the case file** fetches the current documents once and pushes them
  through `subscribe`'s handlers, so a card from an early step opens today's file; if
  the fetch fails, the snapshot stays. `startingTree` and `derived` sit in one page
  context beside the provider, set by the same function.
- **Reading the documents.** `McpAppResearchTransport`, in
  `apps/mcp-viewer/src/transport/`, feeds viewer-ui's `ResearchDataProvider`, which
  already gives every page `buildIndex` and `getById`. It implements
  `ResearchTransport` without changing it and passes `assertTransportContract`:
  - `getProjectState` returns the documents; its `label` is the project's title,
    else its objective, else `derived`'s folder name, never null (a null label shows
    the welcome screen);
  - `readSidecar` resolves null, with no call, for an id outside `LOG_ID_PATTERN`;
    otherwise it calls `part: "results"`, with a constant `mtime`, and resolves null on
    `found: false`. Every other failure rejects, so the drawer offers Try again;
  - `getSourceImage` returns a fresh signed link as the `img` source;
  - `openExternal` and `openFamilySearch` are arrow-function properties, because
    the provider passes them unbound. `openExternal` calls `openLink` only for an
    https URL; `openFamilySearch` opens only what resolves;
  - `submitFeedback` rejects with "not available here"; `selectFolder` and
    `getFeedbackContext` are absent; `subscribe` keeps its handlers for the refresh
    above and delivers nothing else.
- **Display rules,** applied to the cards and, from M3, to the file:
  - **The current question** is `questionId` if passed, else the last unresolved
    question, else the last with a proof. `latest` picks the card from that
    question's state in `derived`: framed → setup, planned → plan, searching →
    search, evidence-gathered → link, concluded or critiqued → conclusion. No
    question yet: `latest` is setup, and the setup card shows the objective.
  - **The evidence grid's rows** key on the person and the fact type, lower-cased
    with spaces and underscores removed (`marital_status`, `maritalstatus` and `Marital
    Status` share a row), and a cell lists every assertion that lands on it. The tree
    column reads `startingTree`, never the current tree: `name` from `names[]`, `sex`
    from `gender`, `relationship` and `parentage` from the person's relationships,
    `marriage` from the Couple's `facts[]`, and anything else from `facts[]` by type,
    keyed the same way. With no starting tree the column is omitted. A supporting
    assertion with no live link gets its own row, labelled by `record_role`.
  - **Ids in fields are resolved.** `S1`, `I19`, `q_001`, `a_003`, `pe_060` in a
    field become the person, source, question or record they name.
  - **Internal ids in prose are named outside brackets and dropped inside them.** An
    internal id is a tree `S`, `I`, `R`, `F` or `N` number, or `a_ c_ ev_ h_ loc_ log_
    ns_ p_ pe_ pl_ pli_ ps_ q_ rj_ rp_ src_ t_` plus digits, and never part of a URL,
    an ARK or a longer token; a role such as `child_1` is not one. Ids joined by a
    comma, semicolon, slash, dash, arrow, `+`, `&`, `and`, `or`, `vs` or a space are one
    run.
    - Outside brackets a run is a word in the sentence, so it becomes the names of the
      people and records it holds, keeping any `'s`. A bracket straight after it that
      only repeats the name goes.
    - Inside brackets a run is a citation, so it goes. So does a run with no name.
    - A run that goes takes the space before it and any label directly before that
      (`see`, `see also`, `assertion(s)`, `source(s)`, `tree person(s)`, `for`, `as`).
      A separator left at a bracket's edge goes, and so does a bracket left with no
      letter or digit. The words beside an id stay, because agents put evidence there.
    - A prototype over the 7,910 proof narratives and link rationales that hold ids
      left no id behind, with about 38 orphaned `'s` and 138 stranded prepositions,
      against 530 and 1,268 if every id is removed.
  - **FamilySearch identifiers become named links.** A tree person is their name;
    a record is its title ("1887 birth register"); a page image, collection or wiki
    page is named for what it is.
  - **In prose,** one page function handles every "on FamilySearch" link. A URL is
    parsed with `new URL`, must have the hostname `familysearch.org` or
    `www.familysearch.org` and no credentials, and is rebuilt on
    `https://www.familysearch.org`. A URL that fails this test stays whole: nothing
    inside it, or inside a markdown link's destination, is linked or removed. A full
    ARK, or a bare `\d:\d:<id>` form such as `3:1:3QSQ-G9NW-8ZZC`, where `<id>` is
    capitals and digits in two or more hyphenated parts and no letter, digit, `/` or
    `:` comes before it, becomes a link, with trailing punctuation peeled off and any
    `?…` dropped. A bare token that looks like an id becomes a link only if the
    project knows it. A tree person's `id`, the bare id in their `ark`, or the id in a
    tree source's `/tree/person/details/<id>` URL gets the person page. A record's id
    comes from `assertions[].record_id` or the ARK in the `url` of a research or tree
    source, counts only if that record has an ARK, and gets that ARK, named by the
    record's title. A person wins over a record. A link is never built from a stored
    `url`, and a bare token never goes to `resolveFamilySearchTarget`, which reads it
    as a person. Any other token with a capital letter in that shape is removed as an
    internal id is, and anything else, such as `1885-1910` or `Mary-Ann`, stays as
    text.
  - **The conclusion line** is the paragraph under the narrative's first markdown
    heading, or first line opening with a bold run, whose text contains
    "conclusion" in any case (`### Conclusion`, `**Conclusion (Probable):**`);
    otherwise the question text with the tier in words. When `claims[]` is present,
    each claim shows as a row with its label and its own tier.
  - **The reviewer** is the newest live, non-refused, non-craft evaluation whose
    `target_id` is the proof, else the newest such on-demand one on the question,
    written after the proof's `updated` if it has one (few do). A craft read says how
    the proof reads, not whether the evidence holds, so it never shows as the
    reviewer's verdict. The only mark is the `craft` flag in the body, and a body that
    cannot be read counts as not craft, as gps-mentor counts it. The reviewer runs only
    when asked, so often there is none. A missing notes file falls back to the verdict
    alone.
  - **Retired rows never show:** assertions and person-evidence links with a
    non-null `superseded_by` are left out everywhere.
  - **Link strength** is the stored `confidence` in words, per person, never per
    source.
  - **Leads:** each `not_reached` entry's kind (labelled), its `description` under
    the prose rule, and its `wiki_title` when present. The overturn risk shows only
    when `search_stop.justification` opens with `Overturn risk:`, and reads "could
    change the answer" only when that says high.
  - **What the conclusion changed:** `derived`'s tree changes, kept only where they
    touch a person linked by person-evidence to one of the proof's supporting
    assertions. With no starting tree, the line is omitted.
  - **A record's search** is the source's `log_entry_id` when that entry's tool is
    `record_search` or `fulltext_search`; otherwise one `recordSearch` call. A record
    whose source has an `image_filename` offers "See the page".
  - **A tree finding's record** comes from the fact's `assertion_id`, else the
    `sources[].ref` on the fact or relationship matched to a source's
    `gedcomx_source_description_id`; a relationship with neither takes the record of
    an assertion linked to both its persons. A finding with no record says so and
    offers no link.
  - **Real data is messy:** duplicate person-evidence links collapse to the
    strongest, duplicate `ParentChild` edges dedupe, dates in mixed formats normalize
    for display, and older document shapes are read, never repaired. Labels come
    from viewer-ui's `statusLabel`.
  - **A step card shows the current question's state for that step's concern,**
    not a diff of the turn. The documents carry no turn boundaries.
- **Links:** a capture-phase listener on `document` is the only opener for
  anchors. On `click` (and on `auxclick` only when `event.button === 1`) it calls
  `preventDefault()` and `stopPropagation()` on every `a[href]` and passes https
  links to `openLink`. A link in agent-written markdown therefore never replaces
  the card, and Linkify's own handler never fires a second open.
- **Theme:** the host's CSS variables, so light and dark follow Claude. Fonts
  inlined or the host's own.
- **viewer-ui edits, all additive:** exports, such as `statusLabel(value)` from
  `StatusBadge.tsx` and any leaf the case file reuses, and an optional `ViewerBody`
  prop that hides the header's Export GEDCOM, Print and Send Feedback buttons. Electron
  and the web app are unchanged.
- **Build:** `make mcp-viewer-build` builds the page and copies it to
  `packages/engine/mcp-server/viewer/page/viewer.html` (gitignored).

### Router lines

One line per stopping point in `skills/research/SKILL.md`: after the step report,
call `show_project` with the step and the `questionId` it worked on, then the reply.
The tool is found by bare name
(`+show_project` in ToolSearch). The bounded "where the project stands" row gains
the same call with `show: latest`, after its paragraph. M0 found that a status
question never loads the skill, so nothing reads that row's line until one does
(the record's **Variant line**).

- **Where they live:** on main, through issue #4297, which merges with the MCP App work
  before launch in one paid `research` eval run. Invited users get the zip
  `make plugin-connector` builds, and the acceptance run uses that zip on a new account.
- **For the demo,** a variant plugin may stand in: local branch
  `mcp-app-router-variant` at one pinned commit, built with
  `scripts/package-plugin.mjs` and installed on the lead's account.
- **Under Decision 3's fallback:** lines only for setup, search, conflict,
  hypothesis and conclusion, plus a link line only when the link step ends on a
  question for the researcher (no "Continue with …?" line).
- **Named next steps,** a trial for the demo. At the real forks, the "not
  exhaustive" choice and the conclusion, the variant asks through `AskUserQuestion`
  instead of writing the "Continue with …?" line: up to three concrete moves from the
  recorded leads plus the offered step, since the tool allows four options and adds
  "Other" itself. Each option's label is the move as a button reads ("Search the 1900
  census"), and its description the whole move, so what comes back is enough to act
  on. With fewer than two options, it keeps today's ending. The answer
  returns inside the turn and is treated as the
  researcher's reply; a move is a steer, which the router already turns into a plan
  item. Every other stop keeps its line. This does not ship from this plan: after the
  demo it goes to step mode as an issue, with what the demo showed.
- **A readable report** is one more line in the router's bounded-request list:
  "write this up" produces a Word or PDF file in the conversation from the proof summary, the
  family and the sources. It adds no claims and keeps the rating, any reviewer's
  verdict, what does not fit and what was not searched. No viewer code.

## Local testing

How everyone tests a change before it reaches anyone is in `DEVELOPMENT.md`,
"Testing a change before it reaches anyone". For this work:

- **The research:** the `.mcpb` lists neither tool and carries no page, because both
  are for the connector only.
- **The cards and the case file:** `make viewer PROJECT=<folder>` builds the page,
  runs the branch's server on `127.0.0.1` with `--local`, and opens a browser tab,
  reading the same folder the Cowork task writes. The tab shows every step card and
  the whole case file; reloading picks up the latest.
- **A card in Claude.** A tester's route to a card is the connector and the browser
  tab, and nothing depends on a local server. The tab runs the same page, and anything
  that depends on Claude as the host (fullscreen, theme, link confirmation) is checked
  on the `Genealogy Research` connector.

## Data

- **Tests:** the McAndrew capture (`docs/captures/2026-09-29-mcandrew-children`)
  and the committed e2e end states
  (`eval/runlogs/e2e/<fixture>/run-*.final-research.json` with its
  `.final-tree.gedcomx.json`), with `eval/tests/e2e/<fixture>/starting-tree.gedcomx.json`
  as the starting tree. The McAndrew capture and `william-ferber-ancestry` have
  none, nor do the three fixtures below, so Compare, the tree-change line and the
  grid's tree column are omitted for them. The capture and the end states have no
  `results/`, `images/` or `evaluations/`. The reviewer's notes are tested over the
  three fixtures that pair a research.json with an evaluation file:
  `eval/fixtures/scenarios/compound-objective-fully-covered` and
  `compound-objective-part-unframed`, each a live `proof-critique`, and
  `flynn-prior-craft-verdict`, a craft read. `recordSearch` is tested over the two
  compound fixtures, because Flynn has no `results/`.
- **The sweep:** `make mcp-viewer-sweep` is local, not CI, so a teammate's committed
  run can never red someone's PR. It stages each end state, and each of the three
  evaluation fixtures whole, in a temporary folder, runs the server to dump its
  `document` payload, renders the page over each, and fails if a compound fixture
  shows no notes or Flynn shows a verdict.
  Page tests in CI use a small committed fixture; `derived` is tested in
  `tests/viewer/` on a few named states.
- **The demo:** a fresh project the lead runs in Desktop Chat through the
  `Genealogy Research` connector, so its documents and images sit in Postgres and
  MinIO. A page is saved and attached to its record when the research reads it with
  `image_transcribe` and `projectPath`. A browsed page goes through record-structurer,
  whose `extraction_append` writes the source's `image_filename` and `transcription`. A
  held indexed record's page attaches through `extraction_append`'s
  `attachWaitingPages`. A record with no `image_ark` gets no page, and the sweep removes
  uncited images after 24 hours. So the demo's objective is chosen so that a deciding
  record has a page the research read, while others come from indexed searches. Before
  recording, the lead asks for a second opinion naming the
  proof, because the reviewer runs only when asked.

## Milestones

Each is one or more small PRs, and the lead merges them. Until the fold, nothing calls
the thin server, so merging changes nothing for anyone else. After it, the two tools
show only on the connector surface.

### Order

1. Sit with the lead and remote-server, and fill the answers that gate the fold
   (Decision 8). `projectPath` needs a `/proj_` value, so it waits for the next step.
2. Put a card on an OAuth connector, with `dev/probe-connector-server.ts`, and read
   `projectPath` and what the door's refusals do there. remote-server owns that file, so
   it gets the stub page first.
3. Fold a skeleton into the tool server once issue #3991 lands.
4. Build the demo scope (M1, M2 and M3).
5. Merge the router lines under issue #4297, with one paid `research` eval run, before
   launch. Until then the demo may run the variant plugin at a pinned commit.

### M0: Skeleton and host probe

The server with the page resource, `show_project` returning a hello card that
echoes its input and takes a `pad` size, `read_project_view` returning a payload
of a requested size, a signed test image, the request log, and `make viewer`, which
is the everyday development loop. Then, in Desktop Chat or claude.ai chat, wherever this
section says a Cowork task:

1. **Connector:** the server through the tunnel as an organization connector,
   from the main thread and after a ToolSearch load, then the sign-in probe with the
   variant plugin installed.
2. **Artifact:** a small artifact reading a whole document through the connector.

Record, in `docs/mcp-app-host-probe.md` (never the connector URL: the repo is
public):
- does a card render on each route; the client's declared extensions;
- what the page sees on each route: `typeof window.claude`,
  `typeof window.claude?.use` and `window.parent === window`;
- does Cowork offer fullscreen (`availableDisplayModes`), does it send
  `host-context-changed` on entering fullscreen and on the host's own close, can a
  card opened by a
  typed request go straight to it, does a mode switch remount the frame, and where
  does a typed card land while the file is fullscreen;
- does "where does the research stand?" call `show_project` with the variant's
  line; if not, the demo opens with "show me the project";
- **what the model receives:** different canary strings in `content`, in the
  result's `_meta` and (in one test call) in `structuredContent`, asking the model
  to quote each;
- does the card receive the result's `_meta`;
- does a tapped button make a hidden call, does that call prompt for approval, and
  does "always allow" stick on `show_project` and on `read_project_view`;
- the largest result accepted on mount (`pad`) and on a hidden call (400k, 1M, 2M
  characters), and what happens past it. If the largest project's research.json
  (1.55 MB) does not fit, `document` gains paging;
- does the image load from the declared host;
- does `openLink` open an https link from a card, and does the host ask first;
- is `ui/update-model-context` available;
- can a connector be turned off for one Cowork task (the help centre documents a
  per-conversation toggle);
- how `AskUserQuestion` shows named options in a Cowork task, and whether the
  chosen text comes back as the researcher's answer;
- does an artifact open beside a Cowork task, can it reach a `visibility: ["app"]`
  tool, does its `payload` carry a whole document, and does it load an image from
  `/img/<token>` (if not, `part: "image"` returns a data URL for it).

**Done when:** every item above has a recorded answer, and the server's tests
pass, each with a stub page HTML:
- `tools/list` carries `_meta.ui.resourceUri` on `show_project`,
  `visibility: ["app"]` on `read_project_view`, and `readOnlyHint: true` on both;
- `resources/read` returns the stub with `text/html;profile=mcp-app` and
  `contents[0]._meta.ui.csp.resourceDomains` containing the public origin;
- every path off the secret gets 404 except `/img/<valid, unexpired token>`; a
  bad or expired token gets 404;
- `part: "image"` refuses an `id` outside the image-ref pattern
  (`../research.json`, `research.json`, `images/x.png`), and `part: "results"` one
  outside the log-id pattern (`../.tree-before-forget.gedcomx`, `.staging/x`);
- refused: a project outside `--root`, a sibling whose name starts with the root's
  (`<root>-x/proj`), and a symlinked project folder pointing out of `--root`;
  accepted: the same project reached through a symlink to the root, which the test
  creates (CI runs Linux, where `/tmp` is no alias);
- an omitted `projectPath` resolves to `--root` when it is a project, and
  otherwise is refused with the list of folders;
- with `--local`, the page is served at `/<secret>/` with its CSP header and
  nowhere else, and without it that path is 404.

The page's own tests, with a fake `App`: it fetches at most once per mount, a
cancelled call paints no card, and a host that answers `requestDisplayMode` and never
notifies keeps the file open through a later resize notification. In a tab, `make viewer` paints a card from a real
project.

### M1: The first cards and `ViewerBody`

Built on the tool server after the fold, on Postgres and MinIO behind sign-in.

- The **setup, search and conclusion cards**, plus `latest`; until M2, planned
  shows setup and evidence-gathered shows search. The conclusion card's action is
  "Open the case file". It gains "Compare with FamilySearch" in M3, as one line
  counting the findings tagged New or Improved ("This research found 4 things that
  aren't on FamilySearch yet") that opens that page, and `latest` shows the same line.
- **The case file:** `ViewerBody` in fullscreen, fed by `McpAppResearchTransport`. A
  search's results open in its side panel, and Sources shows a record's page image
  and transcription.
- The display rules those need, including FamilySearch links.
- **The card kit,** which M2's cards are built on, so a card only composes:
  - the display rules, finished and tested, the FamilySearch link rules with their
    attack cases included, so a card calls them and never re-implements them;
  - a card shell that holds the host's height limit, light and dark, and the "Open
    the case file" button, and shared pieces: a person's name, a record link, a tier
    in words, a status label;
  - every card kind registered, M2's five as stubs, so a card's PR touches only its
    own file, its tests and its sweep coverage;
  - a checklist for a finished card: the sweep passes, screenshots in light and dark,
    the id check passes on its text, and no retired row shows.
- **A first live run,** signed in through the `Genealogy Research` connector, on a
  seeded project: a card, then the case file.

**Done when:**
- the first live run draws a card and opens the case file in claude.ai chat and Desktop
  Chat;
- `make mcp-viewer-sweep` renders the three cards and the case file over the McAndrew
  capture and every committed e2e end state without error;
- the case file shows no Export GEDCOM, Print or Send Feedback button;
- a planted retired assertion and retired link appear on no card;
- the id check passes on all rendered card text, and is shown failing on planted
  shapes (`S28` in a citation, `I19` in a name, an internal id inside a sentence, a
  raw `ark:/61903/…`, a bare `3:1:3QSQ-G9NW-8ZZC`, an unknown id-shaped token) and
  passing names and dates that contain digits; `1885-1910`, `Mary-Ann` and
  `full-text` render as text with no link, a record id links to its ARK,
  `(X8D9-HL9; parents: Peter Farber + Barbara Wilhelm)` with an unknown id renders as
  `(parents: Peter Farber + Barbara Wilhelm)`, and `(S28, S29)` leaves nothing;
- `(src_001/S26 and src_003/S28)`, `(pe_045–pe_049)` and
  `(pli_007 log_027–log_028, pli_010 log_031–log_034)` leave nothing,
  `(src_001/S26, child_1 role, assertions a_034–a_039)` renders as `(child_1 role)`,
  `born 1887 (S28).` renders as `born 1887.`, `born to I1 and I2` and `I4's birth fact`
  render the names, `I4 (John Vincent Mogan)` shows the name once, and the id check
  also fails on `src_003/` and on a rendered bracket holding no letter or digit;
- `(KWJ6-RPH)` in the compound proof links to the person page, `1:2:30` renders as
  text, `https://evil.example/ark:/61903/1:1:QPRC-WPBZ` stays whole with no "on
  FamilySearch" label, a tree source with an Ancestry url leaves its id removed with no
  link, and a tree source whose url's ARK ends in a tree person's id leaves that
  person's link unchanged;
- `https://familysearch.org.evil.example/en/wiki/X`,
  `https://www.familysearch.org@evil.example/en/wiki/X` and
  `https://evil.example/https://www.familysearch.org/en/wiki/X` get no "on
  FamilySearch" label, and a planted `![x](https://evil.example/a.png)` loads nothing
  in a tab;
- clicking a planted `[x](https://evil.example)` and a bare URL in a proof
  narrative, a Linkify URL in a research-log note, and an "Open in FamilySearch"
  button each produce exactly one `openLink` call with an https URL, none navigates
  the frame, and an `http:` source URL on the Sources button produces none;
- `McpAppResearchTransport` passes `assertTransportContract`, its `readSidecar`
  rejects when the call fails, it returns a non-null `label` for a project with no
  title, and a card from snapshot A opens a file showing document B.

### M2: The other step cards (before the demo)

Plan, link (with the identity question side by side when it asks one), conflict,
hypothesis, assess. Genealogists who take developer tasks build them, one issue per
card, labelled `genealogist` and `developer`, on M1's kit, and each card says what a
researcher needs to see at its step. A developer reviews the code and a genealogist
what the card says. One card goes first, plan or link, and its review tightens the
kit's checklist before the other four open. Until a card lands, `latest` shows a
neighbouring card, as in M1. The router gains its lines, or under
Decision 3's fallback only conflict, hypothesis and the conditional link line, and
the report line.

**Done when:** the sweep renders each card over the end states that reach that
step, the live run shows the cards its project reaches and a typed `show_project`
shows the others on a project that holds them, and "write this up" on the demo
project produces a file that carries the rating and the reviewer's verdict.

### M3: The new case file and the demo script (before the demo)

The new file replaces `ViewerBody`: its shell, right-hand pane and search box; The
case with So far, the evidence grid and Leads; Compare with FamilySearch; People,
Sources and Log; and `show_project` opening each page by id. A record's search results,
and its page image with transcription and findings, open in the pane.

- **The demo script,** in Desktop Chat, because Chrome on a tailnet
  device blocks page images, signed in through the `Genealogy Research` connector, on the
  demo project: "Show me the project" → the conclusion
  card with its recorded doubt → open the case file → the evidence grid → click an
  indexed record's column → the search that returned it, in the pane → click the
  browsed record's column → its page image beside the transcription → Compare with
  FamilySearch. Light and dark. Then a live run with the router lines calling the step
  cards and offering named next steps at the forks.
- A short screen recording of the demo script.

**Done when:** before recording, in the demo project, at least one supporting
assertion's source has an `image_filename` that exists under `images/` and a non-empty
`transcription`, at least one supporting assertion's `record_id` appears in the results
file of a `record_search` log entry under `results/`, and a live, non-refused evaluation
that is not a craft read targets the proof; the demo script runs end to end on the demo
project, signed in through the `Genealogy Research` connector; the sweep renders each
page without error, each renders on the demo
project, The case shows So far on a project with no proof summary, a planted retired
assertion and retired link appear nowhere, the id check passes on every page, every
one of today's 15 sections has its content reachable,
the reviewer's notes show on the two compound fixtures, the verdict alone shows
where the file is absent, and Flynn (`flynn-prior-craft-verdict`) shows no reviewer
verdict.

## Later

Fetching unsaved page images from FamilySearch; people labelled by relationship to
the signed-in user ("your great-grandfather"); a "Looks odd" check (better as an
engine check the agents also see); posting buttons of any kind; a ChatGPT plugin on
this same server.

## The fold

The two tools and the page move onto the tool server, behind the door.
`docs/specs/project-view-tools-spec.md` is the contract.

**Built so far:** the skeleton this section describes, with `derived` holding only
`folderName`. It passes the engine's tests on both store backends.
**Not yet:** no card has drawn through the door. That still needs a seeded test project
and sign-in (issue #3997). The rename to `Genealogy Research`, `derived` beyond
`folderName` and the `recordSearch` part are not built, and the door's 400, 403 and 503
are still HTTP refusals.

- **Where:** `src/tools/project-view.ts` holds the tools, the page's resource and the
  connector's context. `src/` cannot import `viewer/`, so `viewer/` keeps its entry and
  imports from `src/` for `make viewer`, adding only M0's probes.
- **Listing:** `createServer` lists `show_project` and `read_project_view` only when
  `principal.surface` is `"connector"`, so the `.mcpb`, the worker, Fly and the harness
  packaging stay untouched. The test is `principal.kind === "bearer"` and that surface,
  on dispatch as well as listing. `allToolSchemas`, `manifest.json` and the plugin
  hook's tool maps do not change. Every other surface gets the dispatcher's unknown-tool
  error. Every connector client gets the same list, whatever it declares: clients have
  differed in what they declare, and a host may share one `tools/list` per connector
  login.
- **Arguments:** `rejectUnknownArgs` skips a tool outside `allToolSchemas`, so the two
  tools keep their own unknown-argument check, which answers in plain text.
- **Capabilities:** on the connector surface alone, `createServer` gains the resources
  capability and handlers, and the extensions capability from `viewer/mcp.ts`. The door
  already passes any method on a valid token.
- **Reading:** `viewer/project.ts` stays out of `src/`: it imports `node:fs`, which
  the no-fs lint forbids. The tools read through `ProjectStore` by `/proj_` id. A call
  that names no project gets a tool error naming `project_list`, and the tool
  descriptions say so in
  place of the `--root` rule.
- **The page:** the tools Dockerfile gains a pnpm stage that builds it. It sits beside
  `build/` in the image, not in `config/`, so the `.mcpb` does not carry it. The tool
  server reads it through `src/utils/bundled-data.ts`, when a host asks for it.
- **Large results:** both servers share the rule. `show_project` leaves the documents
  out above 1,000,000 bytes and keeps `derived` and `echo`, and the page's loader reads
  the id from that smaller `_meta`. The thin server adds `pad` after the cut, so M0's size
  probe still works.
- **Images:** `GET /img?t=<token>` is a branch in the door's `route()`. The token is an
  HMAC over the project id, the ref and the expiry, with no bearer, and it rides in the
  query because the edge logs `$uri`. `createServer` signs and the door verifies, so they
  share one key, per process, and a restart voids every link. The door reads the image
  through a store it binds from the token's project id. A bad token or a missing image
  answers the door's ordinary 404, and a store failure answers 503.
- **Smoke and tests:** `make engine-smoke-http` lists tools through the connector door
  by default, so `dev/smoke-calls.ts` has rows for the two tools, marked `connectorOnly`,
  and `assertCoverage` fails if the connector lacks them or anyone else has them.
  `tests/http/http-server.test.ts` changes with them. The manifest's dispatch test does
  not, because the dispatch chain holds no literal of either name. The moved code runs on
  both store backends.
- **A spec and the catalog:** `docs/specs/project-view-tools-spec.md`, and a connector-only
  section in `docs/catalog.md`.
- **Test projects:** seed them with `dev/seed-project.ts` and set `owner_id`, because
  the door refuses a NULL owner. The script takes no owner yet. remote-server owns the
  seed route, which follows issue #3997.
- **Never touch Tailscale or Funnel on the self-hosted server.**

**Done when:** a card draws in claude.ai chat and Desktop Chat, signed in
through `Genealogy Research`, on a seeded project; the worker's and the `.mcpb`'s tool lists hold neither tool; and
a signed image link serves a page from MinIO. Sign-in itself needs issues #3992 and
#3997 as well as #3991. `Genealogy Viewer` then retires.

### Interface with remote-server

- Tool names, args and `_meta` stay as in M0, except M0's probe inputs, `pad` and
  `structuredCanary`, which the tool server does not accept.
- `projectPath` is the project's database id, the `/proj_<16 hex>` value from
  `project_list`, and the card passes it to `read_project_view`. Every `show_project`
  result carries it in `_meta`, so the card has it even with no tool input.
- There is one public origin, `WEB_PUBLIC_URL`. The page's `resourceDomains` and every
  image link use it. `projectUrl` goes away.
- The edge carries `location = /img { proxy_pass $tools_upstream; }`
  (`apps/server/proto/malachi/nginx.conf`): an exact path, with the token in the
  query.
- A tool error reaches the card as text. A 401 stays HTTP, because that is what brings
  up Claude's Reconnect card (and makes it refresh, where a refresh token exists). Whether the door's 400, 403 and 503 become tool errors on the connector
  path is now due: the record's **Door refusals** shows our text survives a 400 and is
  replaced on a 403 and a 503.
- Later, `show_project`'s `_meta` carries `session: {signedIn, url}` for a sign-in
  banner. A sign-in link in a tool's message is not clickable in a Desktop Chat reply,
  and Claude may caution against opening it (the beta plan's P0.2 item 10), so the
  banner would give a clickable button. Until it has a milestone, the link in the
  tool's message is the beta's route.

### Who edits which file first

- `src/http-server.ts`: remote-server first (issue #3991), then this work adds `/img`.
- `src/server.ts` and the tools Dockerfile: this work.
- Compose, nginx, `src/auth/config.ts` and `src/hosted-config-env.ts`: remote-server.
  This work asks it to add `/img` to the edge.
- The plugin's research `SKILL.md`: last, under issue #4297.

## After the demo

- **Packaging:** build the page into `eb-tools.zip`, and the release smoke checks
  `resources/read`.
- **Electron and the web viewer:** removing them is the lead's call after the demo. It
  needs:
  - **Local folders:** `make viewer` covers anyone testing a branch, and everyone
    else is on the remote connector.
  - **`make e2e-view`** becomes `make viewer PROJECT=eval/e2e-view`.
  - **Windows:** `eval/Viewer.bat` and `ViewE2E.bat` switch from Electron to the
    same thing, staying on `EVAL_OWNED` in `windows-wrappers.test.ts`.
  - **Print and GEDCOM export** go with them. The card's sandbox allows neither on its
    own; claude.ai and Desktop Chat offer the host's `downloadFile`, and the iPhone app
    does not (the record's host capabilities).
