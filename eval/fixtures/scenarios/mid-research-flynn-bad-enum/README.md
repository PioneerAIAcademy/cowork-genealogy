# mid-research-flynn-bad-enum

Single-mutation derivative of `mid-research-flynn` for validate-schema test `ut_validate_schema_004`.

- **Mutation:** `assertions[0]` (a_001) `information_quality` set to `"tertiary"` (not in the closed enum `primary | secondary | indeterminate`).
- **Expected validator result:** invalid, 1 error — `research.json/assertions[0]: 'tertiary' is not a valid information_quality (expected one of: indeterminate, primary, secondary)`.
- Everything else is identical to mid-research-flynn (otherwise clean).
