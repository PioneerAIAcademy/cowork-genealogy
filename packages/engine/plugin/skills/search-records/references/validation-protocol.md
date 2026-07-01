# Validation Protocol

The structured persistence tools (`research_log_append`,
`research_append`, `tree_edit`, the merge tools) **validate before they
persist** — they write nothing and return `{ ok: false, errors }` when a
write would invalidate the project. There is no need to invoke
`validate-schema` as a post-write backstop; surface those errors instead
of retrying blindly. (`validate-schema` remains available as a
user-invokable audit of the whole project.)

What the tools do **not** check is genealogical plausibility:

1. **Invoke `check-warnings`** if you added assertions or
   person_evidence entries. This checks for genealogical
   impossibilities (married before 12, died after 120, child born
   after parent's death, etc.). It is not auto-triggered — you must
   invoke it explicitly.

(search-records writes only log entries and plan-item status, so it does
not trigger `check-warnings`; the assertion-creating skills do.)
