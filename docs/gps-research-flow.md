# The GPS research flow — what each skill does and when it runs

This is the orientation doc for someone about to change a skill: it walks
the Genealogical Proof Standard workflow in the order `/research` actually
invokes things, one paragraph per skill, naming the MCP tools each calls
and the `research.json` / `tree.gedcomx.json` sections each owns. It
describes the flow **as the SKILL.md files implement it**, which in two
places differs from `README.md` (see "Where README drifts" at the end).

For the user-facing catalog — what to say to trigger a skill — read
`README.md`. For how a skill gets authored, tested, and improved, read
[`docs/skill-lifecycle.md`](skill-lifecycle.md). For what a given MCP tool
must do, read `docs/specs/<tool>-tool-spec.md`.

## The shape of it

```
init-project ─▶ question-selection ─▶ research-plan ─▶ [search-*]
                     ▲                     ▲                │
                     │                     │                ▼
                     │                     │        record-extraction
                     │                     │                │
                     │                     │                ▼
                     │                     │         person-evidence
                     │                     │                │
                     │                     │      ┌─────────┴─────────┐
                     │                     │      ▼                   ▼
                     │                     │  conflict-        hypothesis-
                     │                     │  resolution        tracking
                     │                     │      └─────────┬─────────┘
                     │                     │                ▼
                     └──── FAN pivot ──────┴──── gaps ── research-exhaustiveness
                                                             │ declared
                                                             ▼
                                                      proof-conclusion
                                                             │ ps_id
                                                             ▼
                                                   gps-mentor (proof-critique)
```

Three structural facts govern everything below.

**Section ownership is strictly partitioned.** `question-selection` owns
`questions`; `research-plan` owns `plans`/`plan_items`; the four search
skills own `log[]` and plan-item `status` and nothing else;
`record-extraction` (through its agent) owns `sources` + `assertions` +
all evidence classifications; `person-evidence` owns `person_evidence`
and the tree's household skeleton; `conflict-resolution` owns `conflicts`;
`proof-conclusion` owns `proof_summaries` and the concluded tree write.
A skill writing outside its lane is a bug, and most SKILL.md bodies say so
explicitly.

**Every write goes through a writer tool that validates the whole project
before persisting** (`research_append`, `research_log_append`,
`extraction_append`, `materialize_facts`, `tree_edit`, `tree_correct`) and
writes nothing on `{ ok: false, errors }`. This is why `/research` §4
tells the agent *not* to insert defensive `validate_research_schema`
passes between steps, and why skills are told not to re-read state
defensively mid-run. `init-project` is the single exception — it writes
both files directly, because it is creating them.

**The staging/sidecar chain is the spine of the search→extraction
handoff.** `projectPath` on a search → `staged.resultsRef` →
`research_log_append` writes `results/<log_id>.json` → `results_ref` on
the log entry → `record_persona_id` auto-fill at extraction → assertions
append accepted → `same_person` scoring in `person-evidence`. A
sidecar-less search breaks every downstream link, and a hand-written
sidecar is flagged as an orphan that blocks all subsequent writes.

Every skill except `forget-and-rederive` is pinned `model:
claude-sonnet-4-6` in frontmatter; `gps-mentor` is the lone
`claude-sonnet-5`. Note that a **skill** `model:` pin is inert in
production — only the eval harness reads it. Agent pins are honored.

---

## Part 1 — the `/research` routing loop

### research

The orchestrator, and deliberately a thin one: it introduces no GPS logic
of its own, writes nothing directly, and only reads `research.json` to
decide which sub-skill fires next. Its core is a routing table keyed on
project state — objective but no questions → `question-selection`; a
question with no plan → `research-plan`; a positive/partial log entry with
no assertion referencing it → `record-extraction`; and so on. Two rules in
it carry disproportionate weight. First, it builds the log-vs-assertion
cross-reference **explicitly rather than by eye**, because the
characteristic failure is an early search that got set aside when a later,
more interesting one pulled focus, leaving a positive log entry that never
got extracted. Second, **inline extraction is forbidden** — no matter how
small the record, extraction routes through the skill, which delegates to
the `record-extractor` agent, and classification is final at extraction
with no downstream refinement pass. Under `--autonomous` it must keep
working in a single continuous turn; writing "Next: research-plan" and
yielding is an explicit failure mode, and the only stop conditions are
`project.status == "completed"`, a user halt, or a logged blocker. The one
place it is told to stop rather than continue is an `address_first` mentor
verdict in interactive mode.

