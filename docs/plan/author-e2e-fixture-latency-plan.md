# Plan: make `/author-e2e-fixture` fast

**Status:** draft rev. 3 — rev. 2 revised after adversarial review;
rev. 3 adds *When we snapshot*, commits the unstripped tree (Path 1/2
only), and hardens the living-person gate to cover the whole tree
**Branch:** `worktree-optimize-author-e2e`
**Owner:** TBD

## Why now

We are about to author **~50 more Path-1/2 fixtures** (from FamilySearch
PIDs). That is the forcing function for this work, and it changes what
"good" means: at 76 fixtures the corpus is no longer a handful of
hand-made artifacts, so both the *cost* and the *consistency* of
authoring start to matter.

## Problem

`/author-e2e-fixture` is slow because the skill makes Claude *transcribe*
a file that a script could produce. Step 4 says: take the `person_read`
result, "write it to the output folder, then strip the items." There is
no script, so the model reads 30–45 KB of GedcomX into context and
re-emits nearly all of it through `Write`.

Measured over the 26 committed fixtures in `eval/tests/e2e/`, split by
authoring path (Path 3 is the PID-less document path — 11 fixtures whose
`source_pid` is `PID-TODO`):

| | n | median total | median tree | tree share |
|---|---|---|---|---|
| **Path 1/2 (from a PID)** | 15 | ~5,990 tok | ~3,660 tok | **61%** |
| Path 3 (PID-less) | 11 | ~3,160 tok | ~615 tok | 19% |

The four most expensive fixtures are all Path 1/2, and there the tree is
essentially the whole cost:

| fixture | total | tree | share |
|---|---|---|---|
| clark-parents | 12,728 | 10,597 | 83% |
| bottemiller-parents | 11,259 | 9,179 | 82% |
| kenneth-quass-death | 10,265 | 8,940 | 87% |
| susan-miller-birth | 9,704 | 8,487 | 87% |

Output tokens are the wall-clock bottleneck for these skills (same
finding as `docs/plan/research-latency-reduction-plan.md` Phase 0:
wall-clock ∝ output tokens, API% ≈ 100). So the majority of a Path-1/2
authoring run is spent retyping JSON, and one JSON syntax slip costs a
full retype.

**Projected over the 50 new fixtures: ~300,000 output tokens as things
stand, ~70,000 after this change.** After they land, Path 1/2 is 65 of
76 fixtures (86% of the corpus), so Path 1/2 is what this plan
optimizes. Path 3 stays a supported but secondary path (§ *Path 3*).

## The finding that shapes the design

The first draft of this plan asserted that `try-person-read.ts` prints
"the exact shape of `starting-tree.gedcomx.json`," so `snapshot` could be
a pipe. **That is false.** `person_read`'s output does not validate as
simplified GedcomX. Four gaps, all confirmed against the types and the
validator:

| gap | evidence | validator says |
|---|---|---|
| Names carry **no `id`** | `TreeName` (`src/types/person-read.ts:25-30`) has no `id` field; `shapePersons` (`person-read.ts:311-318`) rebuilds each name from `{given, surname, prefix?, suffix?}` and drops the id `simplifyName` had preserved | `checkRequired(name, ["id", "given", "surname"])` — `validator.ts:858` |
| Relationships carry **no `id`** | `TreeRelationship` (`types/person-read.ts:50-58`) has no `id` field; `shapeRelationships` (`person-read.ts:337-366`) never emits one | `checkRequired(rel, ["id", "type"])` — `validator.ts:898` |
| Facts *may* lack `id` | `TreeFact.id` is optional; it survives only if FamilySearch supplied one upstream (`simplifyFact`, `gedcomx-convert.ts:264`) | `checkRequired(fact, ["id", "type"])` — `validator.ts:875` |
| Sources *may* carry `notes` | `TreeSource.notes?: string[]` (`types/person-read.ts:65`); emitted by `shapeSources` (`person-read.ts:400`) | `TREE_SOURCE_FIELDS = {id,title,citation,author,url}` — `validator.ts:289` |

Corpus confirms the shape the validator wants: **147/147 names and
666/666 facts** in the committed starting trees have ids; all 196
relationships have ids; **0/156** sources carry `notes`.

So the model is not merely transcribing today — it is **silently
normalizing**, and it invents a different convention every time. Across
the 196 committed relationship ids:

| convention | count | example |
|---|---|---|
| `rel-<n>` | 129 | `rel-1`, `rel-2` |
| `rel-pc-<parent>-<child>` | 28 | `rel-pc-kns4-kw4t` |
| ad-hoc | 20 | `rel-parents-couple`, `rel-father-morris` |
| `R<n>` (**what `simplified-gedcomx-spec.md` §3 prescribes**) | 19 | `R1`, `R2` |

That is the real argument for scripting this. It is not only that the
transcription is expensive — it is that the transcription is *doing
undocumented work*, badly, and we are about to do it 50 more times.

