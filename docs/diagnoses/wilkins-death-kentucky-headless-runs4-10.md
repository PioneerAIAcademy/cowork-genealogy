# Diagnosis addendum: wilkins-death-kentucky headless runs 4–10

**Branch:** `e2e-elijah-wilkins-657` · closes the arc begun in
`wilkins-death-kentucky-headless-run1.md` and `…-runs2-3.md`.

The fixture asks: *using Kentucky death certificates, when/where did Elijah
Wilkins (b. c.1814, Muhlenberg) die, and what confirms his identity?* Ground
truth: **no Kentucky death certificate exists** (statewide registration began
1911; he died ~1875). The recoverable evidence is a **browse-only county estate
administration** (son Jesse as administrator) reachable only by full-text search,
plus **children's death certificates** naming him as father. Ten headless runs
turned every failure into an engine fix.

## Run-by-run

| Run | Verdict | Behavior | Fix it drove |
|----|---------|----------|--------------|
| 1 | fail | attached the 1940 (b.1857) cert; completed over an unresolved identity conflict | `research_append` completed-gate |
| 2 | partial | took the 1918 Paducah cert; `image_read` 1MB cap blocked cert-image checks | research-plan breadth rule |
| 3 | fail | breadth fix worked (probate + FTS reached) but still linked 1918 (age 104); `same_person` never called | `/research` person-evidence routing (never inline) |
| 4 | fail | no wrong cert (discipline held) but under-claimed; no death fact | — (variance; path proven) |
| 5 | partial | identity confirmed; bounded conclusion in proof but not encoded (pre-fact-gate) | tree-encoding gate widened to facts |
| 6 | fail | encoded 1918 into the tree; `same_person` scored the link 0.026, linked "probable" | person-evidence autonomous no-link rule |
| 7 | fail | sound work, zero conflation, honest "not determined" — but tree left silent on death | (revealed the bounded-encoding gap) |
| 8 | fail | reverted to 1918 cert; 0 `fulltext_search` calls (never pivoted to browse-only probate) | search-records low-index → full-text pivot |
| 9 | fail | **best identity work** — eliminated all 3 wrong certs by evidence, zero conflation — but still no death conclusion encoded | (confirmed the bounded-encoding gap; proof-conclusion doctrine) |
| 10 | **partial** | wrong Elijahs on separate stubs, real Elijah confirmed, **bounded Death fact encoded** ("after 1870, before 1880", KY) at probable | committed as the validity artifact; f2-guard wording fixed |

## The two arcs

1. **Over-claiming → cured.** Runs 1/2/3/6/8 attached a wrong same-name man's death. The person-evidence routing + autonomous no-link rules ended it: run 9 and run 10 eliminated every wrong cert by evidence and put the namesakes on separate stubs.
2. **Under-claiming → addressed.** Once it stopped grabbing wrong certs, it left the tree silent on death (runs 4/7/9) because it collapsed the whole finding to `not_proved` when the exact date was unreachable. The proof-conclusion bounded/documented-negative doctrine fixed this: run 10 tiered the bounded "after 1870, before 1885; no KY certificate exists" at probable and encoded it — producing the first committed **partial**.

## Engine improvements shipped from this one fixture

completed-gate · research-plan record-type-premise breadth · `/research`
person-evidence routing · tree-encoding gate covers facts · person-evidence
autonomous weak-match no-link · search-records low-index→full-text pivot ·
proof-conclusion bounded/documented-negative encoding · agent tool-name
(Cowork mount) fix. Each with a unit guard.

## Residual — for engine follow-up (not fixture tuning)

- **Deterministic identity backstop.** The anti-conflation behavior is real but
  not *reliable* run-to-run (run 8 conflated where run 9/10 didn't). Reliability
  needs a tool-level guard: require a `same_person` score **and** an
  age-plausibility check before a confident cross-record death link. This is the
  single change that would move the fixture from reliably-partial to reliably-pass.
- **e2e judge drops findings from `per_finding` on long finding descriptions**
  (observed run 9/10 — only `f1` emitted). Looks like structured-output
  truncation; keep finding descriptions tight, and consider raising/guarding the
  judge's structured-output budget.
- **`image_read` 1MB inline cap** blocked reading register/certificate images
  (runs 2, and the browse-only path generally).

A `pass` needs the identity backstop; the fixture is honestly calibrated to its
two-part question and reliably reaches **partial** with the shipped fixes.
