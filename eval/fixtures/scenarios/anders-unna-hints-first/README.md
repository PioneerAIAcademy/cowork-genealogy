# anders-unna-hints-first

`anders-unna-marriage-search` with a "review pending hints" item put first on the active
plan `pl_001`: **pli_002** (`record_type: "fs_hints"`, `repository: "FamilySearch"`,
sequence 1, status `planned`), whose rationale names Anders Monsen's FamilySearch id,
LKFW-9XH. The marriage search `pli_001` moves to sequence 2. Anders (`LKFW-9XH`) carries
an `ark` in the tree, the shape `project_create` writes and the one research-plan emits
a hints item for.

No searches are logged and no assertions exist, so `project_context` reads
`nextStep: "search-hints — pli_002"`: this is the state right after research-plan writes
a first plan on an identity question.

Used by the research router's routes-to-search-hints test (issue #3153).
