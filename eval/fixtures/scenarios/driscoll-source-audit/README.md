# driscoll-source-audit

Source audit of Cornelius Driscoll (`GJ72-9WD`), an Irish emigrant baptised in
the Skibbereen area of Co. Cork and living at Sherbrooke, Canada East by 1861.
Seven sources are attached to the profile. No project work has been recorded —
this scenario is about auditing what is already attached, not about research
state.

**Synthetic test data.** These persons are fabricated fixtures, like the Flynn
and Hole scenarios — *not* real FamilySearch profiles. The person IDs use the
real `GJ72-9W*` shape so a skill's "is this a FamilySearch ID?" gate fires. All
tool responses are mocked from `eval/fixtures/mcp/`; nothing hits FamilySearch.

- **`GJ72-9WD` — Cornelius Driscoll** (subject). Profile records a birth of
  `1814` in `Ireland`, a marriage on `9 June 1849` at Sherbrooke, an 1861
  residence there, and a burial place with **no burial date**. It records **no
  death date at all**.
- **`GJ72-9WF` — Margaret Hayes** (wife). Present so the marriage has a
  spouse; nothing is attached to her.

## What it exercises

Written as the capability under test, not the correct outcome — this file is
pasted verbatim into the judge prompt, so a bullet phrased as "the skill must do
X" would be an answer key delivered to the grader.

- **Telling a difference in *precision* from a difference in *value*.** One
  attached record states a full date and a parish where the profile states a
  year and a country.
- **Deciding what to report when the evidence does not decide.** One attached
  index entry disagrees with the profile on a single field and carries no
  corroborating detail — no spouse, no age, no household — so the entry is
  consistent with more than one explanation.
- **Distinguishing a disagreement between a source and the profile from a
  disagreement between two sources.** Two attached records bear on a death the
  profile does not record, and give dates seven years apart. Separately, a
  census age and a baptism year differ by about two years.
- **The remediation doctrine on a record whose date is exact.** One attached
  record's indexed date differs from the profile's by a single digit.
- **Honesty about what could not be read.** One attachment is a contributor
  upload with no indexed record behind it.
