# record-extraction — prohibition list (Step 1 of the deep-dive guide)

Built from the two files that are actually billed on every invocation, as this PR
leaves them:

- `packages/engine/plugin/skills/record-extraction/SKILL.md` (257 lines) — the router
- `packages/engine/plugin/agents/record-extractor.md` (983 lines) — the agent that
  owns extraction, classification and persistence

`skills/record-extraction/references/` ships four files —
`information-classification-at-extraction.md`, `note-taking-standards.md`,
`places-guidance.md`, `source-classification-guide.md`. **SKILL.md loads none of them
by name**, and the router is forbidden to classify anything, so their rules are not
auditable as router behaviour and are excluded below. That is worth knowing before the
next auditor spends an hour on them.

Every line below is checkable by eye against a run-log transcript
(`output.text_response`, `output.tool_calls`, `output.file_changes`,
`output.builtin_tool_calls`). Judgement calls — "was the citation well-formed", "was
the FAN lead well-argued" — are excluded; they belong to the judge, per the guide.

**Save this file. The next auditor of `record-extraction` starts here instead of
rebuilding it.**

> **Read the dating note in the findings doc before you compute any rate against
> this list.** The five committed run logs span two incompatible `evidence_type`
> doctrines (the flip landed 2026-08-21, commit `61d7f919`). A rule's line number
> below is where it sits today; several arrived mid-corpus. `git log -S'<phrase>'`
> on the two bodies is the cheap check, and it changed three of my draft findings.

---

## A. Router scope — what the skill itself may do (SKILL.md)

1. **No inline extraction.** The router never writes assertions, sources, or tree
   entries itself (:33–35).
2. **No inline classification**, and never re-derive a classification the agent
   already wrote (:36, :243–244).
3. **Never `Read` the search sidecar** `results/<log_id>.json` — pass `recordId` +
   `resultsRef` instead (:49–51).
4. **Never call `image_read`** in the router context — `@plugin:image-reader` only
   (:66–67, :245).
5. **Never call `record_person_matches` / `record_record_matches`** — relay the user's
   request as a delegation flag (:197–201).
6. **Never `record_read` a record already read this session** (:58–59).
7. **Never write `research.json` or `tree.gedcomx.json` directly** (:237–239).
8. **No searching** (:246–247) and **no citation polishing** (:248–249).

## B. Router — image handling (SKILL.md)

9. When the user supplies an image ARK or asks you to pull it up, **the
   `@plugin:image-reader` delegation MUST be made** — even if you suspect the scan is
   unreachable. Reporting "image unreachable" with no delegation attempt is a
   completeness failure (:74–80).
10. **One image per `@plugin:image-reader` invocation** (:68).
11. **Pass `project_path` in the image delegation**, and set the source's
    `image_filename` to the returned path alongside `transcription` (:100–106).
12. **`looking_for` is a search key, never the expected answer** — "the christening
    entry for a Christina born ~Jan 1783", never "confirm the father is Adam Schreck"
    (:89–93).
13. `@plugin:image-reader-opus` only when there is a real reason to expect a better
    read — **never as the default** (:85–87).
14. On `NOT READ`: never fill the gap with an assumed reading, never retry the image
    (unless the cause is a missing OpenRouter key), and **never try a browser, "Claude
    in Chrome", or `web_fetch`** (:112–118).
15. A **required identifying name flagged as suspect is not confirmed by the index
    alone** — route to the register image (`volume_search` + `@plugin:image-reader`)
    *before* it is recorded as established; the `[?]`-tentative path is the fallback
    for when the image is unreachable, not the first move (:126–138).

## C. Router — logging and delegation (SKILL.md)

16. **Log only when no search skill already logged this search** — never a second
    entry for the same search (:142–144).
17. **Never hand-write a `results/<log_id>.json`** for a `record_read`-fetched record
    (:152–155).
18. **Never modify an existing log entry** — the log is append-only (:255–257).
19. **One `@plugin:record-extractor` invocation per record**, each carrying its own
    content (:162, :189).
20. The delegation carries `projectPath`, `recordId`, the record content **or** the
    `resultsRef`, `logId`, and the open question ids it bears on (:166–172).
21. **Never frame a delegation as "fix" or "correct" the existing tree** — corrective
    framing has induced destructive edits (:177–179).
22. **Never instruct the agent to create `person_evidence` links or to assign an
    identity confidence** (:181–187).
