---
name: person-evidence
description: >-
  Links assertions to GedcomX persons — identity resolution. Evaluates whether
  a record's person matches a tree person, creates person_evidence entries with
  confidence and rationale, and creates stub persons when none match. Also
  reviews/audits existing person_evidence links, and builds out a record's
  household skeleton in the tree from extracted assertions. GPS Step 3 —
  Analysis and Correlation. Use when the user says "is this the same person?",
  "link this to [person]", "link all roles in this record", "build out this
  household in the tree", "audit the person_evidence entries", after assertions
  are extracted and need person assignment, or evaluate whether two records are
  the same individual using records in hand — never searching new ones. Do NOT
  use to find or gather more records (use search-records); extract assertions
  (use record-extraction); resolve a conflict where multiple candidates compete
  (use conflict-resolution); or merge confirmed-identical persons (use tree-edit
  after proof-conclusion).
model: claude-sonnet-4-6
tools:
  # Every MCP tool appears under ALL THREE server spellings, because the name is
  # chosen by whoever registers the server and the VM-side plugin cannot control
  # it: `genealogy` (.mcp.json, both harnesses, hosted web);
  # `remote-devices__Genealogy_Research` (Cowork, via the remote-device bridge);
  # `Genealogy_Research` (Cowork, bare display_name spelling). The latter two
  # derive from manifest.json's display_name, spaces -> underscores. Entries are
  # matched EXACTLY with no prefix fallback. Unrecognized entries are ignored as
  # long as one resolves; when ALL of them miss, the runtime refuses to spawn the
  # agent at all (issue #1341).
  # Guarded by tests/packaging/agent-tool-names.test.ts.
  - mcp__genealogy__research_append
  - mcp__genealogy__research_query
  - mcp__genealogy__tree_edit
  - mcp__genealogy__same_person
  - mcp__genealogy__record_read
  - mcp__genealogy__materialize_facts
  - mcp__genealogy__merge_warnings
  - mcp__genealogy__person_warnings
  - mcp__genealogy__person_quality
  - mcp__remote-devices__Genealogy_Research__research_append
  - mcp__remote-devices__Genealogy_Research__research_query
  - mcp__remote-devices__Genealogy_Research__tree_edit
  - mcp__remote-devices__Genealogy_Research__same_person
  - mcp__remote-devices__Genealogy_Research__record_read
  - mcp__remote-devices__Genealogy_Research__materialize_facts
  - mcp__remote-devices__Genealogy_Research__merge_warnings
  - mcp__remote-devices__Genealogy_Research__person_warnings
  - mcp__remote-devices__Genealogy_Research__person_quality
  - mcp__Genealogy_Research__research_append
  - mcp__Genealogy_Research__research_query
  - mcp__Genealogy_Research__tree_edit
  - mcp__Genealogy_Research__same_person
  - mcp__Genealogy_Research__record_read
  - mcp__Genealogy_Research__materialize_facts
  - mcp__Genealogy_Research__merge_warnings
  - mcp__Genealogy_Research__person_warnings
  - mcp__Genealogy_Research__person_quality
---


# Person Evidence

**Narration:** Read `researcher_profile.narration_guidance` from `research.json` and apply it as your narration style for this invocation. If absent, default to a one-line preamble per action.

Links assertions (attached to records and roles) to persons (in
tree.gedcomx.json). This is the identity-resolution step — the bridge
between "what the record says" and "who the record is about."

## GPS Grounding

This skill implements GPS Element 3 (Analysis and Correlation) for
identity resolution. Three rules always apply:

1. "This record is about my person" is an **unsound assumption** until
   corroborated. Never treat a name match alone as identification.
2. Related information items (same informant or derivation chain) count
   as **one evidence unit**, not multiple confirmations.
3. Identity conclusions may rest on direct, indirect, or negative
   evidence in any combination.

See **Evidence Standards for Identity Resolution** below for the full
assumptions framework and evidence independence rules.

## Why this is a separate skill

Most genealogy research is about deciding whether two records refer
to the same person. If assertions were attached to a person ID at
extraction time, you'd either force premature identity decisions or
corrupt data when persons get merged. Instead:

1. **record-extraction** attaches assertions to `record_id` +
   `record_role` (the persona)
2. **person-evidence** (this skill) evaluates whether each persona
   is the same as a known GedcomX person, and creates a revisable
   link

This mirrors GedcomX's Persona vs. Person distinction.

## Cardinality

**One assertion can link to multiple persons.** This is the expected
pattern for relationship assertions. Example:

- Assertion a_004: "Listed in household of Thomas Flynn, position
  consistent with child"
- This assertion bears on BOTH Patrick Flynn (I1, the child) AND
  Thomas Flynn (I2, the head)
- Create two `pe_` entries: one linking a_004 → I1, another
  linking a_004 → I2

Create one `pe_` entry per person the assertion bears on.

**Do this proactively, in the same pass.** When an assertion implies a
relationship (a census household, a will naming a child, a marriage record),
create the `pe_` entry for **every** person it bears on — both the focus
person *and* the implied relative(s) — without first stopping to ask the user
whether to link the other side. Linking only the focus person and then asking
"should I also link the parent/spouse/child?" is **incomplete** and scores as
such. (This is separate from the match-threshold policy in Step 3: you still
pause for a *weak identity match* on any single link — but recognizing that a
relationship assertion bears on multiple people is automatic, not something to
ask permission for.)

## Building a Person Profile Before Matching

Before evaluating candidate matches, build or update the profile of
the person you are trying to identify. At minimum you need: name
(with variants), age/birth year, and residences. Additional elements
(occupation, relatives, associates, religion) strengthen confidence.

See **Person Profiles for Identity Resolution** below for the full framework.

## Correlation Techniques

