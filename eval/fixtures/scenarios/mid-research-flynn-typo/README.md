# mid-research-flynn-typo

Variant of `mid-research-flynn` with **one intentional typo** in
`tree.gedcomx.json`. Used by `ut_tree_edit_008` to test real value correction
(the existing ut_001 + ut_002 cover the no-op verify path).

## What differs from mid-research-flynn

`tree.gedcomx.json` person `I1` (Patrick Flynn), fact `F2` (Death):
- This scenario:    `date: "1908-03-21"` ← typo (day swap)
- mid-research-flynn: `date: "1908-03-12"`

The cited source is `S3` (Pennsylvania Death Certificate no. 4521), which
records 12 March 1908. The tree shows 21 March 1908 — a transcription day-swap
error.

## How `ut_tree_edit_008` exercises this

The user asks tree-edit to correct F2.date from `1908-03-21` to `1908-03-12`
(matching the cited source). Tests:
- **Edit minimality** — only `facts[].date` on F1 changes; every other byte
  of both project files is unchanged.
- **Data preservation** — no other fact, name, relationship, or source
  reference is touched.
- **Evidence grounding** — the correction is verifiable against an
  already-cited source (S3), so it meets the SKILL.md "ad-hoc edit"
  threshold.

After the edit, `validate_research_schema` should pass and `F2.date` should
read `1908-03-12`.
