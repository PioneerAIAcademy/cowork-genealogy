# Implementation Plan: Scenario & Fixture Context for Score Review

## Goal

Give genealogists, while correcting LLM scores on
`eval/app/app/results/[...id]`, the context they need to judge
correctness:

- **(A)** the **scenario** — what's been researched — rendered as the
  desktop app's resolved cards (not README prose), and
- **(B)** each tool call's **fixture result**, upgraded from a raw JSON
  dump to the shared `JsonViewer`.

Both read entirely from data already in the run-log **snapshot** — no
new network/API calls.

Senior genealogists reported that without understanding what has been
researched (the scenario) they cannot tell whether the LLM's scores
need correcting. README prose is insufficient; they need the resolved,
structured view.

## Surface decision (locked)

The scoring page's third pane becomes **tabbed: `Trace` | `Scenario`**.
Grades (pane 2) stay visible at all times; the reviewer flips the right
pane between "what Claude did" and "what's been researched." The
`Scenario` tab appears only when `entry.scenario` is set and its files
are in the snapshot. Non-blocking, roomy, resizable via the existing
`HSplit` — no overlay idiom added.

Rationale: seniors consult the scenario *continuously while assigning
each score*, not as a one-time peek. That rules out modal/drawer
overlays (which block the grades pane). A tabbed pane is non-blocking,
persistent, and fits the app's existing pane-based layout.

## Reuse strategy (locked)

Lift (copy) the relevant viewer code from the sibling
`cowork-genealogy-ui` Electron app into `eval/app`; **do not share** a
package. The two apps will evolve independently. Accepted consequence:
`eval/app` owns a second renderer of the research schema, which can lag
`docs/specs/schemas/research.schema.json` over time.

---

## Phase 0 — Fixtures upgrade (small, independent)

In `TracePane` (`results/[...id]/page.tsx`), replace the raw
`<Code block>{JSON.stringify(fixtureBody)}` inside the existing
collapsed `<details>` with the shared `<JsonViewer data={fixtureBody} />`
(the same component the Fixtures page uses), keeping it collapsed by
default.

> Note: `JsonViewer` today is pretty-printed JSON in a scroll area, not
> an interactive collapsible tree. Using it makes the tool-call fixture
> display consistent with the Fixtures page. A true expand/collapse tree
> would be a future upgrade to `JsonViewer` itself (benefiting the
> Fixtures page too) — out of scope; fixtures are lower priority.

**Touches:** `results/[...id]/page.tsx` only.

---

## Phase 1 — Pane-tab scaffolding (surface, no viewer yet)

1. In `results/[...id]/page.tsx`, wrap the third `HSplit` child in
   Mantine `<Tabs>` with `Trace` (the existing `<TracePane>`) and
   `Scenario` (placeholder for now). Show `Scenario` only when
   `selectedEntry.scenario` is truthy. Default tab: `Trace`.
2. Parse scenario data from the snapshot (new small helper, mirroring
   `findFixtureResponse`):
   ```ts
   function findScenarioData(snapshot, scenarioName) {
     const base = `eval/fixtures/scenarios/${scenarioName}`;
     const research = tryParse(snapshot[`${base}/research.json`]);
     const gedcomx  = tryParse(snapshot[`${base}/tree.gedcomx.json`]);
     return research ? { research, gedcomx } : null;
   }
   ```
   (Confirmed present in the snapshot:
   `eval/fixtures/scenarios/<name>/{research.json,tree.gedcomx.json}`.)

**Touches:** `results/[...id]/page.tsx`.

---

## Phase 2 — Lift the resolved-card viewer

Lift from `cowork-genealogy-ui/src/renderer/src/` into a self-contained
`eval/app/components/scenario/`, **preserving the internal directory
layout** so the lifted files' relative imports (`../../contexts/...`,
`../shared/...`, `../../lib/...`) resolve with near-zero edits:

```
eval/app/components/scenario/
  ScenarioViewer.tsx          (new — entry point)
  ScenarioDataProvider.tsx    (new — thin, replaces the Electron provider)
  scenario-tokens.css         (new — design tokens, re-scoped)
  contexts/ResearchDataContext.ts        (lift as-is)
  lib/schema.ts                          (lift as-is)
  lib/relationship-label.ts              (lift as-is)
  components/shared/{Card,DetailPanel,StatusBadge,PersonCard}.tsx + .module.css   (lift as-is)
  components/shared/CrossLink.tsx + .module.css            (adapt -> plain text)
  components/sections/*.tsx + *.module.css                (lift; ResearchLog/Assertions/ProofSummaries adapted)
```

