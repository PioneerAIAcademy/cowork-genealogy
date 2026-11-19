# flynn-answered-skip-unsound

`flynn-exhaustive-ready` as it stood at commit 6b833fed7, before it was rebuilt on
2026-11-16. Kept as its own scenario for `ut_research_exhaustiveness_023`.

q_001 asks who Patrick Flynn's father was. Two plan items are `skipped` with
`skip_category: "answered"`: `pli_007` (the 1870, 1880 and 1900 censuses) and
`pli_009` (Thomas Flynn's naturalization). The reason given for `pli_007` is that
three sources already converge and the later censuses "cannot contradict" them.

That claim does not survive the stop criteria. The only source that names the
father is the 1908 death certificate (`a_013`), secondary information from a
son-in-law. The 1850 and 1860 censuses state no relationship; the household
placement is an inference. The 1880 census is the first to state relationship to
the head and could show Patrick as a stepson or a nephew. So `evidence_class` and
`overturn_risk` both fail, and the agent declines.

An `answered` skip disposes of the plan item; it does not stop the gate from
checking the claim (chesworthrm, PR #4628 review, 2026-11-18; within the
2026-09-02 ruling on issue #1830). Two genealogists reviewing this project on
2026-11-16 reached the same verdict. The pair is `flynn-exhaustive-ready`, whose
`answered` skip of the city directories is a claim that holds.