### init-project

Creates the two project files and runs GPS Steps 1–2 (define the problem,
survey known information). A guard clause fires before any file read or
tool call: if `research.json` already exists it emits a one-sentence
refusal and stops. Otherwise it runs a deliberately **non-blocking**
two-question researcher interview (experience level → `narration_guidance`
that every downstream SKILL.md reads; paid subscriptions → the tie-breaker
`search-external-sites` uses), surveys known holdings, takes the
objective, and resolves the subject — `person_search` with a
surname-plus-one rule when there's no FamilySearch PID, then
`person_read`. It writes `tree.gedcomx.json` by converting full GedcomX to
the simplified snake_case form, giving *every* person a local `I` id even
when FamilySearch-seeded and stamping each FS-sourced fact with
`quality: 1` (compiled tree data is questionable). `research.json` gets
`project`, `researcher_profile`, and `known_holdings`; every other section
stays an empty array. Asking the interview questions and then stopping is
called out as a failure — defaults exist precisely so the files get
written.

### question-selection

Picks the next research question and appends it to `questions[]` via
`research_append` (one question per invocation, id assigned by the tool).
Before selecting anything it runs two gates. **Finish what's open**: if
any question has an `in_progress` plan item, don't create a new one —
recommend completing the in-flight item by `pli_` id, unless an unresolved
conflict names that question in `blocks_question_ids`. **The autonomous
stop point**: once every independent part of the objective is `resolved`
with a proof summary at `probable` or better, it returns "no further
questions — objective answered" so `/research` can write
`project.status = "completed"`. That gate is on *answered*, not *proved* —
it must not spawn corroboration questions to upgrade `probable` to
`proved`. Selection itself walks a seven-rung priority ladder recorded in
`selection_basis`: unresolved conflict, hypothesis test, high-severity
timeline gap, objective decomposition, pedigree gap, FAN pivot, new
evidence. FAN pivot fires only when all planned direct searches are done,
never on a single nil.

### research-plan

