# Validation Protocol

The persistence tools (`research_log_append`, `research_append`,
`tree_edit`, the merge tools) **validate before they persist** and
write nothing on `{ ok: false, errors }`. You no longer run a
post-write structural validation pass by hand — if a write returns
`{ ok: false }`, fix the inputs and re-call; surface the errors to the
user rather than retrying blindly. (`validate-schema` remains available
as a user-invokable audit, but is not a required step after a tool
write.)

1. **Invoke `check-warnings`** if you added assertions or
   person_evidence entries. This checks for genealogical
   plausibility — impossibilities like married before 12, died after
   120, or a child born after a parent's death — which is judgment the
   structural validation does not cover. It is not auto-triggered; you
   must invoke it explicitly.
