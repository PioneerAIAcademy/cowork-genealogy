# Resolve #1025 (documented-negative citation shape) + implement #970 (record-hint ark lint)

Closes #1025. Implements #970.

## Context

#970 requires that a resolved `genre: "record-hint"` e2e fixture cite a
resolvable FamilySearch ark (`ark:/61903/...`) in `supporting_sources`, so a
fabricated citation is checkable by a reviewer in one click instead of being
byte-identical to a real one. #1025 raised a genealogist's-call question
that blocked #970 from landing: a **documented negative** makes two
different claims — the disproving record (real, ark-able) and the absence
itself ("no record establishes X," which by definition has nothing to cite)
— and #970's lint needed to know which one the ark requirement attaches to.

**Decision (this PR):** the ark attaches to the disproving record only. The
absence is written as plain prose (ideally naming the collection/date range
searched) and is exempt. The lint is satisfied by a single ark anywhere in
the fixture's findings, not one per finding — this was already the shape of
#970's proposed check ("at least one `supporting_sources` entry on at least
one finding"), so the decision required no change to the check's mechanics,
only to how fixture authors and the skill use it.

## What changed

### Spec: `docs/specs/e2e-test-spec.md`
- New **§3.6.1 Citation shape for documented negatives (decision, issue
  #1025)**: states the disproving-record-vs-absence split and how a fixture
  satisfies the ark requirement.
- Added #970's own tradeoff note alongside it: the ark must be the full
  `ark:/61903/...` path, not a bare `XXXX-XXXX` id — a bare id matches
  collection date-range tokens on their own and is shape-identical to a
  FamilySearch tree PID, so it doesn't prove a record was actually checked.
- Updated the `supporting_sources` field-table row to point at §3.6.1.

### Skill: `.claude/skills/resolve-record-hint/SKILL.md`
- Step 3 (getting the outcome from the genealogist): for a false-match
  resolution, now asks for the disproving record **and its resolvable ark**,
  separately from confirming what was searched and came up empty. Explicit
  note that the absence itself never gets an ark, and a tree PID /
  `source_pid` is not an acceptable substitute.
- Step 4 (writing the files): the `avoid`/required pair write-up now
  specifies which finding gets the ark (the one naming the disproving
  record) and which carries the absence in prose only.

### Validator: `eval/harness/e2e/validate_fixture.py`
- New hard-error check, `record_hint_citation_errors(fixture_dir,
  expected_findings)`: for a fixture whose `fixture.json` has
  `genre == "record-hint"` and whose `README.md` does **not** contain
  `DRAFT PENDING ADJUDICATION` (the existing definition of "unresolved"),
  requires at least one `supporting_sources` entry, on at least one
  finding, to contain a literal `ark:/61903/`. A bare id does not satisfy
  it. Missing/unparseable `fixture.json`/`README.md` short-circuits to no
  error (other checks own those failures).
- Wired into `lint_fixture` alongside `finding_shape_errors`, so it's a
  hard error (exit 2 / fails the corpus test), not a `Suspect`.
- Module docstring updated to describe the new check under gate 2
  (structural integrity).

### Tests: `eval/harness/tests/unit/test_e2e_validate_fixture.py`
8 new tests covering: skip on non-record-hint genre, skip on draft
(`DRAFT PENDING ADJUDICATION` present), hard error when resolved with no
ark anywhere, hard error on a bare id, pass when the ark is on a different
finding than the absence claim (the #1025 split), and two `lint_fixture`-
level integration tests (fails without an ark, passes with one).

`test_e2e_fixture_corpus.py` needed **no changes** — it already asserts
`lint_fixture(...)` returns no errors for every committed fixture, so the
new check is picked up automatically by the existing corpus-wide gate.

### Fixtures

**`eval/tests/e2e/elisabetha-sugecz-parents/`** — was still `DRAFT PENDING
ADJUDICATION` (never actually adjudicated in this checkout, despite #1025
treating it as settled). Resolved per #1025's stated facts: the 1786
baptismal hint would make Elisabetha ~51 at her own last recorded child's
1837 baptism. Rewrote `expected-findings.json` as an `avoid` + required
pair, citing the real, already-in-tree ark for that 1837 baptism
(`ark:/61903/1:1:QKMN-LM5B`) as the disproving record; the absence
("no baptism/marriage in the collection establishes her parents") is
prose only, no ark. Updated `README.md` (removed the draft marker, wrote
the resolution) and `fixture.json`'s `notes`.

**`eval/tests/e2e/anna-macek-son/`** — already resolved but had no ark.
Added the real, already-in-tree ark for the disproving 1871 marriage
record (`ark:/61903/1:1:6PFD-Q43C`) to its existing `supporting_sources`
prose.

**`eval/tests/e2e/joseph-david-daughter/`** — already resolved but had no
ark. Added the subject's own real 1901 census entry ark
(`ark:/61903/1:1:XSMQ-X77`) as the disproving record (the subject's real
household, distinct from the false-hint household at Merthyr Tydfil).

**`eval/tests/e2e/estefania-zambrana-son/`** — already had two bare ids
(`QL7X-YN65`, `QGJC-FX3Y`) from its original PR (#927). Expanded both to
full `ark:/61903/1:1:...` paths in all three places they appear.

## Testing

- `eval/harness/tests/unit/test_e2e_validate_fixture.py` —
  41 passed (33 existing + 8 new).
- `eval/harness/tests/unit/test_e2e_fixture_corpus.py` — 199 passed overall
  (combined with the file above), 9 failed (see "Not done" below;
  expected and intentional).
- `python -m e2e.validate_fixture --all` run directly against the full
  corpus: exactly 9 `ERROR` lines, all on the fixtures listed below, zero
  unexpected errors anywhere else in the ~160-fixture corpus.
- Confirmed no regressions: `heinrich-zinsmeister-death` (already had an
  ark, out of scope) and every non-record-hint fixture are untouched and
  still pass.
- `eval/harness/e2e/judge_prompt.md` is untouched (verified by mtime and
  content), per #970's explicit "do not change" instruction.

## Not done — 9 fixtures still need their real ark

Per #970's own retrofit list, minus the 2 fixed above (`anna-macek-son`,
`joseph-david-daughter`), the following resolved record-hint fixtures cite
a disproving/supporting record in prose that has **no ark anywhere in this
checkout's committed data** (checked each against
`starting-tree.gedcomx.json`, `unstripped-tree.gedcomx.json`, and
`starting-research.json`). Rather than guess a plausible-looking ark —
exactly the fabrication risk #970/#971 exist to catch — these are left
failing the new lint, flagged for their original authors to supply the
real citation:

- `cornelius-booysen-death`
- `eulogia-gatica-burial`
- `isabel-carvajal-daughter`
- `mary-kavanaugh-son`
- `pierre-desobry-spouse`
- `pierre-tullier-son`
- `sebastiana-sandoval-daughter`
- `susanna-dawson-marriage`
- `thomas-seaver-other-wife`

These 9 will fail `make harness-test`'s corpus gate until someone with the
original research supplies each ark — that failure is the lint working as
intended, not a bug in this PR.

## Notes for reviewers

- `git status`/`git diff` hung in the sandbox this work was done in, so I
  could not attach a machine-generated diff stat here — please verify the
  file list against this summary directly.
- `record_hint_citation_errors` cannot verify an ark actually resolves to
  the record claimed (no FamilySearch token in CI) — same accepted limit
  #970 already documents for the check as a whole.
