# Deep dive: convert-dates

**Date:** 2026-08-18 · **Issue:** #1654 · **Branch:** `1654-deep-dive-convert-dates`
**Procedure:** [`docs/skill-deep-dive-guide.md`](../skill-deep-dive-guide.md)

**What was read:** `packages/engine/plugin/skills/convert-dates/SKILL.md` and its
`references/calendar-conflicts.md`; all 14 tests + `rubric.md` under
`eval/tests/unit/convert-dates/`; all four committed run logs
(`v1_2026-06-13`, `v1_2026-06-23`, `v1_2026-07-22`, `v1_2026-07-27`) and their
`.ann.json` siblings — 56 test runs, every `text_response` read before any score;
`eval/harness/validators/test_convert_dates.py`;
`docs/specs/convert-calendar-tool-spec.md`;
`packages/engine/mcp-server/src/tools/convert-calendar.ts`; and — for F5 —
`eval/harness/judge/prompt.md` plus the context assembly in
`eval/harness/harness/judge.py`.

The issue's opening grep (`judge_context` naming a score branch) returns 0 files,
as it said it would. Everything below came from elsewhere.

---

## Step 1 — The prohibition list

Split out to its own file, matching the convention the merged dives use:
[`convert-dates-prohibition-list.md`](./convert-dates-prohibition-list.md).
14 rules, 13 of them checkable against a transcript; rule 14 (narration) is
structurally uncheckable in this suite because every test runs
`scenario: null`.

---

## Findings

### F1 — `convert_calendar` has never been called. Not once, in any test, in any run.

**Did:** all 56 runs recorded `tool_calls: []`. In nine of the ten
conversion-positive tests the model says why, unprompted:

> "The `convert_calendar` arithmetic tool isn't available in this environment, so
> I'll apply the conversion directly using the regime tables from the skill — the
> logic is unambiguous here."
> — `ut_convert_dates_004`, run `v1_2026-07-27_18-21-44`

**Should:** [SKILL.md](../../packages/engine/plugin/skills/convert-dates/SKILL.md) § "Calling `convert_calendar`"
— "Do not fall back to hand arithmetic." The body devotes a whole section to calling the
tool and `allowed-tools` lists exactly one tool. The tool has shipped since
2026-06-19 (`d84c6b9a9`) and the instruction was in force for three of the four
runs.

**Gap: lane 1.** The tool is not registered in the unit harness. `mcp_fixtures`
is `[]` on every test, `convert_calendar` is absent from `LIVE_TOOLS`
(`mock_mcp.py`, grep `LIVE_TOOLS: set[str]`), and the mock server only registers
tools a fixture manifest names (`mock_mcp.py`, grep `for tool_name, bucket in manifest.items()`). No `convert_calendar`
fixture exists anywhere under `eval/`. The model was told to call a tool that
was not in its tool list.

Three things ratified it rather than catching it:

- **`Tool Arguments` is N/A in all 56 gradings.** `orchestrator.py` (grep `if rubric is not None and tool_calls`) only
  grades it when `tool_calls` is non-empty, so the one dimension that covers
  tool work is switched off *by* the defect.
- **The judge blessed it:** "No MCP tool calls were made. The skill acknowledged
  that convert_calendar was not available and instead provided the explanation
  directly from documentation. This is appropriate." (`_007`, `v1_2026-07-27`)
- **A human annotator blessed it:** "No MCP tool calls were made… manual
  regime-table calculation is **valid**… Junior: (N/A — No MCP tool calls;
  manual regime-table calculation is valid.)" (`_004`, `v1_2026-06-23.ann.json`)

**One thing *did* notice, and is worth stating precisely.**
`eval/harness/scripts/check_tool_coverage.py` has been emitting this on every
eval-touching PR:

> `::warning::skill convert-dates declares allowed-tools ['convert_calendar'] but
> its test corpus has no fixture for: ['convert_calendar']. No eval test can
> exercise this tool — add a test with an mcp_fixture for each, or drop the tool
> from allowed-tools.`

So this is not an unseen gap; it is a **warn-only lint whose proposed remedy is
the wrong one for this tool.** "Add an mcp_fixture" cannot honestly be done for
`convert_calendar`: it is pure arithmetic, and a canned fixture would assert the
answer the test is trying to measure. That is very likely why nobody did it for
two months. The right remedy — `LIVE_TOOLS` — is not among the options the
warning offers. `conflict-resolution` carries the identical warning for the same
tool, so one registration clears both suites.

### F2 — The Julian→Gregorian offset thresholds regressed from leap-day to calendar-year, and no test reaches the window where that is wrong.

**Did:** [SKILL.md](../../packages/engine/plugin/skills/convert-dates/SKILL.md) § "Julian vs. Gregorian"
(pre-dive) read:

> "Offset grows by 1 day at each Julian leap year the Gregorian calendar skipped:
> before 1700 → 10 days; 1700–1799 → 11; 1800–1899 → 12; 1900+ → 13."

Every response in the corpus quotes it back as a year band — "the offset for
1700–1799 is **+11 days**" (`_006`), "For dates in the range 1700–1799"
(`_002`), "The Julian→Gregorian day offset for dates **between 1700 and 1799**"
(`_014`).

**Should:** the offset increments the day *after* each Julian 29 February the
Gregorian calendar skipped, so the threshold is **1 March (Julian)** of 1700,
1800 and 1900 — not 1 January. Verified by JDN round-trip against the shipped
tool's own arithmetic:

| Julian date | True offset | Year-band rule says |
|---|---|---|
| 1700-01-15 … 1700-02-29 | 10 | 11 ✗ |
| 1700-03-01 | 11 | 11 ✓ |
| 1800-01-15 … 1800-02-29 | 11 | 12 ✗ |
| 1900-01-15 … 1900-02-29 | 12 | 13 ✗ |
| 1900-03-01 | 13 | 13 ✓ |

Two independent sources in the repo already have it right.
`docs/specs/convert-calendar-tool-spec.md` §4.4 carries the correct table and
spells out the reason — "(The boundary sits at the day after each skipped Julian
Feb 29 — i.e. March 1 Julian of 1700/1800/1900.)" And the body **used to**: before
`ee25f5c19` ("Shorten convert-dates SKILL.md from 299 to 153 lines", 2026-06-23)
it read "a date BEFORE Feb 29 (Julian) 1700 uses a 10-day offset; AFTER, 11 days.
The same threshold logic applies in 1800 (→12) and 1900 (→13)", and three
jurisdiction rows carried "10 days before Feb 29 Julian 1700; 11 days after".
The shortening collapsed all of it into year bands.

**Gap: lane 4** — a real cross-jurisdiction behaviour change, and the only
lane-4 edit this dive makes. Nothing caught it because **no test in the suite has
a Julian date in the two-month window**: the corpus's Julian dates are 1582-09-14,
1699-01-15, 1712-02-29, 1730-02-14, 1730-05-14, 1750-02-15, 1918-02-01. The two
months after New Year in 1700, 1800 and 1900 are exactly the gap, and they are
not obscure — English and Scottish registers for Jan–Feb 1700, and Russian
metrical books for Jan–Feb 1800 and Jan–Feb 1900, are ordinary research material.

### F3 — `ut_convert_dates_007` is built on the year-start boundary day and grades the one answer the convention rules out.

**Did:** the test's input is "25 March 1750/1", and its `judge_context` (pre-dive)
required "Should explain that the later year (1751) is the New Style year and is
the year typically used in modern genealogical records". The skill complied and
went further, foreclosing the alternative:

> "**Use 1751** as your working date… Do **not** silently record it as 1750 —
> that would place the event in the wrong year by modern reckoning."
> — `_007`, `v1_2026-07-27`

and mis-stated the boundary while doing it: "March 25 is the **exact boundary** —
the **last day of OS year 1750** shading into the first day of OS year 1751."

