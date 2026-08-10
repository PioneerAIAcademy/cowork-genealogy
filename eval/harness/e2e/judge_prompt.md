# E2E Judge Prompt (v2)

You are grading a genealogy research agent on **two separate axes**:

1. **Recall** — did the agent recover the information that was stripped
   from the starting tree? Graded from the agent's final tree.
2. **Proof quality** — is the agent's written GPS proof statement sound?
   Graded from the agent's proof summaries.

These are independent. Recall is the verdict. Proof quality is an
advisory score that does **not** change the verdict — a run can recover
every fact (recall `pass`) while writing a weak proof statement (low
`proof_quality`), and vice versa. Grade each axis on its own evidence.

## Inputs

**Research question:**
```
{{RESEARCH_QUESTION}}
```

**Expected findings (the answer the agent should reach):**
```json
{{EXPECTED_FINDINGS}}
```

**Agent's final tree.gedcomx.json (grade RECALL from this):**
```json
{{FINAL_TREE}}
```

**Agent's proof summaries from research.json (grade PROOF QUALITY from this):**
```json
{{PROOF_SUMMARIES}}
```

## Task 1 — Recall (the verdict)

For each entry in `expected_findings`, decide whether the agent's
**final_tree** contains a semantic equivalent of that finding. Grade
recall from the tree only — do **not** credit a finding that appears
only in the proof summaries and not in the tree (the tree is the
deliverable that uploads to FamilySearch).

Be tolerant of:

- Differing source IDs and ARK URLs (FamilySearch may serve the same
  underlying record under different IDs)
- Date/place formatting variation (`~1820`, `abt. 1820`, `approximately
  1820 Virginia, USA`, etc.)
- Person identifier variation — the agent may have created a new
  person record for "Robert Smith" rather than matching one that was
  hinted; that's still a match if the new person has the right name
  and key facts
- Note wording / narrative phrasing

Mark a finding `partial` when the agent recovered some of its details
(e.g., found a person with the right name but wrong birth year) but
diverged on a key fact.

### Relationship findings — decompose before labelling

A finding with `"type": "relationship"` is graded on its **relationship
components**, not on whether the named people exist. A person record alone
never satisfies a relationship finding.

Apply this mechanically, in order:

**1. List the components, each tagged `link` or `detail`.**

- **`link`** — a relationship the finding asserts between two people. These are
  what the finding is *about*, and they are the only components that score.
- **`detail`** — biography that identifies *which* person is meant: birth dates,
  occupations, residences, death years. Recorded for transparency, never scored.

"Manoel and Cândida had a daughter Josefa, who married Elfridio" is three
links: father, mother, spouse.

"John Laurie Sr. was the father of John Laurie. Born 1833 in the Gorbals; an
iron moulder; died 1910" is **one** link — the father link. Everything after it
is `detail`: it tells you which John Laurie Sr. is meant, not something the
agent must add to the tree.

The existence of a person the finding names, however well identified or sourced,
is **not** a component at all. The finding is about the links between those
people; the people are their endpoints. A run that recovered only the person has
**zero** links supported.

**2. Mark each one from the tree only:** *supported* (present in the tree),
*unsupported* (absent), or *contradicted* (the tree asserts something
incompatible).

**3. Emit the label, counting `link` components only:**

| Links | `matched` |
|---|---|
| Any link contradicted | `"false"` |
| **No** link supported | `"false"` |
| Some supported, some unsupported | `"partial"` |
| All supported | `"true"` |

A bare person record with no relationship supported is `"false"`, not
`"partial"` — `"partial"` requires at least one claimed relationship to actually
exist in the tree. A missing `detail` never lowers the label.

**Record every component in the `components` array** — one entry per claim,
each with its `claim` text, its `kind` (`link` / `detail`) and its `status`
(`supported` / `unsupported` / `contradicted`). `matched` is computed from the
`link` entries, so the components are the part that must be right.

**4. Emit the label from the count. Do not adjust it afterwards.**

State the number of supported components in `notes`, then read `matched`
straight off the table above for that number and emit exactly that value.
The label is a lookup, not a second judgement — you have already done the
judging in steps 1–3.

Two moves are specifically forbidden, because both have happened:

- **At zero supported components, `"partial"` is not available.** `"partial"`
  means *some* claimed component was found. If none was, the only correct value
  is `"false"` — however well the people themselves were identified, sourced or
  named.
- **`"true"` is not available** when your own `agent_evidence` or `notes` say a
  claimed relationship or detail is missing, absent, or not established.

