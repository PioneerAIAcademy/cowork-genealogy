# Deep dive: init-project — findings and validator requests

Issue #1653. Guide followed: `docs/skill-deep-dive-guide.md`. Prohibition list:
`init-project-prohibition-list.md`.

> **One of the five logs is no longer on this branch, by design.** Writing this
> dive's own run tripped the harness's retention rule — `prune_old_candidates`
> keeps the newest `DEFAULT_KEEP_CANDIDATES` (5) per skill — which deleted
> `v1_2026-08-14_02-59-55.json` and its `.ann.json`. The score tables below still
> count it, so to reproduce them fetch it from before the prune:
>
> ```sh
> git show aaa599830:eval/runlogs/unit/init-project/v1_2026-08-14_02-59-55.json
> ```
>
> Restoring the file instead would fight retention and be undone by the next run.

**Corpus read:** all five committed run logs —
`v1_2026-08-14_02-59-55`, `v1_2026-08-17_05-17-40`, `v1_2026-08-17_05-31-54`,
`v1_2026-08-18_12-44-49`, `v1_2026-08-19_08-01-51` (11–12 tests, 1 run each).
Transcripts and `tool_calls` read before scores. Only the four newest used
`project_create`; the 2026-08-14 run predates it, so per-run counts below are
out of four where the written tree is the evidence.

**The grep the issue prescribed returns 0 files — confirmed.** No
`judge_context` in this suite spells out a score branch. The leak here takes a
different shape: two `judge_context` blocks grade something the harness or the
fixture makes impossible (F3, F9), and the rubric routes its one fabrication
check to N/A on exactly the tests where fabrication happens (F4).

**Dimensions that never discriminate — 8 of 8, not 4 of 8:**

| dimension | score distribution across the five runs |
|---|---|
| base / Correctness | 3 × 49 |
| base / Completeness | 3 × 49 |
| base / Tool Arguments | 3 × 36, N/A × 13 |
| rubric / Stub & tree fidelity | 3 × 36, N/A × 3 |
| rubric / Project section seeding & schema validity | 3 × 36, N/A × 3 |
| rubric / Researcher-profile interview & normalization | 3 × 34, N/A × 5 |
| rubric / Place standardization | 3 × 14, N/A × 25 |
| rubric / Known-holdings capture | 3 × 35, N/A × 4 |

Not one non-3 score exists anywhere in the corpus. Every finding below is
therefore a quiet pass, which is what the guide's Step 3 predicts.

**One run log is not green, and it is not a skill defect.**
`v1_2026-08-17_05-17-40` has 9 of 11 tests at `fail`, 8 of them with
`judge.skipped: true` and no dimensions at all, because the then-current
`test_project_files_written_through_the_writer_tools` demanded a
`research_append(section: "project")` that had been designed out before it
shipped — the incident that validator's own docstring now describes. It has no
`.ann.json` sibling. Its runs contribute no scores, so the counts above already
exclude it; "all-3 everywhere" means the four runs that produced scores.

---

## F1 — `ark` is invented, in four mutually incompatible shapes, 18 times. Every run scored 3.

**Did:** across four runs, 18 `project_create` calls wrote a `persons[].ark`.
Not one of them is the canonical form. In `v1_2026-08-19_08-01-51` alone:

| test | `ark` written |
|---|---|
| `ut_init_project_001` | `https://www.familysearch.org/tree/person/details/LZNY-BRF` |
| `ut_init_project_008` | `LZNY-BRF` |
| `ut_init_project_004` | `https://familysearch.org/ark:/61903/4:1:LZNY-BRF` |
| `ut_init_project_007` | `https://www.familysearch.org/ark:/61903/4:1:LZNY-BRF` |

**Should:** `docs/specs/simplified-gedcomx-spec.md` §4.6 — `persons[].ark` is
"the persistent FamilySearch ARK for the person, in canonical `ark:/61903/...`
form", the lift of the Persistent identifier "with the resolver-URL prefix
stripped". And §2: "A person's membership in the FamilySearch tree is carried by
`ark`, never by the form of their `id`." The `person-read-flynn` fixture supplied
no `ark`, and `shapePersons` in `packages/engine/mcp-server/src/tools/person-read.ts`
emits none either — so every one of these 18 values was synthesized from the
person id or from a guessed URL.

**Gap — lane 4, plus the dive's cleanest validator.** Two of the four shapes are
merely non-canonical. The tree-details URL is not: `arkToBareId`
(`src/utils/ark.ts`) finds no ARK in it, falls through both branches, and
returns *the whole URL* as the bare persona id — so `toGedcomX` rebuilds
`identifiers["http://gedcomx.org/Persistent"]` as a web page address. Nothing
catches it: `TREE_PERSON_FIELDS` admits `ark` as a free string, and the field is
not mentioned anywhere in the skill body except in the list of allowed keys, so
the model fills it by guessing.

**Resolved as F17 — derive it, do not omit it.** Round two raised the question and
omission turned out to be the wrong default. `person_read` structurally returns no
`ark` (`shapePersons` builds `{id, gender, living, names, facts}`), so omitting
means no imported person carries a FamilySearch anchor — against the spec sentence
quoted above, "a person with no `ark` is not in the FS tree", and §4.6's note that
the ARK is what the `matchTwoExamples` family anchors on.

Deriving is not invention, which is what settled it. Against the compiled helpers:
`toArk("4:1:LZNY-BRF")` → `"ark:/61903/4:1:LZNY-BRF"`, and `arkToBareId` of that
returns `"LZNY-BRF"` — exactly the person id `person_read` was given, so the
derivation is lossless and reversible. It is also the *identical string*
`person_search` returns for the same person, so the two endpoints agree rather
than diverge. Contrast the shape that broke: `arkToBareId` on
`.../tree/person/details/LZNY-BRF` returns the whole URL.

The durable fix is `person_read` emitting `ark` itself —
`simplified-gedcomx-spec.md` already anticipates it ("future `person_read`") and
it would emit this same string, so the body rule does not change when that lands.
Tool lane, not this PR.

