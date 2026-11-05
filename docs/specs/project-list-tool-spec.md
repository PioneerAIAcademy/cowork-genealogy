# `project_list` — which projects this server keeps — Spec

> **Status:** Built, in all three modes: folder, a store bound to one project,
> and the signed-in user's listing (§2.3) on the connector door. The research
> suite's hosted tests serve the listing from fixtures.

```
project_list({}) -> { mode, projects?, truncated?, newProjectPath?, message }   (read-only)
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
    objective: string | null,         // research.project.objective, verbatim unless bounded (§2.3.1)
    subjects: [{
      id: string,                     // each research.project.subject_person_ids entry
      name: string | null,            // that tree person's preferred name, "Given Surname"
    }],
    moreSubjects?: number,            // subjects a bounded entry left out; absent when none were
    status: string | null,            // research.project.status
    updated: string | null,           // research.project.updated
  }],
  truncated?: true,                   // more projects exist than are listed; absent when all are
  newProjectPath?: string,            // where a new project goes; absent when none can be started
  message: string,                    // what to pass as projectPath, and whether the list was cut
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
fields rather than failing the call, as an absent `tree.gedcomx.json` does; a read
that fails any other way fails the call, because `null` fields read as a project
about nobody.

- **A store bound to one project** (the prototype worker's `PgS3ProjectStore`,
  bound per request by `X-Genealogy-Project-Id`) names its anchor. The anchor is
  listed once it holds a `research.json`, and is the `newProjectPath` until then.
  Its entry is verbatim: one project is one read.
- **The signed-in user's listing.** A connector call naming no project names the
  newest projects the user owns that hold a `research.json`, newest document first
  and bounded as §2.3.1 says, and only ids of the door's `/proj_<16 lowercase hex>`
  shape, then one fresh path of that shape that no project uses yet. A fresh path
  reads as an empty project
  (`project_context` answers `reason: "no_project"`), and the first write to it,
  a staged read included, makes the caller its owner. An id claimed that way and
  still holding no `research.json` is not listed, so it never displaces the fresh
  path. A failed listing is the dispatcher's `isError`, never an empty list. Every
  other project tool on such a call still rejects with the connector's message.
- **A shared server's process store** is unbound: anything that runs outside a
  request's binding rejects with that store's message.

#### 2.3.1 Bounds on the signed-in user's listing

Any signed-in account can reach this listing on the shared tool server, and nothing
caps how many projects it owns or how long an objective is, so the listing bounds
itself:

| What | Bound | Why this value |
|---|---|---|
| Projects listed | 100, newest document first (`MAX_LISTED_PROJECTS`, a `LIMIT` on the query) | A project is hours of work on one person: one new project every day takes over three months to reach it. |
| `objective` | 400 characters (`MAX_OBJECTIVE_CHARS`) | Above the longest in the eval corpus (341 of 602; median 124), so only an abuse is cut. |
| `subjects` | The first 5 (`MAX_LISTED_SUBJECTS`) | The corpus has none above 2. |
| A subject's `id` and `name`, `status`, `updated` | 100 characters (`MAX_FIELD_CHARS`) | The validator bounds neither a subject id nor a name, and the entry's bound should not rest on it for the other two. |

A cut text ends in `…`. What it keeps is a copy, because a V8 slice keeps its whole
parent string alive: with a plain `slice`, each of the 100 entries holds its full
objective until the call returns, and the bound frees nothing. A surrogate pair the
cut splits becomes U+FFFD, because half a pair is invalid in the JSON a client sends
on to its model. `moreSubjects` counts the subjects left out.

When the user owns more than the limit, the query's extra row sets `truncated: true`
and `message` adds that more projects exist, the most recently updated come first,
and a person none of them is about may already have one, so ask the researcher before
starting a new project. The flag comes from the query, not from the number of paths
left after the door's shape filter: a listing shortened by that filter still says so,
and never says "No project yet". There is no way to page past the limit; a project
beyond it is still reachable by its `projectPath`.

A listing holds one project's documents and one pool connection at a time, and its
answer is a few hundred kilobytes at most. It still reads each listed project's whole
`research.json` and `tree.gedcomx.json`, three sequential queries a project with the
`exists` check, because `ProjectStore` reads whole documents and a narrower read would
be new surface on every backend. The limit is what bounds that work.

A client that disconnects ends the listing at its next read: the store rejects, so the
loop stops rather than answering short.

### 2.4 How the research router uses it

The router calls `project_list` first when the conversation names no
`projectPath`. In folder mode it routes the working folder. In hosted
mode it continues the listed project whose subject or objective the message
names, starts a new project at `newProjectPath` for a person no listed project is
about, and otherwise lists the projects and asks which one to continue. On a
`truncated` listing it follows `message`: it asks before starting a new project,
because the person may be in a project the list left out. With no
`project_list` tool at all (an expired connector sign-in, or a desktop extension
older than this tool), it says the genealogy tools are not connected and stops.

## 3. Tests

- `tests/tools/project-list.test.ts` — folder mode on the process store, with no
  `projects` key; a bound
  store with a project, with none yet, and with a document that does not parse;
  a read that fails other than by absence; an unbound store's rejection. The user
  listing's bounds at and past each limit, a cut objective's text released from the
  heap, a surrogate pair at the cut, `truncated` with and without projects, a read
  stopped by an abort, and a bound store left verbatim.
- `tests/http/http-server.test.ts` — the connector's listing over a file double:
  the caller's paths and one fresh path, a caller with none, an id of another
  shape, `truncated` surviving the shape filter, a failed query, a failed document
  read, a client disconnecting mid-listing, and a project tool naming no project
  querying nothing.
- `tests/store/project-store.test.ts` — the owned-projects store's reads rejecting
  once its signal aborts.
- `tests/http/http-server-pg.test.ts` — three projects newest first in no id order
  and another user's never, an ownerless project and a claimed id left out, a user
  exactly at the listing limit and one past it, and
  `project_list`, `person_read`, `project_create`, `project_list` end to end.
- `dev/smoke-calls.ts` — the stdio smoke expects folder mode; the HTTP smoke
  expects the project its earlier `project_create` row wrote to be listed, and
  the connector pass a fresh `newProjectPath` beside it.
- `dev/smoke-http.ts` — the connector pass seeds the caller's second project and
  another user's, and requires both of the caller's, a fresh path, and not the
  other user's.
- `eval/tests/unit/research/` — the router's hosted routes, served by the
  `project-list-hosted-*` fixtures.
