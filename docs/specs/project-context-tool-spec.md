# `project_context` — compact project-state projection — Spec

> **Status:** New (2026-07-12, extractor state diet). The read-side companion
> of the structured writer tools (`research_append`, `tree_edit`): where those
> removed "re-serialize large JSON to write," this removes "re-read large JSON
> to think." One call returns the judgment-relevant projection of
> `research.json` + `tree.gedcomx.json`; the caller never opens either file.

```
project_context({ projectPath }) -> compact projection (read-only)
```

---

## 1. Why this exists

The record-extractor agent (since retired) ran in a fresh context per delegation and used to
open with a full read of `research.json` and `tree.gedcomx.json` — both of
which grow monotonically over a session. On capped e2e runs (~10 extractor
delegations per run) those fresh-context re-reads dominated cost: the
cruz-corona run made **143 `Read` calls** and hit **$19.12** against a $15
cap; 3 of 5 e2e runs hit the cap. Every mechanical lookup the reads served
has moved into the writer tools (source-reuse detection into
`research_append` §3.4.1; the §5d household sequence into `tree_edit`
`add_household_children`); what remains is a small set of **judgment
context** facts:

- which questions are open (to fill `extracted_for_question_ids`);
- which tree persons exist, their preferred names/genders, and which `S`
  entries they already cite (the alternate-name rule: a record persona that
  IS an existing tree person under a variant spelling);
- which sources exist, per repository, covering which `record_id`s (to
  narrate reuse and route refinement requests);
- the project status.

That projection is a few hundred tokens where the raw files are tens of
thousands. This tool computes it host-side.

## 2. The tool

```typescript
project_context({ projectPath: string })
```

Read-only: opens `research.json` and `tree.gedcomx.json`, writes nothing,
never creates a `.bak`. Not a validator — malformed *entries* are skipped
defensively rather than reported (only an unreadable/unparseable file is an
error); `validate_research_schema` remains the diagnosis tool.

### 2.1 Return value

Wire-side **camelCase** (a tool output, not a persisted document — the
repo's identifier-casing rule):

```typescript
{
  ok: true,
  buildId: string,                       // engine build stamp, e.g. "0.1.0+2026-09-17.abc12345"
  projectStatus: string | null,          // research.project.status
  objective: string | null,              // research.project.objective, verbatim
  subjectPersonIds: string[],            // research.project.subject_person_ids; [] when absent
  narrationGuidance: string | null,      // researcher_profile.narration_guidance, verbatim
  subscriptions: string[],               // researcher_profile.subscriptions; [] when absent
  openQuestions: [{
    id: string,                          // q_*
    question: string,                    // truncated to ≤140 chars (139 + "…")
  }],
  questionStatuses: [{                   // ADVISORY — see below. One per question,
    id: string,                          //   including resolved ones.
    state: "framed" | "planned" | "searching"
         | "evidence-gathered" | "concluded" | "critiqued",
    nextStep: string | null,             // null = nothing outstanding
    openConflictIds: string[],           // unresolved conflicts bearing on it
    storedStatus: string | null,         // questions[].status verbatim; null when
                                         //   absent or not a string. DERIVED vs
                                         //   REPORTED — see §2.2.
    unregisteredDisagreements: [{        // linked vital-fact assertions that
      personId: string,                  //   disagree with no conflict naming
      fact: string,                      //   the pair — see §2.2.
      assertionIds: string[],
    }],
    competingParentSets: [{              // in-scope tree persons with >2 birth parents
      personId: string,                  //   and <2 hypotheses on the question
      parentIds: string[],
    }],
  }],
  persons: [{
    id: string,                          // I id (or FS id)
    name: string | null,                 // preferred names entry, "Given Surname"
    gender: string | null,
    sourceRefs: string[],                // distinct S ids cited anywhere on the person
    spouseIds: string[],                 // I ids joined by a Couple edge
    parentIds: string[],                 // I ids that are this person's ParentChild parent
    childIds: string[],                  // I ids that are this person's ParentChild child
    diedByYear: number | null,           // year certainly dead by, from dated Death/Burial facts
  }],
  sources: [{
    id: string,                          // src_*
    repository: string | null,
    gedcomxSourceDescriptionId: string | null,
    recordIds: string[],                 // distinct record_id values across its assertions
    assertionCount: number,              // assertions with source_id = this id
  }],
  localities: [...],                     // place/locale projection for research-plan
  awaitingUser: [{                       // open external-site hand-offs — §2.3
    logId: string,                       // log_* of the in-flight entry
    site: string,                        // external_site.site
    urlGenerated: string,                // the URL the user was sent
    planItemId: string | null,
    performed: string | null,
  }],
  exhaustedImageGroups: [{               // films whose browse cap is spent — §2.5
    imageGroup: string,                  // film number, e.g. "008230326"
    imagesRead: number,                  // distinct images counted, >= 20
    planItemIds: string[],               // open plan items with an image_search log entry on it
  }],
  externalCollections?: {                // stored curated collections, counts only — §2.4
    [place: string]: { total: number, byRecordType: { [recordType: string]: number } },
  },
  sectionCounts: { [section: string]: number | null },  // entries per research_query section — §2.6
  unregisteredDisagreementCount: number,         // what research_query's conflicts adds — §2.6
}
// on failure: { ok: false, errors: string[], buildId }   — buildId on EVERY branch
```

Projection rules:

- **`buildId`** — the engine's build stamp (`<base>+<date>.<sha>[.dirty]`, or `<base>+dev`
  for a build outside a git checkout), identical to the wire `serverInfo.version`. Present on
  the `ok: true` result, the broken-project failure **and** the `no_project` answer, because
  this tool is the primary "which build is this?" surface (8 skills call it; 0 call
  `auth_status`) and the question is most urgent when nothing else works. Read from
  `build/build-info.json`; format and rationale in `mcpb-package-spec.md` § Versioning.