**Should:** [SKILL.md](../../packages/engine/plugin/skills/convert-dates/SKILL.md) § "Old Style / New Style year"
states the window four lines above the double-date section: "Before 1752,
England's legal year began March 25. Dates January 1 – **March 24** are in the
'previous' year by modern reckoning." 25 March is therefore the **first** day of
the Old-Style year — 24 March is the last day of 1750 — and on that single date
the Old-Style and New-Style years are **the same**. A slash on 25 March is
anomalous, not routine, and rule 5 ("When in doubt, don't convert… flag the
ambiguity rather than guessing") governs. Telling the researcher 1750 would be
"the wrong year" is the reverse of the convention.

`docs/specs/convert-calendar-tool-spec.md` contains the same collision in
parentheses: §4.2 leaves `25 Mar 1720` **unchanged** under `osNsYear`, while §5b
offers `{ doubleDatedYear: true }` **or** `{ osNsYear: true }` for "25 March
1750/1" as though they agreed. They differ by a year. `convertCalendar` bumps
`doubleDatedYear` unconditionally
(`convert-calendar.ts`, grep `if (c.doubleDatedYear) {`)
with no window test, while `osNsYear` correctly tests `day <= 24` — so the tool
will not catch it either.

**Gap: lane 2 primarily, with a one-line lane-4 correction.** The test bakes in a
one-year error and grades the skill for asserting it confidently, so the test can
never catch it — the test *is* the error. And the body taught it: the double-date
section used "25 March 1750/1" as the worked example for a rule whose own window
excludes it. The rubric dimension that would have caught this scored `pass`:
`Ambiguity handling` requires the skill to "record both so the genealogist can
pick"; the response named 1750 and then told the researcher not to use it, which
is `partial` on the rubric's own ladder. The judge scored 3 and wrote "The
ambiguity is surfaced and resolved with full transparency."

**Repaired at the input, not the grading.** `_007`'s stated purpose — dual-dating
year extraction plus restraint — is worth testing and is unaffected; only its
*date* was wrong for it. So `_007` keeps its id, purpose and judge_context, with
the input moved inside the window to "15 February 1750/1", and the boundary day
becomes a new test (`ut_convert_dates_016`).

To be exact about what that preserves: the *question type* survives, which is what
run-over-run trend is meant to track, but the input still changed, so `_007`'s four
historical grades are not strictly comparable to the next run's. **No repair
avoids that**, because the test was wrong — the choice is only whether the
incomparability is visible. What this ordering does avoid is the worse outcome
this dive first walked into: rewriting `_007`'s judge_context in place, silently
repurposing an id to answer a different question while looking like a fix.

### F4 — Restraint was asserted by the judge on a run that did not restrain.

**Did:** `_007`'s response ends with an unrequested day conversion:

> "**Correlating with a Gregorian event in another country** → add 11 days:
> **5 April 1751** Gregorian."

In 2 of 4 runs (`v1_2026-06-23`, `v1_2026-07-27`). The judge, both times, scored
Correctness 3 with:

> "The skill appropriately notes the Julian-Gregorian day shift exists but
> **correctly restrains itself from applying it** since the user did not ask for
> calendar conversion."

**Should:** the test's own `judge_context` said "Should NOT apply the
Julian-to-Gregorian day shift the user did not ask for", and
[SKILL.md](../../packages/engine/plugin/skills/convert-dates/SKILL.md) § "Rules" calls
it by name: "Do not bundle corrections the user didn't request — that is
over-conversion."

**Gap: lane 2.** This is the worked example from the issue in a second shape. The
old bullet 5 — "Should restrain itself to the question asked — restraint is part
of the skill" — named a *virtue* rather than an *observable*, so the judge
reported the virtue it was shown. The proposed fix names what would be on the
page: a converted day, in any form, hedged or not, including the "if correlating
with another country" framing this run actually used.

### F5 — Five tests carry a binding expectation the judge has never once enforced.

**Did:** `_002`, `_004`, `_005`, `_006` and `_009` each carried a bullet of the
form "Should briefly note that offsets vary by country and time period (e.g. 11
days for England 1752, 13 days for Russia 1918)". Measured across every committed
run, per test, against the specific jurisdictions each bullet names: the bullet
was unmet in **20 of 20** gradings — all five tests, all four runs, no
exceptions — and Completeness scored **3 in every one of the 20**.

(An earlier draft of this write-up said "eight of eight". That figure came from
spot-checking `_004` and `_009` and generalising to the other three, which is the
same error this document criticises elsewhere. The measured number is 20; the
finding is larger than first reported, not smaller.)

**Should:** a `judge_context` bullet is not a hint. `eval/harness/judge/prompt.md`
ranks it as the third and narrowest instruction source — "**This is the narrowest
instruction you receive and it wins outright**" — and states that "an override is
**binding, not advisory**". It therefore outranks `rubric.md`, and Completeness's
own ladder gives the judge the exact tool: "A score of 2 requires naming a
concrete omission — a specific item the input state required that the skill did
not address." The omission here is concrete and nameable. The judge should have
scored 2 and did not, twenty times out of twenty.

**Gap: lane 2.** Two things are wrong and they point opposite ways, which is why
this was easy to misread — *this dive misread it first, and the correction makes
the finding larger, not smaller.* The bullet **is** enforceable, so "no dimension
can credit it" (this write-up's first reading) was wrong; what actually happened
is that a binding per-test override was silently ignored in every graded run.
Separately, the content it asks for is the kind `rubric.md` twice tells the judge
to discount — `Ambiguity handling`: "Do NOT credit … educational context about
historical transitions"; `Genealogical presentation`: "Do NOT credit explanatory
commentary … or contextual teaching content" — so the corpus contains a per-test
override pulling against the skill rubric, with the override winning on paper and
losing in practice.

**Delivery checked — it is non-compliance, not a plumbing bug.** The two
explanations are very different findings with different owners, so this was
verified rather than assumed. `judge.py` renders `judge_context` into a bulleted
block and the template consumes it at `{judge_context}` (grep in
`eval/harness/judge/prompt.md`), so the bullets do reach the judge.

But *where* they reach it is suggestive. The slot sits **after** the transcript,
and the paragraph immediately above it is entirely about negative tests — placed
there deliberately, for a documented reason about negative-test scoring. The
"wins outright / binding, not advisory" precedence rule is roughly 140 lines
earlier, under "Which rule wins", and is not restated at the point of insertion.
So the per-test override arrives with no local statement of its authority,
trailing a paragraph about a different concern.

**A third witness, and the flagrant one.** On the third full run
`ut_convert_dates_013` (Sweden, "30 February 1712") **failed** on Correctness 1
with: "The skill's core claim is factually false. Claude asserts that 30 February
1712 is a real Swedish calendar date." Its `judge_context` bullet 0 says, in
capitals: "Should recognize 30 February 1712 in Sweden as a REAL, historically
attested date — not an OCR error." Bullet 2 restates it ("so 30 February 1712
(Swedish) really existed") and bullet 3 gives the exact chain the skill produced
(Swedish 30 Feb = Julian 29 Feb = Gregorian 11 Mar 1712). The skill was right,
the date is real, and the judge asserted the opposite of its own binding
instruction — then failed a correct answer for it.

That is the escalation that settles F5's severity. The three witnesses are not
three wordings; they are one defect at increasing cost:

| Witness | What the override said | What the judge did | Cost |
|---|---|---|---|
| `_002/_004/_005/_006/_009` | note the other jurisdictions' offsets | ignored it, scored Completeness 3 | 20/20 + canary: a **false pass** |
| `_011` | empty response + correct routing **is** the pass condition | scored Correctness 1 | a **false negative** |
| `_013` | 30 Feb 1712 is REAL, capitalised | "factually false" | a **false negative on a correct answer** |