### Lift as-is (copy + their `.module.css`)
`ResearchDataContext.ts`, `schema.ts`, `relationship-label.ts`, `Card`,
`DetailPanel`, `StatusBadge`, `PersonCard`, and 8 of the 10 sections:
`ProjectOverview`, `QuestionsSection`, `PlansSection`, `SourcesSection`,
`PersonEvidenceSection`, `ConflictsSection`, `HypothesesSection`,
`TimelinesSection`.

### New: `ScenarioDataProvider` (the key unlock)
The lifted sections consume everything via `useResearchData()`. Reuse
the **same** `ResearchDataContext` but feed it from props instead of
Electron IPC:

```tsx
export function ScenarioDataProvider({ research, gedcomx, children }) {
  const [activeSection, setActiveSection] = useState('project_overview');
  const index = useMemo(() => buildIndex(research, gedcomx), [research, gedcomx]);
  const getById = useCallback(id => index.get(id) ?? null, [index]);
  const value = { research, gedcomx, getById, activeSection, setActiveSection,
                  devMode: false, sidecar: { status: 'closed' },
                  /* unused-but-typed no-ops: openSidecar, closeSidecar,
                     selectFolder, setDevMode, clearError, clearFocusPersona,
                     error: null, lastUpdated: null, folderPath: null */ };
  return <ResearchDataContext.Provider value={value}>{children}</ResearchDataContext.Provider>;
}
```
No file-watchers, no `window.api`, no sidecar fetching.

### New: `ScenarioViewer`
Renders the sections **stacked in one vertical scroll** (no sidebar nav
— simpler than the desktop app's one-section-at-a-time), inside a
wrapper that scopes the design tokens.

### Adaptations (small, surgical)
- **`CrossLink.tsx`** -> render a non-interactive `<span>{label ?? id}</span>`.
  Drops the navigation per decision, removes cross-pane scroll risk.
  (Reversible: with the single-stack layout, real in-pane
  `scrollIntoView` would work since cards carry `id={id}`.)
- **`ResearchLogSection.tsx`** -> simplify to a plain table
  (date / tool / outcome / result count / notes). **Drop** the
  "view results" sidecar button (those `results/<id>.json` sidecars are
  not in the snapshot) and the cross-links. Lets us drop
  `lib/index-by-log-entry.ts`.
- **`AssertionsSection.tsx`** -> remove the "View in record ->" button
  (sidecar-only).
- **`ProofSummariesSection.tsx`** -> swap `react-markdown` for the
  existing `@/components/common/MarkdownViewer` (avoids a new dep).

### Design tokens — scoped, not global
Copy the `:root` token block from `cowork-genealogy-ui/.../styles/global.css`
into `scenario-tokens.css`, **re-scoped** from `:root` to
`.scenarioViewer { ... }`. CSS custom properties cascade, so every
lifted `.module.css`'s `var(--bg-card)` resolves within the scenario
subtree only — zero leakage into the Mantine chrome (and `globals.css`
defines no `:root` tokens today). Ship the **light** palette for v1;
dark mode deferred. Fonts (Cormorant/IBM Plex) fall back to the system
stack in the token definitions.

### Drop entirely (don't lift)
`ResearchDataProvider.tsx` (Electron), `SidecarPanel`,
`SidecarResultCard`, `Pill`, `FeedbackDialog`, `layout/*`, `lib/progress.ts`,
`lib/index-by-log-entry.ts`, `useFileWatcher.ts`, `global.css` base resets.

### Wire-up
The `Scenario` tab renders `<ScenarioViewer research gedcomx />` from the
parsed snapshot data. The page is already `'use client'`, so lifted
client components need no per-file `'use client'` directive.

---

## Risks / caveats

1. **Schema drift (accepted).** `schema.ts` is the desktop app's reading
   of `research.json`; sections render defensively (optional chaining),
   so drift degrades to blank fields, not crashes.
2. **CSS isolation** is the main technical risk; mitigated by the
   `.scenarioViewer` token scoping + CSS-Module local class names.
3. **TS strictness** may differ; budget one `tsc`/lint pass (React 19
   matches, so `React.JSX.Element` is fine).
4. **Log results & cross-links intentionally absent** — by decision; not
   a regression.

## Testing
- Unit: `findScenarioData` parses snapshot research/tree; `ScenarioViewer`
  renders given a fixture scenario.
- E2E: extend `tests/e2e/scoring-flow.spec.ts` to assert the `Scenario`
  tab appears for a scenario-backed test and shows objective/person cards.
- Manual: load a run log for a scenario-backed skill (e.g.
  `question-selection`, scenario `mid-research-flynn`).

## Sequencing
Phase 0 (fixtures) and Phase 1 (pane tabs) first — small, low-risk.
Phase 2 (viewer lift) is the bulk (~2,000 lines copied + ~4 adapted +
2 new files).
