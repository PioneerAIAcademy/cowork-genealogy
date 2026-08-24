# validate-schema — prohibition list (Step 1 of the deep-dive guide)

Built from `packages/engine/plugin/skills/validate-schema/SKILL.md` as `main` leaves
it. Every line below is checkable by eye against a run-log transcript
(`output.text_response`, `output.tool_calls`, `output.file_changes`) — with one
caveat this skill forces: `validate_research_schema` is a **live** tool whose
`response` the persisted run log **omits** (see F3), so the *content* of the
errors the skill was relaying is not in the committed log; a validator, which runs
in-process, still sees it.

Judgement calls ("is the explanation clear", "is the fix well-chosen") are
deliberately excluded — they belong to the judge, per the guide.

**Save this file. The next auditor of `validate-schema` starts here instead of rebuilding it.**

---

## A. Tool use

1. Call `validate_research_schema` with the project directory path. It is the only
   tool and the whole job — read the result and relay it.
2. Call **no** other MCP tool. (Only `validate_research_schema` is in `allowed-tools`.)

## B. Read-only discipline

3. Never edit a file to fix an error — not `research.json`, not `tree.gedcomx.json`,
   and not a `results/` sidecar. A validate-schema run produces **zero** file changes.
4. Don't offer to apply the fix — the user fixes their own files.

## C. On errors

5. Surface each reported error with its concrete detail — which object, which field,
   what value.
6. Explain each error in plain terms.
7. Suggest a concrete fix for each that clears the error without creating a new one
   (don't dangle a reference or drop a required field).
8. Don't guess required fields — a `research.json` source and a `tree.gedcomx.json`
   source are different shapes.

## D. On a clean project

9. Confirm the pass **specifically** — name **both** `research.json` and
   `tree.gedcomx.json`, and note what validated (required fields, enum values,
   ID-prefix conventions, cross-file references). Not a bare "valid."

## E. On a missing file

10. The tool reports which file is missing; if `research.json` is missing, point the
    user to init-project (both files are created together).

## F. Scope

11. Schema only. Route logical impossibilities (birth after death, etc.) to
    **check-warnings**, and proof/GPS-quality questions to **proof-conclusion** —
    decline and hand off; never answer them with a schema-validation result.

## G. Narration

12. Read `researcher_profile.narration_guidance` from `research.json` and apply it.