- **`openQuestions`** — every `research.questions[]` entry whose `status` is
  not `resolved` (i.e. `open`, `in_progress`, `exhaustive_declared`), in
  array order. `question` text over 140 characters is truncated to 139 + a
  `…` (the id is the handle; the text is a reminder, not the record).
- **`persons`** — every `tree.persons[]` entry, in array order. `name` is
  the `preferred: true` names entry (first names entry when none is
  flagged), rendered `given surname` (whichever parts exist; `null` when the
  person has no names). `sourceRefs` collects the distinct `ref` values of
  every source reference on the person — person-level `sources`, each
  fact's `sources`, and each name's `sources` — in first-seen order.
  `spouseIds`, `parentIds` and `childIds` are the person's one-hop family
  from `tree.relationships`: a `Couple` edge lists each side as the other's
  spouse, a `ParentChild` edge lists the parent and child on each other. The
  type matches on its last segment, so the bare name and the
  `http://gedcomx.org/` URI both count; an edge missing either end is
  skipped; ids are distinct, in edge order. `diedByYear` is the earliest of
  the latest possible years of the person's dated `Death` and `Burial` facts
  (`Abt 1890` gives 1891, `Bef 1870` gives 1870), or null when none is dated;
  a date with no upper bound (`Aft 1850`) gives no year.
  The latest year, so a person is read as dead before a record only when they
  certainly were: a wife who died after an 1860 census is still expected in
  it. They exist so person-evidence can name
  a known spouse or child missing from a household record: no other tool
  it holds reads the tree's edges.
- **`sources`** — every `research.sources[]` entry, in array order.
  `recordIds` are the distinct `record_id` values (verbatim, first-seen
  order) across `research.assertions[]` entries whose `source_id` is this
  source's id; `assertionCount` counts those assertions.
- **`projectStatus`** — `research.project.status`, `null` when absent.
- **`objective`** — `research.project.objective`, verbatim and untruncated, `null` when absent. It is the
  only surface that returns the objective: `research_query` serves array sections only, so without it a
  cold-started agent sees the objective — and any doubt it states about its own premise — only by reading
  `research.json` whole.
- **`narrationGuidance`** / **`subscriptions`** — `researcher_profile.narration_guidance`
  (verbatim; `null` when absent or not a string) and `researcher_profile.subscriptions` (strings
  only; `[]` when absent). Every skill's Narration line and `search-external-sites` read these;
  no other tool returns them, and Cowork's VM cannot `Read` `research.json`. Tree
  facts are not here: `tree_query` serves them, so this projection does not grow for callers
  that never need them.
