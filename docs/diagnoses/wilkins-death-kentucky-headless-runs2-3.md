# Diagnosis addendum: wilkins-death-kentucky headless runs 2–3

**Date:** 2026-07-15 · **Branch:** `e2e-elijah-wilkins-657`
**Run 2:** `run-2026-07-15_19-56-29` — partial (f2 matched; f1 took the 1918 Paducah certificate)
**Run 3:** `run-2026-07-15_22-19-55` — fail (both findings; 1918 Paducah again, $11.03, 191 turns)

## Run 3 is the decisive data point

The research-plan breadth fix (`05a3400d`) **worked as designed**: run 3
planned and executed the probate lane — found the FTS-searchable Muhlenberg
probate volumes, the administrators' ledger (source S6), and executor
evidence placing Elijah **alive ~1876–1879** (which also independently
undercuts the Ancestry-only "30 Nov 1875" date, consistent with Florence's
daughter's-record theory). And then it still concluded the 1918 Paducah
certificate — a death at **age 104** against the tree's 1814 birth — with
no identity conflict logged and no `same_person` call anywhere in the run.

## Root cause (all three headless runs): the identity check is bypassed

- `record-extractor` (post-#650) deliberately **cannot link** — no
  `person_evidence` writes, no `same_person` in its tools; it flags identity
  doubts upward.
- The **person-evidence skill** owns linking and mandates `same_person`
  scoring before links (its SKILL.md line ~209).
- In runs 1–3 the person-evidence skill was **never invoked** (0 transcript
  occurrences in run 3): the orchestrator wrote `pe_` links inline via
  `research_append`. The one step holding the deterministic identity check
  was skipped every time. (In the pre-#650 mikkel run, person-evidence ran
  and `same_person` scored 0.988 before linking — the discipline existed
  and was lost to the routing change.)

## Fix applied (this branch)

`/research` SKILL.md (gate-exempt orchestrator): the "assertions not yet
linked" routing row now hard-forbids inline `person_evidence` writes — the
orchestrator always routes through the person-evidence skill, which scores
every cross-record link with `same_person` first.

## Still open (Dallan-meeting material)

- **Deterministic backstop candidate:** a `research_append` precondition on
  `person_evidence` appends (e.g. require/attach a `same_person` score for
  confident cross-record links) would make the check structural rather than
  routed — needs schema/spec design, not a patch.
- `image_read` 700KB cap blocked certificate-image verification in run 2
  (deferred issue, now with a measured cost).
- The completed-gate (`97aa8cd6`) held in runs 2–3 (nothing to fire on —
  no conflict was recorded); it remains the backstop for run-1-shaped
  failures only.
