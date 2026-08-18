# Simpson Ridley Stribling — parents, behind a stepfather's guardianship (1820s Mississippi)

**Source PID:** `KLYT-G3Q`
**Simpson Ridley Stribling is deceased.** (Born 15 July 1821, Amite County,
Mississippi; died 5 October 1888, Simmesport, Avoyelles Parish, Louisiana.
FamilySearch ToS requires all committed e2e fixtures to be about deceased persons.)

## Research question

> Who were the parents of Simpson Ridley Stribling, born 15 July 1821 in Amite
> County, Mississippi?

## Why this fixture exists

Filed as issue #1413, from an alpha report: *"Claude might need more help with the
issue of guardianship as it pertains to actual parents being named guardian of their
own children."* In the reported run the agent met this same family, read the mismatch
between the guardian's surname and the tree's "McDowell" as a **surname conflict**,
and never considered a second marriage.

The craft point: **a guardianship appointment is not evidence that the child was
orphaned of both parents or unrelated to the guardian.** When a man is appointed
guardian of children bearing a different surname shortly after his marriage to a
woman connected to that surname, the leading hypothesis is that they are her children
by a prior marriage and he is their stepfather. The differing surname is the expected
pattern, not a conflict.

The plugin already carries the vocabulary — `tree-edit`'s
`references/relationship-accuracy.md` defines Step / Foster / "Other guardianship"
and tells the skill to record a relationship without asserting a type when the type
is unknown — and `historical-context`'s `references/historical-terminology.md` makes
the same infer-a-remarriage move for pre-1900 "in-law" wording. What no prose names
is this trigger. This fixture measures whether the agent gets there anyway.

## The case

- **Taliaferro Stribling** (`L6Q3-4XX`, b. 1781 Wilkes Co, GA) married **Margaret
  "Peggy" McDowell** (`LZ64-KT8`) in Amite County, Mississippi on **1 March 1815**,
  and died there in **1823**, leaving four minor sons: James, John H., Seaborn, and
  Simpson **Ridley** — the subject.
- Margaret remarried **Gideon B. Sleeper** (`LHJL-3YG`) on **23 November 1824** at
  Liberty, Amite County.
- **24 May 1825** — six months after the wedding — Sleeper posted a $1,600 bond in
  the Amite County Orphans' Court as *"guardian to James, John, Seaborn and Ridley
  Stribling of Amite County"*, with Edmund Jenkins and John H. Corbell as sureties,
  and filed an inventory of the four minors' property (~$204 each). Full-text image
  `ark:/61903/3:1:3QS7-89QX-2C5P`.

## What was removed from the starting tree

- Removed person L6Q3-4XX: Taliaferro Stribling
- Removed person LZ64-KT8: Margaret McDowell
- Removed relationship R3 (Couple L6Q3-4XX/LZ64-KT8): cascaded from a removed person
- Removed relationship R4 (ParentChild L6Q3-4XX/KLYT-G3Q): cascaded from a removed person
- Removed relationship R5 (ParentChild LZ64-KT8/KLYT-G3Q): cascaded from a removed person

No sources were stripped: the subject's own sources are the only ones a one-hop
snapshot returns, and none names a parent (read by hand at authoring time).

**Stripping the mother as well as the father is deliberate**, and it is what makes
this fixture measure the inference rather than recall. With the mother retained,
"father = Taliaferro" and the 1815 marriage both fall out of a single indexed
marriage search keyed on her surname, and an agent could pass without ever opening
the guardianship record. With her removed there is no surname key into that marriage,
so the 1825 bond is the natural entry into the family.

**Kept as anchors:** the subject's birth (15 July 1821, Amite County — the tie to the
1825 bond), death, burial, occupation (bank president and member of the Texas
legislature at Graham, Texas), his 1880 Avoyelles Parish residence, both wives, his
children, and his own sources.

**Gideon Sleeper was never in the snapshot.** `snapshot` is one
`person_read --relatives --sources` (`eval/harness/e2e/author.py:758`), so the tree
reaches one hop from the subject; the `Couple(LZ64-KT8, LHJL-3YG)` edge naming the
1824 marriage is dropped as a dangling endpoint by `normalize_tree`
(`author.py:295-297`). He is discovered from the record or not at all.

