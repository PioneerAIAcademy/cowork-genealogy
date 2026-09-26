# GPS Mentor Rubric

Grading dimensions for gps-mentor unit tests. Evaluated by the LLM judge alongside the base rubric (Correctness, Completeness, Tool Arguments).

Every dimension is derived from `docs/specs/gps-mentor-agent-spec.md` and names the section it comes from, so this rubric is checkable against stated doctrine rather than against taste. Four dimensions, within the 3–5 budget. The base three are graded separately and are deliberately not restated: in particular, **argument quality belongs to Tool Arguments**, and nothing here deducts for it a second time.

## Focus discipline and refusal

Did the agent do the review it was asked for, and refuse cleanly when the target could not support one?

Each focus mode has preconditions and §9 gives the refusal for each. A craft request against a project with no proof summary is the same rule §9 applies to `proof-critique` on a missing `ps_` id — refuse rather than critique the prose of a bare question. §6.4 fixes the targeting: craft requests take the most recent proof summary first, never a question. The agent must not degrade silently into a lighter mode instead of refusing.

**A refusal is not a craft read, and owes no preamble.** §6.4's required opening sentence — that the write-up was read for how it reads and not for whether the evidence holds up — applies to a run that actually read a write-up. A refusal read nothing, so requiring it there would be grading the agent for describing a review it correctly declined to perform.

- **pass:** The agent works only within the delegated focus. Where a precondition fails it returns `verdict: "refused"` with a one-line `narrative_for_user`, evaluates nothing further, and persists the refusal. Where it does proceed with a craft read, it opens with the §6.4 preamble naming `proof-critique` as the review that checks the evidence.
- **partial:** The right call, imperfectly executed — a refusal that also offers a partial critique, or a craft read whose preamble is present but does not say what was *not* checked.
- **fail:** The agent evaluates where it should have refused, silently substitutes a different focus, critiques the prose of a target with no proof summary, or omits the preamble on a craft read it did perform.

## Severity and citation discipline

Is each finding filed at the severity the spec gives it, under the right citation?

§5 principle 4 sets the tiers: `must_address` blocks GPS conformance at the current target, `consider_addressing` strengthens, `non_blocking_notes` is nit-level. §6.4 is categorical that craft checks are advisory **always** — none of checks 1–5 yields a `must_address` item or an `address_first` verdict, because blocking on taste reads as the tool being opinionated about writing. The one exception is §6.3's check-3 carry-over: a write-up whose claims cannot be followed to a findable record is `must_address` on a craft request exactly as on a `proof-critique` one, reported under its own standard rather than as a craft axis. On citation, §5 principle 2 wants a numbered Genealogy Standard on a GPS finding, while §6.4's carve-out is that craft findings have none and the `Craft — <axis>` label **is** their citation. §5 principle 5 applies throughout: recommending a tier *down* should come as readily as up.

- **pass:** Every finding sits at its specified severity; craft findings carry `Craft — <axis>`; a GPS finding carries a real numbered standard; and where the carry-over arises it is filed `must_address` under its own standard.
- **partial:** Severities broadly right with one misfiled item — a craft nit at `consider_addressing` where `non_blocking_notes` fits, or a real standard cited loosely.
- **fail:** A craft check produces a `must_address` item or an `address_first` verdict; a standard number is invented to satisfy principle 2 on a craft finding; or the carry-over is downgraded to advisory.

## Tool work: reading the state the verdict rests on

Did the agent fetch the facts its verdict depends on, rather than inferring them?

This dimension grades **coverage — whether the call was made at all**. Whether its arguments were right is the base Tool Arguments dimension's job, and a fault there is not deducted again here.

§10 is the sharp case. `focus` and `target_id` cannot distinguish a craft read from an evidentiary one, since both are `on-demand`, so the only way to know whether a prior entry is superseded by this run is `sidecar_read` on its `file_path` and reading the `craft` flag back. The agent must also select the entry whose `superseded_by` is null itself, because the tool offers no filter for it.

**Reaching the right conclusion without the read is a fail, not a partial.** A supersession decision made from `focus` and `target_id` alone is correct by luck on this fixture and wrong on the next one; grading it partial would let the suite pass the behaviour it was built to catch.

**This dimension is close to binary, and that is the agent's doing rather than the rubric's.** `gps-mentor` holds MCP tools only — no `Read`, no `Glob` — so there is no second route by which it could come by a sidecar's contents. Either `sidecar_read` was called or the fact was invented. The middle band below is real but cannot fire on a fixture carrying a single prior verdict; it becomes reachable as soon as one carries two.

- **pass:** Every fact the verdict rests on was read. Where a prior verdict exists, its body was fetched through `sidecar_read` before the supersession decision, and the live entry was selected by `superseded_by`.
- **partial:** Right instrument, wrong target — a prior body was fetched through `sidecar_read`, but a superseded entry was read in place of the live one, so the decision rests on a real read of the wrong thing.
- **fail:** The verdict rests on state the agent never read; a superseded entry is acted on as live; or the supersession decision is made without fetching the prior body, **including when the resulting decision happens to be correct**.

## Mentor voice and actionability

Could the researcher act on this, and does it read like a colleague rather than a form?

§5 principle 1 wants one or two specific strengths named by id and standard, not an exhaustive canvass. Principle 3 requires every `must_address` item to name what evidence or analysis would resolve it. Principle 6 caps the deliverable and splits the registers: the structured verdict's item fields stay terse machine pointers and the human prose lives **once** in `narrative_for_user`, never restated in both. §6.4 adds that internal axis vocabulary must never surface — the agent does not tell a researcher it performed an "audience calibration check"; the register is the one a colleague would use out loud.

Where the audience is not stated — `researcher_profile.intended_audience` is unset in every current fixture, so this is the live path — §6.4 asks the agent to infer it and **say which audience it assumed**, since an inferred audience is the likeliest thing in the review to be wrong.

**Grade the deliverable the run actually produced.** A refusal and a completed craft read are different artifacts, and holding a refusal to the craft bands scores conditions it had no occasion to meet — which lands as a default pass and makes this dimension stop discriminating.

*On a refusal*, the whole deliverable is one line. What it owes: plain language a researcher understands without knowing the schema, naming what is missing and what to do about it. Nothing else in this dimension applies — no audience to state, no prose that could be duplicated, no `must_address` item to justify — and those conditions are N/A rather than met.

*On a completed craft read*, all of the below applies.

- **pass:** Findings name the specific artifact, the specific gap, and a concrete next action; `must_address` items say what would change the agent's mind; prose appears once, in the narrative, with the JSON fields terse; no internal axis vocabulary; and the assumed audience is stated. On a refusal: one line of plain language naming the gap and the next step.
- **partial:** Correct but generic — findings true of any project, a next action named without saying what would resolve it, or an assumed audience never stated. On a refusal: accurate but written in schema vocabulary the researcher would have to decode.
- **fail:** Unactionable, contradicts the structured verdict, leans on identifiers and field names in place of plain language, surfaces internal axis vocabulary, or restates the same prose in both the JSON and the narrative.
