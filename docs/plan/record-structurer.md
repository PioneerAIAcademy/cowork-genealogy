# Plan: the record-structurer agent (issue #2939)

**Status:** not started. Blocked on #2937 (PR #2979). The spec is written:
`docs/specs/record-structurer-agent-spec.md` and
`research-append-tool-spec.md` §11.7.

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
| Invocation contract table | agent §2 | Content arrives as `resultsRef` or inline. `imageFilename` and `documentForm` are added. |
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
| Step 2 — a differently-surnamed head is a FAN lead | agent §3 | A return-summary line. Code sees surnames, not leads. |
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
| `log_entry_id`; `research_log_append` if no entry | code; dropped | The router always logs first. |
| `extracted_for_question_ids` | code | From `questionIds`. |
| Step 4 — one call; evidence-type self-check | agent §3 | The self-check becomes "did I list every computed attribute". |
| Step 4 — retry on `ok: false` | agent §3 | |
| Step 4 — correcting via `update` | dropped | Document mode appends. A correction is a re-extraction (see open question 2). |
| Step 4 — cannot write `person_evidence`; identity goes in the summary | code; agent §3 | The section allowlist enforces the first half. |
| Negative evidence | code, agent §4 | Code builds the entries. The agent reads "preceded in death" and blank-where-expected. |
| Match checking | dropped | The match tools key on a FamilySearch record ARK, which a text source does not carry. On the FamilySearch path the router runs them (#2979, commit e2a20b090). |
| Re-invocation and classification refinement | **open question 2** | |
| Return contract, `summary_for_user` | agent §3 | Unchanged. |

**`record-extraction/SKILL.md`, moved by this card:**

| Section | Goes to |
|---|---|
| `<record-data>` fence on delegation | The router keeps it for inline text. The agent's data-boundary rule covers `sidecar_read` output too. |
| Calendar check (#2256, #2790) | A route to `convert-dates`, which owns the table, and the pre-1752 prose is deleted. |
| `image_filename` relay | The router passes `imageFilename` to the agent. |
| Suspect-transcription and Old Style flags | Kept as flags on the new delegation. |

**Unreached `references/` files (#2476):** `note-taking-standards.md` and
`source-classification-guide.md` are deleted. Their reading rules are agent §4
and their classification rules are code. `places-guidance.md` is pinned
byte-identical by `skill-guidance.test.ts`. Its row moves under #2092's
disposition for that family, and it is not deleted by this card.

## Found while walking

1. **Burial index vs. death certificate.** Fixed on #2979 (9c726c709): burial
   has its own unknown/indeterminate row, and a record carrying both a Death and
   a Burial fact is typed by its collection title.
2. **Classification refinement has no home once the agent goes.**
   `classification-refinement-informant.json` asks "primary or secondary?" of an
   existing assertion. Classification is now a table, so the choices are: (a)
   re-extract, which gives the same answer, (b) explain the table's row, or (c)
   treat a disagreement as a genealogist row fix. This is for the lead.
3. **Match checks on the indexed path.** Fixed on #2979 (e2a20b090): the
   router runs them after `extraction_append`.
4. **Obituary classification row.** `obituary` is a new `RecordType` here. With
   no row it takes the default and warns. The proposal is `family_not_present`
   / `secondary` for the biography, pending genealogist sign-off.

## Sites

- `packages/engine/mcp-server/src/utils/record-extract.ts`: a document-mode
  options argument, the `computed`-keyed split, `statedRelation` roles, a
  `sibling` edge arm, the `obituary` type, and the two layer overrides.
- `packages/engine/mcp-server/src/tools/extraction-append.ts`: the `document`,
  `transcriptionRef` and `imageFilename` inputs, plus the validator.
- `packages/engine/mcp-server/src/tools/sidecar-read.ts` and
  `docs/specs/sidecar-read-tool-spec.md`: accept a `results/` ref only when it
  holds a `StagedTranscription`, and return its `transcription` paged. §1's
  "results/ is not this tool's business" narrows to *search* results.
- `packages/engine/plugin/agents/record-structurer.md` (new);
  `record-extractor.md` (deleted); `image-reader.md` (returns `resultsRef`).
- `packages/engine/plugin/skills/record-extraction/SKILL.md`: the delegation,
  the calendar route, and the reference-file deletions.
- `tests/packaging/agent-tool-names.test.ts`: the permission snapshot for the
  new agent. `prompt-sizes.json`.
- `eval/tests/unit/record-extraction/`: fixtures retargeted.
