# Deep dive: search-records — prohibition list (Step 1)

Checkable rules pulled from `search-records/SKILL.md`, for the next auditor to
start from. Items 1-18 are mercyokum's original Step-1 list from issue #1642 —
reproduced here rather than re-derived, per the guide's "save it, because the
next person auditing this skill starts from it" — with a coverage column added
and 19-33 appended for rules the original pass didn't reach (mostly Step 4's
match-triage block and the census/jurisdiction rules added or changed since).

**Coverage key:** *guard* = a deterministic validator in
`eval/harness/validators/test_search_records.py` fails the run when the rule is
broken. *tag-gated* = that guard only runs on tests carrying a specific tag, so
it is inert on the rest of the suite. *judge* = the LLM rubric grades it, no
deterministic backstop. *none* = nothing checks it.

| # | Rule | SKILL.md | Coverage |
|---|---|---|---|
| 1 | Must not call `project-status` (or read/query state) before routing a planning question — route to `research-plan` immediately, with no prior tool calls. | Route check | none (closed as a doctrine question instead — see commit `99a728a0`, covered by a state-harm invariant, not a compliance test) |
| 2 | Must not run `fulltext_search` or delegate to `search-full-text` from this skill. | "MCP tools and routing" | none |
| 3 | A collection-mismatch is not a nil — must not apply spelling-variant escalation to it. | Step 5 | none |
| 4 | Must never drop `givenName` on a retry — surname-only is not a valid lever. | Step 8.2 | none — and disputed: issue #1817 (folded into #1642) flags this against `search-strategy-levers.md:48`/`:109-110`, parked pending the lead's #1008 answer |
| 5 | Must never set an `*Exact` qualifier to try to find a record it could not otherwise find. | Step 2 | none |
| 6 | Every search, including nils, must get its own `research_log_append` call — "a search without a log entry is a search that didn't happen." | Step 5, "Important rules" | guard, untagged (`test_positive_appends_log_entry`) for positive tests; nil-sidecar shape is tag-gated (`sidecar-nil`) |
| 7 | Must never edit, reorder, or reformat an existing `log[]` entry — append only. | Step 5, "Important rules" | guard (`test_log_append_only`, universal validator, not this file) |
| 8 | The plan-item status update (Step 6) must happen the same turn as Step 5, before Step 7. | Step 6 | none — ordering across turns isn't visible to a validator |
| 9 | Must not set plan-item status to `completed` from this skill. | Step 6 | none |
| 10 | Must not offer extraction as a next step for a needs-review/disqualified match — "not even as a question." | Step 4 | judge (Result triage / rubric.md) |
| 11 | Must not report a disqualified record's parents/spouse/children as findings. | Step 4 | judge |
| 12 | Must not stop after dismissing the top candidate — triage the full ranked top 10 before moving on. | Step 4 | judge |
| 13 | Must write "consistent with," never "confirming," when `relativeTerms` is `absent`/`unknown`. | Step 4 | judge |
| 14 | Must cite `matchScore`, never a raw stub's `score` — different numbers. | Step 4 | none |
| 15 | Must actually call `Skill("search-external-sites")` (not narrate it) once 3+ FamilySearch variants nil on an important plan item. | Step 8.7 | guard, tag-gated (`test_escalates_to_external_sites_after_fs_exhaustion`, `familysearch-exhausted`) |
| 16 | Must not describe results as "logged with sources"/"saved"/"recorded" unless `record-extraction` ran this turn and returned `src_`/`a_` ids. | Step 9 | judge |
| 17 | Must try at least 3 lever variations for important plan items before declaring negative. | Step 8.3 | none |
| 18 | A nil on a browse-only/low-index collection must not be narrated as absence — note the un-indexed likelihood, keep the plan item `in_progress`. | Step 8.5 | none |
| 19 | Anchor rule: every `record_search` query must include `surname`, `recordCountry`, or `batchNumber`. | Step 2 | guard, packaging-level — `packages/engine/mcp-server/tests/packaging/lever-anchor-shapes.test.ts` runs every lever's own prescribed query shape through the shipped `validateInput()` (built this session, closing clack391's validator request) |
| 20 | `batchNumber` on a result opens the whole extraction — send it as the only search filter; one page is not the batch (page with `offset`, partition by `surname` past `offset + count = 4999`). | Step 4 | none at runtime; the anchor half is covered by #19's lint |
| 21 | Follow a returned `jurisdictionHints` — the next 1-2 retries must set `recordCountry`/`residencePlace`/`birthPlace` to the top-ranked hint's place before reverting. | Step 4 | guard, tag-gated (`test_jurisdiction_hints_followed`, `jurisdiction-hints-followed` — built this session, closes mercyokum's Finding 1) |
| 22 | Pre-1880 US censuses have no relationship column — a log note describing such a household must mark the family structure inferred, not stated, including a clean, unconflicted top match (the "not just needs-review" scope is new as of this session). | Step 4 | guard, tag-gated (`test_pre1880_census_structure_marked_inferred`, `pre-1880-census-household`) |
| 23 | Do not offer extraction as a next step for any top match that hasn't cleared needs-review on every check — the namesake gate generalizes to every match, not just the disqualified-namesake branch. | Step 4 | judge — this is the rule DallanQ's opening comment found contradicted; the contradiction is now resolved in prose (confirmed no `matchScore` numeric threshold remains anywhere in the file) but nothing deterministic backs it |
| 24 | Warm-framing ban: never "Top Match", "almost certainly the right person", "highly promising", "very likely ours", "a strong candidate" for a flagged match. | Step 4 | judge — "a strong candidate" is now in the list (DallanQ's suggested widening) |
| 25 | Civil-death-registration exception: a <=5-year birth-year discrepancy does not by itself disqualify a match when the full given name is exact. | Step 4 | judge |
| 26 | An `absent`/`unknown` relative-anchored hit is still a candidate — never a reason to stop searching or escalate elsewhere on its own. | Step 4 | none |
| 27 | Every `log[]` entry must carry `id`, `plan_item_id`, `performed`, `tool`, `query`, `outcome`, `results_examined`, `external_site` (null for FamilySearch searches). | Step 5 | guard, structural (`validate_research_schema`, universal — not this skill's own file) |
| 28 | Collection-mismatch logs `outcome: "partial"`, never `"negative"`. | Step 5 | none |
| 29 | Sidecar correctness: any positive/partial result gets a `results/<log_id>.json` sidecar with a matching `returned_count`; a zero-result search omits it. | Step 5 | guard, tag-gated both directions (`test_sidecar_written_for_positive_search` / `sidecar-write`; `test_no_sidecar_for_nil_search` / `sidecar-nil`) |
| 30 | Log each retry as its own `research_log_append` call, or grouped into a batched `ops[]` call flushed every few retries — never held for one call at the end of a whole ladder. | Step 8.2 | none — this wording is new as of this session (batching is now permitted, closing florencemashipei's Finding 2 contradiction between the old ban and the tool's own `ops[]` affordance); the "flush every few retries" half is unguarded |
| 31 | No plan item -> no escalation to external sites, however many variants nil. | Step 8.7 | none |
| 32 | Do not delegate to `search-external-sites` without it then calling its own tools — a caller cannot invent third-party URLs from prose. | Step 8.7 | guard, tag-gated (`test_live_callee_used_its_own_tools`, `live-callee`) |
| 33 | A single-search nil under a mandated next-lever scenario must not end in a permission question ("should I", "would you like") — the lever must already have run. | Step 8.2 | guard, tag-gated (`test_no_permission_ask_before_mandated_lever`, `asks-permission-instead-of-executing` — built this session, closes mercyokum's Finding 3) |

## Coverage summary

Of 33 checkable rules, **10 have a deterministic guard**: 6 are purely
tag-gated (rows 15, 21, 22, 29, 32, 33), 1 mixes an untagged base check with a
tag-gated stricter shape (row 6), and 3 are universal/packaging-level checks
that run regardless of tags (rows 7, 19, 27). The remaining 23 rely on the LLM
judge or nothing at all. This matches the pattern the guide's own worked
examples describe: the body is most detailed exactly where scrutiny is
hardest to mechanize (Step 4's match-triage judgment calls), and least
guarded where a genealogist's read is the only backstop.

**Judgment calls that do not convert** (per the guide's "what does not
convert"): whether a needs-review flag was the right call, whether a search
strategy was well-sequenced, whether "reasonably exhaustive" was actually
reached. These stay with the judge and `rubric.md` — no validator request is
owed for them.

See [search-records-findings-2026-08-28.md](./search-records-findings-2026-08-28.md)
for what was actually done with this list this round, and what is still open.
