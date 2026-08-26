# research-plan — prohibition list (Step 1 of the deep-dive guide)

Built from `packages/engine/plugin/skills/research-plan/SKILL.md` (521 lines) and
the three reference files it actually names — `references/planning-standards.md`,
`references/record-type-guide.md`, `references/places-guidance.md` — as `main`
leaves them at `c44350dc`. The other two reference files in the folder
(`locality-survey-guide.md`, `validation-protocol.md`) are named by nothing and
contribute no rule; see finding F6.

Every line below is checkable by eye against a run-log transcript
(`runs[].output.text_response`, `.tool_calls`, `.files_created`) or against the
project state the validators receive (`before_state` / `after_state`).

Judgement calls — "was this the best record type", "is the sequence efficient",
"does the rationale read well" — are deliberately excluded. They belong to the
judge, per the guide.

This is a **large** skill: six MCP tools, seven steps, three planning modes and a
closed schema to write into. That is why this list is 61 lines rather than 19,
and why an unusually high share of it converts to a validator — most of the rules
are about *what lands in `research.json`*, which is structured state a program can
read.

**Save this file. The next auditor of `research-plan` starts here instead of
rebuilding it.**

---

## A. Scope and routing (what this skill must refuse to do)

1. Must not execute a search. Retrieval belongs to `search-records` /
   `search-external-sites` — the description says so and the tool list withholds
   every search-execution tool.
2. Must not pick which question to research — that is `question-selection`.
3. Must not analyze or extract a record already found — that is
   `record-extraction`.
4. After a search comes back empty, must not judge whether research is done
   ("are we done", "what's the next step") — that is `research-exhaustiveness`
   or `project-status`.
5. Must not supply narrative historical background — that is
   `historical-context`.
6. On any of 1–5 the run routes and **writes nothing**: zero `plans` /
   `plan_items` entries added.

## B. Tools

7. Only six MCP tools may ever be called: `collections_search`, `volume_search`,
   `external_links_search`, `place_search`, `place_search_all`,
   `research_append`. Anything else violates `allowed-tools:`.
8. Must not call `wiki_search`, `wiki_place_page` or `place_population` — "you
   have no wiki/place-fact tools of your own". These are `locality-guide`'s.
9. Must not call `validate_research_schema` — "No separate
   `validate_research_schema` step is needed."
10. Must not hand-edit `research.json`. Every write goes through
    `research_append`.
11. Must not invoke `locality-guide` itself, and must not survey the locality
    itself, ever.

## C. The locality precondition

12. If the `localities` entry for a place it needs to plan is **missing**, it
    must **stop and return to the orchestrator** noting the jurisdiction needs a
    survey — not plan around the gap, not proceed with a partial plan.
13. When a `localities` entry exists it must be **read**, and any fact in it that
    changes *how* a specific search runs (a boundary succession, an indexing
    quirk) must be written into the affected plan item's `rationale` — "a locale
    fact left only in the guide never reaches the search."
14. Plan-item rationales cite the survey's `loc_` entry; breadth complements the
    survey rather than replacing it.

## D. Planning mode (Step 1a)

15. Must read **all** plans for the target question — every status — before
    deciding the mode.
16. **Review mode: create no new plan and modify no item.** Narration only.
17. Review mode may run a read-only `collections_search` to confirm the next
    item's source is available and cite it — "never a new plan item."
18. Ambiguous prompt with an active plan holding unfinished items → **default to
    review**.
19. Add-new mode leaves the completed plan untouched.
20. Supersede mode sets the old plan's `status` to `superseded` **first**, then
    creates the new plan.
21. Never two `active` plans for one `question_id`.
22. Never edit a `completed` or `superseded` plan's items in place; never modify
    a superseded plan at all.
23. Must not move an existing item's `status` (`planned` → `in_progress` →
    `completed`) — those transitions belong to the executing skills.

## E. What may be written

24. Writes **only** the `plans` and `plan_items` sections — never `conflicts`,
    `hypotheses`, `assertions`, `sources`, `log`, or any other section.
