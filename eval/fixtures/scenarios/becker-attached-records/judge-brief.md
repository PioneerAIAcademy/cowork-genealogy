No call in this run reaches FamilySearch or the wiki: those answers come from
test fixtures. Tools that read or write the project's own files run for real
against a temporary copy of it.

The project is saved right after it was created: `research.json` holds the
project and its objective, and every other section is empty. In the tree, `I1`
John Becker has three sources attached at the person level: `S1` (the 1900
census record), `S2` (the 1910 census record) and `S3` (a family photograph,
not an indexed record). Nothing has been extracted from them yet. That is the
state the fixture was built to hold.
