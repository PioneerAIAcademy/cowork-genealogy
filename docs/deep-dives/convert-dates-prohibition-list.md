# convert-dates — prohibition list (Step 1 of the deep-dive guide)

Built from `packages/engine/plugin/skills/convert-dates/SKILL.md` as PR #1766
leaves it. Every line below is checkable by eye against a run-log transcript
(`output.text_response`, `output.tool_calls`).

Judgement calls are deliberately excluded — they belong to the judge, per the
guide.

**Save this file. The next auditor of `convert-dates` starts here instead of
rebuilding it.**

---

Every rule in the skill body that is checkable against a transcript. **This is
the artifact the next auditor starts from.** Cited by quoted wording rather than
line number: 147 commits over three weeks moved one of this write-up's four
harness citations, and a dive doc that decays is a dive doc nobody trusts.

| # | Rule | Body wording | Verdict this dive |
|---|---|---|---|
| 1 | Every conversion goes through `convert_calendar`; never hand arithmetic | "Do not fall back to hand arithmetic." (§ Calling) | **Violated, 100%** — F1 |
| 2 | On `{ ok: false }`, surface the error and the missing input; fix and call again | § Calling | Unreachable — tool never called (F1) |
| 3 | Apply only the correction(s) the user asked for | "Answer only the calendar question asked… Do not bundle corrections the user didn't request — that is over-conversion." (§ Rules) | **Violated, 2 of 4 runs** on `_007` — F4 |
| 4 | Show the original next to the converted form; keep both | "Show original next to converted." (§ Rules) | Clean — every response did |
| 5 | When the jurisdiction or convention is unclear, flag the ambiguity; don't guess | "When in doubt, don't convert." (§ Rules) | **Violated** on the 25 March boundary (now `_016`) — F3 |
| 6 | Never convert without knowing where the record was created | "Jurisdiction matters." (§ Rules) | Technically violated on `_001` — see "Checked, not a finding" |
| 7 | Present step-by-step: original, `applied[].rule` (+ `offsetDays`), converted | § Calling | Clean in form; the rule/offset are narrated from memory, not from `applied[]` (F1) |
| 8 | Writes nothing; output-only; idempotent | § Re-invocation behavior | Clean — `files_created` empty in all 56 runs |
| 9 | Hand off to conflict-resolution when the gap matches no calendar offset | § Routing | Clean — `_011` routed correctly in 3 of 4 runs |
| 10 | Hand off to historical-context on a why-did-this-exist question | § Routing | Clean — no conversion performed on `_003` in any run |
| 11 | Offset is jurisdiction-and-year specific, not a single number | § Julian vs. Gregorian | **Body is wrong at three thresholds** — F2 |
| 12 | Double dates resolve to the later (New Style) year | § Double-dated years | **Body's example is the one date where this is false** — F3 |
| 13 | Quaker "1st month" shifts meaning at 1752 — always check the era | § Quaker numbered months | Clean — `_001` (1845) took post-1752 correctly |
| 14 | Read `researcher_profile.narration_guidance` and apply it | frontmatter Narration line | Not checkable — every test runs `scenario: null`, so no `research.json` exists |

Rules 1–13 are checkable. Rule 14 is **structurally uncheckable in this suite**:
all 16 tests are stateless, so the narration instruction that opens the body can
never be exercised. Noted for whoever adds a scenario-backed test.
