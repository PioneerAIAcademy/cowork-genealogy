# Research as a job — phases 2 to 5, at intent only

> **Status:** PARTLY BUILT. *Before phase 2* and phases 2-5 are built on the
> unmerged `research-as-a-job-phase2` branch; the `delivered` exit landed separately on
> `main`. The rest is **deliberately not specified**. Phases 0 and 1 were built by
> PR #2870, whose body lists each item (S2, 0a, 0b, 1a–1e); their plan is deleted. This file
> records where that design goes next, at the level of what and why, with acceptance criteria
> and nothing else.
> Revised 2026-09-27 against PR #2870's live run and the alpha feedback.
>
> **Do not build from this file.** Each phase gets its own detailed pass, written when the
> phase before it has landed. That is the point: four review rounds on the combined plan found
> most of their defects in the later phases, because they described surfaces nobody had opened
> yet — an endpoint that returns 501, a button that is replaced while busy, a table with no
> history. Detail written weeks ahead of the work is detail written wrong. *Before phase 2* is
> the next work, and it gets its own detailed pass the same way.

## What phases 0 and 1 leave for these phases

Facts the later passes build on, kept here because the plan for phases 0 and 1 is deleted.

- **Rulings that still bind.** No plan-approval gate — Stop is the control surface (2026-09-21).
  `q_` and `ps_` are allowed in user-facing text (2026-09-20). The prototype is production;
  the alpha is backported to and then retired, and Cowork may be degraded. The spend bound has
  no in-session grant: a capped sitting continues in a new session on the same project. An
  errand only the researcher can run — a document only they hold, a repository only they can
  reach, a capture — pauses the job and waits for their response, the same as
  `search-external-sites`' wait (2026-09-27).

- **The Stop hook binds on every browser turn**, not only on `/research`. The prototype's web
  tier stamps the nudge cap (default 60) on every message; the alpha binds it while
  `auto_continue` is on, which is its default and its operator kill switch. The hook reads
  only `project.status` and its own counters — never which skill is running or what the
  researcher asked for.
- **`turns.outcome` says how a run ended**: `completed`, `stopped`, `queued`, `budget` (the
  nudge cap, or the prototype's $35 spend bound), `no_progress`, `decision`, `delivered`,
  `mcp_unavailable`. Each renders today as one line under the chat. `no_progress` covers
  three causes that should read differently: an agent that stalled, a resume that failed
  twice, and a tool surface that went away.
- **`decision` and `mcp_unavailable` cannot fire.** The worker passes
  `pending_decision=lambda: False`, and neither plane can observe a dead tool surface, so both
  clauses exist and nothing sets them.
- **`person-evidence` was not de-gated.** PR #2870 dropped that change before merging, so its
  weak-match pause and its autonomous-only resolve-downward rule are main's.
- **The live run's scale.** One message, 150 minutes, 75 log entries, 311 `person_evidence`
  links, a probable-tier proof — and the agent resolved conflict c_002 itself where the old
  flow handed back about nine times.

## Before phase 2 — what continuous work changed

Phase 1 turned continuous work on for every hosted turn. These follow from that and come
before any new surface. The nudge text and the body edits reach the alpha and Cowork too — one
constant, one plugin — and the exit's handler is now on both hosted planes (see below). ~~The alpha's Stop hook
passes no decision clause, so it vetoes the exit like any yield and alpha testers keep phase 1's
behaviour until the alpha is retired~~ — **SUPERSEDED 2026-10-06** on the lead's own Done-when (a new browser session must end with
the delivered outcome, and the default web transport is the alpha) and his 2026-10-06 comments
asking for the duplicate-spawn fix. The struck ruling was his (496566c29). The
alpha now halts on the delivered signal and forwards it as `should_continue_run(delivered=...)`,
and it forces delegations to the foreground like the worker. The ruling above rested on nothing
needing those signals there; the router's "Bounded request or job" section needed the first, and
two live incident reports on issue #2813 needed the second, so the premise lapsed. `auto_continue`
remains the switch (the alpha is not hardened, ruled 2026-09-25).

