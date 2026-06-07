# Schema sync 2026-05-25: results retention + timeline conflict fields

Catches the UI up with three upstream commits that landed in `cowork-genealogy`
between 2026-05-21 and 2026-05-24, after our last sync (`f9c39c8`).

Upstream commits in scope:
- `58727df` (2026-05-21) — Research log result retention (sidecars, persona ids, transcription)
- `861d3c9` (2026-05-22) — Timeline conflict/note fields
- `ec02560` (2026-05-24) — `narration_guidance` allows null

## Schema delta

### Added
| Path | Type | Source |
|------|------|--------|
| `log_entry.results_ref` | `string \| null` | sidecar pointer (`results/log_NNN.json`) |
| `log_entry.results_available` | `integer \| null` | total API result count, often > `results_examined` |
| `source.transcription` | `string \| null` | image_read verbatim transcription |
| `source.log_entry_id` | `string \| null` | back-link to capturing log entry |
| `assertion.record_persona_id` | `string \| null` | GedcomX persona id within the sidecar payload |
| `timeline_event.conflict_ids` | `string[] \| null` | conflicts affecting this event |
| `timeline_event.conflict_note` | `string \| null` | note about the conflict |
| `timeline_gap.notes` | `string \| null` | note about the gap |

### Removed
| Path | Replacement |
|------|-------------|
| `log_entry.captured_source_ids` | reverse lookup: `sources.filter(s => s.log_entry_id === entry.id)` |
| `log_entry.produced_assertion_ids` | reverse lookup: `assertions.filter(a => a.log_entry_id === entry.id)` |

### Widened
| Path | Old | New |
|------|-----|-----|
| `researcher_profile.narration_guidance` | `string \| undefined` | `string \| null \| undefined` |

## Sidecar payload shape (new)

Per `research-schema-spec.md` §5.4.1, each non-empty search writes
`results/<log_id>.json`:

```json
{
  "log_id": "log_001",
  "tool": "record_search" | "fulltext_search",
  "retrieved": "2026-05-04T10:00:00Z",
  "returned_count": 1,
  "payload": { /* verbatim MCP tool response */ }
}
```

`payload.results[]` shape varies by `tool`. The two we render:

**`record_search`** — each result carries a `primaryId` (GedcomX person id of
the focus persona) and an embedded `gedcomx: { persons, relationships }`
subtree describing the household. Other result-level fields: `personId`
(FamilySearch tree id), `personName`, `score`, `arkUrl`, `collectionTitle`,
`recordTitle`, plus FAQ-style `birthDate`/`birthPlace`/`events`.

**`fulltext_search`** — no GedcomX; each result has `id` (ark URL),
`collectionTitle`, `recordType`, `recordPlace`, `textDocument` (snippet),
`names[]`, `places[]`, `highlightTerms[]`.

## Buckets

### Bucket A — Breaking fix (~30 min)
The UI currently reads `captured_source_ids` / `produced_assertion_ids` at
`ResearchLogSection.tsx:106-119`. Against a conformant `research.json` from
the new pipeline those keys are absent and `.length`/`.map` throw.

1. **`src/renderer/src/lib/schema.ts`** — `LogEntry`:
   - Remove `captured_source_ids` and `produced_assertion_ids`.
   - Add `results_ref?: string | null` and `results_available?: number | null`.
2. **`src/renderer/src/components/sections/ResearchLogSection.tsx`** —
   replace the two fields in the Sources/Assertions cells with derived lookups:
   ```ts
   const capturedSources = sources.filter(s => s.log_entry_id === entry.id)
   const producedAssertions = assertions.filter(a => a.log_entry_id === entry.id)
   ```
   Compute once per render (memoized by `entry.id`) — both arrays are
   small in practice.
3. **`src/renderer/src/lib/__fixtures__/patrick-flynn.ts`** and
   **`test/fixtures/sample-project/research.json`** —
   - Drop `captured_source_ids` / `produced_assertion_ids` from every log entry.
   - Add `log_entry_id` to the existing sources and assertions so the reverse
     lookup yields the same display.
   - Add `results_ref: "results/log_NNN.json"` and `results_available` to
     non-nil search entries.
4. **Run `validate_project.py`** on the updated `test/fixtures/sample-project/`
   to confirm it still passes the upstream validator (we did this in the last
   sync — keep the contract).

### Bucket B — New schema field surfaces (~3 hr)

Each addition gets one natural rendering location. All conditional on the
field being present so older projects continue to render cleanly.

**B1. `assertion.record_persona_id`** — `AssertionsSection.tsx`. Add a small
row below the existing Record row:
> Persona: `P1` (`IBM Plex Mono` for the id)

The persona id is rendered as `<CrossLink>`-style amber link that calls
`openSidecar(entry.log_entry_id, record_persona_id)` — see D5 for the focus
treatment in the drawer.

**B2. `source.transcription`** — `SourcesSection.tsx`. Add an expandable
Transcription field below Notes. Render the string in a `<pre>` with
`background: var(--bg-code)`, `font-family: var(--font-mono)`, `font-size: 12px`,
`padding: var(--spacing-sm)`, `border-radius: var(--border-radius-sm)` —
matches the existing `queryBlock` pattern in `ResearchLogSection.module.css`.
Long transcriptions get a "Show more / Show less" toggle at ~300 chars.

**B3. `source.log_entry_id`** — `SourcesSection.tsx`. Add to the footer
beside the existing GedcomX cross-link:
> Captured by: `<CrossLink id={source.log_entry_id} />`

Also: this is the field that powers Bucket A's reverse lookup, so the wiring
already exists.

**B4. Sidecar viewer (the big one — see "Sidecar viewer design" below).**

**B5. `timeline_event.conflict_ids` + `conflict_note`** —
`TimelinesSection.tsx`. When an event has `conflict_ids`, render a chip below
the event header using the existing conflict tokens — `background: var(--conflict-unresolved-bg)`,
`border: 1px solid var(--conflict-unresolved-border)`, `color: var(--text-primary)`,
`padding: var(--spacing-xs) var(--spacing-sm)`, `border-radius: var(--border-radius-sm)`.
Format: `Conflict (N) — <conflict_note>`, with each `conflict_ids[i]` rendered
as `<CrossLink>` to ConflictsSection. (Matches ConflictsSection styling; do
NOT introduce a red badge — the codebase has dedicated warm-sandstone tokens
for this exact case.)

