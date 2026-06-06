# 3-Pane Genealogy Workbench — UI Redesign

**Status:** DRAFT for design + engineering review · 2026-06-06 · branch `hosted-web-workbench`

## Context

The hosted web workbench today is a **two-pane** layout (`apps/web`): chat on
the left, the shared viewer (`packages/viewer-ui`) on the right. The viewer
itself is a 3-zone app — a section sidebar (11 sections), a single content
slot, and a modal "sidecar" drawer for search results.

The original request was for a standard **3-pane IDE**: file tree (left),
tabbed file content (middle), chat (right). After design review we are **not**
building a literal IDE, because the primary user is an **end genealogist** (not
a developer) and the project is ~5–15 interconnected JSON documents, not a code
tree. A literal file tree + raw-JSON tabs would (a) throw away the viewer's
semantic renderer — the product's best asset, (b) duplicate the existing
section sidebar with a second navigator, and (c) hide the cross-reference graph
that is the actual value of the data.

**Design decisions (confirmed):**
- Primary user = end genealogists → rendered views by default; raw JSON behind
  a per-tab toggle (a dev/transparency affordance).
- Middle pane = **tabs of rendered content** (sections, evidence, people), each
  with a "view raw JSON" switch.
- Left rail = **semantic**, two zones: *Sections* (existing nav) + *Evidence*
  (the growing list of artifacts the agent produces). No literal file tree.
- Right pane = **chat**, moved from today's left (assistant-on-the-right is the
  dominant convention) and collapsible.

The instinct behind "IDE" — a workspace you watch fill up with artifacts, chat
alongside — is right. We deliver it with domain-native panes.

### Honest scope note on "files / image reads"

The request described files as "research.json, gedcomx.json, and various search
results, image reads, etc." Verified against the schema and tools:

- **Search results** persist as `results/<log_id>.json` sidecars (log entries
  where `results_ref != null`). These render today via `SidecarResultCard`.
- **`image_read` persists nothing** — its product is stored as
  `Source.transcription` text (`research-schema-spec.md`, line ~315), not an
  image file. There is no stored image artifact for it.
- The only on-disk image/PDF artifact is `LogEntry.external_site.capture_filename`
  (a PDF the user returns for a commercial-site search), and **no transport
  method reads those bytes today** (`ResearchTransport.readSidecar` is scoped to
  `results/<logId>.json` only).

So the Evidence rail surfaces **search-result sidecars** (rendered) and
**capture metadata** (site / filename / "captured", plus any transcription). A
real image/PDF byte-viewer is a **scoped follow-up** (needs a new transport
method in both the Electron and Web adapters, with a path-traversal guard) and
does not block this work.

## Design

```
┌──────────────────────────────────────────────────────────────────────┐
│  Header (project title, FS status)                          [≡ chat]   │
├───────────────┬───────────────────────────────────────┬────────────────┤
│ WORKSPACE RAIL│  TAB BAR  [Overview*][Q: …][Search 12][⤢]              │
│ (collapsible) ├───────────────────────────────────────┤  CHAT          │
│ ▸ SECTIONS    │  ProgressPipeline (full width)         │  (right,       │
│   Overview    │ ┌───────────────────────────────────┐  │  collapsible)  │
│   Questions 4 │ │                                   │  │                │
│   Sources  12 │ │   Active tab body (rendered)      │  │  [messages]    │
│   …           │ │   · section component             │  │                │
│ ▸ EVIDENCE    │ │   · sidecar result view (inline)  │  │                │
│   🔍 census   │ │   · person profile                │  │                │
│   🔍 fulltext │ │   [⤓ view raw JSON] per-tab        │  │  [textarea ▸]  │
│   📄 capture  │ └───────────────────────────────────┘  │                │
└───────────────┴───────────────────────────────────────┴────────────────┘
* = pinned home tab          Both side rails collapse (laptop width budget)
```

Width reality: on a 1366px laptop, a 240px rail + 360px chat leaves ~700px for
content (census tables/images are wide). **Both side rails must collapse.**

## Implementation

The split: the **tabbed workspace lives in `viewer-ui`** (Electron wants it too,
minus chat); the **chat right-rail + shell flip lives in `apps/web`** (Electron
has no chat). `viewer-ui` stays "the workspace minus chat," embeddable by both
apps. The public export surface in `packages/viewer-ui/src/index.ts` stays
backward-compatible (additive only); `App({ transport })` signature unchanged →
**no Electron change required.**

### A. `viewer-ui` — tabbed middle + Evidence rail (the bulk of the work)

Reuse-first: the 11 section components are zero-prop and read from
`useResearchData()` — they render **unchanged** inside a tab. `SidecarResultCard`,
`DetailPanel` (raw JSON), and `PersonCard` are reused as-is.

**New — tab state** (`src/contexts/WorkspaceProvider.tsx` + `WorkspaceContext.ts`),
mounted inside `ResearchDataProvider` so it can read `research`/`getById`. Kept
out of `ResearchDataContext` to avoid churning the data context and its tests.

```ts
type TabRef =
  | { kind: 'section';  key: string }       // id = `section:${key}`
  | { kind: 'evidence'; logId: string }     // id = `evidence:${logId}`
  | { kind: 'person';   personId: string }  // id = `person:${personId}`
type Tab = { id: string; ref: TabRef; title: string; pinned?: boolean; rawJson: boolean }
// state: { tabs: Tab[]; activeId: string }; seed one pinned 'Overview' (project_overview)
// openTab(ref): focus if id exists else append + activate   (the "open or focus" rule)
// closeTab(id) (no-op if pinned); setActive(id); toggleRawJson(id)
```

