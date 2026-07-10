# Diagnosis: mikkel-blyeberg-father e2e run (blind subagent, no tree access)

**Date:** 2026-07-08
**Branch:** `e2e-mikkel-blyeberg-574`
**Fixture:** `eval/tests/e2e/mikkel-blyeberg-father/`
**Method:** Live run driven by a fresh subagent with no memory of the fixture's answer key, seeded project at `eval/e2e-project/mikkel-blyeberg-father/`, hard tool constraint (`person_read`/`person_search`/`person_ancestors`/`person_record_matches`/`person_person_matches` all blocked) — mirrors the playbook's no-cheat preamble for a live Cowork run, but executed as a blind subagent inside this session instead, since the orchestrating session had already read the fixture README during setup (see "Integrity note" below).

## Result

✅ Both questions resolved, **Probable** tier, correct answers:

- **q_001 (father):** Niels Madsen Bliberg/Blyeberg of Stagstrup
- **q_002 (death):** buried **20 December 1802**, Stagstrup, Thisted, Denmark

This is an exact match to the documented historical conclusion (FamilySearch Wiki case study), reached with zero tree access, zero readable page-image access, and a broken Lægdsruller search path.

## Sub-skill sequence (both questions, in order)

```
question-selection
research-plan (q_001)
search-records (pli_001 baptism)
search-records (pli_002 Lægdsruller)
search-records (pli_003 marriage)
record-extraction
assertion-classification
check-warnings
person-evidence
check-warnings
conflict-resolution (declined — correctly, see below)
search-records (pli_004, serendipitous probate find)
record-extraction
person-evidence
check-warnings
research-exhaustiveness
proof-conclusion (q_001 → Probable)
check-warnings
question-selection (q_002 created)
research-plan (q_002)
search-records (pli_008, burial — hit first try)
record-extraction
person-evidence
check-warnings
research-exhaustiveness
proof-conclusion (q_002 → Probable)
check-warnings
question-selection (declared objective answered, stopped)
```

No loops, no premature stops. The routing chain ran cleanly both times, and `question-selection` correctly recognized "objective answered" and did not spawn a corroboration-only question at the end.

## Tool errors, verbatim

