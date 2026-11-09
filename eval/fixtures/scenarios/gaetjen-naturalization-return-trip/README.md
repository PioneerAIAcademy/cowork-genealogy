# gaetjen-naturalization-return-trip

The counterpart to `gaetjen-naturalization-interval` for issue #3969: the same
June 1871 arrival (`src_002`, `a_014`) and 13 August 1875 naturalization
(`src_001`, `a_007`), plus a project record showing Hermann already resident in
San Francisco before the arrival. The arrival is then a return trip, so the
four-year interval decides nothing and must not be flagged as a shortfall.

**SYNTHETIC RECORD.** `src_003` and everything hanging from it are made up for
this test. No such entry was looked up or found. They are:

- `src_003`, an entry in the 1869 San Francisco city directory, "Gaetjen
  Hermann, apprentice, 5 Cook" (p. 266). It shares the 1875 Great Register's
  5 Cook Street address. The record id is `capture:sf-directory-1869-gaetjen-hermann`,
  with no `record_persona_id`, so `same_person` is never needed for it.
- `a_015` (name) and `a_016` (residence, 1869, San Francisco).
- `log_023`, the archive.org lookup that found it.
- `pe_001` and `pe_002`, linking both assertions to I1 at `probable`.
- In the tree: source description `S52`, and the residence `F3` on I1
  (`assertion_id` a_016, citing S52).

Residence from 1869 to 13 August 1875 is more than five years, which clears the
1802 act's requirement.

**Why a return trip and not the 1862 act.** From 1869 Army enlistments ran five
years, so a man who arrived in June 1871 could not have been honorably
discharged by August 1875 without an unusual early discharge. An earlier
residence is the plainer exception, and the shared street address ties it to
the register entry.

Everything else is as in `gaetjen-naturalization-interval`: `namesakes` is
empty, and `same_person` scores the register 0.43 and the arrival 0.006.
