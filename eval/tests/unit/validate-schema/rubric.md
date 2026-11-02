# Validate Schema Rubric

Grading dimensions for validate-schema unit tests. Evaluated by the LLM judge alongside the base rubric (Correctness, Completeness, Tool Arguments).

Inside a project the agent ends with one `research_log_append` call logging its report; that entry appears in the file changes summary, and its shape is checked by validators, not by you. With **no project** the call, if made, answers `ok: false`, `reason: "no_project"`: that is correct behavior, not a failed tool call or a wrong argument. Do not mark Tool Arguments or any other dimension down for it, and `(no file changes)` is the correct outcome on those tests.

**Grading note (every dimension, base dimensions included):** On an error-path test whose scenario breaks `research.json` or `tree.gedcomx.json` on purpose, the agent must leave that file broken. Any of the deterministic validators that check those files themselves (`test_research_json_validates_schema`, `test_project_files_pass_full_validation`, `test_id_references_resolve`) that fails on such a test fails by design: it confirms the fixture's error, not anything the agent did. The log entry's `outcome: "positive"` is the value the agent is told to set; it records that the check ran and produced a report, not that the files are valid. Do not mark any dimension down for either.

validate-schema is a guardrail skill: it calls the `validate_research_schema` MCP tool, then **reports** the result. On errors it must surface each one, explain what it means, and suggest a fix — without ever editing a file. On a clean project it confirms validity and stops. These dimensions grade how well it does that; they do not re-grade whether the validator itself is correct (that is the tool's own test suite).

## Tool-response interpretation & error explanation

When the `validate_research_schema` tool returns errors, did the skill correctly interpret that response — surfacing the *specific* error and explaining, in plain terms a researcher understands, what it means? (The base "Tool Arguments" dimension grades the call; this grades reading the result.)

- **N/A:** The validator returned no errors (clean-pass tests), or the prompt should route to a different skill (negative tests). There is no error to explain — score this dimension `null`, not pass/fail.
- **pass:** Every reported error is surfaced with its concrete detail (which object, which field, what value), and explained in plain language — e.g. not just echoing `'tertiary' is not a valid information_quality`, but explaining that information_quality is a fixed list and 'tertiary' is not on it.
- **partial:** Errors are surfaced but explained thinly (the raw validator string is repeated with little added meaning), or one error among several is dropped from the explanation.
- **fail:** The error is buried, paraphrased into something inaccurate, or the skill reports "valid" / stays silent when the validator actually failed.

## Fix-suggestion specificity

For each reported error, did the skill suggest a concrete, correct fix the researcher could act on?

- **N/A:** No errors were reported (clean-pass tests) or the prompt should route elsewhere (negative tests). Nothing to fix — score `null`.
- **pass:** Each error gets a specific, correct remedy — e.g. for the bad enum, "change it to one of primary, secondary, or indeterminate"; for the dangling `source_id`, "point it at an existing source or add the missing source"; for the cross-file break, "correct the gedcomx_source_description_id or add the matching source to tree.gedcomx.json".
- **partial:** A fix is offered but generic ("correct the value") without naming the valid options or the right target, or it is correct for some errors but missing for others.
- **fail:** No fix suggested, or a suggested fix that would not actually resolve the error (or would introduce a new one).

## No-edit discipline & scope adherence

Did the skill stay within its lane — report only, never silently edit a file, and not substitute a schema pass for a different check the user actually asked for?

- **pass:** The skill edits nothing in research.json, tree.gedcomx.json, or any sidecar to fix an error (its one log entry is not an edit); it reports and leaves the fix to the user. On a boundary prompt it declines to validate and points to the correct skill (check-warnings for logical impossibilities, proof-conclusion for GPS/proof-quality questions) instead of answering "the files are valid."
- **partial:** Edits nothing but blurs scope — e.g. runs schema validation *and* volunteers an off-scope opinion on logical/GPS questions, or hedges on routing instead of clearly handing off.
- **fail:** Edits a file to "fix" an error, or answers a logical-impossibility / GPS-quality prompt with a schema-validation result in place of routing to the right skill.
