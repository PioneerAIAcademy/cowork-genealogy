# Quarantined exploratory runs — issue #2491 (do NOT move back under `eval/runlogs/e2e/`)

These four e2e runs were produced by the #2491 fan-out experiment on a
**modified `research/SKILL.md`** (Shape A control and Shape B variant). They are
kept as **exploratory evidence only**, never as calibration corpus.

They live here — a sibling of `eval/runlogs/e2e/`, not under it — on purpose:
`e2e/runlog_selection.py::all_result_jsons` (and everything built on it —
`corpus_report.py`, `cache_window.py`, `compaction_report.py`, latency/judge
reports) iterates `eval/runlogs/e2e/<slug>/` only. A modified-skill run left in
that tree would silently skew every repo-wide figure. Quarantining here keeps
them readable for the #2491 analysis while invisible to those scanners.

Per the lead ruling (@chesworthrm, #2491, 2026-09-15): the four runs "stay
exploratory — re-analyzed, not discarded" and must be kept out of
`eval/runlogs/e2e/`.

| shape | fixture | run | stop_reason (real) | extracted | wall-clock |
|---|---|---|---|---|---|
| B | ogletree-children | run-2026-09-14_15-43-39 | timeout | 19 | 120.3 min |
| A | ogletree-children | run-2026-09-15_00-49-41 | end_turn (labelled cost_cap) | 2 | 84.5 min |
| B | jimmie-jewel-neal | run-2026-09-14_21-31-26 | timeout | 8 | 180.3 min |
| B | stribling-father-1821 | run-2026-09-14_23-10-02 | completed | 8 | 94.8 min |

Do not commit these into the calibration corpus and do not pool them with runs
collected under any revised protocol.