Turns a question into a sequenced list of record sets with repositories,
rationale, and fallbacks, writing `plans` + nested `plan_items` in **one
batched `research_append` call** — plan shell first, items referencing its
*predicted* id (ids are highest-existing + 1, so hard-coding `pl_001`
silently attaches items to another question's plan). The most
consequential thing in this skill is its **Step 1a mode gate**, read
before anything else: an active plan with unfinished items defaults to
*review* (recap the next item, create nothing); a fully drained plan means
*add-new*; only genuinely invalidated assumptions justify *supersede*, and
the old plan must be marked `superseded` first because the tool rejects a
second active plan per question. Planning is preceded by a locality survey
— `locality-guide` if no guide exists, otherwise `place_search`,
`collections_search`, `external_links_search`, `volume_search`,
`wiki_search`, `wiki_place_page` directly. Selection enforces topical
breadth (BCG 14) plus two hard-coded requirements: a parentage question
always gets a dedicated item for the candidate parents' **marriage to each
other**, and a male subject in a conscription country (Denmark/Norway from
1789) gets the **military levy rolls** (*lægdsruller*) as a first-class
parentage item, not a fallback. Plans run 4–10 items; fewer than three
isn't exhaustive, more than twelve means split the question.

### locality-guide

Not a routing row — `research-plan` calls it when a question needs
jurisdiction context first, and users invoke it directly. It produces a
records-availability guide for a place and period and **writes nothing**;
the output goes straight to the user. Its defining mechanic is a **single
turn of parallel tool calls** — `place_population`, `collections_search`,
`volume_search`, `external_links_search`, `wiki_search`, and all four
`wiki_place_page` sections issued together, with a matching narration
exception so preambles don't serialize the batch. It then classifies each
record type by access level, and the distinction it must not collapse is
low/null `recordSearchablePercent` with `fulltextSearchable: true` —
full-text searchable but not name-indexed, which routes to
`search-full-text` rather than `search-records`. A hard grounding rule
governs the whole skill: name only collections, counts, and repositories
that appear in tool output; zero or truncated results are digitization
gaps to report, never gaps to fill with plausible invention.

### search-records

Executes FamilySearch **indexed** searches against the next `planned` plan
item. A route check runs before any tool call — external site, "what
should I search next?", or a record already in hand all redirect
immediately — on the EXECUTE-vs-DECIDE test. Queries go broad-to-narrow
with no wildcards (explicit spelling variants instead), always anchored on
`surname` or `recordCountry`, and never by dropping `givenName`. Every
call passes `projectPath` and `count: 50`; if no `staged.resultsRef` comes
back the identical query is re-run **with** `projectPath`, because a
sidecar-less entry cannot feed extraction and there is no manual
workaround. Triage is `rank_search_matches` on every search returning ≥1
result — never hand-scoring — which re-orders by FamilySearch's own
matcher and reports `attachedToSubject`. The ranked list is a review
surface, not auto-accept: the **namesake trap** gets extended treatment,
and a precise record conflicting with the tree's approximate estimate is
*more* disqualifying, not less. It logs every search including nils via
`research_log_append`, sets the plan item to `in_progress` — never
`completed`, which is `record-extraction`'s to set — and on a nil iterates
at least three strategy levers before **mandatorily and immediately**
escalating to `search-external-sites` in the same turn. Its closing
accuracy rule: never say "logged with sources" or "saved to the project"
unless extraction actually ran and returned `src_`/`a_` ids.

### search-full-text

Searches FamilySearch's AI-transcribed document images — the only way to
find someone as witness, executor, appraiser, heir, or neighbor rather
than as a record principal. `search-records` delegates here for
newspapers, pre-1850 US, notarial records, narrative documents, and
parish registers where the target is unindexed. It is a genuinely
different engine: no fuzzy matching, no Soundex, no abbreviation expansion
(Wm and William are separate searches), default OR, and Lucene-style
operators — so `+` on every term is mandatory. Three query rules carry
real failure history: search by **name only** and filter place
afterward (place in the query matches collection metadata and produces
false positives); **never scope to a record `collectionId`** (a Cantabrian
baptism found by unscoped `+Naveda +Somarriba` returned zero when scoped);
and decompose compound surnames into **co-occurrence, never an adjacent
phrase**, because in the parents' own records the father carries the
paternal surname and the mother the maternal one. Results are derivative —
original → image → AI transcript, ~10% error — so they are always verified
against the image. Queries cap at five per plan item, negative-entry notes
must state collection class, filters, and variants tried, and diagnostic
"is the index working" queries are forbidden.

### search-images

Browses digitized-but-unsearchable volumes page by page: `volume_search`
→ `image_search` → one `@plugin:image-reader` invocation per page. Routing
runs before everything, including narration and file reads, with five
redirect cases — and the one that needs care is the last: "browse and
transcribe what you find" is an in-scope browse even when an image ID is
named, so the word "transcribe" alone doesn't route away. Two API shapes
account for most mistakes here: `image_search` takes an
`imageGroupNumber`, never an `imageId`, and it returns the whole group in
one call with no pagination. The skill **must not call `image_read`
itself** — it doesn't have the tool — because accumulated base64
overflows the transport's ~1 MiB buffer and crashes the run; the subagent
exists to keep the bytes out of context. Its most-cited failure is
procedural rather than technical: **listing a volume's images is a
completed browse and must be logged before anything is presented**, and
"no volumes returned" is normal data that gets logged as a nil, not a tool
error that justifies suggesting another repository first.

### search-external-sites

Covers Ancestry, MyHeritage, FindMyPast, FindAGrave, and Newspapers.com,
which have no public APIs and prohibit automated access — so the skill
**never loads a page**. The loop is generate URL → user clicks in their
authenticated browser → user captures as PDF → agent analyzes; the agent
supplies genealogical expertise and the user's browser supplies access,
which makes getting the search *parameters* right the whole job. It
resolves the place, pulls FamilySearch-curated links via
`external_links_search`, and either appends parameters to a curated base
whose record type actually matches the plan item, or says plainly that
it's falling back to site-wide search. **Two log entries per search**, and
the site-search entry is written *before* the URL is handed over —
"if you present the URL and stop, `research.json` shows nothing
happened." Under `--autonomous` there is no one to capture, so it takes a
distinct branch: prefer a FamilySearch equivalent, otherwise build the URL
as a genuine lead and log it as deferred with
`externalSite.captureReceived: false`, mark the item terminal, and keep
going — a stalled wait would end the run. `researcher_profile.subscriptions`
is a tie-breaker, never a gate.

### record-extraction

A **thin router**, and the enforcement point for the workflow's sharpest
rule: it holds none of the persistence tools, so inline extraction isn't
merely discouraged, it's impossible. It acquires and triages a record by
one of four paths (search result already staged in a sidecar, ARK or
entity id, uploaded PDF, or page image), writes the router-side log entry
if no search skill already logged the search, and then delegates
**one `@plugin:record-extractor` agent per record**. Delegation framing is
load-bearing: never "fix" or "correct" the tree (corrective framing has
induced destructive edits), and never instruct the agent to create
`person_evidence` links or assign identity confidence (a delegation that
did produced a fabricated link carrying a match score no tool had
computed). Images go to `@plugin:image-reader`, one per invocation, with
`looking_for` phrased as a search key — who or what to locate — never as
the expected answer. A suspect identity-keying name (an out-of-place
patronymic, an uncorroborated spelling) must be routed to the original
register image before being recorded as established, or recorded tentative
with `[?]`; this is how an index OCR slip becomes a wrong father in the
tree. Classification-refinement requests route the same way — find the
record, delegate, never re-classify inline.

### record-extractor (agent)

Extracts **all** assertions from **one** record and persists them in a
single `extraction_append` call. It has no file-read tool at all: one
`project_context` call gives it open questions, persons, and sources, and
every mechanical lookup lives inside the writer tools, which return every
id they assign. Its central doctrine is that the three GPS layers are
**independent and per-assertion, never per-source** — a contemporaneous
death certificate is an *original* source even though the informant's
knowledge is secondhand, and that secondhand-ness is captured at the
information and evidence layers instead. It writes first-and-final
classifications, because **no downstream classification pass exists**;
everything after it — conflict-resolution, proof-conclusion, the mentor's
precondition check — trusts what it recorded. It is assertion-only: it
writes `sources` + `assertions` and the tree's `S` source description, but
no persons and no edges. `research_append` is denied both by omission and
**explicitly in `disallowedTools`**, under both server spellings, because
a deny binds even under `bypassPermissions` (the hosted path) and a deny
naming one spelling silently fails to bind under the other.

### image-reader (agent)

Reads exactly one image scan and returns only a transcription. Its single
tool is `image_transcribe`, and the entire point is that the bytes never
enter any agent's context. It returns a faithful transcription of every
genealogically relevant entry on the page — not just the one asked about —
preserving original spelling, language, marginalia, and `[illegible]`
marks, with the FOUND/NOT FOUND pointer appended *after* the transcription
so it never shortens it. Its failure contract matters as much as its
success path: when `image_transcribe` errors it must emit
`NOT READ: <imageId>` with the quoted error and a pivot recommendation,
and must never fabricate page contents, never retry through a browser or
`web_fetch`, and never let a caller's asserted answer override what the
page says. Agents can't nest agents, so `record-extractor` never calls it —
`record-extraction` and `search-images` do.

### person-evidence

Identity resolution: does this record's persona correspond to a person in
the tree? It exists as a separate step because extraction attaches
assertions to `record_id` + `record_role` (the persona), and this skill
creates the **revisable** link between persona and person — mirroring
GedcomX's own distinction, so that a later merge doesn't corrupt data and
so identity isn't decided prematurely at extraction time. Correlation
analysis sets confidence, and the threshold policy is called
non-negotiable: weak (name only, or a core identifier conflicts) →
`speculative` and a pause for user confirmation; moderate → `probable`;
strong → `confident`. `same_person` is an input to that judgment, never a
substitute — a qualitative conflict caps confidence regardless of score,
and a **patronymic mismatch or unaccounted-for name element is a
core-identifier conflict, not a spelling variant**, because a differing
patronymic names a different father. Scoring requires assembling the tree
side as a record-sized subset — the candidate plus its matching mob
(parents, spouses, children, siblings), capped at 40 people — not the
whole tree. It also owns the **household skeleton**: tolerantly match the
parents, dry-run `merge_warnings` as a coherence gate before any write
(error tier blocks), then `materialize_facts` every member per persona and
write the edges with source refs, giving a pre-1880 census parent-child
edge a lower ref quality because it's an inference from co-residence.
Linking only the focus person and then asking whether to link the parent
is incomplete work.

### conflict-resolution

Identifies and resolves both fact-level conflicts (three different
birthplaces) and identity-level ones (two same-named people in one
county), writing `conflicts[]` and nothing else. It **trusts existing
classifications** and must not re-classify inline. What counts as a
conflict is narrower than it looks: same person, same `fact_type`, **same
attribute**, compared on `place`/`standard_place`/`date`/`structured_value`
and never on free-text `value` — a birth-place claim and a birth-date claim
are explicitly not a conflict, and `materialize_facts` surfaces conflicts
only for single-valued vitals, so multi-valued types like Occupation and
Residence must never be manufactured into conflicts. Resolution requires
real source-independence analysis (GPS Standard 46 — related information
items get no more credibility than their strongest single member), the two
or three decisive weighing factors rather than mechanical scoring of all
seven, and a `resolution_rationale` in a mandatory four-part structure
whose last part explains *why the less reliable evidence exists*, using a
named historical pattern tied to the informant's position. The tool
enforces the completeness invariant: `status: "resolved"` requires all four
analysis fields on the same write. Deferral is a persisted finding, not a
chat reply. Same-name disambiguation treats individuals as distinct until
proven otherwise, and co-enumeration on one census page is definitive
evidence of two people.

### hypothesis-tracking

Tracks competing candidates through `active → supported → ruled_out` in
`hypotheses[]`. It opens with a **mandatory scope gate before any file
read**: a routing table classifies the request, and if it belongs to
conflict-resolution, timeline, or proof-conclusion, the skill emits one
routing sentence and produces no other output — no reads, no tool calls,
no analysis. New hypotheses always start `active` even when evidence
already favors them; promotion is a separate evaluation. `supported`
requires a supporting `direct` assertion, no unresolved contradictions, and
no timeline impossibilities, and there's an explicit anti-downgrade rule:
don't drop `supported → active` over census age rounding or five-year
birth-year drift. `ruled_out` requires a `ruled_out_reason` — the
validator rejects it otherwise. It acts on genuine impossibilities
immediately rather than deferring them, except in read-only review mode,
and it touches only the hypothesis the user named.

### research-exhaustiveness

The gate before proof, and `/research` routes here as soon as analyzed
evidence *plausibly* answers the question — a front-loaded plan is a
prioritized list, not a checklist to drain. It runs two hard blocks
first: every assertion tied to the question must carry real reasoned
classifications, and every person the judgment depends on must be
identity-linked. Then the GPS five threshold questions, then seven stop
criteria each answered in a sentence or two, written into
`exhaustive_declaration` alongside `status: "exhaustive_declared"` in one
`research_append` update. Its default when in doubt is to route back to
`research-plan`, on the principle that a gap is unsearched rather than
unobtainable — and that round-trip is exactly what lets a simple-recall
question stop early without weakening a completeness question ("did they
have *any other* children?"), which needs enumerating sources before it
can conclude. The narrow exception is a source *pursued and verifiably
unavailable* — over the transport cap, sealed by privacy law, or nil
across every search path — which is not an unsearched gap. Early
termination writes `declared: false` and leaves `status: "in_progress"`,
because an honest non-exhaustive stop must not be labeled exhaustive.

### proof-conclusion

Writes the GPS conclusion: tier (proved/probable/possible/not_proved/
disproved), vehicle (statement/summary/argument), and a self-contained
`narrative_markdown` that is the **authoritative** conclusion with the
structured fields following it. Its preconditions gate is mechanical and
shown as work, and it runs regardless of how the skill was invoked — a
user saying "write the conclusion" names a destination, not permission to
skip stops. Unresolved conflicts hard-block `proved`, and a conflict
disputing the concluded fact itself **caps the tier at `possible`**, which
sits below the tree-write threshold, so a disputed conclusion never
reaches the tree. Then §6, which the skill itself calls the place where
the conclusion actually lands: at tier ≥ probable it writes the concluded
relationship **first** in a batched `tree_edit` (with a non-null source
ref, or the all-or-nothing batch fails), then the concluded fact — usually
by setting `primary: true` on the evidence fact `person-evidence` already
materialized, via a separate `tree_correct` call, rather than adding a
second fact. `/research` backs this with a hard **tree-encoding gate**: it
reads the tree, confirms the edge exists, and re-invokes this skill if it
doesn't, because a proof summary whose relationship never reached the tree
is a found-but-lost result. It must not touch `questions` at all.

### gps-mentor (agent)

The single mentor checkpoint: an advisory `proof-critique` after a proof
summary is written, pinned to `claude-sonnet-5`. It is the only check that
reads `narrative_markdown` as a self-contained document, which is what it
exists to catch — a summary sentence contradicting the list below it, a
tier the cited assertions don't support, hedging language inconsistent
with a "Proved" claim. It has **no search tools**: it evaluates gathered
evidence and never gathers more. It persists a structured verdict in one
`research_append` call — the body as the top-level `verdict` argument, the
pointer as `entry` — and the tool writes the `evaluations/` file, stamps
`file_path`, and assigns the id; the agent must never write the file
itself. It is append-only to `evaluations[]` and never touches
`tree.gedcomx.json`. The gate is **mandatory to run and advisory to
act on**: it fires after the answer is already persisted, so an
`address_first` verdict is surfaced and recorded but never blocks, forces
rework, or re-opens a resolved question. The one exception is interactive
mode, where `/research` must print the question and **actually yield the
turn** — quietly applying the mentor's fix and presenting the result is
auto-routing past the gate in substance. Two earlier pre-gates
(`pre-exhaustiveness`, `conclusion-readiness`) were removed from the loop
because they duplicated existing checks and their forced rework starved
the proof step; both focuses survive on-demand.

---

## Part 2 — invoked by loop skills, not by the routing table

These have no row in `/research`'s routing table. Under `/research` they
fire only when another skill hands off, or when the user asks directly.

### timeline

Builds chronological timelines into `timelines[]`, keyed by a `t_` id and
label rather than by person id — precisely so a candidate timeline can
aggregate persons from two tree entries that might be the same individual.
Its enrichment phase is a batching discipline: collect every unique place
string and issue all `place_search` calls in one turn, then determine every
needed distance and issue all `place_distance` calls in one turn, caching
by unordered pair. Gap boundaries are copied verbatim from the bounding
event and never padded to January 1st or December 31st. Impossibilities
are for **chronological contradictions only** — events before birth or
after death, distances that outrun era travel speeds, one person
enumerated in two states in a census year; identity uncertainty and source
disagreement belong in `conflicts[]`. The Mode B identity verdict must
name its specific signals, because no field persists it — the chat reply
is its only record. Regeneration replaces `events`/`gaps`/`impossibilities`
wholesale.

### citation

Refines `citation` and `citation_detail` on **existing** source entries to
Evidence Explained standards; it never creates a source entry, which is
`record-extraction`'s job, and it opens with a routing block that sends
any "I found this record" request there before reading a file. The
governing test is replication: could another researcher find this exact
record from this citation alone? Nine source-fidelity rules constrain
every write, and the one that changes behavior most is the
unknown-marker rule: a missing locator gets `[LOCATOR NOT RECORDED]`
written into the field *and then* the user is asked to check the image —
asking without writing the marker is not an acceptable output. URLs are
never citations, everything after the first `?` is stripped as the user's
own search input, and ARKs are opaque — nothing may be inferred from them.
A nil search is formatted from the log entry's `query` field and
**presented without persisting**.

### check-warnings

The genealogical-impossibility guardrail — impossible lifespans, events
after death, a child born after a parent died — via `person_warnings`
(offline and deterministic) plus `person_quality` when the id is a real
FamilySearch ID, silently skipped for synthetic `I` ids. Its pre-step
routing guard matters: a *disagreement between two sources* is a conflict,
not a warning, and gets handed to `conflict-resolution` silently as the
first and only action. It counts before it reports — two or more errors on
one person opens with a cluster verdict ("two people merged into one
profile") rather than a list of independent findings. `person-evidence`,
`record-extraction`, and `tree-edit` all hand off here after writing.

### tree-edit

Ad-hoc tree corrections and confirmed person merges, split by op
authority: **additions** (`add_fact`, `add_person`, `add_relationship`,
`add_source`) go through `tree_edit`, **corrections and removals**
(`update_*`, `remove`) through `tree_correct`. It should be rare — the
normal path for tree state is record-extraction → person-evidence →
proof-conclusion, and this skill exists for genuine corrections, not for
bypassing GPS. Two shape rules cause most errors: couple-event facts
(Marriage, Divorce) belong on the `Couple` relationship's `facts` array,
not as a person fact; and `remove` never removes a person. Merges happen
only after `proof-conclusion` confirms identity, and `merge_tree_persons`
repoints every `research.json` reference to the collapsed id. An
anti-fabrication rule runs throughout: actually call the tool, and narrate
only from the returned `ok: true` summary.

### translation

Genealogy-specific translation and paleography for German, French,
Spanish, Italian, Dutch, Latin, and Portuguese — Kurrentschrift and
Sütterlin, Latin parish-register abbreviations, period record structures.
`record-extraction` hands off here when script or language blocks parsing.
Its governing principle is that **a translation is a derivative source**:
the original is always preserved, and where they conflict the original
governs — so extraction cites the record, not the translation. It works on
text or an image already in the conversation and cannot open URLs. Record
structure is used as a decipherment constraint, since formulaic language
narrows what an illegible word can be.

### historical-context

Explains boundary changes, naming conventions, migration patterns, and
period vocabulary; writes nothing. Its routing check runs before any file
read or tool call, and the sharpest line is that even a one-word gloss of
a non-English term ("getauft = baptized") is *translation* and must not be
answered here — only English historical vocabulary (relict, yeoman)
belongs to it. It calls `wiki_search`/`wiki_read`, `wikipedia_search`,
`place_search_all` when jurisdictions changed across the period, and
`place_population` when community size bears on record-keeping. It must
keep tool-verified facts distinct in register from training knowledge: if
a call returns nothing, narrow the answer or flag the gap rather than
smoothly filling it in. It presents possibilities, not conclusions, and
hands formal resolution to `conflict-resolution`.

### convert-dates

Calendar conversion — Julian/Gregorian, Old Style/New Style year starts,
Quaker numbered months, double-dated years. The model owns the judgment
(which calendar regime was in force in which jurisdiction and era) and
`convert_calendar` does only the arithmetic; on `{ ok: false }` it surfaces
the error and never falls back to hand arithmetic. Its useful heuristic
travels to other skills: a discrepancy of exactly 10–13 days, or exactly
one year for a January–March date, is a calendar difference rather than a
conflict — which is why `conflict-resolution` and `historical-context` both
route here before treating such a gap as disagreement.

---

## Part 3 — standalone utilities

### project-status

The resume-a-project front door and the cross-session continuity layer:
it reads both files, checks foreign-key integrity and stale plans,
computes a sixteen-row metric table, assesses exhaustiveness and
conclusion readiness, and walks a ten-branch decision tree to recommend
the next step. It writes nothing and calls no MCP tools. It always
produces **two** summaries — plain-language first, then the detailed GPS
state — and it must not assume the user remembers the last session.

### validate-schema

A read-only relay over `validate_research_schema`: it surfaces each error
with the object, field, and value, explains it plainly, and proposes a
concrete fix that won't create a new error — but it never applies the fix
and doesn't offer to. It sits explicitly **outside** the `/research` loop:
because every writer tool validates the whole project before persisting,
`/research` §4 forbids defensive validate passes between steps. Reach for
it only when a hand-edit or an external change touched the files outside
the writer tools.

### search-familysearch-wiki

Searches the FamilySearch Research Wiki and saves a markdown file in the
working folder. Its trigger is broader than its name: **any** "how do I
find [record type]" question routes here even when FamilySearch isn't
named, and it must never answer such a question from training knowledge —
always call `wiki_search` first, even when the answer feels obvious.
Synthesis is constrained to the returned `chunk_text`: every sentence
traceable to a chunk, no added dates or repositories, no invented
navigation paths. Empty results mean tell the user and write no file.

### search-wikipedia

The canonical minimal example of the full plugin pipeline — call one MCP
tool, populate a template, write a file — and the structure to copy when
wiring a new skill. It fills `{{title}}`, `{{extract}}`, `{{url}}`
verbatim, with no paraphrasing or truncation of the extract. Don't mutate
it; create a new skill folder instead.

### forget-and-rederive

Sets up a practice run by stripping known information from the tree so it
must be re-derived from records — the only skill without a `model:` pin,
and the only one that writes `tree.gedcomx.json` through a Python script
(`scripts/forget.py`) rather than a writer tool. Both halves are required:
strip locally, **and don't look it back up** — live FamilySearch still
holds the answer, so `person_read`, `person_search`, `person_ancestors`,
and the person-match tools are off-limits for the affected people for the
rest of the project. Reading *records about* those people is the entire
point; reading the FS *tree* is the one forbidden move. Always dry-run
first, because removing a person cascades to every relationship touching
them, and report only the script's redacted counts — never the removed
values. Two cautions for repeat use: forgetting is **additive**, and the
`.tree-before-forget.gedcomx.json` restore file is **overwritten on every
non-dry-run invocation**, so a second forget destroys the pristine restore
point.
