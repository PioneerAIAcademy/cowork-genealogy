# Record-extraction consolidation — two-day execution plan (v2)

> **Status:** EXECUTED (2026-07-11 → 2026-07-13). All five workstreams
> shipped: #646 (eval repair), #647 (tree_edit fixes), #648 (composite
> persist), #649 (lane rule), #650 (extractor agent + router + deletion),
> plus the follow-on extractor state diet (#651). Deferred items live on
> the project board (Ready column) and docs/TODOs.md — NOT in this doc.
> Closing evidence: the window-closing theme-incidence analysis (see the
> wrap notes in #651). Historical plan text follows unchanged.
>
> v2 after adversarial panel review (4 lenses, all `needs-rework`;
> findings incorporated below, §8). Dallan + Claude, 2026-07-11. Execution
> window: 2026-07-11 → 2026-07-13, no other teams editing.
> **Working model:** agent + human pair. Claude: specs, code, prose, tests,
> PR prep. Dallan: design-fork approvals, PR merges, human annotation
> (a run+annotation pass is a **merge precondition** for every PR that flips
> the runlog snapshot — CI rule 3), and e2e re-runs. Pre-launch: no
> backward-compatibility paths; one simple way to do each thing.
> Standing authorization: Claude applies surgical SKILL.md improvements as
> found (logged per PR). Applied 2026-07-11: qualified ToolSearch names,
> no-prose-in-`value`, tolerant sibling matching + contradiction routing,
> real-access-date rule.

## 1. Why (compressed evidence — with confounds stated)

Four compounding causes explain the 781-line size and the
every-team-edits-it churn:

1. **Invocation drift (21/27 e2e scenarios, #1 theme).** The *orchestrator*
   invokes the skill once; records discovered on later plan items are
   extracted inline from decaying context, where nearly all defects occur.
   In-skill passes are consistently clean. `/research` already has two
   layers of re-invocation prose and still failed 21/27 — the fix must be an
   enforced per-record contract, not more prose of the same kind.
2. **Classification double-ownership (18/27).** assertion-classification
   reworks 38–90% of extraction's classifications per record, sometimes
   reversing correct values (death-cert doctrine diverges between the two
   skills). One run self-certified with zero downstream corrections → a
   merged single pass is viable.
3. **Prose doing a validator's job.** `add_person` inline facts rejected for
   missing `id` with recovery-by-deletion data loss (9/27 — verified still
   broken at `tree-edit.ts:215`), persona-id ambiguity (10/27), record_id
   form divergence (8/27), batch-retry drops (3/27), silent wrong
   `standard_place` (4/27, high). **Confound stated:** the S-before-src
   ordering theme (15/27) predates the #620 order fix; D1 is justified on
   structural grounds (one call, no id prediction, per-record interleaved
   persistence), with the Day-1 baseline run as its post-#620 measurement.
4. **Noisy eval target.** Pass rates oscillated 31%→86% across 22 commits;
   confirmed judge hallucinations; rubric/SKILL.md contradictions; three
   fixtures share `id: ut_record_extraction_014` (verified: `compare.ts`
   keys a Map on test_id — duplicates silently collapse **today**).

**Must preserve** (judge/human-credited): batched single-call persistence
(~4× wall-clock), OUTPUT ECONOMY, three-layer craft, EE citations,
epistemic restraint, negative evidence, FAN-head instinct,
validate-on-write, **tree-source dedup (reusing existing `S` entries)**,
**in-context record reuse (no re-fetch)** — the last two added in v2; both
constrain D1/D4 below. Closed enums stay spelled out in whatever prompt
does extraction.

## 2. Goals / non-goals

**Goals:** WS1 eval repair · WS2 invariants into tools (≈3 themes
eliminated, 2 mitigated, 1 detected — honest count) · WS3 per-record
extractor agent **plus `/research` per-record contract hardening in the
main path** · WS4 prose shorten (largely folded into WS2/WS3 PRs) ·
WS5 lane rule.

**Non-goals / deferred (§7):** fan-out extractors; record-type playbook
*files* (location needs a snapshot-carve-out design — in-window they exist
only as compact tables in the agent body); negative-evidence
`informant_proximity` enum; materialization-gap ownership; identity
over-reach epistemic gate in person-evidence (theme 8's surviving case);
generating the mock schema mirror from compiled schemas.
(assertion-classification deletion moved IN-window per D3.)

## 3. Decision points

- **D1 — Composite persist (`sourceDescription`, camelCase). DECIDED.**
  `research_append` gains an optional `sourceDescription` input. A sources
  append op must EITHER carry it (tool creates the `S` entry via the shared
  write layer, assigns `src_`, stamps `gedcomx_source_description_id`) OR
  reference an `S` id that already exists (the multi-repository reuse
  pattern, schema-spec §"same record via FS and Ancestry", and the credited
  tree-source dedup). **No `"$source"` placeholder:** when a batch contains
  exactly one source append, every assertion op that omits `source_id` is
  auto-stamped with it (explicit `source_id` always wins, for rare
  multi-source batches). D1 changes who assigns ids and when validation
  runs — never what can be asserted; `indirect`/`negative` evidence and
  proof-conclusion's own `tree_edit add_source` path are untouched. Only a dangling/predicted `S` is
  rejected — **as a research_append precondition, not in the shared
  document validator** (which is op-blind and would fail existing
  projects). Transaction model: apply both writes in memory, joint-validate
  once (`validateParsed` already takes both docs), then write tree-first;
  `.bak` keeps its user-recovery meaning (no rollback repurposing). Spec
  deltas: research-append §files-written, tree-edit §cross-tool-ordering /
  §tree-writer-closure.
- **D2 — persona/record-id matrix (spec'd, not vibes).** Sidecar resolvable
  → auto-fill `record_persona_id` + canonicalize `record_id` to the
  sidecar's form. Supplied-and-contradicting → hard error naming the
  expected value. Sidecar-less log entry (`results_ref: null` —
  record_read, PDF, image, pasted records, most unit fixtures) → field must
  be absent; **no error** (this is why 2d is suite-affecting, not
  "internal"). Known surviving cases, logged not solved: co-persona
  auto-fill (florencio) and upstream search that never staged a sidecar
  (spriggs) — the latter is a search-skill gap, §7.
- **D3 — assertion-classification: DELETE THIS WINDOW (Dallan: no
  technical debt; cross-suite re-runs accepted).** The deletion rides in
  PR 3 *with* the doctrine's new home (agent body; skill body under the
  PR 3′ fallback) — classification has exactly one owner at every commit.
  Blast radius, paid in-window: repoint the four negative fixtures that
  route `correct_skill: ["assertion-classification"]` (record-extraction,
  conflict-resolution, proof-conclusion, citation → they now route to
  record-extraction), update four skills' redirect prose + README + the
  schema-spec ownership table, retire/repoint its unit suite. Adds ~3
  cross-suite run+annotation rounds to Dallan's lane (≈6 total). The
  record-extraction frontmatter description changes accordingly; the 11
  routing negatives re-run as the gate — the text was never the invariant,
  the routing behavior is.
- **D4 — agent contract.** Router (thin SKILL.md) owns **acquisition and
  triage** for all four input paths — including `volume_search` and
  `@plugin:image-reader` delegation (agents cannot nest agents) — then
  delegates per record to `record-extractor` with a message carrying:
  recordId + `resultsRef` + `logId` + projectPath + (for image/PDF paths)
  the transcription text or capture path. Agent owns extraction +
  classification + persistence, serially, tools: `Read`, `record_read`,
  `place_search`, `place_search_all`, `research_append`,
  `research_log_append`, `tree_edit`, `record_person_matches`,
  `record_record_matches`. Record content re-enters the agent via
  `record_read({resultsRef})` — a sidecar read, not a live re-fetch
  (preserves the no-re-fetch behavior). **`model: claude-sonnet-5` pin
  (Dallan's call):** a better model on the weakest measured dimension, and
  the pin travels with the agent so every team's e2e run measures the same
  extraction brain regardless of session model. Dallan will move the unit
  harness default to sonnet-5 soon; until then unit runs measure router on
  the harness default + extractor on sonnet-5 — the same shape prod will
  have. PR 3 item 0 verifies the agent-mode harness honors agent `model:`
  pins.
- **D5 — recovered-retry policy lives in `eval/harness/judge/prompt.md`**
  (the Tool Arguments bands are global, not in rubric.md), accepting the
  one-time repo-wide `judge_prompt_hash` bump (warn-only), with a one-line
  mirror in rubric.md for annotators. Policy: first-retry recovery scores
  2.
- **WS1 doctrine forks — ALL DECIDED (Dallan 2026-07-11),** encoded in
  rubric + SKILL.md together so they can't re-diverge:
  1. **Death-cert:** keep SKILL.md's physician doctrine (`official_duty`
     for death date/cause/place — the medical-certification side is the
     physician's attestation); fix rubric + judge context to match.
     Genealogist sanity-check during annotation; if they overrule, flip
     both docs together.
  2. **Event date+place:** one event assertion may carry both `date` and
     `place` (schema-intended). Atomicity separates distinct *facts*
     (age vs birthplace), not attributes of one event. Rubric fixed;
     one clarifying line in SKILL.md Step 3.
  3. **Pre-1880 inferred relationships:** `unknown` (rubric already says
     it since #620) — fix the SKILL.md census-table relationship row and
     the worked example: no record informant exists for a researcher
     inference; reasoning goes in `informant_bias_notes`. Consistent with
     the negative-evidence convention. **Flag stands:** ut_002's human
     correction suggests the deferred enum value is the eventual fix.

## 4. Workstreams → PRs

Every PR that flips the runlog snapshot lists its run+annotation as a merge
precondition. First 30 minutes of Day 1: re-diff every line item below
against HEAD (the audit predates #616–#636; the `add_person` fact-id gap is
re-verified real, the ordering-prose fix is already landed).

### PR 1 — WS1 eval repair (Day 1 AM; flips runlogs → annotate before merge)

1. De-collide ut_014 → unique ids (015/016 are free). Accept orphaned
   history explicitly in the PR description (pre-launch); post-rename run
   is the new baseline for the trio. No hardcoded-id refs exist (verified).
2. Rubric: residence rule (rubric-only — SKILL.md already has it);
   Dallan's three doctrine-fork outcomes encoded in rubric + SKILL.md rows.
3. Judge context: `src_`-vs-`S` dual-id scheme; blank-columns rule; D5
   retry policy in judge/prompt.md + rubric mirror.
4. Verify: full-suite baseline run, **plus runs_per_test≥3 on the three
   flapping tests** (ut_003, ut_009, 1860-surname) — one single-run pass is
   statistically meaningless against 31–86% oscillation.

### PR 2a — tree_edit fixes (Day 1; code-only, no snapshot flip)

`add_person` assigns `F` ids to inline facts (mirror the
`add_relationship` handling); date-shape validation at write (the
`raw.trim` crash input); Couple-relationship fact targeting (verify what
#636 already covers; close the remainder). Spec deltas + unit tests.

### PR 2b — research_append composite + enforcement + SKILL.md persistence prose (Day 1 PM → Day 2 AM; flips runlogs → annotate before merge)

- D1 composite (`sourceDescription`, `"$source"`, reuse-or-create, joint
  validate) + D2 matrix + batch-failure ergonomics (per-op errors +
  `opsReceived` echo) + place guards: echo resolved `standard_place`
  values in success responses **and** two prevention levers — reject/warn
  when a resolved place's country contradicts the record's collection/
  place context, and never silently geocode a fact whose source record
  already carries a resolved `standard_place` the caller omitted.
- **Hidden edit sites now explicit:** `mock_mcp.py`'s hand-maintained
  input-schema mirror (already drifted — missing `ops`; fix that drift
  here too), tool-schemas.ts, both tool specs, affected `eval/fixtures/mcp`
  fixtures.
- **The SKILL.md persistence-section rewrite (~30 lines) ships IN THIS PR**
  — composite-only enforcement and the prose that teaches it are never
  separable (panel blocker: enforcement without prose bricks every
  extraction for a day). This is the WS4 slice that can't wait.
- Dallan's e2e re-runs start only after this PR merges.

### PR 3 — WS3: extractor agent + router + orchestrator contract + harness agent-mode + remaining shorten (Day 2; flips runlogs → annotate before merge)

0. **Honest scope (was the false-premise "1h spike"):** the unit harness
   has **no** agent support — Task is hard-disallowed, agents aren't
   staged, allowlists derive from skill frontmatter, and the image-ark
   fixture grades a *direct* `image_read` call, not delegation. Required
   harness work, budgeted ~0.5 day: stage `packages/engine/plugin/agents/`
   into the unit workspace, allow Task in agent-mode runs, union the
   agent's frontmatter tools into the allowlist, verify subagent tool
   calls land in `call_log`.
1. **Snapshot/CI coverage moves with the prompt:** extend `build_snapshot`
   (+ `eval/app/lib/snapshot.ts` mirror + shared vectors) and
   `check_runlogs` touched-skill mapping to include
   `agents/record-extractor.md` — otherwise the post-WS3 core prompt is
   editable with zero eval gating, un-repairing WS1 (~0.5 day, paired
   Python/TS).
2. `record-extractor.md` agent per D4; body = craft core + unified
   classification doctrine + closed enums verbatim + compact record-type
   tables; written against PR 2a/2b contracts; includes the theme-8
   epistemic line (uncorroborated single-record identity links cap at
   tentative + open a conflict).
3. Router SKILL.md (thin): acquisition/triage incl. image-reader
   delegation and volume_search; per-record delegation; description's
   routing clauses updated for D3 (re-run the 11 negatives as the gate);
   Step-6 handoff instructs continuing in-turn.
4. **`/research` per-record contract (main path, not fallback):** inline
   extraction is forbidden — any positive/partial log entry without a
   linked assertion MUST route through record-extraction, per record; plus
   a ~20-line hard-rules crib held in main context for any residual inline
   pass.
5. Remaining WS4 shorten lands here (one snapshot flip, one annotation):
   references trimmed to elaboration-only, load-bearing rules into the
   agent body. (The stale "delete research-log-protocol/validation-
   protocol" item is dropped — already gone from this skill; other skills'
   copies are off-limits.)
6. **Go/no-go at Day 2 noon:** if harness agent-mode isn't green, ship
   PR 3′ instead — items 3-slim (router keeps inline extraction body) +
   4 + 5; the agent lands next week behind the same contract. Verify
   either way: unit suite + two e2e smokes — birkeland-death (drift
   exemplar, *across plan items*) and spriggs (batching benchmark; budget
   includes per-record delegation overhead).

### PR 4 — WS5 lane rule (Day 2 PM; docs only)

CLAUDE.md + `docs/feedback-workflow.md`: findings classified before core
edits — (1) tooling → tool PR; (2) eval → rubric/judge/fixture PR;
(3) record-type craft → playbook (deferred surface; tables in agent body
for now); (4) core doctrine → stewarded edit gated by the unit suite.

## 5. Schedule (paired lanes; annotate-before-merge throughout)

| Slot | Claude | Dallan |
|------|--------|--------|
| Day 1 AM | HEAD re-diff (30 min); PR 1; PR 2a | Decide D1–D5 + 3 doctrine forks; annotate PR 1 run; merge PR 1, PR 2a |
| Day 1 PM | PR 2b (composite + mirror + fixtures + prose slice); run suite | Annotate PR 2b run |
| Day 2 AM | PR 3 harness agent-mode + snapshot extension; agent body | Merge PR 2b; start e2e re-runs (post-2b only) |
| Day 2 noon | **Go/no-go** → PR 3 or PR 3′ | — |
| Day 2 PM | Finish PR 3; two e2e smokes; PR 4 | Annotate PR 3 run; merge PR 3, PR 4; e2e re-runs |
| Wrap | Scoped wrap: theme incidence **in the re-run five** vs audit; latency vs baseline | Final review |

Cutline if time runs out: PR 1 → PR 2a → PR 2b → PR 3′ → PR 3 → PR 4.
PR 1 + PR 2a alone are worth the window. Annotation rounds budgeted: ≈6
(PRs 1, 2b, 3, + three cross-suite rounds from the D3 deletion — accepted
by Dallan).

## 6. Risks

- **Harness agent-mode bigger than 0.5 day** → the noon go/no-go bounds it;
  PR 3′ still attacks theme 1 via the orchestrator contract + crib.
- **Composite-op fixture ripple** → mock mirror + fixtures audited in
  PR 2b itself; spec-review agent pass on both specs before merge.
- **Per-record delegation overhead** → measured in the spriggs smoke
  (boot + sidecar re-read); if it exceeds batching gains, restrict
  delegation to multi-record runs (one routing line).
- **Wrap-diff over-reach** → claims scoped to the re-run five; no
  27-scenario extrapolation.

## 7. Deferred (owners named at wrap)

Playbook files + snapshot carve-out design.
Fan-out extractors. Negative-evidence enum value.
Materialization-gap ownership spec. Person-evidence epistemic gate
(theme 8 residual). Upstream sidecar-staging gap (spriggs).
Generate mock schema mirror from compiled schemas.

## 8. Adversarial panel disposition (4 lenses, 39 findings)

Incorporated as v2 changes: WS3 spike premise false (all four lenses —
rescoped to real harness work + go/no-go); WS3 didn't fix theme 1's
mechanism (orchestrator contract moved to main path); WS2c/prose cutover
hazard (prose slice moved into PR 2b); annotate-before-merge resequencing;
agent-prompt snapshot/CI coverage; D3 deletion blast radius (narrow now,
delete later); D1 reuse/dedup + precondition-not-validator + no-.bak-
repurposing + camelCase; D2 no-sidecar matrix; mock-mirror edit site;
place-corruption prevention levers; theme-8 naming + agent epistemic line;
"five themes impossible" → honest 3/2/1 count; #620 confound stated; D4
model-pin dropped + sidecar re-read; D5 edit target = judge prompt; stale
items dropped (reference deletion, residence-in-SKILL.md); verification
power (runs≥3 on flappers, scoped wrap). Discounted: "ToolSearch fix
already landed 2026-06-29" — the reviewer read the file after this
session's edit; pre-edit HEAD had bare names (the fix stands, listed in
the applied log).