**A second witness, from a different rule.** On the first full run the judge
scored `ut_convert_dates_011` Correctness **1** because the skill "produced no
output" — on a negative test where it had routed correctly to
`conflict-resolution`. The judge prompt states the opposite in terms: "An empty
response from the skill under test, with the correct other skill named in 'Skills
Claude invoked', is the **pass** condition on those tests. It is not an omission,
and terseness is never the deduction." The harness's own
`routing_negative_judge_fail` advisory caught it and notes a human confirmed that
1 in 20 of 24 such cells across the corpus. So this is not one bullet being
missed; it is a pattern of binding instructions not binding.

### The mechanism, found precisely — and the fix, made and measured

The "placement" hypothesis above was close but wrong. **The prompt contradicts
itself.** "Which rule wins" calls per-test notes "binding, not advisory" and says
they "win outright". The section that actually *delivers* them, 120 lines later,
called them **"background"** — twice — and stated that a bullet phrased as a
requirement "is still background". The judge was not ignoring an instruction; it
was obeying the **nearer** one.

The "background" framing had a real job: stopping the judge inventing dimensions
named after bullets. So the fix separates two things the prompt conflated —
*structure* (these do not create new dimensions) from *authority* (these bind the
scores of the dimensions you were given) — and adds the arm for asserted facts.
`**Do not emit separate dimensions for them.**` is preserved verbatim, because
`test_render_prompt_puts_per_test_context_last` pins it as "#1401's only prose
defence against invented dimensions".

Measured on the two witnesses, n=1 each:

- **`_013` — FIXED.** Correctness **1 → 3**. The rationale went from "The skill's
  core claim is factually false" to "The response correctly identifies 30
  February 1712 as a real Swedish calendar date, not an OCR error." The
  fact-assertion arm does what it was written to do.
- **`_005` — UNCHANGED.** The canary bullet is still unmet (zero mentions of
  1582, 1752, Catholic Europe or England) and Completeness still scored 3, with
  the rationale asserting it "addressed all requirements from the user message
  and per-test context".

**That second result sent me to measure the false-pass arm properly, and both my
earlier numbers were wrong.** Classified across all 20 gradings that carried the
bullet, against two readings of it — *strict* (does the response cite the bullet's
own example jurisdictions?) and *loose* (does it convey that the offset varies by
country or era **at all**, in any words?):

| | count |
|---|---|
| gradings carrying the bullet | 20 |
| met the strict reading (cited 1582 / 1752) | **0** |
| met the loose reading (conveyed variation some other way) | **5** |
| met **neither** — a genuinely unmet override scored 3 | **15** |

So there are two distinct causes inside the original "20 of 20", not one:

- **5 of 20 — my measurement was wrong, not the judge.** I grepped for the
  bullet's *example years*, which are illustrative ("e.g.") rather than required.
  Those five responses said things like "the offset in force from 1 March 1900
  onward" or "jurisdiction-specific", which does convey variation, and the judge
  credited it correctly. Never violations.
- **15 of 20 — genuinely unmet, and scored 3 anyway.** No example jurisdiction and
  no variation language in any form, yet Completeness passed. These are real
  non-compliance with a binding note, and they are what the prompt's "background"
  framing licensed.

**"20 of 20" over-claimed; "weaker than I reported" over-retracted.** The number
is 15, from one instance each time — the first generalised from two tests, the
second from the single fresh run that happened to be one of the five loose-
compliant cases. Same error twice, opposite directions.

**And that same accident leaves the requirement arm untested.** `_005` is the only
test still carrying the bullet, and on the fresh post-fix run it fell in the
loose-compliant five — so there was no violation for the new wording to catch.
The requirement arm is therefore **unverified, not disproven**; only the fact arm
(`_013`) is proven. Testing it needs a test that carries the bullet *and* fails
the loose reading: `_004` and `_009` fail it in all four runs, which makes either
of them the canary this should have used. Keeping it on `_005` was the wrong pick.

The canary has therefore spent its usefulness: it cannot discriminate, because it
is vague. Striking it would edit `eval/tests/` and invalidate the committed run
log, so it is **not** struck here — it is the first thing to remove on whatever
run happens next for another reason.

**What this costs, stated because it is real.** The change is global: it alters
grading for every skill, and it has been verified on two tests of one. The
fact-assertion arm is low-risk (it forbids contradicting the test author). The
requirement-deduction arm could make judges stricter corpus-wide, turning some
passes into partials on the next run of any skill. `judge_prompt_hash` now
mismatches every committed run log, which CI rule 2b reports as a **warning**,
non-blocking, "because judge edits are a separate cadence" — and the prompt is
not in the snapshot, so no run log is invalidated.

That is a **global judge-prompt** matter, and this guide is explicit that the
base rubric and global judge prompt are not mine to edit — the instruction is to
post the problem and proposed wording and let the lead call it. **That approval
was given on 2026-08-20 and the edit above is the result.** The original proposal
read:
*consider a one-line header on the `{judge_context}` slot restating that these
bullets are binding per-test overrides that outrank `rubric.md`, since the
evidence is 20 committed gradings out of 20 where an override went unenforced,
plus a 21st on a fresh run after this dive.* No edit made.

Struck from four of the five, because the substance is already graded by each
test's bullet 2 (the offset actually used) and complying only pads a response that
is billed on every real invocation.

**One is deliberately retained, on `ut_convert_dates_005`, as a canary.** Striking
all five would have removed the only place in the corpus where an unenforced
override is observable — destroying the evidence for the finding while reporting
it. With one left in place, the next run answers the question directly: if `_005`
still scores Completeness 3 while omitting the other jurisdictions' offsets, the
override is still not binding, and the judge-prompt change proposed below is the
fix rather than the wording of any individual bullet. But **striking it does not close the
finding.** The judge ignoring a binding override is a grading-machinery problem
that outlives these five bullets, and it is the reason F3's and F4's fixes below
are labelled *proposed* rather than *made*.

### F6 — `ut_convert_dates_004` requires a conversion the tool is specified to refuse.

Found only by registering the tool (VR-0) and calling it. It cannot be found by
reading run logs, because the tool was never called.

**Did:** `_004` asks "Convert this Spanish parish-record date to the modern
Gregorian calendar: '14 September 1582, Madrid'", and its `judge_context` required
"the correct 10-day offset … '14 September 1582 (Julian) +10 days = 24 September
1582 (Gregorian)'". Every run complied and asserted 24 September 1582 as the
Gregorian date, flatly.

**Should:** Spain's switch was Julian 4 October 1582 → Gregorian **15** October
1582. A 14 September 1582 date therefore precedes the Gregorian calendar's
existence — there is no contemporaneous Gregorian equivalent, only a *proleptic*
one, and asserting it unqualified produces a date no register will ever match.
`docs/specs/convert-calendar-tool-spec.md` §7 makes this an explicit contract:

> `julianToGregorianDay` on a Julian date before 1582-10-15 | **input error** —
> the Gregorian calendar did not exist before its introduction, so there is no
> meaningful day offset to apply

Confirmed live against the newly-registered handler: that call returns
`ok: false`, "julianToGregorianDay is not defined before the 1582-10-15 Gregorian
introduction (the Julian and Gregorian calendars had not diverged)". The spec's
offset table starts at `1582-10-15` for the same reason — which independently
corroborates F2's threshold framing.

**Gap: lane 2.** The tool and the spec are right; the test is wrong, and it had
been grading the skill for two months on an answer the shipped tool refuses to
produce. Two months is exactly how long the tool has been unregistered, which is
the point: F1 hid F6.

Repaired at the input's *expectation*, not the input. `_004` keeps its date,
filename and Catholic-Europe framing — the question a genealogist actually asks —
and now grades the judgment the tool encodes: name the pre-adoption status, say no
contemporaneous Gregorian equivalent exists, record the date as written, and label
24 September 1582 as proleptic **if** it is offered at all. The
`requires-tool-conversion` tag is removed, since the conversion is a specified
input error; and surfacing that error is explicitly marked correct behaviour,
which is what the body's `{ ok: false }` rule already requires.

