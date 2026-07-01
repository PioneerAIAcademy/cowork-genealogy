# Validation Protocol

`research_append`, `tree_edit`, `merge_tree_persons`, and
`merge_record_into_tree` validate-before-persist — they conform-check
the project against the published schemas and write nothing on
`{ ok: false, errors }`. So there is no separate post-write
`validate-schema` step for those writes; just surface any returned
errors. (`validate-schema` remains available as a user-invokable audit
of the whole project.)

What is NOT structural — and so still needs an explicit step:

1. **Invoke `check-warnings`** after any tree edit or merge (added or
   updated facts/relationships, or a person merge). This checks for
   genealogical impossibilities the schema validator cannot (married
   before 12, died after 120, child born after a parent's death, a
   merge that put the same person on both ends of a relationship, etc.).

This is not auto-triggered — you must invoke it explicitly.
