# `same_person` MCP Tool — Implementation Spec

## Overview

An MCP tool that asks FamilySearch's `matchTwoExamples` API whether two
record extractions describe the same real-world person. The caller passes
two **simplified-GedcomX documents** (exactly as the LLM received them
from prior tool calls) plus two **person ids** identifying which person
in each document is the focus of the comparison. The tool inflates the
GedcomX, adds a `sourceDescription` anchor pointing at each focus
person, POSTs to FamilySearch, and returns a small match result to the
LLM.

Requires authentication (OAuth tokens obtained via the `login` tool).
Uses the website-service endpoint at
`https://www.familysearch.org/service/search/record/collections/match/matchTwoExamples`.

The tool is the **verify** primitive of the genealogy toolkit. It chains
naturally after `record_search`:

```
search(name, place, year)                                    // find candidates
   ↓
LLM holds simplified-GedcomX of each candidate in its memory
   ↓
(user picks two and asks: "are result 1 and result 10 the same person?")
   ↓
LLM calls same_person(gedcomx1, primaryId1, gedcomx2, primaryId2)
```

That is **arm B**, and it remains the right call when the LLM is comparing two
documents it already holds. The commoner case by far is scoring a record
persona against a tree person before writing a `person_evidence` link, and
there the LLM holds no documents — assembling them is what made the call
expensive enough to skip. **Arm A** takes project references instead and
assembles both sides host-side:

```
person-evidence is about to link assertion a_005 to tree person I1
   ↓
agent calls same_person({ projectPath, assertionId: "a_005", treePersonId: "I1" })
   ↓
tool resolves the record, builds the tree-side matching mob, scores, and
records the score to results/.scores/
```

The matching algorithm uses name + date + place. Parent context, when
provided, improves accuracy for ambiguous cases (common names, fuzzy
dates). For strong-signal matches the algorithm scores essentially the
same with or without parents.

---

## Input

**Two arms.** The explicit form below came first and is unchanged. The
project-relative form was added because the explicit one cost the
model a hand-assembled pair of record-sized documents per link, and it was
measurably not paying that cost. The lead's 2026-09-07 ruling measured 7,526
`person_evidence` links across 151 corpus runs against **91** `same_person`
calls in total; that figure is quoted at its date and does not reproduce today,
because the corpus has grown. The ratio is the durable part: re-measured on the
committed e2e corpus, **8,791** links across 183 runs against **239** calls,
about 37 links per call. Identity was being asserted and never scored. The arm is selected by the presence of `projectPath`.

### Arm A — project-relative (preferred)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `projectPath` | string | yes | The research project directory. Its presence selects this arm. |
| `assertionId` | string | yes | The assertion the `person_evidence` link will cite. Resolves the record, the party and the retrieval route in one hop. |
| `treePersonId` | string | yes | The candidate person's id in `tree.gedcomx.json`. |
| `recordRole` | string | no | Score a **different** party of the same record than the assertion's own `record_role` — the second party of a relationship or marriage assertion, which gets its own link. |
| `recordPersonaId` | string | no | Name the record persona directly when the assertion does not carry it and the party is otherwise ambiguous. |
| `matchRelatives` | boolean | no | As on arm B. Unavailable when the record side had to be projected (see below). |

**Why `assertionId` keys it.** The link about to be written is
`(assertion_id, person_id)` — that is what `person_evidence` carries and what
`personEvidenceScoreWarnings` reads. So the two tokens the agent already holds
at the call site are exactly these, and `assertionId` resolves `record_id`,
`record_role`, `record_persona_id` and `log_entry_id` together. The agent
supplies no record structure at all, which is the point of the 2026-09-11 lead
ruling: a mis-shaped `persons[]` built by the model yields a bad score rather
than an error.

#### The record side: fetch first, derive second

1. **`recordReadTool({ recordId, resultsRef?, projectPath }, principal)`** — one
   call, not two hand-rolled routes. It *is* sidecar-read-or-live-fetch already,
   it normalises the id on both sides (`extractEntityId` / `arkToBareId`), and it
   refuses `1:2:`/`3:1:` ARKs on both paths. Normalisation is not optional here:
   `record_id` is stored as a resolver **URL** on 561 of the corpus's 10,554
   assertions and as a bare `ark:` on 9,993, so a raw string compare misses.
   `resultsRef` is passed **only** when the log entry's tool is in
   `PERSONA_BEARING_PRODUCERS` (i.e. `record_search`). A `fulltext_search` or
   `external_links_search` entry carries a `results_ref` too, but its results
   hold no `gedcomx` and key on `id` rather than `recordId` — 300 corpus
   assertions sit on exactly that shape, and handing the ref over would look up
   nothing.
2. **The projection** (`src/utils/record-persona.ts`) — when the fetch is
   unavailable or throws. The record's parties are derived on demand by grouping
   its own assertions on `record_role`. Lead ruling 2026-09-11: derived, **not**
   stored and **not** built by the agent.

   This route is **strictly additive**. It makes an image-transcribed register
   page, a PDF, an external site and a sidecar-less search scorable for the
   first time — the 2026-09-11 ruling's point that treating retrieval as a
   domain truth was false. Route 1 is why nothing that works today regresses:
   derivation alone cannot see a party the assertions never mention, and the
   second party of a marriage assertion is exactly that party. The worked case
   is `eval/fixtures/scenarios/flynn-spouse-stub-marriage`, whose record
   `1:1:MARR-8T3` has a single `principal` assertion naming both spouses, and
   whose sidecar holds MP1 and MP2.

Party selection: `recordPersonaId`, else the assertion's `record_persona_id`,
else (route 1) the persona whose name matches what the assertion gives that
party, or (route 2) the `record_role` group. When no route yields a persona for
the requested party the tool says so explicitly rather than scoring something
else — that is the sanctioned `match_score: null`, not a failure.