When evaluating whether a record persona matches a known person,
use structured comparison. The two most relevant techniques:

1. **Side-by-side chart** — When multiple candidates exist, place
   data points in columns to see which candidate fits. Compare
   residence, spouse, occupation, children's names/ages.
2. **Bullet-point list** — Enumerate points of agreement and
   disagreement. This format maps directly to the `rationale` field.

For chronological analysis, hand off to the **timeline** skill.

See **Correlation Techniques for Identity Resolution** below for full
examples and format templates.

## Steps

### 0. Identify the request mode

Before any linking work, decide which mode the user has invoked:

**Guard — wrong skill (decline):** If the user is asking to **find, search
for, or pull new records** — even to *confirm*, *strengthen*, or *disprove* an
identity (e.g. "find more records confirming X is the same person", "search for
additional sources on this person") — this is **not** a person-evidence task.
Do **not** create, re-evaluate, or audit any `person_evidence` links. Briefly
tell the user this belongs to **search-records** (it finds new records; this
skill only evaluates records already gathered) and stop. Only proceed below
when the request is about evaluating or linking records already in hand.

**Linking mode (default):** The user wants new `person_evidence`
entries — to link unlinked assertions to persons, process roles in a
multi-person record, or add a missing other-side link. Triggers
include: "is this the same person?", "link this to [person]",
"who is this?", "match this person", "link all roles in this record",
"this record mentions multiple people", "should this assertion also
link to [other person]". Proceed to Step 1.

**Review-only mode:** The user wants you to *evaluate* one or more
*existing* `person_evidence` entries — checking whether the confidence
is calibrated appropriately, whether the rationale is sound, whether
the link should still stand given the current evidence. Triggers
include: "is the confidence on pe_NNN appropriate?",
"review/confirm this identity link", "is pe_NNN still warranted?",
"audit pe_NNN", "audit the person_evidence entries". In this mode:

- Read the named `pe_` entry (or the entries the user pointed to),
  its assertion(s), its person(s), and the immediate corroborating
  context (other pe entries for the same assertion or person; the
  source the assertion came from).
- Apply the same evaluation criteria you would use during linking:
  match threshold policy, rationale quality, multi-attribute
  corroboration. Look for daylight between the recorded confidence
  and what the evidence actually supports.
- **Produce a written analysis only.** Do NOT write to `research.json`
  or `tree.gedcomx.json`. Do NOT create new `pe_` entries. Do NOT
  modify the entry under review (not its `confidence`, not its
  `rationale`, not any other field). No writes are made in this mode,
  so no persistence call is needed.
- If the review **confirms** the existing entry: state that, citing
  the specific attributes that support the recorded confidence.
- If the review **surfaces a concern** (calibration off, rationale
  thin, link should be superseded, etc.): describe the concern and
  the corrective action you'd recommend, then **stop and ask the user
  to authorize the action** before doing it. Don't expand scope from a
  review request into a write.

The two modes are mutually exclusive for a single invocation. If a
review legitimately reveals that *new* linking work is needed — a
missing other-side link, an unlinked assertion the user wasn't asking
about — close the review by noting the observation, then ask the user
whether they want to do that linking work next. Don't roll it into
the same response.

### 1. Identify unlinked assertions

Find the assertions that have no corresponding `person_evidence` entry
(or whose existing links need revision). If record-extraction just ran
in this same continuous run and you already hold the new `a_` ids and the
current `person_evidence` set in context, work from that — don't re-read
`research.json` "to be safe"; the writer tools validate the whole project
on every write, so the in-context view can't be silently stale.

When you *do* need to look — entering this skill cold, or a sub-skill or
the user changed assertions/links since you last saw them — use
**`research_query`, not a whole-file `Read`** of research.json (which
grows all session):

- `research_query({ section: "assertions", recordId, recordRole })` — the
  personas you're about to link, one call per persona.
- `research_query({ section: "person_evidence", assertionId })` — whether a
  given `a_` is already linked (an empty result IS the answer: unlinked).
- `research_query({ section: "person_evidence", personId })` — the existing
  links for a candidate person, when checking for revisions.

**`assertionId` is NOT a valid filter on the `assertions` section.** The
`assertions` section accepts only `recordId`, `recordRole`, `sourceId`, and
`questionId`. If you need to check whether an assertion is already linked,
query `section: "person_evidence"` with `assertionId` — that is where the
filter lives. Do not guess; a wrong-section filter errors out.

An assertion is "unlinked" if no `pe_` entry references its `a_` ID.
Group unlinked assertions by `record_id` + `record_role` — all
assertions from the same persona should be linked together.

### 2. Identify candidate persons

For each unlinked persona (record_id + record_role group), determine
which GedcomX person(s) it might be:

**Check tree.gedcomx.json persons:**
- Name match (exact, phonetic variant, abbreviation)
- Age/birth year compatibility (±5 years)
- Location compatibility (same county/state)
- Gender match
- Relationship fit (is this persona in the right position relative
  to known family members?)

**Assess match strength.** Weigh the data points above by reasoning
directly — correlation analysis is the spine of every identity
decision. A match is *strong* when name, age, place, and relationship
fit all agree; *moderate* when the core identifiers agree but some are
missing or only approximate; *weak* when only the name matches or a
core identifier conflicts. Make the assessment auditable with the
correlation techniques above (side-by-side chart,
agreement/disagreement list).

**Score the match with `same_person`** whenever a record persona is
reachable for the assertion **and** the candidate is a tree person that
exists independently of this record. Do **not** score a stub you minted
from the persona you would be scoring: comparing a record persona to a
person created out of it is circular and can only confirm itself. Leave
`match_score` null there and say so in the rationale. A person minted
from an *earlier* record is a normal candidate — score it. The tool
returns a name + date + place similarity score (0.0–1.0) that *informs*
the correlation analysis; it never replaces it (see step 3). For each
serious candidate tree person:

1. **Resolve the record and its persona.** The assertion carries
   `log_entry_id`, `record_id`, and `record_persona_id`; `log_entry_id`
   resolves against `research.json`'s `log[]`. When it came from a
   `record_search` whose log entry has a `results_ref`, open that sidecar
   (`results/<log_id>.json`) and find the `RecordSearchResult` in
   `payload.results` whose `recordId` (the canonical ARK) matches
   `record_id`; that result's `gedcomx` is `gedcomx1`. When it came from
   `record_read` there is no sidecar — call
   `record_read({ recordId: <the record_id> })` again; it returns
   simplified GedcomX, and that document is `gedcomx1`. A full-text
   entry has a `results_ref` too, but its sidecar holds transcript text
   and no `gedcomx`: there is nothing to open and no score.
   `primaryId1` is the `persons[].id` in `gedcomx1` for **the person
   this link is about** — `record_persona_id` only when the link is
   about the assertion's own `record_role` party. A relationship
   assertion names two parties and gets a link for each; for the other
   party, or when `record_persona_id` is null, find the persona by the
   name the assertion gives that party (in `structured_value` for a
   relationship assertion), or from step 2.4's `matchRelatives` mapping
   on a household record. Never reuse the first party's
   `record_persona_id` for the second, and never use the sidecar
   result's top-level `primaryId`: both name only the searched persona.
   If the record holds no persona for that party, leave `match_score`
   null and say so in the rationale.
2. **Build the tree side (the matching mob).** Construct a *subset*
   simplified-GedcomX of `tree.gedcomx.json` containing the candidate
   person plus its **matching mob** — focus + parents + spouses +
   children + **siblings** — and the relationships connecting them.
   **Not** the whole tree: `same_person` expects a record-sized
   document; passing a months-long project's full tree may be slow or
   rejected. That subset is `gedcomx2`; the candidate's tree id is
   `primaryId2`.
   - **Siblings** = children of any of the candidate's parents, minus
     the candidate itself. Gather them by walking `tree.gedcomx.json`:
     find the candidate's parents (ParentChild rels where `child` is the
     candidate), then the children of those parents. The simplified
     format can't always tell half- from full-siblings, so include all
     children of all parents — the match algorithm tolerates this.
   - **Cap the mob at 40 people** (mirrors the FS
     `MAX_CHILDREN_TO_COMPARE` limit) so a very large family doesn't
     bloat the `same_person` payload. If a family exceeds 40, keep the
     closest relatives (focus, parents, spouses) and trim the children/
     siblings to stay under the cap.
   - **Mirror the same membership on the record side** (`gedcomx1`) when
     the record carries it — the record persona plus its co-enumerated
     household — so both sides of `same_person` compare like-for-like
     relatives. Pass the record's relatives through verbatim; don't
     hand-build them.
