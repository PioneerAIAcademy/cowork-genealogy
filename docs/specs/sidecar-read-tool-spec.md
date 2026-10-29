# `sidecar_read` — paged read of a project sidecar text file — Spec

> **Status:** New (2026-09-14, `docs/plan/search-agent-prototype.md` D6–8, the
> `sidecar_read` half). Read-only sibling of `research_query`
> (`research-query-tool-spec.md`) and `project_context`
> (`project-context-tool-spec.md`): those two serve `research.json` and the
> tree; this serves the project-file classes no other MCP tool reads back:
> verdict bodies, uploads, a staged transcription, and one full-text hit.

```
sidecar_read({ projectPath, ref, offset?, maxChars? })
  -> { ok: true, ref, totalChars, offset, content, truncated, nextOffset?, hitId?, hitIndex?, logId? }
   | { ok: false, reason: "no_project" | "invalid_ref" | "not_found" | "not_text", errors: string[] }

sidecar_read({ projectPath, refs, maxChars? })
  -> { ok: true, results: [ <one result above per ref> ] }
   | { ok: false, reason: "invalid_ref", errors: string[] }   // `ref` and `refs` together, or an empty or non-list `refs`
```

**Added for the record-structurer agent** (lead, 2026-09-27 and 2026-09-29). A
`results/` ref is served **only** for the two texts no other tool reads back
(§7): a staged transcription (`image_transcribe`'s `StagedTranscription`, either
a staged handle or a finalized sidecar), whose `transcription` text is returned
and paged like a file; and **one full-text hit's `textDocument`** (lead,
2026-10-20), addressed `results/<file>#<hit id>`, with
`results/<file>#hits` listing the hits. Any other bare `results/` ref (a record or
search sidecar, or a full-text sidecar with no `#` selector) is refused as
`invalid_ref`, with a pointer (§6 has the selector errors). `refs` reads several refs in one call, each from
its start; it is the agent's one "read all" turn. `ref` and `refs` together, or
an empty `refs`, is refused.

---

## 1. Why this exists

