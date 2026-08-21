# Init Project Rubric

Grading dimensions for init-project unit tests. Evaluated by the LLM judge
alongside the base rubric (Correctness, Completeness, Tool Arguments).

> **DRAFT — pending genealogist review.** Expanded from the original
> single "Stub person quality" dimension to cover all five jobs the skill
> performs (define problem, survey tree, survey holdings, profile
> interview, write + validate files). Genealogist to confirm thresholds
> and wording before release. Not every dimension applies to every test —
> score `null` (N/A) when a test does not exercise it (e.g. place
> standardization on a test with no hand-entered place).

## Stub & tree fidelity

Does `tree.gedcomx.json` faithfully represent known information without
fabrication? Stub persons carry whatever facts are known (name, gender if
known, approximate dates/places); unknown fields are omitted, not guessed.
FamilySearch-derived facts are sourced to a tree source (`S1`) at
`quality: 1` (questionable), and local `I` person IDs are used throughout.

- **pass:** Subject and all known relatives have known fields populated and
  unknown fields omitted; FamilySearch-derived facts are sourced to `S1` at
  `quality: 1`; local `I` IDs used. The user-vs-tree discrepancy (if any) is
  flagged rather than silently resolved.
- **partial:** Tree is largely correct but misses one element — e.g. omits a
  stated relative, forgets the `quality: 1` source on some facts, or fails to
  flag a user-vs-tree discrepancy.
- **fail:** Fabricates names/dates/places not implied by the data, creates
  placeholder unknown-person stubs, or treats unverified tree data as
  authoritative.

## Project section seeding & schema validity

Is `research.json` initialized with the correct shape — `project` block
filled (id, objective, subject_person_ids, status, created/updated, title),
and every other section present as an empty array (or populated where the
skill is meant to populate it)? Does the written file conform to the
schema on inspection?

Grade on the **content the skill actually wrote** (the written files /
file diff), not on whether the chat summary re-displays every field. A
concise 3–6 word title like "Patrick Flynn's parents" or "Mary Sullivan's
origins" is exactly right — do NOT dock it as "sentence-like." Objective
length is not graded here: objectives are meant to be broad, so an 8-word
objective is fine. Only a genuinely restated full-sentence title (the whole
objective copied into the title field) is a weakness.

- **pass:** `project` block complete and sensible; all required sections
  present (empty arrays where nothing was gathered); the written
  `research.json` conforms to the schema on inspection (required fields,
  correct types, no extraneous fields) — init-project has no
  schema-validation tool in its `allowed-tools`, so this is graded by
  reading the file against the schema, not by expecting a
  `validate_research_schema` call.
- **partial:** Project initializes, but one metadata field is genuinely weak
  or missing (e.g. the title is the full objective sentence verbatim, or
  `updated` is missing).
- **fail:** A required section is absent or malformed, the objective is
  missing/empty, or the file fails schema validation on init-written content.

## Researcher-profile interview & normalization

When the user supplies experience level and access, are they mapped
to the correct `experience_level`, normalized to the canonical subscription
enum, and stored with the verbatim `narration_guidance` for that level? When
no answers are available (single-turn), is the documented default used? The
research objective shares this same opening-turn, non-blocking shape (issue
#1510): when unanswered, does the skill ask it alongside the profile
questions, proceed in the same pass, and store the generic default rather
than a hallucinated specific direction?

- **pass:** `experience_level` correct; `subscriptions` normalized to the
  canonical enum (case-folded, aliases mapped, deduped, `["none"]` when none);
  `narration_guidance` is the verbatim table text for the level. Single-turn
  with no answers → `intermediate` / `["none"]` default, noted as editable.
  Objective defaulting: when no objective is stated, the agent asks in the
  opening turn, does not block, and writes the stated generic default —
  never a hallucinated specific direction — in the same single pass as the
  profile defaults.
- **partial:** Mapping correct but normalization imperfect (an un-mapped alias,
  a missed dedupe) or `narration_guidance` paraphrased rather than verbatim.
  Objective asked and defaulted correctly, but the summary doesn't clearly
  state it was defaulted.
- **fail:** Wrong experience level, subscriptions left as raw user text,
  `narration_guidance` invented rather than drawn from the table, the
  objective is invented/hallucinated from person data instead of using the
  generic default, or any of the three questions is silently skipped
  (asked-and-then-blocked, or defaulted without being asked first).

## Place standardization

This dimension grades where each `standard_place` in the written tree
came from. Two paths, graded differently. **Scope: places only.** The sibling
sidecar `standard_date` obeys the same carry-through rule but is not graded here.
It falls to base Correctness — sharpened by an explicit judge_context bullet on
the two tests built to turn on it (`ut_init_project_001`, `ut_init_project_008`)
and unremarked on the rest. Widening this dimension to cover both sidecars, and
so grading dates on every test, is a rubric change the genealogist should make
deliberately rather than inherit as a side effect of a wording fix.

**Tool-supplied places.** When a `person_read` fact arrives carrying a
`standard_place`, that value is **kept verbatim**. NOT calling
`place_search` on it is the correct behavior and must never be penalized
as a "missed opportunity," even if the place is only country-level (e.g.
"Ireland"). Init-project does not refine or enrich tree-supplied places.
"Kept as-is" means the value the tool returned, not a string the skill
re-derived from the fact's free-text `place` — the fixtures return
standardized names that differ from `place` (FamilySearch drops
"County"), so the two are distinguishable in the written tree.

**Hand-entered places.** A place drawn from the user's objective text is
resolved with `place_search` and its `standard_place` populated from the
result.

Score this dimension **N/A (null)** only when the test involves no places
at all. A test whose places all came from `person_read` is still scored:
there is something to check — that each returned `standard_place`
survived into the tree unchanged, and that none was invented for a fact
the tool left without one.

- **pass:** Every hand-entered place is standardized via `place_search`
  and its `standard_place` is populated from the result. Every
  tool-supplied `standard_place` appears in the tree exactly as returned.
- **partial:** A hand-entered place is standardized, but `standard_place`
  is hand-written without the `place_search` call, or only some
  hand-entered places are resolved.
- **fail:** A hand-entered place that resolves is left with no/empty
  `standard_place`, a standardized string is fabricated without the tool
  (including a `standard_place` copied from the fact's free-text `place`),
  or a tool-supplied `standard_place` is altered or dropped.
- **N/A:** The test involves no places at all.

## Known-holdings capture

When the user volunteers what they already hold (documents, prior research,
GEDCOMs, oral knowledge), is each recorded as a conforming `known_holdings`
entry — sensible `holding_type`, `confidence`, `promoted: false`, a `kh_` id,
and `relates_to_person_ids` linked to a real tree person where applicable —
without fabricating holdings? When none are volunteered, is the survey
skipped cleanly (`known_holdings: []`)?

- **pass:** Every volunteered item is captured with a sensible `holding_type`
  and `confidence`, `promoted: false`, and a person link where the item clearly
  concerns a tree person; nothing is fabricated; holdings are not over-promoted
  into `sources`/`assertions`. No holdings volunteered → `known_holdings: []`.
- **partial:** Holdings captured but with a questionable `holding_type`/
  `confidence`, a missing person link that was clearly implied, or one
  volunteered item dropped.
- **fail:** Volunteered holdings dropped entirely, holdings fabricated, or
  items written as full sources/assertions instead of lightweight survey notes.
- **N/A:** Test does not involve known holdings.