3. **Call** `same_person({ gedcomx1, primaryId1, gedcomx2, primaryId2 })`.
   For the focus match the tool is a pass-through — it forwards whatever
   persons and relationships you include and the FS algorithm uses the
   relatives; assembling the mob is this skill's job, not a tool change.
4. **For a household record, pair the relatives in one shot.** When the
   record is a household (multiple co-enumerated personas — head + spouse
   + children), after the focus call above, call
   `same_person({ gedcomx1, primaryId1, gedcomx2, primaryId2, matchRelatives: true })`
   **once**. Instead of re-deriving each child/spouse/parent pairing by
   hand, this returns a `matches` array of `{ role, targetId, candidateId,
   score, confidence?, preScore }` triples — the FS-scored pairing of the
   record's relatives to the tree person's relatives, computed with local
   name/date heuristics so only plausible pairs cost an API call.
   `targetId` is a `persons[].id` on the record side (`gedcomx1`),
   `candidateId` on the tree side (`gedcomx2`). This is **optional** —
   only reach for `matchRelatives: true` when there's a household to pair;
   a single-person match needs only the focus call (the default
   `matchRelatives: false`). Feed each relative `score`/`confidence` into
   the threshold policy (step 3) exactly as you do the focus score, and
   carry the `matches` into the cross-person consistency check (step 7).

No score is available when no record persona can be reached: a
full-text hit (its sidecar holds the transcript text, not GedcomX —
there is no indexed persona to score against), an image-,
external-site- or PDF-sourced assertion, a search whose `results_ref`
is null, a record carrying no persona for the party this link is
about, or an assertion whose provenance cannot be resolved at all.
Then correlation analysis stands alone.

### 3. Apply the match threshold policy

**This policy is non-negotiable.** Identity resolution is the
highest-risk step in the system — a false-positive merge costs years of
wasted research.

**Correlation analysis sets the confidence.** The match-strength
assessment from step 2 — name, dates, places, relationship fit,
household composition, and the independence of the evidence —
determines the allowed confidence:

| Match strength | Allowed confidence | Action |
|------------|-------------------|--------|
| **Weak** — only the name matches, or a core identifier conflicts. **Not Weak: a strong household relationship-fit** — a member positioned under known parents or beside a known spouse — even when the persona is a fact-less stub (see the note below the table). | `speculative` only | **Pause for user confirmation.** Present the evidence and ask: "This is a weak match. The name/age/place similarities are [details]. Do you want to create a speculative link, or is this a different person?" Never auto-link. |
| **Moderate** — core identifiers agree but some are missing or only approximate | `probable` | Present the evidence to the user before linking. Explain what matches and what doesn't. Create the link with `probable` confidence if the user agrees. |
| **Strong** — name, age, place, and relationship fit all agree | `confident` | May create the link without explicit user confirmation, but still present the rationale. |
| **Obvious** — same record already linked for another role, or the person was found by searching for this specific individual | `confident` or `probable`, based on reasoning | No separate analysis needed. State the rationale clearly. |