#### What the projection admits, and why it is not the tree filter

`materializesToPersonFact` answers "may this be written onto a **tree person's**
`facts[]`". This projection answers "what identifies this **record** person".
The two part company on exactly one type — `marriage` — so the projection
declares its own predicate rather than reusing that one: `record_role: "absent"`
and `evidence_type: "negative"` never project (both lead rulings); `name`
becomes a `SimplifiedName` and `gender`/`sex` the scalar; **`marriage` is
admitted**; the three pure two-party edges and `age` are not.
`record-persona.test.ts` pins that the two still differ, so a later tidy-up
cannot quietly collapse them.

**Both halves of that were measured against the live API**
(`dev/try-same-person-project.ts`, 2026-09-21), because the first version of
this design asserted `age` and `marriage` were both discriminators — on the
reasoning that the match engine scores on document content — and was half
wrong:

| type | plausible | implausible / absent | verdict |
|---|---|---|---|
| `marriage` | 0.9480992 | 0.8032983 | **participates** — a 0.145 swing, so admitting it is worth 286 of 11,340 corpus assertions (2.5%) |
| `age` | 0.9333059 (age 42) | 0.9333059 (age 999) | **ignored** — identical on a score nowhere near saturation |

`Age` is excluded on three independent grounds, not just the null result: the
API does not read it; **0** of the 356 person-level facts on committed real
record personas are `Age`, so it has no precedent in anything FamilySearch
itself emits; and it is structurally uncomparable, because a tree person's
`facts[]` can never hold an `Age` either — which is precisely why
`materializesToPersonFact` skips it. Projecting one is payload that cannot ever
move a score.

#### No relationships on the projected route

`record_role` is an **open** enum (`^[a-z][a-z0-9_]*$`), so inferring edges from
role names is guesswork and a wrong edge scores worse than no edge. A projected
record document therefore carries `persons` only, and `matchRelatives` on that
route returns an explicit `note` rather than an empty `matches` array — the two
are not the same answer, and the existing relatives path cannot tell them apart
on its own (`gatherRelatives` tolerates a missing `relationships` and yields
nothing).

#### The tree side

`Mob.matchSubset(cap = 40)`: focus + parents + spouses + children + siblings,
carrying only the relationships whose endpoints are both inside that set. The
cap mirrors FamilySearch's own `MAX_CHILDREN_TO_COMPARE`.

**Trim order is decided here, not inherited.** The agent body says only "keep the
closest relatives (focus, parents, spouses) and trim the children/siblings" and
states no order between the two. Siblings go first: they are two hops from the
anchor (via a parent) and children are one, so this sheds the furthest kin first,
which is what "keep the closest" implies.

Not `rank-search-matches.ts`'s exported `buildSubjectDoc`, which selects a
*subject* for a many-candidate ranking fan-out and deliberately enriches it from
`research.json`; `matchSubset` selects a *mob* by relationship topology and must
stay a faithful slice of the tree, because the whole point of household
membership is that both sides compare like-for-like relatives. Not
`getRelativeMobs` either — that synthesizes one mini-document per relative for
the warning loops, where this is a single union slice.

#### Time budget

Nothing caps the arm as a whole, and that is worth knowing before raising any
piece of it. `scorePair` uses `fetchWithTimeout` at 30s (a CLAUDE.md-sanctioned
exclusion from `fetchWithRetry`, since it manages its own fan-out), while
`record_read` uses `fetchWithRetry` at 30s plus a 10s retry budget. So a fetched
`matchRelatives` call is roughly 40s of retrieval followed by up to six waves of
scoring at 30s each. The single-pair call, which is the common one, is bounded
by 40s + 30s.

#### Errors are answers

`treePersonId` absent from the tree, no persona for the requested party, an
ambiguous projected role, not a project at all: each returns an LLM-actionable
message naming what to do. `same_person` is deliberately **not** in
`tests/tools/no-project.test.ts`'s table: that table's first assertion requires
the tool to RETURN `{ ok: false, reason: "no_project" }`, and this tool returns a
score, so there is no answer shape to carry that verdict. That ruling is
about a *write* being silently dropped; here nothing is saved, the explicit arm
works anywhere, and saying so is the right answer.

### Arm B — explicit (two documents)

Four required fields: two simplified-GedcomX documents and two
in-document person IDs identifying which person in each document is
the focus of the comparison. Use it when both documents are already in hand and
there is no project to resolve against. **Nothing is recorded on this arm** — it
has neither a project nor a record identity to key an attestation on.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `gedcomx1` | `SimplifiedGedcomX` | yes | First record's full simplified-GedcomX document — exactly as the LLM received it from a prior tool call (typically `record_search`). May contain multiple persons (focus + parents + relatives). Sent as `entries[0]` to the FS API. |
| `primaryId1` | string | yes | The in-document `id` of the person in `gedcomx1` to match against (e.g. `"I1"`, `"primaryPerson"`). Must match a `persons[].id` in `gedcomx1`. |
| `gedcomx2` | `SimplifiedGedcomX` | yes | Second record's full simplified-GedcomX document. Sent as `entries[1]`. |
| `primaryId2` | string | yes | The in-document `id` of the focus person in `gedcomx2`. Must match a `persons[].id` in `gedcomx2`. |

### Why this shape?

The LLM stores simplified-GedcomX documents in its conversation context
after a search. When the user asks *"are result 1 and result 10 the same
person?"*, the LLM has both documents — it just needs to tell us **which
person in each one** is the focus. Sending `(gedcomx, id)` per side is a
**selector** pattern: the GedcomX is the document, the id picks the
person inside it.

We don't infer the primary from order (Dallan and Richard explicitly
rejected the "first person is primary" fallback in design discussion
— *"never know when they'll change it underneath"*). The id is required.

### Persistent ARKs

