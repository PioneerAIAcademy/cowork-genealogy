# Genealogy Workbench — Interaction & UI Design

**Status:** DRAFT for design + engineering review · 2026-06-06 · branch `hosted-web-workbench`

Covers the **interaction model** (the AI as worker *and* mentor — Did / Decide /
Next) and the **spatial design** (places vs. documents). Guiding rule: **ship the
simplest version first; add complexity only when real usage shows the need.** The
mentor half is real product, but v1 keeps its surfaces minimal — the elaborations
live in **Later**, not the build.

## Context

The hosted web workbench today is a **two-pane** layout (`apps/web`): chat on
the left, the shared viewer (`packages/viewer-ui`) on the right. The viewer
itself is a 3-zone app — a section sidebar (11 sections), a single content
slot, and a modal "sidecar" drawer for search results.

The original request was for a standard **3-pane IDE**: file tree (left),
tabbed file content (middle), chat (right). We are **not** building a literal
IDE, because the primary user is an **end genealogist** (not a developer) and
the project is ~5–15 interconnected JSON documents, not a code tree. A literal
file tree + raw-JSON tabs would (a) throw away the viewer's semantic renderer —
the product's best asset, (b) duplicate the existing section sidebar with a
second navigator, and (c) hide the cross-reference graph that is the actual
value of the data.

**Design decisions (confirmed):**
- Primary user = end genealogists → rendered views by default; raw JSON behind
  a per-tab toggle (a dev/transparency affordance).
- **Sections are places; evidence and people are documents** — they are *not*
  the same kind of thing and must not share one tab strip (see Design).
- Left rail = **semantic**, two zones: *Sections* (places) + *Evidence* (the
  growing list of artifacts the agent produces). No literal file tree.
- The agent↔workspace link — narration producing visible artifacts — is the
  **product**, not a layout detail. It gets its own phase, not a grid flip.
- The AI is **worker + mentor** — three communications kept distinct: **Did**
  (work → artifact), **Decide** (a recommendation the human acts on), **Next**
  (advice → suggestion chip). See Design.
- **Firm invariant: writes to FamilySearch are always human-supervised through a
  dedicated UI.** The agent never pushes to FS autonomously. This is the safety
  floor and holds permanently.

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
method in both adapters, with a path-traversal guard). For the POC a capture
item renders an explicit **"preview not available yet"** state — never a row
that looks dead or broken.

## Design

Two orthogonal axes: **how the AI communicates** (worker / mentor — *Did /
Decide / Next*) and **how the workspace is organized spatially** (places vs.
documents).

### Interaction model: worker + mentor (Did / Decide / Next)

The AI is both a **worker** (carries out research) and a **mentor** (advises what
to do next). Three communications stay visually distinct rather than flattened
into one chat log:

| Channel | Means | v1 surface |
|---|---|---|
| **Did** | Completed work → an artifact | Evidence rail + peek-then-pin docs + citation/pulse (A, B) |
| **Decide** | A recommendation the human acts on | **No dedicated surface in v1** — the recommendation lands as its artifact (Did) and any FamilySearch write goes through the separate human-supervised UI. Dedicated Decide surfaces → **Later** |
| **Next** | Advice on direction | Suggestion chips **in the chat thread** — pre-filled prompts the user clicks to run |

**The FamilySearch invariant dissolves the hard part.** Because the agent never
initiates an FS write — every `same_person` merge or `source_attachments` push
happens only through a dedicated human-supervised review UI that the *person*
drives — the agent never has to **block** mid-run waiting on a decision. It
researches, recommends, and keeps going; the human performs the write when they
choose. That removes the synchronous-vs-asynchronous decision tension entirely:
**v1 has no blocking decision protocol and no decisions inbox.** (The FS-write
review UI is its own surface; its detailed design is tracked separately — what's
firm here is the invariant.)

**v1 builds Did + Next.** "Decide" is the conceptual third channel, but it has
**no dedicated surface in v1**: a recommendation simply lands as its artifact
(Did) and any irreversible FamilySearch write goes through the separate
human-supervised UI. Every *dedicated* Decide surface — a review queue, inline
accept/reject, two-up verification — is in **Later**. So the build below is the
worker loop (Did, the bulk of the value) plus lightweight Next chips; nothing
gates the agent.

### Conclusions vs. retrievals (why most agent output can land silently)