**The default web path never enters the router.** The web client prefixes the first message
so `init-project` runs; it hands to `question-selection` and `research-plan`, and nothing in
that chain invokes `research`. The Stop hook still keeps the run going, but its nudge only
asks for "the next GPS sub-skill", so the router's contracts — the second question,
completion routing — hold only if the model happens to choose it. In issue #2864 it did not,
and issue #2927 has it skipped about half the time on drive-forward messages. Phase 1's PASS
entered as `/research --autonomous` on a seeded fixture, so this path is unmeasured.
Re-enter the router through the nudge text, the one carrier that reaches every hosted turn —
the opener binds only a session's first message, and a closing line in each sub-skill binds
nothing. The nudge is shared word for word with the e2e harness, so the e2e nudge changes
with it, harmlessly, since e2e already enters through the router. The 2026-09-21 prefix
ruling does not stand in the way: it sequenced the `--autonomous` flag behind S2, which PR
#2870 landed.

**Not every turn is a job.** The hook vetoes every stop until `project.status` is
`completed`, whatever was asked. "Create a research plan for Mary Hales but leave it at
that" (issue #2932), a christening-record lookup (issue #2921: "Why is it building a tree
when I simply asked…"), or "where are we?" on an active project each now run to the proof,
the nudge cap or $35. No approval gate still holds — this pushback is about scope, not
per-step consent. The finish line belongs to the request that named it, not to the project:
in issue #2932 "leave it at that" was the second message on an existing project, and the next
"go ahead and research it" must not find a finish line already met. It lasts one turn and is
void on the next message. The agent says it has delivered what was asked by calling
`research_delivered` — a tool SEPARATE from the *I need you* carrier below, because an ask
waits for an answer and a delivery waits for nothing (ruled by the user 2026-09-29; the carriers were
split, see `docs/specs/research-delivered-tool-spec.md`). **Landing on `main` separately**: the exit,
the tool and the browser label ship independently of this plan. The turn ends with an
outcome of its own — `completed`
means the project is done and reads "Research complete.". "Where are we?" is a bounded request
whose deliverable is the answer. Whatever re-enters the router must respect this, or every
question becomes a job. Issue #2813's item 3, rewritten by the lead on 2026-10-04, raises the same scope
question from the single-ask side; this section builds the finish line. Its offer to escalate
at the end of a quick answer is compatible: the turn ends at the deliverable, so the offer is
one the run waits for.

**Never ask a question you will not wait for.** Since phase 1 the hook overrides every closing
offer on a hosted turn, so the feed shows a question the run then answers itself:
`research-plan`'s "Would you like me to start executing this plan?", `search-records`'
"Shall I continue…" and "Let the user confirm before extraction", the offers in
`search-external-sites` and `conflict-resolution`, and `person-evidence`'s closing offers. Each
becomes a statement followed by the action, or — where only the researcher can answer — the
decision exit below. `person-evidence`'s weak-match pause is the largest case: its
resolve-downward rule applies only to "an autonomous `/research` run", which a browser turn
never is, so once the exit lands every weak match would end the job as a decision. The agent
reads only its delegation message, and every router spawn names the assertions to link, so the
rule keys on something the caller states: whether the researcher's own words named this link.
The router says the link is mid-run with nobody waiting on it; the `person-evidence` skill says
so only when the researcher did not name it. With nobody waiting, the pause rows resolve
downward. PR #2870 drafted and dropped a version of this, and neither of its clauses comes back:
"a message naming an assertion to link" fits every router spawn, and "a question they are
watching for an answer to" fits every hosted job. `autonomous-weak-match-no-link.json` names its
assertion in the researcher's words, so it flips under this key; its downward case moves to a
`research` router test in the same paid slot. Where the researcher
bounded the request, the turn ends at the deliverable, so an offer there is one the run waits
for. This is issue #2864's "wouldn't pull, extract, or view the record unless specifically
approved", and it was S4, widened. Each body is a paid eval run, one per skill at a time —
the router and the `person-evidence` skill included, for their delegations.

