# locality-guide — deep dive findings (2026-08-25)

Deep dive #1664, per `docs/skill-deep-dive-guide.md`. Starts from no known
failure. Transcripts read against the prohibition list
(`locality-guide-prohibition-list.md`) before scores.

**Instruments.** Analysis run: `eval/runlogs/unit/locality-guide/v1_2026-08-20_14-20-01.json`
(26 tests). `make judge-report SKILL=locality-guide`: **2 of 6 dimensions
non-discriminating** — `Jurisdiction accuracy` and `Research strategy`, both
always 3. Per #1664 these are **not** touched here; if anything, they go to
#1668. A confirmation paid run after the #1664 edits landed as
`v1_2026-08-25_01-57-51.json` and is cited below as corroboration only.

The measure of a deep dive is **validator requests, not findings**. Four are
proposed (VR1–VR4); they are drafted for a separate `developer` issue, not
implemented here.

---

## Confirmed defects

### D1 — a full guide grounded in memory, not tool output · `ut_locality_guide_023`
- **Did:** every tool fixture 023 references is generic (`wiki-search-any`, `wiki-read-any`, `wiki-place-page-any`; no `collections_search`/`volume_search` fixture); the run's own narration says *"Returned only generic Research Guidance fixture content — no Vermont-specific hits."* Yet the guide asserts specifics — *"Vermont Vital Records, 1720–1908 … indexed + images"*, probate districts *"beginning in 1778"*, denominational detail — attributing them to the Vermont Genealogy FamilySearch Wiki page. It called **neither** `collections_search` **nor** `volume_search`. In the analysis run 023 **passed**.
- **Should:** SKILL.md — *"Ground every claim in tool output … never invent a collection, count, or volume … If a FamilySearch Wiki page returns only generic content, do not cite specifics it does not contain."* Step 4 — a digitization level must come from `volume_search`'s `recordSearchablePercent`.
- **Gap:** **lane 2 (grading), not lane 4.** The grounding rule is already in the body and was ignored, so more prose changes nothing. The test's `judge_context` graded only the tool-call migration path ("MUST call wiki_place_page … regardless of how plausible the guide reads"), so a memory-sourced guide passed. **Fix made (B1):** added a `judge_context` grounding bullet to `ut_locality_guide_023.json` requiring factual specifics to trace to this run's tool output. **Corroboration:** on the post-edit run `v1_2026-08-25_01-57-51`, 023 moved pass → **partial** (Correctness=2, Record availability=2; *"unsupported claims about specific record types and repositories that go beyond [the wiki response]"*). The mechanizable residue converts to VR3. (023's partial is **genuine**, not a D8 truncation artifact: it called no `collections_search`/`volume_search`, so there is no dropped tool result behind it.)

### D4 — digitization level assigned with no `volume_search` · `ut_locality_guide_023`
- **Did:** 023 labels *"Vermont Vital Records 1720–1908 — indexed + images"* having never called `volume_search` (or `collections_search`).
- **Should:** Step 4 derives the digitization level from `volume_search`'s `recordSearchablePercent`.
- **Gap:** lane 2 + converts to **VR3** (a closed digitization-level label in the output requires a `volume_search` call in the run).

### D5 — registration/records-begin dates stated without a wiki URL (recurring)
- **Did:** `002` *"No Civil Registration Until 1864 … Non-Catholic … from 1845"*; `018` *"Philadelphia County … from 1860; Allegheny County from 1870"*; `022` *"statewide death registration began 1852 at county level"*; `026` *"mandated town clerks … from 1639 … statewide … in 1841"* — none with a nearby `/wiki/` URL.
- **Should:** R23 — attach the returned URL, or say the wiki does not cover it, rather than asserting from memory. (R20 is **satisfied** in every case — each names its level, so there is *no* R20 defect.)
- **Gap:** **lane 2 rubric limitation.** The rule is in the body and ignored; grading does not catch missing-URL date claims. Hard to mechanise cleanly (free-prose citation completeness). Flag for a citation-completeness rubric/`judge_context` discussion — **not** the two flat dimensions, **not** #1668.

---

## Validator coverage gaps / candidates

### D2 — the persist validator is tag-gated · `ut_locality_guide_007`
- **Did:** `test_localities_persisted_with_full_page_coverage` skips unless the test is tagged `localities-persist`. Only `ut_locality_guide_024` carries the tag, but `ut_locality_guide_007` (California) also persists a `localities` entry and is untagged, so its entry is never checked.
- **Should:** the four-section / structure guarantee should hold for every persisted entry, not only tagged ones.
- **Gap:** validator scope → **VR1** (fire on presence of a persisted entry, not on a tag).

### D3 — structural persistence rules 17–19 (clean this run, still class-closing)
- **Did:** both persisters (024, 007) were structurally clean in the analysis run (no stray keys; all four `pages_read` sections).
- **Should / Gap:** per #1664 and the guide, these convert regardless — a converged run does not prove the class cannot break. → **VR1** (fields/pages) and **VR2** (id-traces).

---

## Rubric limitations
- **D5** (above) — missing-URL registration dates are not caught by grading; the rule is in the body already. Route to a citation-completeness rubric/`judge_context` discussion. Do **not** edit `Jurisdiction accuracy` or `Research strategy` (the two flat dimensions) and do **not** touch #1668.

---

## Non-defects (verified, not reported as findings)
- **Record counts "fabricated" (011/012/016/017)** — the numbers are **in the fixtures** (`987654` appears in *both* `collections-search-massachusetts.json` and `collections-search-louisiana.json`; Chicago's round counts are in `collections-search-chicago.json`). The skill faithfully echoed fixture data → **fixture-realism**, not skill fabrication. A fixture-cleanup note only.
- **"Generic wiki page cited for specifics" (004/010/017)** — the specifics are in the `wiki-search-*` fixtures those tests reference (e.g. `Mississippi_Territory_Genealogy` is in `wiki-search-mississippi-territory.json`), so the facts are grounded. The residual (citing the generic `wiki_read` URL rather than the `wiki_search` result's own `source_url`) is a judgement-level provenance nuance, not a reported defect. (`021`'s flagged *collection* is a separate matter — grounded in `collections-search-alabama.json`; the judge's fabrication flag on it is the D8 truncation artifact, below.)
- **`005` collection-ID mislabel** — one collection ID stated then self-corrected mid-sentence; both IDs are real fixture values. Judgement slip, not a clean defect.

---

## Eval coverage gap (test corpus, not the skill)
- **D7 — `volume_search` under-exercised.** `volume_search` is a required Step-3 call, but most survey tests provide **no** `volume-search` fixture (`002, 004, 009, 014, 015, 017, 019, 020, 023` all lack one; several also lack `collections-search`). A skill that silently drops a required call passes. Enabling a "must call `volume_search`" check today would fail these tests for lack of a fixture → **VR4** is coupled to adding the missing fixtures first, not a drop-in.

---

## Cross-cutting grading-infrastructure defect (not a locality-guide skill defect)

### D8 — the LLM judge grades grounding against a truncated `collections_search` summary
- **Did:** on the post-edit run `v1_2026-08-25_01-57-51` the judge marked three grounded claims as fabricated — `ut_locality_guide_021`'s `Alabama, Church Records, 1803–1950` (Collection 1986396), `ut_locality_guide_007`'s `California, Mission Records, 1769–1850` (Collection 1804372), and 007's "88% indexed / full-text searchable" figure. All three are real fixture data: 1986396 is the **4th of 4** results in `collections-search-alabama.json`; 1804372 is the **4th of 4** in `collections-search-california.json`; the 88% is the first volume in `volume-search-california.json`.
- **Cause:** each mis-flagged collection is the **last (4th) item of a 4-item response**. The LLM judge reads a truncated tool-response summary (the persisted `response_summary` samples the leading entries), so the 4th `collections_search` result is invisible to it and a grounded citation of it reads as fabricated.
- **Gap:** **cross-cutting grading-infrastructure defect** — this is the LLM judge's view of the tool response, not a locality-guide behaviour, and it affects every skill's grounding grade. It drove the 021 and 007 partials on this run. Filed as its own `developer`/eval issue, **#1902**. An earlier draft of this document mistakenly cited 021 and 007 as corroboration for VR2/VR3 — corrected in those entries below.
- **Note:** a deterministic **validator** does not share this blind spot: `run_validators` receives the in-memory `result.tool_calls` with the full `response` retained (per `eval/CLAUDE.md`), so VR2 checks id-traceability against the *complete* response and would correctly find 021's collection grounded, not fabricated.

---

## Confirmed vs potential
- **Confirmed defects:** D1 (023 grounded-in-memory; confirmed pass→partial after the B1 edit), D4 (digitization label without `volume_search`), D5 (missing-URL registration dates across 002/018/022/026), D2 (validator coverage hole).
- **Confirmed grading-infrastructure defect (cross-cutting, not a locality-guide skill defect):** D8 (truncated `collections_search` summary → false fabrication) — it drove the 021 and 007 partials; filed as #1902.
- **Confirmed non-defects:** fixture-sourced counts; grounded wiki specifics; the 005 self-corrected mislabel; 021's Alabama collection and 007's California collection + 88% figure (all grounded — the judge flags are D8 artifacts).
- **Potential / class-closing (no current violation):** D3 (structural rules 17–19 clean this run but validator-worthy), D7 (coverage gap needing fixtures first).

---

## Proposed validator requests (for a separate `developer` issue — not implemented here)
`locality-guide` has **one** validator today (`eval/harness/validators/test_locality_guide.py`) vs 8 for research-plan / 13 for init-project.

- **VR1 — validate a persisted localities entry on presence, not on a tag.** On any run whose after-state `localities[]` is non-empty, the newest entry must have `source == "locality-guide"`, `pages_read` covering all four wiki sections, every `jurisdictions[]` entry exactly `{name, date_range}`, and every `collections[]` entry exactly `{id, title, date_range}`. *Violation:* `ut_locality_guide_007` persists but is untagged, so the current tag-gated validator skips it. (Closes D2 + D3.)
- **VR2 — persisted collection ids trace to a same-run tool response.** Every `id` in a persisted entry's `collections[]` must appear in a `collections_search`/`volume_search` response from the same run. *No current skill violation:* both runs persisted only grounded ids. (The judge's "fabricated" flag on 021's `Alabama, Church Records` 1986396 is a **false positive from the D8 truncated-summary bug**, not a real violation — the id is the 4th result in `collections-search-alabama.json`; a validator reads the full response and would find it grounded.) VR2 is **class-closing**: a genuinely hallucinated id in a persisted entry would ship silently today, and unlike the judge a validator sees the complete tool response.
- **VR3 — a digitization-level label requires a `volume_search` call.** If the output uses a closed digitization-level label (`indexed + images`, `full-text searchable, not name-indexed`, `browse-only images`, `microfilm or physical only`), the run must have called `volume_search`. *Evidence:* `ut_locality_guide_023` (D1/D4) — it assigned `indexed + images` having called **no** `volume_search` at all. (`ut_locality_guide_007` is **not** a VR3 case: it *did* call `volume_search` and its "88% indexed" is grounded in `volume-search-california.json`; 007's partial is the D8 truncation artifact, not an unbacked label.)
- **VR4 — applicable survey runs must call both `collections_search` and `volume_search` (fixtures first).** A non-declining survey run must call both required Step-3 tools. Most survey tests currently lack these fixtures (D7), so the missing fixtures must be added first; until then VR4 is a coverage improvement, not a drop-in.

---

## Also landed with this dive (pre-known #1664 work, kept separate from the above)
From the #1664 issue body and merged #1700 / #1862 — reference/prose edits, not
findings from this dive:
- `references/locality-broad-context.md` — land bounties (A1).
- `references/locality-survey-methodology.md` — town & county histories; city directories + state census (A2).
- `references/output-format.md` — jurisdictional level held-at; probate petitions + testate/intestate; land records federal/state + bounties/acts (A3).
- `SKILL.md` — stale caller `research-plan` → the orchestrator (A4); 12 prose "wiki" → "FamilySearch Wiki", tools unchanged (A5).
