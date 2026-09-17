# premise-surname-origin

A brand-new project whose objective is to find a person's **parents**, gated by
an **unverified surname origin**. Rosalind Hartwell (`I1`) is recorded with the
surname "Hartwell", sourced only to the FamilySearch tree (`quality: 1`,
unverified compiled data), and is attached to a husband, Thomas Hartwell (`I2`).
Nothing establishes whether "Hartwell" is Rosalind's **birth (maiden) name** or
the **married name** she took from Thomas, so her birth surname — the fact that
unlocks her parents — is unknown.

Synthetic (no PII). Invented persons; not drawn from any real profile or the
alpha feedback that motivated the card.

Used by `ut_question_selection_016`, the regression for issue #1394: a
premise-verification question must be framed so **every branch of its answer
names a fact the objective needs**. The premise here (is "Hartwell" maiden or
married?) must be verified by naming the gating fact — Rosalind's maiden name —
not by a bare maiden-vs-married property test whose branches name nothing. The
expected outcome is asserted in the test's `judge_context`, not here (this
README is handed to the judge; issue #2478).
