The Phipps family, the tree and the 1860 census rows come from a real
FamilySearch session; every tool response in this run is mocked from it.

The tree already cites the 1860 census on the subject: `I1` carries source
`S4`, 'Benj Phillips, "United States, Census, 1860"', whose url ends in
`ark:/61903/1:1:MHR9-JWT`. That record is indexed under the surname Phillips,
not Phipps; the subject's name in the tree is Benjamin Fairbanks Phipps. The
project log is empty before the run, so `research.json` has no log entries,
sources or assertions yet. That is the state the fixture was built to hold, not
a defect in it.

`research_log_append` refuses a `record_search` entry logged `negative` when its
rows include a record the tree cites on the search's subject. A refusal followed
by a corrected entry is the tool working, not an agent error.