**B6. `timeline_gap.notes`** — `TimelinesSection.tsx`. Gaps already render
between events; add the `notes` string as italic supplementary text
(`color: var(--text-tertiary)`, `font-style: italic`, `font-size: 12px`,
`margin-top: var(--spacing-xs)`) under the gap's existing severity badge.

### Bucket C — Type widening (~5 min)
**`src/renderer/src/lib/schema.ts`** — `ResearcherProfile.narration_guidance`
becomes `string | null`. No component change needed (`{value && ...}` already
guards both).

## Design decisions (locked 2026-05-25 via /plan-design-review)

These calibrate every visual choice in this plan against the existing
"Warm Scholarly Editorial" theme defined in `src/renderer/src/styles/global.css`.

### Layout direction (D1)
Right-side slide-in drawer, 600px wide on windows ≥ 1100px (see D7).
Stacked vertical result cards. First result card expanded by default; rest
collapsed. Reuses `PersonCard`, `CrossLink`, `StatusBadge`, and the
`expandedContent` surface pattern from `ResearchLogSection.module.css`.

### Information hierarchy (D2)
- **Drawer header (~64px, `background: var(--bg-secondary)`):**
  Cormorant H1 "Record Search Results" (or "Fulltext Search Results") is the
  loudest element. Subtitle line in body sans: `log_001 · 2026-05-04`
  (log_id in `var(--font-mono)`). Close `×` button top-right.
- **Summary strip (~32px):** small uppercase tracked text:
  `TOOL  record_search · EXAMINED 12 OF 187 RETURNED`. `border-top` + `border-bottom`
  with `var(--border-color)`.
- **Result card hierarchy (per card):** Cormorant `recordTitle` (18px) is
  loudest. Below: `score 0.94 · View on FamilySearch →` (amber link). Then
  `PERSONS` section label (`var(--text-tertiary)`, tracked uppercase).
- **Person ordering inside `gedcomx.persons[]`:** PRIMARY first (with
  `[PRIMARY]` pill, top-right of card, amber-gold background) → spouse(s) →
  children (eldest first) → parents → siblings → other. Use
  `relationshipFromPerspective` to bucket; within each bucket preserve
  payload order.

### Sidecar fetch states (D3)
Spec all four states inside the drawer; the user clicked deliberately, so
closing the drawer on failure feels like rejection.

| State | Trigger | Drawer body |
|-------|---------|-------------|
| LOADING | `readSidecar(logId)` pending | Header renders immediately with `log_id` and Cormorant title skeleton. Body shows centered scholarly text "Loading…" with a thin amber progress strip across the top of the body. |
| MISSING | `readSidecar` returns `null` | Header normal. Body: Cormorant "Results file not found" + body sans "`results/log_001.json` is missing from this project folder." Single `Close` button. |
| ERROR | `readSidecar` throws (size cap, invalid id, JSON parse) | Header normal. Body: Cormorant "Couldn't load results" + the error message in `var(--font-mono)` `var(--bg-code)` block. Buttons: `Try again` (re-invokes `readSidecar`) and `Close`. |
| EMPTY | `payload.results[]` is `[]` | Header normal. Summary strip shows `EXAMINED 0 OF 0`. Body: italic `var(--text-tertiary)` "This search returned no results." centered. |

### Drawer dismiss + focus management (D4)
- ESC closes. Click on the dimmed area outside the drawer closes.
  `×` button closes.
- On open: focus moves to the close `×` button (skipping the H1 which is not
  focusable). `role="dialog"`, `aria-modal="true"`, `aria-labelledby` pointing
  to the drawer title.
- Focus trap: Tab cycles between focusable elements inside the drawer only.
- On close: focus returns to the trigger button (the "View Results" button
  on the log row, or the "Persona" link in AssertionsSection).
- The dimmed table behind is `aria-hidden="true"` while the drawer is open.

### Focus persona highlight (D5)
When opened via assertion's "View in record" link, the drawer:
1. Auto-scrolls to the result whose `payload.results[].primaryId` or
   `gedcomx.persons[].id` matches `focusPersonaId`.
2. Renders that person card with:
   - `border-left: 3px solid var(--accent-gold)` (overrides the default
     1px `var(--border-color)`)
   - A `MATCHED` pill in the upper-right (same styling as `PRIMARY` pill,
     swap label text).
3. Highlight clears when the user clicks anywhere inside the drawer (set
   `focusPersonaId` to `null` in panel-local state on body click).

### Conflict chip styling (D6)
B5 chip uses `--conflict-unresolved-bg` + `--conflict-unresolved-border`
(already in `:root`). Format: `Conflict (N) — <conflict_note text>`. The
count `(N)` is plain text; `conflict_ids` are rendered as separate
`<CrossLink>` elements to the right of the note (one per id). Do NOT
introduce a red badge.

### Narrow-window behavior (D7)
- Window ≥ 1100px: drawer is `min(600px, 90vw)` wide, dimmed table peeks
  through on left.
- Window < 1100px: drawer takes full viewport width, no dim layer behind it.
- No `BrowserWindow` min-size change. Users may resize freely; the
  responsive `@media` rule handles narrow widths.

### Accent-gold contrast (D8)
Fix the contrast gap for all small-text amber usage as part of this plan
(not as a follow-up). Two coordinated changes:

1. **`src/renderer/src/styles/global.css`** — introduce `--accent-gold-strong`
   in both light and dark theme blocks:
   - Light theme: `--accent-gold-strong: #8a6608` (~6.0:1 against `--bg-primary`)
   - Dark theme: `--accent-gold-strong: #e8b75c` (~7.2:1 against `--bg-primary`)
   - Keep `--accent-gold` unchanged for large/decorative uses (selection
     highlight, link hover, PRIMARY/MATCHED pill backgrounds).
2. **Swap small-text usage to `--accent-gold-strong`:**
   - `PersonCard.module.css` `.relationship` (0.78rem all-caps)
   - `PersonCard.module.css` `.ark` (link)
   - `SidecarPanel.module.css` relationship labels (rendered at 0.85rem for
     additional headroom, still using strong token)
   - Any new amber link in `AssertionsSection` (B1 persona link)
   - Any new amber link in `SourcesSection` (B3 footer)
3. **Verify with a manual contrast check** during implementation: open the
   app in both themes, confirm relationship labels pass AA at 0.78rem.