The simplified GedcomX should carry `persons[].ark` (the persistent FS
ARK, canonical `ark:/61903/...` form) on every person — added to the
simplifier in commit `e44a6dd`. The tool relies on this: if a person has
`ark`, `toGedcomX()` rebuilds the `identifiers["http://gedcomx.org/Persistent"]`
field, and `buildRawWithAnchor` then sets it to the **full canonical ARK
(`ark:/61903/n:n:<id>`)**. matchTwoExamples **requires** that prefix and
rejects a bare id with `400 "M2E Invalid Feed supplied"` (confirmed with FS,
2026-06-23); it does **not** require the id to be a real persona — a
well-formed but fabricated ARK is accepted. The general `toGedcomX()`
converter intentionally emits the bare id (it stays API-agnostic); this
prefix restoration is matchTwoExamples-specific and therefore lives in this
tool, not the shared converter. With a real ARK present, the FS API response
carries real ARKs instead of `MMMM-MMM` placeholders.

If the LLM's simplified GedcomX doesn't have `ark` on the primary
persons, the API response will still match (the algorithm uses
name/date/place) but `entries[].id` and `title` will contain placeholder
ARKs. The tool surfaces this faithfully — we don't error on it.

### Example

```typescript
same_person({
  gedcomx1: {
    persons: [
      {
        id: "I1",
        ark: "ark:/61903/4:1:KGS8-LY1",
        gender: "Male",
        names: [{ preferred: true, type: "BirthName",
                  given: "Johann Georg", surname: "Hufenreuter" }],
        facts: [{ type: "Birth", date: "11Jan1758",
                  place: "Biesenrode, Schsn, Prss" }],
      },
      {
        id: "I2",
        ark: "ark:/61903/4:1:KGS8-LY7",
        gender: "Male",
        names: [{ preferred: true, type: "BirthName",
                  given: "Johann Tobias", surname: "Hufenreuter" }],
        facts: [{ type: "Birth", date: "16Mar1721",
                  place: "Biesenrode, Schsn, Prss" }],
      },
    ],
    relationships: [
      { type: "ParentChild", parent: "I2", child: "I1" },
    ],
  },
  primaryId1: "I1",                            // ← match against Johann Georg, not his father
  gedcomx2: { /* analogous shape */ },
  primaryId2: "I1",
})
```

The tool does NOT take a `minConfidence` parameter. The query parameter
the upstream API exposes is a no-op — confirmed by Dallan in design
discussion: *"just min confidence and zero is just fine, just leave it
there."* (See "Out of Scope" below.)

---

## The recorded score (the attestation)

The 2026-09-07 lead ruling: *"the tool writes its score to a
project-local record keyed by (persona, tree person) — shape is the
implementer's, but the writer must be able to read it — so a `match_score` on a
link is checked against a call that happened rather than trusted."*

Written host-side by the tool that computed it, so the payload never round-trips
through the model on the legitimate path. That is what `match_score` alone never
was (ADR-0009 constraint 2). **It is not yet unforgeable.**
`guard_project_files.py`'s `PROTECTED_PROJECT_FILES` covers `research.json`,
`tree.gedcomx.json` and `starting-tree.gedcomx.json` only, so nothing stops a raw
`Write` to `results/.scores/` from inside the VM: the model cannot produce the
payload, but it can author the file. Closing that is a precondition for the
refusal step trusting this record, and it touches ADR-0005, which owns the list.

**Location: `results/.scores/<sha256(arkToBareId(record_id))>.json`, one file per
record, holding a map.** Under `results/` because architecture.md §6.1 already
carries that pattern; under a **dot-directory** because the validator's orphan
check lists `results/` non-recursively and errors on any unreferenced top-level
`*.json` — both store backends list direct children only, so a dot-directory is
invisible to it, the same trick `results/.staging/` uses. Unlike `.staging`,
nothing prunes this: an attestation outlives the session that made it. The
filename hashes the **normalised** id so the URL and bare forms of one record do
not become two files.

```json
{ "record_id": "ark:/61903/1:1:MARR-8T3",
  "scores": { "<party>|<tree_person_id>": { "record_persona_id": …, "record_role": …,
              "tree_person_id": …, "score": 0.87, "confidence": 5, "matched": true,
              "assertion_id": "a_005", "record_source": "record_read", "computed": "…" } } }
```

**Why a per-record map rather than one file per pairing.** The party component is
not stable for a single pairing: `recordPersonaId` is a caller override, and on
the fetched route the tool resolves a real `persons[].id` for a second party
whose assertion carries `record_persona_id: null`. So the identical (record,
persona, tree person) pairing would hash one way from the assertion and another
from what was resolved, and a reader computing the key from a `person_evidence`
entry's `(assertion_id, person_id)` would look under only one of them — with a
hashed filename there is no recovering the other. A per-record file is one read
and lets a reader match on persona id, on role, **or** on `tree_person_id`
alone, which is the only token both sides always have. Read-modify-write is safe
under `withProjectLock`.

**The party key is `record_persona_id` when the record named one, else
`record_role`** — and the PROJECTION groups on that same key, so the two cannot
disagree about what identifies a party. ADR-0009 constraint 3 says to key on
(`record_id`, `record_persona_id`) and not on `record_id`; the fallback exists
because that field is null on thousands of corpus links, while `record_role` is
required on every assertion.

Grouping on the role alone was the first design and it was wrong twice over: it
merges two personas sharing a role into one projected person (a transcribed
register page holds many entries at one role each), and it makes
`recordPersonaId` useless as a disambiguator, since the two people the caller is
choosing between are already collapsed by the time it is read.

Measured over **3,093** projected parties (1,330 persona-keyed, 1,763
role-keyed): **20** hold more than one distinct `name`. **14 are role-keyed and
refused** rather than scored as a merge, naming the competing values so the
agent can re-call with an explicit `recordPersonaId`; **6 are persona-keyed and
exempt**, because a group the record itself assigned one persona id to is one
person under several spellings. The tests prove both directions.