The Evidence rail surfaces *retrievals* (what the agent fetched — `search` /
`capture`). Most of what the agent writes is low-stakes and lands silently: an
`Assertion` ("the record says this child is age 4") is worker extraction — the
schema gives it no status, correctly. The agent's *interpretations* —
`person_evidence` (this record persona **is** this tree person), and proposed
`same_person` / `source_attachments` — are recommendations the human reviews. In
v1 they render in their sections using the existing `confidence` field — the
human just *sees* them there; the only v1 actions are steering the agent in chat
or performing a write through the supervised FS UI. An in-section accept/reject
needs a durable `proposed | accepted` status on these conclusions (so a pending
recommendation survives reload) — a real improvement, but a schema change across
three schema-of-record places, deferred to **Later**.

### Organizing principle: places vs. documents

Conflating these in a single tab strip is what re-creates the very duplication
we set out to remove (navigation state lives in both the rail and the tab bar,
and the two can disagree).

| | **Places** | **Documents** |
|---|---|---|
| What | Sections: Overview, Questions, Sources, … | A specific census result, a person profile |
| Nature | Stable, finite, always present | Transient, unbounded, ephemeral |
| UI | Left-rail destinations → single content slot | Tabs, with **peek-then-pin** |
| "Where am I" | One rail highlight (the source of truth) | A focused document, or none |

**Peek-then-pin** (the VS Code preview-tab model): clicking an evidence/person
item opens it into a *single reused preview slot* (rendered in italic in the tab
strip). Clicking another item replaces the preview. You **pin** (double-click,
or any interaction that implies "keep") to promote it to a persistent tab; the
next peek then opens a fresh preview. Most clicks are throwaway peeks, so tab
proliferation is solved by default rather than by a cap or a "close others."

### Layout — a designed responsive spectrum, not "collapse the rails"

Three always-on panes at 1366px leaves ~700px for content after a rail and a
chat column — genuinely cramped for wide census tables and record images. So the
pane count is a **designed function of width**, and chat is **docked-collapsible**
rather than a permanent third column or a fully-hidden drawer:

- **Wide desktop (≥ ~1600px):** 3 panes — rail · content · docked chat.
- **Laptop (~1280–1600px, the common case):** 2 panes — rail · content, full
  width. Chat collapses to a **slim activity strip** that keeps **narration
  ambient** (latest agent line + a pulse when a new artifact lands) and expands
  to the full thread on demand or when the agent surfaces itself.
- **Narrow:** rail collapses to icons; chat becomes an overlay.

The key: even collapsed, chat is not *gone* — the narration→artifact signal
stays visible. This is the reconciliation of "chat is the control surface" with
"700px is too narrow for three columns."

```
Laptop default (2 panes + docked-collapsible chat):
┌──────────────────────────────────────────────────────────────┐
│  Header (project · FS status)                        [chat ⇤] │
├───────────────┬───────────────────────────────────┬───────────┤
│ WORKSPACE RAIL│ ProgressPipeline                  │ ACTIVITY  │
│ SECTIONS      ├───────────────────────────────────┤ (collapsed│
│  Overview   ● │ DOC TABS  (census 1880)(J. Doe) +  │  chat)    │
│  Questions  4 │  └ evidence + people only          │           │
│  Sources   12 │ ┌───────────────────────────────┐  │ agent ran │
│  …            │ │ Active = selected SECTION,    │  │ census →  │
│ EVIDENCE      │ │ or a focused document tab.    │  │ found 3 ⤴ │ ← citation
│  census1880 ◀ │ │ [raw JSON]                    │  │           │
│  fulltext     │ └───────────────────────────────┘  │ verify… ▸ │ ← Next chip
│  capture (—)  │                                     │ [expand]  │
└───────────────┴───────────────────────────────────┴───────────┘
● current place (one highlight)   ◀ just landed (pulse)   (—) preview N/A
Icons shown as text here; real build uses a consistent line-icon set (no emoji).
```

## Implementation

The split: the **place/document workspace lives in `viewer-ui`** (Electron wants
it too, minus chat); the **agent↔workspace link and the responsive chat shell
live in `apps/web`** (Electron has no chat). `viewer-ui` stays "the workspace
minus chat," embeddable by both apps. The public export surface in
`packages/viewer-ui/src/index.ts` stays backward-compatible (additive only);
`App({ transport })` keeps its signature → **no required Electron change** (new
props are optional).

### A. `viewer-ui` — places, documents, peek-then-pin

Reuse-first: the 11 section components are zero-prop and read from
`useResearchData()` — they render **unchanged** as the place content.
`SidecarResultCard`, `DetailPanel` (raw JSON), and `PersonCard` are reused as-is.

**Sections stay places.** `Sidebar` keeps driving `activeSection` (today's
single content slot). No section ever becomes a tab.