**Fixed here:** SKILL.md Step 3 now says to carry `ark` only when a tool response
supplied one, verbatim, and to omit the key otherwise, naming both wrong sources
(a person ID, a familysearch.org page URL).
`references/simplified-gedcomx-summary.md` gained the same rule beside the person
example, which previously did not mention `ark` at all.

> **Validator request V2 — `ark` form and provenance**
> **Rule:** a `persons[].ark` in a tree written by any skill must match
> `^ark:/61903/\d:\d:`, and the bare id after the last colon must equal a person
> id that a tool response in that run returned. If it cannot, the key must be
> absent. (Revised: an earlier draft required the whole string to appear verbatim
> in a tool response, which would fail the *correct* behaviour on the
> `person_read` path — that tool returns the person id, not the ark.)
> **Where to look:** the written `tree.gedcomx.json` in the after-state, against
> `output.tool_calls[].response` in the run log.
> **Why it is not judgment:** one regex and one string search. `ark` exists to
> anchor a person to a real FamilySearch record; a value no tool returned anchors
> nothing.
> **What a violation looks like:** `ut_init_project_001`, run
> `v1_2026-08-19_08-01-51` — `I1.ark = "https://www.familysearch.org/tree/person/details/LZNY-BRF"`.

**Out of lane, reported not swept:** the resolver-prefixed form is repo-wide, not
just this skill's. It appears in eight other MCP fixtures
(`person-record-matches-flynn*`, `person-person-matches-flynn`,
`record-person-matches-flynn`, `record-record-matches-flynn`), in
`eval/fixtures/scenarios/mid-research-flynn-merge-pending/tree.gedcomx.json`, and
in two shipped seed projects (`apps/server/app/seed/sample_project/`,
`apps/electron/test/fixtures/sample-project/`) — the last of which also carries
`"ark": "https://www.familysearch.org/tree/person/KW7C-X9P"` in a results
sidecar, the shape that breaks. Sweeping those touches four other skills' paid
snapshots and two app packages; V2 is what should decide them.

---

## F2 — The only `person_read` fixture in the suite violates the tool's output contract, and it is why seven rules have never been exercised.

**Did:** `eval/fixtures/mcp/person-read-flynn.json` returned a **bare person
object** — `{id, gender, names, facts}` — as the whole response. Eight of the
twelve tests use it (001, 004, 005, 007, 008, 010, 011, wzk), and it is the only
`person_read` fixture that exists.

**Should:** `docs/specs/person-read-tool-spec.md`, Output: "The top-level shape is
always `{ "persons": [], "relationships": [], "sources": [] }`". The
implementation agrees — `shapePersons` / `shapeRelationships` / `shapeSources` in
`person-read.ts` are assembled under exactly those three keys.

**Gap — lane 2, and the largest coverage hole in this skill.** The fixture returns
no `relationships[]` and no `sources[]` under any input, so across all five
committed runs these body rules have run exactly **zero** times:

- "**Include** … all relatives (parents, spouse, children), all relationships"
- "**Include relatives** (FAN principle)" — the skill's own stated reason for
  reading relatives at all
- "ALL persons get local `I` IDs … including FamilySearch-seeded persons" (there
  was only ever one FamilySearch-seeded person)
- "ParentChild uses `parent`/`child`; Couple uses `person1`/`person2`"
- the source reference on every **relationship**
- "all source descriptions in the top-level `sources` array"
- the Step 5 "one row per person" tree summary, on a tree with more than one row

And it makes the `relatives: true` / `sourceDescriptions: true` requirement —
issue #1475's entire subject, marked "**Both flags are required**" in the body —
**unfalsifiable**: the fixture returns the same subject-only payload whether the
flags are passed or not, so a regression that dropped them would score
identically. `no-relatives.json` (008), tagged `isolated-person` and
`fan-principle`, is consequently indistinguishable from `new-project-from-tree.json`
(001): the isolated case is the *only* case the suite has.

**Fixed here:**
- `person-read-flynn.json` rewritten to the contract shape, keeping the isolated
  payload — so 008 remains the genuine isolated-person test, and it doubles as
  the response a flag-less call now receives.
- New `person-read-flynn-family.json`, predicated on
  `{personId, relatives: true, sourceDescriptions: true}`: four persons (Patrick,
  wife Mary Kelly, children James and Margaret), a Couple relationship carrying
  the marriage fact, four ParentChild relationships, and two source descriptions.
  Relationships and names arrive without ids, as the real tool returns them.
- `new-project-from-tree.json` (001) lists the family fixture first and the thin
  one second. A `person_read` call that omits either flag therefore falls through
  to the subject-only payload and produces a **visibly thinner tree** rather than
  an identical one. That is the flags' first observable consequence anywhere in
  the suite.

---

## F3 — The Tool Arguments dimension was pointed at a grading target that omits the two mandatory flags.

**Did:** `person-read-flynn.json` declared `args: { "personId": "LZNY-BRF" }`.
Per `eval/harness/harness/fixtures.py`, the `args` block does double duty: it is
the dispatch predicate **and** "the LLM judge compares the actual args Claude
passed against the matched fixture's `args` and scores the Tool Arguments base
dimension". `mock_mcp.py` writes the matched predicate into the call log as
`expected_args`.
Base / Tool Arguments scored 3 on all 36 tests that made an MCP call.

