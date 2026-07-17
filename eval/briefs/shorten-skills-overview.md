# Shorten SKILL.md files — Overview & methodology

**Audience:** developer + genealogist teams.
**Goal this cycle:** find the *least* SKILL.md text that still passes the
unit tests, so the files are easier to improve as e2e tests land.
**Companion docs:** one `shorten-<skill>.md` brief per skill in this folder;
the migration contract is `docs/specs/skill-rewrites-for-persistence-tools-spec.md`;
the test harness is documented in `eval/CLAUDE.md`.

---

## 1. The single most important fact

**The LLM judge never reads `SKILL.md`.** For each unit test it grades the
*transcript Claude produced* against three things:

1. **Deterministic validators** — `eval/harness/validators/test_<skill>.py`
   (+ the universal ones in `test_universal.py`). Pure `assert`s on
   `before_state` / `after_state` / `tool_calls`: tool-allowlist, read-only /
   ownership, cross-file integrity, no-op edits, append-only logs.
2. **Per-skill rubric dimensions** — `eval/tests/unit/<skill>/rubric.md`
   (the *craft* dims) plus the base dims **Correctness, Completeness, Tool
   Arguments** from `eval/harness/judge/prompt.md`.
3. **Negative/boundary tests** — does Claude route to the *right* skill (or
   decline) instead of answering out of scope.

So SKILL.md text is pure overhead **unless it steers Claude toward
pass-grade output on those three.** That is the whole lever.

---

## 2. The cut/keep rule (apply to every skill)

**CUT — safe to remove:**
- Text that **duplicates the tool's input schema** — the verbose
  `tool_name({ ... })` JSON example blocks. The tool's schema already
  documents its params; keep at most one tiny example, or none.
- Text that **re-derives the validator's own logic** — e.g. validate-schema
  enumerating every check the validator runs; check-warnings listing the
  warning-detection arithmetic the tool now computes.
- Text that **restates the rubric** — the judge already has `rubric.md`;
  repeating its bullets in SKILL.md changes nothing.
- Text describing **mechanics the tool now performs** — id allocation
  ("next available id"), `results/` sidecar writes, chunking ("write the
  first persona, then Edit-append the rest"), "update ALL references after a
  merge," and the **post-write `validate_research_schema` call** (every write
  tool now validates-before-persist; keep only the `check-warnings` step,
  which is genealogical, not structural).
- **Boilerplate** — most "Re-invocation behavior" / "Writes: nothing"
  sections, and tool-response schema dumps.

**KEEP — load-bearing judgment:**
- The **analytical decisions the tool takes as input** (the tool does the
  clerical work; the skill supplies the judgment).
- **Routing / scope boundaries** that a *negative test* checks (these fail
  loudly if cut).
- Anything that maps **directly onto a rubric dimension** — if a dim grades
  "evidence grounding," the refuse-without-source rule stays.
- **"Don't re-derive what the tool computed"** guardrails — these are the
  point of the migration (e.g. check-warnings' "the tool is the arbiter; do
  not do your own date arithmetic").

**TIGHTEN — keep the point, cut the words:** most skills state the same rule
3–6 times across "Steps," "Important rules," "Decision rules," and "Edge
cases." State each load-bearing rule **once**.

---

## 3. The one real tradeoff (read before you start cutting)

Do **not** binary-search "minimum text until a test flips red." The corpus is
small (most skills have 8–13 tests) and the skill run is **not `temperature=0`**
(see `eval/CLAUDE.md` → "Eval vs production parity"), so the true minimum
overfits to *both* the current tests and single-run jitter. Instead:

> Cut what is **provably redundant** (duplicates schema / validator / rubric,
> or names mechanics the tool now owns), then re-run to confirm green.

That is robust. "Shrink till red, then back off one line" is not — and it
defeats the purpose (a brittle minimum is *harder* to improve when e2e lands,
not easier).

---

## 4. Two kinds of shortening — don't conflate them

| Bucket | What it is | Risk | Lead |
|---|---|---|---|
| **A — Dead-mechanics removal** | Tool-backed skills carrying prose the new tool now owns | **Low** — you're deleting text for behavior the tool guarantees | **Developer**, with genealogist sign-off on what stays |
| **B — Craft compression** | Long *judgment* skills with **no** new tool to lean on | **Higher** — every line might be load-bearing craft | **Genealogist**, developer assists with structure |

Bucket A is this cycle's safe, high-yield work. Bucket B (citation, timeline,
locality-guide, historical-context, translation) is real but separate —
compressing genealogical judgment, not deleting redundant mechanics.

---

## 5. Verification recipe (every skill)

```
cd eval/harness && uv run python run_tests.py --skill <skill>
```

Confirm **every** judge dimension passes and **all** validators are green.
Notes:
- **Any** edit under `packages/engine/plugin/skills/<skill>/**` (including a
  `references/` doc or a comment) flips prior run logs **inactive** and forces
  a re-run — that's the snapshot model working as designed, not a problem.
