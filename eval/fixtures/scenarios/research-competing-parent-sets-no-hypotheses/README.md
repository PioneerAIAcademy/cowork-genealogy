# research-competing-parent-sets-no-hypotheses

Mined from issue #3177, puzzle 1 (Family Tree GHLT-TFG, James Tarrant, b. 1792 SC, of Gallatin Co., IL), a Cowork run on 2026-10-06. The tree imported at init-project links James to **two parent sets**: Samuel Tarrant + Elizabeth (I2/I3, relationships R1/R2) and James Tarrant Sr. + Jane Burch (I4/I5, R3/R4), all sourced only to the Family Tree (`S1`). In the run, `/research` reached `proof-conclusion` with `hypotheses` and `conflicts` both empty, and the proof narrative eliminated the James Sr. parent set inline. That breaks the research skill's conflict/hypothesis contract. The router should have spawned `@plugin:hypothesis-tracking` to set up one hypothesis per parent set first.

- **Objective / question:** q_001, parents of James Tarrant; open, not declared exhaustive.
- **Plan:** pl_001, three items, all `completed`.
- **Log:** log_006 (1810 census, Warren Co., KY), log_008 (War of 1812 pension index), log_020 (1792 Greenville Co., SC deed). All positive and all extracted; sidecars in `results/`.
- **Assertions:** 10, every one linked in `person_evidence`.
- **Hypotheses / conflicts / proof_summaries / evaluations:** empty.

## This is a constructed carve, not the literal pre-failure state

The real project was messier when proof-conclusion ran. It had 10 positive log entries never extracted, 11 unlinked assertions (the Danville 1814 enlistment and four 1812 service cards), and 4 plan items still `in_progress`. In that state the table's first row is `record-extraction`. The operator could not say whether the run reached its interim draft unprompted, so this carve isolates the #3177 failure instead:

- Every unextracted log entry, with its source and assertions, was removed. So were the plan items that pointed at them.
- The remaining plan items were set to `completed`.
- Samuel's tree death fact (1802) was removed. It contradicts the 1810 census assertion, which would make `conflict-resolution` an equally correct first route, and this test asserts only one route.

- The source run used an install that predates the 2026-09-18 rename of the assertion evidence field to `record_basis`. The assertions were migrated with the engine's own back-compat mapping (`src/utils/record-basis.ts`: direct → stated, indirect → inferred).

Verify the carve before relying on the test.

## PII

The persons are deceased, public Family Tree persons already named on public issue #3177, and the competing parent sets are the finding under test. Names are kept, as for a recorded e2e run. Review before committing.
