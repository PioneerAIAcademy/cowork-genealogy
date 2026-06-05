# ID Vocabulary Standardization — Plan & Progress

Living checklist for the identifier-format standardization agreed with the
stakeholder. Update as steps complete. (#1 — the `place_search` placeId chain —
is explicitly **out of scope** here; separate task.)

> **STATUS (complete pending live verification):** Phases 0–8 implemented;
> `npm run build` clean and full suite **766/766 green**. Phase 9 automated
> checks done. **Not yet run:** the three live smoke tests (require FamilySearch
> auth + network) — most importantly the `match_two_examples` round-trip, which
> confirms the FS API still matches when `toGedcomX` re-expands the ARK to a
> `www` resolver URL. Run before merging.

## The standard (the rule)

| Entity | Form | Example |
|--------|------|---------|
| Tree person (`4:1:`) | **bare** | `KNDX-MKG` |
| Digitized image | **`<digits>_<digits>`** (9_5) | `004884748_02613` |
| Record persona (`1:1:`) | **ARK** | `ark:/61903/1:1:QPRC-WPBZ` |
| Record source/image entry (`1:2:`) | **ARK** | `ark:/61903/1:2:HSJG-CLNF` |
| Document image / fulltext record (`3:1:` or `3:2:`) | **ARK** | `ark:/61903/3:1:3Q9M-CSNL-S98H-M` |

**Not governed by this rule (unchanged):** `collectionId` (bare numeric string
`"1743384"`), `placeId` (bare numeric string `"1927089"`), `imageGroupNumber`
(bare `007621224` or split natural-group name). These were never `ark:/61903/`
entities.

**Navigational web-page links stay URLs** (they are "open in browser" links, not
identifiers consumed by any tool): `familysearchUrl`, `wikipediaUrl`,
`collectionUrl`. Fields that are genuinely an ARK but were rendered as URLs
become ARK form (`record_search.recordUrl` → `recordArk`).

### Round-trip rule (the one subtlety)
`SimplifiedGedcomX.persons[].ark` is sent back to the FamilySearch
`matchTwoExamples` API by `match_two_examples` (via `toGedcomX`). So:
- `toSimplified`: persistent ARK **URL → ARK form** (`ark:/61903/...`) — LLM-facing.
- `toGedcomX`: ARK form **→ full URL** (`https://www.familysearch.org/ark:/...`) — API-facing, preserves today's wire behavior.

ARKs are resolver-agnostic (the `ark:/61903/X` portion is the identity), so the
host on re-expansion is immaterial to the API. **Risk:** unit tests mock the API;
verify the live round-trip with `dev/try-match-two-examples.ts` after Phase 5.

---

## Phase 0 — shared helper
- [ ] `mcp-server/src/utils/ark.ts` (new): `toArk(s)` (any URL/bare-prefixed/ARK → `ark:/61903/...`, else passthrough) and `arkToUrl(ark)` (`ark:/...` → `https://www.familysearch.org/ark:/...`, else passthrough).
- [ ] `mcp-server/tests/utils/ark.test.ts` (new).

## Phase 1 — converter keystone (`ark` field URL↔ARK)
- [ ] `src/utils/gedcomx-convert.ts`: `toSimplified` line ~150 `out.ark = toArk(persistent[0])`; `toGedcomX` line ~426 `[arkToUrl(person.ark)]`.
- [ ] `tests/utils/gedcomx-convert.test.ts`: ark expectations (5 URL literals → ARK); add round-trip URL→ARK→URL assertion.
- [ ] `docs/specs/simplified-gedcomx-spec.md`: §4.6 + field table (lines ~55, 85, 187, 194, 200, 297) "ARK URL" → "ARK".
- [ ] `docs/specs/gedcomx-convert-spec.md`: Rule 15 (lines ~143, 561–592, 637–643, 889–891) — describe strip-on-simplify / expand-on-expand; examples.

## Phase 2 — record_search (1:1: persona + 1:2: source → ARK)
- [ ] `src/tools/record-search.ts`: `recordId` = `toArk(arkUrl)` (fallback `ark:/61903/1:1:${entry.id}`); **drop** `arkUrl`; `recordUrl` → **`recordArk`** = `toArk(...)`.
- [ ] `src/types/record-search.ts`: `RecordSearchResult` — `recordId` doc, remove `arkUrl`, rename `recordUrl`→`recordArk`.
- [ ] `tests/tools/record-search.test.ts`: `recordId` now ARK; `arkUrl`→gone; `recordUrl`→`recordArk` (8 URL literals — note: input mock FS response keeps URL arks; only **output** assertions change).
- [ ] `docs/specs/record-search-tool-spec-v2.md`: output table + example (`recordId`, `recordArk`, drop `arkUrl`); mapping notes.
- [ ] `docs/specs/record-search-tool-spec.md` (old v1): align or mark superseded.

