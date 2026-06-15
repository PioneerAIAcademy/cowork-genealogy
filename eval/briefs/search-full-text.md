# Deep-Dive Brief — `search-full-text`

> Per-skill map for the deep-dive. Generic process: [`eval/JUNIOR-WALKTHROUGH.md`](../JUNIOR-WALKTHROUGH.md).

**Effort profile:** Both, with fixture mechanics dominating — every positive test drives `fulltext_search`/`source_attachments` against canned responses. The distinctive genealogical surface is the Lucene query syntax and the FAN (Family/Associates/Neighbors) lens; both need careful fixtures to exercise.
**Files:** SKILL.md (380 lines) · references ×6 (556 lines) · tests ×5 · rubric ✓ (27 lines).

## What this skill does
GPS Step 1 full-text execution against FamilySearch's AI-transcribed document **images** via `fulltext_search`, using Lucene-style operators (`+` required, `-` excluded, `"…"` phrase, `?`/`*` wildcards). It uniquely surfaces **witnesses, neighbors, heirs, sureties, appraisers** — the FAN mentions that structured/indexed search misses. It logs every search including nil results, writes result sidecars for positives, handles OCR/transcription quirks (name variants), checks attachment status via `source_attachments`, and passes promising records to `record-extraction`. It does not run structured indexed search, search commercial sites, plan, or extract. Tools: `fulltext_search`, `source_attachments`.

## Where everything lives
- `plugin/skills/search-full-text/SKILL.md` (380 lines)
- `references/` — `online-search-literacy.md` (62), `query-syntax.md` (90), `research-log-protocol.md` (117), `search-strategies.md` (172), `transcription-quirks.md` (101), `validation-protocol.md` (14)
- `eval/tests/unit/search-full-text/` — `search-for-flynn-witnesses.json`, `negative-result-with-detail.json`, `negative-record-extraction.json`, `write-result-sidecar.json`, `attachment-triage-witnesses.json`, `rubric.md`
- Scenarios used: `mid-research-flynn`, `flynn-record-matching`

## Current tests (5)
| id | covers | type | tools/fixtures |
|----|--------|------|----------------|
| ut_…_001 | FAN search: Flynn family as witnesses in Schuylkill County records | positive | fulltext_search / fulltext-search-flynn-witnesses |
| ut_…_002 | Negative result logged with enough detail to support exhaustiveness | positive | fulltext_search / fulltext-search-flynn-probate-empty |
| ut_…_003 | "I have a deed, extract the assertions" → routes to `record-extraction` | negative | — |
| ut_…_010 | Write result sidecar for a positive full-text search | positive | fulltext_search / flynn-witnesses + flynn-flinn-variant |
| ut_…_011 | Check attachment status for full-text witness results | positive | source_attachments / flynn-witnesses + record-attachments-flynn-witnesses |

> Coverage hits the FAN/witness path and the sidecar/nil/attachment mechanics, but the skill's *distinctive surface* — the Lucene operators — is never directly graded, and three of four named neighbors lack a negative.

## Gaps — new tests to add
**Positive (the distinctive surface, untested):**
- **Lucene operator construction** — a prompt that should produce a required-term + phrase + wildcard query (e.g. `+Flynn "Schuylkill County" Fl?nn*`), checking the **Query construction** rubric dimension directly. No test today verifies a wildcard/phrase/required-term query is *built correctly* — only that FAN persons are targeted.
- **Transcription-quirk variants** — an OCR-mangled surname (per `transcription-quirks.md`) where the query must include the misread form; exercises the variant-handling half of Query construction.
- **Latin American notarial / pre-1850 thin-index case** — named in the description as a primary use case; full-text shines where indexes are thin. Untested. Needs a notarial-record fixture.

**Negative (boundaries from the description):**
- → `record-extraction`: "Here's a deed — extract the assertions." (already ut_003)
- → `search-records`: "Search the 1880 census index for Flynn by name and county." — the **subtle indexed-vs-fulltext boundary**; route to structured search when the query is by person attributes, not free-text. Untested and worth a careful negative.
- → `search-external-sites`: "Search Newspapers.com / Ancestry for the Flynns." (commercial sites — untested.)
- → `research-plan`: "What full-text searches should I run next?" (planning, not execution — untested.)

## ⚠️ Known issues
- **The Lucene query syntax — this skill's whole reason to exist — has no dedicated test.** `query-syntax.md` (90 lines) documents the operators, but no fixture/test verifies a constructed query uses them. A wrong-operator regression would pass today.
- **Description-named use cases are untested**: Latin American notarial and pre-1850 thin-index searches. All five fixtures are Flynn / Schuylkill County, US-flavored.

## Fixture work — the dominant cost
Reusable today: `fulltext-search-flynn-witnesses`, `fulltext-search-flynn-probate-empty`, `fulltext-search-flynn-flinn-variant`, `record-attachments-flynn-witnesses`. **Net-new needed:** a `fulltext-search-*` fixture whose results justify a wildcard/phrase/required-term query (for the operator test), an OCR-variant fixture (for the transcription-quirk test), and a notarial-record fixture (for the Latin American / thin-index case). The indexed-vs-fulltext negative needs no fixture (route away before any tool call).

## Definition of done
Add the operator-construction fixture + its positive test (the highest-value gap) → add the transcription-quirk and notarial positives → add the search-records (indexed-vs-fulltext), search-external-sites, and research-plan negatives → polish Query-construction rubric wording if needed → full harness pass + CRUD review + PR. (Scope to what fixtures allow — log anything deferred.)
