# Project View Tools: Spec

Two MCP tools and one page resource that draw a research project inside Claude.
`show_project` puts a card in the conversation, and the card is the page
`ui://genealogy/viewer.html`, which `read_project_view` feeds.

| Tool                | Called by               | Data travels in      | What it does                                        |
|---------------------|-------------------------|----------------------|-----------------------------------------------------|
| `show_project`      | the model               | the result's `_meta` | Shows the researcher a card of the project          |
| `read_project_view` | the page, not the model | `structuredContent`  | Gives the page one part of the project as it is now |

Both are read-only and make no FamilySearch call. Both are **connector-only**: they
exist for a caller on the remote connector and for no other surface.

Code: `packages/engine/mcp-server/src/tools/project-view.ts`, the signed links in
`packages/engine/mcp-server/src/utils/image-tokens.ts`, the listing in
`packages/engine/mcp-server/src/server.ts` and the image route in
`packages/engine/mcp-server/src/http-server.ts`.

---

## Who sees them

`createServer(principal)` tests `principal.kind === "bearer"` and
`principal.surface === "connector"` once per request. Listing, dispatch, capabilities
and the resource handlers all read that one answer.

| Surface | `tools/list` | `tools/call` on either tool | `initialize` capabilities | `resources/list`, `resources/read` |
|---|---|---|---|---|
| Connector | `allToolSchemas` and the two tools | runs | `tools`, `resources`, `extensions` | answered |
| Worker, and `LOCAL` (the `.mcpb`, both harnesses, the Fly alpha) | `allToolSchemas` | JSON-RPC error `Unknown tool: <name>` | `tools` only | `-32601` |

`extensions` is `{ "io.modelcontextprotocol/ui": { "mimeTypes": ["text/html;profile=mcp-app"] } }`.

Neither tool is in `allToolSchemas`, so neither is in `manifest.json`, in the plugin
hook's tool maps, or in the `tools` count `/healthz` and `/livez` report.

Every connector client gets the same list, whatever it declares: a host may share one
`tools/list` per connector login.

---

## Input

Argument names are camelCase. Each tool checks its own arguments, because
`rejectUnknownArgs` skips a tool outside `allToolSchemas`. Arguments are checked before
the project is resolved, so a call with both faults reports the argument.

### `show_project`

```typescript
{
  show: "setup" | "plan" | "search" | "link" | "conflict" | "hypothesis"
      | "assess" | "conclusion" | "latest" | "file";    // required
  projectPath?: string;                                 // see "projectPath"
  page?: "case" | "compare" | "people" | "sources" | "log";
  questionId?: string;
  logId?: string;
  personId?: string;
  planItemId?: string;
  sourceId?: string;
}
```

`show` picks the card: a step, `latest` for where the research stands, or `file` for
the case file. `page` and the five id arguments say what the page opens. The server
checks their types and echoes them, and selects nothing by them.

### `read_project_view`

```typescript
{
  part: "document" | "results" | "image";   // required
  projectPath?: string;                     // see "projectPath"
  id?: string;                              // required for results and image
}
```

| `part` | `id` |
|---|---|
| `document` | Ignored. |
| `results` | A log id, matching `^log_[a-zA-Z0-9_-]+$`. |
| `image` | An image ref, matching `^images/[A-Za-z0-9._-]+\.jpg$` (`IMAGE_REF_PATTERN`). |

### `projectPath`

The `/proj_<16 hex>` value from `project_list`. The schema leaves it optional, so a call
that names none reaches the tool and gets the refusal that names `project_list`.

- The door reads `arguments.projectPath`, checks its shape and its owner, and binds the
  store to it. A call that names none runs on the door's store-less path.
- `resolveProject` accepts only a path `classifyProjectPath` calls `"project"`. A fresh
  id from `project_list` holds no document yet, so it is refused too. Neither tool
  writes, so a refused call leaves no `projects` row.
- `derived.folderName` is `basename(path)`, so `proj_<16 hex>` here.

### The tool definitions

Both carry `annotations: { readOnlyHint: true }` and
`inputSchema.additionalProperties: false`, and both descriptions end with the project
rule: `A project's /proj_<16 hex> projectPath, from project_list. A call that names none is refused.`

| Tool | `title` | `_meta` |
|---|---|---|
| `show_project` | `Show project` | `{ "ui": { "resourceUri": <the page URI> }, "ui/resourceUri": <the page URI> }`, the URI under "The page resource" |
| `read_project_view` | `Read project view` | `{ "ui": { "visibility": ["app"] } }` |

`show_project` carries both keys because a host may read either.

---

## Output

### `show_project`

