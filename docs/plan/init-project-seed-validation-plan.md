# Init-project seed validation — plan

**Status:** DRAFT, implementation-ready. Every claim checked against `main` with
file:line citations. Revised twice after independent adversarial reviews (§8).
**Goal:** Close the gap where `init-project` — or any skill that writes a
project file *from scratch* — can land an invalid `research.json` /
`tree.gedcomx.json` on disk with no validate-before-persist, because the
universal routing guard skips when there is no `before_state` to diff against.
**Issue:** #987 (promoted from `docs/TODOs.md`).

---

## 1. Problem

`init-project` hand-serializes both project files with the `Write` built-in,
not a writer MCP tool (`allowed-tools` = `person_read` / `person_search` /
`place_search`; the writes are SKILL.md Steps 3-4). So the seed write never
passes through validate-before-persist.

The guard meant to catch this,
`test_project_file_changes_route_through_writer_tools`
(`eval/harness/validators/test_universal.py:574`), **skips** on a from-scratch
write: a file is "diffable" only when both before and after are non-`None`
(595-611), and a new project has no `before` (`snapshot_files` sets the key to
`None` when the file is absent, `harness/workspace.py:189-206`), so it
`pytest.skip`s (613-614). init-project's unit tests run with `scenario=None`
(empty workspace), so `before` is genuinely `None`.

## 2. What is already covered — and the narrow gap that remains

- **Output schema validity is already checked, path-agnostically.**
  `test_research_json_validates_schema` / `test_tree_gedcomx_json_validates_schema`
  (`test_universal.py:60,78`) run against the schemas on `after_state`, skipping
  only when a file is absent from the output — so they run for init-project.
  ut_002's cited harm (a name with no `given`) is a schema violation
  (`tree-gedcomx.schema.json:57`) and fails there today. These are jsonschema
  only (`schema_validator.py`, `Draft202012Validator`), so no reference integrity.
- **Intra-`research.json` reference integrity is already checked,
  path-agnostically**, by `test_id_references_resolve(after_state)`
  (`test_universal.py:160`) — ~13 foreign keys. (Caveat: its `known_ids` is
  built from `REQUIRED_SECTIONS` only, so `evaluations`/`localities` ids are not
  covered — not init-project-relevant, but the coverage is not total.)

**The genuinely-uncovered gap for a from-scratch write is therefore:**
1. **tree-internal** reference integrity — dangling `ParentChild`/`Couple`
   endpoints, tree `source` refs → `sources[]`;
2. **cross-file** integrity — `subject_person_ids`, `known_holdings.relates_to_person_ids`,
   `person_evidence.person_id`, `timelines.person_ids` → tree persons, and
   `sources[].gedcomx_source_description_id` → tree sources
   (`validator.ts:1391-1420` via `person-id-refs.ts:17-22`);
3. **ancestry cycles** (`validator.ts:1332,1350`);
4. **duplicate ids** — which, note, the TS validator does **NOT** catch either
   (`validateGedcomx` only `.add()`s ids, never `.has()`-checks; the healer's
   "duplicate ids still hard-fail" comment at `tree-sanitize.ts:17` is
   aspirational — the test that "proves" it bundles a dangling ref).

For init-project specifically, (2) is the **most probable** defect: it
hand-writes `subject_person_ids: ["I1"]` and `known_holdings[].relates_to_person_ids`
as local `I` ids that must match the minted tree stubs (`SKILL.md:171,175`).

## 3. The issue's two options (both confirmed not-cheap / not-standalone)

- **Option 1 (writer tool for the seed):** every writer tool requires an
  existing project and throws otherwise (`research-append.ts:322`,
  `tree-edit.ts:166`, `materialize-facts.ts:113`). Needs new tooling.
- **Option 2 (un-skip the routing guard):** fires on init-project's own tests
  (zero writer calls) → forces Option 1's new tooling. Closes the class but
  strands the instance.

## 4. Recommended — Option C-SSOT: run the compiled TS `validateParsed` on `after_state`

A universal after-state validator that drives the **single source of truth**
(the same TS validation the `validate_research_schema` tool uses), skipping only
when a file is genuinely absent — caller/path agnostic, so it holds for
init-project's `Write`, a future from-scratch skill, or a hand-edit. This closes
gaps (1)–(3) with **no second implementation to drift**.

**Entry point: `validateParsed(research, tree)` — no `projectPath`.**
`validateParsed` (`validator.ts:177-219`) runs research + `validateGedcomx` +
`validateCrossFile` unconditionally and only touches disk for **sidecars** when
a `projectPath` is passed (`:210`). Calling it *without* `projectPath` gives
full structural + reference + cross-file + cycle validation on the two parsed
objects, with **no temp dir** and **no sidecar-integrity blast radius**.

**The bridge already exists.** `mock_mcp.py:445-508` already spawns
`node --input-type=module --eval` against the compiled `build/` for the live
validate tool; `LIVE_TOOLS` drives 8 compiled tools this way. The new validator
reuses that exact pattern, but imports `validateParsed` from
`build/validation/validator.js` and passes `after_state`'s two parsed objects
(via stdin) instead of a `projectPath`. No new open question here — the earlier
draft's "pivotal unknown" was already solved shipped code.

**Three mandatory additions the naive version misses:**

1. **A duplicate-id check** (persons at least; relationships/sources are cheap
   to add). `validateParsed` does not provide one (§2.4), so C-SSOT alone leaves
   gap (4) open. This is a small, unavoidable Python supplement — the
   "zero second implementation" claim holds for (1)–(3) but not (4).