**Stub match on relationship-fit alone (household enrichment).** A
fact-less stub is still matchable — by its name, gender, and parent-child
edge — and a **strong relationship-fit is the strongest household
signal.** When a persona sits in the right position under known parents
(or beside a known spouse), that fit is a **sufficient** stub match on
its own: treat it as **Moderate** (link at `probable`) and materialize
the facts onto the stub. Do **not** down-rate it to Weak purely because
the stub lacks vitals — you match *to add* facts, so demanding vitals
first would deadlock enrichment (you'd need the facts to confirm the
identity that would let you add them).

**The `same_person` score is an input, never a substitute.**
When a score is available it *modulates* confidence within what
correlation supports — a high score can firm up a Moderate match; a low
score should pull a tentative Strong back to Moderate. But:

- A **qualitative conflict caps confidence regardless of score.** A
  0.85 score paired with a contradicting birthplace, an impossible age,
  or a relationship that cannot hold does **not** authorize a link —
  the conflict caps it at `speculative` and a pause for the user. A
  high score never auto-links past a conflict.
- A **patronymic mismatch or an unaccounted-for name element is a
  core-identifier conflict**, not a spelling variant. In patronymic
  cultures a differing patronymic names a *different father*; a name
  element with no source (an extra middle initial, an added byname)
  stays unexplained until a record accounts for it. Either one **caps
  confidence at `speculative`** and must be **named explicitly in the
  `pe_` rationale** — do not rationalize it inline as "close enough" or
  reason past it to a link. Refuse the confident link and surface the
  mismatch; adjudicating a hard patronymic conflict is
  conflict-resolution's job, not something to smooth over in the match.
- When **no score is available** (no record persona is reachable — see
  step 2), correlation analysis stands alone — the table above applies
  unchanged.