Visual impact: relationship labels appear ~10% darker. Acceptable — the
strong token reads as the same warm gold, just one step deeper. Decorative
amber-gold usage (pills, hover states, selection) keeps the lighter token
so the brand color stays prominent.

### Token citations summary
Every new CSS surface must cite tokens from `styles/global.css`. No
hardcoded hex colors, no hardcoded px spacing outside the existing
`--spacing-*` scale (drawer width `600px` is the documented exception).
The `SidecarPanel.module.css` budget moves from ~120 to ~160 lines because
states, focus highlight, and dismiss affordances are now spec'd.

## Engineering decisions (locked 2026-05-25 via /plan-eng-review)

These pin the architectural shape, code structure, test coverage, and
performance posture that downstream implementation must match.

### Watcher architecture (D2 + D3 + D4)

Extend the existing `src/main/watcher.ts` rather than spawning a second
chokidar instance. One lifecycle, one cleanup path, dispatch by basename.

```ts
// src/main/watcher.ts (extended)
const WATCHED_FILES = ['research.json', 'tree.gedcomx.json'] as const

export function startWatching(folderPath: string, mainWindow: BrowserWindow): void {
  stopWatching()
  currentFolderPath = resolve(folderPath)

  const fixedPaths = WATCHED_FILES.map((f) => join(folderPath, f))
  const sidecarGlob = join(folderPath, 'results')

  watcher = watch(fixedPaths, {
    awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },
    ignoreInitial: false
  })
  // Extend the same instance to also watch results/ directory
  watcher.add(sidecarGlob)

  const handleChange = async (filePath: string): Promise<void> => {
    const base = basename(filePath)

    // Fixed-file branch (existing behavior)
    if (WATCHED_FILES.includes(base as FixedFile)) {
      // ... existing read + parse + emit logic ...
      return
    }

    // Sidecar branch (NEW)
    const match = base.match(/^(log_[a-zA-Z0-9_-]+)\.json$/)
    if (!match) return  // ignore README, .DS_Store, anything else
    const logId = match[1]
    const stat = await fs.stat(filePath).catch(() => null)
    if (!stat) return
    mainWindow.webContents.send('project:sidecar-updated', {
      logId,
      mtime: stat.mtimeMs
    })
  }

  watcher.on('add', handleChange)
  watcher.on('change', handleChange)
  watcher.on('unlink', (filePath) => {
    const base = basename(filePath)
    const match = base.match(/^(log_[a-zA-Z0-9_-]+)\.json$/)
    if (match) {
      mainWindow.webContents.send('project:sidecar-updated', {
        logId: match[1],
        mtime: 0  // 0 = deleted/missing sentinel
      })
    }
  })
}
```

The watcher emits `{ logId, mtime }` (pointer, not payload) because:
1. Sidecars can be 10MB; pushing payload over IPC for every change wastes
   bandwidth when the drawer is closed.
2. The renderer guards races by comparing incoming `mtime` against the
   last-fetched `mtime` for the same `logId`.

### Sidecar IPC handler (D7 + D13)

Path validation + size cap stay in the main process. JSON.parse moves to
the **renderer** to keep the main event loop unblocked on large payloads.

```ts
// src/main/index.ts
const SIDECAR_MAX_BYTES = 10 * 1024 * 1024  // shared with research-schema-spec §5.4

ipcMain.handle('project:read-sidecar', async (_e, logId: string) => {
  const state = getCurrentState()
  if (!state.folderPath) return null
  if (typeof logId !== 'string' || !/^log_[a-zA-Z0-9_-]+$/.test(logId)) {
    throw new Error('Invalid log id')
  }
  if (logId.includes('\0')) throw new Error('Invalid log id')  // defense in depth
  const filePath = path.join(state.folderPath, 'results', `${logId}.json`)
  const stat = await fs.stat(filePath).catch(() => null)
  if (!stat) return null  // legitimate not-found → null
  if (stat.size > SIDECAR_MAX_BYTES) {
    throw new Error(`Sidecar exceeds ${SIDECAR_MAX_BYTES / 1024 / 1024}MB cap`)
  }
  // Return RAW STRING; renderer parses to keep main process responsive
  return { raw: await fs.readFile(filePath, 'utf8'), mtime: stat.mtimeMs }
})
```

**Error envelope convention going forward:** throw for programmer errors
(invalid id, size cap, parse failure); return null for legitimate
not-found. Matches existing `open-file` (throws) + `session:get-log`
(returns empty on missing dir).

### Focus trap dependency (D5)

Add `focus-trap-react` to `package.json` (~3KB). Wrap the drawer body:

```tsx
import { FocusTrap } from 'focus-trap-react'

<FocusTrap active={status !== 'closed'} focusTrapOptions={{
  initialFocus: '.closeButton',
  fallbackFocus: '.drawerHeader',
  escapeDeactivates: true,  // ESC closes via deactivate handler
  clickOutsideDeactivates: true,
  returnFocusOnDeactivate: true,
  onDeactivate: closeSidecar
}}>
  <div role="dialog" aria-modal="true" aria-labelledby="sidecarTitle"
       className={styles.drawer}>
    {/* ... */}
  </div>
</FocusTrap>
```

`focus-trap-react`'s `onDeactivate` handles ESC + click-outside + Tab cycle
in one config. We add `aria-hidden="true"` on the backdrop/table separately
via a small effect when status transitions to non-`closed`.

### Sidecar state machine (D6 + D9)

ResearchDataProvider owns the entire sidecar state as a discriminated
union. SidecarPanel renders via exhaustive switch — no ambiguous nulls.

```ts
// src/renderer/src/contexts/ResearchDataContext.ts
export type SidecarState =
  | { status: 'closed' }
  | { status: 'loading'; logId: string; focusPersonaId?: string }
  | {
      status: 'loaded'
      logId: string
      focusPersonaId?: string
      payload: SidecarFile
      expandedResultIds: Set<string>
      lastMtime: number
    }
  | { status: 'missing'; logId: string }
  | { status: 'error'; logId: string; error: Error }

export interface ResearchDataContextValue {
  // ... existing fields ...
  sidecar: SidecarState
  openSidecar(logId: string, focusPersonaId?: string): void
  closeSidecar(): void
  clearFocusPersona(): void  // panel calls on body click
  toggleResultExpanded(resultIndex: number): void  // preserves expansion across re-fetches
}
```