- **`subjectPersonIds`** — `research.project.subject_person_ids`, strings only, `[]` when absent. The
  router has no other way to see who the research is about, which the baseline step (extract and link
  each subject's attached records before the first question) needs.

The tree is read as-is (no `sanitizeTree` healing pass — a read-only
projection must not imply a migration); traversal is defensive, skipping
non-object entries.

### 2.2 `questionStatuses` — advisory, and deliberately not a gate

Per **question**, never per project: a project holds several questions at
several states at once, so any single project-wide phase is wrong on arrival.

The ladder is monotonic on what was **produced**, not on tidiness — a question
with a proof summary is `concluded` even if its plan is thin, because the
artifact is what every downstream check joins on.

| state | reached when |
|---|---|
| `framed` | the question exists, no plan references it |
| `planned` | a plan carries `question_id` = this question |
| `searching` | a log entry names one of that plan's items |
| `evidence-gathered` | an assertion lists it in `extracted_for_question_ids` |
| `concluded` | a proof summary carries `question_id` = this question |
| `critiqued` | every such summary has a live `proof-critique` evaluation |

`critiqued` is reached only when the user asked for a gps-mentor review — the
mentor is not on the default `/research` path — so it records that a critique
exists and gates nothing. A superseded verdict does not count — a
replacement is itself present and satisfies the join; if nothing replaced it, the
critique no longer stands.

`nextStep` orders by what blocks what: **an unsettled conflict that has weighed
everything** outranks **a conflict that wants evidence already planned**, which
outranks an unresolved conflict, which outranks a question
with no linked assertion, which outranks an unregistered disagreement, which
outranks competing parent sets, which outrank **the researcher's choice**, which
outranks a missing resolve, which outranks a missing summary. A missing critique
is never a next step.

**An unsettled conflict that has weighed everything ends the research** (step
mode, section E; decision 12). When the question is unresolved and every open
conflict carries an `independence_analysis` and a `weighed_log_entry_ids` (present
only once conflict-resolution has declared nothing left to search) covering every
log entry the question owns (the same coverage set as the researcher's choice below), and
no `planned` or `in_progress` item is left (one waiting only on an upload aside),
`nextStep` is `proof-conclusion — unsettled conflict …`: re-running
conflict-resolution there would weigh the same evidence again. Once the question
has a summary with `shortfall: "conflict"`, at whatever tier the evidence reached,
whose `updated` is not older than the question's latest log entry, `nextStep` is null — the research ended
on the conflict. An older one predates the evidence just weighed, so
proof-conclusion refreshes it. One log entry the weighed list does not cover is
new evidence and routes back to conflict-resolution.

**A conflict that wants evidence already planned routes to the search** (step
mode, section E). conflict-resolution sends a conflict needing new evidence to
research-plan, which writes plan items on the SAME question rather than opening
a helper one; hypothesis-tracking, timeline and proof-conclusion gain the same
route in their own PRs.

**Nothing acts on this rung until the router follows `nextStep`.** The field is
advisory, and the router's conflict row still sends any conflict straight to
conflict-resolution until step mode's PR 2 lands. Until then this rung and the
router disagree, which `make e2e-routing-agreement` counts. When every open conflict carries an `independence_analysis` and
the question's active plan still has an open item (one waiting only on an
upload aside), `nextStep` names that item's search — `search-records`, or
`search-external-sites — <pli> (<repo>)` when its repository is not
FamilySearch. Without this rung the conflict rung below fires on every pass and
the items those agents just asked for never run.

`independence_analysis` is the marker because conflict-resolution fills it on
every analysis, resolved or not — non-blank, so a whitespace value is not an
analysis. A conflict not yet analysed still goes to conflict-resolution first,
even beside an analysed one. Once the items close, the rung above decides
whether anything is left to weigh.

**It reads neither the conflict's type nor which item was planned for it.** An
identity conflict routes to the search like any other, and any open item on the
active plan satisfies it, not only one planned for the conflict. Both are
deliberate: the rung's job is to stop the conflict rung firing while work is
outstanding, not to choose the work. A record found by an item still open and
not yet extracted outranks the search — re-running the search that found it
would find it again. An uncited entry on a closed item does not: inconclusive
`partial`s and link lists stay uncited for good, and `extraction_append` cites
the read, not the search that found the record. An item waiting only on the
researcher's upload is skipped, as it is everywhere else in this ladder.

**The researcher's choice is the one rung that names no step** (step mode,
section B). When a question's search stopped on `resources_spent`, it has no
proof summary, no `planned` or `in_progress` item is left on its active plan,
and every log entry the question owns is listed in `search_stop.log_entry_ids`,
`nextStep` reads `researcher's choice: research-plan or proof-conclusion
(default …)`. The search ran out of budget rather than out of sources, so
searching on and concluding are both defensible and the document cannot settle
which — the default comes from the stop's own `justification`: "Overturn risk:
low" means conclude; "Overturn risk: high — <sources>" means plan, since it names
a source that could change the answer; and an older stop that wrote free prose
means plan too.