The hosted sandbox holds no project folder (`search-agent-prototype.md`, P2):
the agent reaches project state through MCP tools or not at all. Measured over
161 committed e2e runs and 4,950 `Read` calls (paths normalised `\` → `/`),
**three** read classes disappear with the directory:

- `<project>/results/**` — **226** reads. Record and search sidecars are
  already served host-side by `record_read({recordId, resultsRef})` and
  `rank_search_matches({resultsRef})`, and `search-records/SKILL.md` already
  says "Do NOT `Read` the sidecar file yourself". Those reads measure
  non-compliance with a shipped instruction, not a gap. **Not this tool's
  business**, with two exceptions that had no reader at all (§7): a staged
  transcription, and one full-text hit's `textDocument`, which `fulltext_search`
  drops from its response once staged.
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
classes and the two `results/` texts nothing else reads back, and nothing else
(§7).

## 2. The tool

```typescript
sidecar_read({
  projectPath: string,   // required — the project directory
  ref?: string,          // project-relative POSIX path under evaluations/ or uploads/, or a results/ ref (§7)
  refs?: string[],       // several refs in one call, each read from its start
  offset?: number,       // UTF-16 code-unit offset, integer ≥ 0, default 0; applies to `ref` only
  maxChars?: number,     // page size, default 40,000, hard cap 40,000 (clamped); applies to every ref
})
```

Send `ref` or `refs`, not both; the schema requires only `projectPath`. `refs`
returns `{ ok: true, results }`, one §2.1 result per ref in the order given: a
ref that fails is that entry's `{ ok: false, … }`, not the call's. `ref` and
`refs` together, or a `refs` that is empty or not a list, is `{ ok: false,
reason: "invalid_ref", errors }` for the whole call.

Read-only; writes nothing. No auth, no network, no `Principal` parameter —
exactly the shape of `research_query`. Parameters are camelCase (the wire
surface); the file content is returned verbatim.

The tool, its `sidecarReadSchema`, and its `SidecarReadInput` /
`SidecarReadResult` / `SidecarReadBatchResult` types all live in
`packages/engine/mcp-server/src/tools/sidecar-read.ts`. There is no
`src/types/sidecar-read.ts`: the shapes have one consumer and no upstream API
response to mirror.

### 2.1 Return value

```typescript
{
  ok: true,
  ref: string,          // the ref as given (echoed back), a `#` selector included
  totalChars: number,   // length of the decoded file in UTF-16 code units (after BOM strip)
  offset: number,       // the offset this page starts at
  content: string,      // text[offset, offset + page)
  truncated: boolean,   // offset + content.length < totalChars
  nextOffset?: number,  // offset + content.length — present only when truncated
  // present only on a full-text hit read, `results/<file>#<hit id>` (§7.1):
  hitId?: string,       // the hit's `id` as the sidecar stores it
  hitIndex?: number,    // its 1-based position in the sidecar's `payload.results` — the viewer's card order
  logId?: string | null, // the finalized sidecar's `log_id`; null for a staged handle
}
```

An `offset` at or past `totalChars` returns `content: ""`, `truncated: false`
and no `nextOffset` — a legitimate empty page, not an error. On a hit read the
text measured and paged is that hit's `textDocument`; a `#hits` read carries
none of the three hit fields, and its text is the hit list (§7.1).

## 3. Ref rules

`ref` is accepted **positively**: a prefix, then one or more segments separated
by `/`. Every segment is non-empty, is not `.` or `..`, and contains no `/`,
`\` or NUL. Any other character is allowed — upload names carry spaces and run
to 121 characters (`_UPLOAD_NAME_RE` in `apps/server/app/sessions.py`). The
prefixes are `evaluations` and `uploads`, plus `results`, which passes §3 only
to be decided by §7: a `results/` ref is one of the two texts §7 serves, or
`invalid_ref` there.

Nesting is allowed under both. `evaluations[].file_path` is a free string
(schema `"type": "string"`; the validator checks presence only), and a desktop
user can create `uploads/scans/` by hand.

A `results/` ref may end in a hit selector, `#<hit id>` or `#hits` (§7.1). It is
split off at the first `#` before these rules run, and the rules apply to the
part before it, so an ARK's `/` and `:` in the selector never meet them. No
other prefix carries a selector: an upload's name may hold a `#`
(`uploads/notes#1.txt` is a literal filename), so an `evaluations/` or
`uploads/` ref is checked whole, and `uploads/notes#/../../research.json` is
`invalid_ref` for its `..` segments.

Rejected as `invalid_ref`:

| Shape | Example |
|---|---|
| absolute path | `/etc/passwd`, `C:/x` |
| backslash anywhere | `uploads\notes.txt` |
| a `.` or `..` segment | `uploads/../research.json` |
| an empty segment | `uploads//x.txt`, `uploads/`, a trailing `/` |
| any other prefix | `research.json`, `tree.gedcomx.json`, `images/x.jpg`, `notes.txt` |
| a ref that names a directory | `evaluations` (bare), `uploads/scans` when `scans` is a directory |

The message for a rejected prefix names the tool that serves that class:
`research.json` and the tree → `research_query` / `project_context`;
`images/` → `image_read` / `image_transcribe`. A `results/` ref is not rejected
here: `results/log_001.json` passes §3, and §7 refuses it as `invalid_ref`
unless it holds a staged transcription. The refusal points at `record_read` /
`rank_search_matches`, or, for a full-text sidecar, at its two `#` selectors.

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
| `ref` and `refs` both present | `{ ok: false, reason: "invalid_ref", errors: ["send \`ref\` or \`refs\`, not both"] }` for the whole call |
| `refs` empty, or not a list | `{ ok: false, reason: "invalid_ref", errors: ["\`refs\` must be a non-empty list"] }` for the whole call |
| one entry of `refs` fails | that entry's `{ ok: false, reason, errors }` in `results`; the call is still `ok: true`. A throw (a bad `projectPath`, a bad `maxChars`) fails the whole call |
| `ref` absent, empty or not a string, and no `refs` | `{ ok: false, reason: "invalid_ref", errors }` — "ref is required" |
| `ref` fails §3 | `{ ok: false, reason: "invalid_ref", errors }` |
| `ref` names a directory (`EISDIR`) | `{ ok: false, reason: "invalid_ref", errors }` — "names a directory" |
| `ref` is longer than the filesystem allows (`ENAMETOOLONG` — a segment over 255 bytes, or the whole path over the platform limit) | `{ ok: false, reason: "invalid_ref", errors }` — no file can have this name |
| an `evaluations/` or `uploads/` `ref` is absent (`ENOENT`), or a segment of the path is a regular file (`ENOTDIR`) | `{ ok: false, reason: "not_found", errors }` — the message says where a ref comes from (verdict paths from `research_query({section: "evaluations"})`'s `file_path`; uploads named in the conversation by the researcher) and that this tool does not list directories |
| a `results/` ref with no selector that holds no staged transcription: a record or search sidecar, a missing file, anything else | `{ ok: false, reason: "invalid_ref", errors }` — points at `record_read({recordId, resultsRef})` for a `record_read` sidecar, and at `record_read` / `rank_search_matches` otherwise. Never `not_found` |
| a full-text sidecar (`fulltext_search`, staged or finalized) with no selector | `invalid_ref` — names its hit count and both selectors, `#hits` and `#<hit id>` (§7.1) |
| an empty selector, `results/<file>#` | `invalid_ref` — points at `#hits` |
| a selector on a sidecar no `fulltext_search` wrote (a staged transcription, a record search) | `invalid_ref` — names the tool that wrote it; pass the ref without the selector |
| a selector on a `results/` ref that is neither a staged handle under `results/.staging/` nor a top-level `results/<name>.json`, or whose file is not JSON or has no `payload.results` array | `invalid_ref` |
| a selector whose file is absent | `not_found` |
| `#<hit id>` naming no hit in the sidecar | `not_found` — names the hit count and `#hits` |
| `#<hit id>` naming a hit with no `textDocument` | `not_found` — "carries no transcript: FamilySearch returned none for it"; `#hits` lists it with `hasTranscript: false` |
| the file is binary / non-UTF-8 (§5) | `{ ok: false, reason: "not_text", errors }` |
| the file exists but cannot be read (`EACCES`, …), or is not a regular file (a FIFO, a device node) | **throws** → the dispatch arm's `catch`, loud. Never `not_found` |
| `offset ≥ totalChars` | `{ ok: true, content: "", truncated: false }` |

The classification order is: `ref` / `refs` shape, then argument validation
(throws), then §3 ref validation on the ref with any `results/` selector split
off, then `classifyProjectPath` exactly as `readProjectJson` does
(`missing_arg` → throw `MISSING_PROJECT_PATH_MESSAGE`; `missing_dir` → throw
`missingProjectDirMessage(projectPath)`; `no_project` →
`noProjectResult("read")`), then the read: an `evaluations/` or `uploads/` ref
through `readText`, a `results/` ref through §7's rules. The two message helpers
are imported from `utils/project-io.ts`, never re-phrased —
`single-project-read.test.ts` pins the strings to that one file.

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
— permits the raw rethrow). A selector's file is read the same way, through
`readResultsEnvelope` (`src/utils/results-staging.ts`): `ENOENT` / `ENOTDIR` →
`not_found`, anything else propagates.

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
- **No `results/` search or record sidecars, read whole.** Served by
  `record_read` / `rank_search_matches`; a second route would let a skill dodge
  the compaction and ranking those apply. Two texts are the exceptions, since
  nothing else reads them back and no compaction applies to them: a staged
  **transcription**, and **one full-text hit's `textDocument`** (§7.1).
- **No images.** `image_read` / `image_transcribe` own the scan class. An
  uploaded image or PDF is read by `image_transcribe({ file: <ref>, projectPath })`, which OCRs it host-side and returns text — so a binary upload is
  refused as `not_text` and the message points there.
- **No `research.json`, no tree.** `research_query` / `project_context` own
  those; a `ref` naming either is `invalid_ref` with a pointer.
- **No spill recovery.** The CLI's oversized-result spill lives in a temp tree
  that is rmtree'd at turn end and, after D16, in a different container from
  the tool server. That is a measured outcome, not a restorable capability;
  the §4 bound exists so this tool never *produces* a spill.
- **No `Principal`.** Local files only, like `research_query`.

### 7.1 One full-text hit per ref

**Ruling (lead, 2026-10-20):** "`sidecar_read` serves one
full-text hit's `textDocument` per ref." `fulltext_search` drops `textDocument`
from its response once staged (`fulltext-search-tool-spec.md`, "Result
staging"), so the staged or finalized sidecar holds the only copy of a hit's
machine transcript, and the hosted path has no `Read` to reach it.

- **The hit is addressed inside the ref:** `results/<file>#<hit id>`, where
  `<hit id>` is the hit's `id` in any ARK spelling — bare (`3QS7-99W7-GYFS`),
  `ark:/61903/3:1:…`, or a resolver URL, which some sidecars store. Selector
  and stored id are compared after `arkToBareId` on both. The same string then
  flows unchanged through `refs`, record-structurer's `sources[].resultsRef` and
  `extraction_append`'s `transcriptionRef` (`research-append-tool-spec.md`
  §11.7), so no new input field crosses the schema. Only a `results/` ref is
  split (§3): a `results/` filename never holds a `#` (staged names are UUIDs,
  finalized ones `log_NNN.json`), while an upload's may.
- **One hit per ref.** The result is that hit's `textDocument`, verbatim, paged
  by §4, plus `hitId`, `hitIndex` and `logId` (§2.1). A whole sidecar's
  transcripts run far past one page, and a caller judging or extracting one hit
  needs that hit's text only; several hits are several refs in one `refs` call.
- **`#hits` lists the hits**, one JSON line each, with no transcript text:
  `{hitIndex, hitId, title, recordDate, recordPlace, hasTranscript, ref}`.
  `title`, `recordDate` and `recordPlace` are null when the hit has none;
  `hasTranscript` is whether it carries a non-empty `textDocument`; `ref` is the
  ready-made `results/<file>#<bare id>`, so a caller copies an address and never
  assembles one. JSON Lines, so a page cut by §4 leaves every whole line
  parseable. `hits` is reserved: no hit id spells it.
- **A position is returned, never accepted.** `hitIndex` is output only. A
  mistyped id fails loudly as `not_found`; a mistyped position would silently
  read another valid hit.
- **A bare full-text ref is refused**, `invalid_ref`, naming the hit count and
  both selectors. It is never answered with the list or a hit: a selector the
  caller dropped must not read back as different content.
- **Staged or finalized, and inside `refs`.** `logId` is null on a staged
  handle. A staged handle is gone once `research_log_append` finalizes it, so a
  ref handed on to another turn or agent is the finalized
  `results/<log_id>.json#<hit id>`.
- **Every other reader but `extraction_append` refuses a selector.** `resolveStagedRef` never
  near-copy-corrects a ref holding a `#` (`<uuid>#1` is two edits from `<uuid>`,
  and correcting it would read the whole file as if it were the hit), and
  `readStagedResults` / `checkStagedResults` refuse one, naming `sidecar_read`
  and the ref without its selector. `extraction_append` reads a hit ref through
  the same helpers as this tool (`readResultsEnvelope`, `findFulltextHit`).

## 8. Store rule

Every byte comes through `getProjectStore().readText(projectPath, ref)` — for a
`results/` ref, the file before any selector, read by the `results-staging.ts`
readers through the same store. The
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
  exactly as the other MCP-only agents (`record-structurer`, `person-evidence`)
  are — the built-in `Read` is a grant that can never miss, so an agent
  holding it spawns with `Read` alone on a registrar miss instead of being
  refused. gps-mentor was one such agent; `proof-conclusion` and
  `research-exhaustiveness` still declare a bare `Read` and still are.
- **`record-structurer`** reads every `resultsRef` it is handed in one `refs`
  call; a full-text hit ref (`results/<log_id>.json#<hit id>`) is one such ref,
  and `extraction_append` takes the same string as its `transcriptionRef`.
  `search-images`, `search-hints` and the `research` skill read a staged
  transcription.
- No fixture under `eval/fixtures/mcp/` serves it and `check_tool_coverage.py`
  needs no entry: the unit harness runs it live (`LIVE_TOOLS`), and every live
  tool is exempt. A hit read in a unit run reads what the mock staged: the mock
  stages a `fulltext_search` fixture's response before it compacts it, so the
  sidecar keeps whatever `textDocument` the fixture's hits carry.

## 10. Fixture note

One scenario ships an `evaluations/` directory — `flynn-prior-craft-verdict`,
whose `evaluations[0]` has its verdict body on disk — and `build_workspace`
stages `evaluations/` and `uploads/` into the unit workspace alongside
`results/`. Elsewhere in the corpus a `research.json` may carry a pre-existing
`evaluations[]` entry whose body was never authored; there `sidecar_read` on
its `file_path` returns `not_found`, and the mentor's "a missing body counts
as not craft" branch is what runs. That is the correct answer for such a
fixture, not a defect.

## 11. Sites

| Site | What |
|---|---|
| `src/tools/sidecar-read.ts` | tool, schema, types |
| `src/utils/results-staging.ts` | `splitHitRef`, `HIT_INDEX_FRAGMENT`, `readResultsEnvelope`, `findFulltextHit`; the `#` guard in `resolveStagedRef`, `readStagedResults` and `checkStagedResults` (§7.1) |
| `src/tools/extraction-append.ts` | documents mode takes a hit ref as `transcriptionRef` (`research-append-tool-spec.md` §11.7) |
| `src/store/fs-project-store.ts` | `readText` real-path containment check (§3, §8) |
| `src/tool-schemas.ts` | `allToolSchemas` |
| `src/server.ts` | dispatch arm via `writerToolResult` |
| `manifest.json` | `tools` entry |
| `src/tool-result.ts` | `OK_FALSE_IS_FAILURE` |
| `eval/harness/harness/instrument.py` | `LIVE_TOOLS`, `LIVE_MODULES` |
| `eval/harness/harness/mock_mcp.py` | `_COMPILED_TOOLS` entry (run by `_make_live_handler`), `OK_FALSE_IS_FAILURE_LIVE`; the module docstring's live-tool note |
| `eval/harness/e2e/orchestrator.py` | `_project_read_route`: `evaluations/**` and `uploads/**` → `sidecar_read`; `results/**` → `record_read`, or `sidecar_read`'s `#hits` for a full-text sidecar |
| `apps/server/proto/worker/deny.py` | `read_route`, the declared port of `_project_read_route`; the two change together |
| `dev/try-sidecar-read.ts` | smoke script |
| `dev/smoke-calls.ts` | the offline smoke rows, an evaluation file and one full-text hit (`make engine-smoke-stdio`, `make engine-smoke-http`) |
| `docs/catalog.md` | catalog row; the tool count |
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
segment (`ENAMETOOLONG`) is `invalid_ref`; a bare `results/log_001.json` is
`invalid_ref` with the `record_read` pointer.

A staged transcription, and `refs`: a staged transcription's text pages like a
file; a staged record search is `invalid_ref` pointing at `record_read`; one
`refs` call returns a transcription, an upload and a `not_found` in order;
`ref` with `refs`, and an empty `refs`, are refused.

One full-text hit (§7.1), on the committed real sidecar
`eval/fixtures/scenarios/g9gj-proof-update-after-later-search/results/log_003.json`,
whose 20 hits each carry a distinct transcript, so a wrong position or a wrong
id can never read back the right text: hit 5 by full ARK, bare id and resolver
URL returns its `textDocument` with `hitIndex: 5` and `logId: "log_003"`; a hit
read from a staged copy carries `logId: null`; `#hits` gives 20 JSON lines with
ids, positions and refs and no transcript text; a bare ref is `invalid_ref`
naming 20 hits and `#hits`; two hit refs inside `refs`; a second page of one
transcript by `offset: nextOffset`; an unknown hit is `not_found` naming 20, an
empty selector `invalid_ref`, a missing file `not_found`; on
`eval/fixtures/scenarios/research-competing-parent-sets-no-hypotheses/results/log_020.json`
a hit with no transcript is `not_found` and `#hits` lists all five with
`hasTranscript: false`; a hit stored under a resolver-URL id
(`eval/fixtures/scenarios/flynn-record-matching/results/log_004.json`); a
selector on a record search's sidecar and on a staged transcription is
`invalid_ref`; `uploads/notes#1.txt` still reads as a literal filename; and
`uploads/notes#/../../research.json` is `invalid_ref`.

`tests/utils/results-staging.test.ts`: `resolveStagedRef` returns a ref
carrying a `#` unchanged, and `readStagedResults` / `checkStagedResults` refuse
it, naming `sidecar_read`.

`tests/store/fs-project-store.test.ts`: `readText` refuses a file symlink and
a directory symlink that leave the project, follows one that stays inside,
reads a project through an alias of its own path, still raises `ENOENT` for an
absent ref, surfaces a symlinked `research.json` through `readProjectJson` as
the escape it is (not "not found"), and refuses a FIFO instead of blocking.

`tests/tools/no-project.test.ts` carries it in `CALLS` and `READERS`;
`writer-tool-results.test.ts`, `manifest.test.ts`, `catalog.test.ts`
and `test_mock_mcp.py`'s drift lint enrol it automatically;
`test_project_read_deny.py` pins the new route.
