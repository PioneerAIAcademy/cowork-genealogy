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

**The tree from a FamilySearch person is built here, not by the caller.**
Re-typing a `person_read` into `tree` cost about 51 KB of model output on a
15-person pedigree, and on a 12-person read with 104 relationships the model
spent its whole 32,000-token output cap rewriting the tree in thinking and never
made the call (alpha feedback, 2026-09-29). `person_read` stages the read on the
host (`person-read-tool-spec.md`, "Staging the read"), and `personReadRef` names
it; the build is `src/utils/person-read-tree.ts` (§4).

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
| `objective` | yes | Non-empty after trimming. Stored trimmed |
| `title` | no | Omitted from the document when absent, never written empty |
| `personReadRef` | no | The `staged.resultsRef` `person_read` returned. When set, the starting tree is built from that staged read, and `tree` holds only additions |
| `subjectPersonIds` | no | With `personReadRef`: FamilySearch PIDs from the read (the requested id of a merged person included) or addition labels, mapped to tree ids; defaults to the person read. Without: local tree ids that must exist in `tree`; defaults to `[]` |
| `tree` | no | With `personReadRef`: ADDITIONS (stub persons and their relationships). Without: the whole starting tree, simplified GedcomX. Defaults to `{persons: [], relationships: [], sources: []}` |

**Building from `personReadRef`** (`buildFromStagedRead`):