## Expected findings

Four, all `recover`, all `required`:

- **f1** — father = Taliaferro Stribling (1781 Wilkes GA – 1823 Amite MS).
- **f2** — mother = Margaret "Peggy" McDowell (1793 Milledgeville GA – 1864 Amite MS).
- **f3** — the parents' marriage, 1 March 1815, Amite County. The date sits on the
  couple link, so it scores as a `link` component (spec §3.4.2).
- **f4** — an Amite County orphans'-court guardianship record attached as a **source**.
  **Either** the 24 May 1825 bond (Gideon Sleeper, the stepfather, as guardian —
  `3QS7-89QX-2C5P`) **or** the 1823 bond (the widowed mother Margaret as guardian —
  `3QS7-L9QX-2H77`) satisfies it.

**f4 is the discriminator.** It cannot be satisfied without reading a guardianship
record: an agent that never engages the guardianship fails it, and an agent that
engages it and dismisses the Stribling / Sleeper / McDowell surname spread as a
conflict does not attach it and fails it too. f1–f3 measure recall; f4 measures
whether the record class that carries the inference was actually used.

**Why either bond counts.** #1413's report is about *"actual parents being named
guardian of their own children"* as well as stepfathers, and this family supplies both:
the mother is guardian in 1823, the stepfather in 1825. Requiring one specific image
marked a run `false` that had engaged the guardianship correctly through the other —
see the 2026-08-17 changelog entry. The finding names the record *class* for that
reason. It is still not satisfiable by reaching the parentage some other way and
skipping the guardianship, which is the discrimination it exists for.

## Expected difficulty

**hard** — the answer is indirect and both parents are gone. The agent has to (a)
find the 1825 guardianship bond, (b) resist reading the Stribling / Sleeper surname
difference as a conflict, (c) infer the mother's earlier marriage from the guardian's
appointment date, and (d) find that marriage indexed under **"Taliafero Stribbling"**
and **"Peggy McDowell"** — neither name spelled as the tree has it.

### This is an indirect-evidence fixture, and that creates two distinct failures

**No record read here states the wards' parentage.** The bond names four minors and
their guardian and names no deceased parent; the 1815 marriage names a couple; the 1823
administration names an estate. The parentage is reached only by correlating them — the
guardian married the widow, the four wards hold equal shares of one estate, the
marriage predates the eldest ward. The conclusion is attainable at **Probable**, and
tree encoding is gated at Probable or better, so a correct run can and should write it.

That means a failed run can fail in two ways that look alike in the verdict and are
nothing alike in cause:

1. **It never assembled the evidence** — missed the bond, or the marriage, or both.
2. **It assembled the evidence and declined to conclude** — held the parentage at
   `speculative` or `possible` and left the tree's parentage slot empty on the grounds
   that no record states it outright.

Read `narration[]` and `research.json`'s hypotheses before attributing a `fail`. The
second failure is a calibration problem — an agent unwilling to conclude from
correlated indirect evidence — and it is arguably a *worse* result than the first,
because everything except the judgement was right. Reporting it as "couldn't find the
records" would be wrong.

## Notes for reviewers

- **Route to the bond:** `fulltext_search` with `+Sleeper +guardian +Stribling`,
  **unfiltered**. Adding `recordPlace1` / `recordPlace2` / `yearFrom`+`yearTo`
  returns **0 results** for this document, because those filters match collection
  metadata rather than the transcript. If a run's `tool_calls[]` shows a filtered
  full-text search returning empty, that is the tool filter, not an absent record —
  do not read it as "the agent searched and found nothing".
- **Route to the marriage:** `record_search` in *Mississippi, Marriages, 1800-1911*
  (collection `1680835`) → `ark:/61903/1:1:V2ZN-9MN`. Verified reachable before
  authoring; no `provided-documents/` needed and no route runs through the blocked
  tree tools (spec §6.1).
