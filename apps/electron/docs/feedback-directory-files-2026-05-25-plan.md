# Feedback dialog: full directory state

Expand the feedback dialog so reports include the full project directory
(sidecars + other files), not just the three hardcoded items
(`research.json`, `tree.gedcomx.json`, Claude Code session log).

Goal: when a user reports a bug, the team can reproduce from the attached
state without a follow-up round trip.

## Current state

- `FeedbackDialog.tsx` has three hardcoded checkboxes wired to
  `ResearchDataContext` (`research`, `gedcomx`) and `getSessionLog()`.
- `submitFeedback` IPC sends `{research, gedcomx, sessionLog, userComment}` to
  a Google Apps Script endpoint.
- Sidecars in `results/log_NNN.json` are not surfaced anywhere.

## Design

People filing bugs won't curate per-file. The only legitimate opt-out is large
media. Reduce to two toggles.

```
┌─ Send Feedback ──────────────────────────────────┐
│                                                  │
│  Including 14 files · 4.3 MB                     │
│  ▶ Show file list                                │
│                                                  │
│  ☐ Include media files (12 files · 38 MB)        │
│  ☑ Include Claude Code session log (1.8 MB)      │
│                                                  │
│  [textarea — optional comment]                   │
│                                                  │
│  [privacy blurb]                                  │
│                                                  │
│                          [Cancel]  [Send]        │
└──────────────────────────────────────────────────┘
```

- **"Show file list"** expands a read-only list of relative paths + sizes.
  No checkboxes — it's for verification, not curation.
- **Media toggle** off by default. When on, the summary line and list update
  to reflect the additional files/bytes.
- **Session log** keeps its current toggle behavior.

Media extensions: `.mp3`, `.wav`, `.m4a`, `.ogg`, `.jpg`, `.jpeg`, `.png`,
`.heic`, `.webp`.

## Implementation

### Main process (`src/main/index.ts`)

**New IPC `project:list-files`**

```ts
type ProjectFile = {
  relativePath: string
  sizeBytes: number
  isMedia: boolean
  isText: boolean   // for utf8 vs base64 encoding on send
}
```

Walk rules:
- Recurse into subdirectories.
- Skip dotfiles / dot-directories (`.git`, `.DS_Store`).
- Skip symlinks.
- That's it. No defensive `node_modules` / `dist` allowlist — a research
  folder won't have them, and the 50 MB cap catches the pathological case.

**Update `feedback:submit` payload — zip the project folder**

Renderer sends:
```ts
{
  includeMedia: boolean
  includeSessionLog: boolean
  userComment?: string
}
```

Main process re-walks `currentFolderPath`, filters by `includeMedia`, and
builds a zip in memory using `JSZip` (~30 KB minified, no native deps).

**Zip layout** — designed so a dev can unzip into any folder and open it in
the app to reproduce the user's state:

```
research.json                 ← project files at zip root
tree.gedcomx.json
results/log_001.json          ← subdirectory structure preserved
results/log_002.json
CLAUDE.md
_feedback/
  feedback.json               ← { timestamp, projectFolder, viewerVersion, userComment }
  session-log.jsonl           ← raw JSONL, one entry per line (if includeSessionLog)
```

- Project files go at the zip root with their original relative paths
  (preserves the `results/` subdirectory so `log_entry.results_ref`
  pointers still resolve).
- Feedback metadata lives under `_feedback/` so it can't be mistaken for
  project content by the watcher or the schema validator.
- Session log is included as raw JSONL (`<entry>\n<entry>\n...`) rather
  than a JSON array — smaller, line-oriented, grep-friendly.

The zip is then base64-encoded into a small JSON envelope sent to the
Apps Script endpoint:

```ts
{
  timestamp: string,
  projectFolder: string,
  viewerVersion: string,
  filename: string,               // e.g. "feedback-2026-05-25T18-22-31.zip"
  zipBase64: string,
  fileCount: number,              // for server-side logging without unzipping
  uncompressedBytes: number
}
```

Apps Script writes the zip directly to Drive via
`DriveApp.createFile(Utilities.newBlob(decoded, 'application/zip', filename))`.
One Drive file per feedback report. To reproduce: download, unzip, open
the folder in the app.

The renderer doesn't pass a path list — main re-walks. This avoids a
TOCTOU window where the renderer could be tricked into zipping paths it
shouldn't.

**Caps:**
- Skip individual files > 25 MB at read time, log a warning.
- Hard-reject zip > 50 MB (after compression) before posting. Apps Script
  has a ~50 MB request limit; this stays inside it.