23. A classification-refinement request is **delegated per record**, never answered
    inline (:203–208).

## D. Router — presentation and continuation (SKILL.md)

24. Relay the agent's compact summary — source id, assertion counts, tree changes, key
    findings, next step. **Do not re-print per-assertion detail** (:212–215).
25. **Keep going in the same turn.** Presenting a summary and yielding with records
    still unextracted is a failure (:217–221).
26. **Exception:** on a `record-extractor` spawn failure, report and stop — do not
    extract the record yourself or retry another way (:223–226).

## E. Agent — reads and calls (record-extractor.md)

27. **Exactly ONE `project_context` call, up front** (:110).
28. **Never read `research.json`, `tree.gedcomx.json`, or the sidecars** (:118–119).
29. **Never read a record twice in one invocation**, and never open a sidecar file
    (:106–108).
30. **ONE `extraction_append` call per record** (:802 heading, :818).
31. **Call the tool before narrating** — the transcript must show the actual
    invocation, not text claiming it (:804–805).
32. **Never predict an id**; never `tree_edit` the source; never write the project
    files directly (:831–835).
33. **Always supply `sourceDescription`; never pre-check for source reuse yourself**
    (:836–841).
34. On `{ ok: false }`: fix **only** the ops named in `errors`, check `opsReceived`
    against the count sent, resubmit the whole batch. Never retry blindly, never drop
    unnamed ops (:843–847).
35. **No post-write re-validation** — do not re-read the files to sanity-check a
    success (:857–859).
36. **Cannot write `person_evidence`** — not even if the delegation asks. Identity
    assessments go in the return summary (:861–873).
37. Match tools take **exactly `{ id }`** — no `recordId`, no `personaId`, no ARK URL
    wrapper — and their results are **informational only**, never persisted or logged
    (:934–945).
38. Re-invocation refines via `update` ops by `a_` id — **never a second assertion for
    the same fact** (:947–964).
39. **Return ≤10 lines.** No per-assertion tables, per-field walkthroughs, or
    classification rationale; no closing essay (:966–983).

## F. Agent — the source entry

40. `source_classification` ∈ `original` | `derivative` | `authored` — closed set
    (:148–149).
41. A roster or listing pasted with **no accompanying image** is FamilySearch's indexed
    transcription: `derivative` (:154–156).
42. A contemporaneous **death certificate** (or its image) is `original`; the
    informant's secondhand knowledge is recorded at the information/evidence layers,
    **never by demoting the source layer** (:156–161).
43. Source fields are a closed set. `record_id` is an assertion field, not a source
    field; `record_type` is not a field at all (:168–177).
44. `access_date` / `when_accessed` are the **real** access date in ISO `YYYY-MM-DD` —
    never a placeholder, a raw timestamp, or the record's publication date (:178–181).
45. **"Original not examined" is decided now, not later:** `derivative` +
    a `notes` line naming the reason + a statement in the return summary (:184–192).

## G. Agent — roles (Step 2)

46. Negative evidence uses the **exact literal string `absent`** — never
    `subject_absent`, `not_listed`, `missing` (:200–203).
47. **Number roles sequentially** — `{role}_{n}` (:199–200). A bare `child` /
    `daughter` / `father` / `informant` alongside numbered siblings is off-convention.
48. A differently-surnamed household head is a **FAN lead, not noise**; never assert a
    specific relationship without evidence; never default to "boardinghouse"
    (:204–212).
49. **`record_role` = apparent within-group structure, not raw position after the
    head.** Don't number everyone after the head `child_1, child_2, …`; an adult too
    old to be the head's child isn't `child_N` of that head; a co-resident family keeps
    its own `head`/`wife`/`child_N`; an unknown tie to the head is labelled by the
    person's own role (:219–226).
50. **Obituary parenthetical**: `given (maiden surname) married surname` is **one**
    person; `given (spouse) surname` is **two**. A child's spouse is
    `son_in_law_N`/`daughter_in_law_N`, **never `child_N`** — and the actual child is
    still captured (:227–246).
51. Obituary neighbours, friends, pallbearers, caregivers are FAN associates — **never
    roled as kin** without a stated relationship (:244–246).
52. **Marriage**: a `marital_status` assertion per party whenever the record designates
    one; the consent signer is `consent_signer_1` with a mandatory `name`; **never
    assert `father_of_bride`/`father_of_groom` from a consent signature alone**
    (:248–265).
