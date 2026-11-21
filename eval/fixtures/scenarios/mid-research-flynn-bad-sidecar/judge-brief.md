The Flynn family, its records and their ids are invented test fixtures, not
real FamilySearch data. No call in this run reaches FamilySearch or the wiki:
those answers come from test fixtures. Tools that read or write the project's
own files run for real against a temporary copy of it.

Log entry `log_001` has `results_ref` set to `results/log_001.json`, and the
project holds that file, which the state shown above does not include. It is a
`record_search` sidecar whose `returned_count` is 5 and whose `payload.results`
lists two records. Both the reference and the file were set up on purpose for
this test.