"Every log entry the question owns" is wider than the `plan_item_id` filter used
everywhere else in this ladder: it is the entries on the question's plan items
**plus** each later entry that closes one of their external-site hand-offs,
matched by URL. A researcher's upload carries no `plan_item_id`, so under the
plain filter it could never undo a choice the stop predates, and the question
would sit at the choice for good.

**Evidence nobody has linked to a person routes to person-evidence.** When a
question has assertions extracted for it, none of them carries a live
(`superseded_by` null) `person_evidence` row other than an unchecked
FamilySearch attachment link, and no proof summary exists yet, its
`nextStep` reads `person-evidence — none of this question's N assertions is linked
to a person`. It is zero links, not some: once a household's subject is linked, its
children and wife routinely stay unlinked (some assertions unlinked on 53 of 230
concluded e2e questions), and that is not a skipped identity step. An attachment link (`isAttachmentLink`) does not count, so a question resting only on an attached record still routes to person-evidence, which is where an attachment is checked inside /research. A speculative link the researcher confirmed does count, or the question would go back to person-evidence to ask again (lead, 2026-10-20). It sits above the
disagreement rung because that rung pairs only *linked* assertions and cannot see a
disagreement among unlinked ones. Left out, the ladder would send the router past
person-evidence and hide the conflict too. It stops once a summary exists, because
the proof write is where an unlinked conclusion is refused
(`research-append-tool-spec.md` §5). Mined from a Cowork run on Family Tree
LZJF-J13: 15 assertions, 0 links, and the router went on to exhaustiveness and a
`probable` proof. Counted the same way as the figures below (2026-10-19, 419 question entries
across 132 scenarios and 209 e2e final states), it fires on 1 e2e question-run and 21
scenario questions. The only `research` routing test among those scenarios is
`research-unlinked-baptism-evidence`, the one mined to need it.

**Before any evidence exists, the next search is named by its repository.** A
`planned` or `searching` question whose log holds a positive or partial entry no
assertion cites by `log_entry_id` reports extraction. An external-site entry whose
capture has not come back does not count, because it is an open hand-off. Otherwise
the lowest-sequence `planned` or `in_progress` item on a plan that is still active
decides, skipping any item that waits only on the researcher's upload — the same
skip the rest of this ladder applies, so a question whose only open item is waiting
names no search. A repository naming FamilySearch, or none at all, reports `search-records`.
Any other repository reports `search-external-sites — <item id> (<repository>)`,
the routing table's own split for that row. With no such item left, the question
reports `research-exhaustiveness`.

A question at `evidence-gathered` reports `research-exhaustiveness` whatever its
log holds. An uncited entry does not move it back to extraction: agents log an
inconclusive search as `partial` and a link list as `positive`, and those entries
stay uncited. Over the corpus on 2026-10-16 (every scenario plus every e2e final
state, 421 question entries), holding the question on extraction would have moved
21 e2e final states there; the four read were all inconclusive `partial` searches
or link lists. The rule as shipped changes 7 entries: `search-records` to
`search-external-sites` (2, the Archion and MyHeritage plan items), extraction to
`search-records` (3), extraction to `search-external-sites` (1, an open MyHeritage
hand-off) and extraction to `research-exhaustiveness` (1).

**A conflict the evidence shows counts even when nobody registered it.** A
`conflicts` entry is what `conflict-resolution` *produces*, so an empty
`conflicts[]` cannot be the signal that routes there. `unregisteredDisagreements`
reads the evidence instead: two assertions linked by `person_evidence` to the same
person, about the same birth or death (`birth`/`birthplace`, `death`/`deathplace`),
whose places disagree or whose years differ by more than two, with no conflict of
any status listing both ids. A date is the span of years it allows, read from the
standard form (`Bet 1836 and 1848` is 1836–1848), and two spans disagree only when
more than two years separate them. A one-sided date is open on its unbounded side:
`Bef 1880` has no lower bound and `Aft 1870` no upper one, so neither disagrees with
an earlier or later year respectively. A bounded date the
standard-date parser cannot read ("after 1870, before 1880") takes no part in the
year comparison. At least one of the pair must be extracted for this
question. Places agree when every component of the less specific one prefix-matches
a component of the other, comparing the raw and standardized spellings separately
and accepting any agreeing pair, so "England" agrees with "Rochdale, Lancashire,
England" and a standardization rename ("Forfarshire" → "Angus") is not a conflict.
On the committed corpus it fires on 11 e2e question-runs. An earlier count
(2026-10-07, 12 hits over 206 final states, file selection not recorded) was
spot-checked hit by hit and every one was a real disagreement (one borderline: a
village against its municipality). It fires on no scenario
except `research-unregistered-census-conflicts`, mined to need it.

