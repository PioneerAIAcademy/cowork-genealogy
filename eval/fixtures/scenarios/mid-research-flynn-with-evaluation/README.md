# mid-research-flynn-with-evaluation

Single-mutation derivative of `mid-research-flynn` for validate-schema test `ut_validate_schema_010`.

- **Mutation:** one valid `evaluations[]` entry added (`ev_001`: focus `on-demand`, target_type `question` → `q_001`, verdict `looks_solid`, ISO timestamp, `superseded_by` null). The base scenario's `evaluations[]` is empty.
- **Expected validator result:** valid, 0 errors.
- A false-positive guard: it is the only scenario that exercises the validateEvaluations code path. Everything else is identical to mid-research-flynn.