**Give "I need you" an exit.** The router's fourth stop condition ("say exactly what you need
and what you will do with each answer, then stop") and its genuine-blocker stop are both
voluntary yields, and the hook vetoes them. The run then ends `no_progress` — or `budget`, if
the model obeys the nudge's call to re-read the project — and either renders as the agent
failing under its own question. Decisions are
asynchronous — a person answers hours later and an attempt is capped at 1,800 s — so the turn
ends `decision` and the answer arrives as the next message. That narrows phase 3's two
carried questions to one: which call means *I need you*. The worker's `PreToolUse` hook
already reads control-plane rows on every call, so the choice is the model's own
`AskUserQuestion`, intercepted, or one dedicated tool shaped like PR #2702's `hand_back`.
Pick one. It does **not** also carry *delivered what was asked*: the user's 2026-09-29 ruling split the carriers, and `research_delivered` is shipping as its own tool, separately from this plan. On Cowork nothing intercepts it, so it must
read sensibly there. `AskUserQuestion` is granted on the prototype, handled
nowhere in `apps/`, and appears unprompted in 13 committed unit run logs, so first record what
it does on a continuous hosted turn today. The card is phase 3; the exit is not.

The exit covers every clause of the fourth stop. Its errand clauses — "a document only they
hold" and "access to a repository only they can reach" — pause the job and wait for the
researcher's response, the same as `search-external-sites`' wait (ruled 2026-09-27), and so does
the genuine-blocker list's "missing access to a required repository". A genuine blocker
of unreachable records ends the way issue #2539 describes: the proof at whatever tier the
evidence reached, with why the research stopped and what it could not reach, so `completed`,
never `no_progress`. An irreducible blocking conflict cannot end `completed` — the writer refuses
completion while one is unresolved — so it is a decision.

**Capture a real feed before specifying phase 2.** No committed run shows what a hosted reader
sees: every e2e fixture pins `narration_guidance` to "concise", every e2e run enters as
`/research --autonomous`, the unit harness binds no Stop hook, and the demo's feed events were
never exported before its stack was dropped. Its 15 vetoed yields are 15 hand-back attempts
nobody has read. Run one session the way a browser user does — a new session, so the opener
fires and `init-project` writes the shipped novice profile, and no slash command — on an
objective whose answer the run cannot read straight off the live tree. Commit what the reader
saw, including the feed events `export.py` does not export today; the exports directory is
gitignored. An e2e fixture does not do this as it stands: seeding copies its "concise" profile,
and a seeded session is opened from the list, so the opener never fires. Which objective, and
how its answer stays off the tree, is this section's detailed pass. This is also the only thing
that can prove a paragraph reached the reader.

*Acceptance:* a new browser session under the shipped profile, on an objective whose answer was
checked not to be on the live tree before the run, with no slash command, invokes `research` in
its first turn and ends `completed` or `decision`, never `budget` or
`no_progress`, and its feed is committed to the repo; "create a research plan for Mary Hales
but leave it at that" ends with a rendered plan, no research-log entries, and the delivered
outcome; "where are we?" on an active project ends after the answer with the delivered outcome
and no new log entry; no shipped skill or agent body ends a reply with an offer the run then
overrides — shown by the committed feeds, where no offer is followed by further work in the same
turn; a weak match nobody asked about resolves downward, not to a decision; a stop on any clause
of the fourth stop ends `decision` with no nudge spent after the ask; a run whose remaining
plan items are all unreachable ends `completed`; a run stopped on a blocking conflict no evidence
resolves ends `decision`.

## Phase 2 — the reading experience