**How these figures are counted** (2026-10-08, `npx tsx
dev/measure-question-state-signals.ts`, `--list` for every hit): the corpus is
every scenario `research.json` plus every e2e `run-<ts>.final-research.json`
(developer `scratch_` runs left out), each with its sibling tree, run through the
shipped `questionStates`. That is 397 question entries — 154 across 113 scenarios
and 243 across 203 e2e final states — and a hit is one question entry whose signal
is non-empty. Comparing bounded dates as spans, leaving one-sided dates open, and
counting only birth parents changed no hit on this corpus.

`competingParentSets` is the identity counterpart and needs `tree.gedcomx.json`:
a person in scope — the project's `subject_person_ids` plus every person this
question's assertions are linked to — who is the child of more than two birth-parent
`ParentChild` relationships (no `subtype`, or `Biological` in any casing; `Step`,
`Adoptive`, `Foster` and `Guardian` do not count), while fewer than two hypotheses list this question in
`related_question_ids`. Its step is `hypothesis-tracking`. On the same corpus it
fires on 5 e2e question-runs (the two spot-checked are real: one father with two
different mothers; two same-named mothers).
Both fields stay advisory: nothing refuses a write because of them.

**`storedStatus` is reported, `state` is derived, and they are allowed to
disagree.** `state` is this tool's reading of the documents by the ladder above;
`storedStatus` is `questions[].status` copied verbatim, `null` when the field is
absent or not a string. It is never re-mapped or re-validated against the
`question_status` enum — §2's "not a validator" rule applies, and a malformed
entry is skipped rather than reported.

The two carry different claims, so a disagreement is information rather than a
contradiction. A question with a proof summary reads `state: "concluded"` on the
strength of that artifact while its own `status` may still be `in_progress`;
both are correct, and a reader given only `state` reports the question as settled
when the project does not say so. The field is present on every entry, resolved
questions included, because `questionStates` maps all questions rather than only
open ones.

Neither field gates anything. Adding `storedStatus` moves no rung and changes no
`state`, `nextStep` or `openConflictIds` value.

**A conclusion on a question still open means it was written while blocked.**
`proof-conclusion` resolves the question it concludes, in the same batch as the
summary (its step 7), and leaves the question open only when its preconditions gate
blocked the conclusion. So a question that is `concluded` or `critiqued` and not yet
resolved reports `proof-conclusion — concluded while blocked: re-conclude <ps_id>`,
naming its latest summary. That arm sits below the conflict arms, so while the
blocking conflict is still open the question routes to `conflict-resolution` instead,
and the two cannot loop. `nextStep` is null only when the question has a proof
summary and is resolved.

**Nothing gates on this field, and that is the design.** `research_append`
evaluates its own completion preconditions against the document at write time,
so nothing this projection reports can be the reason a write is refused. What it
no longer does is compute the blocking-conflict reading *independently*: the
completion gate calls `conflictBlocksCompletion` from `utils/question-state.ts`,
the project-wide sibling of the per-question predicate behind `openConflictIds`.
Sharing the predicate does not make the field a gate — the tool re-derives its
own answer from the document it is about to write, and never consults this
projection. Two consequences worth stating so they are not "tidied" later:

- It reports a *near* neighbour of the condition the completion gate refuses on,
  plus the resolved-with-no-proof-summary case that gate deliberately lets pass.
  Near, not identical, in two directions that are both deliberate: this ladder
  has no identity-conflict arm, because an identity conflict names no question
  and would otherwise report against every one of them; and it scopes the
  derived arm to the assertions tied to *this* question, where the gate scopes it
  project-wide. Advising on more than is enforced is correct here: a prompt costs
  nothing when wrong.
- Because it cannot refuse, it cannot cause an availability regression, which is
  what makes it safe to ship ahead of the experiment measuring whether it changes
  routing at all. A state machine that could *deny* activity would have to infer
  intent the document does not carry.

The same predicates were first written against the committed e2e corpus, where
they reproduced an independent count of the completion gate's population to
within two runs.

### 2.3 `awaitingUser` — what the user was already sent to fetch

Decided by the lead 2026-09-30. In an alpha-feedback session the agent
re-raised one Fold3 naturalization petition seven times over eight turns until
the user fetched it. The "waiting on the user" record already existed — an
`external_site` log entry with `outcome: "partial"` and
`capture_received: false` — but nothing read it.

