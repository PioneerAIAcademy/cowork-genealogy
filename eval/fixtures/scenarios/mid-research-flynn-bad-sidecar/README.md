# mid-research-flynn-bad-sidecar

Single-mutation derivative of `mid-research-flynn` for validate-schema test `ut_validate_schema_009`.

- **Mutation:** log entry `log_001` gains `results_ref: "results/log_001.json"`, and that sidecar is added with `returned_count: 5` while its `payload.results` array holds only 2 items.
- **Added file:** `results/log_001.json` (the deliberately-inconsistent sidecar).
- **Expected validator result:** invalid, 1 error — `results/log_001.json: returned_count 5 != actual results length 2 — payload may be truncated`.
- Exercises the validateSidecars branch. Everything else is identical to mid-research-flynn (otherwise clean).
