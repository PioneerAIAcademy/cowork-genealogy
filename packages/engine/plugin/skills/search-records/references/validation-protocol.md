# Validation Protocol

The structured persistence tools (`research_log_append`,
`research_append`, `tree_edit`, the merge tools) **validate before they
persist** — they write nothing and return `{ ok: false, errors }` when a
write would invalidate the project. There is no need to invoke
`validate-schema` as a post-write backstop; surface those errors instead
of retrying blindly. (`validate-schema` remains available as a
user-invokable audit of the whole project.)

The tree writer tools (`tree_edit`, `tree_correct`, `merge_tree_persons`,
`materialize_facts`) also refuse a write that introduces an unjustified
genealogical warning. When a write would introduce a warning, the tool
returns `{ ok: false, reason: "unjustified_warnings" }` with each
warning's id. Re-call with `warningJustifications` for each id, or
abandon the write.

(search-records writes only log entries and plan-item status, so it does
not trigger the warning gate; the assertion-creating agents do.)