**The step is the chat's unit.** A whole job is now one turn, and the chat folds a turn into
one bubble with every tool chip above every paragraph — a 150-minute run is hundreds of chips
over a wall of prose, and each new chip lands above text the reader has passed. Render chips
and text in the order they happened, and anchor each paragraph to what its step wrote. Anchor
to the step, not the log entry: in the e2e corpus 83.5% of paragraphs follow no new log write,
because extraction, linking, conflicts and proofs write none. The record side is already done
— sources and assertions carry `log_entry_id`.

**One view of job state, in two places.** The ticking plan, open beside the feed from the
moment `research-plan` writes it (a median 7 minutes in), carries it all: what is running,
what each finished item found or ruled out, what is waiting on the researcher, and how the
run ended. Work with no plan item goes in an explicit off-plan group — issue #2864's unlogged
side searches. The session list shows running, needs you, done or stopped. That is the
returning reader's one screen; the research log is the audit trail beneath it. Build no
separate summary view and no separate outcome view. The progress rail goes from `viewer-ui`,
the desktop viewer included: a stage is done forever once its section is non-empty, so it
cannot show a loop and it points backwards. OS
notifications wait until the session list proves not enough.

**The tool chips become navigation, in FamilySearch's words.** The friendly chip in PR #2870's
screenshot is mock-only; real chips are the wire name plus 160 characters of raw
`key=value` input. A chip names what happened in the terms a FamilySearch user already knows
— record hints, possible duplicates, attached sources — never a wire name or a bare collection number,
and it opens the card it names. The same words go in the tool descriptions the model reads.
The card shows its identity while collapsed, or two sources with one title cannot be told
apart. The activity line between plan ticks gets the same words, a state for compaction
(every corpus run compacts, a median three times at about two minutes each, with nothing on
screen), and a connection that is retrying says so instead of sitting on a placeholder.

**Identifiers become links, never refusals.** An identifier is additive: the novice reads the
sentence, the genealogist clicks the id. Do not build a validator; that was tried on paper and
refused 22% of paragraphs while catching none of the tool chips. The viewer resolves less than
it appears to: `Linkify` matches URLs only, `CrossLink` needs a structured id, the chat pane
sits outside the viewer's data provider, `localities` and tree fact ids are not indexed, and
plan items and persons have no anchor to land on. FamilySearch person IDs are their own class
and open the FamilySearch person page — testers type them. S1's identifier clause changes
here, with the linker and not before it: an id that is not yet a link is issue #2665's "What
is S1, q-001, I2, F15, etc.?". `record-extraction`'s relay-leak validator bans the same ids
and is re-keyed in the same change. Issue #2493 is the acceptance corpus; whether the rule
binds the writer tools is answered **no**. File, tool and skill names are a writing-quality
matter, not a defect — never file one as a bug.

**Three kinds of nothing.** *Not searched* — deferred, unreachable, or handed to the
researcher — is a gap. *Searched, nothing matched* is a negative result, worth something only
with its scope stated: collection by title, place, years, names, index or images. *Examined the
record and she is not in it* is negative evidence. Negatives are most of the log and narration
mentions them rarely, so render them from the log, as a sentence rather than raw JSON. A
deferred external search is logged today as `negative`, and the entry alone cannot tell it
apart: a nil the researcher reports before capturing is also `negative` with
`captureReceived: false`, and a graded test requires it. So a search that was not run gets a
`log_outcome` value of its own — *not searched* — written in place of `negative`, and the writer
tool does not refuse that pair.

**Show the scans, and let documents in.** On the prototype, sidecar bodies return 404 — every
"View N results" is dead — and `/image`, `/logs` and `/files` return 501. The web transport
already implements the client half. A scan exists only for a source transcribed from an image;
an indexed record opens on FamilySearch. Uploads matter as much as scans: an errand handed to
the researcher (phase 3) closes only when a document comes back.