A row is every `log[]` entry with `tool: "external_site"`,
`outcome: "partial"` and `external_site.capture_received === false` that no
**later** `external_site` entry (by log order) for the same `url_generated`
closes. A later entry closes it when its outcome is not `partial`, whether or
not a capture came back (closing condition amended 2026-10-01; the rest of the
2026-09-30 ruling stands). `awaitingUser` answers one question — is the user
holding a link from us right now?

- A capture answers the hand-off.
- "The user can't access the site" is logged as `outcome: "error"` with no
  capture, and ends it too. The plan item still records what they chose
  (`skipped` on their yes, `in_progress` otherwise), so closing the row loses
  nothing.
- A later `partial` is the link sent again. It opens a row of its own and
  closes none.

"Same URL" is an exact match on `url_generated`.

- **Keyed on `partial`, not on `capture_received` alone.** That session's bundle
  holds two `outcome: "positive"` entries logged with `capture_received: false`
  (`log_012`, `log_013`) whose results were already in hand; they are not
  waiting on anyone and never list.
- **Later only.** An earlier capture of the same URL does not close a hand-off
  issued after it: the user was sent the link again.
- **An autonomous deferral never opens a row.** It is logged
  `outcome: "negative"` with no capture — nothing was handed to anyone.
- **Why not close on a capture alone.** The 2026-09-30 ruling closed a row
  only on `capture_received: true`. A no-access reply carries no capture, so
  "I have no Archion pass" would have left the row listed for good — the same
  re-raise loop this field exists to stop. Amended 2026-10-01.

*Rejected:* an `awaiting_user` plan-item status — it duplicates state the log
already holds, and would pull `research-plan` into the change.

Written by `build_external_search_url`, which appends the in-flight entry
itself when given a `projectPath` (`build-external-search-url-tool-spec.md`
§6). A hand-off that did not come from the builder — an image link on a
FamilySearch record, the shape that session hit — is logged in the same shape
by the `search-external-sites` agent itself.

### 2.4 `externalCollections` — counts of the stored curated collections

Present only when the project holds `external-collections.json` (written by
`external_links_search`; `external-links-search-tool-spec.md`, "Stored list"):

```typescript
externalCollections?: {
  [place: string]: { total: number, byRecordType: { [recordType: string]: number } }
}
```

Counts only, never rows — the lists run to hundreds of rows per state, and the
rows are read with `research_query({section: "external_collections", place,
recordType})`. `byRecordType` counts a row once per record type it carries, so
its values can sum past `total`. Places and record types are sorted. The field is
absent when no list is stored, and also when the file cannot be read: a broken
cache file must never fail the whole projection.

### 2.5 `exhaustedImageGroups` — films whose browse cap is spent

The image cap (`image-transcribe-tool-spec.md` §5.8) allows 20 distinct images per
film per project, and nothing resets it. A cap refusal only reaches the agent that
hit it, so a router that re-spawns `search-images` for the same plan item pays for
an agent that is refused on its first page (2 of 4 browse spawns in one hosted
session of 2026-10-14). This field lets the router see the spent film before it spawns.

Computed at read time from `results/image-browse.jsonl`, the cap's own log
(`exhaustedImageGroups` in `src/utils/browse-budget.ts`, which shares its line
parser with the cap check): every film with at least 20 distinct `image_id`s, sorted
by film. Nothing is persisted. `planItemIds` are the distinct `plan_item_id`s of
`research.json` `log` entries with `tool: "image_search"` whose
`query.imageGroupNumber` belongs to that film (its part before the first `_`), so
the router can match the plan item it is about to delegate (plan items carry no
image group). Only `image_search` entries count: that is the tool `search-images`
logs a browse under, and a `fulltext_search` entry scoped to the same film is not a
browse. Only items still `planned` or `in_progress` on an `active` plan are listed:
once `research-plan` disposes of an item it drops off, so the router does not send it
back on the next pass; the film itself stays listed while its cap is spent. `[]` when
no film is spent, and when the log is absent or unreadable — like
the cap itself, the field never fails a call. Reads that named no project are
counted in memory only and are not visible here.

The description tells the router never to delegate a browse of a listed film and to
send its `planItemIds` to `research-plan` to dispose of (lead, 2026-10-28); the
`research` router's `search-images` row says the same.

### 2.6 `sectionCounts` — which sections a query would find empty

```typescript
sectionCounts: { [section: string]: number | null }   // every research.json section research_query serves
unregisteredDisagreementCount: number
```

