# mid-research-flynn-cross-file

Single-mutation derivative of `mid-research-flynn` for validate-schema test `ut_validate_schema_008`.

- **Mutation:** `sources[0]` `gedcomx_source_description_id` changed from `S1` to `GX-MISSING`, which is not a source id in `tree.gedcomx.json`.
- **Expected validator result:** invalid, 1 error — `research.json/sources[0]: gedcomx_source_description_id 'GX-MISSING' not found in tree.gedcomx.json sources`.
- Exercises the cross-file integrity check (spans both project files). Everything else is identical to mid-research-flynn (otherwise clean).
