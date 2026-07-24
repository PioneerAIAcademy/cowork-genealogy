# Diagnosis: wilkins-death-kentucky headless run 1 (fail — wrong-person over-claim)

**Date:** 2026-07-15
**Branch:** `e2e-elijah-wilkins-657`
**Run:** `run-2026-07-15_13-57-32` (verdict `fail`, stop `completed`, proof quality 2/3, $4.57, 75 turns; run files kept local — non-passing runs are not committed)
**Prior evidence:** the first live Cowork validation run (Slack report, 2026-07-14) recovered the correct bounded conclusion on the same fixture.

## What happened

The research question's premise ("using Kentucky death certificates…") sent the
agent to the indexed *Kentucky, Deaths, 1911–1967* collection, where the only
strong Muhlenberg hit is a **1940 certificate for a different Elijah Wilkins
(b. 22 Apr 1857)** — deceptively attractive because that man's father is also
named James Wilkins. The agent:

1. **Noticed the ~43-year birth discrepancy itself** and hypothesized the FS
   profile "may conflate two different Elijah Wilkinses" — then attached the
   certificate to the subject anyway, writing both the 1940 death and the 1857
   birth onto a profile with children born 1836–1861.
2. Ran `check-warnings`, which returned **error-severity coherence warnings**
   (events before birth; death 104 years after the earliest child) — and
   rationalized them as "validating the probable tier."
3. Got a mentor `proof-critique` that flagged the `confident` person-evidence
   links contradicting the narrative's own "probable" identity call and
   demanded a formal conflict entry. (The mentor also could not execute its
   write protocol — its `tools:` list grants no Write — a separate config gap.)
4. Appended conflict `c_001` (`conflict_type: "identity"`,
   `identity_question: true`, `status: "unresolved"`, **`blocks_question_ids:
   []`**) — and then set `project.status = "completed"` with the proof at
   `probable`.

The judge correctly failed both findings: the tree asserts a different
person's death. Florence's live run on the identical fixture resisted the same
pull (bounded probate conclusion, alternatives ruled out), so the fixture is
solvable; this run is the over-claiming failure mode the fixture was
recalibrated to catch.

## Taxonomy classification (Dallan's 5 questions)

1. **Jitter?** Partially — 1 live pass, 1 headless fail. A re-run may pass. But
   re-rolling without a fix would ignore the guardrail-override this run exposed.
2. **Fixture issue?** No — the recalibrated findings and judge behaved exactly
   as designed; the "misleading" premise is the test.
3. **Rubric/judge issue?** No — the judge's per-finding reasoning is correct.
4. **Tool issue? YES (fixed).** Three guardrails fired (self-noticed
   discrepancy, error-severity warnings, unresolved identity conflict) and
   nothing deterministic stopped the conclusion. The "resolve blocking
   conflicts before concluding" rule lived only in prose. **Fix:**
   `research_append` now rejects the `project.status = "completed"` transition
   while an unresolved blocking conflict exists (`identity_question: true` or
   non-empty `blocks_question_ids`) — see spec §5. In this run, that write
   would have failed with an instruction to run conflict-resolution on
   `c_001`, whose honest resolution (1857 birth chronologically impossible
   against children born 1836–1861) unwinds the wrong-person link.
5. **Skill issue? Yes, follow-up-sized (not fixed here).** person-evidence
   linked the certificate personas to the subject at `confident` despite the
   43-year birth contradiction; a hard identity-mismatch rule belongs in that
   SKILL.md. Gated skill → own PR with suite re-run + annotation.

## Also filed from this run (separate PRs)

- **gps-mentor cannot execute its output protocol** — its frontmatter `tools:`
  grants Read + MCP read tools but no Write, so it can never create
  `evaluations/<…>.json`; the orchestrator writes the record as a fallback.
  Same config-bug family as the `mcp__genealogy__` prefix issue fixed on this
  branch.
- **record-extraction SKILL.md** still contains a `mcp__genealogy__…`-qualified
  ToolSearch example (breaks under Cowork's `genealogy-mcp` mount) — gated
  skill, needs its own suite-run PR.
