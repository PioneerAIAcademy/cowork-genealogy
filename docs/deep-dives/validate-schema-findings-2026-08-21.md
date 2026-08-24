# Deep dive: validate-schema — findings and validator requests

Issue #1658. Guide followed: `docs/skill-deep-dive-guide.md`.

**Corpus read:** `eval/runlogs/unit/validate-schema/v1_2026-08-01_05-51-49.json` (newest,
10 tests, 1 run each), model `claude-sonnet-4-6`. Recurrence and discrimination were
checked across **all five** committed run logs (`v1_2026-06-15`, `-06-24`, `-07-19`,
`-07-22`, `-08-01`). Transcripts read before scores. Prohibition list:
`validate-schema-prohibition-list.md`.

**Starting numbers, verified:** the newest run is **10 pass / 0 fail**, every graded
dimension a 3. The prescribed grep — `judge_context` naming a `score N` branch — returns
0 files; confirmed.

**Validator input contract — and the fact that dominates this dive.** A validator
receives exactly `before_state`, `after_state`, `tool_calls`, `skill_frontmatter`,
`skills_invoked`, `blocked_context_calls`, `blocked_protected_writes`, `test`
(`validator_runner.py` `available_args`; declaring any other parameter hard-fails the
validator, the #1764 trap). **There is no `text_response` input — a validator cannot read
the skill's natural-language report at all.** Each `tool_calls` entry carries
`tool` / `args` / `response` (the in-process call retains the live
`validate_research_schema` output; the persisted run log strips it — F3). The consequence
runs through everything below: validate-schema's whole job is the *report it writes*, and
that report is invisible to every deterministic validator. So most of what this skill can
get wrong is judge-only, not mechanizable — which is the honest headline of this dive, and
why it yields exactly one validator (V2, implemented in this PR).

**Dimensions that never discriminate — 3 of 6, as the issue states.** Across all five
committed run logs, three dimensions have **never** scored below 3:

| dimension | ever scored 1 or 2 across the 5 run logs? |
|---|---|
| base / Completeness | no |
| base / Tool Arguments | no |
| rubric / Read-only discipline & scope adherence | no |

The other three *have* moved — `Correctness`, `Tool-response interpretation`, and
`Fix-suggestion specificity` all scored 1 or 2 in `v1_2026-07-22` on the two
reference-error tests (`007`, `008`). So this is not a suite that can never fail; it is one
where the three dimensions above cannot, because a read-only single-tool skill has almost
no way to fail them — and most of what *would* fail them is already locked (see F1).

---

## F1 — The three non-discriminating dimensions are structural for a read-only single-tool skill; their mechanical halves are already locked except read-only for sidecars.

**Did:** `Tool Arguments` is 3 on every graded test — the only call is
`validate_research_schema({ projectPath })`, which is trivially well-formed.
`Read-only discipline & scope` is 3 on every test — no run wrote any file
(`file_changes` is absent on all 10). `Completeness` is 3 on every test. None has taken a
non-pass value in five run logs.

**Should:** a dimension that cannot move cannot report a regression (guide, Step 3). Where
the failure mode is mechanical, Step 6 says convert it to a validator rather than lean on a
dimension that never fires.

**Gap — lane 2, mostly already closed.** Not a rubric-wording bug. The mechanical halves
are largely locked already: `test_tool_allowlist` (universal) and
`test_only_calls_validate_research_schema` (`test_validate_schema.py`) pin the tool set, and
`test_does_not_modify_project_files` pins that `research.json` and `tree.gedcomx.json` are
byte-identical before/after. **The one uncovered hole:** that read-only check compares only
the two main files — it never inspects the `files` map, so a built-in `Write` to a
`results/` sidecar (exactly where `ut_009`'s error lives) would pass every existing guard.

> **Validator V2 — read-only extends to sidecars and any other file (implemented in this PR)**
> **Rule:** for a positive validate-schema run, `after_state["files"]` must equal
> `before_state["files"]` — no file added, modified, or removed (in particular no
> `results/*.json` sidecar). This complements `test_does_not_modify_project_files`, which
> guards only `research.json` and `tree.gedcomx.json`.
> **Where to look:** the `before_state` / `after_state` inputs, specifically their `files`
> map (a `{path: content}` dict that includes `results/*.json` sidecars).
> **Why it is not judgment:** a dict-equality check on a literal input.
> **What a violation looks like:** none in the corpus — closes the sidecar hole that the
> whole-file check leaves open, on the one skill whose job is to *report* sidecar errors,
> not fix them.
> **Implemented as:** `test_does_not_modify_sidecars_or_other_files` in
> `eval/harness/validators/test_validate_schema.py`, with direct coverage in
> `eval/harness/tests/unit/test_validate_schema_validator.py` (unchanged files pass;
> added/removed/modified sidecar fails; negative tests skip; main-JSON edits stay with
> `test_does_not_modify_project_files`).

---

## F2 — On the dangling-reference error, the newest run relayed the field as `sourceId` (camelCase) when it is `source_id`, and the judge passed it. Judge-only; not a validator.

**Did:** `ut_validate_schema_007` (error-dangling-reference). The scenario's `research.json`
has `assertions[0]` with `"source_id": "src_999"` (a dangling reference). In the **newest**
run (`v1_2026-08-01`) the skill's response said the assertion *"has a `sourceId` (or
equivalent source reference field) pointing to `src_999`."* The field is `source_id` —
snake_case, as all `research.json` fields are — not `sourceId`, and the parenthetical "or
equivalent" is the tell that the skill guessed rather than reading the validator's actual
error path. `Tool-response interpretation & error explanation` scored that run a **3**.

**This is a single-run slip, not a recurring defect.** Checked across all five logs, the
same test named the field **correctly** (`source_id`) in `v1_2026-06-15` and `v1_2026-07-22`
and did not surface the camelCase form in the others; only the newest run got it wrong. The
important part is not a trend — it is that in the run being annotated, the interpretation
dimension gave an inaccurate field name a passing score, and the judge had the ground truth
in hand when it did (it renders `response_summary` from the live tool `response` at grade
time). The other five error tests named their fields correctly (`information_quality`,
`rationale`, `person_evidence[0].id`, `gedcomx_source_description_id`, `returned_count` all
verified against the scenarios).

**Should:** rubric "Tool-response interpretation" pass requires surfacing *"which object,
which field, what value."* A paraphrase into an inaccurate field name is, in the rubric's own
words, "paraphrased into something inaccurate" — not a clean pass. A researcher told to fix
`sourceId` will search for a field that does not exist.

**Gap — lane 2, judge-only, does not convert.** A validator cannot check this: the skill's
report is `text_response`, which is **not a validator input** (see the input contract above),
so no deterministic check can compare the report's field name against the validator's actual
error. The rubric already requires the correct field, so this is a judge *application* miss
with the ground truth in hand, not a wording gap — restating the rubric would not fix it
(guide: "do not add prose for a rule it already contains"). This finding stays with the
judge; the only path to mechanizing it is the harness change in F3.

---

## F3 — validate-schema's report-quality behavior is un-mechanizable two ways at once, so faithfulness rests entirely on the live judge.

**Did:** the three rubric dimensions all grade the skill's *report* — did it faithfully
surface and explain the validator's errors, name both files on a clean pass, suggest a
correct fix. Two independent gaps mean nothing but the live judge can check any of that:

1. **Validators cannot read `text_response`.** It is absent from `available_args`
   (`validator_runner.py`); a validator declaring it hard-fails. So no deterministic check
   can look at the report the skill produced.
2. **The committed run log strips the tool `response`.** `output.tool_calls` keeps
   `tool` / `args` / `matched` / `response_fixture` and omits `response`
   (`orchestrator.py`); for the live `validate_research_schema` call the entry is just
   `{ matched: {kind:"live"}, response_fixture: "live:validate_research_schema" }`. So a
   human doing the blind rule-3 annotation sees the skill's prose but **not** the validator
   errors it was relaying — the faithfulness grade rests on whether the prose merely *looks*
   specific, which is how F2's wrong field name passed.

The judge alone escapes both: it grades against the in-process `response_summary` at run
time. So faithfulness is checkable by neither a validator (no report access) nor a blind
annotator (no validator result in the log) — only by the judge, which passed F2.

**Should:** at least one of the two audiences that are supposed to catch a bad report — a
deterministic validator, or a blind annotator — should be able to see what it is grading.

**Gap — harness/tooling, not a per-skill fix, and not a validator request.** The
information exists at run time; it is the harness contract that hides it. **Harness
recommendation (a recommendation, not an existing capability and not something a validator
can do today):** to make validate-schema's faithfulness mechanizable, the harness would need
to (a) **expose `text_response` as a validator input**, and (b) **persist `response_summary`
on each run-log `tool_calls` entry** (at least for live tools) so blind annotation is not
blind. Both are out of scope for this genealogist dive; recorded here so the developer
picking up V2 sees why V2 is the *only* thing that converted. Per the CLAUDE.md ladder this
rides the same conversation rather than its own issue.

---

## F4 — On a clean project the skill asserts "no warnings," which it does not check. Judge-only; not a validator.

**Did:** `ut_validate_schema_001` and `_002` (clean-pass) close with *"No errors, no
warnings."* validate-schema checks schema only; genealogical **warnings** are
check-warnings' job (SKILL.md Scope). `Read-only discipline & scope` scored 3 on both.

**Should:** the skill should confirm what it actually checked (required fields, enums,
ID-prefixes, cross-file references) and not imply a warnings pass it never ran.

**Gap — lane 2, judge-only, does not convert.** Two reasons it stays with the judge: the
phrase "no warnings" is ambiguous (the validator may itself surface schema-level warnings),
and — the governing reason — the check would have to read `text_response`, which is not a
validator input. The related clean-pass rule the SKILL.md *does* state — name **both**
`research.json` and `tree.gedcomx.json`, not a bare "valid" — is real and currently
unchecked, but it too lives in the report and so cannot be a validator for the same reason.
Both are recorded for whoever next edits the body or tunes the rubric; neither converts, and
neither on its own justifies a paid run.

---

## Lane summary

| # | Finding | Lane | Converts |
|---|---|---|---|
| F1 | 3 of 6 dims never discriminate (Completeness, Tool Arguments, Read-only & scope); mechanical halves mostly locked except read-only for sidecars | 2 | **V2 (implemented in this PR)** |
| F2 | Newest run relays `sourceId` for a `source_id` error and the judge passes it (single-run slip; correct in earlier runs) | 2 | — (judge-only; validators can't read `text_response`) |
| F3 | Report-quality/faithfulness is un-mechanizable two ways — validators can't read `text_response`, and the run log strips the tool `response` | harness | — (harness recommendation) |
| F4 | Clean pass asserts "no warnings" (not checked) and the "name both files" rule is unchecked | 2 | — (judge-only; both live in `text_response`) |

**Validators from this dive: V2 — one, implemented in this PR.** That is the honest yield:
validate-schema is a pure report-writing skill, and validators are blind to the report, so
only its *state side-effects* (which, being read-only, amount to "changed no file") are
mechanizable — and V2 closes the one hole in that (sidecars). Two candidate checks were
**not** added, already covered by existing validators:

- **"no MCP tool other than `validate_research_schema`"** — `test_only_calls_validate_research_schema`
  (`test_validate_schema.py`) + the universal `test_tool_allowlist`.
- **"no edit to `research.json` / `tree.gedcomx.json`"** — `test_does_not_modify_project_files`
  (`test_validate_schema.py`); V2 extends only the uncovered `files`/sidecar half.

And two findings that might look convertible are deliberately **not** validator requests,
because a validator cannot read the skill's report: the faithful-error-relay check (F2) and
the clean-pass "name both files" check (F4). They stay with the judge until the F3 harness
change lands.

## Fixes made this session

**V2 implemented (F1).** Added `test_does_not_modify_sidecars_or_other_files` to
`eval/harness/validators/test_validate_schema.py` — a positive-run check that
`after_state["files"]` equals `before_state["files"]`, failing on any file added, removed,
or modified (including `results/*.json` sidecars). It is additive to the existing
`test_does_not_modify_project_files` (which guards research.json / tree.gedcomx.json via
their own snapshot keys, not the `files` map) and does not weaken it. Direct coverage added
in `eval/harness/tests/unit/test_validate_schema_validator.py` (6 tests: unchanged-files
pass; added / removed / modified sidecar fail; negative-test skip; main-JSON edits ignored
here and left to the other validator), because `pyproject.toml`'s `testpaths = ["tests"]`
means `validators/` is not collected by `make harness-test` — so a validator added to close
an unfalsifiable check would itself go unexercised without a direct test.

**No grading-prose fix, deliberately.** No `judge_context` score-branch leak (grep returns
0), and `rubric.md` is not mis-written — "Tool-response interpretation" already requires the
correct field, so F2 is a judge *application* miss with the ground truth in hand, which
restating the rubric would not fix (guide: "do not add prose for a rule it already
contains"). F2 and F4 stay judge-only and F3 stays a harness recommendation; none is
converted to a validator. **No file under `eval/tests/unit/validate-schema/`, the skill
body, the rubric, or any fixture is edited**, so this dive flips no run-log snapshot (see the
cost note).

## Cost note

This PR adds `docs/deep-dives/` files plus a validator and its unit test under
`eval/harness/` — and requires **no paid `make eval-skill SKILL=validate-schema` run**. The
run-log snapshot (`check-runlogs` rule 2) covers `plugin/skills/<skill>/**`,
`eval/tests/unit/<skill>/**`, and referenced fixtures — **not** `eval/harness/validators/**`
or `eval/harness/tests/**` — so editing a validator marks no skill "touched" and invalidates
no run log. The new validator is exercised for free by the `pytest` job
(`testpaths = ["tests"]` collects `eval/harness/tests/unit/test_validate_schema_validator.py`;
6 pass locally); it is a `nothing-checks` guard — CI is green today while the sidecar-write
path is otherwise uncaught. F3 remains a harness recommendation (expose `text_response` to
validators; persist `response_summary` on run-log `tool_calls`) — not a validator and not an
existing capability.
