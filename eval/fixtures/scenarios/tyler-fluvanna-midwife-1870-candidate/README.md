# tyler-fluvanna-midwife-1870-candidate

`tyler-fluvanna-midwife` (see its README for the person, the readings of her name and the
live answer) one search later: the search that found the 1870 candidate has been logged.
This is the state the reported session was in at `log_099` (feedback #4513, issue #4580).

- **Log:** 1, `log_001`, a `record_search` for `pli_002` with `subjectId: "I1"`, outcome
  `positive`. Its sidecar `results/log_001.json` holds one row: Antoine Tyler, female,
  b. 1833, household head, Cunningham, Fluvanna (`ark:/61903/1:1:MFLB-F5N`).
- **Everything else** matches `tyler-fluvanna-midwife`: q_001 `in_progress`, pl_001 with
  pli_001 and pli_002 `planned`, no sources, assertions or person evidence, and one tree
  person, I1, "Ann Tyler", b. Apr 1853. Unlike the base scenario, I1 also carries the other
  two readings of her given name as `AlsoKnownAs` names, "Antone Lightfoot" (the 1910
  census) and "Anthony Tyler".

Because that search named the subject, asked for a given name that is hers (`An*`), is
logged `positive` (not `negative`), and returned one row of one match (its page and its
`totalMatches` are both at most 5), `record_search` refuses a later search for I1 whose
birth range excludes 1833, when that search asks for one of her given names (Ann, Antone,
Anthony), for Antoine's, or for none. A search for I1 under another given name is for
someone else and is not refused, nor is a search with no given name that names a parent
(`motherGivenName` and the like), which is a search for her child. `research_append`
refuses a `namesakes` row for I1 that names Antoine: nothing in the project rules her out
but her birth year (I1 is linked to no other record, and the row's 1833 is an age, not a
full date).

Used by `ut_search_records_035` (1870 candidate).