**Documents are tabs with peek-then-pin** — a new workspace context
(`src/contexts/WorkspaceProvider.tsx` + `WorkspaceContext.ts`), mounted inside
`ResearchDataProvider`. Kept out of `ResearchDataContext` to avoid churning the
data context and its tests.

```ts
type DocRef =
  | { kind: 'evidence'; logId: string }     // id = `evidence:${logId}`
  | { kind: 'person';   personId: string }  // id = `person:${personId}`
type DocTab = { id: string; ref: DocRef; title: string; rawJson: boolean }

// state:
//   activeSection: string         // the PLACE (rail-driven, source of truth for "where")
//   preview: DocTab | null         // the single ephemeral peek slot (italic in tab strip)
//   pinned: DocTab[]               // explicitly kept documents
//   focusedDocId: string | null    // null → content shows activeSection; else that doc
// peekDoc(ref): set preview = ref, focusedDocId = its id (replaces any prior preview)
// pinDoc(id): move preview → pinned; clear preview slot
// closeDoc(id); focusSection(key): focusedDocId = null; setActiveSection(key)
```

(The tab model leaves room for a future two-up / split-compare view — see
**Later** — but v1 is single-content.)

**Streaming safety:** `onResearch` replaces the whole research doc on every
delta, so open tabs key on stable ids (`evidence:${logId}` / `person:${personId}`)
and the Evidence list is `useMemo`'d on `research` — a mid-stream update repaints
content but never remounts or reorders the user's open tabs.

**New components** (`src/components/workspace/`): `WorkspaceShell` (rail · content
· optional chat slot the web app fills), `WorkspaceRail` (existing `Sidebar`
Sections zone + new `EvidenceList`), `EvidenceList`, `DocTabBar` (peek=italic,
pin, close), `DocContent` (renders the focused doc → `SidecarResultView` |
`PersonProfile`; falls back to the active section component when `focusedDocId`
is null; raw-JSON overlay via reused `DetailPanel`), `PersonProfile` (thin:
`PersonCard` + related `assertions`/`person_evidence`). Plus the extracted
`src/components/shared/SidecarResultView.tsx` — the **inner** body of
`SidecarPanel` (`SummaryStrip`/`LoadedBody`/`SidecarResultCard` + loading/missing/
error branches) **without** the modal `FocusTrap`/`overlay`/`backdrop`.

