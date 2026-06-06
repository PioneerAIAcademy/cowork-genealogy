# Research Viewer — Desktop App Implementation Plan

## Context

The genealogy research assistant (Claude Code skills + MCP server) writes to `research.json` and `tree.gedcomx.json` as it works. Users currently have no way to see the research state in real-time or share their session data with us for debugging. This plan creates a standalone Electron viewer that:

1. Watches and displays both project files in real-time as the assistant writes to them
2. Shows research progress (which skills have run, what's next)
3. Lets users opt-in to share their data + full Claude Code session log for feedback

---

## Architecture

```
viewer/                          # New Electron app (in this repo)
├── package.json
├── electron/
│   ├── main.ts                  # Electron main process
│   ├── preload.ts               # Bridge to renderer
│   └── watcher.ts              # fs.watch on project files + JSONL
├── src/                         # React frontend (Vite)
│   ├── App.tsx
│   ├── components/
│   │   ├── ResearchExplorer.tsx  # Tree view of research.json sections
│   │   ├── GedcomxViewer.tsx     # Person/relationship/source browser
│   │   ├── ProgressPanel.tsx     # Skill pipeline status
│   │   ├── LogViewer.tsx         # Research log table
│   │   └── FeedbackDialog.tsx    # Opt-in sharing UI
│   ├── lib/
│   │   ├── schema.ts            # TypeScript types for research.json + gedcomx
│   │   ├── progress.ts          # Infer skill state from file contents
│   │   └── session.ts           # Parse Claude Code JSONL
│   └── styles/
├── tsconfig.json
└── vite.config.ts
```

---

## Step 1: Project Setup

- Initialize `viewer/` with Electron + Vite + React + TypeScript
- Use `electron-vite` or `electron-forge` with Vite plugin for dev/build
- Dependencies: `electron`, `vite`, `react`, `react-dom`, `chokidar` (file watching)
- Dev command: `npm run dev` starts both Electron main and Vite dev server

---

## Step 2: File Watching (main process)

**File: `electron/watcher.ts`**

- User selects a project folder (containing `research.json` and `tree.gedcomx.json`) via native folder picker or CLI arg
- Use `chokidar` to watch both files for changes
- On change: read file, parse JSON, send to renderer via IPC
- Also detect and watch the active Claude Code session JSONL:
  - Look for `~/.claude/projects/<hash>/*.jsonl` where `<hash>` matches the project path
  - Watch the most recently modified JSONL (the active session)
  - Tail new lines as they're appended

**IPC channels:**
- `project:research-updated` → sends parsed research.json
- `project:gedcomx-updated` → sends parsed tree.gedcomx.json
- `session:event` → sends new JSONL entries as they appear

---

## Step 3: Research Explorer (renderer)

**File: `src/components/ResearchExplorer.tsx`**

Collapsible tree view of research.json sections:
- **Project** — objective, status, subject persons
- **Questions** — list with status badges (open/exhaustive_declared/resolved)
- **Plans** — grouped by question, plan items with status
- **Log** — sortable table (date, repository, query, outcome)
- **Sources** — list with citation previews
- **Assertions** — filterable by fact_type, evidence_type, information_quality
- **Person Evidence** — links showing assertion→person mappings
- **Conflicts** — highlighted with resolution status
- **Hypotheses** — with supporting/contradicting counts
- **Timelines** — visual or tabular event list
- **Proof Summaries** — narrative with tier badge

Each section shows item count. Clicking an item shows its full JSON in a detail panel.

---

## Step 4: GedcomX Viewer

**File: `src/components/GedcomxViewer.tsx`**

- Person list with name, gender, fact count
- Click a person → show their facts, names, source references
- Relationships panel showing parent-child and couple links
- Source descriptions panel
- Cross-references: click a source ref → jump to the matching research.json source

---

## Step 5: Progress Panel (Feature 1)

**File: `src/lib/progress.ts`**

Infer skill completion from research.json state:

```typescript
type SkillStatus = 'not_started' | 'completed' | 'active';

function inferProgress(research: ResearchJson): SkillProgress[] {
  return [
    { skill: 'init-project', status: research.project ? 'completed' : 'not_started' },
    { skill: 'question-selection', status: research.questions.length > 0 ? 'completed' : 'not_started' },
    { skill: 'research-plan', status: research.plans.length > 0 ? 'completed' : 'not_started' },
    { skill: 'search-records', status: research.log.length > 0 ? 'completed' : 'not_started' },
    { skill: 'record-extraction', status: research.assertions.length > 0 ? 'completed' : 'not_started' },
    // ... etc, following the pipeline from skill-list-spec Section 7
  ];
}
```

**File: `src/components/ProgressPanel.tsx`**

- Visual pipeline (vertical stepper or horizontal flow diagram matching spec Section 7)
- Each skill node shows: completed (green), not yet started (gray)
- "What's next" recommendation based on current state (same logic as project-status skill)
- Optional: if JSONL tailing is active, highlight the currently-running skill

---

## Step 6: Feedback Dialog (Feature 2)

**File: `src/components/FeedbackDialog.tsx`**

When user clicks "Share Feedback":
1. Show a dialog explaining what will be shared
2. Checkboxes (all default ON, user can uncheck):
   - [ ] research.json
   - [ ] tree.gedcomx.json
   - [ ] Claude Code session log (tool calls & responses)
   - [ ] Text feedback (free-form textarea)
3. Show file sizes for transparency
4. "Send" button POSTs to configured endpoint
5. Success/error toast

**Privacy note displayed in dialog:**
> "The session log includes all tool calls and their results from your current Claude Code session. It does NOT include Claude's internal thinking (that data is encrypted). Your data is shared only when you click Send."

**Session log content:**
- Read the active session JSONL
- Filter to entries for the current project (by `cwd` field)
- Include: user messages, assistant text, tool_use blocks (name + input), tool_result blocks
- Exclude: thinking blocks (they're opaque anyway), permission-mode entries

**Payload structure (flexible — endpoint TBD):**
```typescript
interface FeedbackPayload {
  timestamp: string;
  projectFolder: string;
  research?: object;          // research.json contents
  gedcomx?: object;           // tree.gedcomx.json contents
  sessionLog?: SessionEntry[]; // parsed JSONL entries
  userComment?: string;        // free-form text
  viewerVersion: string;
}
```

---

## Step 7: Session JSONL Parser

**File: `src/lib/session.ts`**

Parse the Claude Code JSONL format (confirmed from live inspection):
- Each line is a JSON object with `type`, `message`, `timestamp`, `sessionId`
- Types: `user`, `assistant`, `permission-mode`, `file-history-snapshot`
- `assistant` messages contain `content[]` blocks: `text`, `tool_use`, `thinking`
- `user` messages contain `content[]` blocks: `text`, `tool_result`
- Tool calls have: `name`, `input` (full params), `id`
- Tool results have: `tool_use_id`, `content` (full output)

For the "currently active skill" detection:
- Look for recent `tool_use` with `name: "Agent"` and `input.subagent_type` or `name: "Skill"`
- The most recent unmatched tool_use (no corresponding tool_result yet) = currently running

---

## Step 8: Build & Distribution

- `npm run build` produces a packaged Electron app
- For now: dev-mode only (`npm run dev`), no installer
- Later: use `electron-builder` for .deb/.AppImage (Linux), .dmg (macOS), .exe (Windows)
- The ui ships independently from the plugin/MCP server — it just reads their output files

---

## Key Files to Modify

- None in the existing codebase. This is a new `ui/` directory.
- The ui reads `research.json` and `tree.gedcomx.json` schemas defined in:
  - `docs/specs/research-schema-spec.md`
  - `docs/specs/simplified-gedcomx-spec.md`
- TypeScript types in `ui/src/lib/schema.ts` will mirror these schemas

---

## Feature 1 Discussion (Progress/State)

**Approach chosen:** Infer from research.json file state.

This works because each skill writes to specific sections (per the ownership table in skill-list-spec Section 3). The presence and content of each section directly maps to which skills have completed. The skill pipeline is well-defined (Section 7 flow diagram), so "what's next" is deterministic given current state.

**Enhancement path:** If real-time "currently running" proves valuable, add JSONL tailing as a second data source. The ui already parses JSONL for the feedback feature, so this is incremental.

---

## Feature 2 Discussion (Full Session Log)

**Approach chosen:** Ship the session JSONL file.

The JSONL already contains complete tool calls with full inputs and outputs. This is exactly what's needed to debug "the skill told Claude to search for X but it searched for Y" or "the MCP tool returned unexpected data." The one gap (sealed thinking blocks) is an Anthropic platform constraint — we get everything else.

**What this enables for debugging:**
- See every MCP tool call (record_search, tree_read, etc.) with exact parameters
- See every tool response (what FamilySearch returned)
- See what Claude wrote to files (Edit/Write tool calls with full content)
- See user messages that triggered each skill
- Reconstruct the full session timeline

---

## Verification

1. `cd ui && npm run dev` — ui launches, shows empty state
2. Open a folder with research.json — sections populate in the explorer
3. Have Claude Code run a skill that modifies research.json — ui updates in real-time
4. Click "Share Feedback" — dialog shows correct file sizes, sends payload to a test endpoint
5. Progress panel correctly shows which pipeline stages are complete