**The job outlives the tab, and says so.** A job runs about an hour on one message and the
researcher leaves; alpha testers who locked the screen reported that it quit (issues #2921,
#2922). On the prototype it already survives — a disconnect stops only the stream — so what is
missing is saying so: the session list's job state above, and a session stopped at the spend
bound continuing on the same project in one action. Today the label says to start a new session
on this project, and the web client sends no project id. A cost figure on screen
is the server's total or it is absent; on the prototype no usage reaches the web, so the chip
reads $0 until the bound. Whether a lay user sees a running cost at all is the lead's call.

*Acceptance:* in a live multi-step run each paragraph appears directly after the chips of the
step it reports and links to what that step wrote; on issue #2493's corpus rendered through the
feed, no schema id, tree id or FamilySearch person ID renders unlinked — each opens its card or
the FamilySearch page, or was written as prose; no chip or activity line shows a wire name or a
bare collection number; a deferred search never renders as a negative result; a log row's
results open and a census page opens from the feed; a PDF attached mid-run reaches the project;
a session stopped at the spend bound continues on the same project in one action.

## Phase 3 — the loop

**Decisions: one card kind, rarely.** Phase 1's exit carries it; this is the card. A decision
blocks only what depends on it. Its options are candidates side by side, the way FamilySearch's
Source Linker compares them, each with what the agent will do if chosen, plus *not sure* and
*something else*; the job continues from *not sure* on the weaker choice. Keep decisions rare.
The live demo resolved c_002 itself, and a card on every run is an approval gate under another
name. The pending state is control-plane by nature; the resolved outcome already has a home in
`hypotheses`, `conflicts` or `log`.

**Handed to you.** The commonest hand-off in the alpha feedback is not *which John Smith* but an
errand only the researcher can run — a Fold3 page, a microfilm, a courthouse. It is raised once,
carrying what to look for and the film, DGS number or URL beside the link, shown as waiting on
the researcher, and never re-raised; issue #2864's tester lost days to a film number buried in
prose, and one petition was re-raised 7 times in 8 turns. It pauses the job and waits for the
researcher's response, the same as `search-external-sites`' wait (ruled 2026-09-27). The reply
resumes the job: with the document, which enters as a source and closes the errand, or with
"later" or "I can't", which leaves it recorded as outstanding and never re-raised. It outlives the session, so it lives in
`research.json`; `plan_item_status` has no waiting value today, and a handed-over capture left
`in_progress` blocks the exhaustiveness gate. Issue #2539 is the card. Every external search
that needs a capture becomes one of these errands — plan-driven, ad hoc, or asked for — raised
once with its URL and logged with phase 2's *not searched* outcome. A plan-driven errand's item
takes the waiting status instead of `skipped`; an ad-hoc one lives only in the errand record, since
no plan item is ever invented to hold it. Issue #2864's
Fold3 petition was raised by the agent, not asked for, so the rule covers agent-raised errands
too. This is how `search-external-sites`' "hand them the URL and wait for the capture" completes
on the prototype, where today the wait is a yield the hook vetoes and uploads return 501.

**A correction is recorded state, not a chat turn.** In issue #2864 the researcher challenged a
passenger-list assumption and the agent reverted to it, because nothing recorded the rivals;
c_002 held in the live demo because it was a recorded conflict. So a reject or a
direction-changing steer writes something later steps read. A rejected link becomes a remembered
*not a match*, with an optional reason, never a demand for the right answer. A challenged
assumption becomes an open competing hypothesis. A plan item the researcher strikes becomes
skipped by the researcher — "review this plan" is striking or adding an item while the job runs,
not approving it; `gps-mentor` cannot target a plan anyway. The refusal to re-link a rejected
(assertion, person) pair without new evidence is decidable from `research.json` alone, so the
writer tool enforces it. A mid-run reject reaches the running job and goes through the owning
agent's validated write, never around it. A person-link is a `person_evidence` entry, owned by
the `person-evidence` agent, and has no rejected state; what "rejected" means in the data is
the lead's call. `tree_forget` is the forget-and-rederive test tool, not this.

**Change review opens on what a conclusion rests on.** The viewer shows current state and never
what this session changed, and under continuous work one session is the whole job — the live
run wrote 311 links and its own narration said assertions "should be reviewed for cleanup", a
review nobody can do. One click per link is not the problem; finding the ones that matter is.
Order by consequence, from fields `person_evidence` already stores. Review covers more than
person-links: of eight feedback issues asking to correct something, only two were identity
cases — the rest were known-information lines, conclusions and questions marked answered. A
reject undoes what it caused: a wrong link materializes facts and feeds tiers, and a fact on
the wrong person is not recoverable. **This is the highest-value item in this file.** The
diff's data source is narrower than it looks: `documents` is one row per document and keeps no
history, a per-turn snapshot is now one snapshot per job, and `session_entries` holds every
writer call with its inputs — which step made each change, minus the side effects of merges.
Which source to use is this phase's pass.

**Dead ends become next actions.** A blocker is a research finding and currently the moment a
user churns. The locality-guide and wiki tools hold what makes it actionable — but in issue
#2864 2 of 8, then 1 of 3 suggestions were viable, the rest in the wrong place or years,
including county records for a Baltimore City death the locality guide had flagged. It rests on
issue #2935 (independent cities do not resolve) and issue #2936 (`research_query` cannot read
localities).