25. Every plan is anchored to a specific `question_id` (Standard 9: "Never create
    plan items that are not linked to a question objective").
26. `status` on a new plan item is exactly `planned` — "Never use any other value
    (e.g. not `not_started`, not `pending`)."
27. A plan's `status` is one of `active`, `superseded`, `completed`, `exhausted`.
28. There is **no `supersedes` field**. Supersession is recorded only by updating
    the prior plan's `status`.
29. `record_type` is one of: census, vital_record, probate, land, church,
    military, newspaper, cemetery, tax, immigration, court, other.
30. `repository` is one of: FamilySearch, Ancestry, MyHeritage, FindMyPast, NARA,
    state_archives, county_courthouse, other.
31. A `rationale` saying only that the record set exists is insufficient.

## F. How the write is made (Step 5)

32. The whole plan goes in **ONE batched `research_append` call** — op #1 the
    shell, then one `append` op per item.
33. Omit `id` on the shell and on every item; omit `items` on the shell.
34. The `pl_` id is **predicted** as (highest existing `pl_`) + 1 —
    "**Never hard-code `pl_001`**".
35. Every item op carries `planId` equal to that predicted id.
36. A `fallback_for` names a predicted `pli_` id, and the primary's op is placed
    **before** its fallback's op.
37. On `{ ok: false, errors }` the errors are surfaced and the offending op fixed
    — never the same call re-issued blindly.

## G. Record-type selection (Step 3)

38. Topical breadth (Standard 14) — the plan is not limited to census and vital
    records.
39. A record type named in the question is a **lead, not a scope limit**: plan it
    first, and still include the other primary types for that goal.
40. If the survey shows the presupposed type cannot cover the subject's place and
    era, say so in a rationale and lean on the alternatives — "**never satisfy
    the premise by stretching to the nearest same-named match**" inside that
    collection.
41. **Never cite or invent a specific source** — a `src_` id, or a named document
    like "the will of X" — that is not already in the before-state. A plan item
    names what to search *for*, not evidence not yet found.
42. Keep each `collections_search` / `volume_search` scoped to the surveyed place
    and era — do not broaden to a whole country when the survey has localized the
    goal.
43. **Parentage question → a dedicated plan item for the candidate parents'
    marriage to each other**, always: not the subject's own marriage, and not
    folded into a generic "church records" item.
44. When a remarriage is known or suspected: an item for **each** of her marriage
    records, plus items for records that name her parents directly (her own
    birth/baptism, probate, a sibling's record).
45. **Never plan a household search keyed on a surname taken off a single
    marriage record as though it were settled.** A cheap indexed-census check is
    allowed, but its own `rationale` must say the surname is unconfirmed and must
    not call it her maiden name.
46. That check is never sufficient alone — the plan must also carry a companion
    item testing whether the surname is even hers, or naming her parents
    directly.
47. Boundary change inside the date range → call `place_search_all` and plan a
    **co-equal item for each successor jurisdiction**, citing the applied
    decision in each `rationale`.
48. **A confirmed split within the date range is not a `fallback_for`.**
    `fallback_for` is for genuine uncertainty that a source exists at all.
49. An indirect record's `date_range` is sized to the record's likely **creator**,
    not the subject, and the `rationale` states whose lifespan set the bounds.
50. Male subject in a conscription country (Denmark/Norway from 1789 and similar)
    → the levy rolls get **their own item** (`record_type: military`), ranking
    alongside the baptism and the parents' marriage — not an obscure fallback.
51. A FAN item is included when the associate's records may hold evidence **about
    the question's subject**, and its `rationale` states what it reveals about
    the subject. Purpose is the test, not the relative's presence in the tree.
    **A parentage, identity or undated-event question requires at least one**;
    elsewhere it is not a quota, and an associate who could not speak to the
    question is not manufactured into one.
52. Emigrant origin or an unindexed parish register → a plan item with
    `record_type: church` whose rationale names a **full-text co-occurrence
    search on the two surnames as separate terms, run unscoped, via
    `search-full-text`**. Not a phrase search of the child's compound name, and
    **not scoped to a collection id**.

## H. Sequencing and size (Step 4)

53. Free before paid; indexed before browse-only; original planned as
    verification behind any index; narrow before broad.
54. Plan size 4–12 items. Fewer than 3 is not exhaustive; more than 12 suggests
    splitting the question.
55. The Standard 17 five-question breadth self-check is run **before** writing the
    plan, "not as a revision after being asked."
56. Under Standard 13, an index or database item is accompanied by the underlying
    original record as a verification step.
57. Under Standard 11, starting-point facts that are assumed rather than
    documented are flagged, and items to verify them are added before anything
    relies on them.

## I. Presenting and handing off (Step 7)

58. If the invoking message already authorized execution ("...and start executing
    it", "...and continue with exhaustive research", "...don't stop to check in
    with me") → **hand off in the same turn** via `Skill("search-records")` /
    `Skill("search-external-sites")` and **do not** ask "would you like me to
    start?"
59. If only some items can execute now, execute those and report the block on the
    rest — a blocked item must not hold up unblocked ones.
60. Otherwise the run ends by offering execution as the next step.
61. On termination (Standard 18): plan `status` set to `exhausted`, and the run
    states **explicitly** that the GPS cannot be met.

---

## Deliberately excluded (judgement, not prohibition)

"Apply topical breadth" as a quality bar, whether the sequence is the *most*
efficient, whether a rationale is persuasive, whether the right successor
jurisdiction was weighted more heavily. Rules 38–57 above capture only the
mechanically checkable half of those instructions — the presence of an item, the
value in a field, the phrase in a rationale.

## Internal contradiction — found by this dive, resolved by it

**Recorded as resolved. Do not re-litigate it.**

`SKILL.md` Step 4 item 6 used to read "FAN items are **not a quota**: if none
could speak to this question, don't manufacture one", while
`references/planning-standards.md` Standard 14 — which the body tells the model
to load — read "**Every plan should include at least one FAN-directed item**".
No checker could enforce both, and the judge graded against whichever it read
last.

Settled 2026-08-24 by scoping the mandate to question type: a FAN item is
**required** for parentage, identity and undated-event questions, and earns its
place everywhere else. Both files now say that, and rule 51 above states the
version that shipped. See finding F-FAN in the findings doc for the evidence
and the ruling.