**Bundling is not free.** A folder with 1000 sidecars + base64 encoding
takes real time. The renderer's Send flow:

1. Click Send → button label → `Bundling…`, button disabled, dialog as a
   whole disabled (prevent toggle changes mid-bundle).
2. Main process reads + encodes (single sequential pass; no need to
   parallelize file I/O for this scale — disk cache dominates).
3. On bundle complete → button label → `Sending…`, then existing success /
   error toast handling.

No progress bar — the bundle step is a single IPC round trip. If real-world
folders push past ~2s consistently we can add streaming later, but optimizing
that now is speculative.

### Preload

Add `listProjectFiles()` and update `submitFeedback` payload shape in both
`index.ts` and `index.d.ts`.

### Renderer (`FeedbackDialog.tsx`)

State:
```ts
const [files, setFiles] = useState<ProjectFile[]>([])
const [includeMedia, setIncludeMedia] = useState(false)
const [includeSessionLog, setIncludeSessionLog] = useState(true)
const [showFileList, setShowFileList] = useState(false)
```

Derived (memoized): `selectedFiles`, `selectedCount`, `selectedBytes`,
filtered by `includeMedia`. Send disabled at > 50 MB or when nothing
selected and the comment is empty.

Empty-folder case: `folderPath == null` → render only session log + comment
(current behavior).

### CSS

Minor additions: `.summaryLine`, `.fileList` (read-only, scrollable, max
height ~160px), `.showListToggle` (link-style with rotating chevron).
No dialog width change needed.

### Apps Script endpoint — sequencing

No backward compatibility required. Deploy order:

1. Update the Apps Script to expect the new envelope: decode
   `zipBase64` and save the resulting blob to Drive as
   `application/zip` with the provided `filename`. Drop the old branch
   that handled `{research, gedcomx, ...}`.
2. Ship the new client.

Server first; if the client ships first, Send fails until the script is
updated. Coordinated deploy, not a flag day.

**Dev reproduction workflow** (one of the main wins of the zip layout):
1. Download the `.zip` from Drive.
2. Unzip to any folder, e.g. `~/repro/<ticket-id>/`.
3. Open the Electron app → Select Folder → that folder.
4. Watcher loads `research.json` + `tree.gedcomx.json`; sidecars resolve
   via existing `results/` paths; UI is in the same state as the user's.
5. `_feedback/feedback.json` has the user's comment and metadata;
   `_feedback/session-log.jsonl` shows what they did with Claude Code.

## Edge cases

| Case | Handling |
|------|----------|
| File deleted between list and send | Per-file `try/catch` on read; missing files dropped, warning logged, send proceeds. |
| Unreadable file (permissions) | Same — drop, log. |
| File > 25 MB | Skip with warning. |
| Total > 50 MB | Reject before posting, surface error in dialog. |
| No folder open | Session log + comment only. |
| Path traversal via crafted relativePath | N/A — renderer doesn't send paths; main re-walks. |

## Guard against wrong-folder selection (separable)

This change is **separable** from the feedback work above — it can land in
either order. Bundling it here because it eliminates the "wrong folder
selected" edge case at its source.

`research.json` is the canonical marker of a research project (created by the
`init-project` skill, refused if it already exists, watched by the renderer).
If a user accidentally selects `~/Documents` or some other unrelated folder,
the rest of the app silently degrades — and the feedback dialog would happily
try to upload the entire directory.

**Change:** in `project:select-folder` (`src/main/index.ts:205`), after the
folder picker resolves but before `startWatching`, stat
`<folder>/research.json`. If it doesn't exist, reject with a clear error:

> "Not a research project — `research.json` not found. Run the
> `init-project` skill to create a new project, or pick a folder that
> already has one."

The renderer surfaces the error via the same channel the picker already
returns through. The folder is not switched; the previous project (if any)
stays loaded.

**What this protects beyond feedback:** the watcher's "file deleted"
warnings, the empty-state confusion when no project data loads, and any
future feature that assumes a real project is open.

**Not in scope for this guard:**
- Schema-validating `research.json` contents. Existence is enough; if the
  file is malformed, the watcher already surfaces a parse error.
- A picker-time UI hint ("greyed-out folders without research.json"). The
  native folder picker doesn't support that; the post-pick error is the
  cheapest correct behavior.

## Out of scope

- Per-file curation UI.
- Drag-and-drop external files.
- Persisted user preferences for the toggles.
- Adding sidecars to the file watcher (separate concern).