**`snapshot` is therefore a normalizer, not a passthrough.** Minting the
ids is its job, and it should mint them once, consistently, for the whole
corpus. Which scheme is a matter of taste rather than correctness — see
*When we snapshot* below, and *Open question 1*.

### Two remaining amplifiers

1. **Verification re-reads the tree twice, to do a job a script already
   does.** Step 4 ("re-read the tree and confirm before writing") and the
   sanity-check list ("re-read the stripped tree once more") both check
   that every expected finding is absent from the starting tree. That is
   precisely what `eval/harness/e2e/validate_fixture.py` computes. The
   skill runs the linter in the model's head, then tells the user to go
   run the linter.

2. **Two blocking user round-trips, and a 410-line prompt.** Step 1 asks
   "which subset should the agent recover?", waits, then asks for
   slug/tags/era/geography/difficulty/notes as a second batch. All three
   authoring paths are interleaved through Step 1, Step 3, Step 4, Step
   5, the Example, *and* the re-invocation notes, so every run reads and
   arbitrates between all three even though Path 1 is now 86% of the
   corpus.

> *Dropped from rev. 1:* an "is `allowed-tools` enforced?" task. It is
> not enforced. `allowed-tools` has been on this skill since its first
> commit (`b8a43011`, #367), yet `bottemiller-parents` was authored later
> (`799ae4ab`, #527) writing all five files with tools the frontmatter
> never granted. The "tree is emitted twice" amplifier does not exist.
> The `allowed-tools` list should still be corrected, but as hygiene, not
> as a savings lever.

## Constraints

The skill runs in **Claude Code**, invoked by **genealogists** (Windows)
as well as developers (macOS). Everything it calls must be reachable from
the `Bash` tool on both platforms.

- **`make` is not available to the genealogist team.** That is why
  `eval/*.bat` exists. The skill must invoke the underlying commands, not
  make targets.
- **`uv` and `npx tsx` are already proven present for genealogists.**
  `ValidateFixture.bat` runs `uv run python -m e2e.validate_fixture`;
  `Login.bat` runs `npx tsx dev/e2e-login.ts`. Both invocation shapes are
  established for this audience.
- Claude Code's `Bash` on Windows is Git Bash, so
  `cd eval/harness && uv run python -m e2e.author …` works verbatim on
  both platforms.
- **`npx` cannot be spawned directly from Python on Windows.** It resolves
  to `npx.cmd`, and `subprocess.run(shell=False)` on a `.cmd` raises
  `WinError 193`. `mock_mcp.py:113-114` sidesteps this by spawning `node`
  directly, but that trick is unavailable here: `tsx` is not resolvable
  from `mcp-server/node_modules` (`node --import tsx` fails; only
  `npx tsx` works). So `author.py` must spawn
  `["cmd", "/c", "npx", "tsx", …]` on `os.name == "nt"` and
  `["npx", "tsx", …]` elsewhere, with `cwd=packages/engine/mcp-server`.
- **Encoding, everywhere.** Every Python `read_text` / `write_text` /
  `open` passes `encoding="utf-8"` as a keyword (CLAUDE.md). This
  additionally applies to the two places CLAUDE.md's grep does not reach:
  `subprocess.run(..., text=True, encoding="utf-8")` when capturing the
  `npx tsx` stdout, and `sys.stdout.reconfigure(encoding="utf-8")` before
  printing the id index, since the fixture corpus is full of non-ASCII
  names (Dutch, Norwegian, Spanish) and cp1252 will crash on them.
- `author.py` may import third-party packages: `eval/harness/pyproject.toml`
  already depends on `jsonschema>=4.22.0`. (Skill `scripts/` in the Cowork
  plugin are stdlib-only; `eval/harness/` is not.)
- **The skill requires the repo as cwd.** All three paths now shell into
  `eval/harness/`. The out-of-repo fallback in today's Step 6 ("write to a
  `<slug>/` subfolder and tell the user to move it") is deleted: it cannot
  run the scripts. If `eval/tests/e2e/` is not reachable, the skill says
  so and stops.

## When we snapshot

**Once per fixture, at authoring time — and essentially never again.**

Once a fixture is committed, its `starting-tree.gedcomx.json` *is* the
benchmark input. Re-snapshotting against FamilySearch would silently
rewrite the test: FS is a mutable upstream, someone edits the person, and
a run's score is no longer comparable to last month's. Nor do the other
apparent reasons hold up — a simplified-GedcomX schema migration should
rewrite the committed files with a migration script (re-fetching drags in
unrelated FS drift), and fixing a botched strip needs the *unstripped
tree*, not a fresh fetch.

That last one is the catch. Once `snapshot` exits, the unstripped tree is
gone. Anyone who later wants to re-strip — a fresh clone, another machine,
a colleague fixing your strip set — has to re-fetch, and may get a
different tree than the fixture was built from. The fixture becomes
quietly unreproducible.

**So we commit the unstripped tree**, as
`eval/tests/e2e/<slug>/unstripped-tree.gedcomx.json`, next to the other
five files.

It is an **optional sixth file, present only on Path 1/2.** Path 3
*constructs* its starting tree from a document — nothing was snapshotted,
so there is nothing to preserve, and there is no strip to replay. Every
check below that reads the unstripped tree is therefore conditional on its
presence, and `strip` (which requires it) is never invoked on Path 3.

This does not leak the answer to the agent. `build_workspace`
(`orchestrator.py:265-266`) copies exactly two files into the workspace,
by explicit filename; `provided_documents` reads only a
`provided-documents/` subdirectory. And the decisive precedent:
**`expected-findings.json` already sits in that directory and literally
is the answer**, and has never reached the agent. Cost is ~1.2 MB across
all 76 fixtures. *Implementation note:* add a test asserting
`build_workspace`'s copy list stays filename-explicit, so nobody
"simplifies" it into a `copytree` later.

Consequences, all simplifying:

- `strip` becomes replayable forever, offline, with no FamilySearch
  dependency. No untracked cache is needed.
- Id determinism drops from **blocking to cosmetic** (*Open question 1*).
  The whole case for content-derived ids was that re-snapshotting a PID
  must yield stable ids. We snapshot once and commit the result, so the
  spec's sequential `R1`/`N1`/`F1`/`S1` scheme is fine as written.
- A separate `strip-spec.json` becomes redundant (*Open question 2*): with
  both trees committed, the strip is recoverable by diffing them.

The one genuinely useful re-snapshot is an **audit**, not a rebuild:
`snapshot --check --pid <PID>` fetches to a temp path, diffs against the
committed unstripped tree, and reports whether FamilySearch has drifted
under the fixture. It never writes. Correspondingly, `snapshot` **refuses
to overwrite an existing `unstripped-tree.gedcomx.json` without
`--force`** (*Open question 4*).

The 26 existing fixtures are **not backfilled** — their unstripped trees
would have to come from a drifted FamilySearch. They stay as they are;
everything below applies to fixtures authored from here on.

## Design

One script surface, so the skill issues one command shape:

```
cd eval/harness && uv run python -m e2e.author <subcommand> [args]
```

`e2e/author.py` lives alongside `validate_fixture.py`. Only the
FamilySearch fetch is TypeScript (it needs engine auth); everything else
is Python. The skill never sees the split.

### The living-person gate

FamilySearch's ToS forbids committing fixtures about living persons, and
we are about to commit the **unstripped** tree — so the gate must cover
**every person in it, not just the subject.** `person_read --relatives`
returns parents, spouses, and children; for a 20th-century subject some of
those may be living. Today's SKILL.md only asks the author to confirm the
*subject* is deceased (`SKILL.md:80-82`, `:99-100`).

Enforced by `snapshot` (both `--pid` and `--from-file`) and re-checked by
`validate`:

1. **Refuse on `living: true`, anywhere in the tree.** Exit non-zero,
   write nothing. This also catches the subject's HTTP-204 case:
   `person_read` returns `livingPersonStub(pid)` rather than throwing
   (`person-read.ts:98-100`, `:175-187`), a stub with `living: true`.
2. **Refuse on a missing `living` field.** Absent is not deceased. The
   tree schema does not require `living` (`required: [id, gender, names]`),
   and **5 of the 147 committed persons are missing it** — all in
   `ferber-grandparents`, a Path-1 fixture, where hand-transcription
   dropped the field. `person_read` always emits it, so in practice this
   only bites `--from-file`.
3. **`--drop-living`** is the escape hatch: remove living persons, cascade
   their relationships, and print exactly what was removed. Refusal is the
   default because dropping silently mutates the ground truth, and that is
   the author's call, not the script's.
4. **A 110-year `WARN`, on the unstripped tree only.** Any person with no
   `Death` / `Burial` / `Cremation` fact whose birth year is after
   `current_year − 110` is presumed living by FamilySearch's own rule.
   It is a warning, not a refusal, because FS's `living: false` is
   authoritative and the heuristic has false positives.

   **Rule 4 must never run on a starting tree.** Stripping a death fact is
   exactly what makes a deceased person look living. `kenneth-quass-death`
   proves it: the subject `KNS4-P6W` is Kenneth Werner Quass, born 1917,
   `living: false`, and his starting tree carries no death fact *because
   his death is the answer.* Run the heuristic post-strip and it flags the
   subject of every death-date fixture.

The prose gate stays in SKILL.md too, so the model asks before spending a
fetch — but the script is the gate that counts. None of this may be
softened into a warning: the failure mode is committing living-person data
to a public repository.

> *Legacy:* the 5 `ferber-grandparents` persons missing `living` should be
> fixed in a separate one-line commit. They are not a ToS violation (all
> are 19th-century), but they are the reason rule 2 exists.

### Subcommand 1 — `snapshot`

```
uv run python -m e2e.author snapshot --slug <slug> --pid <PID> [--force] [--drop-living]
uv run python -m e2e.author snapshot --slug <slug> --from-file <tree.gedcomx.json>
uv run python -m e2e.author snapshot --slug <slug> --pid <PID> --check
```

Runs the living-person gate above, then fetches and **normalizes**:

- `--pid` shells to the existing `dev/try-person-read.ts` — no new TS
  script — via `npx tsx dev/try-person-read.ts <PID> --relatives --sources`,
  capturing stdout. That script already prints exactly
  `personReadTool({personId, relatives, sourceDescriptions})` as JSON and
  writes nothing else to stdout. Auth is `getValidToken()` against
  `~/.familysearch-mcp/tokens.json` — the same token file the MCP server
  uses, refreshed by `Login.bat` / `make e2e-login`. On auth failure,
  `author.py` rewrites the MCP-flavored "call the login tool" error into
  "run `Login.bat` (or `make e2e-login`) and retry".
- `--from-file` covers Path 2 (a finished project's `tree.gedcomx.json`)
  — no fetch, but the same normalization, since a project tree may also
  have come from `person_read`.
- **Normalization** closes the four gaps in the table above: mint name
  ids and relationship ids, backfill any absent fact id, drop `notes`
  from sources (*Open question 1*).

Output: the normalized, **unstripped** tree, written once to
`eval/tests/e2e/<slug>/unstripped-tree.gedcomx.json` and committed. It
refuses to overwrite an existing one without `--force`. `--check` writes
nothing and instead diffs a fresh fetch against the committed unstripped
tree, reporting FamilySearch drift (see *When we snapshot*).

`snapshot` does **not** write `starting-tree.gedcomx.json` — that is
`strip`'s output, and until `strip` runs there is no starting tree. This
also means a half-finished authoring run leaves an obviously incomplete
fixture directory rather than one whose starting tree still contains the
answer.

To stdout it prints an **id index** — the naming surface for `strip`.
You cannot strip what you cannot name, and the ids were just invented by
the script, so the model has no other way to learn them:

```
PERSONS (8)
  KNDX-MKG  John Smith        M  deceased
      F1  Birth  1820        Augusta Co., Virginia
      F2  Death  1879-03-11  Augusta Co., Virginia
  L2QR-9XY  Robert Smith      M  deceased
      F7  Birth  abt 1795    Virginia
RELATIONSHIPS (13)
  R1  ParentChild  L2QR-9XY -> KNDX-MKG
  R4  Couple       L2QR-9XY <-> M4TT-2BC
      F12  Marriage  1818  Augusta Co., Virginia
SOURCES (22)
  S3   1850 U.S. Census, Augusta Co., VA   [cites: KNDX-MKG, L2QR-9XY]
  S11  Virginia Deaths, 1879               [cites: KNDX-MKG]
```

Note the index renders **facts on relationships**, not just on persons.
Marriage facts live on the `Couple` relationship's `facts[]`
(`person-read.ts:353-356`; see `morris-jenkins-marriage`), so a
person-only index would make a marriage fixture's answer invisible — and
unreachable by `strip`'s selectors.

> *Dropped from rev. 1:* the claim that this index saves ~15× the input
> tokens of the tree. It doesn't — an honest index of `bottemiller-parents`
> is ~2,050 tokens against a 7,175-token tree, about 3.5×. And it saves
> *input* tokens, which Phase 0 showed are not the bottleneck. The index
> is justified as the naming surface for `strip`, not as an optimization.
> If the model wants fact detail beyond the index, it can `Read` the
> on-disk tree.

### Subcommand 2 — `strip`

```
uv run python -m e2e.author strip --slug <slug> \
  --persons L2QR-9XY,M4TT-2BC \
  --relationships R1 \
  --facts KNDX-MKG:F2 --facts R4:F12 \
  --sources S3,S11 \
  [--dry-run]
```

- **Reads the committed `unstripped-tree.gedcomx.json`, writes
  `starting-tree.gedcomx.json`.** Never reads its own output. This makes
  `strip` idempotent and re-runnable, offline and forever: iterate on the
  strip set without re-fetching, and an aborted run leaves nothing
  half-stripped. It also removes the "four scattered writes with no abort
  semantics" hazard — every subcommand is safe to re-run, and the only
  input `strip` depends on is a file under version control.
- `--facts` is keyed `<owner>:<fact-id>`, where owner is a person id *or*
  a relationship id.
- Removing a person **cascades** to every relationship referencing it.
  Sources are never cascaded — they are named explicitly, because whether
  a source attests the stripped fact is a judgment call.
- Prints the removal set, plus any person left orphaned (no facts, no
  relationships) as a `WARN`.
- Prints a ready-to-paste `stripped_summary` bullet list for the README.
- Runs the schema validation of §*validate* on the result.
- **Refuses unless `expected-findings.json` exists and contains at least
  one finding.** Existence alone is too weak a gate: an empty `[]` would
  pass it, and the stripping linter would then pass *vacuously* — no
  findings, nothing to check. `--dry-run` is the escape hatch for
  iterating on a strip set before the findings are written.
- Then runs the `validate_fixture.py` stripping linter and prints its
  `WARN` lines. This is what deletes the two manual "re-read the tree and
  confirm" steps from the prompt.
- `--dry-run` prints everything and writes nothing. It must lint the
  **in-memory** candidate tree, not the file on disk — `validate_fixture.py`
  reads `starting-tree.gedcomx.json` from disk (`:251-252`), and on a dry
  run that file is still unstripped, so a naive call would emit a WARN for
  every finding. `validate_fixture.py` needs a small refactor to expose its
  check against passed-in dicts, mirroring how `schema_validator.py`
  already validates dicts rather than paths.

Step order therefore becomes: `snapshot` → model writes
`expected-findings.json` → `strip`.

### Subcommand 3 — `scaffold`

```
uv run python -m e2e.author scaffold --slug <slug> --name "…" --pid <PID> \
  --question "…" --question-type parents --era 1850s --geography US-VA \
  --difficulty easy --notes "…"
```

Renders `fixture.json` and `starting-research.json`. Pure substitution —
including `captured` = today, and the `rp_<slug_underscored>` rule the
prompt currently spends a paragraph explaining. `--pid` defaults to
`PID-TODO` for Path 3. Median 520 output tokens saved per Path-1/2
fixture, 447 per Path-3 one.

Templates move from `.claude/skills/author-e2e-fixture/templates/` to
`eval/harness/e2e/templates/` so there is one copy. `expected-findings.json`
and `README.md` templates **stay in the skill** — those are model-authored.

### Subcommand 4 — `validate`

```
uv run python -m e2e.author validate --slug <slug>
```

Loads the two `starting-*` files as dicts and calls the **existing**
`harness/schema_validator.py::validate_research_json` /
`validate_tree_gedcomx_json`, which validate against
`docs/specs/schemas/` with `jsonschema`. Then re-runs the stripping
linter. One final gate.

It additionally runs two checks the schema cannot express:

- **The living-person gate**, rules 1–2, over *both* trees. This is what
  catches a Path-3 constructed tree that omits `living: false`, and it is
  the landing gate for the whole corpus. Rule 4 (the 110-year warning)
  applies to the unstripped tree only.
- **The presence mirror** — every expected finding must be *present* in
  `unstripped-tree.gedcomx.json`, the exact inverse of the stripping
  linter's "absent from the starting tree." It catches a finding the
  author described but never actually stripped, and it catches
  `--drop-living` having removed the answer. Skipped when the unstripped
  tree is absent (Path 3), where the linter's absence check is the only
  invariant that applies — nothing was stripped.

This retires **both** the scratch-dir copy dance in today's Step 2 *and*
the `validate_research_schema` MCP grant.

> *Dropped from rev. 1:* a new `dev/e2e-validate-project.ts` wrapping
> `validateProject`, plus the tempdir-and-canonical-rename dance it
> needed. `schema_validator.py` already does this against dicts, and
> `runnability.py:52-66` is the precedent for calling it that way.
> CLAUDE.md's code-reuse rule is explicit here.
>
> **Caveat, worth a reviewer's eye:** `schema_validator.py` checks the
> JSON Schema, while the engine's runtime check is the hand-maintained
> `validator.ts`, and CLAUDE.md warns the two can drift. For *fixtures*
> the JSON Schema is the right authority. But `validator.ts`'s cross-file
> integrity checks (e.g. `research.json` source ids resolving into the
> tree) have no Python equivalent. If we want those, the answer is to
> port the check, not to reintroduce a tempdir.
>
> ~~it is what `run_e2e.py` itself enforces~~ — **false; corrected during
> implementation.** See "Discovered during implementation" below.

## Discovered during implementation

Three things the plan asserted or omitted turned out to be wrong. All
three are now handled; none changed the design.

**1. Nothing validated fixtures, and the committed corpus did not
conform.** `run_e2e.py` / `orchestrator.py` never call
`validate_research_json` or `validate_tree_gedcomx_json`. Run over the
corpus as it stood at the start of this work, **25 of 26
`starting-tree.gedcomx.json` and 26 of 26 `starting-research.json`
failed** their schemas. Causes, in order of frequency: 142 × `'living'
was unexpected` (person had no `living` in `tree-gedcomx.schema.json`);
FamilySearch UUID fact ids against the required `^F` pattern; `PID-TODO`
as a person id; `rel-1` against `^R`; and `created`/`updated` written as
`2026-06-15T00:00:00Z` against `iso_date`'s `^\d{4}-\d{2}-\d{2}$`. All 26
pass now — see below for which side gave.

So `validate`'s schema gate is **new coverage, not a restatement of an
existing one**. But a gate is only worth having if the schema describes
something real, and most of what it described was fiction. The resolution
therefore went the other way — the schema gave, and the fixtures gave:

- **The id patterns were deleted, not the ids.** Nothing in the codebase
  reads meaning out of a person, fact, relationship or source id. The one
  FamilySearch-PID regex (`VALID_FS_ID_RE`, `match-engine.ts`) tests
  `ark`, not `id`, and *mints* a conforming id rather than rejecting a
  non-conforming one; `ark` is what carries a person's membership in the
  FamilySearch tree. So the six `pattern` constraints collapsed into a
  shared `$defs/id` — non-empty string, no shape — and `PID-TODO`,
  `rel-1` and FamilySearch's UUID fact ids are all legal. The `I`/`N`/`F`/
  `R`/`S` prefixes remain a naming convention. See
  `simplified-gedcomx-spec.md` §3.
- **`living` was added to the schema**, not worked around. It is
  load-bearing for the living-person gate and `person_read` emits it on
  every person, so the schema carries it — as it now carries `prefix` and
  `suffix` on names, which `person_read` also emits. Four files, per
  CLAUDE.md's blast-radius note.
- **Normalization preserves ids** rather than re-minting them, and
  synthesizes one only where none arrived: always for names and
  relationships, which `person_read` does not identify, and for the
  occasional fact FamilySearch leaves unidentified. The backfill counter
  steps over ids the document already spends, so a synthesized `F3` can
  never land on a tree that already has one.
- **The 26 existing fixtures were repaired**, in the same change. Two of
  their defects were not cosmetic: 30 `ParentChild` relationships written
  with a `Couple`'s `person1`/`person2` keys, and one tree with no
  top-level `sources`. `tree_edit` hard-fails on both, and the committed
  *passing* transcripts for `scotland-thomson-grandparents` and
  `pauline-shaver-death-burial` both show the agent repairing our fixture
  mid-run before it could write — burning exactly the tokens this plan
  exists to save. Those two run logs were deleted and are owed a re-run.
  The remaining edits (fact ids, `iso_date`, ferber's `living`) are
  behaviour-neutral and leave the other runlogs valid.

**2. The normalization list was incomplete.** Two more steps were being
done by hand, both documented as such in
`eval/tests/e2e/kenneth-quass-death/README.md`: dropping relationships
that point at persons `person_read --relatives` didn't return (21 of them
in kenneth), and PascalCasing fact types (`move` → `Move`). Both are now
scripted. Empirically, `normalize_tree` takes kenneth's committed
starting tree from 25 schema errors to 0.

**3. Path 3's ids were quietly incoherent.** `PID-TODO` does not match
the person-id pattern, so a constructed tree's subject must be `I1` — but
the old template wrote `subject_person_ids: ["{{source_pid}}"]`, pointing
`research.json` at a person absent from the tree. Fixed with
`scaffold --subject-id` (defaults to `--pid`, so Paths 1/2 are unchanged).

One incidental confirmation: `living_gate(..., heuristic=True)` fires on
kenneth's `KNS4-P6W` ("born 1917 and has no Death/Burial/Cremation
fact"), which is exactly the false positive the plan predicted. Rule 4
therefore never runs on a starting tree, and a regression test pins that.

## What the model still authors

Only the parts that need judgment:

| artifact | who | ~tokens |
|---|---|---|
| `starting-tree.gedcomx.json` | `snapshot` + `strip` | 0 |
| `fixture.json` | `scaffold` | 0 |
| `starting-research.json` | `scaffold` | 0 |
| `expected-findings.json` | model | ~450 |
| `README.md` | model | ~800 |
| the four commands' arguments | model | ~150 |

**Median Path-1/2 fixture: ~5,990 → ~1,390 output tokens (−77%).
`clark-parents`: 12,728 → ~1,700 (−87%). Across the 50 new fixtures:
~300k → ~70k output tokens.** Plus roughly 6–10 fewer turns (no scratch
copies, no re-read verification, no manual "do the four JSON files parse"
pass).

Second-order, and arguably worth more than the tokens: all 65 Path-1/2
fixtures get **one** id convention instead of four, and every strip
becomes reproducible from the PID.

## Path 3 (PID-less, from a research document)

Eleven committed fixtures, and 11 of 76 (14%) after the new batch lands.
The tree is *constructed* from a document, not snapshotted, so `snapshot`
and `strip` do not apply, and **no `unstripped-tree.gedcomx.json` is
written**. Path 3 gets `scaffold` and `validate` only — median 3,162 →
~1,890 tokens (−40%), entirely from `scaffold` plus the deleted
manual-verification prose.

`validate`'s living-person gate (rules 1–2) still applies: a constructed
tree must carry `living: false` on every person, which SKILL.md already
instructs (`:245-246`) and which nothing currently enforces. Deceased status
itself is confirmed from the document, as prose (`SKILL.md:130-131`).

Path 3 stays in SKILL.md as prose, and one latent bug in it should be
fixed while we are here: `SKILL.md:249-250` tells the model to construct
ParentChild relationships with `parent = person1, child = person2`. That
is the **full**-GedcomX convention. Simplified GedcomX uses `parent` /
`child` keys (`simplified-gedcomx-spec.md:50`), which is what all 165
committed ParentChild relationships use. The instruction is wrong today.

## SKILL.md changes

1. **Fix `allowed-tools`** — `Bash`, `Read`, `Write`, `Glob`. Drop
   `validate_research_schema` (superseded by `author validate`) and
   `person_read` (superseded by `author snapshot`). Side effect: the
   skill then needs **no MCP tools at all** and works with the genealogy
   MCP server disconnected — it only needs a valid FS token on disk. This
   is hygiene: the field is not enforced (see the note under *Amplifiers*),
   but a frontmatter that lies is worse than none.
2. **Keep the deceased precondition**, and move it *ahead* of the fetch.
   Restate it as: ask the user; the script will also refuse.
3. **Rewrite Steps 2 and 4** as the commands above.
4. **Delete the manual verification prose** — Step 4's "re-read the tree"
   and the first two bullets of "Sanity checks", now enforced by `strip`
   and `validate`.
5. **Merge the two user round-trips into one.** After `snapshot` prints
   the id index, the model proposes the research question *and* a full
   metadata block (slug, tags, era, geography, difficulty) with defaults
   inferred from the index, and asks the user to confirm or correct in one
   turn.
6. **Restructure paths.** Hoist Path 1 to the spine; collapse Paths 2 and
   3 into a single "Secondary paths" section at the end, stating only
   their deltas (Path 2: `snapshot --from-file`; Path 3: no snapshot,
   model constructs a small tree, `scaffold --pid PID-TODO`). Removes the
   per-step three-way branching. Target ~150 lines, down from 410.

   *Rejected:* moving Paths 2/3 into `references/secondary-paths.md`.
   CLAUDE.md records that relative-path resolution from SKILL.md is
   unreliable (claude-code#17741). Keep one file.
7. **Delete the out-of-repo output fallback** in Step 6 (see *Constraints*).

## Files

**New**
- `eval/harness/e2e/author.py` — the four subcommands
- `eval/harness/e2e/templates/{fixture.json,starting-research.json}`
- `eval/harness/tests/unit/test_e2e_author.py`
- `eval/harness/tests/fixtures/unstripped-tree.gedcomx.json` — a small
  synthetic tree for the offline unit tests (see *Testing*)
- an **optional sixth file per new Path-1/2 fixture**:
  `unstripped-tree.gedcomx.json` (absent on Path 3)

**Modified**
- `.claude/skills/author-e2e-fixture/SKILL.md` (rewrite)
- `.claude/skills/author-e2e-fixture/templates/` (delete two, keep two)
- `eval/harness/e2e/validate_fixture.py` — expose the stripping check
  against passed-in dicts (for `--dry-run`), keeping the CLI intact
- `eval/harness/e2e/orchestrator.py` — no code change, but a new test
  pinning `build_workspace` to its explicit two-file copy list
- `docs/specs/e2e-test-spec.md` — document the sixth file
- `docs/e2e-testing-guide.md` — its "authoring a fixture" walkthrough
  (~lines 175-220) documents the `person_read` + MCP-grant flow this plan
  removes
- `Makefile` — one passthrough `e2e-author` target for developers. The
  skill does **not** use it.

**Unchanged:** all 26 existing fixtures (not backfilled), `run_e2e.py`,
`project.py`, `scratch.py`, every `.bat`, and `dev/try-person-read.ts`
(reused as-is). No new TypeScript. No new `.bat` — genealogists reach this
through the skill, and the skill drives `Bash`.

## Testing

- `test_e2e_author.py`, all offline:
  - **normalization**: a `person_read`-shaped input (no name ids, no
    relationship ids, a source with `notes`) round-trips through
    `snapshot --from-file` and passes `validate_tree_gedcomx_json`.
    This is the regression test for the finding this plan is built on.
  - **determinism**: normalizing the same input twice yields identical ids.
  - **living-person gate**: an input whose *subject* has `living: true`
    exits non-zero and writes no file; so does one whose *relative* does;
    so does one with a person missing the `living` field. `--drop-living`
    removes them and cascades. The 110-year warning fires on a
    no-death-fact person born after `year − 110` in an unstripped tree,
    and is **not** applied to a starting tree (regression guard for the
    `kenneth-quass-death` false positive).
  - **presence mirror**: a finding absent from the unstripped tree fails
    `validate`; the check is skipped when no unstripped tree exists.
  - **strip cascade**: person removal takes its relationships with it;
    the orphan warning fires; a relationship-owned fact
    (`R4:F12`) can be stripped.
  - `scaffold` substitution incl. the `rp_` slug rule; `--dry-run` writes
    nothing and lints the in-memory candidate.
  - `build_workspace` copies exactly `research.json` + `tree.gedcomx.json`
    — a guard so the committed unstripped tree can never reach the agent.
- **Corpus invariant**, self-populating: for every fixture directory that
  has an `unstripped-tree.gedcomx.json`, assert that its
  `starting-tree.gedcomx.json` is a strict subset of it (no id present in
  the starting tree that is absent from the unstripped one), and that both
  validate. Zero fixtures at first, ~50 after the new batch lands. This is
  the golden re-derivation test, and it costs nothing to maintain because
  authoring populates it.

  > *Corrected from rev. 1,* which proposed rebuilding a fixture's
  > starting tree from its committed `final-tree.gedcomx.json`. That is
  > unsound: a final tree is the *agent's output*, not the pre-strip
  > snapshot. It is not a superset of the starting tree — `teitje-harkema`
  > goes 16 persons → 6, and `kenneth-quass-death`'s starting and final
  > trees have **identical** person and relationship id sets (6=6, 8=8),
  > differing only in two facts and six sources, so the assertion would
  > never exercise the removal cascade. Committing the unstripped tree
  > (see *When we snapshot*) is what makes a real golden test possible.

- `snapshot --pid` hits live FamilySearch and is not unit-tested; it is
  covered by the acceptance run.
- **Acceptance.** There is no committed baseline to compare against:
  `author-e2e-fixture` has no validator (none of the 29 in
  `eval/harness/validators/`), no brief, and no runlog, and
  `skill_latency_report.py` reads *unit* run logs, which an interactive
  authoring skill never produces. So the measurement is: **re-author an
  existing Path-1/2 fixture** (`bottemiller-parents`) through the
  rewritten skill on macOS and on Windows, and compare wall-clock, turn
  count, and output tokens from the Claude Code transcript against a
  fresh run of the *current* skill on the same fixture. Assert the
  re-authored files are semantically equal to the committed ones, modulo
  the new id convention.

## Open questions for review

1. **What id scheme should `snapshot` mint?** *Downgraded from blocking to
   cosmetic.* It only mattered because rev. 1 assumed re-snapshotting;
   since we snapshot once and commit the result (*When we snapshot*), any
   stable scheme works. **Recommend: follow `simplified-gedcomx-spec.md`
   §3 as written** — sequential `R1`/`N1`/`F1`/`S1`, matching the 19
   already-conformant relationships and requiring no spec amendment.
   Content-derived ids (`rel-pc-<parent>-<child>`) read better in a `strip`
   command line, but the model reads ids off the index anyway, so that is
   taste. The corpus's other 177 relationship ids stay as they are.
2. **No committed strip spec.** *Now resolved by construction.* Rev. 1
   worried that a strip could not be replayed. With both the unstripped and
   the stripped tree committed, the strip set is recoverable by diffing
   them, and `strip` is re-runnable offline against the committed
   unstripped tree. A `strip-spec.json` would be redundant. **Recommend:
   skip it**, and keep the `stripped_summary` bullets in the README as the
   human-readable record.
3. **Should `strip` refuse when `expected-findings.json` is missing?**
   *Resolved: yes, refuse* — with one strengthening. Existence is a weak
   gate; an empty findings array passes it and then the stripping linter
   passes vacuously, because it has nothing to look for. So `strip`
   requires the file to exist **and** to contain at least one finding.
   `--dry-run` remains the escape hatch for iterating on a strip set.
4. **Overwrite protection.** *Resolved:* `snapshot` refuses to overwrite an
   existing `unstripped-tree.gedcomx.json` without `--force`, and offers
   `--check` for the FamilySearch-drift audit. An accidental re-snapshot of
   a committed fixture would otherwise rewrite its ids and invalidate its
   runlog.
5. **Do the two copies of the answer have to agree?** *Resolved: yes.*
   The fixture directory now holds the answer twice — as prose in
   `expected-findings.json` and as structure in
   `unstripped-tree.gedcomx.json`. `validate` enforces the **presence
   mirror**: every expected finding must appear in the unstripped tree,
   the exact inverse of the stripping linter's absence check, and the same
   code path with the sign flipped. Skipped on Path 3, which has no
   unstripped tree.

**Nothing is blocking.** The remaining judgment calls (id scheme, the
110-year threshold, whether `--drop-living` should exist at all) can be
settled in review of the implementation.
