# TODOS

## `record_read`-by-ARK MCP tool

**What:** A new MCP tool that fetches a single record's GedcomX given its
ARK (the persistent FamilySearch identifier).

**Why:** It dissolves the courier-fidelity risk for the identity-match
path. Instead of trusting a hand-copied sidecar, person-evidence would
persist only the tiny ARK (which couriers reliably) and re-fetch the
record GedcomX fresh at match time.

**Pros:** Makes the `match_two_examples` path fidelity-proof; only a
short ID is persisted, not a large payload.

**Cons:** A full new MCP tool (network, auth, types, tests). Does not
help the broader GPS retention goal — full-text snippets still need
sidecars. A re-fetched record could differ from the original if
FamilySearch re-indexed it.

**Context:** Raised in the 2026-05-21 eng review of
`docs/plan/research-log-result-retention.md` as the cleaner-but-bigger
alternative to sidecar retention for the match path.

**Depends on / blocked by:** The courier-fidelity gating spike in
`docs/plan/research-log-result-retention.md`. If the spike shows Claude
cannot faithfully courier large payloads, this tool becomes the likely
fix and should be promoted from TODO to plan.