53. A missing consent signature is **absence of evidence** (`record_role: "absent"`) —
    never read as evidence that the parents shared the party's surname (:266–269).
54. Extract facts relevant to any open question plus identifying facts for anyone who
    might be the subject or a FAN associate; **skip unrelated individuals** (:271–274).
55. **The `name` assertion is mandatory for every person the record names**, and comes
    first. A parent with a birthplace and no name is an incomplete extraction; on a
    death certificate the named father and mother EACH get `name` and (if stated)
    `birth`+`place` (:276–287).
56. **Blank columns produce no assertions** — not a positive one, and **not** a
    `"No X recorded"` negative (:289–305).

## H. Agent — assertion shape (Step 3)

57. **One fact per assertion.** Never combine age with a birth claim (:306–311).
58. A birthplace is a `birth` assertion with `place` set — **there is no `birthplace`
    or `deathplace` fact type** (:311–315).
59. When date and place carry **different** classifications they split into two
    assertions of the same `fact_type`, told apart by which field is populated
    (:317–326).
60. **A birth computed from a stated age is an approximate YEAR (`~1845`), never an
    exact date** — even when the record gives years/months/days (:328–333).
61. Assertion fields are a closed set; **`notes` is a source field, not an assertion
    field** (:335–345).
62. `date_certainty` ∈ `exact` | `approximate` | `estimated` | `calculated` | `before`
    | `after` | `between` — not `certain`, `about`, `circa` (:347–349).
63. **Same `record_id` on every assertion from one record** — copy the caller's
    `recordId` (:351–356).
64. A third party named inside a party's block gets **their own** role
    (`father_of_groom`, `mother_of_deceased`), never the party's (:362–371).
65. **A `name` value is the bare name** — `John Becker`, never
    `John Becker (father of Frank Becker)` (:369–371).
66. `record_persona_id` on **every** assertion including the focus persona when the
    delegation gave a `resultsRef`; **omitted on every assertion** when it did not —
    keyed on the `resultsRef`, never on whether the content carries persona ids
    (:373–389).
67. **`value` is what the record says, one fact, no reasoning prose** — justification
    goes in `informant_bias_notes` (:391–395).
68. **One parent per relationship assertion** — `child of Thomas Flynn` and `child of
    Bridget Flynn` are two entries (:395–402).
69. A relationship assertion is written **only where the record states the
    relationship** (:402–404).
70. Event place and date go in the **`place` and `date` fields**, not just `value`
    (:406–411).
71. **Never write an `_inferred` `relationship_type`** (`child_inferred`,
    `spouse_inferred`) (:417–422).
72. **A `sex` assertion for EVERY persona whose sex the record states** — subject and
    every co-resident, not the head or searched persona alone (:424–442).
73. **Leave `standard_place` out** unless you already hold the correct standard form;
    sanity-check the echoed `resolvedPlaces` (:444–449).

## I. Agent — information quality and informant (Layer 2)

74. `information_quality` ∈ `primary` | `secondary` | `indeterminate` (:453–454).
75. **A person cannot provide primary information about their own birth** (:464–465).
76. **Delayed birth certificates are `secondary`** on an `original` source (:466–467).
77. **Pre-1940 census: the respondent is unknown → `indeterminate`**, including the
    subject's own age. Do NOT mark it `secondary` on can't-witness-own-birth reasoning.
    Exception: a fact no household respondent could have witnessed — a parent's or
    grandparent's birthplace — is `secondary` (:468–474).
78. **Census residence is the exception**: `informant: census enumerator`, proximity
    `witness`, quality `primary` (:475–482).
79. `informant` and `informant_proximity` are **required on every assertion**;
    proximity ∈ `self` | `witness` | `household_member` | `family_not_present` |
    `researcher` | `official_duty` | `unknown` — **there is no `analyst` or
    `inferred_from_structure`** (:484–490).
80. **Indexers and transcribers are never the informant** (:491–493).
81. **A derivative does not erase the informant — look THROUGH it.** `unknown` is never
    a conclusion drawn from the source being an index or a transcript; "unknown
    *through* this derivative" is the error by name (:495–506).
82. **Never name the clerk / recorder / officiant / enumerator as the informant for a
    party's or a witness's own biographical facts** (:508–520).
83. **A negative assertion always takes `informant: "the researcher"` +
    `informant_proximity: "researcher"`** — whatever the record type; the census
    table's `witness`/`household_member` rows never apply to one (:533–537).