- A `--skill <name>` run with no `--tag` is **releasable** (writes
  `v{N}_<ts>.json`); `--test`/`--tag` runs are scratch. The per-PR workflow
  (junior runs + corrects grades, senior releases) is in
  `docs/plan/eval-runlog-versioning.md`.
- The GitHub Action (`check-runlogs.yml`) blocks a PR unless the latest
  full-skill run log is **active** and every dimension is annotated.

---

## 6. Triage table — every skill

Line counts as of this brief. "Tool" = the new persistence/compute tool the
skill now calls (the source of dead mechanics). Briefs marked ✅ exist in this
folder.

| Skill | Lines | Bucket | Tool(s) it now calls | Owner | Headline | Brief |
|---|---|---|---|---|---|---|
| record-extraction | 600 | A | `research_append`, `research_log_append` | both | Biggest file; both waves — drop sidecar/chunking/id-alloc/post-validate | ✅ |
| search-records | 590 | A | `record_search`+`projectPath`, `research_log_append`, `research_append` | both | Drop hand sidecar-write + verify-count; route plan-item status via tool | ✅ |
| citation | 555 | B | — (no new tool) | genealogist | Craft compression only; pure Evidence-Explained judgment | ✅ |
| person-evidence | 506 | A | `research_append`, `tree_edit` (stub persons) | both | Drop id-alloc + post-validate; stub-person create via `tree_edit` | ✅ |
| init-project | 490 | B/A | writes `research.json` directly | both | Interview judgment stays; trim schema/template narration | ✅ |
| conflict-resolution | 487 | A | `research_append`, `convert_calendar` | both | Calendar offset via tool; create/resolve via append; keep weighing judgment | ✅ |
| hypothesis-tracking | 455 | A | `research_append` | both | Status transitions via `op:"update"`; keep the reasoning | ✅ |
| check-warnings | 444 | A | `person_warnings` | both | Cut tag-catalog + I/O dump; keep interpretation/actionability | ✅ |
| timeline | 420 | B | — | genealogist | Craft compression; keep distance/sequence judgment | ✅ |
| search-external-sites | 412 | A | `research_log_append` (no sidecar), `research_append` | both | Twice-per-loop log; no `stagedResultsRef`; trim log-protocol copy | ✅ |
| proof-conclusion | 407 | A | `research_append`, `tree_edit`, `merge_*` | both | Both waves; **keep the question-ownership boundary (do NOT resolve)** | ✅ |
| research-plan | 390 | A | `research_append` | both | Plan+items via append; re-plan supersedes; keep planning judgment | ✅ |
| search-full-text | 382 | A | `fulltext_search`+`projectPath`, `research_log_append`, `research_append` | both | Same as search-records, full-text variant | ✅ |
| project-status | 379 | B | reads only | genealogist | Read-only recommender; compress the next-step heuristics | ✅ |
| tree-edit | 324 | A | `tree_edit`, `merge_tree_persons`, `merge_record_into_tree` | both | Migration done; cut JSON examples + merge worked-example; **keep evidence-grounding gatekeeping** | ✅ |
| assertion-classification | 301 | A | `research_append` (`op:"update"` only), `person_warnings` | both | Update-only; immutable-field list is now structural; keep 3-layer judgment | ✅ |
| convert-dates | 299 | A | `convert_calendar` | both | Arithmetic moved to tool; dedupe the regime tables; keep "answer only what's asked" | ✅ |
| question-selection | 262 | A | `research_append` | both | Append + supersede via update; keep selection judgment | ✅ |
| historical-context | 238 | B | — | genealogist | Craft compression; narrative judgment | ✅ |
| translation | 213 | B | — | genealogist | Craft compression | ✅ |
| research | 212 | B | — (router) | both | Orchestration prose; compress | ✅ |
| locality-guide | 209 | B | — (calls read tools) | genealogist | Craft compression | ✅ |
| research-exhaustiveness | 199 | A | `research_append` (`op:"update"`) | both | Declaration via update; keep the exhaustiveness standard | ✅ |
| search-familysearch-wiki | 142 | A(light) | `wiki_search`/`wiki_read` (read-only) | developer | Already lean-ish; trim to the search-wikipedia pattern | ✅ |
| validate-schema | 110 | A | `validate_research_schema` | developer | Cut the "what the validator checks" enumeration; keep routing | ✅ |
| search-wikipedia | 65 | A | `wikipedia_search` | developer | **Reference minimal skill — the target shape.** Do not bloat | — |

`search-wikipedia` is the canonical minimal skill (65 lines). It's the shape
the other tool-backed skills should move toward; use it as the north star, not
a brief target.

---

## 7. How to read a per-skill brief

Each `shorten-<skill>.md` has the same structure:
- **Header** — bucket, owner, current→target lines, migration status, whether
  it's still needed as a skill.
- **The floor** — exactly what the validators + rubric + negative tests grade
  (the lines you must not break).
- **CUT** — sections safe to remove, with line ranges and the reason.
- **KEEP** — load-bearing judgment, each tied to the dim/test it protects.
- **TIGHTEN** — keep the point, cut the words.
- **Verify + owner notes** — who cuts what.