2. **Register the validator in `FILE_VALIDITY_VALIDATORS`**
   (`harness/orchestrator.py:112-118` — the **unit** harness, *not* `e2e/`,
   where that line range is `BLOCKED_TREE_TOOLS`) so the intentionally-invalid
   fixtures (`mid-research-flynn-dangling-ref`/`-broken-fk`/`-cross-file`, run
   with `intentionally_invalid: true`) stay exempt. Universal validators run in
   the **unit** harness only (`validator_runner.run_validators` ← `orchestrator.py:412`;
   the e2e path never calls it), which is exactly where init-project is tested.
3. **Skip-not-fail when the compiled `build/` is absent or the `node` bridge
   errors.** `build/` is deliberately not in the run-log snapshot (`eval/CLAUDE.md`
   "Snapshot model") and the harness does not rebuild it; a missing build makes
   the live handler return `{valid:false, errors:["…build not found…"]}`
   (`mock_mcp.py:457-464`), which must be read as **skip**, not a validation
   failure, or the whole suite reds on any un-built machine.

C-min (a pure-Python tree-only re-port) is **not** adopted as a co-equal
fallback: for init-project it would miss the likeliest defect — the cross-file
`subject_person_ids`/`relates_to_person_ids` → tree checks it explicitly
excludes (§2.2). It is retained only as a theoretical option if a hard
dependency on the compiled `build/` is later deemed unacceptable.

What Option C deliberately does **not** deliver: the write-*path* guarantees
(id-allocation, `.bak`, reject-before-persist timing) — those need Option 1's
seed tooling and are separate from the ut_002 harm. Option 2 + a seed tool can
layer on later if path-enforcement is decided to be the goal.

## 5. Risks

- **Blast radius is a near-certainty.** Scenario fixtures are validated only
  against jsonschema today (`test_scenario_fixtures.py:25-28`, `runnability.py:124-146`
  both call the `Draft202012Validator`). Running full `validateParsed` on every
  `after_state` will red any of the ~70 non-invalid scenarios carrying a latent
  cross-file / tree-ref / cycle problem jsonschema cannot express. Expect to
  **fix real fixture bugs** the run surfaces (that is the guard working), not to
  heal-or-subset them away. Using `validateParsed` *without* `projectPath` keeps
  sidecar-integrity checks (`validator.ts:1422-1579`) out of the blast radius.
- **Build dependency** (addition 3): C-SSOT's verdict now depends on an artifact
  outside the run-log snapshot. Skip-not-fail bounds the downside; note it
  explicitly so a green run on an un-built machine is understood as "not run,"
  not "passed."

## 6. Sequencing

1. Add the `node`-bridge helper that imports `validateParsed` from `build/` and
   validates two parsed objects (reuse `mock_mcp.py`'s spawn pattern); return
   `[]` / skip-sentinel when `build/` is absent.
2. Add the universal after-state validator: skip when either file is absent or
   the build is missing; else assert `validateParsed` returns no errors; plus
   the supplemental duplicate-id check (addition 1).
3. Register it in `harness/orchestrator.py`'s `FILE_VALIDITY_VALIDATORS`
   (addition 2).
4. Run the **full** unit suite. Triage every new red: fix genuine fixture bugs;
   only if a failure is a legacy shape the writers would have healed, decide
   heal-then-validate vs. scope — do not narrow coverage to hide a real defect.
5. Add init-project regression tests: a from-scratch write with (a) a dangling
   `ParentChild` endpoint, (b) a `subject_person_ids` id absent from the tree,
   and (c) a duplicate person id each fail; a clean seed passes.
6. Defer Option 2 + a seed writer tool to a follow-up, only if write-path
   enforcement (not just validity) is the decided goal.

## 7. Decision (resolved 2026-07-31, DallanQ)

**Go with Option C (the after-state validator), and fix the fixtures it
surfaces.** Running the compiled `validateParsed` over the Python jsonschema
mirror is endorsed on its own merits (it covers the cross-file checks Python
does not). The seed writer tool + Option 2 (un-skip) are **deferred to a
separate issue**: they are needed regardless for the standalone-skill case
(generating a timeline without `/research` or `/init-project`, where every skill
assumes `research.json` exists), which Dallan is filing; the un-skip waits on
that. **Scope of THIS task: the after-state validator only.**

## 8. Adversarial review findings incorporated

Two independent fresh-context passes verified every claim against `main`.

Pass 1 (reshaped the recommendation): reusing `tree_integrity_errors` would red
~70/75 fixtures via its e2e-only `living: false` rule and misses cycles +
cross-file; research-side integrity is already covered by
`test_id_references_resolve`; a new validator must join `FILE_VALIDITY_VALIDATORS`.
→ dropped `tree_integrity_errors` reuse; narrowed the gap.

Pass 2 (firmed C-SSOT, fixed three defects): the bridge already ships and
`validateParsed` (no `projectPath`) is the clean no-disk entry; `validateParsed`
does **not** catch duplicate ids (needs a supplement); `FILE_VALIDITY_VALIDATORS`
is in `harness/orchestrator.py` (unit), not `e2e/`; C-SSOT depends on a present
`build/` (skip-not-fail); C-min misses init-project's likeliest defect (dropped
as co-equal). → committed to C-SSOT-via-`validateParsed` + three additions.

Confirmed correct throughout: the skip premise (§1), ut_002 schema-caught (§2),
Option 1 not cheap and Option 2 not mischaracterized (§3).
