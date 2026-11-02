# g9gj-fulltext-hits-unextracted

`g9gj-proof-update-after-later-search` (Iram F. Hyde, Family Tree G9GJ-959) as it stood before the two church-register hits of the full-text search `log_017` were extracted. Every hit of `log_017` is unextracted here, so a hit there can carry a fact the tree lacks, and a search-hit review has Matches to offer. Issue #3522.

The base scenario's README tells the project's story and its migration; everything it says holds here except the removals below.

## Changes from `g9gj-proof-update-after-later-search`

- **Removed:** `a_019` (the c. 1820 Jackson marriage, from hit 6 `3Q9M-CSK3-ZSH4`) and `a_020` (the 1834–36 baptism naming "Mary Robertson & Hiram Hy", from hit 9 `3Q9M-CSK3-ZSLR`); their links `pe_013` and `pe_014`; their source `src_006` and its tree source `S7`.
- **R1 (the I1–I2 Couple)** no longer cites `S7`. It still cites `S6`, the 1826 mortgage.
- **`ps_002.supporting_assertion_ids`** is `a_017`, `a_018`.
- **`q_002`'s question** loses its "; m. Mary Robertson 1821 Jackson, Washington Co., NY" clause, which came from `a_019`.
- **Added:** `log_022`, a full-text search whose one hit is **constructed**, not captured: `FTXT-JX28`, an 1828 deed between John Foster and Samuel Gould of the town of Jackson, "Signed Sealed and delivered in presence of Iram Hyde". It is the case Edmond Oware's review of PR #4095 asked a gold for: the target's name, legible, in a town and year his facts fit, and nothing else. No captured hit has that shape. A live search on 2026-11-02 found that every Washington County hit naming Iram Hyde also names his wife Mary, that there is none in Indiana, and that every Washington County "Hiram Hyde" is a later man of Kingsbury. The `FTXT-` id marks it as constructed, as in the Flynn scenarios.
- **Kept verbatim:** the rest of the log, including `log_017`'s notes, which say what the search found (a search is logged when it is made, and its hits are extracted later); `ps_002`'s narrative and `exhaustive_search_summary`; every other assertion, link, source and person; every other file in `results/`, byte for byte.

## What the project holds

- **Log:** 22 entries. The full-text searches with retained hits are `log_003` (20 hits), `log_008` (9), `log_017` (11) and the constructed `log_022` (1), all with transcripts.
- **Sources:** 6 entries. The only full-text hit extracted is the 1826 mortgage `3QSQ-G9WC-F61H` (`src_005`), which is hit 6 of `log_003` and hit 1 of `log_008`.
- **Assertions:** 21 entries.
- **Person evidence:** 15 entries.
- **Tree:** I1 Iram F. Hyde (Birth ~1797 New Hampshire; Death 3 Sep 1873, Wolcott, White Co., Indiana; Residence Jackson, Washington Co., NY 1850, 1855, 1860, and West Point Township, White Co., Indiana 1870). His Couple R1 with I2 Mary Robertson carries no Marriage fact. His one child is I3 Margaret E. Hyde (R2). No parent of Iram is in the tree.
- **`hit_verdicts`:** none.

## Used by

- `evaluate-search-results`: `ut_evaluate_search_results_c3n` (hit 9 `ZSLR`, a Match naming a child on no edge), `ut_evaluate_search_results_h8v` (hit 6 `ZSH4`, a Possible Match carrying a dated marriage the Couple lacks), `ut_evaluate_search_results_w9t` (`log_022`'s witness line, a Possible Match on name, time and place alone, with nothing new) and `ut_evaluate_search_results_n6t` (every hit of `log_017` with no hit ref, handed back with no tool call).
- `research`, the search-hit review: `ut_research_hv3` (hits 2, 4 and 7 of `log_008`), `ut_research_hva` (every hit of `log_017`) and `ut_research_hvy` (the yes that extracts hit 9).

## Verification

`validateProject` (`packages/engine/mcp-server/src/validation/validator.ts`) reports it valid with 0 errors and 0 warnings. Without the R1 edit it fails, because R1 would cite the removed `S7`.

## PII

Iram Hyde and his family are deceased, public Family Tree persons already named on public issue #3177. Names are kept, as for a recorded e2e run.