## Phase 3 — record_read
- [ ] `src/tools/record-read.ts`: schema/description — canonical input is ARK (still accept bare; `extractEntityId` already strips). Output `ark` flows via converter (Phase 1).
- [ ] `docs/specs/record-read-tool-spec.md`: input form = ARK canonical; output ark = ARK (1 URL literal).
- [ ] `tests/tools/record-read.test.ts`: output ark assertions if any.

## Phase 4 — match-by-id (4 tools)
- [ ] `src/tools/match-by-id.ts`: `matches[].ark` = `toArk(entry.id)` (was URL). `queryArk` already ARK ✓. `pid` kept (bare convenience). `summary` gedcomx arks flow via converter.
- [ ] `tests/tools/match-by-id.test.ts`: `ark` assertions URL→ARK (9 literals; input mock keeps URL).
- [ ] `docs/specs/match-by-id-tools-spec.md`: output `ark` = ARK; example.

## Phase 5 — match_two_examples
- [ ] `src/tools/match-two-examples.ts`: `parseArkFromTitle` returns ARK (drop the `https://familysearch.org/` prepend); `candidateArk` = `toArk(entry.id)`. Round-trip handled by Phase 1 `toGedcomX` re-expansion.
- [ ] `src/types/match-two-examples.ts`: `queryArk`/`candidateArk` doc = ARK.
- [ ] `tests/tools/match-two-examples.test.ts`: `queryArk`/`candidateArk` URL→ARK (5 literals).
- [ ] `docs/specs/match-two-examples-tool-spec.md`: queryArk/candidateArk = ARK (9 literals); update parsing rule prose.
- [ ] `dev/try-match-two-examples.ts`: **live round-trip smoke test** (4 literals) — verifies API still matches with re-expanded URL.

## Phase 6 — source_attachments (accept ARK, build URL internally)
- [ ] `src/tools/source-attachments.ts`: accept `uris[]` as ARK (1:1:/3:1:/3:2:) or URL; `arkToUrl` each for the API POST; key output map by the **original input string**.
- [ ] `tests/tools/source-attachments.test.ts`: ARK inputs.
- [ ] `docs/specs/source-attachments-tool-spec.md`: input = ARK (10 URL literals); note URL still tolerated.
- [ ] `dev/try-source-attachments.ts`: ARK args (3 literals).

## Phase 7 — fulltext_search (3:1:/3:2: record → ARK)
- [ ] `src/tools/fulltext-search.ts`: surface the record identifier as ARK via `toArk` (handles whatever upstream shape). Keep `sourceUrl` as a navigational link.
- [ ] `src/types/fulltext-search.ts`: field doc.
- [ ] `docs/specs/fulltext-search-tool-spec.md`: output schema (also fix existing impl/spec drift while here); ARK form.

## Phase 8 — downstream consumers (skills + research schema docs)
- [ ] `plugin/skills/person-evidence/SKILL.md`: `record_id` matched against `recordArk`/`recordId` (now ARK); `record_persona_id` wording.
- [ ] `plugin/skills/record-extraction/SKILL.md`: ARK references (1 URL literal).
- [ ] `plugin/skills/search-records/SKILL.md`: `arkUrl`→`recordId`/`recordArk` references.
- [ ] `docs/specs/research-schema-spec.md`: `record_id` example form → ARK (3 URL literals). **Validator unaffected** (string type, no format check) — confirm `src/validation/validator.ts` doesn't regex these.

## Phase 9 — verify
- [ ] `npm run build` clean.
- [ ] `npm test` green (full suite).
- [ ] `spec-review` (or manual) on touched tools vs specs.
- [ ] Live smoke: `try-match-two-examples.ts`, `try-source-attachments.ts`, `try-fulltext-search.ts`.
- [ ] Remove this file's "in progress" markers / fold the standard into a permanent doc if desired.

## Notes / judgment calls (flagged for review)
- `recordUrl` → `recordArk` (rename + ARK). If you'd rather keep it a clickable URL, say so.
- Re-expansion host on `toGedcomX` = `https://www.familysearch.org/` (www form).
- Input mock FS responses in tests keep URL-form arks (they model upstream payloads); only tool *output* assertions flip to ARK.