`openSidecar` is idempotent: if invoked with the same `logId` while
already `loaded`, it only updates `focusPersonaId` and re-runs auto-scroll
(does NOT re-fetch — preserves `expandedResultIds` and scroll position).

Watcher subscription in the provider:

```ts
useEffect(() => {
  const unsubscribe = window.api.onSidecarUpdated(({ logId, mtime }) => {
    setSidecar((prev) => {
      if (prev.status === 'closed') return prev  // drawer closed → ignore
      if (prev.logId !== logId) return prev  // different sidecar → ignore
      if (prev.status === 'loaded' && prev.lastMtime === mtime) return prev  // race guard
      // Coalesce: debounce per-logId 100ms
      schedulePendingFetch(logId, mtime)
      return prev
    })
  })
  return unsubscribe
}, [])

// schedulePendingFetch uses a Map<logId, timeoutHandle> to coalesce.
// On fire: call readSidecar(logId), set status='loaded' with new payload
// and lastMtime, PRESERVING expandedResultIds from the previous state.
```

### Pill shared component (D8)

New tiny component, broken out so PRIMARY (D2) and MATCHED (D5) share styling.

```tsx
// src/renderer/src/components/shared/Pill.tsx
import styles from './Pill.module.css'

interface PillProps {
  label: string
  tone?: 'primary' | 'matched'
}

export default function Pill({ label, tone = 'primary' }: PillProps): React.JSX.Element {
  return <span className={`${styles.pill} ${styles[tone]}`}>{label}</span>
}
```

CSS holds the amber-gold styling once. Future status labels can opt in.

### Person ordering helper (D10)

Extend `src/renderer/src/lib/relationship-label.ts` with `orderPersons`:

```ts
export function orderPersons(
  persons: GedcomxPerson[],
  primaryId: string,
  relationships: GedcomxRelationship[]
): GedcomxPerson[] {
  // Returns: PRIMARY → spouse(s) → children (eldest first) → parents →
  // siblings → other (no relationship to primary). Within each bucket,
  // preserve payload order.
}
```

Bucketing uses `relationshipFromPerspective` to classify each person, then
groups by the returned label. Eldest-first within children sorts by Birth
fact date (missing dates sort last, preserving payload order among them).

### SidecarResultCard contract (D10)

```tsx
// src/renderer/src/components/shared/SidecarResultCard.tsx
interface SidecarResultCardProps {
  result: RecordSearchResult | FulltextSearchResult
  tool: 'record_search' | 'fulltext_search'
  focusPersonaId?: string
  defaultExpanded: boolean
  onPersonClick?: () => void  // calls clearFocusPersona() in provider
}
```

The card owns its own expanded state (local `useState`, seeded from
`defaultExpanded`). SidecarPanel passes `defaultExpanded={index === 0}` for
the first card. Body click handler bubbles up via `onPersonClick` so the
provider can drop `focusPersonaId`.

### Reverse-lookup index (D12)

In `ResearchLogSection.tsx`, build two Maps once per render:

```tsx
const sourcesByLogEntry = useMemo(() => {
  const map = new Map<string, Source[]>()
  for (const s of sources) {
    if (!s.log_entry_id) continue
    const list = map.get(s.log_entry_id) ?? []
    list.push(s)
    map.set(s.log_entry_id, list)
  }
  return map
}, [sources])

const assertionsByLogEntry = useMemo(() => {
  // ... same shape, keyed by assertion.log_entry_id ...
}, [assertions])

// Per row:
const capturedSources = sourcesByLogEntry.get(entry.id) ?? []
const producedAssertions = assertionsByLogEntry.get(entry.id) ?? []
```

O(n+m) build, O(1) lookup per row. Replaces the per-row `filter()` from
Bucket A's original spec.

### Scroll preservation across watcher refresh (P5)

When the watcher fires `project:sidecar-updated` and the provider re-fetches,
SidecarPanel must preserve the user's scroll position inside the drawer
body. Implementation: capture `drawerBodyRef.current.scrollTop` before
state transition, restore it in `useLayoutEffect` after the re-render.
~6 LOC.

### Breaking-change verification (Bucket A)

Before merging the Bucket A PR, the implementer MUST grep the codebase for
all callers of `captured_source_ids` and `produced_assertion_ids`:

```bash
rg "captured_source_ids|produced_assertion_ids" src/ test/
```

Expected: zero matches after the change (other than the test fixtures being
migrated). TypeScript will catch compile-time references, but the grep
verifies fixtures and JSON sample files are clean.

## Sidecar viewer design (Bucket B4 in detail)

This is the new view the user called out specifically. Three concerns:
**IPC plumbing**, **rendering**, and **navigation**.

### IPC plumbing

Sidecars live in `<projectFolder>/results/<log_id>.json` and are loaded
**on demand** — we don't want to slurp all sidecars at startup (a long
research project could have hundreds). Two changes:

1. **`src/main/index.ts`** — new IPC handler `project:read-sidecar`:
   ```ts
   ipcMain.handle('project:read-sidecar', async (_e, logId: string) => {
     const state = getCurrentState()
     if (!state.folderPath) return null
     if (!/^log_[a-zA-Z0-9_-]+$/.test(logId)) throw new Error('Invalid log id')
     const filePath = path.join(state.folderPath, 'results', `${logId}.json`)
     const stat = await fs.stat(filePath).catch(() => null)
     if (!stat) return null
     if (stat.size > 10 * 1024 * 1024) throw new Error('Sidecar too large')
     const content = await fs.readFile(filePath, 'utf8')
     return JSON.parse(content)
   })
   ```
   Strict log-id regex prevents path traversal. 10 MB cap matches the search
   protocol's chunking ceiling.

2. **`src/preload/index.ts`** — expose `readSidecar(logId: string)`.

3. **`src/main/watcher.ts`** — extended via the dispatcher pattern (see
   "Engineering decisions → Watcher architecture (D2 + D3 + D4)" and
   "Sidecar file watcher" sections). Emits `project:sidecar-updated` with
   `{ logId, mtime }` pointer payload, debounced via chokidar's
   `awaitWriteFinish` + per-logId coalesce in the renderer.

### Rendering

New file: **`src/renderer/src/components/shared/SidecarPanel.tsx`** — a
DetailPanel-style modal/drawer that opens over the main view.