```typescript
{
  content: [{ type: "text", text: "The researcher sees the <show> card; do not restate it." }];
  _meta: {
    "genealogy/project": {
      research: object;              // research.json
      tree: object | null;           // tree.gedcomx.json
      startingTree: object | null;   // starting-tree.gedcomx.json
      collections: object | null;    // external-collections.json
      derived: Derived;              // below
      echo: object;                  // the call's arguments, projectPath included
    };
  };
}
```

There is no `structuredContent`. `content` is one line for the model, and the documents
reach the card only through `_meta`.

| Field | When it is `null` |
|---|---|
| `tree` | The file is absent. A file that does not parse is a refusal. |
| `startingTree` | The file is absent, unreadable or not an object. |
| `collections` | The file is absent, unreadable or not its shape. It is background reading, so a bad file does not cost the card. |

`research` is never `null`: a project with no `research.json` is a refusal.

### `derived`

What only the engine computes, from the documents above (`deriveProject`):

```typescript
{
  folderName: string;                       // basename of the project path
  questions: QuestionStatus[] | null;       // questionStates(research, tree)
  awaitingUser: AwaitingHandOff[] | null;   // awaitingUserHandOffs(research.log)
  treeChanges: TreeDiffResult | null;       // treeDiff(startingTree → tree); null with no starting tree
  evaluations: { [evaluationId]: { body: object | null; craft: boolean } };
}
```

- `evaluations` has one entry per evaluation whose `superseded_by` is null. Its `body` is
  the parsed `file_path`, read only when that path matches
  `^evaluations/[A-Za-z0-9._-]+\.json$`; a path that does not, or a file that cannot be
  read, gives `body: null`. `craft` is `body.craft === true`, so an unreadable body is not
  craft, as gps-mentor counts it.
- `questions`, `awaitingUser` and `treeChanges` are each `null` when computing that field
  throws on a malformed document, so the card still draws.

### The 1,000,000-byte rule

`MAX_META_BYTES` is `1_000_000`. `show_project` measures the whole
`"genealogy/project"` entry, as `Buffer.byteLength(JSON.stringify(entry), "utf8")`, so
the limit counts bytes of compact JSON and not characters.

| Size of the entry | `_meta["genealogy/project"]` |
|---|---|
| 1,000,000 bytes or fewer | The whole entry above. |
| 1,000,001 bytes or more | `{ derived, echo }` only. |

The result is the same in every other way: `content` keeps its one line and `isError`
stays unset. `echo` keeps `projectPath`, because a card with no tool input has no other
way to learn the id.

The rule exists because a host drops `_meta` whole and with no error at that size: it
arrived at 999,947 bytes and did not at 1,299,948 (`docs/mcp-app-host-probe.md`).

### `read_project_view`

`content` is always `[{ type: "text", text: "ok" }]`.

| `part` | `structuredContent` |
|---|---|
| `document` | `{ research, tree, startingTree, collections, derived }`, as `show_project` reads them. No `echo`, and no size rule. |
| `results` | `{ found: true, results }`, the parsed `results/<id>.json`, or `{ found: false }` when that file is absent. `found: false` is an answer, not an error. A results file the store holds but cannot read is a refusal, never `found: false`. |
| `image` | `{ url, expiresAt }`: a signed link and its expiry in epoch milliseconds. See "Images". |

---

## The page resource

| | |
|---|---|
| URI | `ui://genealogy/viewer-<12 hex>.html`, the first 12 hex of the page's sha256 (`pageUri`); `ui://genealogy/viewer.html` when no page is installed |
| MIME type | `text/html;profile=mcp-app` |
| `resources/list` | `{ resources: [{ uri, name: "Genealogy Viewer", mimeType }] }` |
| `resources/read` | `{ contents: [{ uri, mimeType, text, _meta: { ui: { csp: { resourceDomains } } } }] }` |

`resourceDomains` is `[<origin>]`, where the origin is `webPublicUrl` trimmed with no
trailing slash (`webPublicBase`), and `[]` when `webPublicUrl` is unset.

The text comes from `viewerPagePath()` in `src/utils/bundled-data.ts`, which resolves
`../../viewer/page/viewer.html` from `src/utils/` and from `build/utils/` alike. It is
read on `resources/read` and never at start-up. The tools image carries the page, from
the `page` stage of `apps/server/proto/tools/Dockerfile`. The `.mcpb` and `eb-tools.zip`
do not.

Claude caches a page per URI, so the URI carries a hash of the page: a deploy or a
rollback that changes the page lists a new URI, and `show_project`'s `_meta` (`pointAtPage`)
and `resources/list` name it on every request. `resources/read` accepts the plain URI and
any `viewer-<12 hex>` version, serves today's page under the URI it was asked for, and
refuses any other URI.

