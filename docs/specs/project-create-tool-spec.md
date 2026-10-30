# `project_create` tool spec

**Status:** implemented.

Creates a research project: writes `research.json` and `tree.gedcomx.json`
together, validated against each other, in one atomic write. It is the **only**
way a project comes into existence.

## 1. Why it exists

`init-project` held no writer tool. It built both documents from
`templates/research.json` with a bare `Write`, and the shipped `PreToolUse` hook
denies `Write` on either filename **by basename, with no exemption for a file
that does not exist yet**. So wherever the lockdown binds — Cowork, the hosted
path — the one skill whose entire job is creating a project could not create one.

Confirmed live in Cowork, empty folder, *"Start a new research
project for FamilySearch person KWCJ-RN4"* (a device-bridge session — the write
landed through `device_bash` on the host, per step 3; run mode is not visible
from inside a session, so it is not labelled here):

1. `Write` on both files → denied.
2. `tree_edit` → refused; the writer tools require the files to already exist.
3. The agent wrote both documents through `device_bash` on the host — **and the
   write landed.**

The missing creation path is therefore the *motive* for a guardrail bypass, not
merely an ergonomic gap. Nothing caught it: the unit harness grants `Write` to
every skill and carries no lockdown, and every e2e fixture starts from an
existing `starting-research.json`, so `init-project` is never exercised there.

## 2. Why a narrow tool, and not auto-seeding the writers

The alternative considered at length was seeding inside the existing writers —
create the files on any first write. It was rejected, and the reason is a
property, not a preference:

> **Auto-seeding lets any skill holding a writer bring a project into being, and
> the project it brings into being has an empty objective.**

That state is a dead end. `init-project`'s guard clause stops on "`research.json`
already exists", so it refuses to touch it. `research/SKILL.md` *activates*,
because it excludes itself only when the file is absent — but its routing table
has no row for an objective-less project. And no tool could set the objective.
The only recovery is deleting the file the change existed to preserve. ADR-0011's
second limit and the enforcement programme's one hard constraint both say the
same thing: a deny must leave a working alternative.

`project_create` has **exactly one caller by design**, so that state cannot
arise. A project exists only when someone asked for one, and it is complete from
its first byte — which is what lets every routing predicate in the plugin stay
keyed on file existence, unchanged.

The usual objection to a separate tool — *"every caller has to remember to call
it"* — is about seeding for standalone work, where callers are many. Here there
is one.

## 3. Why it takes the tree

`subject_person_ids` naming a person absent from `tree.gedcomx.json` is a **hard
validator error**, and `research_append` validates both documents before
persisting. A header-only create followed by separate tree writes therefore
carries an ordering constraint — tree first, always — that the caller has to get
right on every invocation.

Taking both in one call removes it. The pair is validated against each other in
one pass, written atomically, and there is no window in which the project is
inconsistent.

**A FamilySearch person is read here, not by the caller.** Re-typing a
`person_read` into `tree` cost about 51 KB of model output on a 15-person
pedigree, and on a 12-person read with 104 relationships the model spent its
whole 32,000-token output cap rewriting the tree in thinking and never made the
call (alpha feedback, 2026-09-29). Passing a staged read's ref instead failed on
any read over the client's result limit: the model saw a truncated preview, lost
the ref, and spent 16–28 minutes guessing paths before hand-typing a stub tree
(hosted feedback, 2026-10-05 to 10-18). Given `personId`, this tool reads the
person through `readPerson` (`person-read-tool-spec.md`), the code behind
`person_read`, and the read never passes through the model. The build is
`src/utils/person-read-tree.ts` (§4).

**Accepted cost:** the model no longer reviews the read field by field before it
is written. An observed agent once caught FamilySearch auto-standardizing a
"Central States" mission to *"Central, Morocco"* and dropped it; that review is
gone, and nothing replaces it for that case: a standardized name FamilySearch
itself returns (`place.normalized`) is kept as given. The country guard
(`countryConsistency`) checks only places the resolver fills, in `person_read`
and in this build's place retry.

## 4. Contract

