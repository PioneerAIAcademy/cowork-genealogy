# Deep-Dive Brief — `record-extraction`

> Per-skill map for the deep-dive. Generic process: [`eval/JUNIOR-WALKTHROUGH.md`](../JUNIOR-WALKTHROUGH.md).

**Effort profile:** Both, leaning heavily on test mechanics — the largest SKILL.md in the batch (619 lines), seven allowed-tools, and the dominant cost is fixturing record-type variety. Genealogical input is the atomic-assertion decomposition, informant identification, and direct/indirect/negative evidence calls.
**Files:** SKILL.md (619 lines) · references ×6 (603 lines) · tests ×8 · rubric ✓ (27 lines).

## What this skill does
GPS Step 2 (citation) + Step 3 (analysis) — the extraction phase. It reads a record (from an MCP tool response, a captured PDF, or an image transcription via `image_read`), breaks it into **discrete atomic testable assertions** keyed to `record_id` + `record_role`, sets `record_persona_id` on assertions, creates source entries with **working citations** (refined later by `citation`), and writes **best-effort evidence classifications** (refined later by `assertion-classification`). It handles **negative evidence** (a person ABSENT from a record where expected, `record_role: "absent"`). After extraction it can check tree attachment (`record_person_matches`) and surface collateral records (`record_record_matches`), validating with `validate_research_schema`. It does not search, refine classifications, or format final citations. Tools: `record_read`, `image_read`, `volume_search`, `place_search`, `validate_research_schema`, `record_person_matches`, `record_record_matches`.

## Where everything lives
- `plugin/skills/record-extraction/SKILL.md` (619 lines)
- `references/` — `information-classification-at-extraction.md` (139), `note-taking-standards.md` (151), `places-guidance.md` (81), `research-log-protocol.md` (117), `source-classification-guide.md` (95), `validation-protocol.md` (20)
- `eval/tests/unit/record-extraction/` — `census-1850-single-household.json`, `negative-evidence-absent-role.json`, `census-1850-multi-person-household.json`, `negative-search-vs-extract.json`, `record-read-via-ark.json`, `sets-record-persona-id.json`, `record-person-matches.json`, `record-record-matches.json`, `rubric.md`
- Scenarios used: `empty-project-just-created`, `mid-research-flynn` (ut_001 has the record inline in the message — no scenario)

## Current tests (8)
| id | covers | type | tools/fixtures |
|----|--------|------|----------------|
| ut_…_001 | Extract from 1850 census household; indirect evidence; inferred relationship | positive | none (record inline) |
| ut_…_002 | Negative evidence: Patrick absent from the 1870 census | positive | none |
| ut_…_003 | Extract from a multi-person 1850 census household | positive | none |
| ut_…_004 | "Find the 1860 census record" → routes to `search-records` | negative | — |
| ut_…_006 | Extract by fetching a record via ARK using `record_read` | positive | record_read / record-read-68Q9-K34P |
| ut_…_010 | Set `record_persona_id` on assertions from a `record_search` result | positive | none |
| ut_…_011 | Check tree attachment after extraction via `record_person_matches` | positive | record-person-matches-flynn + validate-research-schema |
| ut_…_012 | Surface collateral records via `record_record_matches` | positive | record-record-matches-flynn + validate-research-schema |

> Coverage is deep on **census** (single, multi-person, ARK, persona-id, negative-evidence) and on the post-extraction match tools — but it's *all census*, and three of the seven allowed-tools are unfixtured or exempt.

## Gaps — new tests to add
**Positive (non-census record types — the whole untested axis):**
- **Death certificate** — informant proximity is the teaching point (the certificate names an informant whose proximity to the birth facts differs from their proximity to the death fact). Hits the **Informant identification** rubric dimension hard. Needs a `record_read` fixture.
- **Probate / will** — compound legacy clauses that must decompose into atomic assertions per heir; exercises **Assertion atomicity** and is a natural `volume_search` test (`volume_search` is in allowed-tools, **no fixture today**).
- **Church / baptism register** — Latin/abbreviated entries, godparents as FAN; tests atomicity + place handling (`place_search`).
- **Marriage record** — direct vs indirect on the couple's stated ages/origins; **Evidence type accuracy** dimension.

**Negative (boundaries from the description):**
- → `search-records`: "Find the 1860 census record." (already ut_004)
- → `assertion-classification`: "Re-classify these assertions' evidence types now that I have more records." — the **extract-vs-refine** near-miss; record-extraction writes *best-effort* classifications, refinement is the neighbor's job. Untested.
- → `citation`: "Format the final Evidence Explained citation for this source." — extraction writes a *working* citation only; final formatting routes away. Untested.

## ⚠️ Known issues
- **`image_read` cannot be unit-tested** — it's in `allowed-tools` but exempt from fixturing (the mock can't emit image content blocks, per eval CLAUDE.md §15 / `unit-test-spec.md` §15). So the image-transcription extraction path — one of the three named input modes — has no automated coverage by design. Note this honestly; don't try to fixture it.
- **`volume_search` is in `allowed-tools` but has no fixture** — flagged warn-only by `check_tool_coverage.py`. The probate/will positive above is the natural place to add one.
- **All extraction tests are census.** Non-census record types (death, probate, church, marriage) — where informant proximity, compound-clause atomicity, and direct/indirect calls actually get hard — are entirely unexercised.

## Fixture work — the dominant cost
Reusable today: `record-read-68Q9-K34P`, `record-person-matches-flynn`, `record-record-matches-flynn`, `validate-research-schema`. Several positives (ut_001/002/003/010) run fixture-free with the record inline in the message — cheap to copy for new inline cases. **Net-new needed:** a `record_read` (or inline) fixture per non-census type — death certificate, probate/will, church/baptism, marriage — plus a `volume_search` fixture for the probate test. The extract-vs-refine and citation negatives need no fixture (route away before any tool call). `image_read` is out of scope — exempt.

## Definition of done
Add the death-certificate and probate/will positives (the latter carrying the net-new `volume_search` fixture) → add church/baptism + marriage positives → add the `assertion-classification` and `citation` negatives → confirm the rubric's atomicity/informant/evidence-type dimensions exercise on the new record types → full harness pass + CRUD review + PR. (Leave `image_read` uncovered by design; log it. Scope to what fixtures allow.)
