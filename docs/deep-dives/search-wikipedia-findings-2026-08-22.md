# Deep dive: search-wikipedia — findings and validator requests

Issue #1662. Guide followed: `docs/skill-deep-dive-guide.md`.
Prohibition list: [`search-wikipedia-prohibition-list.md`](./search-wikipedia-prohibition-list.md).

**Corpus read:** all four committed run logs,
`eval/runlogs/unit/search-wikipedia/v1_2026-06-12_17-45-48.json` through
`v1_2026-07-28_09-35-42.json` — 9 tests, 43 runs, and the four `.ann.json` files
beside them. `text_response`, `tool_calls` and `files_created` were read for
every run before any score, per Step 2. **In the newest run all nine tests pass
clean**, so the whole suite is a quiet pass and Step 3's "spend most of your time
here" applies to all of it.

**The grep the issue prescribed returns 0 files.** Confirmed. The score-branch
leak takes a different shape here, and it is worth naming because it is not the
one the grep looks for: the leak is not in a `judge_context` at all. It is that
`rubric.md` named a failure mode — a slug "derived from the query instead of the
returned title" — that **no test in the suite could produce** (F3), while a
second rubric dimension graded a filename that eight validators already decide
(F8). The judge was pointed at the skill's *claim* about a file it was told it
could not see (F4). Same defect as the worked example, one level up: not "the
judge takes the branch it was shown" but "the judge grades the artifact it was
shown, and it was shown the wrong one."

**Dimensions that never discriminate — 2 of 5, exactly as the issue said,**
measured across all 43 runs:

| dimension | scores ever seen | n |
|---|---|---|
| rubric / **Slug correctness** | `3` only | 27 |
| base / **Tool Arguments** | `3` or `null` only | 43 |

`Tool Arguments` cannot discriminate for a structural reason worth recording:
every fixture predicate in this suite is a `~` substring match
(`fixtures.matches` — "String values prefixed with `~` are case-insensitive
substring matches"). The predicates are `~census`, `~Einstein`,
`~Naturalization`, `~Schuylkill`, `~Kirchenbuch`, `~O'Brien`, `~Great Famine`.
"Did the query contain the obvious keyword" is the whole test, and three of the
seven positive tests' `judge_context` say so outright ("the exact form matters
less"). That is a deliberate authoring choice for a one-tool skill, not an
accident — but it means the dimension reports coverage it does not have. F8's
replacement dimension is aimed at what is actually gradeable here.

---

## What this skill is, and why it shapes every finding

`wikipedia_search` is **not a search.**
`packages/engine/mcp-server/src/tools/wikipedia.ts` fetches
`https://en.wikipedia.org/api/rest_v1/page/summary/{query}` and returns exactly
one `{title, extract, url}`. There is no result list, no ranking, and no
disambiguation — a query either resolves (possibly through a redirect) or 404s.

So the skill has three moving parts: one tool call, one saved file, one sentence.
Nine tests and eight validators covered the first and the third. **The second —
the file, which is the entire deliverable — was covered by nothing** (F4), and
its filename half was covered twice over while its contents half was covered not
at all.

---

## F1 — The invariant that decides a negative test cannot fail on the clause the test itself calls "the real harm"

**Did:** `ut_search_wikipedia_007` is `grade_on_invariant: true`, so its whole
verdict is `test_no_wiki_no_write`. That validator's docstring says it

> "Fails iff the run: made a `wikipedia_search` MCP call (the lookup was
> executed), **or** wrote a new `.md` file (the summary was saved)."

The first half is false. The test declared `mcp_fixtures: []`;
`mock_mcp.create_mock_server` builds its tool list from `manifest.items()`, and
`build_manifest` is fed only the fixtures the test declares. So
`wikipedia_search` was registered on no mock server, the model was never offered
it, and the validator — which reads `tool_calls`, the mock's own call log — had
nothing to see. Verified directly against the real mock: with `mcp_fixtures: []`
the server advertises zero tools; with one `wikipedia_search` fixture it
advertises the tool and a violating call lands in `tool_calls`.

**Should:** the test's own `judge_context` states the rule it exists to enforce —
*"The real harm this test guards against is search-wikipedia EXECUTING a
wikipedia_search and SAVING a summary for a request that belongs to
historical-context. That is what the validator fails on."* And SKILL.md's scope
guard: *"Decline — do **not** call `wikipedia_search`, do not start the workflow
below."*

**Gap:** lane 2. Fixed by declaring `wikipedia-search-any` on the test, which
registers the tool so the assertion can fire.

**This was already ruled on, and the ruling pointed here.** Issue #1788 measured
the population on 2026-08-21 and names `ut_search_wikipedia_007` as 1 of 7 such
tests (1 of 5 still to repair), with the slot noted as *"held — issue #1662 (In
Progress). Wait, or ask #1662 to carry it."* This PR carries it, which is why it
also lands #1788's spec edit (below). The finding was derived independently here
before #1788 was read; that it converges on the same fix is the useful part.

