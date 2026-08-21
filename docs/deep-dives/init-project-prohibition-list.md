# init-project — prohibition list (Step 1 of the deep-dive guide)

Built from `packages/engine/plugin/skills/init-project/SKILL.md` as this PR leaves
it, plus `references/simplified-gedcomx-summary.md` and
`references/places-guidance.md`. Every line below is checkable by eye against a
run-log transcript (`output.text_response`, `output.tool_calls`,
`output.file_changes`) — or, where marked **[V]**, by a program.

Judgement calls ("was the pedigree analysis insightful", "is the title well
chosen") are deliberately excluded — they belong to the judge, per the guide.

**Save this file. The next auditor of `init-project` starts here instead of
rebuilding it.**

---

## A. The guard clause (before any tool call)

1. If `research.json` exists: do not initialize. Hand off in the same turn —
   **project-status** for status/resume wording, **question-selection** for
   next-question wording. The quoted one-liner is the fallback for when
   delegation is unavailable, not the primary path (resolved F10). **[V]**
2. On that path: zero MCP tool calls, zero project-file reads, and exactly one
   `Skill` call. **[V]** — the guard is now countable, which it was not while the
   body forbade the handoff the tests reward.
3. Must read `researcher_profile.narration_guidance` and apply it; when absent
   (new project), default to a one-line preamble per action.

## B. The opening turn — ask, never wait

4. All three questions (objective, experience, access) are asked in the opening
   turn, alongside the person ID/name request.
5. Must **never** stop and wait for an answer. "Asking a question and then
   stopping to wait is a failure: the project never gets created."
6. Both project files are written in the same pass, with whatever mix of stated
   answers and defaults applies.
7. No stated objective → `project.objective` is **exactly** *"General research:
   build out the tree and identify gaps and next steps."* **[V]** — already
   guarded by `test_objective_default_verbatim` (tag `objective-default`).
8. Must never invent, infer or default a *specific* research direction from the
   person's data — the verbatim generic default is the only fallback.
9. No stated experience → `intermediate`. No stated access → `["none"]`. **[V]**
   — guarded by `test_profile_defaults_when_all_default` (tag
   `opening-turn-all-defaults`).
10. The final summary must state **which** fields were defaulted.
11. Repeating the questions is allowed only *after* both files are written, and
    never as a turn-ending prompt.
12. Never persist a default profile when the opening message stated experience or
    subscriptions.
13. `subscriptions` are normalized before storing: canonical enum only,
    case-folded, trimmed, deduped, aliases mapped, unrecognized → `other`, empty
    → `["none"]`. **[V]** (closed enum).
14. `narration_guidance` is the table text for the stored `experience_level`,
    **verbatim**, not paraphrased. **[V]** — no validator today; requested as V5.

## C. Known holdings

15. User-reported only — never invent a holding.
16. Never pause to ask and wait; when nothing is volunteered, `known_holdings` is
    `[]` and no `research_append` for it is made at all.
17. Additions are invited in the closing summary only.
18. Family knowledge counts as a holding **in addition** to its use in the tree —
    "I used it in the tree" must not drop it from `known_holdings`. Excludes the
    bare research target.
19. Each entry carries `holding_type` (from the mapping table), `description` in
    the researcher's own words, `relevant_facts` (`null` if unstated),
    `relates_to_person_ids` (local `I` ids that exist in the tree, `[]` if none),
    `confidence`, `promoted: false`. **[V]** (field presence).
20. Never supply `id` or `created` — the tool assigns them. **[V]**

## D. Forget-and-rederive setup

21. Build the **complete** tree, including the very slice the researcher asked to
    leave out. Never hand-omit at construction time.
22. Never write a `.tree-before-forget…` restore file or any partial tree. **[V]**
23. Never call `tree_forget` or `project_context`, and never begin the forgetting
    in this turn. **[V]** (allow-list).

## E. Fetching the person

24. Must not call `person_read` before the opening-turn questions are asked.
25. `person_read` is called with **both** `relatives: true` **and**
    `sourceDescriptions: true`. **[V]** — no validator today; requested as V1.
26. No FamilySearch ID → call `person_search` **before** falling back to stubs.
    **[V]** — requested as V7.
27. `person_search` params are camelCase; `surname` is required plus at least one
    other qualifying field. Never snake_case. **[V]**
28. Ranked candidates are presented with `personId`, confidence, key facts;
    single-turn selects the top candidate.
29. No candidates → initialize from objective text only, with local stub persons.

## F. Building the tree

30. Never write either project file directly — the tree is built in memory and
    passed to `project_create`. **[V]** — guarded by
    `test_project_files_written_through_the_writer_tools`.
31. Top-level shape is exactly `persons` / `relationships` / `sources`; never
    `sourceDescriptions`. **[V]**
32. **Include** every relative returned (parents, spouse, children), every
    relationship, and every source description.
33. A person object carries only `id`, `ark`, `living`, `gender`, `names`,
    `facts`. **[V]**
34. A source description carries only `id`, `title`, `citation`, `author`, `url`.
    No `quality`, `notes`, `repository`, `accessed`. `person_read` **does** return
    `notes` — drop it, and keep the source. **[V]** — requested as V6.
35. `ark` on a person read from the FamilySearch tree is exactly
    `ark:/61903/4:1:<their FamilySearch person id>`; on a local stub the key is
    omitted. Never a page URL, never a bare id. **[V]** — requested as V2
    (resolved F17: derived, not omitted — the bare id round-trips to the person
    id, and it is the identical string `person_search` returns for that person).
36. ALL persons get local `I` ids, FamilySearch-seeded ones included. Never a
    FamilySearch PID as a person id. **[V]**
37. Names `N1…`, facts `F1…`, relationships `R1…`, sources `S1…` — minted for
    anything the tool did not id (it returns no name or relationship ids;
    `simplifyFact` passes a fact id through when FamilySearch supplies one), and
    every relationship endpoint rewritten to the new person ids. **[V]**
38. Every FamilySearch fact **and every relationship** carries a source reference
    at `quality: 1`. On the objective-only path the researcher's own statement is
    the source, and the same rule holds. **[V]** — requested as V4.
39. `quality` lives on the fact-level source reference, never on the source
    description. **[V]**
40. Never call FamilySearch tree data "unsourced" — it is sourced, at
    `quality: 1`.
41. A `standard_place` returned by `person_read` is kept exactly as returned.
    Anything else — hand-entered, or a returned fact with `place` and no
    `standard_place` — is resolved with `place_search`. Never copy `place` into
    `standard_place`. **[V]** — requested as V3.
41a. A `standard_date` returned by `person_read` is likewise kept exactly as
    returned, and never re-derived from the raw `date`. `person_read` emits both
    sidecars, not one — an earlier draft of this list had rule 41 and no
    counterpart, which is how the same defect stayed open one field over.
    **[V]** — requested as V8.
42. Simplified-GedcomX spellings: `gender` a flat string; PascalCase fact `type`;
    ParentChild uses `parent`/`child`; Couple uses `person1`/`person2`;
    `preferred`/`primary` omitted when false. **[V]**
43. No placeholder unknown-person stubs — a stub needs at least one concrete
    identifying detail.
44. A stated maiden name implies **exactly one** new person: that woman's parent,
    **not** her father. Sex unspecified; never labelled or defaulted to "father".
45. That stub spells `given: ""` (key present, not omitted) and
    `gender: "Unknown"` (key present, not omitted). **[V]**
46. Stub only the people the user named or directly implied — no others. **[V]**
    (count).
47. Reclassifying a parent later uses `tree_correct` `remove` + `tree_edit`
    `add_relationship` — never `merge_tree_persons`.

## G. Writing the project

48. `project_create` is called **exactly once**. **[V]**
49. Never supply `id`, `status`, `created`, `updated`. **[V]**
50. `subjectPersonIds` holds the primary subject's **local** tree id. **[V]**
51. `research_append` runs **after** `project_create` — never before, never
    bundled into it. One call per section or one batched `ops` call. **[V]**
    (ordering).
52. At init time every `research.json` array section is empty except `project`
    (and the two the skill writes). **[V]** — guarded by
    `test_init_empty_sections` (tag `init-empty-sections`).

## H. The summary

53. The presentation carries: objective; a **tree summary table with one row per
    person** (local id, full name, gender, key facts); pedigree-analysis
    findings; holdings recorded and what each contributes; what's missing.
54. Gaps on people the objective does not cover are context only — never proposed
    as research.
55. The next step is offered in plain language, defining "objective" and
    "research question" on first use. Never "use question-selection to…".
56. A user-vs-FamilySearch conflict is flagged with the **user's statement
    first**, and the user's information is never framed as an error.
57. `project.objective` uses the **user's** stated facts; the tree uses
    FamilySearch's.
58. When the objective disputes an existing relationship ("correct parents", "the
    right parents"), that relationship is framed as the hypothesis under
    investigation and never confirmed from the tree it came from.
59. An isolated person still gets a project, with the isolation noted.
60. Errors found in imported data are flagged, never silently corrected.
