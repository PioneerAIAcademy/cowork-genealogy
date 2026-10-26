# `project_list` — which projects this server keeps — Spec

> **Status:** New (2026-10-26). The folder and single-project modes are built.
> The signed-in user's listing (§2.3) is the contract the remote MCP server
> must serve; until it does, the research suite's hosted tests serve it from
> fixtures.

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
active `ProjectStore`'s `listProjects()`.

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
caller to pass the working folder's absolute path as `projectPath` and read what
it holds with `project_context`.

### 2.3 Hosted mode

The store names the paths the caller may use. Each path that holds a
`research.json` is listed as a project; the first that holds none is returned as
`newProjectPath`. A document that does not parse lists its project with `null`
fields rather than failing the call.

- **A store bound to one project** (the prototype worker's `PgS3ProjectStore`,
  bound per request by `X-Genealogy-Project-Id`) names its anchor. The anchor is
  listed once it holds a `research.json`, and is the `newProjectPath` until then.
- **The signed-in user's listing.** A server that admits a user to many projects
  names each project the user owns that holds a `research.json`, plus one fresh
  path, `/proj_<16 lowercase hex>`, that no project uses yet. The first write to
  the fresh path makes the caller its owner.
- **A shared server's unbound store** rejects, so a request that names no
  project gets the dispatcher's `isError` answer with that store's message.

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
- `dev/smoke-calls.ts` — the stdio smoke expects folder mode; the HTTP smoke
  expects the project its earlier `project_create` row wrote to be listed.
- `eval/tests/unit/research/` — the router's hosted routes, served by the
  `project-list-hosted-*` fixtures.