The exemption trusts the extractor's `record_persona_id`, and 2 of the 6 exempt
groups look on inspection like two people sharing one id rather than one person
under two spellings (`1:1:MPXD-MZC`: "Charlotte Spriggs" / "John W Spriggs").
That is an extraction defect this guard cannot see and does not try to.

**Why not extend `results/match-scores.jsonl`** (`rank-search-matches.ts`), which
already persists host-side scores keyed on (subject, record) and already uses the
same orphan-validator dodge: it is an append-only **calibration trail**, written
best-effort (its writer swallows its own failure so a rank call never fails),
with no persona dimension. An attestation a gate reads must be authoritative,
must not be lossy by contract, and must not require scanning an unbounded log.
Different contract, so a second artifact.

**Writing it never fails the call.** The score is the answer the agent asked for;
failing the call because the attestation could not be written would make a disk
problem look like an unscoreable identity, which is the shape this card exists to
stop producing. The result carries `recorded: true|false` so the caller knows.

**Not reachable from a feedback zip.** `apps/server/app/feedback.py`'s walker
skips dot-directories, so `results/.scores/` is excluded from every bundle;
a triager sees `match_score` values with no way to check them against the
attestation. Deliberate — the bundle is for reproducing a case, not auditing
provenance — but stated so `feedback-case-spec.md`'s consumers are not surprised.

## Output

A small object the LLM can reason over. The verbose GedcomX response
from the API is parsed and reduced.

| Field | Type | Always present? | Description |
|-------|------|-----------------|-------------|
| `matched` | boolean | yes | `true` when the API returned a `confidence` field on the entry. `false` indicates the API treated the comparison as "no real match" (confidence omitted, near-zero score). |
| `confidence` | number | only when `matched: true` | Integer 1–10. The API's coarse-bucket confidence rating. Higher is better. |
| `score` | number | yes | Float 0–1. Fine-grained match score from the API's algorithm. Near-1 means strong match; near-0 means no signal. |
| `queryArk` | string | yes | The persistent ARK of the focus person in `gedcomx1`, in canonical form (e.g. `"ark:/61903/4:1:KGS8-LY1"`). Parsed out of the API response's `title` field — see parsing rule below. Will contain a `MMMM-MMM` placeholder if the focus person in `gedcomx1` had no `ark`. |
| `candidateArk` | string | yes | The persistent ARK of the matched person in `gedcomx2`, in canonical form. Derived from `entries[0].id` in the API response (a resolver URL), normalized to `ark:/61903/...`. Will contain `MMMM-MMM` placeholder if the focus person in `gedcomx2` had no `ark`. |
| `apiTitle` | string | yes | The raw `title` field from the API response, e.g. `"Matches for ark:/61903/4:1:KGS8-LY1"`. Surfaced so the LLM can confirm which persona was treated as the query. |
| `updated` | string | yes | ISO timestamp from the API response. Useful for debugging. |

### Example output

```json
{
  "matched": true,
  "confidence": 5,
  "score": 0.99983513,
  "queryArk": "ark:/61903/4:1:KGS8-LY1",
  "candidateArk": "ark:/61903/4:1:KCWM-J9H",
  "apiTitle": "Matches for ark:/61903/4:1:KGS8-LY1",
  "updated": "2026-05-15T01:58:23.913Z"
}
```

### Non-match example

```json
{
  "matched": false,
  "score": 2.4603711e-8,
  "queryArk": "ark:/61903/4:1:KGS8-LY1",
  "candidateArk": "ark:/61903/4:1:NONMATCH",
  "apiTitle": "Matches for ark:/61903/4:1:KGS8-LY1",
  "updated": "2026-05-15T02:03:48.073Z"
}
```

Note: `confidence` is omitted. The score is essentially zero. `matched: false`.

---

## Error Handling

All errors are LLM-instruction errors (the message tells Claude what to
do next), thrown as `Error` objects.

| Condition | Throw message |
|-----------|--------------|
| No FamilySearch session (no tokens / refresh failed) | `"User is not logged in to FamilySearch. Call the login tool to authenticate."` (re-raised from `getValidToken(principal)`) |
| API returns 401 | `"FamilySearch session not accepted; call the login tool to re-authenticate."` |
| API returns 403 with Imperva body (errorCode 15) | `"FamilySearch matchTwoExamples blocked by WAF. The User-Agent header was rejected — check that the MCP server is running an unmodified build."` |
| API returns 400 with JSON body | `"FamilySearch matchTwoExamples rejected the payload: ${detail-from-body}."` |
| API returns other 4xx/5xx | `"FamilySearch matchTwoExamples API error: ${status} ${statusText}."` |
| `primaryId1` or `primaryId2` doesn't match any `persons[].id` in the corresponding GedcomX | `"same_person: primaryId \"<id>\" not found in <side>. Available ids in <side>: <comma-list>."` (lists valid options so Claude can self-correct and retry) |
| `gedcomx1` or `gedcomx2` is missing entirely | MCP schema validation rejects the call before the function runs (the four params are `required`). |
| `gedcomx1.persons` or `gedcomx2.persons` is missing or empty | **Runtime check** inside `validateInput()` — the JSON schema for `type: "object"` won't catch a missing nested array. Throws: `"same_person: <side> has no persons[] array."` |
| API returns 200 but `entries[]` is empty | Defensive sentinel — should never happen (the API always returns ≥1 entry; see Evidence Trail). Throws: `"matchTwoExamples API returned no entries[]; this is unexpected per FS behavior."` |
| `fetch()` itself fails (network) | `"Could not reach FamilySearch matchTwoExamples API: ${error.message}."` |

---

