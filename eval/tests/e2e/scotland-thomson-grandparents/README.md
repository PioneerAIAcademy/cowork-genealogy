# George Thomson — paternal grandparents (Aberdeenshire, Scotland, 1856)

**Source PID:** `PID-TODO`
**George Thomson is deceased.** (Died 8 May 1928 in Johannesburg, South Africa.)

## Research question

> Who were the parents of John Thomson, the father of George Thomson born in Methlick, Aberdeenshire in 1856?

## What was removed from the starting tree

The paternal grandparents of George Thomson were withheld entirely — they do not appear in the starting tree:

- **John Thomson senior** (born about 1782, Methlick, Aberdeenshire) — George's paternal grandfather. Confirmed by John Thomson's 1891 Methlick death record (Statutory Registers, FHL 8047716) and the 1826 New Deer OPR marriage record.
- **Bathia Presley / Pressley / Priestly** — George's paternal grandmother, who married John Thomson senior in 1826 at New Deer parish. Confirmed by the same 1891 death record and the OPR marriage entry (ScotlandsPeople, Marriages 225 30/258, New Deer).

The 1826 OPR marriage record of John Thomson senior and Bathia Preslie (New Deer parish) is also withheld as a source — it is the primary record for both grandparents' identities.

The starting tree retains:
- George Thomson (subject) with birth, census residences, marriage to Jessie Thomson, and death in Johannesburg
- His father John Thomson (born about 1826, Methlick) with census residences and 1891 death
- His mother Margaret Simpson with birth, marriage (10 Jan 1856, Methlick), and 1916 death
- His wife Jessie Thomson
- His brother William Thomson (born 1858, died 1927)
- Seven sources documenting the above known facts

The agent has a well-anchored family: a confirmed birth record, multiple census appearances in Methlick, the marriage record of the parents, and a sibling. This gives a strong search starting point for identifying John Thomson's parents through the 1891 death record or OPR/statutory marriage records.

## Expected difficulty

hard — John Thomson's baptism was not found in OPRs. The primary evidence comes from his 1891 death record (Methlick statutory register) naming his parents, and from his parents' 1826 OPR marriage in New Deer parish. Both sources are on ScotlandsPeople, which is referenced but not natively indexed on FamilySearch. The agent must navigate Scottish statutory registers and OPR records, and the spelling variants of the mother's surname (Presley/Pressley/Priestly/Preslie) add difficulty.

## Notes for reviewers

The two required findings are the paternal grandfather (John Thomson, born Methlick about 1782) and the paternal grandmother (Bathia Presley). The third finding (their 1826 marriage in New Deer) is marked `required: false` — it is supporting evidence, not a separate answer. The agent may reach the same conclusion through either the 1891 death record or the 1826 OPR marriage entry; grade on the recovered names, not the specific source path.

**Validity run (2026-07-08):** PASS (proof_quality 2/3) — run `run-2026-07-08_06-30-09`. The agent recovered both paternal grandparents (John Thomson sr + Bathia Preslie) and their 1826 New Deer marriage entirely from FamilySearch, so the "referenced but not natively indexed on FamilySearch" caveat in the difficulty note above is **outdated**: the OPR marriage is indexed in FS's *Scotland, Marriages, 1561-1910* (collection 1771074) and the parentage-naming statutory records in *Scotland, Civil Registration, 1855-1875, 1881, 1891* — both on FamilySearch, surname variants and all. The fixture is fully recoverable via the agent's tools; the real difficulty is name variance (two "John Thomson"s across generations; Presley/Pressley/Priestly/Preslie), not source access.

**Authoring note (PID-less / Path 3):** Built from the bundled research document(s) (MckennaCooperBehrmann/Scotland AG Renewal Report.pdf) with no FamilySearch access, so the starting tree was *constructed* from the document rather than captured from a live `person_read` snapshot — sanity-check its fidelity before relying on it. `source_pid` is an unused placeholder (`PID-TODO`): §6.1 blocks every person-keyed tool, so neither the benchmark run nor the judge ever reads the PID — it is provenance only, and may optionally be filled in later if a re-snapshot or provenance link is wanted. The landing gate is the same as for every fixture (Path 1 included): a committed §14 validity run that passes (`uv run python -m e2e.validate_fixture scotland-thomson-grandparents`). Recoverability from FamilySearch records is flagged in the reviewer notes above.