*Acceptance:* a wrong person-link is rejected from review in one click, and no later step in
that or a later session re-links the pair without new evidence; review's first screen on the
committed `bagley-father-1884` e2e run's final research lists what its proof rests on; a decision reaches the researcher as a
card with a *not sure* exit, and a bagley-father-1884 replay shows none; replaying issue
#2864's Fold3 thread, the petition is raised once with its identifiers, the turn ends waiting on
the researcher, and a reply of "later" resumes the job without re-raising it; replaying its death-certificate dead end, every next action is inside Baltimore City
and the target years.

## Phase 4 — the cold start

**Today's first screen is not a blank box.** The composer already asks "Who do you want to
research, and what do you want to find out?". `init-project` never waits: it defaults the
objective to "General research: build out the tree and identify gaps and next steps", and given
a name it selects the top `person_search` candidate itself — an eval rewards that. Under
continuous work the default objective has no finish line and likely runs to a cap (reasoned
from `question-selection`'s "objective answered" rule, not measured), and a wrong pick spends a
whole job on the wrong person — issue #2864's anchoring, at the root.

**The pick is a decision, so this phase follows phase 3.** Name and rough birth year → candidate
person cards carrying what FamilySearch shows to tell namesakes apart (lifespan, places, parents
and spouse) → pick one. `person_search` strips relatives by design. *None of these* still starts
a job, scoped less tightly. The pick uses the decision exit, which works before `research.json`
exists: the Stop hook checks for a pending decision before it reads the project.

**Offer the gaps, computed rather than reasoned.** Then read the tree and offer concrete
objectives. Every offer traces to a tool output about the chosen person: FamilySearch's own
Research Help signals (record hints, possible duplicates, data problems, quality), empty parent
slots, and co-residents in attached censuses — issue #2864's tester saw the tool never propose
the man living with Martha as her father. The model ranks and words the offers in FamilySearch's
terms; it does not invent them. This rests on relatives' attached sources being imported (issues
#1689, #2696): the one live offer so far proposed a spelling twelve attached sources had
settled. A check that could not run is reported as unavailable, never as "nothing missing".
Offers reverse `init-project`'s "never infer a specific objective", which came from testers, so
they stay choices, and a doubt the researcher states outranks every gap computed from the tree.

**Say what to expect.** Before the first search, a line or two: roughly how long this takes, what
it can reach, and what it will hand over. Once the session list shows job state, also that the
researcher can leave.

A first message that names a FamilySearch person ID and a task already goes straight to work;
keep it that way. Starting from the researcher's own pedigree (`person_ancestors` with no
`personId`) would remove the namesake problem at its root, but it needs per-user FamilySearch
sign-in on the prototype (`familysearch-login-plan.md`), which this design does not build.