One key per section in `research_query`'s `RESEARCH_QUERY_SECTIONS` except
`external_collections` (counted by §2.4), each the length of that research.json
array. An absent section in `RESEARCH_QUERY_OPTIONAL_SECTIONS` counts 0, as
`research_query` answers it; a section `research_query` would refuse — a required
one absent, or any one present but not an array — is `null`. The contract is that
a 0 matches the `count` an unfiltered `research_query` of that section would
return, so a consumer may treat the 0 as having read the section and skip the
call, and may never treat a `null` that way. The disagreement count comes from
`research_query`'s own `disagreementsInScope`, so the two cannot drift.

`conflicts` is the one section whose query returns more than its items: it also
reports `unregisteredDisagreements`, project-wide when no `questionId` is given.
`unregisteredDisagreementCount` is that list's length, so `conflicts: 0` with a
non-zero count still needs the query.

Why: question-selection reads several sections before it picks a question. In
the October 2026 e2e corpus 98 of 98 of those reads came back empty; in two
hosted sessions of 2026-10-05/06, 12 of 21 did. The reads were issued in
parallel, so the counts save tokens and calls more than wall-clock time.

## 3. Decisions recorded

- **A projection, not a query language.** One fixed shape, no field
  selectors — the consumer is one agent prompt, and a stable shape is what
  lets that prompt say "check `persons[].sourceRefs`". *Rejected:* jq-style
  path parameters (open-ended context cost, un-promptable).
- **No assertion bodies.** Per-assertion detail (values, classifications) is
  deliberately excluded — it is exactly the growing payload the diet
  removes. Refinement flows get the specific `a_` ids from the delegating
  caller, who holds file access.
- **camelCase output.** This is an MCP wire surface. The snake_case source
  fields (`gedcomx_source_description_id`, `record_id`) are renamed at the
  boundary like every other tool.

### Status-answering clause

The tool's `description` opens with an instruction that reaches the main
thread on every plane (the tool is `ALWAYS_LOAD` in `src/tool-schemas.ts`, and
the unit harness serves the compiled production description in
`eval/harness/harness/mock_mcp.py`; in the 2026-10-12 harness runs the schema
was still deferred and arrived through ToolSearch, description included):

> When the user asks where the project stands ("where are we?", "summarize
> progress", "what have we found?") or reopens a project, call this and answer
> from it in exactly ONE plain-language paragraph and nothing else: the
> objective, what is established, what is open or waiting on the researcher,
> and the next step, stated rather than asked, as the paragraph's last
> sentence. This shape overrides narrationGuidance for this answer. No lead-in
> line ("Here's where things stand:"), no line breaks, headings, tables, lists
> or bold, no closing question, and no identifiers, file names, tool names or
> field names: say "the conclusion" or "the parentage question", never q_001
> or ps_001.
> nextStep values name ids and agents; restate them in plain words. Do not
> read the project files and do not delegate.

It leads the description rather than closing it. Measured on `ut_research_025`
(2026-10-12, scratch runs, not committed): appended after the field list, the clause was ignored — the reply
was headings, a table and raw ids. Moved to the front it held in 2 of 3 runs,
the third quoting `ps_001`. With the worked examples, 3 of 3 scratch runs and
0 of 1 in the full suite; with the `nextStep` sentence added, 4 of 5. Every
miss quoted `ps_001`, which `questionStatuses[].nextStep` hands over verbatim
("gps-mentor (proof-critique) — ps_001").

Once `narrationGuidance` came back in the same result, the house
guidance's "what was found, in one paragraph, and what happens next in one
sentence" competed with the one-paragraph rule: on 2026-10-30 (Windows, scratch
runs) 10 of 17 replies put "The immediate next step is …" on a line of its own,
and the clause's own example "the proof summary" put a word the house guidance
bans into the reply. Naming the next step as the paragraph's last sentence,
saying this shape overrides `narrationGuidance`, and giving "the conclusion" as
the example: 10 of 10 single-paragraph replies, 9 of 10 passing the judge.

The shape half is checked too: the validator fails a reply with more than one
paragraph, a heading, list or table line, bold, or a closing question. Before
that check existed, both committed full-suite replies passed while breaking it
(2026-10-15) — a "Here's where things stand:" lead-in, four and seven
paragraphs, bold names and a closing offer — and the wording above was
tightened to name each of those.

