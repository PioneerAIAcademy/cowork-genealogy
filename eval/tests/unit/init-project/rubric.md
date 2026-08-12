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
skill is meant to populate it)? Does the project validate clean?

Grade on the **content the skill actually wrote** (the written files /
file diff), not on whether the chat summary re-displays every field. A
concise 3–6 word title like "Patrick Flynn's parents" or "Mary Sullivan's
origins" is exactly right — do NOT dock it as "sentence-like." Objective
length is not graded here: objectives are meant to be broad, so an 8-word
objective is fine. Only a genuinely restated full-sentence title (the whole
objective copied into the title field) is a weakness.

- **pass:** `project` block complete and sensible; all required sections
  present (empty arrays where nothing was gathered); `validate_research_schema`
  passes (or is attempted and the only failures are pre-existing).
- **partial:** Project initializes, but one metadata field is genuinely weak
  or missing (e.g. the title is the full objective sentence verbatim, or
  `updated` is missing).
- **fail:** A required section is absent or malformed, the objective is
  missing/empty, or the file fails schema validation on init-written content.

## Researcher-profile interview & normalization

When the user supplies experience level and subscriptions, are they mapped
to the correct `experience_level`, normalized to the canonical subscription
enum, and stored with the verbatim `narration_guidance` for that level? When
no answers are available (single-turn), is the documented default used?

- **pass:** `experience_level` correct; `subscriptions` normalized to the
  canonical enum (case-folded, aliases mapped, deduped, `["none"]` when none);
  `narration_guidance` is the verbatim table text for the level. Single-turn
  with no answers → `intermediate` / `["none"]` default, noted as editable.
- **partial:** Mapping correct but normalization imperfect (an un-mapped alias,
  a missed dedupe) or `narration_guidance` paraphrased rather than verbatim.
- **fail:** Wrong experience level, subscriptions left as raw user text, or
  `narration_guidance` invented rather than drawn from the table.

## Place standardization

This dimension grades **only places the skill enters by hand** — i.e.
places drawn from the user's objective text, not from a tool. Places
returned by `person_read` already carry FamilySearch standardization and
must be **kept as-is**: NOT calling `place_search` on a `person_read`
place is the correct behavior and must never be penalized as a "missed
opportunity," even if the place is only country-level (e.g. "Ireland").
Init-project does not refine or enrich tree-supplied places.

Score this dimension **N/A (null)** whenever a test supplies all places
through `person_read` (or has no place at all) — there is nothing
hand-entered to standardize. Only score 1–3 when the objective text names
a place the skill had to enter itself.

- **pass:** Every hand-entered place is standardized via `place_search`
  and its `standard_place` is populated from the result. `person_read`
  places are left untouched.
- **partial:** A hand-entered place is standardized, but `standard_place`
  is hand-written without the `place_search` call, or only some
  hand-entered places are resolved.
- **fail:** A hand-entered place that resolves is left with no/empty
  `standard_place`, or a standardized string is fabricated without the tool.
- **N/A:** No hand-entered place — all places came from `person_read`, or
  the test involves no places. (Do not score this 1–2 for tree-only tests.)

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
