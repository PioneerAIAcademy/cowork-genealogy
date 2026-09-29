# Plan: the record-structurer agent (issue #2939)

**Status:** not started. The spec is written, to the lead's 2026-09-29 call
shape: `docs/specs/record-structurer-agent-spec.md` and
`research-append-tool-spec.md` §11.7. #2937 and #2939 land on `main` as **one
merge**, so PR #2979 does not merge on its own first.

This file holds the section walk the issue asks for. It becomes the PR body's
walk, and the file is deleted when the PR merges.

## Section walk — where every part of `record-extractor.md` goes

Key: **code** = #2937's `record-extract.ts` / `extraction-append.ts`.
**§11.7** = document-mode code this card adds. **agent** = the new body.
**dropped** = the reason is given.

| `record-extractor.md` section | Goes to | Note |
|---|---|---|
| Intro: classifications are "first and final" | dropped | Code classifies on both paths, so the warning has no one to warn. |
| No narration preamble | agent | Unchanged. |
| Invocation contract table | agent §2 | One spawn per batch. Each source arrives as a `resultsRef` or inline text. `imageFilename` and `documentForm` are added. |
| Getting-the-record-content preference order | dropped | Its live and sidecar `record_read` arms are #2937's path now. This path reads with `sidecar_read` or takes inline text. |
| One `project_context` call | dropped | `questionIds` come from the caller. Nothing the agent reads needs project state. |
| Data boundary | agent §4 | Issue #2485. The pin in `tests/packaging/` that guards the fence is repointed to the new body. |
| GPS foundation 1 — faithful capture | agent §4 | |
| GPS foundation 2 — objectivity | agent §4 | This is "extract contradicting facts equally". The agent emits every stated value. |
| GPS foundation 3 — per-layer independence | code | The layers are separate columns of the §11.6 table. |
| Step 1 — `source_classification` rules | §11.7 | Decided from `documentForm`. "An image you examined is original" (issue #2475) is in agent §4. |
| Step 1 — source entry fields | code | `buildExtractionOps`, fed from `document.source`. |
| Step 1 — "original not examined" | §11.7 | `index_entry` / `abstract` → `derivative`. The reason goes in `source.notes`. |
| Step 2 — role naming convention | code | Plus §11.7's `statedRelation` mapping. |
| Step 2 — the literal `absent` | code | `absentPersons` builder. |
| Step 2 — a differently-surnamed head is a FAN lead | code | The agent's return is now the tool's summary verbatim, so the lead has to come from code: the summary names a head whose surname differs from the principal's. |
| Step 2 — no pre-1880 relationship assertions | code | `suppressRelationships`, plus §11.7's "statedRelation is ignored when there is no column". |
| Step 2 — positional roles | code | `positionalCensusRoles`, fed array order. |
| Step 2 — obituary survivor lists | agent §4 | The in-law and neighbour **roles** come from `statedRelation` in §11.7. |
| Step 2 — marriage order and consent signer | agent §4 | `marital_status` fact, `statedRelation: "consent signer"`. |
| Step 2 — consent on the reverse of the license | agent §4 | |
| Extraction policy (BCG 27, skip unrelated facts) | dropped | Code extracts every stated value, as on the indexed path. A relevance filter is a judgment code does not make. `questionIds` scope the assertions instead. |
| The `name` comes first | code | Name is pushed first per persona. The "every named person is their own person" half is in agent §4. |
| Blank columns produce no assertions | agent §4 | The agent emits nothing for a blank. Code emits only what is present. |
| Step 3 — one fact per assertion; date/place split | code, §11.7 | The split is keyed on `computed`, not on record type. |
| Step 3 — computed birth is an approximate year | agent §4, §11.7 | The agent marks it. Code sets `approximate`. |
| Step 3 — assertion fields, `date_certainty` enum | code | |
| Step 3 — `record_id` | code | |
| Step 3 — whose role | agent §4, code | Separate person in the document. Role in code. |
| Step 3 — `record_persona_id` | §11.7 | Never set on this path, which is what the current rule already says for "no sidecar". |
| Step 3 — `value` is what the record says; one parent per relationship; stated only | agent §4, code | |
| Step 3 — `structured_value`; no `_inferred` | code | |
| Step 3 — sex for every persona | agent §4, code | |
| Step 3 — `standard_place` | code | The writer resolves it. |
| Layer 2 — decision tree and informant rules | code | The §11.6 table. Two §11.7 overrides: a named informant, and `uncertain` lowers `primary`. |
| Layer 2 — census / death / marriage / christening informant tables | code | The §11.6 table rows. |
| Layer 2 — funeral director scoped; burial index has no informant | code | The burial row, added on #2979 (commit 9c726c709). |
| Layer 2 — evidence independence (shared informant) | dropped | Needs a cross-source view one record does not have. It is `conflict-resolution`'s independence analysis. |
| Layer 3 — `record_basis` doctrine, "was it in a field?" | §11.7 | Becomes the `computed` mark's definition in agent §4. |
| Epistemic cap — `[?]` and the caller's doubt | agent §4, §11.7 | Widened to self-noticed (lead, 2026-09-27). |
| `log_entry_id`; `research_log_append` if no entry | code | `extraction_append` writes the log entry itself (lead, 2026-09-29). |
| `extracted_for_question_ids` | code | From `questionIds`. |
| Step 4 — one call; evidence-type self-check | agent §3 | The self-check becomes "did I list every computed attribute". |
| Step 4 — retry on `ok: false` | agent §3 | |
| Step 4 — correcting via `update` | dropped | Document mode appends. A correction is a re-extraction. |
| Step 4 — cannot write `person_evidence`; identity goes in the summary | code | The section allowlist enforces the first half. An identity puzzle is named in the tool's summary. |
| Negative evidence | code, agent §4 | Code builds the entries. The agent reads "preceded in death" and blank-where-expected. |
| Match checking | dropped | The match tools key on a FamilySearch record ARK, which a text source does not carry. On the FamilySearch path the caller runs them after `extraction_append`. |
| Re-invocation and classification refinement | dropped | Lead, 2026-09-29: classification is the table's, so there is no refinement to delegate. `classification-refinement-informant.json` is deleted with it. A disagreement with a row is a row change. |
| Return contract, `summary_for_user` | dropped | Lead, 2026-09-29: the agent returns `extraction_append`'s code-written summary verbatim. `test_relay_carries_no_caller_facing_lines` is retired with it. |

**`record-extraction/SKILL.md` is deleted** (lead, 2026-09-29). Routing lives in
`extraction_append`'s description and this agent's description.

| Section | Goes to |
|---|---|
| Triage: FamilySearch record vs everything else | The two descriptions. |
| `<record-data>` fence on delegation | The spawner wraps inline `text`. The agent's data-boundary rule covers `sidecar_read` output too. |
| Log entry, router-side | Dropped: `extraction_append` writes it. |
| Per-record delegation and position announcements | Dropped: one spawn per batch, and the summary names each record. `multi-record-batch-announces-positions.json` is retargeted to the summary. |
| Calendar check (#2256, #2790) | A spawner flag. An unflagged date is recorded as written. |
| `image_filename` relay | The spawner passes `imageFilename` per source. |
| Suspect-transcription and Old Style flags | Per-source `flags`. |
| Match checks on the FamilySearch path | The caller, after `extraction_append`. |
| Present and continue | Dropped: the summary is relayed verbatim. |

**`references/`:** all three files go with the skill. `places-guidance.md`'s
byte-identical pin in `skill-guidance.test.ts` loses its `record-extraction`
entry. #2092's disposition for the family is unaffected.

## Found while walking

1. **Burial index vs. death certificate.** Fixed on #2979 (9c726c709).
2. **Classification refinement.** Decided (lead, 2026-09-29): dropped, see the walk.
3. **Match checks on the indexed path.** Fixed on #2979 (e2a20b090). They move
   again, to the caller, when the skill is deleted.
4. **Obituary classification row.** Decided (lead, 2026-09-29): the table rows are
   ours. The rows are in §11.7, and the table gains a field-level key.

## Sites

- `packages/engine/mcp-server/src/utils/record-extract.ts`: a document-mode
  options argument, the `computed`-keyed split, `statedRelation` roles, a
  `sibling` edge arm, the `obituary` type and rows, the field-level table key,
  the two layer overrides, and the summary writer (shared with §11.6).
- `packages/engine/mcp-server/src/tools/extraction-append.ts`: the `documents`
  batch input, all-or-nothing validation, log-entry writing, and the summary
  return.
- `docs/specs/schemas/ownership.json`: `extraction_append` as a `log` writer.
- `packages/engine/mcp-server/src/tools/sidecar-read.ts` and
  `docs/specs/sidecar-read-tool-spec.md`: a list of refs, and a `results/` ref
  accepted only when it holds a `StagedTranscription`, returning its
  `transcription` paged. §1's "results/ is not this tool's business" narrows to
  *search* results.
- `packages/engine/plugin/agents/record-structurer.md` (new, with model and
  effort in its frontmatter); `record-extractor.md` (deleted); `image-reader.md`
  (returns `resultsRef`).
- `packages/engine/plugin/skills/record-extraction/` (deleted), and every
  `@plugin:record-extractor` / `record-extraction` reference in other skills.
- `tests/packaging/agent-tool-names.test.ts`: the permission snapshot for the
  new agent. `prompt-sizes.json`. `skill-guidance.test.ts`.
- `eval/tests/unit/record-extraction/`: the text-path fixtures move to a suite
  that reaches the agent directly. `classification-refinement-informant.json` is
  deleted. `test_relay_carries_no_caller_facing_lines` is retired.
