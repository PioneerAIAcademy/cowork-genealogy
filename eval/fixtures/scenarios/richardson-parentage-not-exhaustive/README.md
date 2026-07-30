# richardson-parentage-not-exhaustive

Pre-proof state of a parentage question where the research is **not yet
reasonably exhaustive**: `questions[0].exhaustive_declaration.declared`
is `false`, and several planned searches remain unexecuted in `plans`
(including a census that could corroborate *or contradict* the
parentage). The subject and both candidate parents (`I1` father, `I2`
mother) are already identity-linked via `person_evidence`, and all 16
assertions are classified, so `proof-conclusion`'s precondition gate
passes and it will write a fresh conclusion.

**Bug this captures.** In the source run, `proof-conclusion` selected
tier `probable` (defensible, given non-exhaustive research) but wrote a
`narrative_markdown` that overclaimed to *Proved* — it stated the case
was "proved," that "all five components of the GPS are satisfied," and
that "the research is reasonably exhaustive," directly contradicting the
`exhaustive_declaration.declared: false` state and the open plan items.
The test replays this state and checks that the new conclusion's
narrative certainty **matches its assigned tier** — no "proved" /
"reasonably exhaustive" language while research is not declared
exhaustive and planned searches remain.

**Source.** Carved from the e2e research project
`eval/e2e-project/john-richardson-parents/` (fixture
`eval/tests/e2e/john-richardson-parents/`). The subject, John Richardson
(1833–1906, LR9N-VGQ), is deceased and public and committed as an e2e
fixture, so real identifiers are kept deliberately (per the recorded-e2e
exception) — the parentage names/dates are the substance under test, not
incidental PII.

**First-cut caveats — verify before committing:**
- **The carve is the state just *before* the bad proof was written** — I
  removed only the `proof_summaries` entry `proof-conclusion` produced;
  everything else is the input it saw. Confirm nothing else in
  `research.json` is downstream of that write.
- **`tree.gedcomx.json` is copied verbatim** and already carries the
  parent `ParentChild` edges (materialized by `person-evidence`). If the
  source run left any `primary: true` marks on the parent facts (a
  `proof-conclusion` §6 act), reset those to the pre-proof (un-`primary`)
  state if you want the "Tree encoding" dimension to grade cleanly; the
  tier/narrative-consistency judgment does not depend on it.
- This scenario is a faithful superset, not a hand-minimized state — trim
  unrelated entities in the CRUD UI if desired.
