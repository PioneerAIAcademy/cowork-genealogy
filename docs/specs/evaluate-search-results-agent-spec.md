# `evaluate-search-results` — agent spec

> **Status:** New (2026-10-29). Agent file:
> `packages/engine/plugin/agents/evaluate-search-results.md`. Unit suite:
> `eval/tests/unit/evaluate-search-results/`. The section it writes:
> `research-schema-spec.md` §5.16 `hit_verdicts`.

A one-shot plugin agent that judges ONE full-text search hit against ONE tree
person. It records a verdict, Match, Possible Match or Not a Match, and whether
the hit holds a vital fact the person lacks, as one `hit_verdicts` row. The
`research` router spawns one agent per hit, in parallel, when the researcher
asks to evaluate the hits of a full-text search. The audience is beginner and
intermediate users, who today spend five to ten minutes opening, reading and
comparing a page of hits by hand.

The agent labels and never extracts (lead, 2026-10-18: "Label, then offer").
The turn that evaluated the hits ends "Continue with extracting the N
Matches?", and on yes the next turn opens with `record-structurer`, which
extracts each Match from the hit's own transcript.

---

## 1. What it does

1. **Routing gate.** It runs before any tool call and hands back one line,
   `Hand-back: <owner> — <the request in one clause>`, with no call:
   - extracting the hit, adding it as a source, or pulling out its facts goes
     to `record-structurer`;
   - running a search goes to `search-full-text`;
   - a delegation with no single `hitRef` (a whole search, the `#hits` list, a
     list of hit numbers, a record or person id) is `Hand-back: no hit ref`.
     Fanning a search out into one spawn per hit is the router's job.
2. **`project_context`.** The target defaults to `subjectPersonIds[0]`. The
   agent notes the target's `spouseIds`, `parentIds` and `childIds`, and whether
   the hit is already extracted: some `sources[].recordIds` entry has the same
   bare id as the hit, both reduced to the part after the last `:` (the record
   ids are raw `record_id` strings, often resolver URLs). This is the test
   `research_append` applies (§2).
3. **`sidecar_read`** on the `hitRef`: the hit's transcript, plus its `title`,
   `recordDate` and `recordPlace` when the search returned them
   (`sidecar-read-tool-spec.md`). It pages while `truncated`, and reads no other
   ref.
4. **One `tree_query`** on the target and its one-hop family, with **no
   `factTypes`**. A verdict needs residences and other place facts, which a
   vital-only filter drops.
5. **The verdict**, from every fact on both sides, the relatives, and the
   titles of the sources the tree cites:
   - `match`: the name fits, at least one more point ties the hit's person to
     the target (a relative named in the same relationship as on the target's
     edges, or a dated place the target's facts fit), and nothing rules the
     target out;
   - `possible_match`: the name fits and the time and place are consistent, but
     nothing else ties the person to the target, or one point disagrees in a
     way a recording error explains;
   - `not_a_match`: a point rules the target out, or the name belongs to someone
     else in the hit.
6. **`new_vital_info`**, judged against the target:
   - a birth (Birth, Christening, Baptism) or death (Death, Burial) is new when
     the hit dates or places it and the target has no fact of that group with a
     date or place;
   - a spouse, parent or child the hit names is new when no one at the other end
     of the target's edges matches by name; a relative already on an edge is
     not;
   - a marriage is new when the hit dates or places it and the target's Couple
     carries no Marriage fact with a date or place;
   - an undated spouse mention ("Mary his wife") is a relationship, judged by
     the rule above;
   - a fact about a relative counts only through that relative's relationship
     to the target;
   - false for `not_a_match`, and false for an already-extracted hit.

   `tree_query` matches fact types exactly, and a Couple with no Marriage fact,
   or a Death fact with no date and no place, still counts as present. So the
   rule names the type groups and requires a date or place.
7. **One `research_append`** of a `hit_verdicts` row: `log_id` and `hit_id`
   from the `hitRef`, `target_person_id`, `verdict`, `new_vital_info`, and a
   one- or two-sentence `rationale` naming the deciding facts. On a refusal it
   changes only what the refusal names and sends once more.
8. **Return.** Four contract lines (`hitRef`, `verdict`, `newVitalInfo`,
   `alreadyExtracted`), then `---`, then a `summary_for_user` of one or two
   plain sentences with no identifiers. After a second refusal it adds a
   `refused:` line with the tool's errors.

## 2. The section and its preconditions

The row's shape, the fold of a second append for the same (`log_id`, `hit_id`,
`target_person_id`) into an update of the first, and the refusals are
`research-schema-spec.md` §5.16 and `research-append-tool-spec.md` §3.10. The
two that bound the flag are write-time preconditions in the writer tool, not
prose (ADR-0011: decidable from the documents alone):

- `new_vital_info: true` beside `not_a_match` is refused: a hit that is not the
  target holds no fact the target lacks;
- `new_vital_info: true` on a hit already extracted is refused: some
  `research.assertions[].record_id` has the hit's bare id. This is record-level,
  matching `extraction_append`'s resend skip: an extracted hit is never
  extracted again, so it has no new information left to extract.

