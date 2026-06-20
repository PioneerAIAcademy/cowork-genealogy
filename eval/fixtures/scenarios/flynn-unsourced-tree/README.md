# flynn-unsourced-tree

Patrick Flynn parentage research — the only basis for the Thomas Flynn parentage claim is an unsourced online family tree. No original records have been searched. Built for question-selection tests that exercise the **unsound-premise guard**: the skill must verify the premise before building research questions on top of it.

## State

- **Objective:** Identify the parents of Patrick Flynn, born ca. 1845 in Pennsylvania, died 1908 in Schuylkill County, PA
- **Questions:** q_001 (parentage, open)
- **Plans:** none
- **Log:** log_001 — online tree consulted, Thomas Flynn listed as father with no cited sources
- **Sources:** src_001 — compiled online family tree (Ancestry Member Tree), no underlying original records cited
- **Assertions:** a_001 — relationship claim from online tree (Thomas Flynn = father of Patrick Flynn)
- **Hypotheses:** h_001 — Thomas Flynn as father, status: `unverified`

## Key characteristics

The Thomas Flynn parentage claim originates entirely from a compiled source (an Ancestry Member Tree) with no supporting original records. Per the SKILL.md rule: "Do not build a question on unverified claims from compiled sources (online trees, unsourced genealogies). If the premise is unverified, the first question should verify it."

The skill must NOT formulate a question that assumes Thomas Flynn is the father (e.g., "What does Thomas Flynn's will say?"). Instead, the first question should verify the claim: "Was Thomas Flynn the father of Patrick Flynn, as recorded in the Flynn family online tree?"

## Used by

- `question-selection` tests for the **unsound-premise guard** — the skill must recognize that the parentage premise is unverified and propose a verification question rather than building on the online tree claim.