**One thing #1788 does not spell out, and the implementer should know: the
"before" state is worse than a silent pass.** If the harm actually happened, the
call would go to a tool the mock does not advertise, so `orchestrator.py`'s Phase
2 gate classifies it **Type 1** — `aborted_reason = "unmatched_tool_call"`,
documented in-file as *"(test corpus issue, exit 2)"* and in `eval/CLAUDE.md` as
belonging *"to whoever wrote the test."* A genuine violation of the skill's scope
guard therefore surfaces as a **corpus bug**, and the natural repair a reader
reaches for — add the missing fixture — is indistinguishable from making the
forbidden call legal. The fix in this PR is that same edit made deliberately,
which is why both new negative tests say so in their `description` and their
`judge_context`: so the fixture is not later removed as dead weight.

> **Validator request V1 — a `grade_on_invariant` test's asserted tool must be
> reachable in that test**
> **Rule:** when `negative.grade_on_invariant` is true, every tool named in the
> tag-gated validator's assertions must be registered for that test — present in
> its own `mcp_fixtures`, or in `mock_mcp.LIVE_TOOLS`.
> **Where to look:** the test JSON's `mcp_fixtures`, `mock_mcp.LIVE_TOOLS`, and
> the gated validator body.
> **Why it is not judgment:** both sides are enumerable from the repo; the mock
> advertises exactly `manifest.items()` plus `LIVE_TOOLS` and nothing else.
> **What a violation looks like:** `ut_search_wikipedia_007` before this PR.
> **Status: the lead has ruled against building this.** #1788 says "**No lint** —
> the population is known and enumerated," and prescribes the spec sentence
> instead. Recorded here because the *rule* is the durable artifact even where the
> checker was declined, and because that decision rests on the population being
> closed — if `grade_on_invariant` spreads, revisit it.

---

## F2 — Two tests were written as slug regression checks, named their expected slug in a tag, and the tag reached no validator

**Did:** `ut_search_wikipedia_009` carries `"slug-kirchenbuch"` and says *"the
slug should be just 'kirchenbuch' with no hyphens."* `ut_search_wikipedia_010`
carries `"slug-naturalization-act-of-1906"` and says *"'Naturalization Act of
1906' should produce slug 'naturalization-act-of-1906'."* There was no
`test_slug_kirchenbuch` and no `test_slug_naturalization_act_of_1906`. Read from
the newest run log, every slug validator reports
`skipped: not a slug-<other>-scenario` on both tests. Their filenames were graded
only by `Slug correctness`, the dimension that has scored 3 in all 27 of its
evaluations.

**Should:** the tag *is* the activation mechanism for the other four slug
validators (`test_slug_albert_einstein` and siblings all gate on exactly this
shape). A test that adopts the convention and gets nothing is worse than one that
does not, because the tag reads as coverage.

**Gap:** lane 2. Both validators written. But the instance fix is not the
interesting half — see V2.

> **Validator request V2 — derive the expected slug from the returned title, so
> no test needs a tag**
> **Rule:** on any positive search-wikipedia test, the saved filename must equal
> `slugify(title) + ".md"`, where `title` is the title the tool response returned
> and `slugify` is SKILL.md step 4 (lowercase; every run of non-alphanumeric
> characters becomes one hyphen; trim leading/trailing hyphens).
> **Where to look:** `after_state["files"]` for the new `.md`, and
> `tool_calls[].response.title` for the title — the mock writes the served
> response onto each call-log entry (`mock_mcp.py`,
> `entry["response"] = response`), so no fixture file needs re-reading.
> **Why it is not judgment:** the algorithm is three deterministic string
> operations, fully specified in the body, with three worked examples.
> **What a violation looks like:** any run saving `potato-famine.md` for the
> returned title `Great Famine (Ireland)`.
> **Status: implemented in this PR** as `test_slug_matches_returned_title`, which
> needs no tag and therefore closes the class rather than the two instances. The
> eight literal `test_slug_*` checks are deliberately **kept** alongside it: a bug
> in the validator's own `_slug_from_title` would otherwise pass itself, and the
> literals are the only thing that would catch that. **One thing it deliberately
> does not decide** — see F9.

---

## F3 — Not one test in the suite could detect a slug built from the query instead of the returned title, including the two labelled regression checks

**Did:** `rubric.md`'s `Slug correctness` **partial** branch named the failure
mode by name: *"slug derived from the query instead of the returned title."* I
checked all seven positive tests by slugifying both the query the model actually
sent and the title the fixture returned. **In every one, both produce the
identical string.** The two tests whose stated purpose is slug normalization are
the clearest cases:

| test | stated purpose | query sent | query slug | title returned | title slug |
|---|---|---|---|---|---|
| `_003` | *"a topic whose title contains parentheses, testing slug normalization"* | `Great Famine Ireland` | `great-famine-ireland` | `Great Famine (Ireland)` | `great-famine-ireland` |
| `_004` | *"apostrophe + parentheses … a regression check on the slug rule"* | `O'Brien surname` | `o-brien-surname` | `O'Brien (surname)` | `o-brien-surname` |

`test_slug_great_famine_ireland` and `test_slug_obrien_surname` assert the right
string and pass for the wrong reason: neither the parenthesis nor the apostrophe
is ever actually exercised, because the model's own phrasing already collapses to
the same slug. The same holds for `_001`, `_002`, `_005`, `_009`, `_010`.

**Should:** SKILL.md step 4 is explicit — *"Build `<title-slug>` from the article
title"* — and `rubric.md` graded a deviation from it. A rubric branch whose
population is empty is the guide's worked-example pattern at suite scale.

