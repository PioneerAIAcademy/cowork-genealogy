# Shorten: research-exhaustiveness

**Bucket:** A (dead-mechanics removal) — but already the leanest of the three,
with a protected exhaustiveness-judgment core
**Primary owner:** both (developer strips the duplicate update-block JSON,
post-validate, and re-invocation boilerplate; **genealogist signs off on the
threshold/stop-criteria standard**)
**Current size:** 199 lines → **Target:** ~130–145 lines (~30% reduction)
**Tool migration:** **done** — calls `research_append` (`op:"update"` on the
question) only. No post-write `validate_research_schema`.
**Still needed as a skill?** **Yes** — the five threshold questions, the 7-point
stop criteria, declaration honesty, and the refuse-while-in-progress gate are
graded by validators *and* the rubric; the tool only validates-and-persists.

## TL;DR
The tool does nothing analytical here — it just validates-before-persist and
writes the `exhaustive_declaration` + `status` atomically (line 90 already says
"the tool assigns nothing here"). Cut the two near-identical
`research_append({...})` update blocks down to one tiny shape note, drop the
`{ ok:false }` retry paragraph to one line, and delete the "Re-invocation
behavior" section (its no-op-on-redeclare point is already in Edge cases). **Do
not touch** the five threshold questions, the 7-point stop-criteria table, the
declare/decline/early-termination logic, or `references/research-exhaustiveness.md`
(keep in full per spec §4.9).

## Why this skill is shortenable
The smallest dead-mechanics surface of the three. The tool owns
validate-before-persist and atomic write; the only thing the prose adds twice is
the literal shape of the `op:"update"` call (once for declare, once for early
termination) — those differ only in whether `status` is set, which the skill can
state in two sentences instead of two JSON blocks. The lengthy stop_criteria
example object inside the declare block is illustrative, not graded structure
(the *content* of the assessments is what the rubric grades).