If you find yourself writing a rationale that concludes one label and then
emitting a different one, the rationale is right and the label is wrong. Emit
the label your own reasoning arrived at.

Scoping:

- The person-identifier allowance above — a newly created person record counts
  as a match if the name and key facts are right — applies to findings that ask
  for a **person**. It never satisfies a relationship component.
- A spouse link satisfies a marriage claim that names no date. If the finding
  **claims a date**, that date is its own component: a spouse link with no
  marriage date is `"partial"`.
- Where a finding states that a detail is unresolved and either value is
  acceptable, honour that — the component is supported if the tree carries
  either.

This section does not apply to `polarity: "avoid"` findings.

Do **not** require that the agent's citations match the
`supporting_sources` list exactly — `supporting_sources` is provided
for context only. If the agent found the right answer via different
sources, that still counts as a match.

### Negative findings (`polarity: "avoid"` — the agent should NOT conclude something)

Some fixtures test restraint, not recall. A finding with
`"polarity": "avoid"` describes a **wrong** candidate the agent should
decline to assert. (An older fixture may express this only in the
finding's text — e.g. "the agent should NOT conclude that the father is
the other Robert Smith of the next county" — treat those identically.)
For such a finding, `matched == "true"` means the agent **correctly
avoided** asserting it (the wrong candidate is absent from the tree, or
is present only as an explicitly unresolved/rejected hypothesis).
`matched == "false"` means the agent over-claimed it. Every finding
without `polarity: "avoid"` (and without such text) is a normal
recover-this finding.

## Task 2 — Proof quality (advisory score)

Read the agent's **proof summaries**. Find the one for this research
question (if any). Grade how sound the *written proof* is — independent
of whether recall passed. Judge:

- **exhaustiveness** — does `exhaustive_search_summary` describe a
  reasonably exhaustive search (multiple record types / repositories),
  or did the agent stop at the first hit? (`yes` / `partial` / `no`)
- **conflicts_addressed** — if the evidence had conflicts (e.g. two
  candidates, disagreeing dates), does the narrative resolve them with
  reasoning? `na` if there were genuinely no conflicts to resolve.
  (`yes` / `partial` / `no` / `na`)
- **corroboration** — does the conclusion rest on **independent**
  sources that agree, or a single source? (`independent` /
  `single_source` / `na`)
- **tier_appropriate** — is the declared `tier` (`proved` / `probable`
  / `possible` / …) justified by the strength of evidence in the
  narrative, or over-stated? (`yes` / `no` / `na`)

Then set `score`:

- `3` — sound: exhaustive search, conflicts resolved, independent
  corroboration, tier matches evidence.
- `2` — partial: recovers the answer but the proof is thin (single
  source, or an unresolved conflict, or an over-stated tier).
- `1` — unsound: asserts a conclusion the narrative does not support
  (no real search, no corroboration, over-claimed tier).
- `null` — **no proof summary exists** for this question. Not a
  failure of the proof; there is simply nothing to grade. Set every
  sub-field to `na`.

Proof quality never changes the verdict. Grade it honestly even when
recall failed (a failed run can still have a thoughtful partial proof)
and even when recall passed (a lucky single-source match is `score: 1`
or `2`, not `3`).

## Output

Return **only** valid JSON conforming to this shape (no prose, no
markdown fences around it):

```json
{
  "per_finding": [
    {
      "finding_id": "f1",
      "matched": "true" | "partial" | "false",
      "agent_evidence": "<which element in the final tree supports the match, or empty>",
      "notes": "<short rationale>"
    }
  ],
  "recall_required": 0.0,
  "recall_total": 0.0,
  "verdict": "pass" | "partial" | "fail",
  "rationale": "<one paragraph overall justification of the recall verdict>",
  "proof_quality": {
    "score": 1 | 2 | 3 | null,
    "exhaustiveness": "yes" | "partial" | "no" | "na",
    "conflicts_addressed": "yes" | "partial" | "no" | "na",
    "corroboration": "independent" | "single_source" | "na",
    "tier_appropriate": "yes" | "no" | "na",
    "rationale": "<short justification of the proof-quality score>"
  }
}
```

Rules:

- `recall_required` = fraction of `required: true` findings with
  `matched == "true"` (count `partial` as 0.5).
- `recall_total` = same fraction across ALL findings.
- `verdict` (recall only — proof quality does not affect it):
  - `pass` if every required finding has `matched == "true"`
  - `partial` if some required findings are matched (`true` or
    `partial`) but not all
  - `fail` if no required findings matched
- If there is no proof summary for the question, `proof_quality.score`
  is `null` and every proof-quality sub-field is `na`.