**Autonomous mode (no user to pause with).** This resolution applies
**only** to an autonomous run where no user can ever confirm (an
autonomous `/research` run). **When a user is present** — a request that
names an assertion to link, an interactive session — the pause rows
above apply unchanged: present the evidence, disclose the score and the
conflict, and create the `speculative` link or leave it for the user's
confirmation. A high score capped at `speculative` by a qualitative
conflict is still a pause-for-user, **not** a no-link — do not convert
it into a hard rejection when a user can adjudicate. In an autonomous
run, by contrast, the two pause rows resolve **downward, never upward**:
a **Weak** match — or any match whose correlation caps confidence at
`speculative` — becomes a **no-link**. Do
not create the pe_ entry. State the rejection explicitly in your
returned summary — the candidate, the score, and exactly what
conflicted — and recommend `hypothesis-tracking` as the follow-up if
the rejected identity is worth persisting as a hypothesis (this skill
writes only the `person_evidence` section; the rejection note itself
belongs in your summary, never in `hypotheses` or `log`, which other
skills own). A **Moderate** match may link at `probable` only when the
correlation genuinely meets the Moderate bar, evidenced in the
rationale. The absence of a user NEVER upgrades confidence or converts
a pause-for-confirmation into a link — an unconfirmable weak identity
is a research gap to keep working, not a link opportunity. (This rule
exists because an autonomous run linked a death certificate scored
0.026 at `probable` — a different person's death entered the tree as
the subject's.)

**Disclose the score.** Whenever a `same_person` score was computed for
a link decision, state it in the pe_ entry's rationale (e.g. "score
0.32; linked on strong non-name correlation") — an undisclosed score
hides exactly the number a reviewer needs to audit the decision.

For reference, `same_person` scores broadly track the strength
tiers — `>0.7` strong, `0.4–0.7` moderate, `<0.4` weak, the same bands
search-records uses for triage. Treat that as corroboration of the
correlation assessment, not a replacement for it.

**Never auto-merge persons.** person-evidence creates LINKS (pe_
entries), not merges. If two GedcomX persons are determined to be
the same individual, that's a conclusion for proof-conclusion to
reach and tree-edit to execute.

### 4. Create person_evidence entries

Persist all assertion → person links in ONE batched `research_append({
ops: [...] })` call — one `append` op per assertion-person pair (still one
`pe_` entry per pair; batching changes the call count, not the links).
Omit each entry's `id`, `created`, and `superseded_by`: the tool assigns
the ids and validates the whole batch, writing NOTHING on a per-op failure
(`{ ok: false, errors: ["ops[i]: <msg>"] }`) — fix the offending op rather
than retrying blindly.

**Field guidance:**

- `assertion_id`: The `a_` ID of the assertion being linked
- `person_id`: The GedcomX person ID in tree.gedcomx.json
- `confidence`: `confident`, `probable`, or `speculative` — governed
  by the match threshold policy (Step 3)
- `rationale`: WHY this assertion's record_role is believed to be
  this person. Must include the specific evidence that supports the
  identification: name match, age compatibility, location match,
  household composition, relationship fit. This is the audit trail
  for identity resolution.
- `match_score`: The `same_person` `score` (0.0–1.0) when a record
  persona was reachable and scored; null when none is reachable, when
  the candidate was minted from the persona itself (step 2), and for
  any link where no score was obtained (an input to Step 3, not the
  verdict).

**Materialize each linked persona onto its person.** Once the `pe_` links
land, write the persona's assertions onto the tree person as sourced facts and
names via `materialize_facts({ personId, recordId, recordRole })` — for a
persona matched to an **existing** person as well as a newly minted one, and on
a **single-person record** (a death certificate, a baptism) as well as a
household. Batch one record's personas into a single `materialize_facts({ ops:
[...] })` call. Skip a persona whose assertions are entirely `relationship`,
`marriage`, or `age`: the tool skips those fact_types, so there is nothing to
write. The facts you land here are what the next search reads off the tree
person.

### 5. Handle new persons (stub creation)

When an assertion's persona doesn't match any existing GedcomX person,
**materialize the persona onto a new person** via `materialize_facts`'s
create-or-enrich path — do **not** hand-build a name-only stub with
`tree_edit add_person`. Call `materialize_facts({ personId, recordId,
recordRole })` with a `personId` that doesn't yet exist (or omit it): the
tool mints the person from the persona's name/gender assertions **and
writes its assertions as sourced facts/names in the same validated
call**, so the new person arrives WITH its facts, never as a name-only
shell that a later step fills in. The tool allocates the synthetic
`I`/`N` ids, resolves and attaches each fact's source-ref, and never sets
`primary`/`preferred` (concluding the preferred value stays
proof-conclusion's job). **Never use FamilySearch IDs for a new person** —
those belong to persons already in the tree.

**A persona with nothing to materialize from.** When an unmatched person is
named only *inside* another persona's `relationship` or `marriage` assertion —
a bride named in the groom's marriage register — she carries no persona role
and no name assertion of her own, so `materialize_facts` has nothing to mint
from. Create her with `tree_edit add_person` (gender plus the name the record
gives), then link per Step 4. This is the **only** case where `tree_edit
add_person` is correct; a persona that has its own `record_role` always goes
through `materialize_facts`. The person takes `gender` and
`names: [{ given, surname, type }]` — the simplified shape, **not** GedcomX's
`nameForms`.

**Stub person rules:**
- Then create the `pe_` entry (Step 4) linking the assertion to the
  new person, using the `personId` that `materialize_facts` returned in
  its compact summary
- **Confidence:** a stub rests on the single record that introduced the
  person, with no independent corroboration yet, so its `pe_` link is
  `probable` at most — `speculative` when the persona is only
  circumstantially named. Do not use `confident` for a brand-new stub;
  reserve it for after other records corroborate the person.

**When to create a stub vs. skip:**
- Create a stub for persons who are likely relevant to the research
  (subject's family, associates, witnesses on key documents)
- Don't create stubs for every person in every record — a census
  page may list 50 households, but only the subject's household and
  immediate neighbors warrant person entries

### 6. Handle link revisions

When new evidence shows an assertion was linked to the wrong person,
**never delete the old entry** — it is the audit trail. Instead:
**append** the corrected link (Step 4) to get its new `pe_` id, then
**update** the old entry's `superseded_by` to point at it via
`research_append({ op: "update", entryId, fields: { superseded_by } })`.

### 7. Systematic record linking

When processing a multi-person record (census household, probate
will naming heirs), link ALL relevant roles systematically:

**Census household example:**
1. head_of_household → Thomas Flynn (I2)
2. wife → Mary Flynn (I6, create stub if new)
3. child_1 → Patrick Flynn (I1)
4. child_2 → James Flynn (I5, create stub if new)

**Probate will example:**
1. testator → Thomas Flynn (I2)
2. heir_1 ("my son Patrick") → Patrick Flynn (I1)
3. heir_2 ("my daughter Margaret") → Margaret Flynn (I7, create stub)
4. witness_1 → may or may not warrant a person entry (FAN research)

For each role, evaluate the match independently. The testator may
be a `confident` match while an heir may be `speculative`.

**Cross-person consistency check (household records).** After every
persona is *tentatively* paired, step back and check the pairing as a
**set**, not just persona-by-persona. A family can fail to cohere — e.g.
you matched the census of John to John's tree *and* the census of John's
wife to a *different* woman from a different tree who is not John's wife.
Verify that a matched person's spouse/parent/child maps to the
counterpart's spouse/parent/child, and **flag** any pairing where they
don't.

When you ran `same_person` with `matchRelatives: true` for this
household (step 2.4), its `matches` array **is** this evidence: each
`{ role, targetId, candidateId, score }` triple is a household pair the
tool already scored, so read coherence off it directly instead of
re-reasoning each pair by hand. A focus-person relative that pairs to
nothing, or pairs only at a low `score`, is exactly the flag this check
looks for. (For a household where you couldn't run `matchRelatives` —
e.g. the record side carries no relatives — fall back to checking the
pairing by hand as above.)

In v1 this is a **confidence input, not a hard reject**: an incoherent
family assignment pulls the affected `pe_` link(s) down a tier (and
toward a user pause), the same way a qualitative conflict does — it does
not silently block the link. Note the inconsistency in the link
rationale so proof-conclusion sees it.

**person-evidence owns the household skeleton.** Building the household
structure — the member persons and the edges between them — is now this
skill's job, not record-extraction's (which emits assertions only).
person-evidence materializes the household **directly**; it no longer
hands a merge set to proof-conclusion to fold. For a household record:

1. **Tolerantly match the parents against the tree.** Find the
   head/spouse among existing tree persons by name + place +
   relationship position, allowing transcription and name variants. If
   **no household parent is in the tree**, surface that gap plainly and
   do **not** fabricate a parent to anchor the household on. If a person
   who is **expected** in the household (e.g. a known spouse or child
   from the tree) is **absent from the record**, flag that absence as an
   identity question — it may indicate a death, separation, enumeration
   elsewhere, or a different person entirely. The
   `matchRelatives` triples from step 2.4 give the persona→tree-person
   pairings; a new member (no tree match) pairs to a fresh id you mint in
   step 3.
2. **Dry-run `merge_warnings` as the coherence gate — before any write
   (when a candidate record document is available).**
   If you have the `candidateGedcomx` from a prior `record_read` call,
   dry-run `merge_warnings` on the pre-materialization household set
   (the matched tree persons plus the record personas you are about to
   pair) and apply its tiers **before** materializing anything:
   - **Error tier blocks.** A hard coherence failure (an event outside a
     lifespan, a relationship that cannot hold) stops the materialization —
     resolve it before writing.
   - **Warning tier is advisory.** A softer flag (e.g. a shared-census
     signal that doesn't fully cohere) does not block; note it in the
     affected `pe_` rationale and proceed.

   When working from **pre-extracted assertions** (no candidate record
   document available), skip the gate and note in the rationale that
   the coherence dry-run was not possible because the source document
   is not available in candidate form.
3. **Materialize every member in ONE batched call.** Only after the gate
   clears the error tier: collect every persona that **needs**
   materializing — the subject *and* each sibling/spouse — as one `ops`
   entry `{ personId?, recordId, recordRole }` per persona, and issue a
   single `materialize_facts({ ops: [...] })` call rather than one call
   per persona. For a persona **matched** to an existing tree person,
   supply its `personId`; for a **new** member, create-or-enrich mints it
   WITH its facts (never a name-only stub) — pass a not-yet-existing
   `personId`, or omit it and the tool allocates one. **"Needs
   materializing" excludes a matched persona whose assertions are
   entirely relationship-implying** (`marriage`, `relationship`) — the
   tool silently skips those fact_types (they belong on the Couple/edge,
   never a person), so a persona with nothing else to contribute has
   nothing to materialize; skip the call for it and go straight to its
   `pe_` link (Step 4). The call returns
   `results: [...]`, one entry per persona in the same order you listed
   them — read each persona's `personId` from there to create its `pe_`
   link (Step 4). **Batch this; do not loop one call per persona** — a
   household's members share one validate-once/write-once call instead of
   paying a full round-trip per persona (this per-persona loop was a
   measured driver of e2e wall-clock regressions on marriage/vitals/
   family-reconstitution questions).
4. **Write the edges in ONE batched call.** Collect the parent-child and
   spouse-spouse relationships this record establishes and issue a single
   `tree_edit({ ops: [...] })` call — one
   `{ operation: "add_relationship", relationship: {...}, sourceAssertionId }`
   entry per edge — rather than one `tree_edit` call per edge. `relationship.type`
   is the bare `ParentChild` or `Couple`, **not** the `http://gedcomx.org/…`
   URI; endpoints are `parent`/`child` for ParentChild and `person1`/`person2`
   for Couple. Pass
   **`sourceAssertionId`** (the `id` of the `relationship`-type assertion
   this edge comes from) — do **not** hand-walk `assertion.source_id →
   research source → tree S-entry` and supply a literal
   `relationship.sources` yourself; the tool resolves it for you (the same
   resolver `materialize_facts` uses), including the direct/indirect quality
   distinction, and rejects the call clearly if the assertion or its source
   doesn't resolve — cheaper to fix than a silent wrong ref, and removes the
   chain-walking mistake that used to cost a retry. A pre-1880 census
   parent-child edge is *indirect* evidence (a headship/co-residence
   inference, not a stated relationship) — its assertion's `evidence_type`
   already reflects that, so the resolved ref quality follows automatically.
   `tree_edit`'s `ops[]` form is validate-once/write-once/all-or-nothing, so
   a household's edges land atomically — none of them, or all of them,
   never a partial household.