**Gap:** lane 2. Fixed with a new positive test, `ut_search_wikipedia_p4t`
(`slug-title-not-query-potato-famine.json`), and a new fixture,
`wikipedia-search-potato-famine.json`. The researcher asks for *"the potato
famine"*; the summary endpoint follows the real redirect and returns `Great
Famine (Ireland)`. Query slug `potato-famine`, title slug
`great-famine-ireland` — the first test in the suite where the two differ, so the
first where the rule is falsifiable. Two fixtures are declared so either phrasing
resolves to the same article and the assertion bites regardless of how the model
words its query. The topic was the genealogist's call: it is the phrasing a
researcher actually types, and the redirect is real.

Covered by V2, which fails this exact shape with a message that names the cause.

---

## F4 — Nothing read the saved file. The judge was told to grade the skill's claim about it instead.

**Did:** the file is the whole deliverable, and eight validators existed without
one of them opening it. `rubric.md` told the judge, twice, to grade the claim:

> "this skill writes a standalone markdown file that does not appear in the file
> changes summary. **Judge file creation from the text response and tool call**,
> not from the file changes section."

and `_009`/`_010` repeated it per-test: *"If the skill called wikipedia_search
successfully and **its text response confirms** saving a file with a correctly
slugified name, treat file creation as fully successful."*

The judge genuinely cannot see the file — `orchestrator.py` builds `file_changes`
from `research.json` and `tree.gedcomx.json` only. **Validators can.**
`workspace.snapshot_files` walks the whole workspace and stores each file's
complete text (`snap["files"][rel] = path.read_text(encoding="utf-8")`), and
`orchestrator.py` passes that dict straight into `before_state` / `after_state`.
The contents were one dictionary lookup away for the entire life of the suite.

**Should:** SKILL.md step 3 is the strongest prohibition in the body — *"Use the
exact values from the tool response. Do not paraphrase, summarize, truncate, or
editorialize the extract. **Copy it verbatim.**"* Nothing enforced it. A
paraphrased extract, a truncated extract, mangled Unicode, a dropped `[Source]`
line, an appended editorial paragraph, a fabricated second URL, or an **empty
file** all passed, provided the reply claimed a save with the right name.

Genealogically this is the finding that matters most: a Wikipedia extract saved
into a project folder is a quotable source note. If it is silently a paraphrase,
the researcher later cites it as though it were the encyclopedia's wording, and
nothing in the file says otherwise. The genealogist's call on this dive was
byte-identical, not approximate.

**Gap:** lane 2 plus a validator gap. Fixed — see V3.

> **Validator request V3 — the saved file is the filled template, verbatim**
> **Rule:** on a positive test, the new `.md` must equal
> `"# {title}\n\n{extract}\n\n---\n[Source]({url})"` built from the `title`,
> `extract` and `url` of the `wikipedia_search` response that run received,
> matching `templates/wiki-summary.md`. Trailing whitespace tolerated; nothing
> else.
> **Where to look:** `after_state["files"]` against `tool_calls[].response`.
> **Why it is not judgment:** both sides are literal strings already present in
> the run's own inputs. Nothing is interpreted, and the comparison is the one the
> judge is structurally unable to make.
> **What a violation looks like:** no run in the committed corpus is provably one,
> because nothing recorded file contents — which is the finding. The validator was
> proven failable against seven hand-built corruption shapes (paraphrase,
> truncation, em-dash mangling, dropped Source line, fabricated extra URL,
> appended editorial, empty file).
> **Status: implemented in this PR** as `test_saved_file_matches_template`. **It
> found a real defect within minutes of existing** — see F5.
> **Lift it, next:** issue #1755 request 1 asks for exactly this shape for
> `search-familysearch-wiki` and calls it *"the one that matters most."* Both
> skills save a standalone `.md` that no grader reads. The helper here is ~40
> lines and skill-specific only in the template string.

---

## F5 — The new file validator immediately caught a stub in the harness's own test suite that claimed one thing and wrote another

**Did:**
`eval/harness/tests/unit/test_orchestrator.py::test_judge_error_in_run_records_skip_with_error`
loads `simple-topic-lookup.json` and stubs the run. It wrote a file about
Schuylkill County while declaring the tool had returned `{"title": "X"}`. Its own
comment explains the file exists *"so the search-wikipedia validators … pass —
otherwise this test would exercise the validator-failed branch instead of the
judge-error branch it is meant to cover."*

**Should:** a stub that satisfies the validators by coincidence stops satisfying
them the moment a validator checks the thing the stub was incoherent about. The
stub asserted a tool response and a file that could not both be true.

**Gap:** lane 2, in the harness rather than the corpus. Fixed in this PR by making
the stub self-consistent — one `stub_response` dict now feeds both the written
file and the recorded `tool_calls` entry — so the test still exercises the
judge-error branch it is for. Recorded as a finding because it is the cheapest
available evidence that V3 has teeth: it went red on the first thing it was
pointed at that was actually wrong.

---

## F6 — Two of the scope guard's three named branches had no negative test at all, and both had been deleted

**Did:** SKILL.md's scope guard names three diversions — historical-context,
locality-guide, search-familysearch-wiki. Only historical-context had a test. Both
others once did:

- `negative-search-wiki-boundary.json` (`ut_search_wikipedia_006`, FamilySearch
  wiki) — deleted in `6283a3e6`, 2026-06-15, as a duplicate of
  `search-familysearch-wiki`'s own positive test.
- `negative-locality-guide-boundary.json` (locality-guide) — deleted in
  `badb0b0c`, 2026-06-12, and **its test id `007` reused** for the
  historical-context test that stands there now.

Neither deletion was wrong on its own terms. The net effect was that the only
surviving branch test was the one whose tool clause could not fire (F1).

Worth recording from the historical record: in `v1_2026-06-12_17-45-48`, while
`_006` still existed, the skill **called `wiki_search`** on the FamilySearch-wiki
request. The judge scored Correctness 1 and Completeness 1, with the rationale
*"It called mcp__genealogy__wiki_search instead of declining."* **The test outcome
was `pass`.** Three days later the test was deleted.

**Should:** `docs/specs/unit-test-spec.md` § 6, "Boundary testing pattern": *"For
each confusable pair, create tests from both directions."*

**Gap:** lane 2. The locality-guide branch is restored as
`ut_search_wikipedia_k7v` — the genealogist's call, on the ground that a Wikipedia
county article is genuinely half-useful for a records question, which is what
makes that near-miss the tempting one. It pairs directly against positive test
`_001`: **same place, opposite verdict.**

**It turns out the other side already existed.** `ut_locality_guide_003`
("Wikipedia summary request should not trigger locality-guide") uses the same
county and asks the mirror question, declaring
`correct_skill: ["search-wikipedia"]` — pointing at a search-wikipedia test that
had not existed since June. `check_negative_reciprocity.py` was already warning
about it. Measured: unreciprocated edges **45 → 44**, total edges 83 → 84. The new
test does not add a one-directional edge; it closes one.

**The FamilySearch-wiki branch is left open, deliberately.** Restoring it would
re-create the duplication `6283a3e6` removed, and the right shape — a
`no-wiki-no-write` negative that is *not* a copy of the other skill's positive
test — needs a distinct user message a genealogist should choose. It is not in
this PR and is called out in the handback below.

---

## F7 — Mid-workflow narration reached the user's reply, on a run that scored 3 on every dimension

**Did:** `ut_search_wikipedia_010`, run `v1_2026-07-28_09-35-42`, full
`text_response`:

> "Now I'll write the filled template to a file in the working folder.Saved the
> Wikipedia summary to `naturalization-act-of-1906.md`."

Two sentences, the first of which is the skill narrating its own next step (and
running into the second without a space). All five dimensions scored 3.

**Should:** SKILL.md step 5 — *"Tell the user the file was created. **One sentence
only**"* — and *"Do not restate, summarize, or paraphrase the article content."*
Prohibition-list rule 18.

**Should also be noted:** this is a *known* regression shape for this skill, not a
novelty. Commit `1b9e0ebf` (2026-07-29) records that `_002` had *"flaked to
partial on an older skill version that **narrated mid-workflow**; the current
skill already guards that."* The guard is the prose in step 5. It was not followed
here, one day before that commit, and nothing graded it.

**Gap:** lane 2, and specifically **not** lane 4. The rule is already in the body,
stated plainly, in the numbered step it governs. The guide is explicit that
restating a rule the skill ignored is not the fix. What was missing is a grader.
Fixed by adding a `Reply economy` dimension to `rubric.md` whose `partial` branch
names mid-workflow narration; `_010`'s run would score 2 under it. The
genealogist's call was judge-only, not a validator, because sentence counting is
brittle around abbreviations, backticked filenames and decimals, and a false
positive here would fail a correct run.

> **Validator request V4 — the reply does not narrate a step it is about to take**
> **Rule:** the reply of a positive search-wikipedia run contains no first-person
> announcement of a pending action ("Now I'll …", "Let me …", "I will now …", "I'm
> going to …"). The reply is a report that the file exists, not a plan to write it.
> **Where to look:** `output.text_response`.
> **Why it is not judgment:** a fixed phrase list, matched literally; it says
> nothing about whether the sentence is *good*.
> **What a violation looks like:** `ut_search_wikipedia_010`, run
> `v1_2026-07-28_09-35-42`, quoted above.
> **Status: implemented — after the paid run, and because of what the paid run
> measured.** See "What the paid run changed" below. The original reasoning here
> was that a phrase list is mechanical but is not the *rule* ("one sentence,"
> which is not), so encoding the proxy risks failing a correct reply. The run
> settled it the other way: the judge dimension caught **one of two** instances
> and, on the miss, produced a rationale quoting a reply it had not been given.
> The dimension is kept as well — it grades the restating-content half that no
> phrase list can reach.

---

## F8 — The harness warned 33 times across five run logs that this rubric grades no tool work. Nothing acted on it.

**Did:** every positive run in every committed run log carries a
`missing_tool_usage_dimension` warning — 6, 7, 7, 6, 7 across the five logs, 33 in
total. Its text: *"Skill called MCP tools but the rubric has no dimension name
suggesting tool-usage coverage … The judge will grade other dimensions but won't
score tool work explicitly."* `runnability.has_tool_usage_dimension` matches
`rubric.md`'s dimension names against `TOOL_DIMENSION_KEYWORDS`; "Template
fidelity" and "Slug correctness" match none of them.

**Should:** the warning is the harness's own advisory and it was correct. The only
nominal cover was base `Tool Arguments`, which is one of the two dimensions that
never discriminates, for the `~`-predicate reason given at the top.

**Gap:** lane 2. `rubric.md` rewritten to three dimensions:

| dimension | why it can fail |
|---|---|
| **Template fidelity** | narrowed to fabrication, which the judge *can* see in the reply. The file-contents half moved to V3, and the preamble now tells the judge so. |
| **Tool query and response interpretation** *(replaces Slug correctness)* | the query can miss the article; the skill can re-query to "correct" a title; it can flag the query-vs-title difference as a problem instead of proceeding. `ut_search_wikipedia_p4t` exists precisely to put a title different from the query in front of it. |
| **Reply economy** *(new)* | F7 scores 2 under it. |

`Slug correctness` is retired rather than reworded: after this PR every positive
test's filename is decided by `test_slug_matches_returned_title` plus a literal
check, and the judge prompt already says *"Deterministic checks (**filename
format**, schema validity, exact tool call counts) are verified separately by
validators."* The dimension was grading, badly, the one thing the judge is told
not to grade. Verified after the rewrite: `has_tool_usage_dimension` is now
`True`, so the 33-warning backlog closes.

`rubric.raw` is what reaches the judge (`judge.py`, `rubric_text = rubric.raw`),
so the new preamble is in the prompt, not just in the file.

---

## F9 — The slug rule was undefined for an accented title, and no test could have said so

**Did:** building V2 required deciding whether a title's own non-ASCII letters
are "alphanumeric" under SKILL.md step 4, and the body does not say.
`Württemberg` slugifies to `w-rttemberg` under a literal reading of
`[^a-z0-9]+`, to `württemberg` under a Unicode-aware class, and to
`wurttemberg` under transliteration. **Nothing in the corpus distinguished the
three** — every one of the seven titles present is ASCII, so all readings agreed
on all of them, and `Slug correctness` scored 3 on every one.

**Should:** step 4 is stated as a total rule — *"replacing every run of
non-alphanumeric characters … with a single hyphen"* — with no carve-out and no
example that settles it. Read literally it produces `w-rttemberg.md`, a filename
no researcher would connect to the article. That is not a rule the skill was
ignoring; it is a rule that did not exist for the case.

**Gap:** lane 4, and the one place in this dive where prose was the right
answer — see the lane note below for why a tool rule was not available. Three
lines added to step 4 naming the transliteration and two worked examples
(`Württemberg` → `wurttemberg`, `Preußen` → `preussen`). The genealogist's call
was ASCII transliteration rather than preserving the accents, on portability
grounds: a shared research folder gets read by Windows, macOS and whatever
tooling the researcher points at it.

**One subtlety that a half-implementation would have got wrong.** A Unicode
decomposition alone is not enough. `NFKD` splits `ü` into `u` + a combining
diaeresis and `ó` into `o` + an acute, so dropping combining marks handles
those — but it does **not** decompose `ß`, `ł`, `ø`, `æ` or `œ` at all, so those
would fall through to `[^a-z0-9]+` and become hyphens: `Preußen` → `preu-en`,
`Łódź` → `-od`. The validator carries an explicit `_TRANSLITERATE` map for the
non-decomposable letters, applied *before* NFKD. Verified across 16 cases: nine
accented titles spanning German, Polish and Scandinavian forms, plus all seven
titles already in the corpus, which are unchanged.

Pinned by `ut_search_wikipedia_w8m` (`slug-accented-title-wurttemberg.json`) and
a new fixture. Württemberg is the right subject on the genealogy: it is a
heavily-emigrated German state whose `Familienregister` and
`Auswanderungsakten` are exactly what a researcher tracing a 1840s departure
needs, so the test doubles as a realistic request rather than a synthetic
umlaut. Its extract carries `ü`, `ö` and `ß`, which gives V3's verbatim check
something to lose — and V3 does go red when the extract's `ü` is rewritten as
`ue`.

---

## F10 — Checked, and it dissolves. Recorded because the check is what makes the rest trustworthy.

The newest run log has been **inactive on `main` since 2026-07-29**:
`diff_snapshot_vs_disk` reports `content-differs` on
`packages/engine/plugin/skills/search-wikipedia/SKILL.md`, a file this PR does not
touch. So rule 2 has been red for this skill for three weeks, invisibly, because
nobody has touched it since.

The first reading — that the transcripts describe a superseded skill body and the
whole dive is measured against the wrong prose — is **wrong**, and it matters
enough to check rather than assume. Hashing each historical version of `SKILL.md`
through `snapshot.normalize` against the run log's own snapshot entry: the runs
exercised the body as of `1b9e0ebf` (2026-07-29), and the sole difference from
`main` is `c1fc2a4c` (2026-08-09), *"skills: delete the 26 dead `model:` pins"* — a
one-line frontmatter deletion of `model: claude-sonnet-4-6`, which the run log's
own `model` field confirms is the model it ran on anyway.

So the staleness is behaviour-neutral, the transcripts do reflect the current
scope guard, and every finding above stands on the prose in the body today. This
is the `eval-cosmetic-skip` case exactly — and moot for this PR, which owes a
fresh run regardless.

---

## Lanes, at a glance

| # | Finding | Lane | State |
|---|---|---|---|
| F1 | invariant's tool clause cannot fail | 2 | fixed (carrying #1788) |
| F2 | two slug tags gate no validator | 2 | fixed + class closed (V2) |
| F3 | no test detects a query-derived slug | 2 | fixed (new test + fixture) |
| F4 | nothing reads the saved file | 2 | fixed (V3) |
| F5 | incoherent stub in the harness's own test | 2 | fixed |
| F6 | 2 of 3 scope-guard branches untested | 2 | one restored, one handed back |
| F7 | mid-workflow narration scored all 3s | 2 | fixed (dimension **and** V4 validator) |
| F8 | 33 unactioned tool-dimension warnings | 2 | fixed (rubric rewrite) |
| F9 | slug rule undefined for accented titles | **4** | fixed (SKILL.md + V5) |
| F10 | run log stale since 2026-07-29 | — | dissolved on checking |

**Nine of ten findings are lane 2, and one is lane 4.** Nothing landed in lane 1
or 3. No tool defect was found: `wikipedia.ts` is 60 lines, calls
`fetchWithTimeout` with a documented 60s budget measured off the e2e corpus, and
throws a readable error on 404. There are no record types here, so lane 3 is
empty by construction.

**Exactly one finding earned a SKILL.md edit, and the distinction is the whole
lane rule.** F7 and F9 look alike — both are about a rule the body states in step
4 or 5 — and they land in different lanes:

- **F7 is lane 2.** The rule was there, worded correctly, in the step it governs
  (*"One sentence only"*), and the skill did not follow it. The guide is explicit
  that restating a rule the skill ignored is not the fix. What was missing was a
  grader, so the fix is a rubric dimension and **no body change**.
- **F9 is lane 4.** The rule was *absent for the case* — an accented title had no
  defined slug under any reading of step 4. There was nothing to restate. Per
  CLAUDE.md's lane-4 rule the tool-rule question was asked first and answered no:
  ADR-0011's test is whether the rule can be decided by reading the project
  documents alone and enforced in a writer tool, and this skill has no writer
  tool — its output is a loose `.md` written with `Write`, not a
  `research_append` payload with a precondition to hang the rule on. So prose was
  the only place it could live, and it is three lines plus two examples.

The other eight findings changed grading, fixtures, tests or validators, and left
the body alone.

---

## Validator requests, summarised

The guide's measure for a dive is requests, not findings. Five, of which three are
implemented here, one is ruled out by the lead, and one is handed over with its
own boundary argued:

| | Rule | Status |
|---|---|---|
| **V1** | a `grade_on_invariant` test's asserted tool must be reachable in that test | rule recorded; checker **declined by the lead** (#1788: "No lint"), spec sentence landed instead |
| **V2** | the filename is `slugify(returned title)`, derived — no tag | **implemented**, closes F2's class |
| **V3** | the saved `.md` is the filled template, verbatim from the tool response | **implemented**; **lift to `search-familysearch-wiki`** (#1755 request 1) |
| **V4** | the reply does not narrate a pending step | **implemented**, after the paid run overturned the judge-only call |
| **V5** | an accented letter in the title becomes its ASCII base, never a hyphen | **implemented** inside V2's `_slug_from_title`, pinned by a literal check |

> **Validator request V5 — accented titles transliterate**
> **Rule:** the slug of a title containing an accented or non-English letter
> replaces that letter with its ASCII equivalent (`ü`→`u`, `ó`→`o`, `å`→`a`,
> `ł`→`l`, `ß`→`ss`, `ø`→`o`, `æ`→`ae`), never with a hyphen. `Württemberg` →
> `wurttemberg.md`.
> **Where to look:** the new `.md` basename in `after_state["files"]` against
> `tool_calls[].response.title`.
> **Why it is not judgment:** a character map plus a Unicode decomposition;
> nothing is interpreted.
> **What a violation looks like:** `w-rttemberg.md`, or `württemberg.md` on a
> filesystem that then renders it inconsistently.
> **Status: implemented in this PR**, in `_slug_from_title` and pinned literally
> by `test_slug_wurttemberg`. **The rule it enforces did not exist until this
> PR** — see F9, which is why this one needed a genealogical decision before any
> Python could be written, and why V2 shipped with the ASCII-only reading and a
> docstring disclaiming it until that decision was made.

---

## Fixes made in this PR

**Tests** (`eval/tests/unit/search-wikipedia/`)

- `negative-historical-context-boundary.json` — `mcp_fixtures: []` →
  `["wikipedia-search-any"]`, so F1's dead clause fires. `description` and
  `judge_context` say why the fixture is expected to go unused.
- `negative-out-of-scope.json` — gains the `no-wiki-no-write` tag and the same
  fixture, **without** `grade_on_invariant`, so its routing gate
  (`correct_skill: []` requires `skills_invoked == []`) stays in force and the
  invariant is purely additive.
- `negative-locality-guide-boundary.json` — **new**, `ut_search_wikipedia_k7v`.
  Restores F6's deleted branch; completes the `ut_locality_guide_003` pair.
- `slug-title-not-query-potato-famine.json` — **new**, `ut_search_wikipedia_p4t`.
  The only test where query slug ≠ title slug (F3).
- `slug-accented-title-wurttemberg.json` — **new**, `ut_search_wikipedia_w8m`.
  The only test with a non-ASCII title (F9).
- `general-topic-us-census.json` — gains `slug-united-states-census`; it was the
  last positive test with no slug assertion of any kind.
- `rubric.md` — rewritten, 2 dimensions → 3 (F8).

**Skill body** (`packages/engine/plugin/skills/search-wikipedia/SKILL.md`) — three
lines and two examples added to step 4's slug rule, for F9. The only body change
in this PR, and the only finding of the ten that earned one.

**Fixtures** — `eval/fixtures/mcp/wikipedia-search-potato-famine.json` and
`eval/fixtures/mcp/wikipedia-search-wurttemberg.json`, both new.

**Validators** (`eval/harness/validators/test_search_wikipedia.py`) — 8 → 14:
`test_slug_kirchenbuch`, `test_slug_naturalization_act_of_1906`,
`test_slug_united_states_census`, `test_slug_wurttemberg`,
`test_saved_file_matches_template`, `test_slug_matches_returned_title`,
`test_reply_does_not_narrate_pending_step` (V4, added after the paid run).

**Harness** — `text_response` is now supplied to validators:
`validator_runner.py`, the `run_validators` call site in `orchestrator.py`,
`validators/conftest.py`, and the contract docstring in `test_universal.py`.
Pinned behaviourally by
`test_orchestrator.py::test_orchestrator_passes_text_response_to_validators`
plus two injection tests in `test_validator_runner.py`.

**Harness test** — `test_orchestrator.py`'s stub made self-consistent (F5).

**Spec** — `docs/specs/unit-test-spec.md`: the missing `grade_on_invariant` row in
the `negative` field table, and the reachability sentence, in both the prose table
and the JSON-schema description. #1788 assigns this to the first of its five PRs;
PR #1766 (convert-dates) carries no spec change, so this is it.

### Every new check was proven to fail

Per CLAUDE.md, "A new lint must be proven to fail." Each was driven with crafted
before/after states before being committed:

- The new validators: **19/19** cases behaved as intended — correct input passes,
  each defect shape fails with a message naming the defect, and the tag/type
  guards skip rather than pass silently.
- `test_slug_matches_returned_title` separately: **15/15** — the query-derived slug
  fails, all seven titles already in the corpus pass unchanged, and raw spaces, a
  double hyphen, an untrimmed trailing hyphen, a generic `wikipedia.md` and a
  non-lowercased name each fail.
- The transliteration (V5): **16/16** — nine accented German, Polish and
  Scandinavian titles produce the intended slug, and all seven existing corpus
  titles are byte-identical to before, so F9's rule change moves no existing
  expectation.
- The accented-title checks: **6/6** — `w-rttemberg.md` fails both the literal and
  the generic slug check, and V3 goes red when the extract's `ü` is rewritten as
  `ue`.
- F1's fixture change was verified against the real mock: with `mcp_fixtures: []`
  the server advertises no tools; with the fixture it advertises `wikipedia_search`
  and a violating call is recorded in `tool_calls`. Re-checked after all edits: all
  three `no-wiki-no-write` tests report the invariant live.

Suite-level, after every edit: **12 tests, all loading, all schema-valid against
`unit-test.schema.json`, all passing `check_runnable`.**

`make harness-test` — 2570 passed, 3 skipped. `ruff check` clean.
`check_runlogs`, `check_tool_coverage`, `check_rubric_tool_drift`,
`check_skill_frontmatter` and `check_negative_reciprocity` all run; no new warning
is attributable to this PR, and the reciprocity count improves.

---

## Handback — not in this diff

1. **F6's FamilySearch-wiki branch.** Needs a user message that is not a copy of
   `search-familysearch-wiki`'s positive test, which is a genealogist's call.
2. **V3 lifted to `search-familysearch-wiki`** — issue #1755 request 1, already
   filed there, already budgeted a run.
3. ~~V4~~ — implemented after the run; see "What the paid run changed".

Per CLAUDE.md these are one comment each on the issues that already cover them
(#1788, #1755) plus this document, not three new issues. Item 1 belongs to
whichever card next takes this skill's eval slot, since they cannot ride this PR's
run without re-flipping the snapshot.

**One thing worth flagging for whoever reviews the board rather than this PR.**
`check_negative_reciprocity.py` also warns that `translation → search-wikipedia`
is one-directional: `ut_translation_003` declares `correct_skill:
["search-wikipedia"]` and no test here points back. That is a fourth handback, and
it is *not* in this PR for the same slot reason — but unlike the others it is
already reported by a lint on every eval PR, so it does not need this document to
be remembered.

## Cost

One `make eval-skill SKILL=search-wikipedia` run, as the issue budgeted. Every
finding was batched into it, which is the point of one task per skill. The suite
goes **9 tests → 12**. Annotation is 5 sampled tests and ~3 sentences since PR
#1637. `eval/runlogs/unit/` retention keeps the newest 5 candidates, so the run
will prune the oldest and its `.ann.json`; commit the deletions.

Two of the three new tests are the cheapest kind to add: `p4t` reuses an existing
fixture alongside its new one, and `w8m`'s fixture is the only wholly new payload.
Neither needs a scenario — this skill is stateless.

---

## What the paid run changed

Run `v1_2026-08-22_10-20-08`, 12 tests, **11 pass / 1 partial**, $0.74, 113s
wall. Everything above was written before it; this section is what it added or
overturned.

**The suite went from 9/9 green to 11 pass / 1 partial, and that is the point.**
The partial is `ut_search_wikipedia_001` scoring **2 on Reply economy** for
exactly F7's defect:

> "Now I'll write the filled-in template to the file.Saved the Wikipedia summary
> to `schuylkill-county-pennsylvania.md`."

That test scored 3 on every dimension in the previous run. It is not a
regression — the reply was already like this, and nothing was looking. Per the
lane rule prose cannot fix it (the rule is already in step 5 and was ignored),
so the partial should stay visible rather than be argued away.

**Three findings are now confirmed by measurement rather than by argument.**

- **F3 held, and for the right reason.** `p4t` sent `"potato famine"`, matched
  the potato-famine fixture, and saved **`great-famine-ireland.md`**. The
  query/title divergence was genuinely exercised — worth checking, because a
  model that normalised its own query would have dodged the test the same way
  the seven pre-existing tests dodged it.
- **F9 held.** `w8m` sent `"Württemberg"` and saved **`wurttemberg.md`**.
- **F8 is closed, measured.** The run's warnings dict is **empty**. The
  `missing_tool_usage_dimension` warning that fired 33 times across five run
  logs is gone.
- **F4's validator ran on all nine positive tests and passed on all nine.** So
  the skill does copy the extract verbatim in practice. That is a real result:
  the rule was being followed all along and nothing could show it.
- **F1's repair is live.** `test_no_wiki_no_write` ran (not skipped) on all
  three negatives. `_007` came back `activated: true` and still passed, which is
  what `grade_on_invariant` is for now that its validator can fail.

**One thing the run overturned: V4 should exist after all.** The judge scored
the identical defect two ways in the same run:

| test | reply | Reply economy |
|---|---|---|
| `_001` | "Now I'll write the filled-in template to the file.Saved the Wikipedia summary to `schuylkill-county-pennsylvania.md`." | **2** |
| `p4t` | "Now I'll fill in the template and write the file.Saved the Wikipedia summary to `great-famine-ireland.md`." | **3** |

Same shape, same run-together punctuation, same run. And `p4t`'s rationale is
not a defensible reading — it is wrong about the text:

> "The response is exactly one sentence: 'Saved the Wikipedia summary to
> `great-famine-ireland.md`.'"

It quoted a response that was not the response. A check that fires on half its
population and asserts the opposite on the other half is weaker than either a
reliable check or none, so V4 is now implemented as
`test_reply_does_not_narrate_pending_step`. The narration rate across the run's
nine positive replies is **2 of 9**, and the same shape appeared on `_010` in
the 07-28 run, so this is persistent across runs and tests rather than
test-specific.

**V4 needed a harness change, and the change is the interesting part.** No
validator could read the reply: `run_validators` supplied `before_state`,
`after_state`, `tool_calls`, `skill_frontmatter`, `skills_invoked`,
`blocked_context_calls`, `blocked_protected_writes` and `test` — not
`text_response`. Adding it took four sites (`validator_runner.py`,
`orchestrator.py`'s call site, `validators/conftest.py`, and the contract
docstring in `test_universal.py` plus the spec's fixture list), and it is now
available to every skill's validators. Several skill bodies state a reply-shape
rule that today only a judge grades.

**Two traps hit while proving it, both worth recording because both are on
CLAUDE.md's list of ways a check silently passes.**

1. **The first version of V4 could not have run at all.** It declared
   `**kwargs` to reach `text_response`, and `_run_module` marks a validator
   **failed** when it declares a parameter the harness cannot supply — it would
   have errored on every run, not skipped. Caught by reading the injector before
   trusting the signature.
2. **The first plumbing guard could not fail.** It asserted the string
   `text_response=result.text_response` appears in `orchestrator.py`. That
   string appears **three times** in that module — `derive_activated`,
   `run_validators`, and `grade` — so removing the `run_validators` one leaves it
   green. This is CLAUDE.md's "field-name match that collides with an unrelated
   key," and it was replaced with a behavioural test that monkeypatches
   `run_validators` and asserts the reply arrives. Proven by deleting line 465
   and watching it go red.

   A third, smaller one: the first attempt to *break* the plumbing was a
   `\n`-anchored string replace against a **CRLF** file. It matched nothing and
   printed a success message anyway. The break has to be verified, not just
   attempted.

**V4 does not skip on an empty reply, deliberately.** A positive run with no
reply is itself a step-5 violation, and skipping would make the validator inert
the moment the harness stopped supplying `text_response` — the same silent-pass
shape as F1. Its failure message names both causes.

**The committed run log carries no result for V4**, since the validator
post-dates the run. On that run's data it would have failed `_001` and `p4t`.
**The next run will report those two as failures rather than one partial** until
the narration stops. That is intended and is stated here so it is not read as a
new regression.

### Run-log housekeeping

`v1_2026-06-12_17-45-48.json` was pruned by the retention rule (newest 5
candidates). **F6 cites it** for the `_006` evidence — the run where the skill
called `wiki_search` on the FamilySearch-wiki request, scored 1/1, and passed
anyway. The quotes here are the surviving record of it; the file is gone from
`main` after this commit.

Final offline state: `make harness-test` **2573 passed, 3 skipped**; `ruff`
clean; 12 tests loading, schema-valid and runnable; V4 proven across **21/21**
cases including the two real replies from this run and the historical `_010`
one.