| Input | Required | Notes |
|---|---|---|
| `projectPath` | yes | Absolute path to the project directory |
| `objective` | yes | Non-empty after trimming. Stored trimmed. With `personId`, each mention of the subject by FamilySearch ID is stored as the subject's name ("Naming the subject" below) |
| `title` | no | Omitted from the document when absent, never written empty. Named as `objective` is |
| `personId` | no | A FamilySearch person ID, trimmed. When set, this tool reads the person (needs a FamilySearch login) and builds the starting tree from the read; `tree` is refused beside it |
| `subjectPersonIds` | no | With `personId`: FamilySearch PIDs from the read (the requested id of a merged person included), mapped to tree ids; defaults to the person read. Without: local tree ids that must exist in `tree`; defaults to `[]` |
| `tree` | no | Only without `personId`: the whole starting tree, simplified GedcomX. Defaults to `{persons: [], relationships: [], sources: []}` |
| `personReadRef` | — | Removed. Refused by name, so a caller built against the old contract is told to pass `personId` rather than falling into the hand-built path |

**Reading the person.** Every refusal that needs no network (below) runs first,
so a refused call never spends the read, and a create aimed at an existing project
never reads anyone. The read is `readPerson(personId, { projectPath, deadline },
principal)`: the tree read, the subject first, the relatives' and the edges'
sources, and the subject's memories with their transcription, exactly as
`person_read` returns them, plus each memory's kind (`story` or `document`), which
`person_read`'s own response does not carry. The principal is the call's, as for
every FamilySearch tool. An error from the read (no login, a person FamilySearch
does not hold) is returned as the create's refusal, and nothing is written.

**Time.** One call stays under the Cowork device bridge's 60 s abort on the
typical path: the read gets `OCR_PHASE_BUDGET_MS` (40 s) from the call's start,
and the place retry gets what `CALL_BUDGET_MS` (55 s) leaves, at most
`PLACE_RETRY_BUDGET_MS` (20 s) and never below zero. Three legs of the read are
not bounded by that clock: the subject's own fetch (bounded by its 30 s timeout,
which the 40 s budget already covers at the start), the memories and portrait
fetches (cutting them short would drop the memories with no note, so they keep
their own timeout), and the converter's place standardization, which is capped by
count, not time.

**Building from the read** (`buildFromStagedRead`):

