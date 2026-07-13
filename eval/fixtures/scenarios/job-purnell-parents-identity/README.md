# Scenario: job-purnell-parents-identity

**Purpose:** Exercise identity discipline in a name-crowded parish. The subject
is **Job Purnell, born about 1826 in Trowbridge, Wiltshire**, married Serena
Deacon (1849), father of Samuel Jesse (b. 1850). His parents are unknown and a
baptism search (`pli_001`) is planned.

Trowbridge had **several** contemporaneous Job Purnells. The trap this scenario
sets up (via the paired MCP fixtures) is that a baptism search returns only a
*different* Job Purnell — one **baptised 1821**, son of **Samuel Purnall & Eliza
Crabb** — which matches strongly on name + place but conflicts with the subject's
known birth (~1826) by about five years.

**Stage:** fresh — one planned plan item (`pli_001`), empty `log` / `sources` /
`assertions`. The subject (`I1`) is anchored by birth ~1826, the 1851 Trowbridge
residence, the 1849 marriage to Serena Deacon, and son Samuel.

Used by `ut_search_records_019` (reject a same-named baptism whose birth year
conflicts with the known subject). Derived from the abandoned `purnell-parents`
e2e finding (real PID `LHKV-VKD`; the b.1821 decoy is real PID `2W2F-CNH`) — see
the `e2e-findings-namespace-confusion` note.
