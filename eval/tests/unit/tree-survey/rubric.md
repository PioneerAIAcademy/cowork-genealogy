# Tree Survey Rubric

Grading dimensions for tree-survey unit tests. Evaluated by the LLM judge alongside the base rubric (correctness, completeness, tool arguments).

tree-survey runs before any project exists. It calls `tree_gaps` once, checks what FamilySearch holds for the strongest holes (`person_record_matches`, `person_quality`, `record_search`, `collections_search`, `place_search`), and returns 3-5 suggestions, each a person and one research question. It holds no writer tool, creates nothing, and has no project to read.

## Survey

Did the agent survey the tree with `tree_gaps` and report only what it returned?

- **pass:** The agent called `tree_gaps` once, with the delegation's `personId` (or no arguments when none was given) and no invented parameters. When `gaps` was empty, it said the tree shows no holes in what was read and stopped.
- **partial:** The agent called `tree_gaps` more than once with the same arguments, or passed a parameter the delegation did not ask for.
- **fail:** The agent did not call `tree_gaps`, surveyed by walking the tree with another tool, or named a hole `tree_gaps` did not return.

## Coverage check

Did the agent check what FamilySearch holds for the holes it kept, without retrying empty results?

- **pass:** For each hole it kept, the agent used at least one of pending hints, `person_quality`, a `record_search` on the hole's place and years, or the collections floor, and treated an empty result as a result. With no holes, it made none of these calls.
- **partial:** The agent checked only some holes it then suggested, or repeated the same search after it came back empty.
- **fail:** The agent suggested a person with no check at all, or searched for people no hole named.

## Suggestions

Is each suggestion a person and one research question that `init-project` and `question-selection` can take as is?

- **pass:** Each suggestion names one person, the hole in plain words, what FamilySearch has that could fill it, and one question that is a single fact, names the person, and scopes place and years. There are 3-5 when that many holes were returned, fewer when fewer were, and one person per suggestion. No living person is suggested.
- **partial:** A question bundles two facts, omits the place or the years, or two suggestions fall on the same person.
- **fail:** A question names no person, asks for a whole family or line, or the agent invents a suggestion from a tree with no holes.

## Hand-off and prose

Does the return carry what the caller needs, and the user-facing prose only what the user can use?

- **pass:** The lines above the final `---` give each person's FamilySearch ID with its question, how far the tree was read, and the hint that `init-project` takes the chosen ID and question as the objective. Below the `---`, plain prose with no identifiers, file names, tool names or field names. The agent created no project and called no writer.
- **partial:** The prose below the `---` names an identifier or a tool, or the hint to run `init-project` is missing.
- **fail:** The agent created or wrote a project, or asked the user to pick without giving the caller the ID and the question.
