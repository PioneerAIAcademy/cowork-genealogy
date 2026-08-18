# Scenario: feliciana-parish-boundary-split

The state immediately before `research-plan` writes the plan for a
question naming a jurisdiction that underwent a **geographic** boundary
split within the target date range — the canonical worked case from
issue #1472 (Feliciana Parish, Louisiana splitting into East and West
Feliciana Parish in 1824). No plan for q_001 yet.

- **Subject:** Silas Bankston (`I1`), documented residing in "Feliciana
  Parish, Louisiana" per an 1820 census (before the split). No
  relationships, no marriage record yet.
- **q_001** (`open`): "Where did Silas Bankston marry, circa 1828?" — by
  1828 the parish had split (1824); the rationale states plainly that
  exactly where within the old, undivided parish the family resided at
  the time of the split is not established, so which successor parish
  (East or West Feliciana) holds the 1828 marriage record is unknown.
- `plans` is empty — research-plan should create the first plan (Add-new
  path).
- `localities` already has an entry (loc_001) for "Feliciana Parish /
  East and West Feliciana Parish, Louisiana" that has already surveyed
  the split and states it plainly as geographic/ambiguous (mirroring the
  locality-guide fix landed alongside this rule) — so the "no localities
  entry" stop condition doesn't apply, and research-plan is being tested
  purely on what it does with a split it already knows about.

The point of this scenario: a *confirmed* geographic boundary split is
not a `fallback_for` relationship between a primary and a backup — it
calls for a co-equal plan item under **each** surviving jurisdiction,
because the records could genuinely be under either name. A plan with
one item under "East Feliciana Parish" and the other only as
`fallback_for` (searched only if the first comes back empty) is the
failure this scenario guards against; so is a plan that names only one
successor and omits the other.

Derived from issue #1472 (Rule 1)'s own worked example, drawn from a
real feedback report — not from a captured live failure (no
project/e2e run for that report exists in this repo), so this is a
hand-authored positive test rather than a mined one. Fictional subject
(Silas Bankston); Feliciana Parish's 1824 split is real Louisiana
jurisdictional history.
