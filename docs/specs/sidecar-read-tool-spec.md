# `sidecar_read` — paged read of a project sidecar text file — Spec

> **Status:** New (2026-09-14, `docs/plan/search-agent-prototype.md` D6–8, the
> `sidecar_read` half). Read-only sibling of `research_query`
> (`research-query-tool-spec.md`) and `project_context`
> (`project-context-tool-spec.md`): those two serve `research.json` and the
> tree; this serves the two project-file classes that had no MCP tool at all.

```
sidecar_read({ projectPath, ref, offset?, maxChars? })
  -> { ok: true, ref, totalChars, offset, content, truncated, nextOffset? }
   | { ok: false, reason: "no_project" | "invalid_ref" | "not_found" | "not_text", errors: string[] }
```

---

## 1. Why this exists

The hosted sandbox holds no project folder (`search-agent-prototype.md`, P2):
the agent reaches project state through MCP tools or not at all. Measured over
161 committed e2e runs and 4,950 `Read` calls (paths normalised `\` → `/`),
**three** read classes disappear with the directory:

- `<project>/results/**` — **226** reads. Already served host-side by
  `record_read({recordId, resultsRef})` and `rank_search_matches({resultsRef})`,
  and `search-records/SKILL.md` already says "Do NOT `Read` the sidecar file
  yourself". Those reads measure non-compliance with a shipped instruction, not
  a gap. **Not this tool's business.**
- `<project>/evaluations/**` — **64** reads. `evaluations[].file_path` is a
  required schema field naming the verdict body the gps-mentor wrote;
  `research_query({section: "evaluations", targetId, focus})` returns the entry
  but not the body. Without a reader, the documented fallback is to re-invoke
  `@plugin:gps-mentor` — every gated transition becomes a redundant paid
  delegation. **Unserved until this tool.**
- `<project>/uploads/**` — researcher uploads, the only way bytes enter a
  hosted session (`POST /api/sessions/{id}/files`). `image_read` and
  `image_transcribe` take an `imageId`/`ark`, never a path, so a **text** upload
  (a transcription, a CSV, a note) had no reader. **Unserved until this tool.**

`sidecar_read` is scheduled, not contingent: it exists for the two unserved
classes and nothing else (§6).

## 2. The tool

```typescript
sidecar_read({
  projectPath: string,   // required — the project directory
  ref: string,           // project-relative POSIX path under evaluations/ or uploads/
  offset?: number,       // UTF-16 code-unit offset, integer ≥ 0, default 0
  maxChars?: number,     // page size, default 40,000, hard cap 40,000 (clamped)
})
```

Read-only; writes nothing. No auth, no network, no `Principal` parameter —
exactly the shape of `research_query`. Parameters are camelCase (the wire
surface); the file content is returned verbatim.

The tool, its `sidecarReadSchema`, and its `SidecarReadInput` /
`SidecarReadResult` types all live in
`packages/engine/mcp-server/src/tools/sidecar-read.ts`. There is no
`src/types/sidecar-read.ts`: the shapes have one consumer and no upstream API
response to mirror.

### 2.1 Return value

```typescript
{
  ok: true,
  ref: string,          // the ref as validated (echoed back)
  totalChars: number,   // length of the decoded file in UTF-16 code units (after BOM strip)
  offset: number,       // the offset this page starts at
  content: string,      // text[offset, offset + page)
  truncated: boolean,   // offset + content.length < totalChars
  nextOffset?: number,  // offset + content.length — present only when truncated
}
```

An `offset` at or past `totalChars` returns `content: ""`, `truncated: false`
and no `nextOffset` — a legitimate empty page, not an error.

## 3. Ref rules

`ref` is accepted **positively**: a prefix, then one or more segments separated
by `/`. Every segment is non-empty, is not `.` or `..`, and contains no `/`,
`\` or NUL. Any other character is allowed — upload names carry spaces and run
to 121 characters (`_UPLOAD_NAME_RE` in `apps/server/app/sessions.py`). The
two prefixes are `evaluations` and `uploads`.

Nesting is allowed under both. `evaluations[].file_path` is a free string
(schema `"type": "string"`; the validator checks presence only), and a desktop
user can create `uploads/scans/` by hand.

Rejected as `invalid_ref`:

| Shape | Example |
|---|---|
| absolute path | `/etc/passwd`, `C:/x` |
| backslash anywhere | `uploads\notes.txt` |
| a `.` or `..` segment | `uploads/../research.json` |
| an empty segment | `uploads//x.txt`, `uploads/`, a trailing `/` |
| any other prefix | `research.json`, `tree.gedcomx.json`, `results/log_001.json`, `images/x.jpg`, `notes.txt` |
| a ref that names a directory | `evaluations` (bare), `uploads/scans` when `scans` is a directory |

The message for a rejected prefix names the tool that serves that class:
`research.json` and the tree → `research_query` / `project_context`;
`results/` → `record_read` / `rank_search_matches`; `images/` → `image_read`.

The store's `assertInsideProject` (`src/store/paths.ts`, run by
`FsProjectStore.abs` on every ref) is the **second** line against a traversal
in the ref string. The tool's own check runs first so an escape is reported as
`invalid_ref`, never as `not_found`, and never reaches the store at all.

A **symlink** is a different escape: `uploads/link.txt → /etc/hosts` is a clean
ref, and `assertInsideProject` reasons about the string, so it resolves
"inside". `FsProjectStore.readText` therefore re-checks containment on the
**real path** (both the file and the project root realpath'd) and throws
`escapes the project directory (through a symlink)` — a plain `Error`, so the
dispatch arm goes loud; the tool never returns the target's bytes. A symlink
that stays inside the project is followed: a user-made `uploads/rj.txt →
../research.json` reads `research.json`, because the prefix routing is a
pointer to the better tool, not a boundary — every in-project file is already
readable through some tool. §8.

## 4. Pagination and the serialized-envelope bound

`maxChars` defaults to 40,000 and is **clamped** to 40,000 — a larger value is
not an error. But the bound that matters is not on `content`; it is on the
**serialized envelope**. `writerToolResult` does `JSON.stringify(result)`,
which escapes every `"`, `\` and control character, and the CLI spills any tool
result above 50,000 characters to a file the model must `Read` back — a file
that, on a resumed turn, is rmtree'd at turn end (P2, "Two corrections on the
spill"). Measured: 40,000 raw characters of quoted CSV serialize to 48,013;
40,000 double-quote characters serialize to 80,002.

So the page is built in three steps:

1. `page = text.slice(offset, offset + maxChars)`.
2. Shrink `page` from the end until its JSON-escaped body —
   `JSON.stringify(page).length − 2`, the two wrapping quotes excluded — is
   `≤ 40,000`. Plain text needs no shrink, so a plain-text page is exactly
   `maxChars`; each step cuts `ceil(over / 6)` code units (a character escapes
   to at most six), so a step can never overshoot to an empty page and
   `nextOffset` always advances.
3. If `page` now ends on a high surrogate (U+D800–U+DBFF) **and the next code
   unit of the text is a low surrogate** (U+DC00–U+DFFF) — that is, the cut
   would split a pair — move the boundary: back by one unit when the page is
   longer than one unit; **forward** by one unit, taking the whole pair, when
   the page is that single high surrogate (`maxChars: 1`, or an offset
   landing on the pair). Backing off there would leave `content: ""` with
   `nextOffset === offset`, and a caller paging "until `truncated` is false"
   would never terminate. In that one case `content` is one unit longer than
   `maxChars`. A lone high surrogate with no low surrogate after it is not a
   pair and is returned as it stands.

**Invariant:** for any `offset < totalChars` the page is non-empty, so
`nextOffset > offset` and paging terminates.

`truncated = offset + page.length < totalChars`; `nextOffset = offset +
page.length` when truncated. The envelope's other fields add a few dozen
characters, so the whole serialized result stays under ~41,000 and is never
spillable. A caller pages by passing `nextOffset` back as `offset` until
`truncated` is false.

`offset` is a UTF-16 code-unit index, the same unit `content.length` and
`totalChars` are measured in, so `offset + content.length` is always the right
next page. The tool does not adjust the **start** of a page: a caller that
invents an offset landing on a low surrogate gets that stray unit as the first
character. A caller that only ever passes back `nextOffset` never does.

## 5. Decoding and `not_text`

The file is read as UTF-8 through `getProjectStore().readText(projectPath,
ref)`. A leading U+FEFF (BOM) is stripped before anything is measured.

The tool refuses non-text as `not_text` when either holds:

- any U+0000 in the decoded text (UTF-16 text, and most binaries, hit this);
- U+FFFD (the replacement character Node substitutes for an invalid UTF-8
  sequence) in more than **max(1, 1%)** of the first 8,192 characters (a JPEG
  or PDF header hits this even where it carries no NUL).

Message: "binary or non-UTF-8 text (a PDF, an image, or UTF-16 — re-save as
UTF-8); `image_read`/`image_transcribe` read a FamilySearch scan by imageId or
ark and take no path, so neither can read this file". The 1% sample rule,
not a zero-tolerance one, so a UTF-8 file with one damaged byte still reads.
The floor of one is what makes that true below 100 characters, where 1% is
under one: a single U+FFFD — one damaged byte in a short note, or the literal
character (bytes `EF BF BD`) in valid UTF-8 — never trips the rule, whatever
the file's length. Two in a short file still do.

## 6. Errors

| Condition | Result |
|---|---|
| `projectPath` absent / not a string | **throws** `projectPath is required` → the dispatch arm's `catch`, `{ error }` with `isError` |
| `projectPath` is not an existing directory | **throws** `projectPath does not exist: <path>` → same |
| `projectPath` is a real directory holding **neither** project file | `{ ok: false, reason: "no_project", errors: [NO_PROJECT_MESSAGE_READ] }` — an answer, not a failure; `writerToolResult` leaves `isError` unset — the no-project contract `noProjectResult` in `utils/project-io.ts` owns, shared with `research_query` |
| `offset` present and not a non-negative whole number — including a string `"50"` | **throws**, not coerced (mirrors `research_query`) |
| `maxChars` present and not a positive whole number | **throws**, not coerced |
| `maxChars` a finite whole number above 40,000 | clamped to 40,000, no error |
| `ref` fails §3 | `{ ok: false, reason: "invalid_ref", errors }` |
| `ref` names a directory (`EISDIR`) | `{ ok: false, reason: "invalid_ref", errors }` — "names a directory" |
| `ref` is longer than the filesystem allows (`ENAMETOOLONG` — a segment over 255 bytes, or the whole path over the platform limit) | `{ ok: false, reason: "invalid_ref", errors }` — no file can have this name |
| `ref` is absent (`ENOENT`), or a segment of the path is a regular file (`ENOTDIR`) | `{ ok: false, reason: "not_found", errors }` — the message says where a ref comes from (verdict paths from `research_query({section: "evaluations"})`'s `file_path`; uploads named in the conversation by the researcher) and that this tool does not list directories |
| the file is binary / non-UTF-8 (§5) | `{ ok: false, reason: "not_text", errors }` |
| the file exists but cannot be read (`EACCES`, …), or is not a regular file (a FIFO, a device node) | **throws** → the dispatch arm's `catch`, loud. Never `not_found` |
| `offset ≥ totalChars` | `{ ok: true, content: "", truncated: false }` |

The classification order is: argument validation (throws), then §3 ref
validation, then `classifyProjectPath` exactly as `readProjectJson` does
(`missing_arg` → throw `MISSING_PROJECT_PATH_MESSAGE`; `missing_dir` → throw
`missingProjectDirMessage(projectPath)`; `no_project` →
`noProjectResult("read")`). The two message helpers are imported from
`utils/project-io.ts`, never re-phrased — `single-project-read.test.ts` pins the
strings to that one file.

**Existence is decided by reading, not by `store.exists`.** `exists` swallows
every `access()` failure as `false`, so an unreadable verdict would read as
absent and the mentor's existing-verdict skip would re-evaluate over a live
one. Instead the tool calls `readText` and classifies the thrown error by its
`code`: `ENOENT` / `ENOTDIR` → `not_found`; `EISDIR` / `ENAMETOOLONG` →
`invalid_ref`; anything else propagates. `FsProjectStore.readText` is
`realpath`, the containment check and the regular-file check (§8), then
`readFile`, with no wrapping — `realpath` raises the same coded `fs` error for
an absent or over-long path that `readFile` would, so `.code` reaches the tool
intact (verified 2026-09-14; the store contract — "the caller owns the message"
— permits the raw rethrow).

Every `{ ok: false }` other than `no_project` is a failure the caller must see
as one, so `sidecar_read` is in `OK_FALSE_IS_FAILURE` (`src/tool-result.ts`)
and its harness mirror `OK_FALSE_IS_FAILURE_LIVE` (`mock_mcp.py`). The
`reason` values beyond `no_project` are this tool's own; `no_project` keeps the
wrapper's exemption.

## 7. What it deliberately does not do

- **No directory listing.** A ref is something the caller already holds — a
  `file_path` from `research_query`, or an upload name the researcher gave in
  the conversation. Listing would turn a two-class reader into a filesystem
  browser, which is the surface the P2 posture removes.
- **No `results/`.** Served by `record_read` / `rank_search_matches`; a second
  route would let a skill dodge the compaction and ranking those apply.
- **No images.** `image_read` / `image_transcribe` own the FamilySearch scan
  class, by imageId or ark — neither takes a path, so an uploaded image has no
  reader at all. A binary upload is refused as `not_text` and the message says
  that, rather than pointing at a tool that cannot serve it.
- **No `research.json`, no tree.** `research_query` / `project_context` own
  those; a `ref` naming either is `invalid_ref` with a pointer.
- **No spill recovery.** The CLI's oversized-result spill lives in a temp tree
  that is rmtree'd at turn end and, after D16, in a different container from
  the tool server. That is a measured outcome, not a restorable capability;
  the §4 bound exists so this tool never *produces* a spill.
- **No `Principal`.** Local files only, like `research_query`.

## 8. Store rule

Every byte comes through `getProjectStore().readText(projectPath, ref)`. The
tool imports nothing from `fs` (`no-fs-outside-store.test.ts`), so a hosted
backend installed with `setProjectStore()` serves it with no tool change.
`FsProjectStore.abs` → `assertInsideProject` remains the second traversal
guard behind the tool's own §3 check, and `FsProjectStore.readText` adds two
checks of its own, pinned by `tests/store/fs-project-store.test.ts`: the
real-path check that catches a symlink leaving the project (§3), thrown as
`ProjectEscapeError` so `readProjectJson` reports it as the refusal it is rather
than as "not found"; and a regular-file check, because `readFile` on a FIFO or a
device node blocks in `open()` until a writer appears and the call never
settles. `realpath` raises `ENOENT` for an absent file with `.code` intact, so
the §6 classification is unchanged.

## 9. Consumers

- **`gps-mentor`** (`packages/engine/plugin/agents/gps-mentor.md`) — the
  existing-verdict skip reads a prior verdict body by
  `sidecar_read({ projectPath, ref: file_path })`; the output protocol names it
  for the candidate entry's sidecar. `sidecar_read` joins its `tools:` in all
  three spellings and **`Read` leaves the list**. Two consequences, recorded in
  `gps-mentor-agent-spec.md`: the mentor no longer holds any route to a project
  file other than the MCP tools, and it is now exposed to a registrar move
  exactly as the other MCP-only agents (`record-extractor`, `image-reader`,
  `person-evidence`) are — the built-in `Read` is a grant that can never miss, so an agent
  holding it spawns with `Read` alone on a registrar miss instead of being
  refused. gps-mentor was one such agent; `proof-conclusion` and
  `research-exhaustiveness` still declare a bare `Read` and still are.
- No skill calls it, so `eval/fixtures/mcp/` needs no fixture and
  `check_tool_coverage.py` (which keys on skills' `allowed-tools`) needs no
  entry. The unit harness registers it live (`LIVE_TOOLS`).

## 10. Fixture note

No e2e scenario under `eval/fixtures/scenarios/` ships an `evaluations/` or
`uploads/` directory. On a fixture whose `research.json` carries a
pre-existing `evaluations[]` entry, `sidecar_read` on its `file_path` returns
`not_found`, and the mentor's "a missing body counts as not craft" branch is
what runs. That is the correct answer for the fixture, not a defect: the
entry's body was never authored.

## 11. Sites

| Site | What |
|---|---|
| `src/tools/sidecar-read.ts` | tool, schema, types |
| `src/store/fs-project-store.ts` | `readText` real-path containment check (§3, §8) |
| `src/tool-schemas.ts` | `allToolSchemas` |
| `src/index.ts` | dispatch arm via `writerToolResult` |
| `manifest.json` | `tools` entry |
| `src/tool-result.ts` | `OK_FALSE_IS_FAILURE` |
| `eval/harness/harness/mock_mcp.py` | `LIVE_TOOLS`, `_make_live_handler` arm, `OK_FALSE_IS_FAILURE_LIVE` |
| `eval/harness/e2e/orchestrator.py` | `_project_read_route`: `evaluations/**` and `uploads/**` → `sidecar_read` |
| `dev/try-sidecar-read.ts` | smoke script |
| `README.md` | catalog row; both tool counts |
| `packages/engine/plugin/agents/gps-mentor.md`, `docs/specs/gps-mentor-agent-spec.md`, `tests/packaging/agent-tool-names.test.ts` | the consumer (§9) |

## 12. Tests

`tests/tools/sidecar-read.test.ts`: happy path on a verdict JSON; a text upload
with a space in its name and one with a 121-character name; nested refs under
both prefixes; pagination (`offset` / `maxChars` / `truncated` / `nextOffset`,
`offset ≥ totalChars`, the surrogate-pair boundary, `maxChars: 1` on a pair
and an offset landing on one keep the pair whole, a lone high surrogate is
returned as it stands, and every `(offset, maxChars)` on a mixed text yields
a non-empty page); **a 40,000-character all-`"` file yields an envelope under
50,000 characters through `writerToolResult` with `truncated: true`** (the §4
bound, written red-first); `maxChars` above the cap clamps; every
`invalid_ref` shape in §3 including a directory ref; a symlink under
`uploads/` to a file outside the project throws `escapes the project` rather
than returning it (skipped on win32); `not_found`; `not_text` for NUL bytes, a
JPEG header and UTF-16LE text; a single U+FFFD in a file under 100 characters
(one damaged byte, and the literal character) reads, two do not; BOM stripped;
an unreadable file (mode 0, skipped on win32) is **not** `not_found` (written
red-first); reads go through the installed store (`setProjectStore` a stub,
assert `readText(projectPath, ref)`).

Also: a path through a regular file (`ENOTDIR`) is `not_found`; a 300-byte
segment (`ENAMETOOLONG`) is `invalid_ref`.

`tests/store/fs-project-store.test.ts`: `readText` refuses a file symlink and
a directory symlink that leave the project, follows one that stays inside,
reads a project through an alias of its own path, still raises `ENOENT` for an
absent ref, surfaces a symlinked `research.json` through `readProjectJson` as
the escape it is (not "not found"), and refuses a FIFO instead of blocking.

`tests/tools/no-project.test.ts` carries it in `CALLS` and `READERS`;
`writer-tool-results.test.ts`, `manifest.test.ts`, `readme-catalog.test.ts`
and `test_mock_mcp.py`'s drift lint enrol it automatically;
`test_project_read_deny.py` pins the new route.
