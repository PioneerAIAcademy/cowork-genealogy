# Orchestrator state diet — plan

> **Status:** Ready for implementation (queued behind judge-infra and
> mock-schema generation on the project board; see §6 Sequencing).
> Authored 2026-07-13 from the extractor-state-diet e2e measurements.
> Companion to the shipped extractor diet (`rx-extractor-state-diet`
> branch: `research_append` source-reuse detection, `tree_edit
> add_household_children`, `project_context` tool, extractor `Read`
> removal).

## 1. Why (measured, not hypothesized)

The extractor state diet removed the record-extractor agent's project-file
reads. The post-diet e2e runs (2026-07-13) completed all three previously
cost-capped scenarios and cut spriggs ~30%+ — but showed the **remaining**
whole-file reads live in the main `/research` orchestrator loop and the
non-extraction skills:

| Scenario | Cost | Turns | Verdict | `research.json` Reads | `tree.gedcomx.json` Reads | `toolu_*.json` Reads | project_context calls |
|---|---|---|---|---|---|---|---|
| spriggs-parents-1898 | $10.54 | 132 | pass | 12 | 3 | 0 | 4 |
| cruz-corona-ancestry | $20.84 | 192 | partial | 20 | 2 | **25** | 8 |
| bottemiller-parents | $19.56 | 200 | pass | 28 | 10 | 0 | 11 |

`research.json` grows throughout a run (bottemiller final: dozens of
sources, 100+ assertions), so late-run whole-file reads are the expensive
ones. The readers are the orchestrator's routing loop and the analysis
skills — the extractor no longer holds a Read tool.

Also observed (cruz only): **25 reads of raw tool-output JSON blobs**
(`toolu_*.json` paths). Some context path is dumping tool results to disk
and re-reading them. Unexplained; investigate before prose work (§4
phase 0).

## 2. What the readers actually need (consumer inventory)

The design core: each whole-file read answers a small routing question.
Enumerate every reader and its actual question, then serve those questions
from a projection instead. Known consumers to inventory (implementer
verifies against the three transcripts + each SKILL.md):

| Reader | Question it answers by reading research.json | Projection-shaped? |
|---|---|---|
| `/research` routing loop (Step 1 + step-3 re-checks) | which questions exist/open; which plans/items pending; which log entries have positive/partial outcome with no linked assertion (the extraction cross-check); conflicts present; resolution state | **Yes** — ids + status + counts only |
| research-exhaustiveness | plan-item status, log outcomes, assertion coverage per question | Mostly (its 7-point analysis needs some prose fields) |
| person-evidence | unlinked assertions by record_id/record_role; existing pe links; person index | Partially (needs assertion bodies for the links it writes) |
| conflict-resolution | competing assertion bodies for a named conflict | No — needs full assertion text (keep reading, or fetch by id) |
| question-selection / research-plan | question list + status, prior plans | Yes |
| project-status | everything, but it's user-invoked and rare | Leave as-is |

Expected split: the **orchestrator** can go fully projection-fed; analysis
skills get a "projection-first, read-only-when-you-need-bodies" rule.

## 3. Design

1. **Extend `project_context`** (spec §delta to
   `docs/specs/project-context-tool-spec.md`, NOT a new tool) with:
   - `logIndex: [{ id, tool, outcome, planItemId, hasLinkedAssertion }]`
     — makes the /research log-vs-assertion cross-check a lookup;
   - `plans: [{ id, questionId, status, items: [{ id, status }] }]`;
   - `conflicts: [{ id, status, questionIds }]`;
   - `questions[]` gains `status` (already truncated prose).
   Response stays compact (ids/enums/booleans; no bodies). Consider a
   `sections` param (like wiki_place_page) so callers fetch only what
   they route on.
2. **`/research` SKILL.md**: routing loop reads `project_context` instead
   of research.json; the step-1/step-3 cross-check text rewritten against
   `logIndex.hasLinkedAssertion`. Keep one full read allowance for
   entering a phase cold after compaction (document when).
3. **Per-skill read rules** (person-evidence, research-exhaustiveness,
   question-selection, research-plan): projection-first; a full file read
   only when the skill needs assertion/conflict bodies, stated in each
   SKILL.md's read-state section. conflict-resolution keeps its reads.
4. **Do NOT** build a query language or per-section file API — the
   projection is one call, one shape; YAGNI beyond it.

## 4. Phases

- **Phase 0 — the `toolu_*.json` mystery (investigate first):** find what
  wrote and re-read 25 tool-output blobs in the cruz run (transcript
  `run-2026-07-13_04-12-41` + session jsonl). If a harness/SDK context
  path dumps oversized tool results to disk, that may be free savings (or
  an SDK behavior to configure) independent of any prose change. Timebox;
  report before proceeding.
- **Phase 1 — projection extension:** spec delta, impl, tests (vitest:
  logIndex correctness incl. hasLinkedAssertion edge cases, sections
  param). Mirror in mock_mcp (generated by then, per sequencing).
- **Phase 2 — orchestrator rewrite:** /research (gate-exempt, no runlog
  cost) + the four skills (each flips its runlog → run+annotate per the
  usual cadence; batch the edits per skill to one flip each).
- **Phase 3 — measure:** re-run bottemiller (highest Read count) and
  spriggs (cheapest baseline); compare research.json Reads (28→ target
  ≤5), cost, turns. Success: meaningful Read reduction with no verdict
  regression.

## 5. Costs / risks

- Annotation: 4 suites flip (person-evidence, research-exhaustiveness,
  question-selection, research-plan) → 4 run+annotation rounds.
- Risk: a projection that omits a field a skill silently relied on —
  mitigated by projection-first (not projection-only) rules and the
  phase-3 e2e check.
- The e2e cost-cap experiment headroom (cruz/bottemiller fixtures at $25)
  should be revisited after phase 3 — if their post-diet costs drop under
  $15, revert to the default (TODO already filed).

## 6. Sequencing (agreed 2026-07-13)

1. **Judge-infra package first** — this plan's phase-2/3 verdicts and
   annotations must be graded by the trustworthy judge.
2. **Mock-schema generation second** — phase 1's projection extension must
   not hand-write another mirror (the permissive-fallback artifact class).
3. **This plan third.**
4. Enum-drift lint: anywhere there's slack; no dependency either way.