**Empty / first-run state.** A brand-new project has no log entries and empty
sections — the very first thing a user sees. The rail shows the Sections zone
(zero counts) and an Evidence zone reading "the agent's findings will appear
here"; the content shows the `project_overview` place; chat drives onboarding
(today's auto-opening turn). As the agent works, evidence lands and pulses in —
the empty state *is* the "watch it fill up" moment, so it should read as
expectant, not broken.

**Evidence derivation** (`src/lib/evidence.ts`, pure + unit-tested) — which log
entries become evidence items:
```ts
deriveEvidence(research): EvidenceItem[]   // memoized on `research`
  for entry of research.log:
    if entry.results_ref          → { kind:'search',  logId, tool, performed, examined, available }
    if entry.external_site?.capture_received && .capture_filename
                                  → { kind:'capture', logId, site, filename, performed }
  // reverse-chronological (newest first); the log is append-only, so the list grows monotonically
```
v1 renders this as a **plain reverse-chronological list** (newest on top).
Group/filter and surfacing the under-discussion item are **Later** — they earn
their keep only once the list is long.

**Modify:**
- `src/App.tsx` — `AppContent` renders `<WorkspaceProvider><WorkspaceShell>`.
  `Header` + `ProgressPipeline` stay above the content. The `sectionComponents`
  map moves into `DocContent`'s section fallback.
- `src/components/shared/CrossLink.tsx` — person target → `peekDoc({kind:'person'})`;
  evidence target → `peekDoc({kind:'evidence'})`; section target →
  `focusSection(key)` (rail place, not a tab). Keep the `requestAnimationFrame`
  scroll-to-`#id`, run it after the content settles.
- `src/components/sections/ResearchLogSection.tsx` (~L160) and
  `AssertionsSection.tsx` (~L68) — `openSidecar(...)` → `peekDoc({kind:'evidence',
  logId})` (carry the focus persona into `SidecarResultView`).
- `src/components/layout/Sidebar.tsx` — section buttons call `focusSection(key)`;
  keep dev/theme footer.
- `src/index.ts` — additive exports (`WorkspaceProvider`, the bridge type from B,
  doc types).

**Delete (last, after call sites migrate):** `SidecarPanel.tsx` + its CSS + its
two tests. Keep them until then so the suite stays green; add fresh tests against
`SidecarResultView`.

**Accessibility:** deleting `SidecarPanel` removes its `FocusTrap` / `role=dialog`
semantics. Inline tabs replace them with in-page focus — `DocTabBar` needs
`role="tablist"`/`tab` + arrow-key nav, and peeking/pinning must move focus into
the new `DocContent` so keyboard and screen-reader users follow the change.

### B. The agent↔workspace link (first-class — this is the product)

"Watch the case file fill up" only lands if the user can see **narration →
artifact**. Today there is no correlation: an agent event is
`{ kind, text, tool, summary }` (no id), and research arrives via a separate
`onResearch` full-document delta. Linking "the message" to "the evidence it
produced" by timing alone is fragile. So this requires a small **protocol
change**, not UI polish.

**Protocol (apps/server `app/agent/` → client):** add two optional fields to the
agent event — nothing blocking, nothing stateful:
```
agent_event: {
  kind, text, tool, summary,              // existing
  logId?,                                 // Did: id of the artifact this call produced
  suggestions?: { id, label, prompt }[]   // Next: pre-filled prompts to render as chips
}
```
`logId` lets a chat tool-chip link to the evidence it produced (citation) and
lets the rail pulse the item as it lands. `suggestions` are the mentor's "what
next," rendered as clickable chips in the chat thread; clicking one sends its
`prompt` as the user's message. **Open verification:** confirm the `agent_runner`
has the `log_id` available at emit time for every artifact-producing tool, or
only some (drives whether citations are complete or best-effort).

**Integration seam (web ↔ viewer):** chat lives in `apps/web`; the workspace
state lives in `viewer-ui`. The seam is one optional prop on `viewer-ui`'s `App`
— **`bridge?: WorkspaceBridge`** — for the Did worker loop:
```ts
interface WorkspaceBridge {
  peekEvidence(logId: string): void
  peekPerson(personId: string): void
  pulseEvidence(logId: string): void                 // rail "just landed"
  onActiveChange(cb: (ref: DocRef | { section: string }) => void): () => void
}
```
`apps/web` constructs the bridge, passes it to `<ViewerApp bridge={bridge}/>`,
and `ChatPane` uses it for citations. Electron passes no bridge → unaffected.
(Next chips render inside the chat thread in `apps/web`, so they need no bridge
method; the deferred mentor surfaces that *would* need richer bridge access are
in **Later**.)

**Behaviors this unlocks:**
- **Citations:** a chat tool-chip with a `logId` renders as a link → `peekEvidence`.
- **Landing:** when a new `results_ref` entry arrives in `onResearch`,
  `pulseEvidence` highlights the rail item so the user sees it appear.
- **Follow (optional):** the workspace can auto-peek the evidence the agent is
  currently discussing — a "follow" toggle (see open question). Pinning it to the
  top of the rail is **Later** (needs a chat→viewer signal the Did-only bridge
  doesn't carry).
- **Ambient narration:** the collapsed-chat activity strip (from Design) shows
  the latest narration line and the pulse — this is what keeps a 2-pane laptop
  layout feeling like an agent workbench, not a viewer with a chat box.
- **Next:** a `suggestions` payload renders as chips in the thread; clicking one
  runs its pre-filled prompt — the novice's "what do I do now." Because the chips
  live in the chat transcript, they persist as scrollback (no "miss it and it's
  gone").

**Open design question:** is auto-peek (workspace follows what the agent
discusses) on by default, or opt-in? Auto-navigation can be jarring; a "follow"
toggle is the likely answer.

### C. `apps/web` — responsive shell + docked-collapsible chat

- `src/components/SessionView.tsx` — host `<ViewerApp bridge={bridge}/>` as the
  primary surface; chat is a docked, collapsible panel (full thread ↔ slim
  activity strip), not a fixed left column. Construct the `WorkspaceBridge` and
  wire `ChatPane` ↔ viewer through it.
- `src/styles.css` — replace the fixed `.sessionShell` two-column grid with the
  width-driven spectrum from Design (3-pane ≥1600 / 2-pane + collapsible chat at
  laptop / overlay narrow). Add the activity-strip collapsed state.
- `ChatPane.tsx` — render artifact-producing tool-chips as bridge-driven
  citations; render `suggestions` as click-to-run Next chips in the thread;
  drive/observe the activity strip.

**Narration level (v1):** the agent already tailors narration depth server-side
from `research.json`'s `researcher_profile` (the SKILL.md narration line). The
client just renders it. A user steers verbosity through normal chat ("be more
concise"); a profile-driven *UI* dial is deferred — see **Later**.

## Phasing (each increment ships independently)

1. **Place/document workspace** (A) — sections stay places; evidence/people are
   peek-then-pin documents; inline `SidecarResultView` replaces the modal drawer.
   Highest value, self-contained.
2. **Evidence rail** (A) — `deriveEvidence` + `EvidenceList`, plain
   reverse-chronological (group/filter + under-discussion surfacing → Later).
3. **Agent↔workspace link** (B) — **the differentiator.** `logId` citations +
   `suggestions` chips (apps/server protocol add), `WorkspaceBridge` seam, rail
   pulse, ambient narration, Next chips in the thread, optional follow-mode.
4. **Responsive shell** (C) — width-driven pane count + docked-collapsible chat.
- **Follow-up (out of scope):** image/PDF byte-viewer — new guarded
  `readArtifact(relPath)` transport method in both adapters; until then,
  captures show "preview not available yet."

## Later — add when real usage shows the need

Deliberately deferred. Each is a real idea, parked until usage justifies the
complexity (not lost — recorded here so the build stays simple):

- **Durable conclusion state** — `status: proposed | accepted` on
  `person_evidence` (+ a merge/attachment gate), so a pending recommendation
  survives reload and shows inline accept/reject, with sections badged "needs
  review." Costs a schema change across the three schema-of-record places
  (`research.schema.json`, the prose spec, `validator.ts`) + the writing tools.
- **Decisions inbox / async review queue** — a consolidated "N waiting on you"
  surface, for when the agent runs far ahead and piles up recommendations. v1's
  per-section signal + chat suffices until backlogs actually hurt.
- **Two-up / split-compare** — drag a doc to the side; cast a section into a
  pane. The natural verification register for "is this the same person?" — but a
  comparison nicety until users feel the single-content limit.
- **Profile-driven UI adaptation + per-session verbosity dial** — vary chip
  prominence / reasoning expansion by `experience_level`, plus a "less
  hand-holding" toggle. Note competence is domain-specific and set once at init,
  so treat the profile as a prior, not a lock. Chat steering covers v1.
- **Structured / workspace-anchored Next** — chips as structured tool calls
  (deterministic) instead of prompt strings, and/or anchored to the rail instead
  of the chat thread, if in-thread chips prove too easy to miss.
- **Richer Evidence rail** — group/filter by tool/kind, and surface the
  under-discussion item at the top, once the flat chronological list gets long.
  (Under-discussion surfacing also needs a chat→viewer signal beyond the Did-only
  bridge.)

## Verification

- **Unit:** `lib/__tests__/evidence.test.ts` (derivation: `results_ref` → search
  item; `capture_received` + `filename` → capture item; zero-result entries →
  none; chronological order). New `SidecarResultView` tests mirror the old
  modal-content assertions (loading/loaded/missing/error, focus-persona expand).
  Peek-then-pin reducer tests (peek reuses the slot; pin promotes; section focus
  clears `focusedDocId`).
- **Build/regression:** `make test`; viewer-ui's existing section + provider
  tests stay green (we do not touch `ResearchDataState`/`mockContext`).
- **Electron smoke:** launch `apps/electron` against a fixture project (e.g.
  `eval/fixtures/scenarios/…`) — sections render as places, log "view results"
  peeks an inline evidence doc, pin/close works, raw-JSON toggle works, **no
  bridge passed** and nothing breaks.
- **Web E2E:** `make server` + `make web`, open a session — agent runs a search →
  a chat citation appears and the rail item pulses; clicking the citation peeks
  the evidence; pin to keep; a `suggestions` chip runs its pre-filled prompt;
  section clicks change the place (single rail highlight); chat collapses to the
  activity strip and narration stays ambient; pane count tracks viewport width.

## Open questions for review

1. **Follow-mode default** — should the workspace auto-peek the
   under-discussion artifact, or only on explicit click? (Likely a toggle,
   default off.)
2. **`log_id` completeness** — does the `agent_runner` have the `log_id` at
   event-emit time for *every* artifact-producing tool, or only search tools?
   Determines whether citations are complete or best-effort (B).
3. **Bridge ownership** — `WorkspaceBridge` as an optional prop (above) vs.
   lifting `WorkspaceProvider` into `apps/web` to wrap both chat and viewer.
   Prop seam keeps Electron cleaner; lifting gives tighter coupling. Eng call.
4. **Suggestion source** — do `Next` chips come from the agent inline, or from a
   separate mentor pass (cf. the `gps-mentor` agent)? Determines who emits
   `suggestions` and when.
```
