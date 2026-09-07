# jesse-neal-marriage-jurisdiction-hint

Built for `ut_search_records_jurisdiction_hint` (issue #1642 Finding 1).

One subject, Jesse Neal (I1), with two placed facts: a Birth in Yell County,
Arkansas (1857) and a Residence in Union County, South Carolina (1885). One
active plan item targets a marriage search scoped to the South Carolina
residence -- the plausible but wrong jurisdiction, mirroring the real
`jimmie-jewel-neal` incident this validator exists to catch (a marriage is
filed where the wedding happened, not where the couple later lived).

The first `record_search` call (scoped to South Carolina) is stocked to
return zero matches plus a `jurisdictionHints` block naming Yell County,
Arkansas -- the Birth fact's place -- as the top-ranked candidate. The skill
is expected to follow SKILL.md's Step 4 jurisdiction-hints rule and retry
scoped to Arkansas within its next 1-2 calls, which is stocked to return a
positive match.

Hand-authored, not carved from a real case -- no committed fixture captured
a live `jurisdictionHints` payload to crib from.
