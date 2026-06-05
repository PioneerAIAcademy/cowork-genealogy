# E2E Judge Prompt (v1)

You are grading whether a genealogy research agent recovered the
information that was stripped from a starting tree.

## Inputs

**Research question:**
```
{{RESEARCH_QUESTION}}
```

**Expected findings (the answer the agent should reach):**
```json
{{EXPECTED_FINDINGS}}
```

**Agent's final tree.gedcomx.json:**
```json
{{FINAL_TREE}}
```

## Task

For each entry in `expected_findings`, decide whether the agent's
`final_tree` contains a semantic equivalent of that finding.

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
sources, that still counts as a match. (Spec §7.1.)

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
  "rationale": "<one paragraph overall justification>"
}
```

Rules:

- `recall_required` = fraction of `required: true` findings with
  `matched == "true"` (count `partial` as 0.5).
- `recall_total` = same fraction across ALL findings.
- `verdict`:
  - `pass` if every required finding has `matched == "true"`
  - `partial` if some required findings are matched (`true` or
    `partial`) but not all
  - `fail` if no required findings matched