**Decided (lead, 2026-10-06):** delete the `project-status` agent; a status
request is answered by the main thread in one plain paragraph from
`project_context`. Rests on four facts: a live Cowork session (2026-10-02)
confirmed the main-thread read matched the agent's report and caught two
defects the agent missed; the agent's detailed summary never reached the user
through the relay (`ut_project_status_010`, a test deleted with the agent; its run logs remain in git history); `project_context` already returns
objective, per-question state and next step, open conflicts, persons, sources
and `awaitingUser`; and writer tools already refuse dangling ids
(`validator.ts`), covering the broken-foreign-key half of the agent's job.
Supersedes "PS return: A" (2026-09-24). Knowingly dropped: the agent's
stale-plan detection — replaced only once phase 2 of
`docs/plan/research-as-a-job-later.md` lands.

**Decided (review-ready, 2026-10-06):** the clause goes in the tool's
description, not in a router skill description. Making a router description
claim status would start a full research run on "where are we?"; the tool
description reaches the main thread on every plane and leaves routers
untouched.

## 4. Errors / edge cases

| Condition | Behavior |
|-----------|----------|
| `projectPath` is a real directory holding **neither** project file | `{ ok: false, reason: "no_project", errors, buildId }` — the user is not in a research project, so this is an answer rather than a failure and is **not** marked `isError`. One of the two reads that owed this. See the write-boundary invariants in `guardrail-enforcement-spec.md` |
| Exactly one of `research.json` / `tree.gedcomx.json` present, or either invalid JSON — a *broken* project | `{ ok: false, errors, buildId }`, loud |
| empty project (no questions/persons/sources) | `ok: true` with empty arrays |
| question with a >140-char text | truncated to 139 chars + `…` |
| person with no names / no preferred flag | `name` falls back to the first names entry, else `null` |
| assertions whose `source_id` matches no source | ignored (the validator reports dangling refs, not this tool) |

## 5. Test plan (vitest)

- **populated project** — projection correctness: open-vs-resolved question
  filtering; preferred-name rendering; `sourceRefs` unioned (distinct) across
  person/fact/name references; per-source `recordIds` (distinct, verbatim)
  and `assertionCount`; `projectStatus` echoed.
- **empty project** — empty arrays, every `sectionCounts` value 0, `ok: true`.
- **`sectionCounts`** — for every section, equal to the unfiltered
  `research_query` `count`; `unregisteredDisagreementCount` equal to that
  query's `conflicts` `unregisteredDisagreements` length, including on a project
  where `conflicts` counts 0 and one disagreement is unregistered; an absent
  optional section counts 0; an absent required section, or one that is not an
  array, is `null` and `research_query` refuses it.
- **truncation** — a 200-char question comes back at 140 chars ending in `…`;
  a 140-char question is untouched.
- **missing file** — `{ ok: false, errors }`, when the folder holds the other
  half of a project.
- **not a project at all** — `{ ok: false, reason: "no_project", errors }`, and
  no `isError`.
- **`awaitingUser`** — lists an open partial hand-off with its plan item and
  timestamp; drops it once a later entry for the same URL carries the capture,
  and when a later `error` entry records that the user could not access the site;
  a re-sent link (a later `partial`) opens its own row and closes none; an
  autonomous deferral (`negative`, no capture) never lists;
  a capture on a different URL closes nothing; an earlier capture does not
  close a later hand-off; a `positive` entry with `capture_received: false`
  never lists; a non-`external_site` entry never lists.
- **`exhaustedImageGroups`** — a film at 20 distinct images lists with the plan
  items of its `image_search` entries, across sub-volumes of the film, and not those
  of a `fulltext_search` entry on it; 19 images plus a re-read does not list; a torn
  log line is skipped; a spent film with no `image_search` entry lists with
  `planItemIds: []`; an empty project gives `[]`; a `completed` or `skipped` item,
  and an item on a `superseded` plan, drop off while `planned` and `in_progress`
  items on the active plan stay.

## 6. Consumers / wiring

Standard MCP tool: `src/tools/project-context.ts`, schema in
`allToolSchemas` (`src/tool-schemas.ts`), dispatch in `src/index.ts`, name in
`manifest.json` (packaging drift test enforces parity). Registered as a
**live tool** in the eval harness (`eval/harness/harness/mock_mcp.py`
`LIVE_TOOLS`) with a real input-schema mirror — it is a deterministic
function of workspace state, so a fixture cannot honestly answer it.

Consumers: built for the `record-extractor` agent (since retired), whose one
call per invocation replaced its up-front file reads. It is now read by the
`citation`, `gps-mentor`, `proof-conclusion`, `question-selection` and
`research-exhaustiveness` agents and several skills. New agents should reuse
this projection rather than re-reading project files.