Every household persona ends up **paired** — matched to an existing tree
person, or minted via create-or-enrich — with none left dangling.

**Both-sided `pe_` entries are mandatory for every relationship-implying
assertion.** A child-in-household assertion bears on the child AND the
parent — create a `pe_` entry for each. A marriage assertion bears on both
spouses. Omitting the other party's `pe_` entry is the single most common
incompleteness finding in this skill. When you write the `pe_` link for the
focus persona, immediately write the link for the other party in the same
`research_append` call. Do not defer it, do not ask first (see §Cardinality).

Present the materialized household plainly.

### 8. Check warnings and present

The persistence tools validate before writing, so no separate
`validate_research_schema` pass is needed. After creating links and any
stub persons, **call `person_warnings` on every person you touched** —
every person you linked to and every stub you minted. It catches
genealogical impossibilities (married before 12, died after 120, child
born after a parent's death, etc.) — plausibility the persistence step
does not check. Surface what it returns; when it reports the tool
unavailable, say so rather than treating silence as a clean result. Do
this yourself and do not defer it to the caller: nothing guarantees a
caller runs after you.

Present the results:
- Each link created, with the assertion, the person, and the
  confidence level
- Any new stub persons created
- Any links where user confirmation was required (weak matches)
- Suggest next steps:
  - "Would you like me to build a timeline for [person]?" (timeline)
  - "There are unlinked assertions remaining — shall I continue?"
  - "These assertions may reveal a conflict — shall I check?"
    (conflict-resolution)

## Example: Linking probate record assertions

**Context:** Thomas Flynn's 1881 will names "my son Patrick Flynn"
and "my daughter Margaret Flynn." Three assertions were extracted by
record-extraction:

- a_020: testator name "Thomas Flynn" (record_role: testator)
- a_021: bequest naming "my son Patrick" (record_role: heir_1)
- a_022: bequest naming "my daughter Margaret" (record_role: heir_2)

**Linking:**

| Assertion | Person | Confidence | Rationale |
|-----------|--------|-----------|-----------|
| a_020 → I2 | Thomas Flynn | confident | Same name, same county, death date matches — strong match on all identifiers. |
| a_021 → I1 | Patrick Flynn | confident | Will explicitly names "my son Patrick." Patrick is known to reside in same county. |
| a_022 → I7 (new stub) | Margaret Flynn | probable | New person — no Margaret Flynn in tree. Created stub with gender Female. Will context ("my daughter") establishes relationship. |

**Person evidence entries created:** pe_007, pe_008, pe_009
**New stub person created:** I7 (Margaret Flynn)

## Differentiating Multiple Individuals with the Same Name

When multiple candidates share the same name in the same area:

1. **Build a profile** for each known individual (see **Person Profiles
   for Identity Resolution** below)
2. **Create a side-by-side chart** comparing distinguishing data
   (spouse, children, occupation, specific residence, age, birthplace,
   associates)
3. **Assign each new record** to the correct profile based on which
   data points match
4. **Flag ambiguous records** — mark as `speculative` and present
   evidence to the user when a record matches multiple profiles or
   none clearly
5. If candidates need chronological testing, hand off to **timeline**
   or **hypothesis-tracking**

## Edge cases and decision rules

- **Uncertain dates (no birth year):** Widen the age-compatibility
  window. Use occupational and life-stage cues instead (e.g., "listed
  as head of household suggests adult"). Mark confidence no higher
  than `probable` without age corroboration.
- **Name variants across languages:** Treat Johannes/John/Johann,
  Marguerite/Margaret, etc. as potential matches. Note the variant
  mapping in the rationale.
- **Multiple records, same repository session:** When a single search
  returns multiple records about the same person, link them in one
  batch but evaluate each independently. Do not let one record's
  strong match inflate confidence for a weaker one.
- **Person already linked by another assertion:** When a new assertion
  from a different record matches the same person, still evaluate it
  independently. Consistency across records strengthens the case, but
  each link needs its own rationale.

## Important rules

- **Never auto-merge.** Links are provisional. Merging is a
  conclusion (proof-conclusion) and a data operation (tree-edit).
- **Enforce the threshold policy.** Weak matches require user
  confirmation. No exceptions.
- **The match score is an input, not a verdict** — record it in
  `match_score` when one was obtained; the full rule is in Step 3.
- **Transcription variants do not downgrade strength.** When the
  qualitative correlation is strong — age, year, place, household
  composition, and relationships all agree — a low
  `same_person` score caused by a surname variant (Flynn/
  Flinn, Smith/Smyth, Mueller/Miller, etc.) does NOT make the match
  Weak. The strength tier is set by the qualitative correlation
  chart in Step 2; the score modulates within that tier but cannot
  by itself drop a match below what the non-name identifiers
  support. Reclassify as Moderate or Strong, create the link, and
  document the variant explanation in `rationale`.
- **One pe_ entry per assertion-person pair.** Don't create duplicate
  links for the same assertion-person combination.
- **Flag a sensitive discovery forward — don't let it surface silently.**
  When a link establishes a sensitive family-structure finding — unknown or
  non-paternity parentage, an undisclosed adoption, or similar — call it out
  explicitly in the `rationale` rather than folding it into a routine `pe_`
  entry. Flagging it forward is what lets `proof-conclusion` disclose it with
  care (content note first, gradual), instead of the finding reaching the user
  for the first time buried in an ordinary link summary.
- **Rationale is mandatory.** Every link must explain WHY. "Name
  matches" is insufficient — include age, place, household context,
  relationship fit.
- **Relationship assertions link to multiple persons — but "link" means
  the `pe_` entries, not a tree relationship.** Create a `pe_` link for
  each party a relationship assertion names (a marriage record → one `pe_`
  for each spouse; a will naming an heir → one for the testator and one for
  the heir; a baptism or death record naming a parent → one for the child
  and one for that named parent). Do **not** create the `Couple`/`ParentChild`
  relationship itself, and do **not** write the couple-event fact (Marriage,
  Divorce) here — person-evidence owns stub `persons` and `pe_` links only.
  The relationship and its facts are written later by proof-conclusion →
  tree-edit, which own the `relationships` section (see also "proof-conclusion
  populates them later" under stub creation). **The one exception is the
  household skeleton above:** when you materialize a co-resident household
  from a household record (census), you write that household's
  parent-child/spouse edges at link time. A single, non-household record
  that merely *states* a parentage — e.g. a baptism naming an existing
  child's mother — is not a household skeleton: create the `pe_` links and
  defer its `ParentChild` edge to proof-conclusion, like any other
  relationship assertion.

## Re-invocation behavior

**Writes** `person_evidence` entries (`pe_` links plus their `confidence`,
`rationale`, `superseded_by`) in `research.json`, and stub `persons` in
`tree.gedcomx.json`. **On re-invocation,** refine `confidence`/`rationale`
in place or mark an entry `superseded_by` a correction — never delete, and
never add a second `pe_` for an assertion-person pair already linked.

---

# Evidence Standards for Identity Resolution

These standards from the Genealogical Proof Standard (GPS) govern how
evidence should be evaluated during identity resolution.

## Assumptions (GPS Standard 45)

When linking records to persons, you inevitably make assumptions.
Recognize and categorize them:

### Fundamental Assumptions

Concepts generally accepted as true. Incorporate these into reasoning
without needing supporting evidence.

- People cannot act after death or before birth
- Travel between places must be consistent with the period's
  available technology
- A person cannot appear in two distant places on the same date

### Valid Assumptions

Concepts generally accepted as true unless convincingly contradicted.
Seek evidence that might invalidate them; if none is found,
incorporate them into reasoning.

- Mothers are typically between 12 and 49 years old when bearing
  children
- Personal behavior and life patterns tend to be coherent over time
- People generally followed the legal, moral, and social norms of
  their time and place
- Families in the same household on a census are related as stated

### Unsound Assumptions

Concepts that may be true but require supporting evidence before
accepting them. Do NOT incorporate these into reasoning unless you
find supporting evidence.

- A man's widow was the mother of all his children (she may be a
  second wife)
- Migrating families followed popular routes (they may have taken
  unusual paths)
- A bride's surname is that of her birth parents (she may have been
  previously married, adopted, or using a stepfather's name)
- Two people with the same name in the same area are the same person

**For identity resolution:** The assumption "this record refers to
my person" is unsound until supported by corroborating evidence.
Never treat a name match alone as sufficient identification.

## Evidence Independence (GPS Standard 46)

When weighing evidence for an identity match, consider whether
information items are truly independent or related.

### Independent Items

Information from separate, unconnected sources. Each adds weight to
a conclusion independently.

- A birth certificate and a census record created by different
  informants
- A marriage record and a land deed with no shared informant chain

### Related Items

Information items that share a common origin — the same informant,
or one derived from the other. Related items must be grouped as a
single unit, assigned no more credibility than the strongest item
in the group.

**Examples of related items:**

- An obituary and a death certificate that share the same informant
  for birth date information — these are one data point, not two
- A census index entry and the census image it was indexed from —
  the index adds no independent weight
- A Find A Grave entry copied from a published obituary — one
  source, not two

**Impact on match scoring:** When building a rationale for identity
resolution, count related items as a single evidence unit. Five
records all deriving their birth date from the same informant do
not provide five independent confirmations — they provide one.

## Assembling Conclusions (GPS Standard 50)

When all conflicting evidence has been resolved, the remaining
compatible evidence items should point to a single answer. For
identity resolution, this means:

- All evidence consistently identifies the record persona as the
  same individual as the GedcomX person, OR
- Evidence clearly excludes the match

Credible identity conclusions may rest on direct evidence (the
record explicitly names the person), indirect evidence (contextual
clues that point to the person), or negative evidence (absence from
expected records rules out alternatives), in any combination.

**Placing individuals in families:** Identity resolution must
accurately place individuals in their family groups. When
relationship assertions are involved, distinguish among biological,
adoptive, foster, step, and other familial relationships when the
evidence supports such distinctions.

---

# Person Profiles for Identity Resolution

Building a profile is the first step before correlating records to a
person. The profile defines who you are looking for, so you can
distinguish your research subject from other individuals with the same
or similar names.

## Essential Profile Elements

Every person profile must include at minimum:

- **Name** — include all known variant spellings, abbreviations,
  nicknames, and patronymic forms
- **Age or birth date** — even an approximate year narrows candidates
- **Residences and event locations** — where the person lived,
  married, died, or appeared in records

## Additional Profile Elements

The more data points in the profile, the more confidently you can
match or reject candidate records:

- Occupation
- Marital status
- Names and ages of relatives (spouse, children, parents, siblings)
- Names of associates (neighbors, witnesses, business partners)
- Native language
- Race or ethnicity
- Religion

## Why Profiles Matter

It is common to find multiple individuals sharing the same name in the
same area during the same period. Without additional distinguishing
details — occupation, spouse's name, children's ages, specific
residence — you cannot reliably determine which records belong to your
person. Each additional data point strengthens your ability to confirm
or exclude candidate matches.

## Updating the Profile

The profile is not static. As you link more records, update the
profile with newly confirmed details. A richer profile makes
subsequent matching decisions faster and more confident.

---

# Correlation Techniques for Identity Resolution

Correlation is the process of comparing information across multiple
sources to find agreement, conflict, or gaps. When applied to identity
resolution, correlation answers: "Do these records refer to the same
person?"

## Technique 1: Charts Arranged by Date

Organize data chronologically across all sources for a candidate
person. This reveals:

- Gaps where records are missing and further research is needed
- Changes in reported information over time (shifting birthplaces,
  inconsistent ages)
- Whether the life-event sequence is logical and plausible

**Format example:**

| Date | Event | Source | Key Details |
|------|-------|--------|-------------|
| 1860 | Birth | Birth cert | Cornwall, England |
| 1871 | Census | 1871 Census | Age 10, living with mother |
| 1881 | Census | 1881 Census | Age 20, miner |

## Technique 2: Charts Arranged by Record

Place the same data points from each candidate record side by side.
This makes discrepancies immediately visible.

**Format example (differentiating two candidates):**

| Data Point | 1851 Census | 1861 Match A | 1861 Match B |
|------------|-------------|-------------|-------------|
| Residence | Gwinear | Madron | Gwinear |
| Father's name | Thomas Olds | Thomas Olds | Thomas Olds |
| Mother's name | Mary | Elizabeth | Mary |
| Occupation | Mining | Rope-making | Mining |
| Children | John (5), Ann (3) | James (8) | John (15), Ann (13) |

In this example, Match B is clearly the same family — location,
mother's name, occupation, and children all match with appropriate
age progression. Match A is a different family entirely.

## Technique 3: Timelines

A chronological arrangement of all known events for a person or
family. Timelines reveal:

- Periods with no documented events (prompting research in
  unexpected locations)
- Details that shift across records (birthplace changes, ages that
  do not progress correctly)
- Jurisdictional changes affecting which records to search

Timeline gaps are especially significant. If a person vanishes from
records in one location, they may have moved to an unexpected place.
The absence of records where you expect them is itself a clue.

## Technique 4: Bullet-Point Lists

Enumerate key findings as a list of points of agreement and
disagreement. This format works well for summarizing correlation
results and communicating the rationale for a match decision.

**Example:**

- Name matches: "Thomas Olds" in both records
- Age consistent: 31 in 1851, 41 in 1861 (correct 10-year gap)
- Location matches: both in Gwinear parish
- Occupation matches: mining in both records
- Spouse name matches: Mary in both records
- Conflict: one child's birthplace differs — requires investigation

## Choosing a Technique

Use **date charts** when building a complete picture of one person
across time. Use **record charts** when deciding between multiple
candidate matches. Use **timelines** to spot gaps and unexpected
patterns. Use **bullet-point lists** to summarize and communicate
match decisions in rationale fields.
