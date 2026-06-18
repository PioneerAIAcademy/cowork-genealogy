# mid-research-flynn-bad-id-prefix

Single-mutation derivative of `mid-research-flynn` for validate-schema test `ut_validate_schema_006`.

- **Mutation:** `person_evidence[0]` id changed from `pe_001` to `x_001` (wrong prefix). The pe_ ids are not referenced elsewhere, so only the prefix check fires (no cascade).
- **Expected validator result:** invalid, 1 error — `research.json/person_evidence[0]: id 'x_001' should start with 'pe_'`.
- Everything else is identical to mid-research-flynn (otherwise clean).
