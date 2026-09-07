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

It also keeps the caller's diff small: `init-project` already builds the whole
simplified-GedcomX document in memory and writes it, so adopting this tool is a
substitution rather than a decomposition into a 30–80-op tree batch. The
full→simplified conversion stays in the skill, exactly where it is today.
Moving it host-side is a separate change, and worth doing carefully: the observed
agent caught FamilySearch auto-standardizing a "Central States" mission to
*"Central, Morocco"* and dropped it rather than persisting the error.

## 4. Contract

| Input | Required | Notes |
|---|---|---|
| `projectPath` | yes | Absolute path to the project directory |
| `objective` | yes | Non-empty after trimming. Stored trimmed |
| `title` | no | Omitted from the document when absent, never written empty |
| `subjectPersonIds` | no | Local tree ids. Each must exist in `tree`. Defaults to `[]` |
| `tree` | no | Simplified GedcomX. Defaults to `{persons: [], relationships: [], sources: []}` |

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
> nor `known_holdings` is invented.

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