- **Expect two WARNs from the stripping linter, both on f4, and only f4.** Its
  `details.target_person` is the retained subject — the person the source hangs on,
  following `anders-monsen-ancestry` f2's shape — and only `subject_person` /
  `subject` keys are pruned before tokenising
  (`eval/harness/e2e/validate_fixture.py:155-191`), so `target_person` is collected
  and its bag `{simpson, ridley, stribling}` matches two retained persons on both name
  halves: the subject `KLYT-G3Q`, and his son `KPHL-7TZ` **"Ridley Lucian Stribling"**
  (on `ridley` + `stribling`). Both are retained descendants, not leftover answers —
  f4's answer is the bond *source*, which the linter cannot see. Warn-only, and the
  precedent's shape is worth the noise. f1–f3 should be silent. A WARN on any other
  finding, or on any person other than `KLYT-G3Q` / `KPHL-7TZ`, is a real signal.
- **Two Ridley Striblings are in the retained tree** — the subject Simpson **Ridley**
  Stribling (b. 15 July 1821, Amite County) and his son **Ridley** Lucian Stribling
  (`KPHL-7TZ`, b. 1861, Louisiana). The 1825 guardianship bond's "Ridley Stribling"
  is unambiguously the **subject** on date: the son was not born for another three
  decades. This is a mild in-tree name collision the agent has to keep straight, and
  it is the reason for the second f4 linter WARN above.
- **f4 is graded by ARK/title match, and it accepts two ARKs.** The `anders` run log's
  `agent_evidence` shows the judge walking the final tree's `sources` array for an
  entry matching `details.source_url` / `source_title`. f4 carries the 1825 bond as
  `source_url` and the 1823 bond as `source_url_alternate`, with a generic
  `source_title` naming the record class; the description states plainly that either
  satisfies it. **Grade by the description, not by the URL field**, and if a run
  attaches a *neighbouring image* of either bond — the Amite volume holds the bond,
  the inventory and the sureties' acknowledgements at images 725, 788, 789, 860 and
  861 of 891 — that is the same record and should be annotated `true` against a judge
  `false`. This wording exists because the first scored run was marked `false` for
  attaching the 1823 bond instead of the 1825 one, having engaged the guardianship
  correctly.
- **The linter cannot see sources at all.** `index_tree` walks `persons` and
  `relationships` only (`validate_fixture.py:109-138`), so a source that names the
  answer prints `OK`. The subject's own sources were read by hand at authoring time;
  none names a parent.
- **f4 has no deterministic backstop.** Component derivation is scoped to
  `relationship` findings (spec §3.4.2) and `apply_avoid_guard` to `avoid` findings
  (§3.4.1), so f4's label is the model judge's unaided call on final-tree presence
  (§7.1). Precedent that this grades correctly: `anders-monsen-ancestry` f2, a
  required source finding that graded `false`, was agreed by its human annotation,
  and failed its run.
- **No finding names Gideon Sleeper as stepfather, and no `avoid` finding exists.**
  The first is inadmissible — `presence_mirror` (`author.py:1259-1297`) hard-fails a
  non-`avoid` finding naming somebody absent from the unstripped tree, and Gideon is
  two hops out; `required: false` is not an exemption (`author.py:1276`). The second
  would be self-defeating — `apply_avoid_guard` (`judge.py:406-445`) exempts only the
  fixture's own subject ids, so "must not conclude Gideon was the father" would
  force-fail any run that correctly added Gideon as the mother's second husband. f4
  reaches the same inference through the record instead.
- The subject's own sources are mostly his *children's* Texas and Louisiana death
  certificates, where he appears as the parent. None names a parent of his; his
  parentage was unsourced in the FamilySearch tree at capture.

## Observed behaviour — first live debug run, 2026-08-14

An interrupted `/research` run in Cowork: 26 searches, 58 assertions, six sources
attached to the tree, and no `person_evidence` written before the machine went down.
Read these before attributing a failed headless run.

- **The bond does not name the father.** It names the four minors and the guardian, and
  credits each minor an identical **$204.31½**. So f1 and f2 are *not* recoverable from
  f4's record alone — the inference needs the bond **plus** the 1 March 1815 marriage
  (`ark:/61903/1:1:V2ZN-9MN`) and the 1823 estate administration. The equal
  quarter-shares are themselves corroboration: one father's estate divided among four
  children, not a mixed-generation group.