**Coverage checked, not assumed:** the 10-day band is still exercised —
`ut_convert_dates_009` (Württemberg, 15 January 1699 → +10 → 25 January 1699) sits
inside `1582-10-15 … 1700-03-01`, verified against the live handler. No new test
was needed to hold that band.

### F7 — Nothing graded whether the skill used what the tool returned.

Only findable after VR-0. The harness emitted `missing_tool_usage_dimension` on
the first full run: the rubric had no dimension whose name suggests tool-usage
coverage. It could not have fired before — no tool was ever called.

**Did:** prohibition-list rules 2 (`{ ok: false }` → surface the error) and 7
(present `applied[].rule` and `offsetDays`) are the two rules that describe using
the tool's *response*. Base `Tool Arguments` grades the call's arguments and
stops there. So with the tool live, a skill could call `convert_calendar`, ignore
the response, narrate its own arithmetic, and lose no points anywhere.

**Should:** `docs/specs/unit-test-spec.md`'s rubric budget is 3–5 dimensions and
convert-dates had 3, so there was room.

**Gap: lane 2.** Added **Tool response interpretation** — pass when every rule and
offset traces to `applied[]`/`converted` and an `ok: false` is surfaced rather
than replaced by a hand-computed date; partial when the tool is called but the
offset is narrated from the body's tables; fail when the response contradicts the
tool or asserts a date after `ok: false`; N/A when no arithmetic was warranted.

It discriminated on first contact — three distinct values in four observations:
**2** on `_016` when the response contradicted the tool, **3** on `_007` and
`_002` tracing the rule and offset to `applied[]`, **N/A** on `_016` when the
skill correctly treated a notation question as needing no call. Against a suite
where 3 of 5 dimensions never took more than one value, that is the point.

### F8 — The same 25-March error was in the tool, its own unit test, the skill body, and the eval test.

**Did:** `_016` scored `partial` on the first full run for *contradicting the
tool* — the skill said both 1750 and 1751 were defensible on 25 March, and
`convert_calendar` had returned a flat 1751. The dimension was right to flag it,
but the tool was wrong, not the skill.

**Should:** `convertCalendar`'s `doubleDatedYear` branch bumped the year
unconditionally. Its own comment states the assumption it never checked —
"The slash already signals the Jan 1–Mar 24 boundary" — while the sibling
`osNsYear` branch correctly tests `day <= 24`. So the tool produced the one-year
error F3 is about, and would have written it into a researcher's notes.

**Gap: lane 1, fixed.** Added the window guard, refusing only when the date
*proves* it is outside Jan 1 – Mar 24 (`month > 3`, or March with `day > 24`),
noting rather than refusing a March date with no day, and leaving a year-only
input alone so the spec's documented `{1750, doubleYear:1}` case still resolves.

The instructive part is the spread. **Seven places carried the same error** —
five in code and tests, plus two in the spec that review found and that would have
re-seeded it: §5b used "25 March 1750/1" as the worked example for two corrections
that now disagree by a year on exactly that date, and §8's test plan named the same
date. All seven are fixed here. The five originally counted:
`convert-calendar.ts`, its vitest case (which asserted `{1750, month:3, day:25}`
→ 1751, i.e. the test *encoded* the bug), a second vitest case using the same
date incidentally, `convert-dates/SKILL.md`'s worked example, and
`ut_convert_dates_007`'s input. Each looked locally consistent because they all
agreed with each other. Full vitest after the fix: 102 files, 2443 tests, green.

**It reaches a second skill, too.** `conflict-resolution/SKILL.md` declares
`convert_calendar` as well, so registering it live changes that skill's next run
while its committed run logs stay active — `LIVE_TOOLS` is not snapshot-tracked.
Net positive (a tool it declares becomes callable), but it is a cross-skill effect
from a single-skill PR, and the next person to run `conflict-resolution` should
know it moved underneath them.

