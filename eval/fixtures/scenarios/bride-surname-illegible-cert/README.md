# Scenario: bride-surname-illegible-cert

A research project whose single gathered record — an 1889 Dubuque County,
Iowa marriage certificate — establishes the bride's given name ("Ellen")
but leaves her **maiden surname illegible** in the register image.

## State

- **Subject:** Ellen Doyle (`I1`), b. ~1868, m. Michael Doyle 12 June 1889.
- **Husband:** Michael Doyle (`I2`).
- **Question `q_001`:** Ellen's maiden surname — `in_progress`, **not** declared
  exhaustive.
- **Plan `pl_001`:** `completed` — its one item (`pli_001`, the 1889 marriage
  record) is `completed`.
- **Assertions:** `a_001` is the bride's name with a **tentative** surname
  (`value: "Ellen [?]"`, and an `informant_bias_notes` flag that the maiden
  surname is illegible/unresolved from this record). `a_002` (marriage) and
  `a_003` (groom) are clean. Identifying assertions are linked via
  `person_evidence`, so the exhaustiveness precondition passes.

## What it exercises

The plan is complete and the identifying assertions are linked, so a naive
pass would **declare the question exhaustive** — but the maiden surname is
still tentative, and a **premarital record the project never searched** (e.g.
the 1880 US census showing Ellen as a child under her maiden surname in her
father's household, or an Iowa birth/baptism record) could **independently**
resolve it. The illegible certificate is *not* the only avenue.

- `research-exhaustiveness` must run its **tentative-value sweep** and
  **decline** to declare — routing to `research-plan` for the unsearched
  alternative record type — rather than treating the illegible image as an
  inaccessible-source exception.
- `proof-conclusion`, if it runs, must **not** write that the maiden surname
  "requires the marriage certificate image" or is otherwise unresolvable; it
  must name the unsearched alternative (premarital census / vital record) as an
  open avenue.

A companion scenario, `bride-surname-illegible-cert-declared`, carries the same
facts with `q_001` already (prematurely) declared exhaustive, to exercise
`proof-conclusion` directly.