- **Persons** get `I` ids, the subject first (so it is `I1`), then the read's
  order; each keeps `living` and carries `ark: "ark:/61903/4:1:<PID>"`. Names
  and facts get fresh `N`/`F` ids (FamilySearch's own UUIDs are not kept).
- **Sources:** `S1` is one FamilySearch-tree source, deterministic — title
  `FamilySearch Family Tree: <Given Surname> (<PID>)`, an Evidence Explained
  citation with the access date, and the person's tree URL. The read's own
  sources follow as `S2…`, keeping only `id/title/citation/author/url`: `notes`,
  `text`, `image_ref` and `artifact_url` are response-only and dropped. The
  read's top-level `notes` is dropped too.
- **References:** every person fact, relationship, and relationship fact gets
  `{ref: "S1", quality: 1}` (compiled, unverified tree data); person-level
  `sources` refs are re-pointed at their `S` ids.
- **Relationships** get `R` ids, with every endpoint rewritten to `I` ids.
- **Places** a fact from the read carries with no `standard_place` go through
  the same resolver `person_read` uses, once more (`standardizePlaces`): the
  read leaves a place unresolved after a transient failure or past its
  100-place soft cap, both of which a retry can recover. Anonymous, and a no-op
  when every fact has one. Bounded at 20s (the Cowork bridge aborts any call at
  60s), and run on copies, so an answer that arrives after the budget never
  reaches a tree that is already being written. A place nothing resolves keeps
  `place` alone. An addition's place is the caller's to resolve (`place_search`).
  The build does not run it: `project_create` runs it after every refusal below
  and after validation, just before the write, so a refused call never waits on
  the network. It only adds a `standard_place` string, which validation admits.

**Additions, and the PID rule.** In ref mode the caller cannot see the ids the
build assigns, so every id in `tree` is a **label**: re-minted after the staged
ids, with the label → id map returned. A relationship endpoint or a
`subjectPersonIds` entry must name a staged person **by FamilySearch PID** or an
addition by its label. A PID is matched trimmed and case-insensitively in every
one of these checks, and an addition's `ark` names a tree person when it is a
`4:1:` ark (`ark:/61903/4:1:<PID>`, in a resolver URL or bare, each `%XX`
decoded) or a familysearch.org tree person or pedigree URL, the PID taken from
whichever path segment holds one; neither form is ever read from a query string (a record or image ark,
or another site's URL, names none). An addition source keeps the fields it was given, so a field the tree
does not allow is refused by validation rather than dropped. Name-level `sources` on an addition are re-pointed exactly as its fact
sources are. Anything
else is refused: an `I2` the caller wrote would
otherwise land on whichever staged person got `I2`, and no validator can tell
because that person exists. An addition's fact or relationship with no source of
its own is cited `{ref, quality: 1}` to one "Researcher's statement" source,
created only when needed. Additions are merged **before** validation and the
single atomic write, so a stub is in `starting-tree.gedcomx.json` from the
start: a person added afterwards with `tree_edit` would be absent from that
baseline, and `research_append`'s starting-tree gates would treat it as minted
this session (lead ruling, 2026-09-29).

**Without `personReadRef`** (the objective-only build) the caller's ids are
kept, since it names `subjectPersonIds` and later `relates_to_person_ids` by
them. Only an absent id is minted (any other value is left for validation),
skipping every id the tree defines **or references** (relationship endpoints,
source refs, `subjectPersonIds`), so a minted id never turns a dangling
reference into a valid one. Anything with no source is cited to the
researcher's statement as above. A `tree` that is not an object is refused.

**The result** carries `idMap`: `persons` (FamilySearch PID → `I` id),
`sources` (FamilySearch source id → `S` id), `additions` (label → `I` id),
`familySearchTreeSource`, and `statementSource` when one was created.
`personReadRef` is trimmed before it is resolved. In ref mode a refusal raised
after the build (a forged `assertion_id`, a validation error) names which minted
id and `persons[i]` index each addition label became, since no `idMap` comes
back with a refusal. A relationship is described by its type and endpoints. A later
step that writes `research.json` names tree ids from it.

The staged file is not consumed; the 24h TTL prune removes it.

**What it writes.** `project` with `id: "rp_001"`, the objective, optional title,
`subject_person_ids`, `status: "active"`, and `created`/`updated` stamped with
today's ISO date; every analytical section as an empty array; and the supplied
tree.

**What it deliberately does not write:** `researcher_profile` and
`known_holdings`. Both are written afterwards through `research_append`, from
what the researcher actually said. An agent must never invent a profile — a
project was observed created with an experience level and subscriptions the user
was never asked for, and a fabricated profile is indistinguishable downstream
from a real one, while an absent one has a working fallback in every skill.

**Refusals**, each leaving the directory exactly as it was:

| Condition | Reason |
|---|---|
| Either file already exists | Create, never upsert. Overwriting destroys an audit trail that cannot be reconstructed, and a caller wanting to add to a project already has the writer tools |
| An ancestor of `projectPath` already holds `research.json` | The Electron viewer watches one folder; a project created one level down inside another reads to a tester as lost files between sessions. Names the ancestor and points at `research_append` as the way to add to it instead. Checked AFTER the exists-refusals above, so a half-present project at `projectPath` itself keeps its own, more actionable message even when its own parent also holds a project |
| `objective` absent, empty, or whitespace | A project is the pursuit of a stated question, and every later step plans against it |
| The pair fails validation | Including a `subjectPersonIds` entry the tree does not contain |
| `projectPath` absent | — |
| `personReadRef` blank, missing, outside `results/.staging/`, or not staged by `person_read` | Checked after the exists and nesting refusals. Worded for this tool (the staging helper's own messages speak of `research_log_append`), and every one says to call `person_read` again with `projectPath` |
| An addition endpoint or `subjectPersonIds` entry that is neither a staged PID nor an addition label | See "Additions, and the PID rule" above |
| An addition person whose id is a staged PID, or whose `ark` names someone in the read | Additions are new people; a staged person is linked to, not re-added. No validator rejects two persons with one ark, so a copied read would otherwise double silently. An ark for someone the read does not hold (a second `person_read`) is kept |
| The same addition person or source label used twice | The references would bind to only one of them |
| An addition source whose id is one of the read's FamilySearch source ids | A ref to it would be ambiguous between the two; cite the read's source by that id instead |
| An addition ref naming neither an addition source nor one of the read's sources | Same collision as an id |
| A `tree` collection, or an addition's `names`, `facts` or `sources`, that is present but not an array of objects | Read as empty it would be dropped, and a dropped citation would silently re-cite the fact to the researcher's statement. Applies without `personReadRef` too, for the three top-level collections. Without a ref, a non-object entry and a citation in the wrong shape are left in place for validation to refuse at their own index; only an absent or empty `sources` is cited to the researcher's statement |
| `research.json` or `tree.gedcomx.json` appears while the place fill runs | Checked again after the fill, which can take seconds: another create finished first, and create never overwrites |
| Two additions whose `ark` names the same person | The same person twice |
| An addition relationship repeating one the build already holds (same type and endpoints, a Couple in either order) | The read's relationships are imported already; no validator rejects the duplicate |
| An `assertion_id` on any fact, staged or added | Stamped only by `materialize_facts`; a seeding tree has no assertions to point at |

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
> the atomic no-write-on-failure property, and that neither `researcher_profile`
> nor `known_holdings` is invented; the tree built from a staged
> `person-read-flynn-family.json` (a merged-person redirect, a memory source with
> `text`/`image_ref`/`artifact_url`, a top-level `notes`) against a committed
> literal; additions by PID landing in the starting baseline; the label, ref,
> source-id and repeated-relationship refusals, including lower-case PIDs, an ark
> URL with a query string, and `Object` prototype keys as labels; each
> `personReadRef` refusal; and the objective-only build's sourcing.

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
> `readme-catalog.test.ts` — the tool is registered, dispatched, listed in the
> install contract, and discoverable.

*Linted: every path in this section must resolve.*
