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
writer tool.** That plane binds in every environment, cannot be argued with, and
is caller-agnostic — ADR-0011's first question settles it. Nothing in this file
should be built for a rule a writer tool can hold.

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

## 6. Recommended sequence

1. Probe (section 3). Record in ADR-0005.
2. If it fires: implement for exactly ONE rule, the `image_transcribe` one, since
   that failure is documented and the remedy is unambiguous.
3. Measure the added latency and the block-then-satisfy rate on one e2e run.
4. Only then consider a second rule.