84. **On a census a stated fact is `household_member`, not `self`** — the "(likely self
    or spouse)" note is not a licence for `self` (:539–552).
85. **Death certificate — attending physician** is informant for death date, place,
    cause and duration, at `official_duty`; **duration of last illness folds into the
    `cause_of_death` value**, never a second assertion and never the family informant
    (:562–570).
86. **Death certificate — personal informant** carries the decedent's biography (name,
    age, birth date/place, parents' names, occupation, marital status) **ALL at
    `family_not_present`**; none of those rows is upgraded to `witness` (:571–578).
87. **Death certificate — funeral director** is scoped to a certificate that names one.
    A burial or cemetery index names no informant: `unknown` / `unknown`, never the
    compiler or the cemetery (:592–595).
88. **Marriage — the parties are `self`** for their own facts and for the marriage
    event; the officiant and clerk are recorders and take no `official_duty` here
    (:597–616).
89. **Marriage — a stated parent name is `primary` quality and `direct` evidence** —
    death-certificate secondhand-relay doctrine does not transfer (:602–612).
90. **Place is the locality, not the venue** — a church/cemetery/hospital name stays in
    `value`; this applies to every record type (:617–620).
91. **A witness attests at `witness`, never `self`** (:621–625).
92. **Christening**: the presenting parent is `household_member`; the officiant is
    informant only for the event itself at `official_duty`; the child is never `self`
    (:627–639).

## J. Agent — evidence type (Layer 3)

93. `evidence_type` ∈ `direct` | `indirect` | `negative` — **there is no
    `no_evidence`** (:644–647).
94. **A stated residence is `direct`**, never downgraded (:649–652).
95. **`evidence_type` is stated-vs-inferred, and there is no exception.** Nothing about
    the informant and nothing about the source's remove can change it. **The one test:
    was this value in a field on the record?** (:657–672).
96. **A pre-1880 census yields ZERO relationship assertions** — no parent-child, no
    spousal, including `head_of_household`↔`wife`, **even when the gedcomx carries a
    `ParentChild` or `Couple` edge**. Not `indirect`, not `_inferred`: no assertion,
    plus a note in the summary (:707–718).
97. From **1880** on the relationship column makes the relationship stated → `direct`,
    written with a bare `relationship_type` (:720–723).
98. **The record subject's `name` assertion stays `direct`**; a null `place` on it is
    expected and is never grounds to demote it (:725–731).
99. **A third party named by an informant is still `direct`** — parents in the
    `Father's name` / `Mother's maiden name` fields, on a death certificate and a
    burial register alike (:735–743).
100. **Shared-informant units** (same informant across assertions, even across sources)
     are noted in `informant_bias_notes` and flagged in the return summary (:751–757).
101. An identity conclusion resting on **one uncorroborated record** is **tentative at
     most**; a caller's stated doubt about a required identifier **is** a `[?]`, and the
     doubt lives at the information/source layers — **never** in `evidence_type`
     (:759–790).

## K. Agent — negative evidence

102. A negative assertion is `record_role: "absent"` + `evidence_type: "negative"`,
     `informant: "the researcher"` / `researcher`, with an
     `informant_bias_notes` that names the alternative explanations (:877–890).
103. `value` is the **expected-but-missing fact naming the person** — never blank,
     never just "absent" (:883–886).
104. Only when the absence is **analytically significant** — not for every nil result
     (:892–894).
105. **Negative evidence is about a PERSON expected-but-absent, never a blank FIELD on a
     person who is present.** Never manufacture a `"No middle name recorded"` /
     `"No X on this certificate"` negative for an unrecorded optional field
     (:896–905).
106. A person who **predeceased** the subject still takes the literal `record_role:
     "absent"` — not their familial role — even though they are named in the text
     (:907–917).
107. **Multi-person negative evidence is one assertion per person**, each `value`
     naming that specific person; never a shared generic value distinguished only by
     `record_role` (which is `"absent"` on all of them) (:919–932).

---

## What this list deliberately leaves out

- **Anything about the delegation message's contents (items 20–22).** The unit run
  logs truncate `builtin_tool_calls[].args` at **200 characters**, so the delegation
  body is not readable from a committed log. Those three prohibitions are on the list
  because they are real rules, not because they are auditable today — see finding F9.
- Citation wording, FAN-lead argument quality, summary phrasing: judge territory.
- `references/` rules, for the reason given at the top.
