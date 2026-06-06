# Genealogy Workbench — Interaction & UI Design

**Status:** DRAFT for design + engineering review · 2026-06-06 · branch `hosted-web-workbench`

Covers two things a "UI redesign" title would undersell: the **interaction
model** (the AI as worker *and* mentor — Did / Decide / Next) and the **spatial
design** (places vs. documents). The mentor half is product, not chrome.

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
- The AI is **worker + mentor**. The UI keeps three agent communications
  visually distinct — **Did** (work → artifact), **Decide** (irreversible fork →
  judgment), **Next** (advice → actionable suggestion) — with the balance keyed
  to user competence (`researcher_profile`) and action stakes (see Design).

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

The redesign turns on two orthogonal axes: **how the AI communicates** (worker /
mentor — *Did / Decide / Next*) and **how the workspace is organized spatially**
(places vs. documents). The first decides which surfaces exist; the second
decides where they live.

### Interaction model: worker + mentor (Did / Decide / Next)

The AI is both a **worker** (carries out tasks for the user) and a **mentor**
(advises what to do next). These are different trust contracts, and the balance
between them is not a mode the user toggles — it shifts along two dimensions:

- **Competence** — read from `research.json`'s `researcher_profile` (experience
  level + `narration_guidance`). Novice → the mentor narrates the *why* and
  proposes the next move; expert → the worker executes and stays quiet.
- **Stakes / reversibility** — fetching a census is low-stakes worker territory;
  concluding two people are the same (`same_person`) or attaching a source as
  evidence for a fact (`source_attachments`) is irreversible and propagates
  errors through the tree. These drop into mentor mode for *every* user: surface
  the reasoning, force a decision, never auto-commit.

A plain chat log flattens three communications that must stay distinct:

| Channel | Means | UI surface | Failure mode it guards |
|---|---|---|---|
| **Did** | Completed work → an artifact | Evidence rail + peek-then-pin docs + citation/pulse (A, B) | — (this is the worker loop, already designed) |
| **Decide** | A fork needing judgment — esp. irreversible | A dedicated surface **no collapse state can suppress**; full evidence, not a summary; friction scaled to reversibility | Rubber-stamping a conclusion the user doesn't understand |
| **Next** | Mentor advice on direction | **Actionable suggestion chips** ("verify the 1850 census — run it?"), anchored to the workspace, not lost in chat scroll | De-skilling, and the novice who doesn't know what to type |

**Did** is the worker loop this doc already designs (A, B). **Decide** and
**Next** are the mentor half — new surfaces, carried by a typed-event protocol
(B) and rendered in `apps/web` (C).

**Two registers, not one.** The default review surface is *digestible* —
summaries, peek — which is right for triage. A **Decide** surface needs the
opposite: the full evidence laid bare *in human terms* so the user can actually
judge. That is distinct from the raw-JSON toggle, which is dev/transparency, not
decision support. Skim by default; drill to full evidence at the moment of
judgment. Two-up / split is the verification register for the highest-stakes
call — "is this the same person?" — which is why its model is built in from
phase 1, not bolted on.

### The acceptance moment: conclusions, not just retrievals