**Should:** SKILL.md Step 2 — `person_read({ personId, relatives: true,
sourceDescriptions: true })`, "**Both flags are required** — they default to
`false`, and without them the call returns ONLY the subject's own facts … which
imports a subject-only tree with no spouse, children, or sources (issue #1475)."

**Gap — lane 2.** The dimension that exists to grade call arguments was handed a
target that does not mention the arguments that matter most on this call, so it
could only ever confirm the person id. The runs did in fact pass both flags every
time — which is the point: the corpus cannot tell you whether that is the skill
working or luck, and the next regression is invisible.

**Fixed here** by the F2 fixture split (the flagged fixture's `args` block now
names both flags, and is what the judge grades against on 001). The general case
is a validator, because the other six tests still match on `personId` alone and
adding the flags to *their* predicates would turn a flag-less call into an
unmatched-fixture abort — losing the grades instead of scoring them down.

> **Validator request V1 — `person_read` flags**
> **Rule:** every `person_read` call made by `init-project` must pass
> `relatives: true` **and** `sourceDescriptions: true`.
> **Where to look:** `output.tool_calls[].args` in the run log.
> **Why it is not judgment:** two booleans, and the body states them as
> mandatory. Without both, the imported tree is silently subject-only — the
> defect issue #1475 was filed for.
> **What a violation looks like:** none in the committed corpus, and that is the
> finding. No fixture predicate and no `expected_args` block ever required the
> flags, so a run that dropped one would have matched, been graded against
> `{personId}`, and scored 3.

---

## F4 — 56 `standard_place` values invented across 28 runs, by the dimension whose `fail` bullet names exactly that, which was told to score N/A.

**Did:** in all 28 runs that called `person_read` and no `place_search`, the
written tree carries a `standard_place` on every fact — 56 values in total. Every
one is a verbatim copy of the fact's own free-text `place` (`"Ireland"` →
`"Ireland"`, `"Schuylkill County, Pennsylvania, United States"` → itself). The
fixture returned no `standard_place` on any fact, and `place_search` was never
called on this path.

**Should:** SKILL.md — "Facts from `person_read` already carry `standard_place` —
keep it. Hand-entered places: resolve with `place_search`, use `standardPlace`
from the first result."

**The body was right and the fixture was wrong — note the direction.** An earlier
draft of this write-up had it backwards. `person_read` calls
`toSimplifiedStandardized`: `simplifyFact` lifts `standard_place` from the raw
GedcomX `place.normalized`, and `standardizePlaces` then resolves whatever is
left through the place resolver. So the shipped tool does supply
`standard_place`, and *not* calling `place_search` on a tool-supplied place is
correct — which is why the rubric's protection of that behaviour is kept below
rather than removed. What was false was the word "already" read as "always": the
resolver is best-effort and leaves the field empty when it cannot match, and the
fixture supplied none at all. Hence the new body rule — keep what arrives,
resolve a fact that arrives without one.

**Gap — lane 2 and lane 4, and the clearest instance in the dive of a rubric
shielding a defect.** `rubric.md`'s Place standardization dimension said:

> Score this dimension **N/A (null)** whenever a test supplies all places through
> `person_read` (or has no place at all) — there is nothing hand-entered to
> standardize.

…while its own **fail** bullet read "a standardized string is **fabricated
without the tool**". So the dimension that would have caught this was instructed
to abstain on precisely the tests where it happens: 25 of its 39 scores are N/A.

The harm is latent in this fixture only because both copied strings happen to be
acceptable standard names. With a fixture place of `"Boston"` or
`"Branch Township"`, the same behaviour writes an unstandardized string into the
field every downstream skill reads as FamilySearch-standardized.

**Fixed here:**
- `rubric.md`'s Place standardization dimension rewritten: it now grades *where
  each `standard_place` came from*, keeps the (correct) protection against
  penalising a skipped `place_search` on a tool-supplied place, and scores N/A
  only when a test has no places at all. The `fail` bullet now names a
  `standard_place` copied from the fact's free-text `place`.
- SKILL.md and the reference doc now say to keep a returned `standard_place`
  exactly as returned, to resolve a returned fact that has `place` and no
  `standard_place`, and never to copy `place` into `standard_place`.
- Both `person_read` fixtures now return `standard_place` values that differ from
  `place` (`"Schuylkill County, Pennsylvania, United States"` →
  `"Schuylkill, Pennsylvania, United States"`), so kept-verbatim and re-derived
  are distinguishable in the written tree for the first time.

> **Validator request V3 — `standard_place` provenance**
> **Rule:** every `standard_place` in a tree written by a skill must equal either
> the `standard_place` the same fact carried in a `person_read` response in that
> run, or a `standardPlace` returned by a `place_search` response in that run. A
> value equal to the fact's own free-text `place` counts only if a tool returned
> that exact string.
> **Where to look:** the after-state tree, against `output.tool_calls[].response`.
> **Why it is not judgment:** string equality against tool responses.
> `standard_place` means "FamilySearch's standardized name", so a value no place
> authority returned is a claim about FamilySearch's vocabulary that FamilySearch
> did not make.
> **What a violation looks like:** `ut_init_project_005`, run
> `v1_2026-08-19_08-01-51` — `F1.standard_place = "Ireland"` and
> `F2.standard_place = "Schuylkill County, Pennsylvania, United States"`, with no
> `place_search` call and no `standard_place` in the `person_read` response.

> **Validator request V8 — `standard_date` provenance**
> **Rule:** every `standard_date` in a tree written by a skill must equal the
> `standard_date` the same fact carried in the tool response that supplied it.
> A fact whose tool response carried one must not lose it.
> **Where to look:** the after-state tree against
> `output.tool_calls[].response`.
> **Why it is not judgment:** string equality. `standard_date` is what every
> downstream date comparison reads; a re-derived or dropped value silently
> changes what a date *claims*, which is why the `~` defect in F15 mattered.
> **What a violation looks like:** none in the committed corpus, because no
> fixture returned a `standard_date` before this PR — the same blind spot that
> hid F4 for 28 runs, one field over.

---

## F5 — On the objective-only path the tree lands with no provenance at all, and the summary then says so in the words the body forbids.

**Did:** `ut_init_project_006`, all four `project_create` runs — the written tree
is `sources: []`, and the subject's Birth fact carries no `sources` key.
`ut_init_project_002` in three of four runs: the same for `F1` and/or for both
ParentChild relationships `R1` and `R2`. Then, in the same 006 responses:

> "**No sources recorded yet** — every fact currently rests on the research
> objective statement alone, with no documentary backing."

and in 001, about a tree whose two facts it had just sourced to `S1`:

> "No attached sources | FamilySearch has no sources linked to LZNY-BRF — all
> data is bare tree assertions"

**Should:** SKILL.md Step 3 — "Then attach a source reference to every fact **and
relationship**", and one paragraph later, "Do NOT call data 'unsourced' — it IS
sourced". The sourcing instruction was written entirely for FamilySearch-derived
facts; the objective-only build had no rule at all, so the model produced a tree
with no provenance and then narrated the absence.

**Gap — lane 4.** The user's own statement *is* a source, and GPS Step 2 treats it
as one — that is the whole reason `known_holdings` exists beside the tree. A
sourceless fact is not "unverified", it is unattributed, and it reaches
question-selection and the plan builder as a fact from nowhere.

**Fixed here:** SKILL.md Step 3 gained a rule for the objective-only build: the
researcher's own statement is the source, one source description is created for
it, and every fact and relationship built from it carries a `quality: 1`
reference, exactly as for a tree import.

> **Validator request V4 — every fact and relationship is sourced**
> **Rule:** in a tree written by `init-project`, every `facts[]` entry on every
> person, and every relationship, must carry a non-empty `sources[]` whose `ref`
> names a top-level `sources[].id`, with `quality: 1`.
> **Where to look:** the after-state `tree.gedcomx.json`.
> **Why it is not judgment:** presence of an array and an integer.
> `test_id_references_resolve` already checks that a ref that *exists* resolves;
> nothing checks that one exists.
> **What a violation looks like:** `ut_init_project_006`, run
> `v1_2026-08-19_08-01-51` — `sources: []`, `F1` with no `sources` key.
> `ut_init_project_002`, run `v1_2026-08-18_12-44-49` — `R1` and `R2` unsourced.

---

## F6 — The one rule the two no-ID tests exist to check could not run, and the run said so out loud.

**Did:** `ut_init_project_002` and `ut_init_project_006`, every run:

> "`person_search` is not available in this environment — I'll proceed directly
> with stubs from the researcher's stated information."

and, in 006, having first narrated the rule correctly:

> "Now I'll search FamilySearch for Michael Brennan (**required before falling
> back to stubs**) … `person_search` is not available in this environment."

**Should:** SKILL.md, Important rules — "**No FamilySearch ID → search first.**
Call `person_search` before falling back to stubs."

**Gap — lane 2.** Neither test declared a `person_search` fixture, and and per
`orchestrator.py`'s "Permission is not existence" note ("the union lets the callee
call its tools, but only a fixture makes them resolvable") the tool was absent
from the mock server. So in the only two tests whose premise is "no FamilySearch
ID", the search could not happen, the fallback was forced rather than chosen, and
a run that skipped the search is indistinguishable from one that searched and
found nothing. Tool Arguments and Correctness both scored 3.

