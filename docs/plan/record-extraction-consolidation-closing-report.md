# Record-extraction consolidation — closing report

> **Status:** Window closed 2026-07-13. Shipped: #646 (eval repair),
> #647 (tree_edit fixes), #648 (composite persist), #649 (lane rule),
> #650 (extractor agent + router + assertion-classification deletion),
> #651 (extractor state diet). This report is the evidence check the
> plan promised: the five previously-worst e2e scenarios re-run on the
> post-window architecture (9 runs total), diffed against the July
> audit's 15 themes (27-scenario baseline). Runs are
> ungraded by decision; every status below is grounded in transcripts
> and tool calls, not judge scores.

## 1. Per-theme verdict

Codes: **ELIM** eliminated · **IMPR** improved · **PERS** persists ·
**WORSE** worsened · n/e not-exercised.

| Theme (July incidence in these 5) | birk | cruz | zuniga | bottem | spriggs | Verdict |
|---|---|---|---|---|---|---|
| T1 inline extraction (all 5) | ELIM | ELIM | ELIM | ELIM | ELIM | **Dead** — 40/40 records via record-extractor delegations, zero inline passes |
| T2 classification rework (all 5) | ELIM | ELIM | ELIM | ELIM | ELIM | **Dead** — skill deleted; classify-once held everywhere |
| T3 persona nulls (4/5) | n/e | IMPR | ELIM | IMPR | IMPR | Validator enforces pairing; convention still run-dependent (cruz nulled provenance in one retry) |
| T4 S-before-src ordering (4/5) | ELIM | ELIM | ELIM | ELIM | ELIM | **Dead** — composite persist makes the failure unreachable |
| T5 payload traps → deletion (4/5) | IMPR | ELIM | n/e | IMPR | IMPR | Traps still fire (~7 rejections) but **zero deletions/fact drops** |
| T6 fact-less stubs (all 5) | n/e | PERS | PERS | PERS | PERS | **Persists by design** (deferred); now the top recall drag (cruz's partials trace to it) |
| T7 record_id divergence (3/5) | IMPR | PERS | ELIM | ELIM | IMPR | Caught loudly or gone; residual at the image seam + one cruz dup |
| T8 identity over-reach (4/5) | PERS | PERS | n/e | IMPR | ELIM | **Persists** — fabricated 0.92 match_score (birk); unmerged duplicate identities (cruz) |
| T9 junk standard_place (3/5) | n/e | IMPR | n/e | IMPR | PERS | Country guard works cross-country; same-country junk still ships (spriggs "Hancock, Ohio") |
| T10 dead references (all 5) | ELIM | ELIM | ELIM | ELIM | ELIM | **Dead** — superseded by the agent architecture |
| T11 FAN inconsistency (4/5) | n/e | IMPR | IMPR | PERS | IMPR | Uniform within a record; still varies across runs (bottem 3/13 personas) |
| T12 yield/continue-nudges (all 5) | ELIM | IMPR | PERS | PERS | PERS | **Persists, relocated** — stall locus moved from extraction to orchestrator routing seams |
| T13 image escalation (4/5) | IMPR | PERS | PERS | PERS | IMPR | Behavior fixed; **tool-blocked**: image_read's ~1 MB transport cap failed 7+ attempts across 4 scenarios |
| T14 batch op drops (3/5) | IMPR | ELIM | n/e | ELIM | ELIM | **Dead** — opsReceived echoed on every failure; zero drops observed |
| T15 conflicts trial-and-error (3/5) | IMPR | PERS | IMPR | **WORSE** | IMPR | Retries 4-5 → 1-2, but the genre spread to evaluations/person_evidence; bottem ~6 conflict rejections vs July's 0 |

**Headline:** five themes dead outright (T1, T2, T4, T10, T14 — the
delegation architecture, composite persist, and opsReceived echo killed
the audit's structural failure modes in every scenario that exercised
them); five improved with named residuals; T6 persists as the accepted
deferred item; T8/T12/T13 persist for real; T15 worsened in one scenario
by migrating to newer schemas.

## 2. Cost story

- **spriggs** is the proof the diet works at scale: a completed
  **$10.54 pass** (3 sources, 40 assertions, mentor critique) where
  pre-window runs blew past the $15 cap. Its three runs also bound the
  variance: $8.95–$16.44 on an identical build.
- **birkeland** $7.29/131 turns (July) → **$6.78/93 turns**;
  **zuniga** $7.45/149 → **$6.59/106**. Output tokens fell in every
  scenario — the prose diet held.
- **cruz** ($20.84 completed) and **bottemiller** ($19.56 completed
  pass) now *finish* where they previously died capped — but at
  ~$17–21/attempt. The bill moved rather than vanished: the driver is
  **input/cache-side growth** (cruz: 15.9M cache-read tokens vs July's
  8.9M) from 7–11 fresh-context delegations each re-loading project
  state. That is precisely the orchestrator-state-diet target
  (`docs/plan/orchestrator-state-diet-plan.md`); July's "cheaper"
  bottemiller only looked cheap because it timed out unfinished.
- Caps: default stays $15 (the regression tripwire); cruz/bottemiller
  keep $25 (Dallan's ruling) pending the orchestrator diet.

## 3. New-issue clusters (the next generation)

1. **Parallel-agent coordination.** Concurrent extractors duplicated
   tree persons (cruz: two delegations each created the same four
   grandparents, unmerged; bottem needed merge_tree_persons);
   **delegation prompts overrode agent doctrine** (birk: the
   orchestrator instructed "create person_evidence entries…
   Confidence should be confident" against the agent's lane rule, and
   the agent complied, fabricating a 0.92 match_score no tool
   produced); agents lack tools for assigned jobs (gps-mentor has no
   write path in the SDK env). Prose lanes don't survive callers who
   prompt against them — the fix is structural (section-level write
   authorization by caller, mirroring the tree_edit/tree_correct
   pattern). **Board: "Delegation prompt-injection" (filed).** The
   duplicate-person problem is a hard prerequisite on the fan-out task.
2. **Schema guessing on unexampled sections.** The identical
   evaluations-append rejection (missing `file_path`/`superseded_by`,
   unexpected `strengths`/`must_address`) hit 4+ runs across 4
   scenarios; PLACEHOLDER ids leaked into one composite batch. A worked
   example per remaining writer section (or extending the projection/
   crib approach) would kill most of this.
3. **Oversize tool results.** fulltext_search / external_links_search
   dumps of 79–136K chars overflow the token cap to files and cost a
   reader-subagent detour (4 runs). **Board: "Oversize search-tool
   results" (filed).**
4. **Provenance leakage.** Citation-less tree sources (cruz 11/14),
   citation-less conclusion facts (birk F1/F2 — a regression from
   July's runs), and provenance-nulling as an error-recovery pattern.
   Folds into the materialization-gap ownership spec.
5. **Infrastructure tail.** Mid-run context compaction (birk), a
   harness stop_reason misclassification (spriggs), unconfigured
   wiki_place_page in the eval env.

## 4. Honest limitations

A 5-scenario re-baseline of the previously-worst cases: some improvement
is regression-to-the-mean, and single-run scenarios (birkeland, zuniga)
can't separate fix from variance — spriggs' three runs on one build
ranged $8.95–$16.44. Six of seventy-five theme cells are not-exercised,
which is absence of opportunity, not evidence of cure (T5's
nested-shape crash path and T14's truncated-batch branch were never
re-triggered). The runs are ungraded; several verdicts rest on
cost-capped or error-terminated runs; cruz/bottemiller ran under raised
caps, confounding completion-rate comparison. The judge has not been
upgraded since July, and the new failure classes documented here
(duplicate identities, provenance nulling) are invisible to it — found
only by transcript reading, which is exactly the argument for the
judge-infra package being first on the board.

## 5. Disposition

All five of the window's recommendations shipped; the three
top-incidence themes are structurally dead; every persisting theme maps
to a board item that was deliberately deferred, and the re-runs added
two new Ready items (delegation prompt-injection; oversize results)
plus riders on existing ones (duplicate-persons prerequisite on
fan-out; provenance leakage on the materialization spec; same-country
junk on the guard-hardening item). Execution order stands: judge-infra
→ mock-schema generation → orchestrator state diet (+
partials-to-passes riding judge-infra's annotation round).