The Evidence rail surfaces *retrievals* (what the agent fetched — `search` /
`capture`). But rubber-stamping does its damage on *conclusions* — and the ones
that matter are interpretive, not extractive. An `Assertion` ("the record says
this child is age 4") is worker extraction and can land silently; the schema
gives it no status, correctly. The high-stakes conclusions are the
**interpretations**: `person_evidence` (this record persona **is** this tree
person), `same_person` merges, and `source_attachments` (binding a source to a
FamilySearch person — irreversible, propagates through the tree).

For Decide to land in the *workspace* (not just a transient chat banner), those
conclusions need a **pending state** the user resolves in place. The schema has
no such concept today (`PersonEvidence` carries `confidence` + `superseded_by`,
no `proposed`/`accepted`), so this is a real fork:

- **Ephemeral (no schema change):** the agent raises a Decide event *before*
  writing; accept persists the conclusion, reject never does. Simple — but the
  pending conclusion lives only in the live event; miss it or reload and it's
  gone.
- **Durable (schema change):** add `status: proposed | accepted` to
  `person_evidence` (plus a gate for merges/attachments). The agent writes
  `proposed`; the section renders proposed conclusions distinctly with inline
  accept/reject; acceptance flips the status. Survives reload, visible
  in-section, auditable — but touches the three schema-of-record places
  (`research.schema.json`, the prose spec, `validator.ts`) and the writing tools.

Recommendation: **durable** for the irreversible interpretations — ephemeral
approval re-introduces exactly the "miss it and it's gone" failure the
un-hideable Decide surface exists to prevent. The rail then badges sections that
hold pending conclusions ("needs review"), reusing the existing per-section count
affordance. Confirm the schema delta with the schema owner (Open questions).

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

This dissolves two former open questions: ordering churn in the tab bar and tab
proliferation both disappear.

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
"700px is too narrow for three columns." (See the agent↔workspace link below —
ambient narration is what makes a collapsed chat still feel alive.)

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
│  census1880 ◀ │ │ [raw JSON]      [⤢ split]     │  │           │
│  fulltext     │ └───────────────────────────────┘  │ [expand]  │
│  capture (—)  │                                     │           │
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

### A. `viewer-ui` — places, documents, peek-then-pin, two-up

Reuse-first: the 11 section components are zero-prop and read from
`useResearchData()` — they render **unchanged** as the place content.
`SidecarResultCard`, `DetailPanel` (raw JSON), and `PersonCard` are reused as-is.

**Sections stay places.** `Sidebar` keeps driving `activeSection` (today's
single content slot). No section ever becomes a tab. The one exception is
two-up: a section may be **cast into a split pane** for comparison (e.g.
Timeline beside the census record that supports it).

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
//   activeSection: string                 // the PLACE (rail-driven, source of truth for "where")
//   preview: DocTab | null                // the single ephemeral peek slot (italic in tab strip)
//   pinned: DocTab[]                       // explicitly kept documents
//   focusedDocId: string | null           // null → content shows activeSection; else that doc
//   split: { left: PaneRef; right: PaneRef } | null   // PaneRef = {section:key} | {doc:id}
// peekDoc(ref): set preview = ref, focusedDocId = its id (replaces any prior preview)
// pinDoc(id): move preview → pinned; clear preview slot
// closeDoc(id); focusSection(key): focusedDocId = null; setActiveSection(key)
// openSplit(left,right): two-up; either side may be a section or a doc
```

The **two-up model is designed in from day one** (the `split` field above), even
if the drag-to-side UI lands in a later phase — because "is this the same
person?" comparison is the core job, not a retrofit.

**New components** (`src/components/workspace/`): `WorkspaceShell` (rail · content
· optional chat slot the web app fills), `WorkspaceRail` (existing `Sidebar`
Sections zone + new `EvidenceList`), `EvidenceList`, `DocTabBar` (peek=italic,
pin, close), `DocContent` (renders the focused doc → `SidecarResultView` |
`PersonProfile`; falls back to the active section component when `focusedDocId`
is null; raw-JSON overlay via reused `DetailPanel`), `SplitView` (two
`DocContent`/section panes), `PersonProfile` (thin: `PersonCard` + related
`assertions`/`person_evidence`). Plus the extracted
`src/components/shared/SidecarResultView.tsx` — the **inner** body of
`SidecarPanel` (`SummaryStrip`/`LoadedBody`/`SidecarResultCard` + loading/missing/
error branches) **without** the modal `FocusTrap`/`overlay`/`backdrop`.

**Evidence rail ordering** isn't binary: **chronological**, with the
latest-landed item and the item-under-discussion (see B) surfaced/pinned to the
top band, plus a **group/filter toggle** (by tool/kind) that appears once the
list is long. Pure chronological grows unbounded; pure grouping kills the "watch
it fill up" narrative — so we do both.

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

### B. The agent↔workspace link (first-class — this is the product)

"Watch the case file fill up" only lands if the user can see **narration →
artifact**. Today there is no correlation: an agent event is
`{ kind, text, tool, summary }` (no id), and research arrives via a separate
`onResearch` full-document delta. Linking "the message" to "the evidence it
produced" by timing alone is fragile. So this requires a **protocol change**,
not UI polish.

**Protocol (apps/server `app/agent/` → client):** when a tool call writes a log
entry, the agent event carries that entry's id:
```
agent_event: {
  kind, text, tool, summary,            // existing
  logId?,                               // Did: id of the artifact this call produced
  decision?: {                          // Decide: an irreversible fork needing judgment
    id; prompt; options: string[]; evidenceRef?: DocRef; reversible: false
  },
  suggestions?: { id; label; action }[] // Next: actionable mentor chips
}
// routes by payload: decision → Decide surface, suggestions → Next surface,
//                    logId → Did artifact, otherwise plain narration
```
The `agent_runner` must surface the `log_id` it (or the MCP tool) generated at
emit time. **Open verification:** confirm the runner has the `log_id` available
for every artifact-producing tool, or only some (drives whether the link is
complete or best-effort) — see Open questions.

**Decide / Next events** carry no `logId` of their own. A `decision` references
the evidence the user must weigh (`evidenceRef`) so the surface can lay it out in
full; the runner blocks on the user's choice and never auto-resolves. The set of
irreversible actions that must raise a `decision` (e.g. `same_person`,
`source_attachments`, match acceptances) is a taxonomy to confirm — see Open
questions. A `suggestions` payload is the mentor's "what next," emitted whenever
the agent finishes a step.

**Integration seam (web ↔ viewer):** chat lives in `apps/web`; the workspace
state lives in `viewer-ui`. The seam is one optional prop on `viewer-ui`'s `App`
— **`bridge?: WorkspaceBridge`** — and it must carry *all three* channels, not
just worker-review (the earlier draft's bridge was Did-only; that was the gap):
```ts
interface WorkspaceBridge {
  // Did — worker review
  peekEvidence(logId: string): void
  peekPerson(personId: string): void
  pulseEvidence(logId: string): void                 // rail "just landed"
  onActiveChange(cb: (ref: DocRef | { section: string }) => void): () => void
  // Decide — lay the fork's evidence bare in the content pane (often two-up)
  presentDecision(d: DecisionRequest): void          // e.g. persona A | tree person B
  onDecisionResolved(cb: (id: string, choice: string) => void): () => void
  // Next — suggestion chips, if anchored in the workspace rather than chat
  showSuggestions(items: Suggestion[]): void
  // competence/stakes input the surfaces read
  getResearcherProfile(): ResearcherProfile | null   // from research.json via the transport
}
```
`apps/web` constructs the bridge, passes it to `<ViewerApp bridge={bridge}/>`,
and `ChatPane` + the Decide/Next surfaces use the *same* bridge. Electron passes
no bridge → unaffected.

**Who owns Decide** (split on purpose): the **un-hideable affordance** — the "you
must judge this" escalation plus accept/reject, sitting *outside* the collapsible
chat — is rendered by `apps/web`, which owns the collapse and can guarantee it is
never suppressed. The **evidence** is rendered by `viewer-ui` via
`presentDecision`, which commandeers the content pane — two-up for `same_person`
(A | B), a single full-evidence view otherwise. `apps/web` posts the choice back
to the agent; `onDecisionResolved` clears the verification view. This is why
two-up is the *Decide UI*, and why its render cannot trail Decide in the phasing.

**Behaviors this unlocks:**
- **Citations:** a chat tool-chip with a `logId` renders as a link → `peekEvidence`.
- **Landing:** when a new `results_ref` entry arrives in `onResearch`,
  `pulseEvidence` highlights the rail item so the user sees it appear.
- **Under-discussion:** the most recent `logId` referenced in chat is the item
  surfaced at the top of the Evidence rail and (optionally) auto-peeked.
- **Ambient narration:** the collapsed-chat activity strip (from Design) shows
  the latest narration line and the pulse — this is what keeps a 2-pane laptop
  layout feeling like an agent workbench, not a viewer with a chat box.
- **Decide:** a `decision` payload raises the un-hideable Decide affordance (C)
  and calls `presentDecision` to lay the full evidence into the content pane
  (two-up for `same_person`); the user's choice posts back and never
  auto-resolves — the rubber-stamping guard.
- **Next:** a `suggestions` payload renders as actionable chips; clicking one
  sends the agent the corresponding action — the novice's "what do I do now."

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
  citations; drive/observe the activity strip.
- **Decide surface** — render `decision` events in a region **outside** the
  collapsible chat (a banner/dock the collapse cannot hide); call
  `bridge.presentDecision(d)` to lay the evidence into the content pane (two-up
  for `same_person`); post the choice back via `onDecisionResolved`. The
  high-stakes guard — see "Who owns Decide" (B).
- **Next chips** — render `suggestions` as click-to-run actions, prominent for a
  novice and quiet for an expert.

**Competence × stakes — who does what** (two inputs, two owners; don't conflate):
- *Agent-side (server, `app/agent/`):* reads `researcher_profile`
  (`experience_level` ∈ novice/intermediate/experienced/professional +
  `narration_guidance`) and action reversibility to decide *what to emit* —
  narration depth (already driven by the SKILL.md narration line), whether to
  emit `suggestions`, and whether an action must raise a `decision`. The
  worker/mentor balance actually lives here.
- *Client-side (`apps/web`, via `bridge.getResearcherProfile()`):* reads the same
  profile to decide *how prominently to render* what the agent emits — Next chip
  prominence/placement, and whether a Decide surface shows its reasoning
  expanded-by-default (novice) or collapsed (expert). The client never computes
  narration depth; it styles emphasis.

## Phasing (each increment ships independently)

1. **Place/document workspace** (A) — sections stay places; evidence/people are
   peek-then-pin documents; inline `SidecarResultView` replaces the modal drawer;
   the `split` model is built in (UI in phase 5). Highest value, self-contained.
2. **Evidence rail** (A) — `deriveEvidence` + `EvidenceList`, chronological with
   surfaced latest/under-discussion + group/filter toggle.
3. **Agent↔workspace link** (B) — **the differentiator.** Typed agent events
   (`logId` + `decision`/`suggestions`, apps/server protocol change),
   `WorkspaceBridge` seam, chat citations, rail pulse, ambient narration,
   optional follow-mode.
4. **Worker/mentor channels — Decide + Next** (B + C) — the mentor half. Decide
   is **pre-commit** (the agent raises it *before* an irreversible action; Did
   artifacts are post-commit). Lands here: the un-hideable Decide affordance, the
   **two-up evidence render** it needs for `same_person` (so the render ships
   with Decide, not in phase 6), the pending-conclusion in-section state (durable
   `status`, pending the schema delta), and Next chips — all keyed to
   `researcher_profile`.
5. **Responsive shell** (C) — width-driven pane count + docked-collapsible chat.
6. **Two-up interaction polish** — drag-a-doc-to-the-side, manual compare,
   section-castable pane. (Model from phase 1, render from phase 4 — this is the
   interaction layer, not a rewrite.)
- **Follow-up (out of scope):** image/PDF byte-viewer — new guarded
  `readArtifact(relPath)` transport method in both adapters; until then,
  captures show "preview not available yet."

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
  the evidence; pin to keep; section clicks change the place (single rail
  highlight); chat collapses to the activity strip and narration stays ambient;
  pane count tracks viewport width.
- **Worker/mentor:** a `same_person` `decision` raises the un-hideable Decide
  affordance (still visible with chat collapsed), `presentDecision` lays the two
  candidates two-up, and resolving posts the choice back and clears the view; a
  proposed conclusion renders in its section in a pending state until accepted; a
  `suggestions` event renders click-to-run chips; chip prominence and
  Decide-reasoning default-expansion differ for novice vs. expert
  `researcher_profile` fixtures.

## Open questions for review

1. **Follow-mode default** — should the workspace auto-peek the
   under-discussion artifact, or only on explicit click? (Auto-navigation can be
   jarring; likely a toggle, default off.)
2. **`log_id` completeness** — does the `agent_runner` have the `log_id` at
   event-emit time for *every* artifact-producing tool, or only search tools?
   Determines whether citations are complete or best-effort (B).
3. **Bridge ownership** — `WorkspaceBridge` as an optional prop (above) vs.
   lifting `WorkspaceProvider` into `apps/web` to wrap both chat and viewer.
   Prop seam keeps Electron cleaner; lifting gives tighter coupling. Eng call.
4. **Irreversible-action taxonomy** — which tool calls must raise a `decision`?
   Interpretive conclusions clearly do: `same_person`, `source_attachments`,
   match acceptances (`person_record_matches` et al.). Raw `Assertion`
   extractions land silently (worker output; the schema gives them no status).
   The boundary case is `person_evidence` confidence — does writing a
   `speculative` linkage need a decision, or only `confident` ones?
5. **Suggestion source** — do `Next` chips come from the agent inline, or from a
   separate mentor pass (cf. the `gps-mentor` agent)? Determines who emits
   `suggestions` and when.
6. **Pending-conclusion durability** — ephemeral (pre-commit event only) vs.
   durable (`status: proposed|accepted` on `person_evidence` + a merge/attachment
   gate). Durable is recommended but costs the three schema-of-record places plus
   the writing tools. Schema owner's call.
```