## FamilySearch matchTwoExamples API Reference

**Endpoint:**
```
POST https://www.familysearch.org/service/search/record/collections/match/matchTwoExamples
```

**Required headers:**
```
Authorization: Bearer <access token from getValidToken(principal)>
Accept: application/json
Content-Type: application/json
User-Agent: <BROWSER_USER_AGENT from src/constants.ts>
```

The `User-Agent` must be the browser-style Mozilla string (the same one
`collections_search`, `record_search`, `external_links_search`, `image_read` use). The
literal string `"fs-search-agent"` suggested in the issue triggers an
Imperva WAF block (errorCode 15).

**Query parameters:**

The endpoint accepts `?minConfidence=N` but **ignores it**. The API
normalizes to `minConfidence=0` internally regardless of value sent.
The tool omits the parameter.

**Request body shape:**

```json
{
  "entries": [
    { "content": { "gedcomx": <query-side verbose GedcomX> }},
    { "content": { "gedcomx": <candidate-side verbose GedcomX> }}
  ]
}
```

Each entry's `gedcomx` must include:
- `persons[]` with at least one person carrying `identifiers["http://gedcomx.org/Persistent"]` — required for the API to return real ARKs in the response.
- `sourceDescriptions[]` with `{ id: "<any-id>", about: "#<primary-id>" }` declaring which person is the focus. The id field is internal; only `about` matters to the API. Per the FS docs ([Person Matches by Example resource](https://www.familysearch.org/developers/docs/api/tree/Person_Matches_by_Example_resource)), this is required. The API tolerates absence (falls back to `persons[0]`) but the tool always emits it. The tool uses `id: "match-anchor"` to avoid colliding with caller-provided sourceDescription ids (see Internal Pipeline §3).
- Optionally `relationships[]` of `ParentChild` linking parent personas to the primary.

**Response shape (200 OK):**

```json
{
  "entries": [
    {
      "confidence": 5,                                      // int 1–10; OMITTED on no-match
      "id": "https://familysearch.org/ark:/61903/4:1:<CAND>",  // candidate ARK
      "score": 0.99983513                                   // float 0–1
    }
  ],
  "links": { "self": { "href": "/match-ws/match/matchTwoExamples?minConfidence=0" }},
  "results": 1,
  "title": "Matches for ark:/61903/4:1:<QUERY>",
  "updated": "2026-05-15T01:58:23.913Z"
}
```

Note: even for non-matches the API returns `results: 1` with one `entries[]`
item. The signal for "no real match" is the **absence of the `confidence`
field** on the entry, paired with a near-zero `score` (~1e-8).

---

## Internal Pipeline

The tool's `samePerson()` function:

```
input: { gedcomx1, primaryId1, gedcomx2, primaryId2 }
  │
  ├─ 1. Validate inputs:
  │     - gedcomx1 has a person with id === primaryId1; throw if not
  │     - gedcomx2 has a person with id === primaryId2; throw if not
  │     (Error messages list available IDs so Claude can self-correct.)
  │
  ├─ 2. toGedcomX(gedcomx1) → raw GedcomX for side 1
  │     toGedcomX(gedcomx2) → raw GedcomX for side 2
  │     - Simplifier handles: URI prefix re-addition, nameForms rebuild,
  │       persons[].identifiers from each persona's `ark` field
  │       (when present), and all the standard inverse mappings.
  │     - buildRawWithAnchor then rewrites each Persistent identifier to the
  │       FULL canonical ARK (`ark:/61903/n:n:<id>`) from the simplified `ark`;
  │       matchTwoExamples rejects the converter's bare id as "Invalid Feed".
  │     - We do NOT pre-structure or re-assemble the persons. Whatever
  │       was in the simplified GedcomX (focus + parents + relationships)
  │       comes through into the raw GedcomX as-is.
  │
  ├─ 3. ADD a sourceDescription to each raw GedcomX:
  │       gedcomx1Raw.sourceDescriptions = [
  │         ...(gedcomx1Raw.sourceDescriptions ?? []),
  │         { id: "match-anchor", about: "#" + primaryId1 }
  │       ];
  │     (Same for gedcomx2Raw with primaryId2.)
  │     - Appended, not replaced — preserves any existing source descriptions
  │       that came through from the simplified input (titles/citations).
  │     - Uses the id "match-anchor" rather than the conventional "mainSrc"
  │       to avoid colliding with any user-provided sourceDescription that
  │       might already use the "mainSrc" id (sourceDescriptions round-trip
  │       via the simplifier — see Evidence Trail — so we don't want to
  │       silently duplicate ids if a caller happened to name theirs mainSrc).
  │     - The id of the sourceDescription is irrelevant to FS's matching
  │       algorithm; only the `about: "#<primaryId>"` anchor matters. So
  │       "match-anchor" is just a unique-enough internal name.
  │
  ├─ 4. Build request body:
  │       { entries: [
  │         { content: { gedcomx: gedcomx1Raw } },
  │         { content: { gedcomx: gedcomx2Raw } }
  │       ] }
  │
  ├─ 5. POST to the FS URL with:
  │       Authorization: Bearer <getValidToken(principal)>
  │       User-Agent: BROWSER_USER_AGENT
  │       Accept: application/json
  │       Content-Type: application/json
  │
  ├─ 6. Defensive: if entries[] is empty, throw a sentinel error.
  │     (The API always returns at least one entry even for non-matches —
  │     see Evidence Trail. This is insurance, not expected.)
  │
  ├─ 7. Parse the response. Map to output shape:
  │     - matched = (entries[0]?.confidence !== undefined)
  │     - confidence = entries[0]?.confidence  (omitted on no-match)
  │     - score = entries[0]?.score
  │     - candidateArk = entries[0]?.id    (already a full https://...URL)
  │     - queryArk = parseArkFromTitle(title)  (see parseArk rule below)
  │     - apiTitle = title
  │     - updated = updated
  │
  └─ return: typed SamePersonResult
```

### Parsing the queryArk from `title`

The API's `title` field is shaped like `"Matches for ark:/61903/4:1:KGS8-LY1"`
— already a bare ARK string. The tool extracts that ARK directly, so
`queryArk` is in canonical `ark:/61903/...` form, consistent with
`candidateArk` (which is normalized to the same form via `toArk`):

```typescript
function parseArkFromTitle(title: string): string {
  // matches "ark:/61903/4:1:XXXX-XXXX" (placeholder MMMM-MMM included)
  const match = title.match(/ark:\/[\w/:.\-]+/);
  if (!match) return title;             // unparseable — surface raw
  return match[0];
}
```

So both `queryArk` and `candidateArk` in the output are full URLs,
or both are placeholders (with `MMMM-MMM`). Format always agrees.

### Why this is simpler than the original spec draft

Per Dallan's direction in design discussion:

> "You call Pascal's toGedcomX with both GedcomXs, they come back, and
> then you edit the GedcomX that you get back, and add in the source
> description so that it's matching the right two IDs."

We don't reassemble personas, don't construct relationships, don't
restructure the GedcomX. We take whatever the LLM has, run it through
Pascal's inverter, add one sourceDescription per side, and POST.
**Total post-processing: 4 lines per side.**

---

## Files to Create

> **These listings describe the original build, which is arm B.** They are kept
> as the implementation trail and are no longer a complete picture: arm A added
> a `SamePersonProjectInput` member to `SamePersonInput` (now a union, keyed on
> `projectPath`), `src/utils/record-persona.ts`, `src/utils/match-scores.ts` and
> `Mob.matchSubset()`. The **Input** and **The recorded score** sections above
> are the current contract; where they and a listing here disagree, they win.

### 1. `packages/engine/mcp-server/src/types/same-person.ts`

Types for tool input, tool output, and the raw API response shape.

```typescript
import type { SimplifiedGedcomX } from "./gedcomx.js";

export interface SamePersonInput {
  gedcomx1: SimplifiedGedcomX;
  primaryId1: string;
  gedcomx2: SimplifiedGedcomX;
  primaryId2: string;
}

export interface SamePersonResult {
  matched: boolean;
  confidence?: number;
  score: number;
  queryArk: string;
  candidateArk: string;
  apiTitle: string;
  updated: string;
}

// Raw upstream response shape — internal use only.
export interface SamePersonApiResponse {
  entries: Array<{
    confidence?: number;
    id: string;
    score: number;
  }>;
  links?: { self?: { href?: string } };
  results: number;
  title: string;
  updated: string;
}
```

### 2. `packages/engine/mcp-server/src/tools/same-person.ts`

The tool function + the MCP schema. Pattern mirrors `wiki-search.ts` (thin
HTTP wrapper) and `collections-search.ts` (authenticated FS service tier with
browser UA).

```typescript
import { getValidToken } from "../auth/refresh.js";
import { BROWSER_USER_AGENT } from "../constants.js";
import { toGedcomX } from "../utils/gedcomx-convert.js";
import type {
  SamePersonInput,
  SamePersonResult,
  SamePersonApiResponse,
} from "../types/same-person.js";
import type { SimplifiedGedcomX, GedcomX } from "../types/gedcomx.js";

const URL =
  "https://www.familysearch.org/service/search/record/collections/match/matchTwoExamples";

export async function samePerson(
  input: SamePersonInput,
): Promise<SamePersonResult> {
  validateInput(input);

  const token = await getValidToken(principal);
  const raw1 = buildRawWithAnchor(input.gedcomx1, input.primaryId1);
  const raw2 = buildRawWithAnchor(input.gedcomx2, input.primaryId2);

  const res = await fetch(URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent": BROWSER_USER_AGENT,
    },
    body: JSON.stringify({
      entries: [
        { content: { gedcomx: raw1 } },
        { content: { gedcomx: raw2 } },
      ],
    }),
  });

  // ⚠️  Status handling — implement per "Error Handling" table above:
  //   401 → re-login error
  //   403 with Imperva body → WAF error
  //   400 with JSON body → "rejected the payload: <detail>"
  //   other 4xx/5xx → generic upstream error
  if (!res.ok) {
    // map to LLM-instruction error per the table
  }

  const body = (await res.json()) as SamePersonApiResponse;

  // Defensive: empty entries[] shouldn't happen but guard anyway
  if (!body.entries || body.entries.length === 0) {
    throw new Error(
      "matchTwoExamples API returned no entries[]; this is unexpected per FS behavior."
    );
  }

  const entry = body.entries[0];
  return {
    matched: entry.confidence !== undefined,
    ...(entry.confidence !== undefined && { confidence: entry.confidence }),
    score: entry.score,
    queryArk: parseArkFromTitle(body.title),
    candidateArk: entry.id,
    apiTitle: body.title,
    updated: body.updated,
  };
}

function buildRawWithAnchor(
  simplified: SimplifiedGedcomX,
  primaryId: string,
): GedcomX {
  const raw = toGedcomX(simplified);
  // Append the anchor with a unique id (see Internal Pipeline §3).
  raw.sourceDescriptions = [
    ...(raw.sourceDescriptions ?? []),
    { id: "match-anchor", about: "#" + primaryId },
  ];
  return raw;
}

function validateInput(input: SamePersonInput): void {
  for (const [gedcomx, primaryId, side] of [
    [input.gedcomx1, input.primaryId1, "gedcomx1"],
    [input.gedcomx2, input.primaryId2, "gedcomx2"],
  ] as const) {
    const ids = (gedcomx?.persons ?? []).map((p) => p.id);
    if (!primaryId || !ids.includes(primaryId)) {
      throw new Error(
        `same_person: primaryId "${primaryId}" not found in ${side}. ` +
        `Available ids in ${side}: ${ids.join(", ") || "(none)"}.`
      );
    }
  }
}

export const samePersonSchema = { /* see Tool Schema section */ };
```

### 3. `packages/engine/mcp-server/dev/try-same-person.ts`

One-shot smoke test calling the function directly with the Hufenreuter
example. Mirrors `dev/try-search-familysearch-wiki.ts`.

### 4. `packages/engine/mcp-server/tests/tools/same-person.test.ts`

Matches the kebab-case source file naming (`tools/same-person.ts`).

Vitest with mocked `fetch`. Cases to cover:

- Happy path → matched=true with confidence + score + ARKs
- No-match (entries[0] has no `confidence`) → matched=false
- 401 → re-login error
- 403 with Imperva body → WAF error
- 400 with JSON detail → quote the detail
- `primaryId1` not present in `gedcomx1.persons[].id` → validation error listing available ids
- `gedcomx1.persons` is empty or missing → schema validation error
- LLM passes the wrong primaryId (e.g., parent's id instead of focus person's id) → API still returns a result, but for the wrong people. Recoverable (user notices, LLM retries with correct id).
- Focus person has no `ark` on either side → API runs, `entries[0].id` / `title` come back as `MMMM-MMM` placeholders. Surfaced faithfully in the result.

---

## Files to Modify

### `packages/engine/mcp-server/src/server.ts`

Dispatch lives in `createServer(principal)`, not in an entrypoint (`src/index.ts`
only connects the stdio transport). Three additions in the same pattern as other
tools:

1. Import: `import { samePerson, samePersonSchema } from "./tools/same-person.js";`
2. Schema in `allToolSchemas` (`src/tool-schemas.ts`).
3. `if (request.params.name === "same_person") { ... }` block in `CallToolRequestSchema`.

The arm casts `request.params.arguments` and passes it straight through, so
widening `SamePersonInput` needs no change here.

---

## Tool Schema

```typescript
export const samePersonSchema = {
  name: "same_person",
  description:
    "Ask FamilySearch whether two records describe the same person. Use this " +
    "when the user wants to verify whether two search results are duplicates " +
    "— typically after a `record_search` returned multiple records and the user picks " +
    "two to compare.\n" +
    "\n" +
    "Pass each record's full simplified-GedcomX document plus the in-document " +
    "id of the person you want to compare (e.g. \"I1\" or \"primaryPerson\"). " +
    "Each gedcomx may contain multiple persons (focus + parents); the primaryId " +
    "tells the tool which one is the focus.\n" +
    "\n" +
    "Returns a match decision with confidence (integer 1–10, omitted on " +
    "no-match) and score (float 0–1). Returns `matched: false` when the API " +
    "doesn't recognize a real match (confidence omitted, score near zero).",
  inputSchema: {
    type: "object" as const,
    properties: {
      gedcomx1: {
        type: "object",
        description:
          "First record's full simplified-GedcomX document. Pass it exactly " +
          "as received from a prior tool call (e.g. `record_search`)."
      },
      primaryId1: {
        type: "string",
        description:
          "The `id` of the person in gedcomx1 to compare (e.g. \"I1\"). Must " +
          "match a `persons[].id` in gedcomx1."
      },
      gedcomx2: {
        type: "object",
        description: "Second record's full simplified-GedcomX document."
      },
      primaryId2: {
        type: "string",
        description:
          "The `id` of the person in gedcomx2 to compare. Must match a " +
          "`persons[].id` in gedcomx2."
      },
    },
    required: ["gedcomx1", "primaryId1", "gedcomx2", "primaryId2"],
  },
};
```

---

## Patterns to Follow

- **Auth:** call `getValidToken(principal)` from `src/auth/refresh.ts`. Never read tokens directly.
- **Headers:** use `BROWSER_USER_AGENT` from `src/constants.ts`. Do not hardcode the Mozilla string.
- **HTTP errors:** map each upstream status to an LLM-instruction error message per the Error Handling table. Never surface raw HTTP errors to the LLM.
- **Simplifier:** use `toGedcomX()` from `src/utils/gedcomx-convert.ts`. Do not roll your own inflation logic.
- **Minimal post-processing:** call `toGedcomX()` on the LLM's input as-is, then append one `sourceDescription` per side anchored to the primary id. Do not restructure persons, do not add identifiers (the simplifier handles them via the `ark` field), do not normalize ids.

---

## Out of Scope for v1

- **`minConfidence` parameter.** The upstream API ignores it (normalizes to 0); exposing it would mislead the caller. Confirmed by Dallan: hardcode to 0, don't surface as a tunable. Filter client-side on `confidence`/`score` if a threshold is ever needed.
- **`date.formal` round-trip.** The simplifier intentionally drops formal dates. The algorithm uses `date.original` and doesn't need formal.
- **Multiple ARK identifiers per person.** Only the first `http://gedcomx.org/Persistent` ARK (via `persons[].ark`) is used.
- **Match against multiple candidates in one call.** The API name is `matchTwoExamples` — exactly two entries per call. Batch processing is the caller's responsibility.
- **Tree-merge use case.** The platform endpoint `api.familysearch.org/platform/tree/persons/matches` is a different operation (find merge candidates for a tree person). If we eventually want that, it's a separate tool.
- **Restructuring the input GedcomX.** The tool passes whatever the LLM provides through `toGedcomX()` unchanged. It does not re-assemble persons, build relationships, or normalize ids. If the input has parents-and-relationships, they go to the API. If it's focus-only, that goes too. The only modification is appending one `sourceDescription` for the primary anchor.
- **Deduplicating ids across `gedcomx1` and `gedcomx2`.** The two documents live in separate `entries[]` items in the API request, so they don't share an id namespace. Both sides may use `"I1"` independently with no problem. The tool does NOT rewrite ids to make them unique across sides.
- **Companion plan doc** (`docs/plan/match-two-examples-tool.md`) and **testing guide** (`docs/testing-guides/match-two-examples-tool-testing-guide.md`). Per CLAUDE.md convention these should exist alongside the tool — they'll be added during the implementation PR, not in the spec PR.

---

## Evidence Trail (live-API findings)

Behavioral claims in this spec were established by one-shot probe scripts
run against the live FamilySearch API during development. The probes were
exploration scaffolding and are not checked in (checked-in code is a
long-term maintenance burden); their findings are recorded here and
exercised by `tests/tools/same-person.test.ts`.

| Behavior | Finding |
|----------|---------|
| Canonical request recipe | The API works end-to-end with a Bearer token + browser `User-Agent` + `Accept: application/json`. |
| WAF gate | `User-Agent` is the sole WAF-deciding variable — back-to-back A/B: `fs-search-agent` → 403, Mozilla browser UA → 200 (same machine, token, second). |
| `minConfidence` query param | A no-op for N ∈ {0, 2, 5, 6, 10, 20} — every response identical. The API normalizes to `minConfidence=0` (visible in `links.self.href`). Not exposed as a tool parameter. |
| Symmetry | The algorithm is symmetric (same score either direction). Response framing follows input order: `entries[0]` is the query (referenced by `title`), `entries[1]` is the candidate (referenced by `entries[].id`). |
| Parent context | For strong-signal matches (name + date + place all match), `confidence` and `score` are identical with or without parent context. Parents likely matter more for ambiguous cases. |
| Non-match response | `confidence` is omitted; `score` is ~1e-8. The API still returns `results: 1` with placeholder behavior for the candidate `id`. Drives the `matched: boolean` derivation. |
| ARKs required for real ids | `identifiers["...Persistent"]` must be present on persons for the API response to carry real ARKs — without it the response has `MMMM-MMM` placeholders. |
| sourceDescription round-trip | `sourceDescriptions[].about: "#primaryPerson"` survives the simplifier round-trip (mapped through `sources[].url` in the simplified shape). |

---

## Open Questions (deferred to integration testing)

- **Rate limits.** Not stress-tested. Will be discovered when tool is used in real Cowork sessions.
- **Score determinism.** Observed scores vary ~0.001 between calls with the same payload (likely embedding noise upstream). Spec doesn't promise bit-exact reproducibility.
- **Sensitivity to ambiguous matches.** Strong-signal Hufenreuter case scored 0.99996 with or without parents. Behavior on common names with conflicting facts is untested; worth probing once the tool sees real usage.

---

## What changed from earlier drafts

- **Function signature redesigned per Dallan's direction** (meeting on 2026-05-17). The tool now takes `(gedcomx1, primaryId1, gedcomx2, primaryId2)` — full simplified-GedcomX documents plus selector ids — instead of the earlier `{ query: { ark, persona, parents? }, candidate: { ark, persona, parents? } }` shape. Reasons:
  - The LLM already holds simplified-GedcomX in its context from prior tool calls; making it restructure into a custom shape is unnecessary work and an error surface.
  - The id is a *selector* into a multi-person document, not a redundant copy of data. The GedcomX has multiple persons; the id picks which one is the focus.
  - "First person is primary" was explicitly rejected as a fallback (*"never know when they'll change it underneath"*).
- **Source description added by this tool, not by the simplifier.** Dallan: *"The source description, it's okay to throw that away [from the simplifier], but the ID should not be thrown away."* The tool appends `{ id: "match-anchor", about: "#<primaryId>" }` to each side's GedcomX after `toGedcomX()` (id chosen to avoid collisions — see review-round edits).
- **Identifiers/ARKs are preserved by the simplifier** as of commit `e44a6dd` (`ark` field on `SimplifiedPerson`). The tool doesn't post-process this — `toGedcomX()` puts the persona id back into `identifiers["...Persistent"]` automatically, reduced to the bare 8-character id the matchTwoExamples API wants.
- **Confirmed `minConfidence` is a no-op upstream**; not exposed as a tool parameter.
- **Confirmed non-match response shape** (`confidence` field omitted, near-zero score) — drives the `matched: boolean` derivation.
- **Tool's internal post-processing** is now ~4 lines per side: pass the simplified GedcomX through `toGedcomX()`, append one sourceDescription. No restructuring, no person assembly.

### Review-round edits (Pascal/Dallan review, 2026-05-17)

- **`queryArk` format.** Emitted in canonical `ark:/61903/...` form to match `candidateArk` (per the ID-vocabulary standard; both ARKs, no resolver-URL prefix). The `title` field is parsed with an explicit regex rule; if parsing fails, the raw title is surfaced. See "Parsing the queryArk from `title`" subsection.
- **`sourceDescription` id changed from `mainSrc` → `match-anchor`.** Avoids potential collision if the LLM's simplified input already contains a sourceDescription with id `mainSrc` (sourceDescriptions round-trip via the simplifier — see Evidence Trail). The id itself is irrelevant to FS's matching algorithm — only the `about` anchor matters.
- **Defensive empty-`entries[]` check added** to the pipeline (step 6) and error table. Should never fire (the API always returns ≥1 entry — see Evidence Trail) but cheap insurance.
- **Test file naming** uses kebab-case `same-person.test.ts` to match the source file `tools/same-person.ts`.
- **Runtime persons[] validation** clarified — the JSON schema for `type: "object"` doesn't catch a missing nested `persons[]`. Moved to runtime check inside `validateInput()` with a clear error message.
- **No id-deduplication across sides** noted in Out of Scope — each GedcomX lives in its own `entries[]` item, so `"I1"` on both sides is fine.
- **Companion plan doc + testing guide** explicitly deferred to the implementation PR per CLAUDE.md convention.
