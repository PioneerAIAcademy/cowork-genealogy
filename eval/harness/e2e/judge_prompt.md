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