State (local to the panel):
- `logId: string` (which sidecar to load)
- `sidecar: SidecarFile | null` (loaded payload)
- `error: string | null`
- `focusPersonaId: string | null` (which result to scroll to, if cross-linked from an assertion's `record_persona_id`)

On mount: call `window.api.readSidecar(logId)`, store result.

Render branch on `sidecar.tool`:

**`record_search` branch** — one collapsible card per result:
- Header: `recordTitle` · `collectionTitle` · `score` · `arkUrl` (opens
  external on click)
- **Persons subview** (the user's specific ask): render the result's
  `gedcomx.persons[]` from the primary person's point of view.
  - Primary person card first, highlighted (label: "Primary").
  - Other persons below, each labeled with their relationship to primary
    derived from `gedcomx.relationships[]`. The derivation logic goes in a
    new helper, see "Relationship from perspective" below.
  - Each person card shows: preferred name, gender, facts (Birth, Residence,
    etc.) with dates/places.

**`fulltext_search` branch** — one card per result:
- Header: `recordTitle` (or `id`) · `collectionTitle` · `recordType`
- Body: `textDocument` snippet with `highlightTerms` bolded
- Footer: Names list, Places list

**Other tools** — fallback to raw JSON view (we already have a `<pre>`
pattern in ResearchLogSection's dev mode).

### Relationship from perspective

New helper in **`src/renderer/src/lib/relationship-label.ts`** (extending the
existing module):

```ts
export function relationshipFromPerspective(
  primaryId: string,
  otherId: string,
  primaryGender: Gender,
  relationships: GedcomxRelationship[]
): string
```

Walks `relationships` and returns one of:
- `"Self"` (otherId === primaryId)
- `"Father"` / `"Mother"` (ParentChild where parent=other, child=primary; gender of other picks word)
- `"Son"` / `"Daughter"` (ParentChild where parent=primary, child=other; gender of other picks word)
- `"Husband"` / `"Wife"` (Couple including both; gender of other picks word)
- `"Sibling"` / `"Brother"` / `"Sister"` (both are children of a common parent)
- `"Grandfather"` / `"Grandmother"` / `"Grandson"` / `"Granddaughter"` (two-hop ParentChild)
- `"Relative"` (fallback — present in record but no traversable link)

Two-hop coverage is enough for census households; deeper graph traversal can
wait until we hit a case. Subtype awareness ("Adoptive father") reuses
`visibleSubtype` from the existing helper.

Unit tests in `__tests__/relationship-label.test.ts` (extend the existing
file): cover each label, gender flipping, subtype prefix, sibling-by-shared-
parent, two-hop grandparent, and the fallback.

### Navigation

Two entry points open the sidecar:

1. **From the research log** — `ResearchLogSection` renders a "View Results"
   button on rows where `results_ref !== null`. Button label includes
   `results_available` if it exceeds `results_examined`:
   > View results (12 examined of 187 returned)

2. **From an assertion** — when an assertion has `record_persona_id`,
   `AssertionsSection` adds a "View in record" link that opens the sidecar
   for the assertion's `log_entry_id` and scrolls to the matching result
   (matched by walking `payload.results[]` and finding the one whose
   `primaryId` or `gedcomx.persons[].id` equals `record_persona_id`).

Lift sidecar state into `ResearchDataProvider` (a single open sidecar at a
time) so both entry points share it. Add to context:
```ts
openSidecar: (logId: string, focusPersonaId?: string) => void
closeSidecar: () => void
sidecar: { logId, payload, focusPersonaId } | null
```

## File-by-file change list

```
package.json                                                  +1    add focus-trap-react dependency
src/main/index.ts                                             +25   IPC handler (path val + size cap, returns raw string) + SIDECAR_MAX_BYTES const
src/main/watcher.ts                                           +35   extend with sidecar dispatcher (basename routing, mtime sentinel, awaitWriteFinish already present)
src/main/__tests__/index.test.ts                              +120  NEW (IPC tests: path traversal, size cap, missing, happy path)
src/main/__tests__/watcher.test.ts                            +100  NEW (dispatcher tests: log_*.json routing, ignore non-matching, cleanup)
src/preload/index.ts                                          +3    expose readSidecar + onSidecarUpdated
src/preload/index.d.ts                                        +5    types
src/renderer/src/styles/global.css                            +6    --accent-gold-strong in light + dark themes
src/renderer/src/lib/schema.ts                                ±25   schema delta (A1, B*, C) + treeMatches type + SidecarFile/RecordSearchResult/FulltextSearchResult types
src/renderer/src/lib/relationship-label.ts                    +120  relationshipFromPerspective + orderPersons
src/renderer/src/lib/__tests__/relationship-label.test.ts     +150  extend with all relationshipFromPerspective cases + orderPersons cases
src/renderer/src/contexts/ResearchDataContext.ts              +25   SidecarState discriminated union + action types
src/renderer/src/contexts/ResearchDataProvider.tsx            +90   sidecar state reducer + watcher subscription + per-logId coalesce + race guard
src/renderer/src/contexts/__tests__/ResearchDataProvider.test.tsx  +180  NEW (state machine + coalescing + race guard)
src/renderer/src/components/sections/ResearchLogSection.tsx   ±50   sourcesByLogEntry/assertionsByLogEntry index Maps + "View Results" button
src/renderer/src/components/sections/__tests__/ResearchLogSection.regression.test.tsx  +60  NEW CRITICAL (reverse-lookup regression for Bucket A)
src/renderer/src/components/sections/SourcesSection.tsx       +25   transcription + captured-by (token citations)
src/renderer/src/components/sections/__tests__/SourcesSection.test.tsx  +80  NEW
src/renderer/src/components/sections/AssertionsSection.tsx    +15   persona row + view-in-record
src/renderer/src/components/sections/__tests__/AssertionsSection.test.tsx  +60  NEW
src/renderer/src/components/sections/TimelinesSection.tsx     +30   conflict chip + gap notes
src/renderer/src/components/sections/TimelinesSection.module.css  +25   conflict chip + gap notes styles
src/renderer/src/components/sections/__tests__/TimelinesSection.test.tsx  +90  NEW
src/renderer/src/components/shared/PersonCard.module.css      ±4    swap .relationship + .ark to --accent-gold-strong
src/renderer/src/components/shared/Pill.tsx                   +30   NEW (shared PRIMARY/MATCHED pill)
src/renderer/src/components/shared/Pill.module.css            +25   NEW
src/renderer/src/components/shared/__tests__/Pill.test.tsx    +40   NEW
src/renderer/src/components/shared/SidecarPanel.tsx           +280  NEW (status switch + focus-trap-react + scroll preservation + aria-hidden backdrop)
src/renderer/src/components/shared/SidecarPanel.module.css    +180  NEW (drawer + states + responsive @media + matched highlight)
src/renderer/src/components/shared/__tests__/SidecarPanel.test.tsx  +200  NEW (all 5 status branches + focus highlight + tree matches + a11y)
src/renderer/src/components/shared/SidecarResultCard.tsx      +90   NEW (local expanded state, persons via orderPersons, tree matches)
src/renderer/src/components/shared/SidecarResultCard.module.css  +50  NEW
src/renderer/src/components/shared/__tests__/SidecarResultCard.test.tsx  +100  NEW
src/renderer/src/lib/__fixtures__/patrick-flynn.ts            ±60   field migrations
src/renderer/src/lib/__fixtures__/patrick-flynn-sidecar.ts    +120  NEW (sidecar w/ treeMatches + multi-person household)
test/fixtures/sample-project/research.json                    ±40   field migrations
test/fixtures/sample-project/results/log_001.json             +NEW  NEW (sidecar w/ treeMatches)
```

Estimated total: ~2300 lines added, ~180 lines changed. Tests are roughly
40% of the diff (~900 LOC) — the breakdown that matches the user's
preference "I'd rather have too many tests than too few."

## Tests

Full coverage spec per /plan-eng-review D11. Every new code path gets a
test; two regression tests for Bucket A are mandatory.

### Regression tests (CRITICAL — Bucket A)

- `src/renderer/src/components/sections/__tests__/ResearchLogSection.regression.test.tsx`
  - Load a fixture log entry that has 3 captured sources (matched via the
    new reverse lookup). Render `<ResearchLogSection>`. Assert that the
    Sources cell shows count `3` and renders 3 `CrossLink` elements with
    matching ids. **MUST FAIL** if `sourcesByLogEntry` lookup breaks.
  - Same shape for `produced_assertion_ids` → 2 assertions via reverse
    lookup, count `2`, 2 CrossLinks rendered.

### Existing test extensions

- `src/renderer/src/lib/__tests__/relationship-label.test.ts` — extend with:
  - `relationshipFromPerspective` cases: Self, Father/Mother (parent gender
    flip), Son/Daughter (child gender flip), Husband/Wife (couple), Brother/
    Sister (shared parent), Grandfather/Grandmother/Grandson/Granddaughter
    (2-hop), Adoptive subtype prefix, Relative fallback.
  - `orderPersons` cases: PRIMARY first; spouse → children → parents →
    siblings → other ordering; children sorted eldest-first by Birth date;
    persons without relationships bucketed as "other"; payload order
    preserved within each bucket.

### New main-process tests

- `src/main/__tests__/index.test.ts` (NEW file — first main-process test):
  - IPC `project:read-sidecar`:
    - Invalid logId (regex fail): throws `Error('Invalid log id')`
    - logId with null byte: throws
    - logId with `..` traversal: throws (regex rejects)
    - File missing: returns null
    - File over `SIDECAR_MAX_BYTES`: throws size-cap error
    - Happy path: returns `{ raw: string, mtime: number }`
- `src/main/__tests__/watcher.test.ts` (NEW file):
  - Sidecar dispatcher: `results/log_001.json` change → emits
    `project:sidecar-updated` with `{ logId: 'log_001', mtime }`
  - `results/README.md` change: no event emitted
  - `results/log_001.json.tmp` change: no event emitted (regex rejects)
  - `awaitWriteFinish` setting present on chokidar config
  - `stopWatching` cleans up both fixed-file and sidecar subscriptions
  - Unlink event: emits with `mtime: 0` sentinel

### New context/provider tests

- `src/renderer/src/contexts/__tests__/ResearchDataProvider.test.tsx` (NEW):
  - State reducer (D9 discriminated union):
    - `closed` + `openSidecar(logId)` → `loading`
    - `loading` + fetch success → `loaded` with payload, lastMtime,
      empty expandedResultIds
    - `loading` + fetch returns null → `missing`
    - `loading` + fetch throws → `error` with error
    - `loaded` + `closeSidecar()` → `closed` (expandedResultIds dropped)
    - `loaded` + `clearFocusPersona()` → `loaded` with focusPersonaId removed
    - `loaded` + `openSidecar(sameLogId, newPersonaId)` → only
      focusPersonaId changes, no re-fetch
    - `loaded` + `toggleResultExpanded(2)` → set toggles membership of 2
  - Watcher coalescing (D4):
    - 50 `sidecar-updated` events for same logId in 100ms → exactly 1
      `readSidecar` call after debounce window
    - Events for different logIds: no coalescing, each fires independently
  - Race guard: incoming mtime equal to lastMtime → no re-fetch
  - Closed drawer: incoming event for any logId → ignored

### New component tests

- `src/renderer/src/components/shared/__tests__/SidecarPanel.test.tsx` (NEW):
  - Status branches: closed renders null; loading renders skeleton + progress
    strip; loaded renders header + summary strip + result cards; missing
    renders "Results file not found" copy; error renders message + Try again.
  - Focus highlight (D5): mounting with `focusPersonaId` results in
    matching person card having `.matched` class and MATCHED pill.
  - Body click → calls `clearFocusPersona` from context.
  - Tree matches: renders TREE MATCHES block when array non-empty; absent
    when missing or empty.
  - `aria-hidden="true"` set on backdrop element when status !== 'closed'.
- `src/renderer/src/components/shared/__tests__/SidecarResultCard.test.tsx`
  (NEW): renders title + score; defaultExpanded=true shows body,
  defaultExpanded=false shows collapsed header only; click header toggles;
  persons rendered in `orderPersons` order (verify by checking name order
  in DOM); treeMatches block only when non-empty.
- `src/renderer/src/components/shared/__tests__/Pill.test.tsx` (NEW):
  renders label; tone='primary' applies `.primary` class; tone='matched'
  applies `.matched` class; default tone is 'primary'.
- `src/renderer/src/components/sections/__tests__/AssertionsSection.test.tsx`
  (NEW): persona row renders when `record_persona_id` present; absent when
  null; click invokes `openSidecar(log_entry_id, record_persona_id)` from
  context.
- `src/renderer/src/components/sections/__tests__/SourcesSection.test.tsx`
  (NEW): transcription renders when present; absent when null/undefined;
  Show more/less toggle at >300 chars; "Captured by" CrossLink when
  `log_entry_id` present.
- `src/renderer/src/components/sections/__tests__/TimelinesSection.test.tsx`
  (NEW): conflict chip renders only when `conflict_ids.length > 0`; chip
  uses `--conflict-unresolved-*` tokens; each id rendered as CrossLink;
  gap notes render italic when present, absent when null.

### Manual verification

- `validate_project.py` against `test/fixtures/sample-project/` — must still
  pass after the field migration (Bucket A) and the new sidecar fixture
  (Bucket B).
- Manual contrast check: open the app in light + dark theme, verify
  relationship labels remain legible with `--accent-gold-strong` at both
  0.78rem (PersonCard) and 0.85rem (SidecarPanel).
- Manual focus-trap check: open the drawer, press Tab repeatedly, confirm
  focus cycles inside the drawer; press ESC, confirm focus returns to the
  "View Results" trigger button.

### Test budget

Expected ~12 test files (8 new, 1 regression file, 3 existing extensions).
Roughly 150-200 individual assertions. With CC the implementation cost is
~30-60 min total alongside the feature code; without CC it would be ~4-6 hr.

## Originally open questions — now resolved into the plan

All four "open questions" from the first draft are settled and folded into
the scope below. Cross-references show where each is implemented.

1. **Watcher coverage for `results/`.** RESOLVED — included in this plan
   (see "Sidecar file watcher" below). Sidecars are append-only by spec, but
   a long-running session that captures new searches needs the open drawer
   to refresh, otherwise the user re-opens the drawer to see new results.
2. **Sidecar panel placement.** RESOLVED via D1 — right-side slide-in
   drawer, stacked cards. Spec in "Design decisions" above.
3. **`treeMatches` in record_search results.** RESOLVED — included in this
   plan (see "Tree matches rendering" below). Adds a small footer block per
   result card listing matched FamilySearch tree persons with external links.
4. **Persona match for B2's "View in record" link.** RESOLVED via D5 — the
   `focusPersonaId` flow uses `log_entry_id` + `record_persona_id` and
   highlights the matching person card with amber-gold left border + MATCHED
   pill.

## Sidecar file watcher

**`src/main/watcher.ts`** — extend the existing project watcher to also
watch `<projectFolder>/results/*.json`. When a sidecar changes (created,
modified, or deleted), emit a new IPC event:

```ts
mainWindow.webContents.send('project:sidecar-updated', { logId: 'log_042' })
```

The `logId` is derived from the filename (`log_042.json` → `log_042`).
Files outside the `log_*.json` pattern are ignored.

**`src/preload/index.ts`** — expose `onSidecarUpdated(handler: (logId: string) => void)`.

**`src/renderer/src/components/shared/SidecarPanel.tsx`** — subscribe on
mount. If the updated `logId` matches the panel's open `logId`, re-invoke
`readSidecar(logId)` and replace the payload. If the panel is closed,
ignore the event.

This keeps the drawer fresh during a live research session without
requiring the user to close + reopen. Append-only semantics mean the
re-render only adds result cards — it never invalidates the user's
expansion state on existing cards (preserve `expandedResultIds` set across
re-renders, key new results by index).

## Tree matches rendering

The `record_search` payload may include `treeMatches[]` per result: an
array of `{ personId, personName, treeId, ark }` linking the record to one
or more FamilySearch family tree persons. Render at the bottom of each
result card (only when the array is non-empty):

```
TREE MATCHES
· Patrick Flynn — tree KW7C-X9P · View →   (amber link)
· Patrick J. Flynn — tree LZ5J-2RT · View →
```

Layout: `TREE MATCHES` section label (`var(--text-tertiary)`, tracked
uppercase, 11px) above a vertical list. Each entry is one line:
`personName` in body sans + ` — tree ` + `treeId` in `var(--font-mono)` 12px
+ amber `View →` link that calls `window.api.openExternal(ark)`.

Below `Open in FamilySearch →` on the expanded card; not shown on
collapsed cards. Add to the fulltext_search branch fallback as well — it's
the only result-type field that ever crosses tools (record_search uses it
more, but fulltext_search occasionally carries it).

## Sequencing

Recommend landing Buckets A and C first as a small PR (the breaking fix +
type widening), then Bucket B as a second PR (the user-facing additions and
sidecar viewer). Keeps the breaking fix unblocked from any sidecar viewer
design discussion. The `--accent-gold-strong` token introduction goes with
the Bucket B PR (touches `PersonCard` which is shared).

## What already exists (reuse, don't reinvent)

- `src/renderer/src/components/shared/PersonCard.tsx` — reused inside
  `SidecarPanel` for the persons subview. Add `relationship` prop callsite
  per D2 ordering.
- `src/renderer/src/components/shared/CrossLink.tsx` — reused for assertion
  persona link, captured-by source footer (B3), and conflict ids in B5.
- `src/renderer/src/components/shared/StatusBadge.tsx` — pattern to follow
  for the conflict chip's structure (the chip is not a `StatusBadge`, but
  matches its proportions).
- `src/renderer/src/components/shared/DetailPanel.tsx` — currently a JSON
  pretty-printer; consider repurposing the file name for the sidecar drawer
  or leave alone and name the new component `SidecarPanel`. Plan picks the
  latter to avoid breaking any callers of DetailPanel.
- `styles/global.css` tokens — `--bg-primary/secondary/code/hover`,
  `--text-primary/secondary/tertiary`, `--border-color`, `--font-display`
  (Cormorant), `--font-body` (IBM Plex Sans), `--font-mono` (IBM Plex Mono),
  `--accent-gold` (decorative), `--accent-gold-strong` (NEW, small text),
  `--conflict-unresolved-bg/border`, `--spacing-xs/sm/md/lg/xl`,
  `--border-radius/-sm`.
- `ResearchLogSection.module.css` `.expandedContent` — visual reference for
  the sidecar drawer body surface.
- `ResearchLogSection.module.css` `.queryBlock` — visual reference for the
  transcription `<pre>` block in B2.

## NOT in scope

Considered and explicitly excluded from this plan:

- **Splitting `record_search` and `fulltext_search` into two drawer
  components.** Both fit comfortably in `SidecarPanel.tsx` with a switch
  on `sidecar.tool`. Refactor when a third tool ships.
- **Sidecar caching across opens.** Cheap enough to re-read on open (≤10MB
  cap). Worth revisiting only if a sidecar consistently takes >100ms to
  load on the user's hardware.
- **Server-side pagination of result cards.** Median sidecar is ~5 results;
  cap is 10MB. Virtualization is unnecessary at expected payload sizes.
- **Side-by-side sidecar comparison (two drawers).** Single open drawer at
  a time — `openSidecar` replaces the open sidecar if a different `logId`
  is requested. Multi-drawer comparison is a future feature.
- **Inline editing inside the drawer** (e.g., editing assertion notes from
  a person card). The drawer is read-only by design; editing flows belong
  in their owning section.

## Failure modes (per /plan-eng-review)

For every new codepath, one realistic production failure and whether the
plan catches it. Bold = critical gap (no test AND no handling AND silent).

| Codepath | Failure mode | Test covers? | Error handling? | User experience |
|----------|--------------|--------------|-----------------|-----------------|
| IPC read-sidecar | Symlink attack via `results/log_001.json` → /etc/passwd | Implicit via regex (no `/` allowed) ✓ | Path validation throws ✓ | Drawer shows ERROR state |
| IPC read-sidecar | File deleted between stat and readFile (TOCTOU race) | No | `readFile` throws → IPC throws → ERROR state ✓ | Drawer shows ERROR state |
| IPC read-sidecar | Disk full → ENOSPC reading | No (rare) | `readFile` throws → IPC throws → ERROR state ✓ | Drawer shows ERROR state |
| IPC read-sidecar | Invalid UTF-8 in sidecar file | No | `readFile('utf8')` returns replacement chars; renderer JSON.parse may throw → ERROR state | Drawer shows ERROR state |
| Renderer JSON.parse | Sidecar JSON is malformed (corrupted write) | SidecarPanel.test covers parse-failure case ✓ | Try/catch in useEffect → ERROR state ✓ | Drawer shows ERROR + Try again |
| Watcher dispatcher | folderPath unmounts mid-watch (USB pulled) | No | chokidar emits 'error' → existing error channel sends to renderer ✓ | Existing toast pattern shows error |
| Watcher dispatcher | results/ dir created after startWatching (didn't exist initially) | Need test for `add` event on dir creation | chokidar's `awaitWriteFinish` + add event handles this ✓ | Drawer functions normally on next openSidecar |
| Provider debounce | Component unmounts mid-debounce | No (subtle) | `useEffect` cleanup clears pending timeout ✓ if spec'd | None — silent (cancelled fetch never lands) |
| Provider race guard | Two openSidecar calls with same logId, different focusPersonaId, within same tick | Provider test covers idempotent open ✓ | Reducer treats sameLogId+different persona as `{ ...prev, focusPersonaId: new }` ✓ | Second persona becomes the focus, no re-fetch |
| Focus trap | User opens DevTools while drawer is open | No | focus-trap-react handles via document.activeElement check | Focus stays in drawer (DevTools is a separate window in Electron) |
| Reverse-lookup index | source.log_entry_id is undefined (legacy data) | Regression test fixtures include sources both with and without log_entry_id ✓ | Falsy check skips ✓ | Sources without log_entry_id never appear in any row's "Sources" column |
| orderPersons | Person referenced in relationships but missing from persons array | Add test case | Helper skips missing refs ✓ | Person silently excluded from card |

No critical gaps (no entry has all three: no test, no handling, silent
user impact). The closest is the provider-debounce-on-unmount case, which
is silent but harmless (cancelled fetch). Spec includes `useEffect`
cleanup to make it explicit.

## Worktree parallelization strategy

Two PRs (per Sequencing), with multiple parallel lanes within PR-B.

**PR-1 (Buckets A + C, ~30-45 min):** Single lane, sequential. Touches
schema.ts, ResearchLogSection.tsx, two fixture files, regression tests.
Land before PR-2.

**PR-2 (Bucket B, ~3-4 hr):** 4 parallel lanes after schema.ts is on main.

| Lane | Modules touched | Depends on |
|------|----------------|------------|
| L1: Shared primitives | components/shared/ (Pill), lib/relationship-label.ts | — |
| L2: Sidecar core | main/, preload/, contexts/, components/shared/ (SidecarPanel, SidecarResultCard), package.json | L1 (orderPersons, Pill) |
| L3: Section updates | components/sections/ (Sources, Assertions, Timelines), components/shared/PersonCard.module.css, styles/global.css | L1 (Pill), PR-1 (schema) |
| L4: Watcher | main/watcher.ts, main/__tests__/ | — |

```
Execution order:
  L1 + L4 in parallel (independent)
  → merge L1
  → L2 + L3 in parallel (both depend on L1)
  → merge L2, L3, L4
```

**Conflict flags:**
- L2 and L4 both touch `main/`. L4 edits `watcher.ts`; L2 edits `index.ts`.
  Different files but same directory — git merge handles cleanly.
- L1 and L3 both touch `components/shared/`. L1 creates Pill; L3 edits
  PersonCard.module.css. Different files but same dir — clean.
- L2 and L3 both depend on L1. Run L1 alone first; then L2+L3 in parallel.
- `styles/global.css` is touched only by L3 (`--accent-gold-strong` add).

Total clock time: ~30 min for PR-1, then ~1.5-2 hr for PR-2 (longest lane
is L2, but L1+L4 finish first). Sequential would be ~5-6 hr.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | not run |
| Codex Review | `/codex review` | Independent 2nd opinion | 0 | — | not run |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | CLEAR (PLAN) | 13 decisions locked (6 architecture + 3 code quality + 1 tests + 2 perf + 1 scope), 0 critical gaps, 12 test files spec'd |
| Design Review | `/plan-design-review` | UI/UX gaps | 1 | CLEAR (PLAN) | score: 6.5/10 → 9/10, 8 decisions locked + 4 originally-open questions resolved into plan |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | not run |

- **UNRESOLVED:** 0
- **VERDICT:** DESIGN + ENG CLEARED — ready to implement