**`new_vital_info` is as of the evaluation; a later extraction does not clear
it.** A reader treats a hit as not new once some `research.assertions[].record_id`
has the same bare id as the row's `hit_id` (the part after the last `:` of either
ARK form, a URL or `ark:/…`), the test the write-time precondition uses.

The plugin hook routes the whole `hit_verdicts` section to this agent and lanes
the agent to that section alone (`ownership.json`, `guard_project_files.py`), so
the thread that ran the search cannot label its own hits from the list.

## 3. Decisions

- **One agent per hit** (user, 2026-10-27). Each judgment reads one transcript
  against one tree, so parallel spawns keep the one-to-two-minute target in
  reach and keep each context small. The router spawns at most five per message.
  Five concurrent agents is the most measured, and the search step's fan-out is
  four. Nothing wider has run.
- **Tools, exactly:** `project_context`, `sidecar_read`, `tree_query` and
  `research_append`, each under all three spellings.
  - No `extraction_append` (lead, 2026-10-18): a Match is labelled, and the
    researcher's yes starts extraction on the next turn.
  - No `research_query` and no `Read`. `project_context` gives the target, its
    one-hop family and each source's record ids, which is all the
    already-extracted test needs. `tree_query` gives the facts.
- **Tree facts come from `tree_query`**, whose edges carry their facts. A
  marriage lives on the Couple, so a hit's dated marriage is judged against the
  Couple's Marriage fact.
- **The hit's title, date and place come from `sidecar_read`.** A transcript can
  lack the place or the year the search matched on, and the verdict needs both.
- **Model `claude-sonnet-4-6`** (user, 2026-10-29), the pin most agents carry,
  and present in the hosted gateway's `GATEWAY_AGENT_MODELS`. A Haiku arm for
  cost is deferred.
- **No `**Narration:**` line.** Each call is a parallel one-shot whose return
  the router relays; per-call narration would multiply by the hit count.
- **The contract lines carry the pairing.** `hitRef`, `verdict` and
  `alreadyExtracted` let the router count the Matches not already extracted and
  build the extraction spawn on yes, from the state it already holds and with
  no `research_query` read.
- **Step mode.** The agent is its own step (`step_boundary.py`'s `_SOLO`), so a
  turn may spawn it many times but a turn that ran `search-full-text` cannot also
  evaluate. Its label is "evaluating the search hits". The turn's close offers
  `extract-matches`, labelled "extracting the Matches", which the offer parser
  reads with or without a count ("the 3 Matches", "three Matches", "the
  Match").

## 4. Deferred

- A historical-record target (`target_record_id`), the issue's "or historical
  record".
- Evaluating `record_search` hits. `rank_search_matches` scores those already;
  a full-text hit is a transcript, not a persona.
- A Haiku arm for cost.

## 5. What nothing checks

- **Whether a user's words reach the router's search-hit review.** A bare
  "evaluate these hits" can be picked up by this agent's own `description`
  before the router sees it; the agent then hands back `no hit ref`. The routing
  tests start every message with `/research`.
- **The width of five spawns per message.** It is router prose. The harness
  records no message id per spawn, so no validator can see it.
- **The tree can lag behind `research.json`.** Facts reach the tree only
  through `materialize_facts` or `tree_edit`. A vital fact extracted from a
  different record and linked to the target but not yet materialized is
  invisible to `tree_query`, so the flag can be true for a fact the project
  already holds. The already-extracted precondition covers only the hit's own
  record.
- **Whether the four tools bind live.** Only a live session checks this, and
  only for the spelling it exposes. `make agent-smoke` covers registration.
- **What the user is shown.** The unit harness relays the whole return; the
  router prints only what follows `---`.

## 6. Verification

- Unit suite: `make eval-skill SKILL=evaluate-search-results`, direct arm. Five
  g9gj hits (a Match and a Possible Match already extracted, two Not a Match,
  one of them carrying a marriage fact, and a Match with no new fact), two on
  the `g9gj-fulltext-hits-unextracted` variant that carry new facts, and two
  hand-backs.
- Validators: `eval/harness/validators/test_evaluate_search_results.py` checks
  exactly one new row on the delegated hit and no other write, one
  `sidecar_read` on that hit (plus its paging reads) and no `#hits` read, one
  `tree_query` that includes the target and carries no `factTypes`, the
  tag-gated gold verdict, flag and `alreadyExtracted` line, return lines that
  agree with the row, and zero writes on a hand-back.
- Writer preconditions: `tests/tools/research-append-hit-verdicts.test.ts`.
- Routing: three `research` suite tests on the variant (a named hit list, every
  hit of a search, and the yes-path), with a validator on the spawned `hitRef`s
  against the requested rows of the scenario's sidecar (one per spawn, each a
  tree-person `target`), the close's offered step and its count, and, on the
  yes-path, the one record-structurer spawn's source.
- Registration: `make agent-smoke` after the agent lands.
