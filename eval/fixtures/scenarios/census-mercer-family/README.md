# census-mercer-family

A just-created project for **Margaret Mercer** (b. about 1868), imported from
FamilySearch the way `project_create` writes one: persons keyed `I1`…`I8`, each
FamilySearch id kept in `ark` (Margaret is `I1`, FamilySearch `MRCR-MOM`).
Built from the `person-read-mercer` MCP fixture.

The tree holds Margaret, her husband, and six children, all biological children
of both: Mary (b. 1889), John (b. 1891), Anna (b. 1893), Edward (b. 1896),
Grace (b. 1898) and William (b. 1906). No child has a death date.
`research.json` holds only the project header and researcher profile: no
sources, assertions or questions yet.

Used by the check-warnings census test (`ut_check_warnings_021`). The 1900 and
1910 census fertility counts arrive only in the request; nothing in the project
records them.