A server with no page keeps running and answers `resources/read` with the error below.
The next request answers normally.

---

## Images

### Signing

`read_project_view` with `part: "image"` checks `id` against `IMAGE_REF_PATTERN`, then
resolves the project, then signs. It signs without checking that the image exists: the
route answers that.

The link is `<origin>/img?t=<token>`, from the same origin as `resourceDomains`. With
`webPublicUrl` unset, the connector has no `signImage` and the call is refused.

| | |
|---|---|
| Token | `<base64url of the claim>.<base64url of its HMAC-SHA256>` |
| Claim | `{ project, ref, expiresAt }`, where `project` is the project id with no leading slash |
| Lifetime | 10 minutes (`IMAGE_TOKEN_TTL_MS`). Expired from `expiresAt` on. |
| Key | 32 random bytes per process (`processImageTokens`). `createServer` signs and the door verifies with it, so a link verifies only on the process that signed it, and a restart voids every link. |

The token rides in the query, because the edge logs `$uri` and no log line may carry a
live link.

### `GET /img?t=<token>`

A branch of the door's `route()`, ahead of its 404. It takes no bearer: the token is the
grant, and the owner check happened when `read_project_view` passed the door to sign it.
The route binds a store from the claim's project id, with anchor `/<id>`, no fence and no
`ownerId`, because it writes nothing.

| Request | Status | Body | Log |
|---|---|---|---|
| Good token, image held | `200` | The image's bytes | None |
| No `t`, an empty `t`, a bad signature or an expired token | `404` | `{"error":"Not found"}` | None |
| Any other method on `/img`, or any path below it | `404` | `{"error":"Not found"}` | None |
| Good token, and the store answers `ENOENT` or `ENOTDIR` | `404` | `{"error":"Not found"}` | None |
| Good token, and the store fails in any other way | `503` | `{"jsonrpc":"2.0","error":{"code":-32603,"message":"The page image is unavailable."},"id":null}` | `ev=image_failed error=<label>` |

Every `404` is the body an unknown path gets, so the cases cannot be told apart. The
`503` keeps an outage from reading as a missing image. `<label>` is the failure's `code`,
else its `name`, else `Error`, and never its message.

The `200` carries these headers:

```
Content-Type: image/jpeg
X-Content-Type-Options: nosniff
Cross-Origin-Resource-Policy: cross-origin
Cache-Control: private, max-age=<whole seconds until the token expires>
```

---

## Errors

### The tools

A refusal is a result, `{ content: [{ type: "text", text }], isError: true }`. The text
is plain, not the dispatcher's `{"error":...}` JSON, because a card shows it.

| Condition | Text |
|---|---|
| An argument the schema does not list | `<tool> has no argument <names>. It takes: <names>.` |
| `show` absent or not a listed value | `show must be one of: setup, plan, search, link, conflict, hypothesis, assess, conclusion, latest, file.` |
| `page` not a listed value | `page must be one of: case, compare, people, sources, log.` |
| An id argument that is not a string | `<name> must be a string.` |
| `part` absent or not a listed value | `part must be one of: document, results, image.` |
| `part: "results"` with a bad `id` | `With part results, id must be a log id such as log_001.` |
| `part: "image"` with a bad `id` | `With part image, id must be an image ref such as images/page.jpg.` |
| `part: "image"` with `webPublicUrl` unset | `This server has no route to page images.` |
| The call names no project | `This call named no project. Call project_list and pass one of its projectPath values.` |
| The path is not a project, a fresh id included | `No project is saved at this projectPath. Call project_list and pass one of its projectPath values.` |
| `research.json` is absent, or the store fails reading `research.json`, `tree.gedcomx.json` or a results file | `<file> not found in projectPath` |
| A document or results file that does not parse | `<file> is not valid JSON` |
| Any other store failure with a string `code`: classifying the project, or checking that a file exists | `The project could not be read just now. Try again.`, with one `ev=view_failed error=<code>` line and never the failure's message |
| Anything else | The failure's message |

### The door

These happen before any tool runs. A `401` and a `400` are HTTP refusals on `/mcp`, and a
card's call sees a failed request. A `tools/call` refused for the owner or the lookup is
answered `200` with a tool error under the call's own id, so the model and the card read
the door's message as text; a request with no tool call (`initialize`, `tools/list`, a
notification) keeps the status in brackets.

