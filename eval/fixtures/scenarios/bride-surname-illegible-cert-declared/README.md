# Scenario: bride-surname-illegible-cert-declared

Identical facts to `bride-surname-illegible-cert`, but `q_001` has been
**prematurely declared exhaustive** (`status: exhaustive_declared`,
`exhaustive_declaration.declared: true`) despite the bride's maiden surname
still being tentative (illegible on the only record).

Used to exercise `proof-conclusion` directly: given this (flawed) declared
state, the skill must write the proof **without** asserting that the maiden
surname "requires the marriage certificate image" or is otherwise
unresolvable — it must name the unsearched alternative (premarital census /
vital record) as an open avenue — and it must copy the `src_001` citation
**verbatim** from research.json rather than paraphrasing it.
