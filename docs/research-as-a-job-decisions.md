# Research as a job — decisions asked and answered

A record of the questions put to the product owner during this work, the answers given,
and what each one changed. Kept so a later session, or a reviewer, can see **why** the
code is shaped as it is without reconstructing it from diffs.

Verbatim where it matters. Where an answer needed translating into something buildable,
the translation is shown beside it and labelled as such.

---

## Phase 3, item 2 — errands and a `waiting` state (asked 2026-09-30)

An errand is work only the researcher can do: a document only they hold, a repository only
they can reach. A planned search is marked `planned`, `in_progress`, `completed` or
`skipped` — **there was no mark for "waiting on you"**, and nowhere to write what was being
waited for.

### Q1. When the agent is waiting on you, is the search still "in progress"?

> **Answered:** "When the agent is waiting on you, the search is still in progress. So it
> should be in progress AND waiting, then it should add a short comment of what it's waiting
> for, and when the user provides it, it continues the search automatically."

`waiting` sits **beside** `in_progress`, not instead of it, and carries a note of what is
awaited.

### Q2. Can research be called "finished" while it is still waiting on you?

> **Answered:** "Of course no. If it's in progress and waiting on me so it can do the
> research better/complete it, it means it isn't finished. The only time is if the user
> ignores the agent waiting on it, by saying *proceed without it* — the agent continues by
> skipping the ask, and at the end of the research the agent should let you know the result,
> what was skipped, and its implication (if any). After that the user should be able to give
> the answer (if he or she wants to) and tell the agent to redo it, so the agent resumes from
> the exact state it previously asked for something from the user, and now completes the
> research completely."

An outstanding errand does **not** permit `completed`. One escape — *proceed without it* —
after which the run must report the result, what was skipped, and what the skipping implies.

**Translation flagged at the time, and confirmed by the owner:** "resumes from the exact
state" is built as **re-opening that item** with the new answer — the item is the resume
point — not as rewinding the run. Sessions move forward and the work done after the ask is
real. The owner replied: *"Yes re-open that item is the best way to go."*

**Consequence recorded:** "what was skipped and what it implies" is a reasonably-exhaustive
claim bearing on GPS Element 1, not a courtesy line.

### Q3. Where do we write down what is needed from you?

> **Answered:** "Yes it should get noted on the search."

On the search **as well as** in the errand record — an ad-hoc errand has no plan item to live
on, so the record exists regardless.

### Q4. When you answer, does the job pick up where it was, or start fresh?

> **Answered:** "Yes it should pick up where it was, from the state it was."

### Q5. Which of the three in-flight changes to the same field goes first?

> **Answered:** "#1830 goes first, it has been assigned to Benter. The other issues are still
> in backlog."

---

## Phase 3, item 3 — what "rejected" means in the data (asked 2026-09-30)

When the agent links a record to a person it records how sure it is — `confident`,
`probable`, `speculative`. **There was no way to say "no".** So a researcher's *"that is not
the same person"* had nowhere to live, and the system could re-link the same pair later. That
is the reported failure: a researcher challenged an assumption and the agent reverted to it,
because nothing recorded the rivals.

Three options were put, with their costs:

1. **Delete the link.** Simple, but the system forgets you said no.
2. **Add a fourth value, `rejected`.** Keeps it on the record — but that field means *how sure
   are we this IS a match*, and rejected is the opposite claim, not a degree of it. Every
   reader would have to learn a value meaning "ignore this row".
3. **A separate "not a match" record.** Cleanest meaning, and makes "never re-link without new
   evidence" enforceable. Costs a new section.

> **Answered:** "go with the third option for item 3."

Built as option 3. The refusal is a **writer-tool precondition**, not prose: whether a pair was
rejected is decidable from `research.json` alone, which per ADR-0011 puts it in the tool — a
rule in a skill body is a rule the model may not follow.

---

## Earlier standing decisions, recorded for the same reason

- **R9 (phase 3 item 1).** *Not sure* continues on the **recommended** option, never "the
  weaker choice" — because "weaker" was undecidable as written, and *not sure* means deferring
  to the agent's judgement, which it has already formed.
- **R10.** The bounded-request acceptance names an identifiable person. Its original example,
  "Mary Hales", matches tens of thousands of people and so never reaches the path it means to
  test.
- **Cost rule (standing).** Prefer the subscription; use API-key spend only where nothing else
  will do.
- **Conversions.** Converting a skill to an agent **deletes the skill** — a move, not a copy.
- **Test rule (standing).** Editing a skill means every test for it passes, including ones that
  were already failing.
- **gps-mentor** is out of `/research` and requested by the researcher afterwards.