| Condition | Status | Message |
|---|---|---|
| No admitted connector token | `401`, with `WWW-Authenticate` | `Not authenticated. Sign in again to reconnect.` |
| `projectPath` is not a string, or not `/proj_<16 hex>` | `400` | `projectPath must be /proj_ followed by 16 lowercase hex characters.` |
| The project has another owner, or a NULL one | `200`, `isError` (`403`) | `NOT_YOUR_PROJECT_MESSAGE`: `This project is not yours, so this call did not run. Use a projectPath that project_list returns.` |
| The token or owner lookup fails | `200`, `isError` (`503`) | `AUTHORIZATION_UNAVAILABLE_MESSAGE`: `The server could not check this call just now, so it did not run. This is a temporary problem on the server, not a missing project and not a sign-in problem. Wait a moment and send the same call again.` |

### The page resource

| Condition | JSON-RPC error |
|---|---|
| `resources/read` on any other URI | `-32602`, `MCP error -32602: Unknown resource.` |
| No page on this server | `-32603`, `MCP error -32603: The viewer page is not installed on this server.` The message holds no path. |

---

## Auth

Neither tool calls FamilySearch or reads `getValidToken`. A caller needs only what the
connector door asks of every call: an admitted connector token and, for a named project,
ownership. The image route asks only for its token.

---

## What NOT to do

- Don't add either tool to `allToolSchemas`, `manifest.json` or the plugin hook's maps.
  That puts them on every surface.
- Don't vary the list by what a client declares.
- Don't write either name as a string literal in the `request.params.name === "..."`
  chain in `src/server.ts`. `tests/packaging/manifest.test.ts` reads every such
  comparison as a dispatch case and fails on a tool outside `allToolSchemas`.
- Don't sign before the `IMAGE_REF_PATTERN` check. `readBytes` can read documents, so
  that order is what keeps a token to images.
- Don't move the token into the path. The edge logs paths.
- Don't log a token, or a store failure's message, which can hold a DSN.
- Don't answer a store failure with a `404`.
- Don't build an image link or `resourceDomains` from the request's `Host`. Both come
  from `webPublicUrl`.
- Don't read the page at start-up on the tool server. A server without it must still
  serve every tool.
- Don't put the documents in `show_project`'s `content`. The model reads it.

---

## The thin server

`packages/engine/mcp-server/viewer/` runs the same core for `make viewer` and ships in
no artifact. `callProjectView`, the schemas and the 1,000,000-byte rule are shared. These
differ, and the tool server accepts none of them:

- `projectPath` follows the `--root` rule, and a call may omit it.
- `pad`, `structuredCanary` and the canary strings are its probes. `pad` is added after
  the cut, so the size probe still works, and `echo` keeps every argument.
- Its image route is `/img/<token>`, with its own key, and the claim's `project` is the
  path relative to `--root`.
- A failed call answers the failure's message, with the root's path taken out.
- It reads `viewer/page/viewer.html` once at start-up and refuses to start without it.
  `resources/list` and `resources/read` are always on.

---

## Downstream consumers

- **The page**, `apps/mcp-viewer/`. Its loader takes the first tool result. An entry
  holding `research` is the snapshot. An entry with no `research` is the large-result
  case: the card takes `echo` as its input if it has none, then makes one
  `read_project_view` call with `part: "document"`. It still draws the thin server's size
  buttons, which send `pad`, so on the tool server each answers the unknown-argument
  refusal.
- **The research router.** No skill or agent calls `show_project` yet.

---

## Test plan

- `tests/tools/project-view.test.ts`, on both store backends: the `_meta` shape; the cut
  on both sides of the line with a two-byte document, so bytes and characters differ;
  `echo` keeping `projectPath`; no project, a fresh id and a missing path each naming
  `project_list`; unknown arguments; each `part`; bad ids signing nothing; no `pad` or
  canary on any result.
- `tests/http/http-server.test.ts`, "the view tools, the page and /img: connector only":
  the list, capabilities and `resources/*` per surface; a worker's `Unknown tool`; the
  page present and absent; each `/img` row above; no token in the door's stderr.
- `tests/http/http-server-pg.test.ts`, "the connector door (E1)", on real Postgres and
  MinIO: `/img` returning the bytes written; one owner's token never returning another's
  same-named image; a good token with no blob row; another owner's `read_project_view`
  answering a tool error with `NOT_YOUR_PROJECT_MESSAGE` and signing nothing; `show_project` on a fresh path leaving no
  `projects` row.
- `tests/viewer/`: the thin server, with its probes.
- `make engine-smoke-http` and `make engine-smoke-stdio`: rows marked `connectorOnly` in
  `dev/smoke-calls.ts` assert the documents arrive on the connector and that neither tool
  is advertised anywhere else.
- `apps/server/tests/test_proto_config.py`: the tools image copies the page to where
  `viewerPagePath()` looks.
- No test draws a card. A card drawn in a real host, through the door, is the live check.