1. **`image_read`** (pli_001, attempting to browse the 3%-indexed Stagstrup/Hassing kirkebog directly):

   > "FamilySearch image 004130616_00046 is 2.8 MB — too large to return inline. The MCP transport caps a single response near 1 MB and base64 encoding inflates the image by ~33%, so returning it would crash the session. Read the indexed record for this image with record_read / record_search instead of fetching the page scan, or choose a more specific image."

   Still current — confirmed the 700KB `MAX_INLINE_IMAGE_BYTES` cap in `packages/engine/mcp-server/src/tools/image-read.ts` is unchanged by the recent `image_read` PR (#600), which only added ark-id support alongside `imageId`.

2. **`research_append`** (batched op during q_001 record-extraction):

   > "gedcomx_source_description_id 'S1' not found in tree.gedcomx.json sources"

   Self-inflicted ordering bug — the agent referenced a tree source id before creating it via `tree_edit`. Fixed by reordering (create the tree source first, then reference it in the batch). Not a tool bug per se, but the batch-ops contract doesn't document this ordering requirement anywhere in its description.

## Conclusion vs. expected findings

| Fact | Expected | Found |
|---|---|---|
| Father | Niels Madsen Blyeberg | Niels Madsen Bliberg/Blyeberg ✅ |
| Death/burial | 20 Dec 1802, Stagstrup | 20 Dec 1802, Stagstrup ✅ |

Both graded **Probable**, self-assessed (correctly) as not "Proved" because the two most-direct record types for each fact were verified inaccessible, not merely unfound — an honest, narrow gap rather than an unsearched one.

## Strategy vs. reach, per blocker

- **pli_001 (baptism) — reach.** Root cause proven via `volume_search`: the only digitized parish volume covering Stagstrup/Hassing for 1779 is 3% indexed. No search strategy fixes an unindexed volume; the image-transport cap then blocked the fallback of browsing page images directly.

- **pli_002 (Lægdsruller) — reach, with a specific, fixable cause.** `collections_search`/`collection_read` proved the right collection and DGS folder exist (200,408 records, fully indexed by FamilySearch's own count — this is not an unindexed-volume problem like pli_001). A sanity-check search for a common surname with no birthplace filter returned 3,261 hits scattered across birthplaces nationwide, all sharing one `MilitaryService` muster-town value — proving **`birthPlace` acts as a soft ranking signal in this collection, not a hard filter**. A small rural parish's records get buried behind a larger muster district's volume of results regardless of spelling variant tried. This is a specific, reproducible finding about `record_search`'s ranking behavior in this collection type — possibly relevant to the new `rank_search_matches` tool.

- **pli_003 (marriage) & pli_008 (burial) — clean hits, first or near-first query.** These are the paths that actually closed the case. The agent didn't over-index on the one hard, browse-only record type after it stalled on pli_001/pli_002 — it kept working the plan and found alternate original-record paths (marriage, probate, burial) to the same facts.

## Integrity note (structural fixture concern, not an agent bug)

The underlying case is drawn from a public FamilySearch Wiki "Case Study" article. Ordinary `wiki_search` calls surface this article naturally during planning, and it names the father directly (this is *not* the same as reading `eval/tests/e2e/.../README.md` — it's a live hit on public FamilySearch content). The subagent driving this run was explicitly instructed not to cite or rely on any specific fact from that article after it was first noticed, and it still reached the correct answer entirely through independent record searches (marriage, probate, burial) — but any real Cowork run doing normal wiki research will hit the same public page. Worth deciding whether that's acceptable (it's public info, not a leaked test file) or whether the fixture should be reframed around a case whose primary write-up isn't itself indexed by `wiki_search`.

Separately: the orchestrating session (this one) had read the fixture's own `README.md`/`expected-findings.json` during earlier setup work, before the live run began. To keep the run's signal clean, the actual research was delegated to a fresh subagent with no memory of that content, briefed only with the objective and the tool constraint — the same effective blindness a live Cowork session would have. This diagnosis reflects that subagent's independent findings, not the orchestrating session's.

## Suggested fixes, plain language

1. **`image_read` cap:** either raise `MAX_INLINE_IMAGE_BYTES` with a downscale step, or make the "too large" error suggest a concrete alternative (e.g., a lower-resolution thumbnail endpoint) instead of just redirecting back to `record_read`, which doesn't help when the underlying volume is genuinely unindexed.
2. **`record_search` ranking in large single-collections:** investigate whether `birthPlace` (and similar locality filters) should hard-filter rather than soft-rank when a collection spans many unrelated jurisdictions under one muster/administrative point — Lægdsruller-style collections seem like the case that breaks it.
3. **Batch `research_append` ops:** document the "create tree sources before referencing them in the same or an earlier-dependent batch" ordering requirement explicitly in the tool description, since the current error message doesn't point back to the fix.

## Full artifact trail

- Sources: `src_001` (1862 burial), `src_002` (1778 marriage), `src_003` (1803 probate index), `src_004` (1802 burial)
- Assertions: `a_001`–`a_014`
- Person_evidence: `pe_001`–`pe_015`
- Proof summaries: `ps_001` (q_001, Probable, argument), `ps_002` (q_002, Probable, summary)
- Tree: stub persons `I1` (Niels Madsen Blyeberg), `I2` (Inger Michelsdatter); sources `S1`–`S4`; relationships `R1` (ParentChild), `R2` (Couple); facts `F1`–`F5`
- Full state: `eval/e2e-project/mikkel-blyeberg-father/research.json` and `tree.gedcomx.json` (gitignored, local only)
