# martin-diminutive-christening

Elizabeth Young née Martin (`I1`) married Thomas Young (`I2`) at St James, Bristol,
Gloucestershire, on 16 November 1828 — both the marriage and her maiden surname
`Martin` are already established in this scenario. One open question (`q_001`) and one
active plan (`pl_001`) with a single planned item (`pli_001`) targeting FamilySearch
Gloucestershire parish christenings, 1808–1815, to find her baptism.

No searches have been logged yet (`log: []`) — this scenario starts right before
`search-records` executes `pli_001`.

## The failure it captures

Derived from the `young-marriage-1828` e2e fixture
(`eval/tests/e2e/young-marriage-1828/`), whose required finding `f3` is the
christening of **Betty** Martin, 1 November 1812 at Bitton, Gloucestershire,
daughter of Thomas and Sophia Martin.

Across all three committed runs of that fixture, the agent issued 78 `record_search`
calls, searched `givenName: "Elizabeth"` and never once tried `"Betty"`, and `f3` is
absent from every final tree. Verified against the final trees rather than the
`.ann.json` labels.

Measured live against `/service/search/hr/v2/personas` on 2026-08-04, holding surname,
place and date range constant:

| `givenName` | Rank 1 |
|---|---|
| `Elizabeth` | Elizabeth Laura Martin (parents Robert & Sarah) — the target is **not** in the top 6 |
| `Betty` | **Betty Martin, parents Thomas Martin & Sophia** — the target |

So the record is on FamilySearch and reachable, but only under the diminutive. The
root cause is prose, not tooling: `references/name-search-mechanics.md:100` captions
its nickname table *"Auto-applied in fuzzy search"*, which tells the model FamilySearch's
default fuzzy matching already covers `Elizabeth`→`Betty`. It does not — a top-100
sample of fuzzy `Elizabeth` returns `Elizabeth:72 Eliza:14 Betsy:10` and **no** `Betty`.

## Caveats for the reviewer

- **Verify this carve is the pre-failure state.** It is a best guess at what
  `search-records` saw before it went wrong: the marriage and maiden name retained as
  inputs, the christening (the bad *output* — never found) absent.
- Deliberately absent from both files: `Betty` and `Sophia`. Those are what the search
  must discover; seeding them would defeat the test.
- **Also deliberately absent: the insight itself.** `pli_001.rationale` states the
  window and why (full age at an 1828 marriage) and stops there. It must NOT say that
  parish registers of this period often record a child under a familiar form of the
  name — that sentence was in the first draft and was removed in review. It is the
  conclusion the skill's own reference docs are supposed to supply, so seeding it in
  the input lets the test pass on the scenario's hint rather than on the doc changes
  this test exists to gate. Same rule for any future edit here: the scenario carries
  the *situation*, never the *technique*.
- **Recorded-e2e exception on PII applies** — the subject is deceased and public, and
  the exact name/date/place *is* the finding under test, so real identifiers are kept
  (scrubbing `1 November 1812` to `1810s` would make the test ungradeable).
- Fixture ordering is load-bearing: `mock_mcp.py` breaks on the **first** matching
  predicate, so **both** hit fixtures —
  `record-search-martin-betty-christening-hit` (diminutive in `givenName`) and
  `record-search-martin-betty-alt-christening-hit` (diminutive in `givenNameAlt`,
  the single-call UNION lever) — must stay ahead of
  `record-search-martin-elizabeth-no-target`, whose bare surname predicate would
  otherwise swallow either call. Reordering them silently inverts the test.
- Two hit fixtures rather than one because predicates are **AND-only**
  (`fixtures.py::matches`), so a single predicate cannot say "Betty in `givenName`
  OR in `givenNameAlt`". Keep their `response` blocks identical apart from
  `response.query`.
- Neither hit fixture fires for `Betsy`, `Bess` or `Eliza`, **by design**: the record
  is indexed as `Betty`, so those forms legitimately return nothing and the skill is
  expected to keep trying. The validator still credits them as attempts — trying a
  reasonable familiar form and finding nothing is correct behavior, and only `Betty`
  reaches this record.

## Use when

Testing that `search-records` tries a period **diminutive** as a given-name value
(a different name, not a spelling variant and not a `*Exact` qualifier) when a search
under the formal name fails to surface the expected record.
