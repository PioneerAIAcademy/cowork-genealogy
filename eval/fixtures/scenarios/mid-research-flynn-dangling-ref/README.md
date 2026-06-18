# mid-research-flynn-dangling-ref

Single-mutation derivative of `mid-research-flynn` for validate-schema test `ut_validate_schema_007`.

- **Mutation:** `assertions[0]` (a_001) `source_id` changed from `src_001` to `src_999`, which does not exist in `sources[]`.
- **Expected validator result:** invalid, 1 error — `research.json/assertions[0]: references source 'src_999' which does not exist`.
- Everything else is identical to mid-research-flynn (otherwise clean).
