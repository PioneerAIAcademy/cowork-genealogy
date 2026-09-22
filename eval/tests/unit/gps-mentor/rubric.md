# GPS Mentor Rubric

Grading dimensions for gps-mentor unit tests. Evaluated by the LLM judge alongside the base rubric (correctness, completeness, tool arguments).

> **DRAFT — the three dimensions below are a starting point written by the
> developer who built the harness path, not a genealogist. They are here because
> a blank or absent rubric is not a neutral placeholder: a blank file aborts the
> runnability gate, and an absent one silently grades the suite on the base
> dimensions alone. Treat the names as proposals and the bullets as the shape to
> fill, not as the grading standard. What a defensible BCG-style mentoring
> verdict looks like is the genealogist's call, and nothing below has been
> checked against a real run. Delete this block when the dimensions are yours.**

## Scope discipline

Did the agent stay inside the focus mode it was given, and refuse rather than
degrade when the mode's preconditions were not met?

Each focus mode has a refusal row (`agents/gps-mentor.md:421-426`), and the body
is explicit that the agent must not "degrade silently into on-demand mode". A
craft read that also grades the evidence, or an evidentiary review that arrives
as a craft read, has crossed the boundary the mode exists to draw — and on a
craft run the required scope sentence is the announcement of that boundary.

- **pass:** The agent works only within the delegated focus. Where a
  precondition fails it refuses with `verdict: "refused"` and a one-line
  `narrative_for_user`, evaluates nothing further, and persists the refusal. On
  a craft run it opens with the scope sentence and names `proof-critique` as the
  review that checks the evidence.
- **partial:** The agent stays broadly in scope but strays at the edges — a
  craft read that comments on whether a conclusion is supported, or a refusal
  that also offers a partial evaluation.
- **fail:** The agent evaluates when it should have refused, silently switches
  mode, or omits the scope sentence on a craft run.

## Verdict persistence and supersession

Did the agent record the verdict correctly, and get the supersession decision
right — including reading the prior sidecar rather than inferring from focus and
target alone?

`focus` and `target_id` cannot distinguish a craft read from an evidentiary one;
only the prior body's `craft` flag can (`agents/gps-mentor.md:308-312`). The
agent must also pick the entry whose `superseded_by` is null itself, since the
tool has no filter for it.

- **pass:** The verdict is appended to `evaluations[]` with the right `focus`,
  `target_id` and `target_type`; supersession follows the rule (craft supersedes
  only craft on the same target; refusals do not supersede a non-refused
  verdict); and where a prior entry exists its body was read back through
  `sidecar_read` before deciding.
- **partial:** The verdict is persisted correctly but the supersession decision
  was reached without reading the prior body, or the prior entry's
  `superseded_by` was left unset when it should have been updated.
- **fail:** The verdict is not persisted, is persisted against the wrong target,
  or supersedes an entry the rules say it must not.

## Mentoring usefulness

Is the narrative something a researcher could act on — specific to this project,
naming what to do next, and honest about what is not yet supported?

The agent's output is advice a person reads, not a score. A verdict that is
accurate but unusable has failed at the thing the agent is for.

- **pass:** Findings name the specific artifact, the specific gap, and a
  concrete next action; the narrative reads as a senior colleague talking to a
  researcher rather than a schema dump.
- **partial:** Findings are correct but generic — true of any project, or
  naming a standard without saying what to do about it.
- **fail:** The narrative is unactionable, contradicts the structured verdict,
  or leans on identifiers and field names in place of plain language.
