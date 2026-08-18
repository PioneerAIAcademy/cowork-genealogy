# richardson-ashton-register-unworked

An English parish-register question with **no research done yet** — one open
question, one `planned` FamilySearch plan item, an empty log, and a tree holding
only the subject.

## Why this exists separately from `richardson-parentage-not-exhaustive`

That scenario asks about the same parish, and was tried first as the host for
`ut_search_records_028` (batch enumeration). It cannot host it. Its log runs to
six entries ending in `log_006`, where the register images were already sampled
and transcribed, with 16 assertions and 4 sources already extracted — the
register work is **finished** there. A skill given it correctly answers from
state and never searches, so the test failed a log-append validator having
exercised nothing (run `v1_2026-08-13_21-42-46`). Do not re-target a
search-execution test at a scenario whose logs already answer the question.

## Deliberately empty

`log`, `sources`, and `assertions` are empty so a search is the only way to
learn anything. The tree gives the subject a 1833 christening year but no
parents — the question. The parish's real register entries are dated **1832**;
that one-year gap is realistic and is what makes the indexed name search
inconclusive, which is the premise of the enumeration test rather than a defect
in the fixture.
