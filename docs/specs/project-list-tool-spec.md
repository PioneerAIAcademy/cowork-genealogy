# `project_list` — which projects this server keeps — Spec

> **Status:** Built, in all three modes: folder, a store bound to one project,
> and the signed-in user's listing (§2.3) on the connector door. The research
> suite's hosted tests serve the listing from fixtures.

```
project_list({}) -> { mode, projects?, newProjectPath?, message }   (read-only)
```

---

## 1. Why this exists

Every project tool takes a `projectPath`. On the desktop extension that is the
task's working folder, which the conversation already knows. A hosted server has
no folder: its projects are rows, named by opaque ids the caller cannot guess.
The research router therefore needs one call, made before any other, that says
which of the two it is talking to and, when hosted, which projects the caller may
continue and where a new one goes.

## 2. The tool

```typescript
project_list({})
```

No parameters. Read-only: writes nothing, on any backend. The mode comes from the
active `ProjectStore`'s `listProjects()`. The function takes the call's principal as its last
parameter, for the entries' `projectUrl`; no entry carries one yet, because filling
it needs a map from each listed `projectPath` to its store's project id, which
no store keeps yet.

### 2.1 Return value

Wire-side **camelCase**:

```typescript
{
  mode: "folder" | "hosted",
  projects?: [{                       // hosted only
    projectPath: string,              // pass as projectPath to continue it
    objective: string | null,         // research.project.objective, verbatim
    subjects: [{
      id: string,                     // each research.project.subject_person_ids entry
      name: string | null,            // that tree person's preferred name, "Given Surname"
    }],
    status: string | null,            // research.project.status
    updated: string | null,           // research.project.updated
    projectUrl?: string,              // the project's viewer page, when the server knows its public URL
  }],
  newProjectPath?: string,            // where a new project goes; absent when none can be started
  message: string,                    // what to pass as projectPath, in one or two sentences
}
```

### 2.2 Folder mode

The file backend (the desktop extension and both eval harnesses) keeps each
project in a folder the caller names. It answers `mode: "folder"` and a message,
with no `projects` and no `newProjectPath`: an empty list there reads as "no
project" to a model that has not yet looked at the folder, and the research
suite's routing tests went red on exactly that reading. The message tells the
caller to pass the working folder's absolute path as `projectPath`, says that it
does not tell whether the folder holds a project, and has the caller call
`project_context` with that path before routing. At medium effort the router
otherwise skipped that read and sent an existing project to `init-project`.

### 2.3 Hosted mode

The store names the paths the caller may use. Each path that holds a
`research.json` is listed as a project; the first that holds none is returned as
`newProjectPath`. A document that does not parse lists its project with `null`
fields rather than failing the call.

- **A store bound to one project** (the prototype worker's `PgS3ProjectStore`,
  bound per request by `X-Genealogy-Project-Id`) names its anchor. The anchor is
  listed once it holds a `research.json`, and is the `newProjectPath` until then.
- **The signed-in user's listing.** A connector call naming no project names each
  project the user owns that holds a `research.json`, newest document first, and
  only ids of the door's `/proj_<16 lowercase hex>` shape, then one fresh path of
  that shape that no project uses yet. A fresh path reads as an empty project
  (`project_context` answers `reason: "no_project"`), and the first write to it,
  a staged read included, makes the caller its owner. An id claimed that way and
  still holding no `research.json` is not listed, so it never displaces the fresh
  path. A failed listing is the dispatcher's `isError`, never an empty list. Every
  other project tool on such a call still rejects with the connector's message.
- **A shared server's process store** is unbound: anything that runs outside a
  request's binding rejects with that store's message.

### 2.4 How the research router uses it

The router calls `project_list` first when the conversation names no
`projectPath`. In folder mode it routes the working folder. In hosted
mode it continues the listed project whose subject or objective the message
names, starts a new project at `newProjectPath` for a person no listed project is
about, and otherwise lists the projects and asks which one to continue. With no
`project_list` tool at all (an expired connector sign-in, or a desktop extension
older than this tool), it says the genealogy tools are not connected and stops.
A reply that ends the router's turn ends with the project's `projectUrl` when a
tool returned one.

## 3. Tests

- `tests/tools/project-list.test.ts` — folder mode on the process store, with no
  `projects` key; a bound
  store with a project, with none yet, and with a document that does not parse;
  an unbound store's rejection.
- `tests/http/http-server.test.ts` — the connector's listing over a file double:
  the caller's paths and one fresh path, a caller with none, an id of another
  shape, a failed query, and a project tool naming no project querying nothing.
- `tests/http/http-server-pg.test.ts` — two projects newest first and another
  user's never, an ownerless project and a claimed id left out, and
  `project_list`, `person_read`, `project_create`, `project_list` end to end.
- `dev/smoke-calls.ts` — the stdio smoke expects folder mode; the HTTP smoke
  expects the project its earlier `project_create` row wrote to be listed, and
  the connector pass a fresh `newProjectPath` beside it.
- `dev/smoke-http.ts` — the connector pass seeds the caller's second project and
  another user's, and requires both of the caller's, a fresh path, and not the
  other user's.
- `eval/tests/unit/research/` — the router's hosted routes, served by the
  `project-list-hosted-*` fixtures.
