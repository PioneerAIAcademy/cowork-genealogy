# Agent postconditions — can a subagent be required to have called something before it returns?

**Status:** DESIGN SKETCH, nothing built · 2026-09-07. Written in answer to a
direct question: *can we have postconditions on agents the way we have
preconditions on tool calls — "this agent must have made this tool call with
these parameters before returning"?* The answer is a qualified yes, resting on
one platform behaviour nobody here has probed. **Step 1 is the probe, and if the
probe fails the rest of this file is void.** Do not schedule the implementation
before the probe returns.

Sits under ADR-0011 (put guardrails at the write boundary) and ADR-0005 (what
hooks actually do in Cowork).

---

## 1. Narrow the idea before costing it

The instinct is to check that an agent did its job. Most of that is already
covered, and by a better plane, so the first job is to find what is actually
left.

**If the required call is a WRITE, this is a precondition and belongs at the
writer tool** — but only *mostly*, and the exception is the interesting part. A
precondition fires when a write happens. It cannot fire on an agent that returns
having written nothing; it can only catch that later, at whatever downstream
write depends on the missing artifact — and only if such a write ever comes.

Measured on the 161 committed e2e runs, for the case this file was written to
answer (`gps-mentor` must leave a `proof-critique` verdict in `evaluations[]`):

| | |
|---|---|
| `gps-mentor` invocations, whole corpus | 188 |
| `evaluations[]` entries in the matching final states | 170 |
| Runs invoking the mentor where `evaluations[]` is **empty** | **10** (one invoked it 5 times, one 3) |
| Runs where invocations exceed verdicts at all | 15 |
| …of those, runs that never reached `completed`, so the existing gate structurally could not fire | **5** |

The gate that holds this rule today fires only at `project.status =
"completed"`. `questionResolvedInvariants` does **not** require a verdict, so a
question can close without one, and a run that never completes never gets
checked at all.

**Do not read a rate off the table above.** 156 of the 161 runs predate the
completion gate (landed 2026-08-16). Split on that date the loss is 18 of 183
invocations before, and **0 of 5 after** — which is not evidence the problem is
fixed, it is a sample of five. The same split guts the obvious alternative: a
gate refusing `resolved` while a referenced summary lacks a verdict would have
refused 26% of resolves corpus-wide and **0 of 5** post-gate. That 26% measures
the corpus's age, exactly as `guardrail_shadow_report.py`'s docstring warns.

**So the deciding question is not answerable from committed data, and that is
the finding.** Neither this mechanism nor the cheaper alternative below can be
priced until enough runs postdate the completion gate. Whoever picks this up
starts there, not with an implementation.

Reproduce: `eval/runlogs/e2e/*/run-*.json` for the `Agent` calls whose
`subagent_type` is `gps-mentor`, against the sibling `.final-research.json`'s
`evaluations[]`, bucketed on the run-log date.

**If the required call is a READ, nothing can currently see it.** A read leaves
no trace in `research.json` or `tree.gedcomx.json`, so no document-decidable
precondition can reach it, and the mentor-gate bridge (make the step deposit an
artifact, then gate on the artifact) does not apply either — there is no artifact
and inventing one means writing a receipt whose only purpose is to be checked.

That is the whole niche, and it is real:

| Wanted rule | Reachable today? |
|---|---|
| `record-extractor` must call `record_read` before writing assertions from a record it was handed as a `resultsRef` | No |
| An agent that writes a place must have called `place_search` for it | Partly — the value is checkable, the *lookup* is not |
| `image-reader` must actually call `image_transcribe` before reporting `NOT READ` | No |
| `record-extraction` must actually delegate to `image-reader` before reporting an image unreachable | No. This is the one instance already written as prose: *"Do NOT decide on your own that the image can't be read and skip the call… Reporting 'image unreachable' without an actual delegation attempt is a completeness failure."* |
| `record-extractor` must not fabricate an identity confidence | Already fixed better: `extraction_append` refuses the section |

Note which side that documented instance sits on. It constrains the **caller**,
running in the main thread, not the subagent — so it needs `Stop`, not
`SubagentStop`, and `agent_id` is absent there, which changes the keying. The two
are the same class and the same argument; they are not the same hook. Probe the
subagent side first anyway: it is the narrower surface, and a main-thread `Stop`
rule can block a user-facing turn, which is a much worse thing to get wrong.

**Second constraint, from ADR-0011's satisfiability limit:** a postcondition is
only worth building where the agent can *satisfy* it after being told. Blocking a
return with "you never called `image_transcribe`" is actionable. Blocking with
"your transcription looks wrong" is not, and would loop.

## 2. The mechanism, and the one unknown

Claude Code exposes `SubagentStop`, which fires when a subagent finishes and can
return `decision: "block"` with a reason, sending the agent back to work. That is
exactly the shape asked for. Paired with `PostToolUse` to accumulate what the
agent actually called, it gives:

```
PostToolUse   → append (agent_id, tool_name, tool_input digest) to a per-agent ledger
SubagentStop  → read the ledger for this agent_id; if a required call is absent,
                decision: "block" with a reason naming the call
```

**The unknown that decides everything: does `SubagentStop` fire in Cowork?**
Nobody has checked. ADR-0005 is the reason to check rather than assume — it
records that `SessionStart` does **not** fire in Cowork, against upstream issue
threads saying it should, and that the probe wins over the thread. `PreToolUse`
does fire. `SubagentStop` is untested on that plane, and a postcondition that
silently never runs in the environment users are in is worse than none, by this
repo's own standard for a check that cannot fail.

Known, from the live payload census in `guardrail-enforcement-spec.md`:

- `agent_id` is **absent on the main thread and present inside a Task-spawned
  subagent** — so the ledger can be keyed, and main-thread calls can be excluded.
- `agent_type` for a plugin agent is **namespaced** (`genealogy-research:image-reader`),
  not bare. A rule written `agent_type == "image-reader"` never fires. This has
  already bitten a caller rule once.
- `session_id` and `transcript_path` are available and unused by anything today.
- The hook **cannot read the project documents** — `cwd` is the sandbox and the
  connected folder is not mounted — so the ledger has to live in the sandbox's own
  temp space, not the project.
- The hook budget is 20s, and hooks here **must never raise**: every failure path
  falls through to allowing the call.

## 3. What to probe, before anything else

One probe, cheap, answering four questions in order. Stop at the first no.

1. Does `SubagentStop` fire at all in Cowork, for a plugin agent?
2. Does its payload carry `agent_id` (or anything that joins to the
   `PostToolUse` records for the same agent)?
3. Does `decision: "block"` actually send the agent back, and does the agent
   receive the reason string?
4. Does the blocked agent then make the missing call, or does it loop? Two turns
   is a mechanism; ten is a hazard.

Add the answers to ADR-0005, which already owns "what hooks do in Cowork", rather
than opening a second register. If (1) is no, record that and close this out —
the fallback below is the whole remaining option.

## 4. If the probe fails

The class does not disappear; it stays where it already is. `test_universal.py`
and the e2e detectors are exactly this kind of whole-run rule, and ADR-0011's
layer table already names them: *"Harness validator — rules judgeable only over a
whole run… Eval-only; never reaches production."* So a failed probe means read
postconditions stay eval-only, and that is a stated limitation rather than a gap
to route around. **Do not compensate with prose in the agent body** — that is the
move this repo has measured losing, most recently at 23% on the completion gate.

## 5. Costs to price before building, if the probe passes

- **A per-agent ledger is session state in a place that has none.** It has to be
  cleaned up, and it has to tolerate two subagents running concurrently.
- **A blocked return is a new failure mode in production.** ADR-0011 ships gates
  with no override until a false deny is observed; a looping subagent is a worse
  false deny than a refused write, because the user watches it happen.
- **`PostToolUse` on every call adds a hook invocation per tool call**, against a
  20s budget each. Measure the added wall clock on an e2e run before shipping —
  Theme 1 of the lead-themes doc is about latency, and this pushes the other way.
- **The rule set has to stay tiny.** One or two required calls per agent, chosen
  because a real failure was observed, not because the mechanism exists.

## 6. The cheaper alternative, for the write case only

Before any of this: **move the check earlier rather than adding a plane.** Today
the mentor verdict is required at `project.status = "completed"` and nowhere
else. Requiring it at question resolution instead — a question may not go
`resolved` while a proof summary it references lacks a non-superseded
`proof-critique` verdict — uses `questionResolvedInvariants`, which already
receives `research` and the pre-call snapshot, and needs no new plane, no probe
and no session state. It shortens detection from a whole project to one step and
covers the runs that never complete.

It is not a substitute. A postcondition catches the loss at the moment, with the
agent's context still live and re-invocation cheap; this catches it at the next
gated write, and only if one comes. But it binds in every environment today,
where the hook plane fails open and may not fire in Cowork at all.

**It cannot ship on the current corpus** — 26% refusal, on runs that almost all
predate the gate that would have changed the behaviour, against 5 usable runs
after it. Per ADR-0011 a gate PR owes a corpus refusal measurement inspected per
its limits, and this one would be inspecting the wrong corpus.

## 7. Recommended sequence

1. **Get post-gate runs.** Nothing here is decidable without them. This is the
   blocking item for both options, and it is a scheduling question, not an
   engineering one.
2. Probe `SubagentStop` (section 3) — cheap, independent of (1), and worth
   recording in ADR-0005 either way, including a negative result.
3. Re-measure both rates on the post-gate corpus. If the loss is gone, close
   this out; the completion gate was enough.
4. If it is not gone: build the section 6 alternative first. It is the smaller
   change on the stronger plane.
5. Only if a loss survives *that* — an agent returning empty with no downstream
   write to catch it — implement the postcondition, for exactly one rule, and
   measure the added latency and the block-then-satisfy rate on one e2e run.
