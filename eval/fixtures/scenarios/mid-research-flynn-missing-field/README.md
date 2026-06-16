# mid-research-flynn-missing-field

Single-mutation derivative of `mid-research-flynn` for validate-schema test `ut_validate_schema_005`.

- **Mutation:** `questions[0]` (q_001) has its required `rationale` field deleted.
- **Expected validator result:** invalid, 1 error — `research.json/questions[0]: missing required field 'rationale'`.
- Everything else is identical to mid-research-flynn (otherwise clean).