**New — Evidence derivation** (`src/lib/evidence.ts`, pure + unit-tested):

```ts
deriveEvidence(research): EvidenceItem[]   // memoized on `research`
  for entry of research.log:
    if entry.results_ref          → { kind:'search',  logId, tool, performed, examined, available }
    if entry.external_site?.capture_received && .capture_filename
                                  → { kind:'capture', logId, site, filename, performed }
  // sort by `performed` asc (log is append-only → list grows monotonically)
```

**New components** (`src/components/workspace/`): `WorkspaceShell` (3-pane CSS
grid; hosts a slot the web app fills with chat), `WorkspaceRail` (wraps existing
`Sidebar` Sections zone + new `EvidenceList`), `EvidenceList`, `TabBar`,
`TabContent` (switch on `tab.ref.kind` → section component | `SidecarResultView`
| `PersonProfile`; raw-JSON overlay via reused `DetailPanel`), `PersonProfile`
(thin: `PersonCard` + related `assertions`/`person_evidence`). Plus the
extracted `src/components/shared/SidecarResultView.tsx` — the **inner** body of
`SidecarPanel` (its `SummaryStrip`/`LoadedBody`/`SidecarResultCard` + loading/
missing/error branches) **without** the modal `FocusTrap`/`overlay`/`backdrop`,
so it renders inline in an evidence tab.

**Modify:**
- `src/App.tsx` — `AppContent` renders `<WorkspaceProvider><WorkspaceShell>`
  instead of the flex `Sidebar | content(<ActiveSection/>) | <SidecarPanel/>`.
  Move the `sectionComponents` map into `TabContent`. Keep `Header` +
  `ProgressPipeline` above the tab bar.
- `src/components/shared/CrossLink.tsx` — `handleClick` calls `openTab(...)`
  (person target → `{kind:'person'}`, else map section via the existing
  `sectionNavMap` → `{kind:'section'}`) instead of `setActiveSection`; keep the
  `requestAnimationFrame` scroll-to-`#id`, run it after the tab activates.
- `src/components/sections/ResearchLogSection.tsx` (~L160) and
  `AssertionsSection.tsx` (~L68) — swap `openSidecar(...)` → `openTab({kind:
  'evidence', logId})` (carry the focus persona into `SidecarResultView`).
- `src/components/layout/Sidebar.tsx` — section buttons call
  `openTab({kind:'section', key})`; keep dev/theme footer.
- `src/index.ts` — additive exports (`WorkspaceProvider`, tab types).

**Delete (last, after call sites migrate):** `SidecarPanel.tsx` + its CSS +
its two tests. Keep them until then so the suite stays green; add fresh tests
against `SidecarResultView`.

### B. `apps/web` — chat to the right, collapsible

- `src/components/SessionView.tsx` — reorder so `<ViewerApp/>` comes first and
  `<aside className="chatPane">` last; move the FS-status header into the
  viewer's `Header` or keep a slim chat header.
- `src/styles.css` `.sessionShell` — flip the grid from
  `minmax(300px,380px) 1fr` (chat | viewer) to `1fr minmax(320px,400px)`
  (viewer | chat); add a collapsed state (chat → a thin toggle strip).

## Phasing (each increment ships independently)

1. **Tabbed middle** (A: tab state + `TabBar`/`TabContent` + `SidecarResultView`
   + CrossLink/section/log/assertion call-site swaps). Replaces the modal drawer
   with inline evidence tabs. Highest value, self-contained.
2. **Evidence rail** (A: `deriveEvidence` + `EvidenceList` + two-zone
   `WorkspaceRail`).
3. **Chat-right shell** (B). Cosmetic/layout; low risk.
4. **Follow-up (out of scope here):** image/PDF byte-viewer — new
   `readArtifact(relPath)` transport method in Electron main (path-traversal
   guarded, scoped to project folder) + `WsResearchTransport`.
   **Stretch:** split/compare view (two tab bodies side by side — high value for
   genealogy's "is this the same person?" comparisons).

## Verification

- **Unit:** `lib/__tests__/evidence.test.ts` (derivation: `results_ref` →
  search item; `capture_received` + `filename` → capture item; zero-result
  entries → none; chronological order). New `SidecarResultView` tests mirror the
  old modal-content assertions (loading/loaded/missing/error, focus-persona
  expand).
- **Build/regression:** `make test`; viewer-ui's existing section + provider
  tests stay green (we do not touch `ResearchDataState`/`mockContext`).
- **Electron smoke:** launch `apps/electron` against a fixture project (e.g.
  `eval/fixtures/scenarios/…`) — confirm `<ViewerApp>` mounts, sections open as
  tabs, log "view results" opens an inline evidence tab, raw-JSON toggle works.
- **Web E2E:** `make server` + `make web`, open a session — chat on the right
  (collapsible), section/evidence clicks open tabs, cross-links open/focus tabs,
  both rails collapse at laptop width.

## Open questions for review

1. **Evidence ordering** — chronological (as written) vs. grouped by tool/kind?
   Chronological best conveys "watch the case file fill up"; grouping scales
   better once there are dozens of searches.
2. **Tab proliferation** — cap open tabs / add "close others"? Genealogists may
   open many evidence tabs while comparing.
3. **Capture viewer priority** — is the image/PDF byte-viewer (follow-up #4) a
   near-term must, or acceptable as metadata-only for the POC?
4. **Split view** — worth pulling forward from stretch, given how central
   side-by-side record comparison is to genealogy?