**Fixed here:** two nil-result fixtures added — `person-search-hennessy-none`
and `person-search-brennan-none` (`totalMatches: 0`, empty `results`, per
`person-search-tool-spec.md`'s 204 row) — and listed first on 002 and 006, with a
`judge_context` line on each naming that the search must be attempted before the
stub fallback.

> **Validator request V7 — search before stubs**
> **Rule:** on a test tagged `expects-person-search`, a run that writes at least
> one tree person must contain a `person_search` call. **Tag-gated, not derived
> from the message** — see the narrowing below.
> **Where to look:** the test's `tags` and `output.tool_calls`.
> **Why it is not judgment:** presence of a call, on a premise the test author
> declares. Stubbing a person the FamilySearch tree already holds creates the
> duplicate `merge_tree_persons` then has to undo.
> **What a violation looks like:** no instance survives — see the narrowing. The
> rule guards the case a future test will introduce: a named individual, no ID
> given, and no claim that they are absent from the tree.

**Narrowed after the 2026-08-20 annotation, and the narrowing is the point.**
The first draft read "no person ID in the message ⇒ a `person_search` call must
exist", citing 002 and 006 as violations. With the nil fixtures in place the
2026-08-20 run split them: **006 searched, 002 did not** — and the genealogist
confirmed 002's dimensions as passes. Both messages assert the same premise
(002: *"No FamilySearch tree exists for any of these people yet"*; 006:
*"No FamilySearch tree exists for him yet"*), so the ruling that follows is that
an explicit statement of absence makes the search **discretionary**: searching is
defensible diligence, and skipping what the researcher has already told you is
empty is not a defect.

So the original V7 would have **false-flagged a run the genealogist had just
confirmed** — the exact shape this repo bans, "a check that encodes a stale
design is worse than no check, because its red looks like the skill's fault".
Hence tag-gated, on the same pattern as `test_objective_default_verbatim`: the
premise stays with the test author, who knows whether the message concedes
absence, rather than in a validator parsing prose. Neither 002 nor 006 carries
the tag.

---

## F7 — The body prescribes copying `person_read`'s sources into the tree, which the write rejects.

**Did:** nothing, in the corpus — and that is the finding. SKILL.md Step 3 says
"**Include:** … all source descriptions in the top-level `sources` array", and no
fixture has ever returned a source description, so the instruction has never been
followed once.

**Should:** `docs/specs/simplified-gedcomx-spec.md` — "**`person_read` returns are
not directly persistable.** The tool's sources may additionally carry a `notes`
string array … Before any of it lands in `tree.gedcomx.json`, **drop `notes`** and
synthesize the missing ids … **both validation gates reject a verbatim copy**."
`shapeSources` and `collectNotes` in `person-read.ts` do emit `notes`;
`TREE_SOURCE_FIELDS` in `src/validation/tree-shape.ts` is
`{id, title, citation, author, url}` and `validateParsed` in `validator.ts`
enforces it, so `project_create` fails the whole write.

**Gap — lane 4.** The body warns about the closed field set only for the source
description the skill *creates* ("using only the schema-allowed fields … NO
`quality`, `notes`, `repository`, or `accessed`") and says nothing about the ones
it *imports*. Following the body literally on any real FamilySearch person with a
noted source aborts project creation.

**Fixed here:** the `Include` line now reads "… all source descriptions in the
top-level `sources` array — minus `notes`, which is not an allowed source field
and fails the write", the reference doc says the same beside the source example,
and `person-read-flynn-family.json` returns a source carrying `notes` so the rule
is exercised for the first time.

> **Validator request V6 — the note is dropped, not the source**
> **Rule:** when a `person_read` response in the run returned a source
> description carrying `notes`, the written tree must contain a source with that
> `id` **and** no `notes` key. Dropping the whole source to dodge the field
> restriction is a violation, not a fix.
> **Where to look:** `output.tool_calls[].response.sources[]` against the
> after-state tree's `sources[]`.
> **Why it is not judgment:** set membership on ids and key presence. The failure
> it guards is the plausible one — a rejected write retried by deleting the
> offending source, which silently loses the evidence the survey found.
> **What a violation looks like:** no instance yet; the path was unreachable
> before this PR added the fixture.

---

## F8 — The reference doc told the model to do the exact thing the body forbids, and the body had to spend tokens fighting it.

**Did:** `references/simplified-gedcomx-summary.md`, ID conventions:

> "FamilySearch persons: use their real IDs (e.g., `KWCJ-RN4`)"

and its person example opened `{"id": "KWCJ-RN4", ...}`, with both relationship
examples wired to `KWCJ-RN4`/`KWCJ-RN5`/`KWCJ-RN6`.

**Should:** SKILL.md Step 3 — "**ID conventions (overrides the reference doc):**
ALL persons get local `I` IDs … **Do NOT use FamilySearch PIDs as person IDs.**"
The body knew the reference was wrong and carried a parenthetical override rather
than fixing it, on a file SKILL.md instructs the model to read ("Follow
`references/simplified-gedcomx-summary.md`").

**Gap — lane 4.** The runs all got this right, so this is a latent defect rather
than an observed one — but it is a load-bearing rule whose on-demand reference
states the opposite, and the fix removes prose from the billed file.

**Fixed here:** the reference's ID-conventions section now says ALL persons take
`I` ids including FamilySearch-seeded ones, with the FamilySearch identity
travelling in `ark`; both examples renumbered to `I1`/`I2`/`I3`; SKILL.md's
"(overrides the reference doc)" parenthetical dropped.

---

## F9 — A `judge_context` bullet grades a response the harness structurally prevents.

**Did:** `negative-start-research.json` (`ut_init_project_009`), third bullet:

> "The decline should be a single-line response per the guard clause, naming
> project-status (and optionally question-selection)"

In all five committed runs `output.text_response` is the empty string, for both
negative tests. Per `orchestrator.py::_routing_short_circuit_skills`, once the
routed-to skill is invoked the run stops and the downstream skill never executes,
so there is no decline wording to read. The judge scored Correctness and
Completeness 3 both times and never remarked on the missing text.

**Should:** the guide's lane 2 — a test may not grade what it cannot observe.

**Gap — lane 2, mine.** **Fixed:** that bullet is replaced with one saying the
routing decision and the absence of init work are what is gradable here, and that
the guard clause's literal wording is not gradable on this test and must not be
scored either way. Its second bullet also listed `validate_research_schema` among
tools that must not be called; the skill has never held that tool, so that clause
is gone too.

---

## F10 — The guard clause forbade the handoff both negative tests pass by. Resolved: it is a handoff.

**Did:** in all five runs, both negative tests decline by invoking another skill —
`builtin_tool_calls: [{"tool": "Skill", "args": {"skill": "project-status"}}]` on
009, `question-selection` on 003 — and pass. The judge on 009 wrote "The skill
made no MCP tool calls (as required)", which is true of MCP tools and not of the
`Skill` call.

**Should:** SKILL.md's guard clause — "respond with exactly this and stop — **no
tool calls, no file reads** … Do NOT call any tool or read any file. Stop
immediately."

**Gap — lane 4, and the body is the stale half.** Four things point one way. The
guard's own text names two skills as the user's next move, which a handoff
delivers and a message only describes. The negative tests' `correct_skill`
machinery cannot score routing unless the skill delegates. All five committed runs
delegate, and the judge reads that as correct. And the "no tool calls" clause has
a purpose the handoff does not touch: stopping init-project from doing *its own*
work — `person_read`, `project_create` — on a populated project.

One consideration argues for keeping the message: it is the only behaviour
available when delegation is not. That is why it survives as the fallback rather
than being deleted.

**Fixed here.** The guard now reads: do not initialize, make no MCP tool call and
read no project file, hand off to **project-status** (status/resume wording) or
**question-selection** (next-question wording) in the same turn, and use the
quoted one-liner only when you cannot delegate. That also makes the guard
*countable* for the first time — zero MCP calls, zero project reads, exactly one
`Skill` call — which is why prohibition rules 1 and 2 are now marked **[V]**.

---

## F11 — The stored objective dropped the user's stated birthplace, and the judge_context only guarded the other direction.

**Did:** `ut_init_project_001`, run `v1_2026-08-19_08-01-51`. The user said
"born around 1845 **in Pennsylvania** and died 1908 in Schuylkill County". The
stored objective: *"Identify the parents of Patrick Flynn (LZNY-BRF), born around
1845, died 1908 in Schuylkill County, Pennsylvania."* — the user's stated
birthplace is gone, and "Pennsylvania" has migrated to the death. Correctness 3.

**Should:** SKILL.md Step 2 — "**Research objective:** use user's stated facts
(reflects user's understanding)."

**Gap — lane 2.** The test's `judge_context` read "the objective should reflect
that, **not FamilySearch's Ireland birthplace**". The judge checked for Ireland,
did not find it, and passed — the one failure mode the test named is the one this
run did not commit. **Fixed:** the bullet now asks whether the objective preserves
the user's own stated facts and names both departures — substituting
FamilySearch's value and dropping the user's — without saying which occurred.

**Does not convert.** Whether a paraphrase preserves a stated fact is a reading
of two sentences; leave it with the judge.

---

## F12 — `narration_guidance` is a four-way closed mapping with no guard.

**Did:** all five runs stored the correct verbatim table text for the level they
derived. No defect observed.

**Should:** SKILL.md — "Store the matching text **verbatim**", and the
opening-turn rule which explicitly compares it to the objective default: "the
same way a defaulted `narration_guidance` is stored verbatim, not paraphrased."

**Gap — a missing guard, not a failure.** The objective's identical
verbatim-string rule *has* a validator (`test_objective_default_verbatim`,
added by issue #1510 for exactly the reason "that makes it checkable in code
instead of leaving it to judge interpretation"). Its named twin does not. Five
clean runs on an unchecked invariant is the shape this dive exists to notice.

> **Validator request V5 — `narration_guidance` verbatim**
> **Rule:** `researcher_profile.narration_guidance` must be byte-identical to the
> SKILL.md table string for the stored `experience_level` — a closed four-way
> mapping (`novice`, `intermediate`, `experienced`, `professional`).
> **Where to look:** `research_json.researcher_profile` in the after-state.
> **Why it is not judgment:** a closed enum keying four fixed strings; the body
> calls the value verbatim, and `test_objective_default_verbatim` already sets the
> precedent for the identical rule on `objective`.
> **What a violation looks like:** none in the corpus. Downstream, every SKILL.md
> reads this field as its narration style, so a paraphrase degrades every later
> invocation in the project and nothing would report it.

---

## F13 — A fixture for a tool the skill cannot call.

**Did:** `forget-rederive-build-full-not-omit.json` declared
`mcp_fixtures: ["person-read-flynn", "validate-research-schema"]`.
`validate_research_schema` is not in init-project's `allowed-tools`, and the
fixture-tool allowlist union applies only to **negative** tests (the
`spec.type == "negative"` branch in `orchestrator.py`), so on this positive test the entry could never fire.

**Should:** the repo's standing rule that a check which cannot fail reads as
coverage. `rubric.md` already states the corollary — "init-project has no
schema-validation tool in its `allowed-tools`, so this is graded by reading the
file against the schema".

**Gap — lane 2, mine. Fixed:** entry removed.

---

## F14 — The body prescribed a call shape the runs do not use, and the tool never required.

**Did:** four runs across the corpus (002 twice, 005 twice) wrote the profile and
the holdings in **one** `research_append` call carrying an `ops` array —
"recording your two oral-knowledge holdings **in one atomic call**".

**Should:** SKILL.md 4a — "**Two** `research_append` calls" and "**one**
`research_append(...)` **per** reported item".

**Gap — lane 4, prose staleness.** the `ops?: ResearchAppendOp[]` field on `research-append.ts`'s input type
supports the batch form, and batching is the better call: one validated write instead of three.
The body's count is not a rule, it is a leftover, and a validator written to
enforce it would have false-flagged four correct runs. **Fixed:** 4a now says
`research_append` runs after `project_create`, never before and never bundled into
it, and that one call per section or one batched `ops` call are both fine.

---

## F15 — `stdDate` silently promotes an approximate year to an exact one, on this project's own approximate-date spelling.

Found while verifying the `standard_date` omission above, not by reading a
transcript — so it is a code finding, recorded here because it is the reason V8
matters.

**Did:** every approximation word resolves, and the one symbol does not:

```
"abt 1845"   -> "Abt 1845"        "~1845"  -> "1845"
"circa 1845" -> "Abt 1845"        "~ 1845" -> "1845"
"ca 1845"    -> "Abt 1845"        "1845?"  -> "1845 (?)"
```

`tokenize` admitted only `/ < > &` as symbol tokens, so `~` fell through its
`else { i++ }` and was discarded; the parser's symbol branch then honored only
`'<'` and `'>'`.

**Should:** `~1845` is **this project's own documented spelling** for an
approximate date — `references/simplified-gedcomx-summary.md`'s date table says
"Approximate: `~1845`", `simplified-gedcomx-spec.md` says the same, and every
init-project run writes it. `MODIFIERS` already carries `<` → `Bef` and `>` →
`Aft`, so a symbolic marker was an established shape, not a new idea.

**Gap — lane 1.** `getStandardDate` falls back to `stdDate(fact.date)`, so any
tool comparing dates read an exact 1845 where the tree said approximately 1845.
An approximate birth year treated as exact is how init-project's own
"parent-child age gaps outside 15-50 years" check returns a false verdict, and
how a merge or a conflict-detection pass calls two people distinct on a
one-year difference that was never asserted.

**Fixed here** — three lines: `~` added to the tokenizer's symbol set, to
`MODIFIERS` as `Abt`, and to the parser's symbol branch beside `<`/`>`. Verified
against a 23-case battery: `~1845` → `Abt 1845`, `~12 Mar 1908` →
`Abt 12 Mar 1908`, `~1845 (?)` → `Abt 1845 (?)`, and every other form unchanged
(`<1850` → `Bef 1850`, `1840-1850` → `Bet 1840 and 1850`, `abt`/`circa`/`ca`
untouched). One new behaviour worth knowing: `~1840-1850` now yields
`Bet Abt 1840 and 1850`, where the tilde previously vanished. Regression test in `tests/utils/date-standardize.test.ts`, pinning the four
tilde forms, four unchanged forms, **and** `~1840-1850` — the one output this fix
changes besides the bare tilde, so it cannot drift unnoticed. 159 tests in that
file pass.

**Pre-change trees need no heal rule.** CLAUDE.md's tree-change checklist asks
whether `tree-sanitize.ts` needs one; it does not, because `standard_date` is a
value rather than a shape and the healer touches shapes. But the value does move:
`person-warnings.ts` and `merge-gedcomx.ts` compare `standard_date` strings, so a
tree persisted before this fix carries `"1845"` for `date: "~1845"` while a fresh
import of the same event now carries `"Abt 1845"`, and those two no longer
string-match. The comparison is on standardized dates that both describe the same
approximate year, so the effect is a missed match rather than a false one —
recorded here because it is invisible otherwise.

**A second, smaller finding rode along:** `TreeFact` in
`src/types/person-read.ts` declared `standard_date` but **not** `standard_place`.
The field reached callers anyway because `shapePersons` narrows with a type
predicate, which does not strip properties — so a documented, load-bearing field
travelled undeclared. Declared here.

---

## Lane summary

| # | finding | lane | disposition |
|---|---|---|---|
| F1 | `ark` invented, 4 shapes, 18 writes | 4 | body + reference fixed; V2 |
| F2 | only `person_read` fixture breaks the tool contract; 7 rules never exercised | 2 | fixtures fixed (contract shape + new family fixture) |
| F3 | Tool Arguments graded against a target missing both flags | 2 | flagged fixture fixed; V1 for the general case |
| F4 | 56 invented `standard_place`; rubric told to abstain | 2 + 4 | rubric, body, reference, fixtures fixed; V3 |
| F5 | objective-only tree has no provenance; then narrated as unsourced | 4 | body fixed; V4 |
| F6 | `person_search` absent in both no-ID tests | 2 | nil fixtures added; V7 |
| F7 | prescribed source copy fails the write on `notes` | 4 | body + reference fixed, fixture added; V6 |
| F8 | reference doc contradicts the body on person ids | 4 | reference fixed, body override dropped |
| F9 | `judge_context` grades an empty `text_response` | 2 | fixed |
| F10 | guard clause forbids the handoff both negative tests pass by | 4 | resolved: it is a handoff; body fixed, guard now countable |
| F11 | objective dropped a user-stated fact | 2 | symmetric guard added; does not convert |
| F12 | `narration_guidance` unguarded | — | V5 |
| F13 | fixture for an un-callable tool | 2 | removed |
| F14 | body prescribes 3 calls; runs and tool prefer 1 | 4 | body fixed |
| F15 | `stdDate` drops `~`, promoting an approximate year to an exact one | 1 | tool + test fixed; V8 |
| F16 | `TreeFact` declared `standard_date` but not `standard_place`, which the tool returns | 1 | type declared (found in round-two critique) |
| F17 | `ark` cannot be carried and per spec cannot be absent | 4 | resolved: derived as `ark:/61903/4:1:<pid>`; body, reference and V2 updated |

**Validator requests: 8 — and all eight are now implemented, not requested.**
Per the lead's standing instruction to deep-dive authors ("if additional
validators are suggested, please include those validators in your PR or in a
follow-on PR"), they ship as code in
`eval/harness/validators/test_init_project.py`, with 45 mutation tests in
`eval/harness/tests/unit/test_init_project_provenance_validators.py` — every one
asserted to fire on the specific defect it was written for and to pass on the
shape the 2026-08-20 run actually produced.

Two things checked before committing them, because a failed validator skips the
judge and takes the grades with it:

- **Replayed against the committed run** — 96 validator/test pairs (responses
  rehydrated from the fixtures the log names, written tree from the
  `project_create` argument): 55 pass, 41 skip, **0 failures**. The next paid run
  will not lose its grades to a validator of mine.
- **Validators are not in the run-log snapshot** (fixtures, test JSONs,
  `rubric.md`, `SKILL.md` and its references are), so shipping them costs no
  second run.

Two of the eight are deliberately **weaker** than this document first proposed,
and both narrowings came from the genealogist's labels rather than from code:
V7 is tag-gated instead of message-derived, and V8 checks loss-or-alteration
instead of provenance — because the objective-only builds legitimately write
`Abt 1920` for a hand-entered `~1920` with no tool involved. The stronger forms
would each have failed a run confirmed as correct.

**V7 is dormant on the current suite** and that is stated in its docstring: no
test carries `expects-person-search`. `ut_init_project_004` is its right home,
but adding a tag edits a snapshot-tracked file and would invalidate the run this
PR just bought.

Two more shapes were considered and dropped:
a `project_create` call-count check (no observed violation, and
`test_project_files_written_through_the_writer_tools` already asserts presence),
and a stub-count check for the maiden-name rule (the "did the user imply this
person" half is a reading, not a count).

## Files changed

| file | why |
|---|---|
| `packages/engine/plugin/skills/init-project/SKILL.md` | F1, F4, F5, F7, F8, F14, and the #1700 historical-context rewrite |
| `.../init-project/references/simplified-gedcomx-summary.md` | F1, F4, F7, F8 |
| `eval/fixtures/mcp/person-read-flynn.json` | F2, F4 |
| `eval/fixtures/mcp/person-read-flynn-family.json` (new) | F2, F3, F4, F7 |
| `eval/fixtures/mcp/person-search-hennessy-none.json` (new) | F6 |
| `eval/fixtures/mcp/person-search-brennan-none.json` (new) | F6 |
| `eval/fixtures/mcp/person-search-flynn.json` | F1 (`ark` canonicalized) |
| `eval/tests/unit/init-project/new-project-from-tree.json` | F2, F3, F4, F7, F11 |
| `eval/tests/unit/init-project/no-relatives.json` | F2, F4 |
| `eval/tests/unit/init-project/negative-start-research.json` | F9 |
| `eval/tests/unit/init-project/from-objective-only.json` | F6 |
| `eval/tests/unit/init-project/place-standardization.json` | F6 |
| `eval/tests/unit/init-project/forget-rederive-build-full-not-omit.json` | F13 |
| `eval/tests/unit/init-project/rubric.md` | F4 |
| `docs/specs/person-search-tool-spec.md` | F1 — the spec example carried the resolver-prefixed `ark` the implementation strips, which is where the fixture's value came from |
| `docs/specs/person-read-tool-spec.md` | F4, V8 — the Facts table listed `type\|date\|place\|value` only, so both standardized sidecars and the pass-through fact `id` were undocumented and the worked example showed none of them. That is the document a fixture author checks against |
| `eval/harness/tests/unit/test_fixtures.py` | the acceptance check — `person_read` fixtures must match the tool's output contract, and a dated/placed fact must carry its sidecar. Both assertions proven red before the fix |
| `packages/engine/mcp-server/src/utils/date-standardize.ts`, `src/utils/date-constants.ts` | F15 |
| `packages/engine/mcp-server/tests/utils/date-standardize.test.ts` | F15 regression test |

## Also folded in

**Issue #1700's stray bullet** (moved to #1653 on 2026-08-18): the
`Historical context signals` line under `Obvious error detection`. Rewritten from
three fragments into guidance, and the signal set revisited as asked. Kept:
military age during a conflict, population movement, jurisdiction existence.
Added: **had civil registration begun there by the recorded date** — three runs
in this corpus improvised exactly that reasoning unprompted ("Irish civil
registration (begun 1864) won't cover them", `ut_init_project_006`), which is the
evidence that it belongs in the list. The jurisdiction check now says what to do
about a miss (the record belongs to the parent county or parish it split from)
rather than only asking the question.

## Cost note

Every change above lands on one `make eval-skill SKILL=init-project` run. The
snapshot was already going to flip on the SKILL.md edit; the fixture, test and
rubric edits ride free. The `stdDate` fix and the two spec edits are outside the
snapshot, so they cost nothing here.

Expect the tree written by `ut_init_project_001` to grow from one person to four
— the change most likely to move a score, so read that test first when the run
lands. And expect the two `person_read` fixtures to require both flags now: a
call that omits either gets `fixture_not_found` and is scored down on Tool
Arguments rather than silently receiving a payload it did not ask for, which is
the first time in this suite that dropping a flag has any consequence at all.

**Do not commit before the guard-clause question in F10 has an answer.** Run-log
snapshot rule 2 is blocking, so a `SKILL.md` edit landed after the paid run
invalidates that run's snapshot and buys a second one.

---

## Deferred, and both ride one future run

Two follow-ups are correct, cheap, and deliberately **not** in this PR, for the
same reason: `eval/tests/unit/init-project/**` and
`packages/engine/plugin/skills/init-project/**` are snapshot-tracked, so touching
either invalidates the run log this dive paid for and buys another
`make eval-skill SKILL=init-project`. Neither is worth ~$9 plus an annotation
pass on its own; both should land on the next run that touches the skill dir for
any other reason.

| Deferred | Why it matters | Cost if done alone |
|---|---|---|
| Tag `ut_init_project_004` with `expects-person-search` | V7 currently skips on all twelve tests. Its firing behaviour is held by mutation tests, not by the suite. | one paid run |
| Align the three `quality` examples in `references/simplified-gedcomx-summary.md` to `1` | The reference documents the field as optional and shows a `2`; `SKILL.md` mandates `1` and V4 enforces it. A model following the reference over the body fails V4. Every run in the corpus writes 1, so the trap is latent, not active. | one paid run |
| Give the resolver-miss branch a fixture, using the new `_contract_exempt` marker | `SKILL.md` tells the skill what to do when `person_read` returns a `place` with no `standard_place`; no fixture models it, so that branch is untested. The marker now makes it expressible. | one paid run |
| Add a `person-search-donovan-none` nil fixture, and correct `person-search-hennessy-none`'s description | Raised in review round 2. `SKILL.md`'s recording convention is maiden (birth) surnames for women, so the convention-following search for Sarah's mother is `surname: Donovan` — which matches no fixture and returns `fixture_not_found`, typically scored down on Tool Arguments. As it stands the fixture set **rewards a married-name search over the correct one**. The existing description also overclaims: "a search on the mother or a relative resolves too" holds only for a married-name search, since `~Hennessy` cannot match `Donovan`. | one paid run |

Both of the first two were raised in review and are recorded in the code that
depends on them — V7's docstring and V4's — rather than only here, so the next
person to open either file sees the pending edit and its reason.

---

## Review round 2 — what a second reviewer caught

Two blockers, both free (neither file is snapshot-tracked), and the first is the
third instance of this dive's own defect class:

**The lint's opt-out reintroduced the defect the lint exists to catch.** The
first draft read `_contract_exempt` from *inside* the fact. The mock serves
`response` verbatim, so the first fixture to use it would have handed the skill a
field `person_read` never returns — and `TREE_FACT_FIELDS` rejects it, so the
`project_create` write fails for a reason unrelated to what the test checks. The
marker is now a fixture-level map keyed `"owner/FactType"`, beside `response`
rather than in it: still per-fact, still explicit, still greppable, still carrying
a reason. Eight tests on synthetic fixtures pin it, including one asserting that
the inside-the-fact shape no longer suppresses anything — because the shape that
breaks the write must not be the shape the lint rewards.

**V2 failed a correct import when two persons share a name.** Keying one written
person per `(given, surname)` made a Sr./Jr. pair blame each other for their pids.
Reproduced before fixing: two returned persons sharing a name, both written with
their own correct arks, and V2 reported
`I1: ark is 'ark:/61903/4:1:LZNY-BRF', expected 'ark:/61903/4:1:LZNY-P7Q'`. A
failed validator skips the judge, so this would have cost the test its whole
grade — and it arms the first time a fixture carries same-named kin, which is
exactly what #1689 adds. Now any same-named written person carrying the expected
ark satisfies it, with three tests: the correct pair passes, a pair missing one
ark still fails, and a pair sharing one ark still fails (so the widening is not a
hole).

Also from round 2: the `1845-10` / `1900-10` split — same notation, two readings,
decided by whether the range expansion would run backwards — is now pinned by a
test rather than left as an undocumented surprise.