**And this one hides from the run-log snapshot.** MCP source is deliberately not
snapshotted, but `LIVE_TOOLS` executes the *compiled* build — so a tool fix
changes what every future eval run does while every committed run log still reads
as active. `eval/CLAUDE.md` names the remedy ("hash the compiled artifact
separately, as `judge_prompt_hash` does") and it is not implemented. Worth a
`nothing-checks` label whenever someone picks it up: before VR-0 no live tool
mattered to this skill, and now one does.

---

### F9 — `ut_convert_dates_012` is a knife-edge routing test, and no body edit fixes it

**Did:** across five committed runs it goes pass, fail, pass, pass, fail — and the
two failures differ in kind (`skills_invoked: []` once, `['convert-dates']` once).
Replacing the body's double-date example did not settle it: `_012` passed the run
after that change and failed the next.

**Should:** a routing test should discriminate on the routing rule, not on
sampling noise.

**It is not the judge-prompt change, and the timing invites that misreading.**
`_compute_outcome`'s negative branch (`eval/harness/harness/orchestrator.py`)
decides a routing negative on **activation alone** — `if activated: return "fail"`
— and the judge's dimensions do not gate it. So:

| | what the skill did | outcome |
|---|---|---|
| run 3 | `tool_calls: []` → did not activate | pass |
| run 4 | called `convert_calendar {doubleDatedYear: true}` → activated | fail |

That is a behaviour flip in the skill; the judge prompt has no influence on
`activated`. A reviewer proposed the opposite reading — that the F5 fix made the
negative-test context bind and so graded `_012` as written — and asked to be
confirmed or corrected rather than agreed with. **Corrected:** the code path shows
the judge cannot reach this outcome.

**Gap: lane 2, and the cause is not in the body.** `convert-dates`'s **description
frontmatter** advertises `double-dated years (e.g. "1749/50")` and, in the same
paragraph, `date schema validation (use validate-schema)`. `_012`'s input is *"Is
'15 Feb 1749/50' a valid value for a date field in research.json?"* — it contains
the skill's own positive trigger example **and** asks the question that same
description defers. The test sits on the boundary by construction, so it flaps.

Three ways out, none a body edit: change the test's input to a double date the
description does not name; drop the `(e.g. "1749/50")` example from the
description, which is optimiser-owned and shifts routing corpus-wide; or accept it
as known-flaky and stop reading its individual outcomes. **Left for the lead** — a
description edit invalidates the run log and pulls in the routing pairs, so it does
not belong in this PR.

**One thing was free and is done:** `_012` now carries the
`no-spurious-conversion` tag. Tags are stripped before hashing
(`snapshot.py::_COSMETIC_TEST_FIELDS`), so this does not flip the run log —
verified. `test_no_spurious_conversion` gates on that tag rather than on test type,
so the next run grades `_012`'s spurious `convert_calendar` call as a
**deterministic validator failure** instead of leaving it to a judge narration.
That is this dive's own thesis applied to its last open failure.

---

### F11 — the tool accepts impossible dates, and `_013` is the one test that could send one

**Did:** `convertCalendar` validates `day` as 1–31 without reference to `month`,
so an impossible date is accepted and silently normalised. Verified against the
live handler:

| input | returns |
|---|---|
| `{1712, month:2, day:30}` + `julianToGregorianDay` | `ok: true`, Gregorian **12 March 1712** |
| `{1712, month:2, day:29}` (the correct Julian date) | `ok: true`, Gregorian **11 March 1712** |

Julian February 1712 had 29 days, so `day: 30` does not exist in that calendar.
The tool takes it, rolls into March, and returns an answer one day wrong — with
`ok: true` and no note.

**Should:** an impossible day/month combination is an input error, the same class
as `month` outside 1–12, which the tool already rejects.

**Gap: lane 1, pre-existing, out of scope here.** Raised in review and recorded
because this corpus has exactly one test that could feed it:
`ut_convert_dates_013` asks about **Swedish 30 February 1712** — a date that
genuinely existed in the Swedish calendar and in no other. The correct chain routes
through Julian 29 February, and in run 4 the skill did exactly that. But a model
passing the Swedish date straight through would get 11 March silently turned into
12 March: a wrong answer that looks like a right one, on the single test in the
suite whose input is a real-but-impossible-elsewhere date.

Not fixed here — unrelated to F8's window guard, wants its own vitest cases per
month, and this PR has already paid for four runs. The fix is a days-in-month check
inside the existing 1–31 validation, Julian leap rules included.

---

## Checked, not a finding

Recorded so the next auditor doesn't re-derive them.

- **`_001` (Quaker 1845) names no jurisdiction, and the skill converted anyway** —
  a literal breach of rule 6 ("Never convert without knowing where the record was
  created"), and the response silently assumed Britain ("Britain adopted Gregorian
  in Sep 1752"). Not raised: for a post-1752 date the Quaker month mapping is the
  same in every Anglophone jurisdiction, so the answer is jurisdiction-independent
  and no genealogist is misled. Rule 6 is over-broad, not violated in substance.
  Adding prose would cost tokens and change no answer.
- **`_013` (Sweden 1712) says Sweden "added two leap days in February 1712 — both
  February 29 and February 30"** — defensible. 1712 was a Julian leap year, so the
  month did carry two leap days even though only one was *added*. The conversion
  chain it gives (Swedish 30 Feb = Julian 29 Feb = Gregorian 11 Mar 1712) is
  correct; verified by JDN.
- **`_003`'s pre-1752 Quaker table renders "11th Month → January" without the
  year roll-over**, which the body flags as "January (next year)". It is a
  negative test whose graded invariant is "no conversion performed", the roll-over
  is not what it measures, and the response is otherwise sound. Dropped as a nit.
- **`references/calendar-conflicts.md` is named by no SKILL.md and cannot be
  loaded** — already issue #1633, which lists it by name. Not re-filed. But see
  the note below: it should not be re-wired as-is.
- **The suite's arithmetic is otherwise correct.** Every stated conversion in the
  corpus was re-derived by JDN: 1582-09-14 +10 → 09-24; 1699-01-15 +10 → 01-25;
  1730-02-14 +11 → 02-25; 1730-05-14 +11 → 05-25; 1750-02-15 +11 → 02-26;
  1918-02-01 +13 → 02-14; Swedish 1712-02-30 → Gregorian 1712-03-11. All correct.
  The defect is not in the answers the corpus happens to contain — it is that
  nothing makes the *next* answer correct.

## For issue #1633, not a new issue

#1633's verdict on `convert-dates/references/calendar-conflicts.md` is
"add the pointer, or delete". **Do not add the pointer as-is.** Its pattern table
says "Exactly 13 days (1800-1923 records)", which is wrong for the whole 19th
century (12 days) and contradicts its own § "Russian Empire records vs Western
European records", which correctly says "a 12-day offset (19th century) or 13-day
offset (20th century)". Re-wiring the file would ship the same class of error
F2 fixes in the body. Fix the row first or delete the file.

---

## Step 6 — Validators, implemented

The guide says the auditor supplies the rule and a developer writes the Python.
That was overridden for this dive: the validators are **implemented here**, in
this PR. `eval/harness/validators/` and `eval/harness/tests/` are outside the
run-log snapshot, so they cost nothing — no re-run, no annotation pass.

| | Rule | Where it landed | Why there |
|---|---|---|---|
| **VR-0** | register `convert_calendar` as a live tool | `mock_mcp.py` (4 sites) | prerequisite; nothing below can fail without it |
| **VR-1** | a `requires-tool-conversion` test must call the tool | `validators/test_convert_dates.py` | ✅ implemented, 5 tests |
| **VR-2** | no `doubleDatedYear` outside Jan 1 – Mar 24 | **the tool**, + 5 vitest cases | ⚠️ written as a validator, then **removed** — see below |
| **VR-3** | a `grade_on_invariant` validator must be able to fail | follow-on, design below | blocking + cross-skill + heuristic |
| **VR-4** | zero calls on a `refusal-to-convert` test | `validators/test_convert_dates.py` | ✅ implemented, 3 tests |

Proof-of-failure and real-data replay for both shipped validators:
`eval/harness/tests/unit/test_convert_dates_validators.py` — 11 tests, each
check exercised against a state that must pass **and** the state that must fire.
Then replayed against the committed run log
(`v1_2026-08-19_22-13-16`): **0 failures across all 16 tests.**

**What that replay is and is not.** It feeds each test's recorded `tool_calls`
through the validator functions directly. It is not the harness running them: the
committed run log was produced *before* the validators were added, so its
`validators.results` list only `test_only_convert_calendar_called` and
`test_no_spurious_conversion`. The first run log to show all four executing will
be the next full run of this skill. Flagged because "0 failures on replay" should
not be read as "verified in-run".

### VR-2 was implemented, then deleted — and that is the reusable lesson

Written as specified, VR-2 read `tool_calls[].args` and failed any
`doubleDatedYear` request outside the window. It passed its own unit tests. Then
replaying it against the committed run log **failed `ut_convert_dates_016` — a
test that had passed.**

What `_016` actually did: requested the correction for 25 March, received the
(now-guarded) tool's refusal, and relayed it — *"The tool confirms this date is
outside the normal double-dating window and flags it as anomalous."* That is
precisely what the body's `{ ok: false }` rule asks for. Reading only `args`, a
validator cannot distinguish correct probing from asserting a wrong year, so it
punished the best available behaviour.

**A rule the tool can enforce belongs in the tool** — where a wrong request is
*answered* rather than merely recorded, and where nothing can bypass it. A
validator earns its place on what the tool cannot see: whether a call happened at
all (VR-1), or whether one happened that should not have (VR-4). The guide's
Step 6 table has no row for this distinction; it is worth adding.

Cost of learning it this way: nothing, because validators are free. Cost of
*not* learning it: a permanent false failure on the one test that documents the
boundary day.

### VR-3 — handed to a developer, with the design and the reason it is not here

> **Rule:** when a test sets `negative.grade_on_invariant: true`, the tag-gated
> validator carrying its verdict must be capable of failing. If the assertion is
> "tool X was not called" and X is registered nowhere for that test, the pass is
> vacuous.
> **Where to look:** the test's `tags`, the gating validator in
> `validators/test_<skill>.py`, and the tool set the run can register
> (`spec.mcp_fixtures` ∪ `mock_mcp.LIVE_TOOLS`).
> **What a violation looks like:** `ut_convert_dates_003` and `_010`, all four
> pre-dive runs. `test_no_spurious_conversion` recorded `"error": null` — it ran,
> and passed — while asserting `convert_calendar` was not called, for a tool
> registered nowhere. `_010`'s own `explanation` asserts the opposite:
> "grade_on_invariant is safe **only because that validator actually runs and
> gates the outcome**; without it the invariant would pass vacuously."

**Why it is not in this PR.** `check_runnable` returns `not_runnable`, which
aborts the test as a corpus error (exit 2). Extracting "which tool a validator
asserts about" from its source is a **heuristic** — a tool name can appear in a
message string, and an assertion can be about something else entirely. A false
positive would therefore abort a paid run across any skill. Ship it as a
**warn-only lint** in `harness/scripts/` beside `check_tool_coverage.py` and
`check_rubric_tool_drift.py`, which is where this repo already puts approximate
cross-skill checks, rather than as an extension of the blocking gate at
`runnability.py` (grep `passes VACUOUSLY`) whose comment already names this exact
failure mode one step short.

The specific instance is closed regardless: `convert_calendar` is registered, so
`test_no_spurious_conversion` can now fail, and
`test_no_spurious_conversion_now_has_a_registered_tool_to_catch` proves it does.

### VR-0 (prerequisite, lane 1) — register `convert_calendar` as a live tool

Not a validator; the thing that makes three validators possible.

**Why a fixture is the wrong answer, stated precisely.** The `LIVE_TOOLS`
docstring's own criterion is narrower than this tool — it covers tools that are
"deterministic functions of **local workspace state**", and `convert_calendar`
touches no workspace at all. The argument is adjacent but distinct: a canned
fixture would supply *the computed answer the test exists to measure*. That is
the same dishonesty the docstring is guarding against, arrived at from the other
direction, and it is why the `check_tool_coverage` remedy ("add a test with an
mcp_fixture") should not be taken here.

**Measured edit sites — four, in two files.** An earlier draft of this write-up
said "a one-line change to `LIVE_TOOLS`". That was asserted, not measured, and it
is wrong; a developer following it hits a red lint:

1. `LIVE_TOOLS` in `eval/harness/harness/mock_mcp.py` — add `"convert_calendar"`.
2. `_make_live_handler` in the same file — add a branch. The generic
   `_make_compiled_tool_handler("convert_calendar", "convert-calendar.js",
   "convertCalendar", workspace, call_log)` serves it; no new machinery. Omitting
   this fails loudly rather than silently — the server builder loops over
   `LIVE_TOOLS` and the factory raises `ValueError` for an unmapped name.
3. `OK_FALSE_IS_FAILURE_LIVE` in the same file — **required, not optional.**
   `convert_calendar` is in `OK_FALSE_IS_FAILURE` in
   `packages/engine/mcp-server/src/tool-result.ts`, and the drift lint in
   `eval/harness/tests/unit/test_mock_mcp.py` (grep `ts_names & LIVE_TOOLS`)
   asserts that set identity. Adding to `LIVE_TOOLS` alone turns that lint red.
4. The comment above `OK_FALSE_IS_FAILURE_LIVE` naming "the three that are not
   live here (`merge_tree_persons`, `tree_forget`, `convert_calendar`)" becomes
   two.

**Two risks checked and cleared.** The generic handler bails with `ok: false` when
`workspace is None` — not reachable here, since `skill_runner.py` types
`workspace: Path` non-optionally, so every test has one even at `scenario: null`.
And it injects `projectPath` into the args unconditionally; `convertCalendar`
reads only `input.date` and `input.corrections`, so the extra key is inert.

Once registered, the parametrized `ok: false` test (grep
`sorted(OK_FALSE_IS_FAILURE_LIVE)`) exercises the new entry automatically.

**Blast radius, stated because it crosses the PR's scope.** `LIVE_TOOLS` is
global. `conflict-resolution` also declares `convert_calendar` and carries the
identical `check_tool_coverage` warning, so this clears both suites — and changes
what that skill's future runs can do. No committed run log is invalidated
(`eval/harness/**` is not in the snapshot). While there: `check_tool_coverage.py`'s
message should offer `LIVE_TOOLS` as a third remedy, since for a deterministic
tool the two it currently offers are both wrong.

### Considered and not requested

**"The converted date in the narration must match the tool's `converted`."** Now
known to be *implementable but not from a run log*: the validator runner passes
the live `response` to validators (`validator_runner.py`), but the committed run
log persists only `tool`, `args`, `expected_args`, `matched` and
`response_fixture`. So a validator could check it in-run, while no after-the-fact
audit of a committed log could. Still not requested: matching a date across the
renderings a response might use is a regex in prose, and the guide is right that
mechanising that ends in a dimension nobody trusts.

**Anything about whether the explanation was good** — left with the judge.

## Changes in this PR

Lane 2 is mine; the single lane-4 edit is F2, whose blast radius is one paragraph.
Every row was exercised by a scratch run before this was written — see "Verified by
scratch run" below for what each one actually produced.

| File | Change | Finding | Status |
|---|---|---|---|
| `skills/convert-dates/SKILL.md` | Offset threshold restated as 1 March (Julian) of 1700/1800/1900, with the Julian 14 Feb 1900 → +12 case named. Table column renamed `Offset` → `Offset at adoption` so the per-jurisdiction numbers stop reading as universal. | F2 | **made** — the body is now correct as prose |
| `skills/convert-dates/SKILL.md` | Double-date example moved off the boundary day to "15 February 1749/50" (`{ year: 1749, doubleYear: 50 }`), plus one sentence: double dates belong to Jan 1 – Mar 24, and a slash on 25 March is flagged, not resolved. | F3 | **made** |
| `tests/…/slash-notation-only.json` (`_007`) | Input moved inside the window — "25 March 1750/1" → **"15 February 1750/1"** — so the test's own expectation ("use the later year") is true of its date. Purpose, id and title unchanged. Restraint bullet now names the observable, including the "if correlating with another country" framing the failing runs used. | F3, F4 | **made & verified** — `_007` now fails on the real violation |
| `tests/…/year-start-boundary-day.json` **(new, `ut_convert_dates_016`)** | The boundary day, as its own test: 25 March is where the Old-Style year *increments*, so both 1750 and 1751 are defensible and the skill must give both plus how to settle it. | F3 | **made & verified** — Ambiguity handling 3 on the right grounds |
| `tests/…/rubric.md` | `Ambiguity handling` pass/partial split sharpened: "records both" means both readings survive as usable options; mentioning an alternative and then foreclosing it is `partial`. | F3 | **made & verified** — `_016` scored 3 on the two-readings grounds |
| `tests/…/{scotland-hybrid, protestant-german-1700, julian-gregorian-1750}.json` + `catholic-europe-1582.json` | Struck the "note that offsets vary by country" bullet — already graded by each test's bullet 2, and complying only pads a billed response. | F5 | **made** — but see F5: striking it does not close the finding |
| `tests/…/russia-1918.json` (`_005`) | Same bullet **deliberately retained** as a canary, so the next run can still distinguish "overrides now bind" from "the symptom was deleted". | F5 | **made** |
| `tests/…/catholic-europe-1582.json` (`_004`) | Expectation rewritten: grades naming the pre-adoption status, saying no contemporaneous Gregorian equivalent exists, recording as written, and labelling 24 Sep 1582 proleptic if offered. `requires-tool-conversion` removed — the conversion is a specified input error. | F6 | **made & verified** — input error surfaced and explained |
| `eval/harness/validators/test_convert_dates.py` | **VR-1** (a `requires-tool-conversion` test must call the tool) and **VR-4** (zero calls on a `refusal-to-convert` test), plus a recorded note on why VR-2 is not here. | VR-1, VR-4 | **made** — 11 unit tests + replayed against the committed run's recorded `tool_calls`, 0 failures. **Not yet exercised inside a harness run:** the committed run log predates them, so its `validators.results` show only the two pre-existing checks. |
| `eval/harness/tests/unit/test_convert_dates_validators.py` **(new)** | 11 tests: every check exercised against a state that must pass and the state that must fire, per CLAUDE.md's "a new lint must be proven to fail". Not snapshot-tracked, so free. | VR-1, VR-4 | **made** |
| `eval/harness/harness/mock_mcp.py` | **VR-0**: `convert_calendar` registered as a live tool — `LIVE_TOOLS`, a `_make_live_handler` branch on the generic compiled-tool builder, `OK_FALSE_IS_FAILURE_LIVE` (required by the drift lint), and the stale "three that are not live" comment. | F1 | **made** — handler verified live |
| `tests/…/russia-1900-threshold.json` **(new, `ut_convert_dates_015`)** | Julian 14 Feb 1900, Moscow → Gregorian 26 Feb 1900. Names 27 February as the specific failure a year-band reading produces. Gives F2 something that verifies it. | F2 | **made & verified** — +12, not +13 |
| 8 test files | Added the `requires-tool-conversion` tag (`_004` excluded — see F6). Snapshot-cosmetic, so free; makes VR-1 implementable without a hardcoded id list. | VR-1 | **made** |

**Verification run:** all 16 tests pass `check_runnable` (including both new ones,
and the rubric still parses); `eval/harness` unit suite 2249 passed / 3 skipped;
no duplicate `test.id` across the corpus (CI rule 4); every `§` anchor in this
document resolves to a real heading.

### A retraction: the canary was placed correctly

An earlier draft of this write-up recorded "the canary was kept on `_005` when
`_004` and `_009` were already measured as failing 4/4" as my error, and named
`_009` as the replacement. **That self-criticism was itself unverified, and it is
wrong.** Measured properly — asking not just whether a response cited the
bullet's named example jurisdictions but whether it conveyed cross-jurisdiction
variation *at all*:

| Test | cited the named examples | conveyed variation another way | usable as a canary |
|---|---|---|---|
| `_002` | 0/4 | 0/4 | **yes** |
| `_005` | 0/4 | 0/4 | **yes — the one retained** |
| `_009` | 0/4 | **1/4** | no |
| `_004` | 0/4 | **2/4** | no |
| `_006` | 0/4 | **4/4** | no |

`_009` — the "correction" — hedges in one run of four, so it is a *worse*
instrument than the one in place. `_005` is one of only two clean canaries in the
corpus, and it is the one that was kept.

The lesson is the one I had already drawn and then failed to apply: **verify
before acting, including on a claim about your own mistake.** Acting on that
retraction would have degraded a working instrument. `_002` is the backup if
`_005` ever starts hedging.

## The judge-prompt fix, now measured: one arm works, one does not

Run `v1_2026-08-21_19-59-34` was graded under this branch's prompt —
`judge_prompt_hash` **c39d7003**, matching `eval/harness/judge/prompt.md` exactly,
which the previously committed run did not. So this is the in-repo evidence review
asked for, and it splits.

### Facts arm — PROVEN

`ut_convert_dates_013`, the flagrant witness, went **Correctness 1 to 3** and the
whole test from `fail` to `pass` (all seven dimensions 3). The rationale inverted:

| | rationale |
|---|---|
| old prompt | "The skill's core claim is **factually false**. Claude asserts that 30 February 1712 is a real Swedish calendar date" |
| this branch | "The response **accurately presents the historical facts** about Sweden's unique 30 February 1712 date ... all historically documented" |

Same skill, same test, same asserted fact. The judge stopped contradicting an
established per-test fact, which is what the Facts paragraph was added to stop.

### Authority arm — NOT TESTABLE with this canary, and the reason is worse

An earlier draft of this section called the Authority arm **disproven**. Review
corrected that, and the correction matters more than the original claim.

The measurement stands: `_005`'s run-4 response contains **zero** occurrences of
1582, 1752, England, Catholic, "10 days", "11 days", "vary", "varies",
"jurisdiction", "country" or "countries". The bullet was genuinely unmet, and
Completeness scored 3.

But read *why* the judge scored 3:

> "The skill addressed all requirements: … and **briefly explained that offsets
> vary by country and time period with examples (10 days for Catholic Europe
> 1582, 11 days for England 1752)**."

The judge did not weigh a known-unmet requirement and decline to deduct. It
asserted the requirement **was met**, and **invented the two parenthetical
examples** — which appear nowhere in the response it was grading. No wording in
"Which rule wins" can bind a grader that believes the bullet was satisfied, so
`_005` never exercised the Authority arm at all.

**So the Authority paragraph is untested, not ineffective**, and "billed prose
that changes nothing" was a stronger conclusion than one observation supports.
It stays.

### F10 — the judge fabricates compliance, and that defeats every per-test requirement at once

**Did:** `_005`, run `v1_2026-08-21_19-59-34`, Completeness 3, rationale quoting
"examples (10 days for Catholic Europe 1582, 11 days for England 1752)" that the
graded response does not contain. Verified by counting markers in
`output.text_response`: every one is zero.

**Should:** the judge prompt requires "Be specific in your rationale: cite what
the skill did or did not do, not generalities." A rationale citing content that
was never produced is the inverse of that instruction.

**Narrowed by the genealogist's verdict.** `_005`'s Completeness was annotated
after this was written, and the human **confirmed 3 → 3**, with no override. So
the fabricated rationale did **not** produce a wrong score: the bullet it invented
compliance with was not load-bearing for Completeness, and 3 was the right answer.

That makes F10 a **fabricated-justification** finding, not a false-pass one, and
the distinction is worth keeping straight:

- **Still true and still serious:** the judge cited two specific examples that do
  not exist in the text it graded. A rationale is the only artifact a human reads
  when deciding whether to trust a score, and this one described a response that
  was never written.
- **Not supported:** that this changed the outcome. It did not, here.

The consequence for F5 is unchanged, though, and it is the part that matters:
a grader that believes a bullet was satisfied cannot be bound by wording that
tells it how much a bullet weighs. So `_005` still does not test the Authority arm
— whatever the score turned out to be.

**Gap: this is the ceiling on F5's whole family of fixes.** F5 assumed the
failure mode was *authority* — the judge treating a binding note as advisory. At
least once, the failure mode is *perception*: the judge reports having seen
content that is absent. Precedence wording cannot reach that, and neither can any
per-test bullet, because the bullet is not being overruled — it is being
hallucinated as satisfied. This is strictly worse than the three F5 witnesses,
which at least mis-weighted things that were really there.

It may also explain the shape of the original 20-of-20 measurement better than
"ignored the override" did — a judge that narrates compliance it did not observe
produces exactly that pattern: bullet unmet, score 3, rationale confident. Stated
as a hypothesis, not a finding: only `_005`'s rationale has been read closely
enough to establish fabrication, and on that one the score was independently
confirmed correct.

**Not fixed here, and not fixable by prompt wording alone.** The mechanical
counterpart is a validator asserting a claimed-cited string actually appears in
the response, which is the natural VR-6 and wants a developer. Recorded for the
lead beside F5.

## The four full runs, and what the committed one shows

| | Run 1 | Run 2 | Run 3 | Run 4 (committed) |
|---|---|---|---|---|
| Outcome | 15 pass, 1 fail | 12 pass, 1 partial, 2 fail, 1 aborted | 14 pass, 1 partial, 1 fail | **15 pass, 1 fail** |
| Cost / wall | $1.56 / 351s | $1.06 / 613s | $1.10 / 359s | $1.51 / 343s |
| `judge_prompt_hash` | pre-fix | pre-fix | pre-fix (`0d186137`) | **`c39d7003` — matches this branch** |
| Environment | clean | **degraded** | clean | clean |

**Run 2 carries no corpus signal.** Its two "fails" were judge API timeouts —
`_001`'s judge ran 108s and `_008`'s 56s against a 4–14s norm in the same run,
returning zero dimensions on healthy 1034- and 1185-character responses — and
`_012` never reached the judge at all. A harness reporting gap made that look like
a skill regression: a judge-side timeout produces a bare `fail`, indistinguishable
in the summary table from the skill getting the answer wrong, while skill-side
aborts print their reason. `eval/CLAUDE.md` says a result with nothing gradeable is
`aborted` with a reason; a judge-side failure does not follow that rule. Worth a
`nothing-checks` label.

**Run 4 is the committed one and the only one that can speak to the prompt
change**, per the hash. It is the evidence for the Facts arm above.

### The suite ships at 15/16, and the one failure is understood

`_012` fails. It is **not** the judge prompt change — see F9 — and it is not worth
another run to chase, because the cause is in a field this PR deliberately does not
touch.

Two findings that were open at run 3 are now closed by run 4: `_013` passes
(Facts arm), and `_004` passes with `Genealogical presentation` 3 after the
sharpened expectation and the Swedish carve-out both landed.

## Verified by scratch run


Six `--test` scratch runs, **$0.55 total** — gitignored, unreleasable, and no
annotation owed. They cost about 6% of the full-suite run this PR's edits imply,
and they changed three conclusions, so the sequence is worth repeating on the next
dive: **register the tool, then run the affected tests, then write the findings.**

| Finding | Status after the run | Evidence |
|---|---|---|
| **F1** | **Closed** | `_004`, `_005`, `_015` each made exactly one live `convert_calendar` call (`matched.kind: "live"`). After 56 runs of zero. |
| **F1's side effect** | **Closed** | `Tool Arguments` scored **3** on all three, instead of the N/A it returned in all 56 prior gradings. The dimension is back on. |
| **F2** | **Verified** | `_015` reasoned "before 1 March 1900 (Julian) — so the offset is **+12 days**, not +13" and produced 26 February 1900. `_005` independently picked up the corrected wording: "+13 days (the offset in force **from 1 March 1900 onward**)". |
| **F6** | **Verified** | `_004` called `julianToGregorianDay` on 1582-09-14, received the specified input error, and explained that no conversion applies. Judge Correctness 3: "correctly identified that 14 September 1582 in Madrid predates the Gregorian calendar's introduction". Note the skill's *first* instinct was "+10 days" — the tool corrected it. That is the body's `{ ok: false }` rule working, and it was unreachable before VR-0. |
| **F4** | **Reproduced, and now caught** | `_007` **fails**. The skill still volunteers the unrequested shift — "the Gregorian equivalent would be **26 February 1751**" — and the judge now scores Correctness **1**, quoting the bullet, where it previously scored 3 with "correctly restrains itself from applying it". |
| **F5** | **Reproduced — now 21 of 21** | The retained canary on `_005` went entirely unmet: the response contains **zero** occurrences of 1582, 1752, England, Catholic Europe, "10 days" or "11 days". Completeness scored **3** anyway. Keeping one bullet is what made this observable; striking all five would have deleted the only evidence. |

### `_007` catches the violation when it happens — which is not every run

Both scratch runs failed it; the committed full run **passed** it, with the judge
noting the skill "explicitly did NOT apply the Julian-to-Gregorian day offset (15
February remained 15 February)". So F4's over-conversion is **intermittent**,
roughly two runs in three observed, not deterministic. An earlier draft of this
write-up said `_007` "ships failing, deliberately"; that was drawn from the
scratch runs alone and is wrong.

The test is still the win: the violation is now *measurable* whenever it occurs,
instead of being praised as restraint. And per this guide's own rule, a rule the
body already states ("Do not bundle corrections the user didn't request — that is
over-conversion") and that was ignored does not get restated: **no skill-body edit
was made for F4.**

### One defect of my own, caught by the run

The first `_007` attempt failed for the **wrong reason** — a false negative I
authored. My bullet said "Should NOT state or compute a Gregorian equivalent of the
**day**", and the judge read the *year* resolution ("15 February 1750/1 = 15
February 1751") as the prohibited conversion, marking down the very answer bullet 2
requires. Two bullets of the same test contradicted each other.

Rewritten to name the day-of-month change explicitly and to state that resolving
the year, with day and month unchanged, is **not** that failure. The re-run then
split them exactly right: Conversion accuracy **3** ("resolving 1750/1 to 1751 …
the year conversion itself is accurate") alongside Correctness **1** for the day
shift.

The lesson is specific and reusable: **a prohibition bullet must name the
observable change, not the category of operation.** "A Gregorian equivalent" is a
category; "the day-of-month moving from 15 February to 26 February" is an
observable. This is the same failure mode as F4's original bullet naming a virtue,
one level down.

### Still not verified

- **Whether these hold at n=1.** Each result above is a single run, and the harness
  does not pin skill-side temperature. The deterministic facts (a tool call
  happened; the tool returned +12; the input error fired) are not sampling-
  sensitive. The judge's *scores* are. Do not read a single run as calibration.
- **Whether the judge-prompt change fixes F5.** Not attempted — the global judge
  prompt is not mine to edit. The canary is in place to answer it.
- **The full suite.** Ten tests were not re-run; `_002`, `_006`, `_009`, `_014` in
  particular now reach a live tool for the first time and could surface their own
  F6-shaped collisions.

### A correction to VR-5's premise, and then a correction to that

First reading: run logs do not persist a tool call's response — an entry carries
`tool`, `args`, `expected_args`, `matched` and `response_fixture` and nothing
else — so "narration must match the tool's `converted`" looked unimplementable.

That was half right. `validator_runner.py` passes the **live** `response` to
validators, so a validator *can* read it during the run; what cannot happen is an
after-the-fact audit of a committed log. The distinction matters for anyone
designing a future check: in-run assertions may use the response, post-hoc
analysis may not. It stays unrequested for the reason in "Considered and not
requested" above — matching a date across prose renderings is a regex — not
because it is impossible.

## Handback — what is deliberately not fixed here

Each of these was raised in review, agreed, and left out for a stated reason
rather than missed.

**1. `SKILL.md`'s only end-to-end worked example is a conversion the tool now
refuses.** It reads "14 September 1582 (Julian) +10 days = 24 September 1582
(Gregorian)" — the exact input of `_004`, which `convertCalendar` now returns
`ok: false` for, and which that test's `judge_context` calls "the failure this
test looks for". It is the same shape as F8: several sites locally consistent
because they agreed with each other, with one left in. The fix is one line — use
`_009`'s "15 January 1699 (Julian) +10 days = 25 January 1699" — but it flips the
snapshot, and the reviewer's instruction was explicit: bundle it with the next run
this skill takes for any other reason rather than buying a fifth run for one line.
**Do this first on the next run.**

**2. The description collision behind F9.** `convert-dates`'s description
advertises `double-dated years (e.g. "1749/50")` two clauses before it sends
`date schema validation (use validate-schema)` away, and `_012` asks *"Is '15 Feb
1749/50' a valid value for a date field in research.json?"* — both at once. Run 4
evidence: `_012` has now gone pass / fail / pass / pass / fail across five runs,
and the run-4 failure is activation, not grading (F9). A description edit
invalidates the run log and pulls in the routing pairs, so it is not this PR's to
make. No issue filed, per standing instruction — this is the handback.

**3. F11**, the impossible-date acceptance, above.

**4. VR-3** — a gate asserting a `grade_on_invariant` validator can actually fail.
Designed, not built; wants a developer, because a false positive aborts a paid run.

**5. VR-6, new from F10** — a validator asserting that a string the judge's
rationale claims to cite actually appears in the graded response. F10 is the case
for it: the judge quoted two examples that were not in the text. Wants a developer.

**6. Both outstanding annotation cells are now done** — 51 entries over eight
tests. `_012` confirmed 1/1 ("The skill did the wrong task. This was explicitly a
negative test requiring a decline/routing to validate-schema"), which independently
backs F9's reading that activation is the right basis for that failure. `_005`
confirmed 3 → 3, which narrowed F10 from a false-pass finding to a
fabricated-justification one — see F10.

What is still open on F10 is one question only the annotator can answer: whether
the confirmation of 3 was a judgment that the score is right *despite* the invented
rationale, or an agreement reached without reading it. The former makes F10 a
rationale-integrity finding worth a validator (VR-6); the latter leaves the
fabrication unadjudicated. The write-up takes the narrower reading until that is
resolved.

## A note on the paid run

The issue budgets one `make eval-skill SKILL=convert-dates` for these edits.
**That run was already owed before this dive.** `v1_2026-07-27_18-21-44`'s only
snapshot drift was `SKILL.md`, from `c1fc2a4c2` ("skills: delete the 26 dead
`model:` pins", #1497) — a mechanical frontmatter deletion on 2026-08-09 that
flipped the run log inactive. Everything above rides a run the corpus needed
anyway.

**VR-0 should land before that run, not after.** Every finding here is downstream
of an unregistered tool, and a run without it re-measures the same hand
arithmetic and produces a fifth log that says nothing new about F1. Registration
is a one-line change to `LIVE_TOOLS`.