*Acceptance:* with two same-name candidates of comparable score the turn ends `decision` with
both cards and nothing is built for a guessed person, and one unambiguous person starts with no
stop; a session started with only a name ends on a bounded question, `completed` or `decision`,
never at a cap; the offer list can be rebuilt from tool outputs alone.

## Phase 5 — the remaining prose

Each is a paid eval run plus a genealogist annotation pass, one per skill at a time. S2 landed
with PR #2870. S3 is done — PR #2870 removed the literal from `question-selection`, and its
`q_001` gloss mandate needs no edit. S4 moved, widened, to *Before phase 2*.

| PR | Slot | What |
|---|---|---|
| S1 | `init-project` | The between-actions clause, once the feed capture measures it; the cold start's wording, with phase 4. Its identifier clause is phase 2 |
| S5 | `record-extraction` | Probably no prose change: "a batch is one step" assumed a per-step hand-back, which is gone, and issue #1998 shipped per-record narration with a guard. The relay-leak validator's re-key is phase 2's, and an instrument change needs no paid slot |

**The narration guidance is one line and the highest-leverage line in the product.**
`init-project` writes it verbatim and every skill but `search-wikipedia`, plus five agents,
reads it from `research.json` at runtime (re-derive with
`grep -rL '\*\*Narration' packages/engine/plugin/skills/*/SKILL.md`). The router and
`record-extraction` carry narration rules of their own, reconciled with the string in the same
change. **"Do not narrate between actions" is measured before it is rewritten.** The stored
string already asks for one paragraph per step; whether a continuous turn reads "the step" as
the whole job is what the feed capture shows. If it goes, replace it with a content rule — one
paragraph per step that wrote something, what was found and what happens next, no process
narration — rather than deleting it: "Now…" and "Let me…" open about 18% of corpus paragraphs
where narration is allowed. Getting this wrong costs a second paid slot on the same skill.

**The literal is gone from every body.** PR #2870 removed it from `init-project` and
`question-selection`, and `test_every_shipped_hand_back_literal_classifies` now asserts zero.
`apps/web`'s copy of the regex, its Continue button, and the parity test that pinned the two
copies together are gone. The alpha's remaining carriers die with the alpha. Keep
`auto_continue` — it now switches the alpha's continue hook — and keep the harness classifier,
which reads old run logs.

## What this design does not do, at any phase

- **No proof export.** The proof goes to FamilySearch by upload, later.
- **Nothing writes to the FamilySearch tree.** Every accept, reject and merge here is
  project-local, and the screen says so. No project-local control is named Attach, Detach or
  Merge, because a FamilySearch user would assume the shared tree changed. The hand-off stays
  "Open in FamilySearch".
- **No numeric confidence meter.** A score on conclusions the user cannot inspect or reject is
  worse than none, and a number presumes a grasp of probability the novice profile rules out.
  The proof tier and why it is not higher, in a sentence rather than enum badges, is the
  uncertainty display.
- **No leaf-skill changes beyond the ones above.** `translation` is correct when invoked
  directly. `search-external-sites` was rewritten by PR #2870 to defer plan-driven captures on
  every plane, Cowork and the alpha included, where a researcher could capture; phase 3's
  handed-to-you pause replaces the deferral and completes the researcher-asked wait.
- **No further cost bounding.** The prototype bounds a session at $35 in the `PreToolUse` hook,
  priced off live token usage; the alpha has no bound (ruled 2026-09-25 — it is replaced by the
  prototype). The nudge cap is not a bound: it is consulted only at a voluntary yield, and 31%
  of runs never yield.
- **Nothing Cowork-specific.** Shared changes — `viewer-ui`, tool descriptions — reach it as
  they are. Unlinked ids render there as plain text, exactly as today.
