# flynn-skip-user-declined

`flynn-exhaustive-ready` with one plan item struck by the researcher and one
added item skipped as inaccessible (issue #4551).

What changes from `flynn-exhaustive-ready`:

- **`pli_009`** (`naturalization`, Schuylkill County, 1850-1880, `skipped`, no log
  entry): gains `skip_category: "user_declined"` and a `skip_reason` quoting the
  researcher's "skip the naturalization search". This is what research-plan's edit
  mode writes when a researcher strikes an item at "Continue with running the
  searches?". Its `rationale` is left unchanged on purpose: it is the planner's
  reason for the item, not the reason it was skipped.

- **`pli_010`** (new; `newspaper`, Thomas Flynn's obituary in the Pottsville
  Republican, 1880-1890, `skipped`, `skip_category: "inaccessible"`, no log entry):
  the paper is held only on microfilm. It is non-decisive, since three sources
  already agree on the father, so it never blocks a declaration. It must still
  appear in `not_reached`: as `skipped_plan_item`, or on a
  `nothing_further_reachable` declaration under §3's exception kind.

Everything else is identical. `pli_007` (census, `skipped`, no `skip_category`)
stays as the control: an item skipped with no category is not required in
`not_reached`.

The point: whichever way research-exhaustiveness stops q_001 — a declaration, a
decline, or a wrap-up — `search_stop.not_reached` names both the struck naturalization search and the
microfilm-only newspaper, so the proof does not drop a source nobody searched.

Used by `eval/tests/unit/research-exhaustiveness/not-reached-user-declined-skip.json`
and `not-reached-user-declined-wrap-up.json`.
