# Research as a job — phases 2 to 5, at intent only

> **Status:** NOT BUILT, and **deliberately not specified**. `research-as-a-job.md` is the
> buildable plan and covers phases 0 and 1. This file records where that design goes next, at
> the level of what and why, with acceptance criteria and nothing else.
>
> **Do not build from this file.** Each phase gets its own detailed pass, written when the
> phase before it has landed. That is the point: four review rounds on the combined plan found
> most of their defects in the later phases, because they described surfaces nobody had opened
> yet — an endpoint that returns 501, a button that is replaced while busy, a table with no
> history. Detail written weeks ahead of the work is detail written wrong.

## Phase 2 — the reading experience

**Identifiers become links, never refusals.** The viewer already resolves ids — `getById`,
`buildIndex`, `CrossLink`, `Linkify`, `resolveFamilySearchTarget`. An identifier is additive:
the novice reads the sentence, the genealogist clicks the id. Do not build a validator; that
was tried on paper and refused 22% of paragraphs while catching none of the tool chips.
`localities` is missing from `buildIndex` and is the one class that will not resolve.

**File, tool and skill names are a writing-quality matter, not a defect.** Guidance, not a
gate. Never file one as a bug.

**The tool chips become navigation.** A lay verb per tool, and a chip that resolves to the
card it names. `mcp__genealogy__record_read` is a wire format, not a name.

**The feed and the research log are the same artifact.** Anchor each step's paragraph to the
log entry it produced. Catching up after an hour becomes reading the log, and the transcript
becomes a deliverable rather than scrollback.

**Negative results are first-class.** "We searched that parish and she is not there" is
reasonably-exhaustive evidence and the thing that separates this from a search box.

**Show the scans.** The gap is server-side: the prototype web tier returns 501 for `/image`
and hardcodes `sidecars` to empty. The web transport already implements the client half.

*Acceptance:* every identifier in the feed is a working link or harmless prose; a two-step run
renders two log entries and two feed paragraphs; a census page can be opened from the feed.

## Phase 3 — the loop

**Decision records.** One structured way for the agent to say *I need you* — which of these
two John Smiths is yours. Not a `research.json` section: the pending state is control-plane
by nature, and the resolved outcome already has a home in `hypotheses`, `conflicts` or `log`.
Two unsettled questions carried forward: what writes the row, given the agent has no path to
a control-plane table and no tool means "I need a decision"; and whether `AskUserQuestion` is
reachable under the hosted permission mode, which is unmeasured.

**Change review and reject.** The viewer shows current state and never what this session
changed. For a genealogist a wrong person-link is the thing they care most about, and
`tree_correct` and `tree_forget` exist as tools with no UI at all. Continuous work without a
review surface is the part of Claude Code people would refuse to use. **This is the
highest-value item in this file.** The diff's data source is an open question — `documents` is
one row per document, overwritten on write, and `document_versions()` returns counters.

**Show the plan, and let it tick.** `research-plan` already writes a structured plan. Render
it as a checklist and let `plan_item.status` tick over; that is better liveness than a
spinner because it says what is happening and what is left. **No approval gate.** Add a
"review this plan" affordance for those who want one — an action, not a checkpoint.

**Dead ends become next actions.** A blocker is a research finding and currently the moment a
user churns. The locality-guide and wiki tools hold what makes it actionable.

*Acceptance:* a wrong person-link can be rejected from the viewer in one click; a
disambiguation reaches the user as a card, not a paragraph; the plan visibly ticks.

## Phase 4 — the cold start

`init-project` asks one open question — the research objective — and a novice does not know
what one is. The highest-traffic screen in the product is a blank text box.

Replace it: *who do you want to learn about?* → name and rough birth year → candidate person
cards → pick one. Then read the tree and **offer the gaps you can see** as concrete
objectives. The agent knows what is missing; asking the user to name it asks them for the one
thing they cannot supply.

*Acceptance:* a new user reaches a running research job without typing a sentence.

## Phase 5 — the remaining prose

Each is a paid eval run plus a genealogist annotation pass, one per skill at a time. S2 is
**not** here — it is in phases 0 and 1, because 1a depends on it.

| PR | Slot | What |
|---|---|---|
| S1 | `init-project` | The narration guidance; the cold start |
| S3 | `question-selection` | Drop the literal. The `q_001` gloss mandate stays |
| S4 | `research-plan` | The execution offer becomes "render the plan and start" |
| S5 | `record-extraction` | A batch is one step; re-key or retire the relay-leak validator |

**The narration guidance is one line and the highest-leverage line in the product.**
`init-project` writes it verbatim and 27 of 28 skills read it from `research.json` at runtime,
so one slot changes narration everywhere. **Two clauses change, not one.** Delete "Do not
narrate between actions" — the text between tool calls *is* the feed. And replace "No
identifiers, file names, tool names or field names" with the additive form, or phase 2's
linkifier has nothing to link and issue #2493's acceptance corpus lands against prose
containing no ids. Getting this wrong costs a second paid slot on the same skill.

**The literal retires with S1 and S3**, and it has more sites than the one test: the server's
pattern and predicate, the runner's auto-continue arm — note `auto_continue` already defaults
to `True` on the alpha — the config, the sandbox env carriers, the parity test, the web regex,
the harness classifier, and the two skill bodies.
`test_every_shipped_hand_back_literal_classifies` ends on `assert seen >= 2` and exactly two
skills carry the literal, so **the first of S1/S3 reds it**. Relax the floor to zero early;
keep the per-literal assertion inside the loop.

## What this design does not do, at any phase

- **No proof export.** The proof goes to FamilySearch by upload, later.
- **No confidence meter** until change review exists. A score on conclusions the user cannot
  inspect or reject is worse than none.
- **No leaf-skill changes.** `translation` and `search-external-sites` are correct when
  invoked directly.
- **No *further* cost work.** Phase 1e bounds a session at $35, enforced in the `PreToolUse`
  hook and priced off live token usage rather than `cost_usd`. The nudge cap remains not a bound —
  it is consulted only at a voluntary yield, 31% of runs never yield, and of 36 corpus runs
  killed by harness caps the highest nudge count was 5. Nothing further here.
- **Nothing binds the reassigned status write.** After S2, `proof-conclusion` owns it by prose
  alone — the plugin hook's owned-sections map has no `project` row. Worth a card.
- **Nothing for Cowork.** Unlinked ids render there as plain text, exactly as today.

## The board, as of 2026-09-20

| Card | State |
|---|---|
| issue #2292 | Retitled; it is S1/S3/S4's wording card. Its 2026-09-09 first-delegation ruling survives |
| issue #1104 | Closed not planned. Cowork needs no Stop hook |
| issue #2328 | Closed completed by PR #2675 |
| issue #2088 | `high-priority` dropped; the census survives for ADR-0003 |
| issue #2493 | Becomes the acceptance corpus for the linkifier. "Should the rule bind the writer tools" is answered **no** |
| issue #1998 | Merge with S5, or sequence it. The plan-item progress bar answers a silent extraction batch |
| issue #2660 | Its closure cited the Continue button, which phase 2 deletes. Comment when it lands |
| PR #2695 | Its mechanism is this design's mechanism. Its two D18 findings are phase 0 |
| **new** | File emission — nothing on any plane can prove a paragraph reached the reader. (The `/v1` lock is moot: `/v1` was removed.) |