- **Several documents in collection `M9J1-33W` are titled "Amite, Mississippi, United
  States Probate 1825" — only one is the bond.** The bond is **image 725**,
  `ark:/61903/3:1:3QS7-89QX-2C5P` (f4's `source_url`); **image 700**,
  `ark:/61903/3:1:3QS7-L9QX-2CC4`, is an estate page whose transcript is headed by a
  different decedent entirely and states no Stribling role. The debug run attached image
  700, concluded "there is no guardianship bond — no party's role could be read", and
  built its whole analysis on that. **f4 would grade `false` on that run, correctly**, but
  a grader must check *which* ark was attached before calling f4 a judge error: attaching
  the neighbouring page is a real failure to read the bond, not a matching artefact.
- **The 1836 conveyance looks like a distractor and is actually the disambiguator** —
  once its full party list is read. Full-text search surfaces an 1836 Amite deed in which
  a "Ridley Stribling" appears among the grantors; conveying land implies legal majority
  and the subject was 15 in 1836, which tempts the reconstruction *"Taliaferro is the
  grandfather, an adult Ridley is the father"*. The debug run took exactly that path. The
  rest of the same deed dissolves it: the grantors also include **Gideon Sleeper** and
  **"W. Margarett Gardner"**, and the grantee is **Thomas McDowell**. Sleeper is there
  because a guardian conveys estate land on his wards' behalf — so the deed does *not*
  require the four sons to be of age. Margaret Gardner is Taliaferro's daughter by his
  first wife Lettice Sudduth (m. William Henry Gardner, 1828), conveying in her own right
  beside her husband. Read whole, the deed is Taliaferro's heirs selling his land to a
  McDowell kinsman, with the minors represented by their stepfather-guardian — coherent
  with the 1825 bond and needing no extra generation. If a run concludes a grandfather,
  check two things: whether it read the deed's *full* party list, and whether it ever ran
  a plain **indexed marriage search**. The debug run did neither.
- **Observed failure mode: census-and-full-text tunnel vision.** The run opened on the
  1830/1840 census household, which cannot work — the household head in those years is
  **Sleeper**, not Stribling, the fixture's surname trap firing as designed — then went
  deep on full-text for another dozen searches and never ran `record_search` against
  Mississippi marriages. It documented its nils well (an index-coverage control plus an
  independent Ancestry cross-check) and still missed the one indexed record that
  settles the question.
- **The filtered-`fulltext_search` dead end fired for real.** Three consecutive searches
  ran `+Stribling` with `recordPlace1` / `recordPlace2` set and returned nothing before
  an unfiltered attempt succeeded — the trap named in the first reviewer note above,
  observed rather than predicted.
- **Reading the images needs `image_transcribe`, which needs an OpenRouter key — and that
  key is on the critical path to a *pass*, not just to thoroughness.** The bond page is
  **897 KB**, over `image_read`'s inline cap, so `image_read` refuses it and the only route
  is `image_transcribe` (host-side OCR, no size limit). In the debug run every image load
  failed and all five Amite sources were flagged `ORIGINAL NOT EXAMINED`, yet the same ARK
  transcribes cleanly from a session with a key configured — an environment gap, not an
  unreadable record. Why it decides the verdict rather than merely degrading it: the 1836
  conveyance produces an unresolved conflict (below) that caps the proof tier at
  `possible`, `possible` is beneath the `probable` tree-write gate, and resolving that
  conflict means reading the deed image. **Without a key, a correctly-behaving agent
  cannot reach a tree write at all, and f1–f3 are unreachable by construction.** Verify
  `configure_openrouter` before starting a scored run, or the result is predetermined.
- **`a_046` — "Taliafer Stribling" among the 1836 grantors — is the binding constraint,
  and there is a third reading the debug run didn't consider.** The conclusion needs
  Taliaferro dead c. 1822–23; a living Taliaferro conveying in 1836 would dismantle the
  widow-remarries-guardian sequence, so it disputes the concluded relationship itself and
  caps the tier at `possible` (correctly — the run's tier reasoning is sound). Beyond
  mistranscription and son-named-for-father, the likeliest reading is that **an heirs'
  deed recites the decedent's name as the source of title** — "land whereof Taliaferro
  Stribling died seised", "granted to Taliaferro Stribling, deceased" — a recital that
  sits in the same region of the text as the party list, which is exactly how an extractor
  codes it as `grantor_5`. Under that reading `a_046` corroborates the conclusion instead
  of contradicting it. It is adjudicated by reading `ark:/61903/3:1:3Q9M-CS4T-KT54` and
  seeing whether Taliaferro appears in a granting clause or a recital. A run that resolves
  `a_046` this way and then encodes is behaving correctly; a run that adopts the reading
  *without* reading the image is explaining a conflict away, and should be graded as such.
- **A correct run can stall at `possible` and encode nothing.** The debug run wrote a
  tier-`possible` proof argument and declined to write the tree, because `possible` is
  below the encoding gate and `a_046` was unresolved. That is the skill behaving to
  contract, not timidity — so a `fail` on f1–f3 does **not** by itself mean poor
  reasoning. Check the proof summary's tier and its stated blocker before attributing
  the failure.
- **Where it stalls is the identification, not the search.** Resumed, the run created
  sourced stubs for Taliaferro, Margaret, Gideon Sleeper and the four minors — and linked
  **none** of them: 23 persons, still only the 29 relationships the starting tree shipped
  with. It also minted the bond's "Ridley Stribling" as a person *separate* from the
  subject. Without that identification the parents cannot attach, so **all four findings
  would grade `false`** — f1–f3 for want of a link (relationship findings score on `link`
  components only, §3.4.2) and f4 for the wrong ark. This is the failure this fixture
  exists to catch: the records are in hand and the inference from guardianship to
  parentage is never made. It is also the e2e guide's named trap — a conclusion recorded
  in `research.json` and not in the tree is an agent failure, not a judge miss.
- **Depth warning: this may be more than one capped run can finish.** The debug run spent
  30-odd searches, ~95 assertions and six skills — *with* the bond ark, its transcript, the
  deed's party list and the marriage search all handed to it — and still ended one conflict
  resolution and one unsearched record series short of the encoding gate. An unnudged
  headless run has less runway than that inside the wall-clock, tool and cost caps. If a
  scored run stops at `natural_end` or a cap with the research substantially right, the
  honest options are raising the wall-clock cap (`hole-parents-negative` sets
  `caps.wall_clock_seconds: 5400`, though spec §3.1 says `caps` is not a fixture field —
  resolve that before copying it) or restoring the mother to the starting tree, which
  re-opens the discrimination problem R1 was designed to close. Decide that on a run log,
  not on this note.

## Changelog

- **2026-08-14** — fixture authored (#1413). Design adjudicated to "strip both
  parents + score the guardianship bond as a source" after `/critique-plan` round two
  showed that retaining the mother let an agent recover the answer without ever
  reading the bond. Guardianship bond, 1815 marriage index entry, and 1823 estate
  administration all confirmed reachable with the tools a run allows.
- **2026-08-17** — first live debug run recorded (§Observed behaviour). The fixture
  discriminates as designed: the surname trap and the filtered-full-text dead end both
  fired, and the run reached the 1824 Sleeper marriage, the 1823 estate and the Amite
  probate volume — but **not the bond itself**, attaching the neighbouring image 700
  instead of image 725 and concluding from that page that no guardianship document
  existed. It then built a "Taliaferro as grandfather" reconstruction off a single
  machine-transcribed 1836 deed role, without reading the deed's full party list and
  without ever running an indexed marriage search. It created all seven relevant persons
  as sourced stubs and linked none of them, minting the bond's "Ridley Stribling"
  separately from the subject. All four findings would grade `false`. No fixture files
  changed; the fixture is solvable from the records, and the failure is the agent's at
  the identification step.
- **2026-08-17 (later)** — debug run resumed with prompting and reached **2 of 4**:
  `R33` ParentChild Taliaferro → subject, sourced to the 1836 deed (**f1 true**), and the
  bond attached at the correct ark `3:1:3QS7-89QX-2C5P` (**f4 true**). f2 and f3 stayed
  false — no maternal edge (maternity assessed `possible`) and no couple link carrying the
  1815 marriage. **The decisive document is the 1836 deed, not the bond**: read from the
  image it states *"Gideon Sleeper, Heir after Guardian of John Stirling, James Stirling,
  Ridley Stirling, and Salamon Stirling Minors Heirs of Taliaferro Stirling, late of Amite
  County"* — the standard decedent recital, plus "Salamon" for the bond's Seaborn. That is
  the closest this record set comes to stating parentage, and it is what lifted the tier
  from `possible` to `probable` and unblocked the encoding. Note this run was **heavily
  prompted** — the bond ark, its transcript, the deed's party list and the indexed marriage
  search were all supplied — so 2 of 4 is closer to a ceiling for this trajectory than a
  prediction for an unassisted run.
- **2026-08-17 — image routing defect found.** The 1836 scan is **1,696,175 bytes**;
  `image_read` refused it for exceeding its inline cap and nothing fell back to
  `image_transcribe`, which OCR'd it host-side on the first attempt with no key change and
  no size limit. Five sources had been flagged `ORIGINAL NOT EXAMINED` on that false
  premise, and the wrong reading of `a_046` that it caused cost two full skill cycles. Any
  run of this fixture that reports originals as unexaminable should be checked against this
  before the finding is believed.
- **2026-08-17 — first scored run (`run-2026-08-17_23-35-44`), and f4 was broadened as a
  result.** `stop_reason: completed`; 78.7 min, $10.32 — above the guide's 20–60 min /
  $3–10 envelope, which is the depth warning landing. Blind grade: **f1 `true`, f2 `true`,
  f3 `true`, f4 `false`** — 3 of 4, so `partial`. Compliance **FAIL** on nine guardrail
  bypasses: an `exhaustive_declaration` written without `research-exhaustiveness`, a
  conflict carrying `conflict-resolution`'s analytical product without that skill running,
  and six new persons carrying `person_evidence` links with `same_person` never called, so
  every identity was asserted rather than scored. Per spec §14 compliance does not bear on
  fixture validity, which keys on the genealogical axis alone. Proof quality 2 of 3 — sound
  narrative, but written at `proved` on a case that supports Probable at best, by a run
  that had bypassed nine guardrails.

  **f4's `false` was the fixture's fault, not the run's.** The run attached the **1823**
  Amite orphans'-court bond (`3QS7-L9QX-2H77`), in which the widowed *mother* Margaret is
  guardian — a more direct parentage record than the 1825 stepfather bond f4 named, and
  squarely within #1413's own framing of "actual parents being named guardian of their own
  children". f4 has been rewritten to name the record **class** and accept either bond.
  **The run log is committed** — spec §8 commits every committable run, `fail` and
  `partial` included, and a committed `fail` is retained signal rather than something to
  suppress. What was stale was its *grade*, not the log: the `.ann.json` has been
  re-graded against the amended f4 (see the 2026-08-18 entry). The log's own
  `judge_output` still reflects the pre-amendment f4 and is left as written — run logs
  are never rewritten.
- **2026-08-18 — second scored run (`run-2026-08-18_02-03-06`), and run 1 re-graded.**
  `stop_reason: cost_cap`, but the cap fired at the *end* of a completed trajectory, not
  mid-flow: `research-exhaustiveness`, `proof-conclusion` and the mandatory `gps-mentor`
  critique all ran, `question-selection` declared an autonomous stop point, and
  `project.status` was set to `completed` before the cap. Read it as a finished run that
  ran out of budget on the way out, not as a truncated one. Blind grade: **f1 `true`,
  f2 `true`, f3 `false`, f4 `true`** — 3 of 4, so `partial`. Proof quality **3 of 3**:
  the narrative declines `proved` and settles at `probable`, names its own limitations
  (no single declarative parentage document; the Redley/Simpson identity resting on name
  analysis; the 1823 estate reached only as an AI transcript), and is corroborated across
  independent chains — the calibration failure of run 1, which wrote `proved` on the same
  evidence class, is absent here.

  **f3 is the interesting miss, and it is not a records gap.** The agent held source S2
  (the 1815 Mississippi marriage index), asserted the 1 March 1815 Amite County marriage
  in the proof narrative, and footnoted the index — but `Couple` relationship `R33`
  (I1+I2) ended with **no `facts[]` at all**, sourced only to the 1823 probate. The string
  "1 Mar 1815" appears in the final tree exclusively inside S2's source *title*.
  `materialize_facts` was called three times and never produced the Marriage fact on the
  couple edge. Relationship findings score on `link` components (spec §3.4.2), so a
  marriage argued in prose and never encoded grades `false` — correctly. This is the
  e2e guide's named trap in its narrowest form: not a conclusion missing from the tree,
  but a conclusion whose *date* never made it out of the narrative.

  Two other observations worth carrying to the next run. The mother ended **split across
  two unmerged persons** — I2 (the widow, carrying Peggy McDowell from the 1815 index) and
  I3 (the remarried woman, holding the 1824 Sleeper `Couple` edge R34) — which the agent
  diagnosed itself and deferred as hypothesis `h_002` rather than merging. And **all seven
  newly minted persons carry parentage links with no `same_person` scoring**; the single
  `same_person` call in the run compared two record personas, not a tree person, so every
  identity was asserted rather than scored — the same shape as run 1's bypass, and the
  reason the guardrail axis is worth reading separately from the genealogical one (§7.5).
  Budget went to a 44-call census image sweep, leaving only the cap boundary for the merge
  and the marriage-fact write.

  **Run 1 (`run-2026-08-17_23-35-44`) re-graded to 4 of 4.** Its `.ann.json` was rewritten
  against the amended f4: **f1 `true`, f2 `true`, f3 `true`, f4 `true`**, proof quality
  unchanged at **2**. f4 now passes on option (b) — S7 is the 1823 bond
  `ark:/61903/3:1:3QS7-L9QX-2H77`, attached behind both parentage edges. Its f3 *did*
  materialize: `R33` carries fact `F11` (Marriage, 1 March 1815, `standard_date`
  1815-03-01, Amite County, sourced to the index). **The two runs fall short on different
  axes, not on opposite findings.** Run 1 is genealogically complete — 4 of 4 — and falls
  short on *process*: nine guardrail bypasses and a `proved` tier on a case that supports
  Probable at best. Run 2 tiered the proof correctly and reasoned soundly, and falls short
  on *recall*: f3 never reached the tree. Neither dominates the other, and the axes are
  scored separately (§7.5) for exactly this reason.

  **Both runs independently attached the same record: the 1823 bond
  `ark:/61903/3:1:3QS7-L9QX-2H77`. Neither attached the 1825 Sleeper bond
  (`3QS7-89QX-2C5P`) the fixture was originally written around** — run 1 surfaced it as
  the first full-text hit and read adjacent pages instead; run 2 read the 1825 image and
  cited it in the narrative, but wrote its source entry with a bare full-text search URL,
  so the 1825 ARK is absent from that tree too. Two independent trajectories converging on
  the mother's 1823 bond, and neither landing the stepfather's 1825 bond, is the evidence
  that broadening f4 **followed the records rather than rescued a score**: the 1823 bond
  is what this record set actually surfaces to an agent working the guardianship, and it
  is the more direct parentage document of the two. Had f4 stayed pinned to the 1825
  image, it would have been measuring which page of one volume the agent opened, not
  whether it engaged the guardianship — the discrimination the finding exists for.

  **§14 status: the fixture lands unvalidated, and that is not a merge blocker.** No
  committed run log carries a judge `verdict: pass` for this slug. Run 1's judge ran
  against the *pre-amendment* f4 and scored it `false`; run logs are never rewritten, so
  that verdict stands on disk even though the human re-grade is now 4 of 4. Run 2 is
  genealogically `partial` on f3. §14 is explicitly a **recommended authoring practice,
  not a CI merge blocker**, so a fixture may land with its validity run outstanding — but
  the claim "solvable end to end from live FamilySearch" is not yet carried by a committed
  log, and the next run of this fixture is what would settle it. Everything needed is
  demonstrably reachable: between the two runs, every one of the four findings has been
  recovered by *some* run, just never all four by one.