## The floor: what the unit tests actually grade
- **Deterministic validators**
  (`eval/harness/validators/test_research_exhaustiveness.py` + universal):
  - `test_no_new_questions` — modifies existing questions only; never creates one
    (that's question-selection).
  - `test_declared_implies_exhaustive_declared_status` — `declared:true` ⇒
    `status:"exhaustive_declared"`.
  - `test_declared_has_log_entry_ids` — `declared:true` ⇒ non-empty
    `log_entry_ids`.
  - `test_declared_has_full_stop_criteria` — `declared:true` ⇒ all **seven**
    stop_criteria keys present.
  - `test_no_exhaustive_declaration` (tag `no-exhaustive-declaration`) — on a
    decline/in-progress scenario, must **not** flip `declared` true or set status.
  - Universal: ownership (writes only `questions`, shared with question-selection);
    FK on `log_entry_ids`.
- **Rubric dims** (`eval/tests/unit/research-exhaustiveness/rubric.md`):
  1. *Threshold reasoning* — explicitly evaluates each criterion against actual
     log/assertions; declares only when all met, or declines with a named gap.
  2. *Declaration honesty* — resists premature/inflated declaration; an honest
     "not yet" passes; early-stop stays `declared:false`.
  3. *Stop criteria coverage* — all 7 keys present with specific 1–2 sentence
     assessments tied to log entries (N/A on a pure refusal — see
     `refuse-while-in-progress.json` judge_context).
- **Base dims:** Correctness, Completeness, Tool Arguments.
- **Negative/boundary tests:** route to `question-selection`
  (`negative-next-question`), `research-plan` (`negative-research-plan` —
  "plan more searches" not "are we done"), `project-status`
  (`negative-project-status`).
- **Key test files:** `declare-exhaustive-complete`, `decline-incomplete-research`,
  `honest-early-termination`, `refuse-while-in-progress` (the in-progress gate),
  `already-declared-no-redeclare` (the structural no-op),
  `ut_research_exhaustiveness_009`–`012`, and the three `negative-*`.

## CUT — safe to remove
- **[96–140] the two `research_append({...})` update blocks** (declare-exhaustive
  and early-termination) — collapse to a short shape note: "persist with
  `research_append` `op:"update"` on the question's `q_` id. **Declare:** set
  `status:"exhaustive_declared"` and a full `exhaustive_declaration` (`declared:
  true`, the `log_entry_ids` you gathered, all seven `stop_criteria`). **Early
  termination:** pass `exhaustive_declaration` with `declared:false` and an honest
  justification, and **do not pass `status`** (leave it `in_progress`)." The
  verbose example justification + 7-key object is schema/illustration dup — the
  *seven keys* requirement is the validator's; the *content* is the rubric's.
- **[90–91 tail + 142–144] "the tool assigns nothing here… validates-before-
  persist… on `{ ok:false } surface and fix… do not retry blindly"** — keep the
  `{ ok:false }` → surface-and-fix as **one** line; drop the validate-before-
  persist re-narration (it's a tool guarantee).
- **[182–199] "Re-invocation behavior"** — boilerplate. Its only real content
  (already-declared ⇒ no-op, report + point at proof-conclusion) duplicates the
  "Already declared" edge case (177–180). Cut the section; keep the edge case.

## KEEP — load-bearing judgment (do NOT cut)
- **The reference-load line + `references/research-exhaustiveness.md`** — spec
  §4.9 says keep the reference in full. Do not touch the reference file.
- **The fires-when gate + §"Plan must be complete" / refuse-while-in-progress**
  (lines 30–33, 158–161, 175–176) — backs `test_no_exhaustive_declaration` and
  the `refuse-while-in-progress` test (must name the in-progress item and refuse).
  State the gate once; it currently appears 3×.
- **§2 the five threshold questions** — backs *Threshold reasoning*.
- **§3 the 7-point stop-criteria table** — backs *Stop criteria coverage* and
  `test_declared_has_full_stop_criteria` (the seven keys are load-bearing).
- **§4 declare/decline/early-termination logic** — incl. "early termination keeps
  `declared:false` and does **not** change status from `in_progress`" — backs
  `test_declared_implies_exhaustive_declared_status`, *Declaration honesty*, and
  `honest-early-termination`. **This is the integrity core; keep the reasoning.**
- **The `declared:true` ⇒ status + non-empty log_entry_ids + all-7-keys** trio —
  backs three validators. State as one tight rule (don't need the literal object).
- **"Already declared ⇒ no-op, report + suggest proof-conclusion"** edge case —
  backs `already-declared-no-redeclare`. Keep once (drop the Re-invocation dup).
- **Routing line "don't write the proof conclusion / don't pick the next
  question / don't plan more"** — backs the three negative tests; one line.

## TIGHTEN — keep the point, cut the words
- The refuse-while-in-progress gate is stated 3× (intro line 30–33, Rules
  "Plan must be complete," Edge "Plan items still in progress"). State **once**.
- "User wants to stop early → declared:false, don't inflate" is in §4, Rules, and
  Edge cases — keep once.
- "Each invocation evaluates exactly one question" is in Rules and Re-invocation —
  keep once.

## Suggested target structure (~135 lines)
1. Frontmatter + Narration + reference-load line.
2. Purpose + the single fires-when / refuse-if-in-progress gate.
3. §1 gather evidence (keep).
4. §2 five threshold questions (keep).
5. §3 7-point stop-criteria table (keep).
6. §4 declare / decline / early-termination logic (keep — the integrity core).
7. §5 write: one short shape note (declare vs. early-termination differ only in
   whether `status` is set) + one-line `{ ok:false }` handling. No JSON blocks.
8. §6 present (2 bullets).
9. Rules (dedup) + Edge cases (keep "already declared" no-op; drop dups).

## Verify
```
cd eval/harness && uv run python run_tests.py --skill research-exhaustiveness
```
Watch the five validators (esp. the declared⇒status / log_entry_ids / 7-keys trio
and the no-exhaustive-declaration tag check on the decline/in-progress tests).
Confirm `refuse-while-in-progress` still refuses and names the in-progress item,
`already-declared-no-redeclare` stays a no-op, and the three negative tests route
away (question-selection / research-plan / project-status). All three rubric dims
pass.

## Owner notes
**Developer** safely cuts the two update-block JSONs, the validate-before-persist
re-narration, and the Re-invocation section. **Genealogist** owns the five
threshold questions, the 7-point stop-criteria table, and the declare/decline/
early-termination integrity logic — these back four validators and all three
rubric dims, and the early-termination "keep status in_progress" rule is exactly
the honesty the skill exists to enforce. Keep `references/research-exhaustiveness.md`
untouched (spec §4.9).

*Rubric-review item (do NOT act on here):* the rubric is clean — no post-write
validate language; the *Stop criteria coverage* dim already carries the
refusal-is-N/A carve-out in `refuse-while-in-progress.json`'s judge_context.
Nothing to flag.