- **Persons** get `I` ids, the subject first (so it is `I1`), then the read's
  order; each keeps `living` and carries `ark: "ark:/61903/4:1:<PID>"`. Names
  and facts get fresh `N`/`F` ids (FamilySearch's own UUIDs are not kept).
- **Sources:** `S1` is one FamilySearch-tree source, deterministic: title
  `FamilySearch Family Tree (read from <Given Surname>, <PID>)`, citation
  `FamilySearch Family Tree (https://www.familysearch.org/tree : accessed <date>),
  read from the page of <Given Surname> (<PID>).`, and `url` the Tree itself.
  It is cited on every person's facts, relatives included, so it names the Tree
  and the page the read came from, never one person as the subject of a fact: a
  relative's fact citing the subject's page would send a reader to the wrong
  person. The read's own
  sources follow as `S2…`, keeping only `id/title/citation/author/url`: `notes`,
  `text`, `image_ref` and `artifact_url` are response-only and dropped. The
  read's top-level `notes` is dropped too.
- **References:** every person fact, relationship, and relationship fact gets
  `{ref: "S1", quality: 1}` (compiled, unverified tree data); person-level and
  relationship-level `sources` refs are re-pointed at their `S` ids.
- **Relationships** get `R` ids, with every endpoint rewritten to `I` ids.
- **Places** a fact from the read carries with no `standard_place` go through
  the same resolver `person_read` uses, once more (`standardizePlaces`): the
  read leaves a place unresolved after a transient failure or past its
  100-place soft cap, both of which a retry can recover. Anonymous, and a no-op
  when every fact has one. Bounded by what the call budget leaves (Time, above),
  and run on copies, so an answer that arrives after the budget never reaches a
  tree that is already being written. A place nothing resolves keeps `place`
  alone. The build does not run it: `project_create` runs it after every refusal below
  and after validation, just before the write, so a refused call never waits on
  the network. It only adds a `standard_place` string, which validation admits.

**People the researcher names beside a read.** `tree` is refused beside
`personId`. The caller never sees the read, so it cannot tell whether a person
the researcher names (the parent a stated maiden name implies, say) is already in
it, and a stub it wrote blind could duplicate a relative straight into the
opening baseline. Such a person is added after the create, with `tree_edit`, by
init-project, and only when the person is not already there (lead ruling,
2026-10-20): for a parent, a filled slot (the summary's `father` / `mother` /
`parent`, or a relative's parents in `project_context`) means no stub even when
the name differs; for a spouse, child or sibling, a match is the same first given
name within that relationship, whatever the surname. When no stub is added the
researcher's statement is reported and not recorded.
A stub is linked by the relative's tree id, and its edge is cited to a
"Researcher's statement" source. A wrong stub can be undone only by
`merge_tree_persons` into the right person; `tree_correct` cannot remove one.

**The 2026-09-29 rule is retired.** That ruling merged stubs into the create so
they sat in `starting-tree.gedcomx.json` from the start. It was retired by lead
ruling 2026-10-20, and the cost is accepted: a stub added after the create is
absent from that baseline, so `treeEncodingCompletionWarnings` counts it, and the
relative it links to, as structure gained this session (`tree-diff.ts`,
`personsWithNewStructure`), and that warning cannot fire for them. A `subjectPersonIds` PID is matched trimmed and case-insensitively, and the
requested id of a merged person names the same person.

**Without `personId`** (the objective-only build) the caller's ids are
kept, since it names `subjectPersonIds` and later `relates_to_person_ids` by
them. Only an absent id is minted (any other value is left for validation),
skipping every id the tree defines **or references** (relationship endpoints,
source refs, `subjectPersonIds`), so a minted id never turns a dangling
reference into a valid one. Anything with no source is cited to the
researcher's statement as above, unless a staged read holds it, when it is cited
to a generic FamilySearch-tree source recorded as `idMap.familySearchTreeSource`.
A `tree` that is not an object is refused.

**Citing what a staged read holds.** A hand-built tree is often a
retyping of a `person_read` (an agent that typed the read out by hand), and
citing every unsourced fact on it to the researcher's statement credits the
researcher with FamilySearch's claims. So a hand-entered fact or relationship with
no source of its own is checked against every `person_read` staged in this project and inside the 24h
TTL (`listStagedEnvelopes`):

- **A fact** on a person whose `ark` names a FamilySearch person
  (`treePidOfArk`) is cited to the Family Tree only if a staged read holds that
  person **and** a fact on them with the same `type`, `date` (the read's `date`
  or `standard_date`), `place` (`place` or `standard_place`) and `value`, each
  compared trimmed, case-folded and with spaces collapsed; an absent field
  matches only an absent one. A `standard_date` the caller supplied must equal
  the read's own `standard_date`: this tool keeps a hand-entered one as given,
  so a value the read does not hold would otherwise be written under
  FamilySearch's name. The fact's own `standard_place`, which this tool clears
  and re-resolves, never takes part.
- **A relationship** whose two endpoints both carry such an `ark` is cited to the
  Family Tree only if a staged read holds one that `relationshipMatches` it (same
  type and endpoints, a Couple in either order) **and**, when the hand-entered
  edge carries a subtype, the read's edge carries the same one. An untyped
  hand-entered edge is a less specific statement of a typed one in the read and
  matches it; a `Step` edge against an untyped one in the read claims more than
  FamilySearch said and does not. Its own unsourced facts are then checked, as
  above, against that relationship's facts in the read.
- **Everything else** is the researcher's statement. A retyped fact whose date
  was reworded fails to match and gets the statement: an under-claim, never an
  over-claim. A person matching the read by a merged person's requested id is the
  same person (the read's `query.personId` is an alias of its subject).

The generic source is `{title: "FamilySearch Family Tree", citation:
"FamilySearch Family Tree (https://www.familysearch.org/tree : accessed <date>).",
url}`; it names no page, since each person's `ark` is the page. When anything was
cited to it, `validation.warnings` says how many facts and relationships, so the
caller can see the inference. The staging folder is listed only when a
hand-entered person carries a FamilySearch `ark`; a hand-built tree with none
(the objective-only build) never touches it. A staged file already past the TTL
by its write time is never opened.

**Hand-entered places** — every fact on the objective-only build — are the
tool's to standardize, never the caller's. Every such fact, on a person or a relationship, has any
caller-supplied `standard_place` cleared, including a fact with no `place`. Each
one with a `place` is then resolved with the same resolver `person_read` and
`tree_edit` use, after every refusal and validation, in the same call and budget
as the read's retry. A person or fact entry that is not an object is skipped
here and left for validation to refuse at its own index. A resolved value is
reported in `placesFilled`. A caller-supplied value that the resolver replaced or
could not confirm, or that sat on a fact with no `place`, is named in
`validation.warnings`; one that did not resolve — no match, a failed lookup, or
the budget running out — is left unset, never kept. The writers' rule for a
supplied value (tree-edit-tool-spec §4.1.1) does not apply here: no production
caller supplies one (`init-project` never passes `tree`).

**A place left unstandardized is reported, never silent.** Once the fill has
run, every fact in the tree that still has a `place` and no `standard_place` —
a read place the retry could not fill, or a hand-entered one that did not
resolve — is listed in `unresolvedPlaces: string[]`, once each in the spelling
first met and keyed as `placesFilled` is, and named in one
`validation.warnings` line, `Places kept as written, with no standard place
found: …`. A non-place phrase such as "Same House" (`isNonPlacePhrase`) has no
standard form to miss and is left out. Both are absent when every place was
standardized.

**The result, with `personId`,** is a summary, never the tree, held under
`SUMMARY_MAX_CHARS` (2,000 serialized characters): `subject` (`id`,
`familySearchId`, `name`, and `birth` / `death` as "date, place" when the read
has them), `objective` and `title` as stored, `relatives` (each other person's `id`, `name`, and `relationship` to
the subject — `spouse`; `father` / `mother` for a parent recorded Male / Female,
`parent` when the sex is unknown; `child`, `sibling`, or `relative`), `counts` (`persons`,
`relationships`, `sources`, `memorySources`), `memories` (the titles of the
subject's memories that were and were not transcribed), the read's own `notes`,
and `validation.warnings`. Over the cap, whole entries are dropped, the last
first, in this order: `warnings`, `notes`, the untranscribed titles, the
transcribed titles, then relatives, and among relatives only a child, sibling or
other relative. A parent or a spouse is never dropped, since those are the slots
a caller checks before adding anyone, so a pathological family can leave the
summary over the cap. `omitted` counts each list's loss; an entry is never cut,
and every person stays findable afterwards in the project tree.
`idMap` is not returned: its `sources` map runs to hundreds of entries on a
well-sourced profile, and a caller names people by the summary's tree ids.

**The result, without `personId`,** carries `idMap`: `persons` (empty),
`sources` (empty), `familySearchTreeSource` (the generic
source, when something was cited to it — "Citing what a staged read holds"),
and `statementSource` when one was created. It also carries `placesFilled`,
`[{place, standardPlace}]`, for each place this create standardized (absent when
none). One resolution is listed once, in the spelling first met, however else
the same place was written (trimmed, case-folded, spaces collapsed), so the
caller can tell the researcher which places it standardized without being asked.

**Naming the subject.** A caller that has only the FamilySearch ID writes the
objective and title before the read, so it can name the subject only by that ID.
With `personId`, each mention of the requested ID or the read's resolved ID —
bare, or as `FamilySearch ID <id>`, `person ID <id>` or `ID <id>`, matched
case-insensitively as a whole token — is replaced by the subject's name as the
read gives it ("Identify the parents of LZNY-BRF" is stored as "Identify the
parents of Patrick Flynn"). A mention inside parentheses, such as
"Patrick Flynn (LZNY-BRF)", is an annotation beside a name the researcher wrote
and is kept, and nothing is replaced when the read gives no name. A name is not
a research direction, so this keeps the objective in the researcher's words; the
generic default objective names no one and is never changed. The summary returns
both as stored, so the caller reports what was written.

**What it writes.** `project` with `id: "rp_001"`, the objective, optional title,
`subject_person_ids`, `status: "active"`, and `created`/`updated` stamped with
today's ISO date; every analytical section as an empty array, `sources` aside;
the tree; and the house researcher profile.

- **`researcher_profile`** is `HOUSE_RESEARCHER_PROFILE`, the same on every
  project: `experience_level: "novice"` and one house-style `narration_guidance`
  string, whose source of truth is that engine constant. It is a default, not a
  claim about the researcher: nothing is asked, a stated level is not
  persisted, and it carries no `subscriptions`.
- **`sources`**, with `personId`: one entry `src_NNN` for each of the subject's
  memories that came back with `text`. A memory with no `text` gets none: an
  entry would assert it was examined, and it is already in the tree with its
  title and URL. Each entry carries `gedcomx_source_description_id` (the memory's
  tree `S` id); a `citation` (`"<title>," story|digital image, FamilySearch
  Memories (<url> : accessed <date>), memory <id>, uploaded to the profile of
  <subject> (<PID>).`); `citation_detail` with `where` "FamilySearch Memories",
  `where_within` "memory <id>", today's `when_accessed`, and, for what the
  memory's metadata cannot supply, the citation agent's bracketed unknown-markers
  (`MEMORY_DETAIL_UNKNOWN`: `[CREATOR NOT RECORDED]`, `[DOCUMENT TYPE NOT
  RECORDED]`, `[DATE NOT RECORDED]`), which that agent reads as gaps to fill;
  `repository` "FamilySearch Memories"; `access_date`; `url`; the `text` verbatim
  as `transcription`; the retained scan as `image_filename`; and
  `transcription_truncated: true` when the OCR read of that scan hit the cap
  (`sourceImageCapState`, derived exactly as `research_append` derives it, never
  asserted).
- **The classification is a stated default.** `source_classification` is
  `authored` for a story and `original` for a scanned document
  (`memoryClassification`), and every memory source's `notes` says so: "Classified
  <value> from the memory's type … its text was not examined. A transcription or
  abstract of another record is derivative." The text is not read here, nothing
  downstream re-classifies a source (`agents/citation.md` leaves the field
  alone), and the conflict and proof steps read the entry, so the note travels
  with it.

**What it deliberately does not write:** the profile's `subscriptions`. They
come from what the researcher actually said, and are written afterwards through
`research_append`.

**Refusals**, each leaving the directory exactly as it was:

| Condition | Reason |
|---|---|
| Either file already exists | Create, never upsert. Overwriting destroys an audit trail that cannot be reconstructed, and a caller wanting to add to a project already has the writer tools |
| An ancestor of `projectPath` already holds `research.json` | The Electron viewer watches one folder; a project created one level down inside another reads to a tester as lost files between sessions. Names the ancestor and points at `research_append` as the way to add to it instead. Checked AFTER the exists-refusals above, so a half-present project at `projectPath` itself keeps its own, more actionable message even when its own parent also holds a project |
| `objective` absent, empty, or whitespace | A project is the pursuit of a stated question, and every later step plans against it |
| The pair fails validation | Including a `subjectPersonIds` entry the tree does not contain |
| `projectPath` absent | — |
| `personReadRef` passed, in any form | Removed; refused by name, telling the caller to pass `personId`. Over MCP `server.ts`'s unknown-argument guard sends this message before the handler runs (`PERSON_READ_REF_REMOVED`, `src/utils/tool-hint-messages.ts`); a direct call gets it from the handler. A caller built against the old contract would otherwise fall into the hand-built path with a FamilySearch PID as its subject |
| `personId` present but not a non-empty string | — |
| `tree` with any entry beside `personId` | "People the researcher names beside a read" above |
| The read fails (no login, a person FamilySearch does not hold, the read holds no person with the requested id) | The read's own message, which names the remedy (log in; check the ID) |
| A `subjectPersonIds` entry, with `personId`, that names no person in the read | The tree's `I` ids are assigned here, so a caller names the read's people by FamilySearch PID |
| A `tree` collection that is present but not an array of objects | Read as empty it would be dropped, and a dropped citation would silently re-cite the fact to the researcher's statement. A non-object entry and a citation in the wrong shape are left in place for validation to refuse at their own index; only an absent or empty `sources` is cited to the researcher's statement |
| `research.json` or `tree.gedcomx.json` appears while the place fill runs | Checked again after the fill, which can take seconds: another create finished first, and create never overwrites |
| An `assertion_id` on any fact | Stamped only by `materialize_facts`; a seeding tree has no assertions to point at |

**Ordering.** The pair is validated **before** either file is written, so a
rejected create leaves nothing behind. This is load-bearing and tested by moving
the write ahead of the validation and watching two cases go red.

## 5. What this does not solve

- **A picked folder with nothing above it, where the agent creates the project
  one level down anyway.** The ancestor rule in §4 is filesystem-derived: it
  can only see a divergence where an ancestor already holds `research.json`.
  It cannot see the other half of the same divergence — the case
  `formatNestedPicker` (`apps/electron/src/main/watcher.ts`) was shipped for,
  where the folder the user picked in the viewer holds nothing yet, and
  the agent creates the project in a subfolder of it regardless. Nothing
  filesystem-derived can distinguish that subfolder from a legitimate new
  project one level down inside a folder that happens to hold other files —
  there is no ancestor to refuse against. This takes ADR-0011's row 5 (tool
  description: needed at the moment of the call, no predicate can enforce
  it): the `projectPath` description in §4 states the rule directly ("create
  the project in the folder you were given — never in a subfolder of it").
  Chosen over a second card so both halves of one divergence ship together
  (lead, 2026-08-31) — the alternative left the case live while a second
  card waited its own review cycle, for one sentence with no file added to
  the blast radius and no run log invalidated. **Accepted cost:** ADR-0011
  already records tool-description strength as unmeasured, and this adds no
  new measurement — there is no instrument for "did the model read and obey
  this sentence," only for the filesystem-derived half in §4, which the unit
  tests in §6 cover.
- **Standalone work in an unseeded folder still loses data.** A
  `research_log_append` into a directory with no project still fails. That is the
  ergonomics half of the original report, and it is deliberately not addressed
  here — addressing it is what pulled in the dead-end state above.
- **A timeline from a person with no project** still does not work: `timeline`
  builds events from `person_evidence` and `assertions`, never from the tree, and
  holds no `person_read`. A freshly created project yields an empty timeline.
- **Nothing in CI verifies the skill half.** The unit harness grants `Write` to
  every skill and has no lockdown; every e2e fixture starts from an existing
  project. The check is the live Cowork repro in §1 — `make cowork-install`
  (**not** `make plugin`: `project_create` ships in the `.mcpb` and the rewritten
  skill body in the plugin zip, so installing one of the two leaves the skill
  calling a tool that is not there), reinstall both,
  fully restart Claude Desktop, ask for a new project in an empty folder — and it
  must reach a created project rather than a `device_bash` write. The mechanical
  half that *can* run is the write-path validator in
  `eval/harness/validators/test_init_project.py`, which asserts the skill called
  the writer tools rather than producing the right bytes by any route.

## 6. Enforcement

> `packages/engine/mcp-server/tests/tools/project-create.test.ts` — the refusals,
> the atomic no-write-on-failure property, the house profile on every create;
> with `personId` (an injected reader serving
> `person-read-flynn-family.json`: a merged-person redirect, a memory with
> `text`/`image_ref`/`artifact_url`, a top-level `notes`): the tree against a
> committed literal, the memory source exactly, the summary and its 2,000-character
> cap on a 63-relative read, a parent labelled `father` / `mother` / `parent` by
> recorded sex, a parent and a spouse never trimmed, a scanned memory classified `original` with its note,
> `transcription_truncated` derived and not otherwise written, the place retry
> given no time once the read spent the budget, `personReadRef` refused by name,
> and every network-free refusal (an existing project, no objective, `tree` beside
> `personId`, a blank `personId`) made before the reader is called; the
> objective-only build's sourcing; and the Family Tree citations on evidence (a
> copied fact, a researcher fact, a held and an unheld relationship, a subtype
> only in the direction the read supports, a supplied `standard_date` the read
> does not hold, a reworded marriage date, a merged person's ark, nothing staged,
> a staged read past the TTL by write time never opened, and that a build with no
> ark never lists staging).

> `packages/engine/mcp-server/tests/tools/person-read.test.ts` — `readPerson`
> behind `person_read`; a merged parent's redirect is not followed once the read's
> clock has run out.

> `eval/harness/tests/unit/test_mock_project_create_person_id.py` — the eval mock
> serves `personId` from the test's `person_read` fixture through the compiled
> `runProjectCreate`, records the read as `served_read`, fails an id with no
> fixture, and classifies memories by its documented rule.

> `packages/engine/mcp-server/tests/utils/person-read-tree.test.ts` — the place
> retry, its no-op when nothing needs it, that a refusal never waits on it, that
> it touches only the read's facts, and the access-date form.

> `eval/harness/tests/unit/test_init_project_provenance_validators.py` — the
> compiled build's tree passes the init-project validators written to grade the
> model (ark, standard place, standard date, sourcing, source fields); and V3's
> host-fill exemption keyed on the fact's owner, so one person's unresolved
> fact cannot excuse an invented value on another's.

> `packages/engine/mcp-server/tests/utils/project-io.test.ts` —
> `findNestingAncestor`'s predicate: no ancestor, an ancestor one level up, an
> ancestor several levels up returning the nearest one, `projectPath` not yet
> existing, the walk terminating at the filesystem root, and the candidate's
> own `research.json` not counting as its own ancestor (the walk starts at
> `projectPath`'s *parent*, never `projectPath` itself).

> `packages/engine/mcp-server/tests/packaging/manifest.test.ts` and
> `catalog.test.ts` — the tool is registered, dispatched, listed in the
> install contract, and discoverable.

*Linted: every path in this section must resolve.*
