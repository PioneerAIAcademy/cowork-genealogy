# Specification: research-plan skill — record-type pages and the reference layer

This document records the decisions behind what `research-plan` fetches from
the FamilySearch wiki, what it leaves to `locality-guide`, and what its
`references/` folder still holds. The skill body
(`packages/engine/plugin/skills/research-plan/SKILL.md`) and its eval suite
(`eval/tests/unit/research-plan/`, `eval/harness/validators/test_research_plan.py`)
must conform to it. It covers the step-2 wiki move under ADR-0012 (2026-10);
it is not a full behavioural spec of the skill.

---

## 1. Who fetches what

**Ruling (lead, 2026-09-27, option A): research-plan fetches
subject-triggered record-type pages itself, via `wiki_read`. Place-shaped
know-how stays in the `localities` entry that `locality-guide` writes.**

Why not route everything through `locality-guide`:

- The two triggers are properties of the **subject** (a male subject of a
  parentage question; a compound or patronymic surname). `locality-guide`
  surveys a **place** and never sees the subject.
- The planned skill-to-agent conversion of research-plan already grants `wiki_read`.
- Routing them through `locality-guide` would have spent that skill's eval slot
  and collided with work already queued on that skill.

So the split is:

| Knowledge | Shape | Owner | Path |
|---|---|---|---|
| Jurisdictions, boundary changes, register start dates, indexing quirks, record loss and substitutes | place | `locality-guide` | the `localities` entry research-plan reads |
| Levy rolls for sons, naming conventions | subject × country | `research-plan` | `wiki_read` in the Step 3 pre-work block |
| Which records exist for the place | place | `research-plan` | `collections_search`, `volume_search`, `external_links_search` |
| Record-type selection by goal, FAN, sequencing, BCG 9–18 | GPS craft | `research-plan` | body and `references/` |

`wiki_search`, `wiki_place_page` and `place_population` stay forbidden to
research-plan (validator V2, `test_research_plan_no_out_of_lane_tools`).
`wiki_read` is deliberately absent from that prohibition.

## 2. The Step 3 pre-work block

Placed at the head of Step 3, before record-type selection, as a labelled block
whose members are required (ADR-0012: placement decides whether a call happens;
`locality-guide`'s labelled block runs at 96–97%, while `gps-mentor`'s prose
mentions ran at 0 of 91). URL form:
`https://www.familysearch.org/en/wiki/{Country}_{Topic}`, from the subject's
birth country.

| Trigger | Page |
|---|---|
| Male subject of a parentage question, born in continental Europe or Scandinavia (not the British Isles or the Americas) | `{Country}_Military_Records` |
| Compound (two-surname) or patronymic surname | `{Country}_Naming_Customs` |

**On failure** (`No wiki page found`, any error, or an empty page): the
affected item's rationale says so, and the plan is built from the `localities`
entry, never from memory. Because ADR-0012 records wiki-call failure as a
common path, the levy-roll rule (§3) keys on "the fetched page **or** the
`localities` entry's quirks", so a failed fetch does not drop the item.

**Trigger history.** Two judgement-based wordings over-fired on the 2026-10-02
and 2026-10-03 full runs: "kept conscription or levy rolls of boys" fetched
`United_States_Military_Records` for a Pennsylvania-born subject, and "levy
rolls that enrolled boys from childhood" still fetched `Ireland_Military_Records`
for an Irish-born one, on the Flynn tests that were already timing out. The
trigger is now a coarse region read off the birthplace. It is a scope condition
on when to fetch, not a fact about records, so the country's own page still
says whether levy rolls exist. The six Patrick Flynn parentage tests keep an
`Ireland_Military_Records` fixture as a safety net.

## 3. Rules that stay in the plugin, and why

ADR-0012 allows a record-type-shaped rule to stay where it is craft, and forbids
a jurisdiction-shaped fact. Each surviving rule was checked against the page
that would replace it (probed 2026-10-02, §5):

- **Levy rolls as direct parentage evidence for a son.** The country facts
  (which countries, from which year, how to reach the rolls) moved to the
  fetched page. The inference that a roll naming a boy under his father is
  direct parentage evidence, ranked alongside the baptism and the parents'
  marriage, is ours: neither `Denmark_Military_Records` nor its levying-roll
  subpage says it. The page does not even state on its main page that the army
  rolls list the father's name.
- **The death-record route to a pre-register birth.** When
  the birth predates the register of the parish where the subject was born or
  first appears, or the birth parish is the unknown, plan the subject's own
  death or burial entry and each marriage as their own items. It is
  **stated across jurisdictions, not Swedish-only**: a Sweden-only rule would be
  a jurisdiction fact in the body, which ADR-0012 forbids, and the reasoning
  (work back from the records that state age or origin) is not Swedish. It
  stays in the body because the wiki does not carry it: `Sweden_Church_Records`
  lists a death entry's contents as name, date, age, residence, occupation and
  cause, with **no birthplace**, and `Sweden_Death_and_Burial_Records` is the
  same. The evidence is the `elena-asmundsdotter-origin` e2e case: her 1745 Barsebäck death entry states
  *"född i Henckelstorp"*, so the page is thinner than the record.
- **Breadth across record types.** A plan whose items all share one
  `record_type` is not broad (`docs/gps-research-flow.md`). The plan on that
  e2e case's 2026-09-18 run had ten items, all `church`.
- **Compound-surname reversal caution.** `Spain_Naming_Customs` states the order
  (father's, then mother's surname; Portugal the reverse) and mentions reversal
  only for families who emigrated to the United States. It does not say clerks in
  Spain reversed or conflated the two, so that caution stays as craft, and the
  surname order comes from the page.
- **The unproven married surname.** A surname typed into a
  search asserts nothing, so a search keyed on a surname from a single marriage
  record may be planned freely. The caution applies to what is written down: no
  rationale calls it her maiden name, and a companion item must test it.

**Regression risk to watch:** `ut_research_plan_r3d` fails, recorded as `xfail`,
because its plan puts the Trysil death record ahead of the Kongsberg baptism the
objective asks for. The death-route rule fires only "when no baptism can be
expected", which does not hold for r3d, and Step 4 item 7 still puts the
objective's target first. Watch r3d's ordering on every run after this change.

## 4. What `references/` holds

| File | Route | Why it survives |
|---|---|---|
| `planning-standards.md` | 3 — craft | BCG Standards 9–18. ADR-0012 measured the wiki as carrying none of the GPS planning craft. |
| `record-type-guide.md` | 3 — craft, trimmed | The record-type-by-goal table, FAN "others mentioned", the parents'-marriage item, the levy-roll and death-route reasoning, less-consulted types, and the contextual checklist. The Danish dates and session notations, and the Iberian surname convention, were removed; they come from the fetched pages. Record destruction now points at the `localities` entry. |
| ~~`places-guidance.md`~~ | deleted | Lead ruling 2026-08-31: delete the `places-guidance.md` family rather than adjudicate its copies. The rules the body needed are inlined in SKILL.md's **Places:** line: use `standardPlace` verbatim, and broaden by dropping the leading component only when the specific level returns nothing usable. An earlier wording ("call again, then combine the levels") roughly doubled discovery calls on several tests in the 2026-10-02 full run (fbn 6 to 12) and pushed calls off their fixtures, so the conditional form is deliberate. |
| ~~`locality-survey-guide.md`~~ | deleted | Named by nothing. A genealogist's verdict (2026-08-24, `docs/deep-dives/research-plan-findings-2026-08-24.md`) found every live item restated elsewhere. Its substitute-sources passage is place-shaped and belongs in the `localities` entry. |

The skill-to-agent conversion's fold deletes `references/`; the two surviving files are what it
folds.

## 5. Wiki slugs probed (2026-10-02)

Fetched through the hosted sidecar (`GET /page/{slug}`). `wiki_read` itself
timed out on 6 of 6 attempts that day (`UND_ERR_CONNECT_TIMEOUT`, 10 s connect),
while curl to the same host succeeded on every attempt.

| Slug | Result | Content chars |
|---|---|---:|
| `Denmark_Military_Records` | worked | 16,503 |
| `Danish_Military_Levying_Rolls_(Lægdsruller)` | worked (subpage) | 16,399 |
| `Norway_Military_Records` | worked | 17,823 |
| `Sweden_Military_Records` | worked | 33,683 |
| `Ireland_Military_Records` | worked | 44,003 |
| `Denmark_Naming_Customs` | worked | 22,559 |
| `Norway_Naming_Customs` | worked | 23,163 (2026-09-23) |
| `Sweden_Naming_Customs` | worked | 25,768 |
| `Spain_Naming_Customs` | worked | 17,545 |
| `Portugal_Naming_Customs` | worked | 11,981 |
| `Sweden_Church_Records` | worked | 27,446 |
| `Sweden_Death_and_Burial_Records` | worked | 4,557 |
| `Denmark_Church_Records` | worked | 42,358 |
| `Norway_Church_Records` | worked | 93,724 |
| `Ireland_Census_Substitutes` | worked | 32,958 |
| `Spain_Civil_Registration` | worked | 19,345 |
| `United_States_Census_Substitutes` | worked, stub | 912 |
| `Sweden_Death_Records` | **404** (the page is `Sweden_Death_and_Burial_Records`) | — |
| `Spain_Names,_Personal` | **404** | — |

## 6. Change requests to make upstream

ADR-0012: where the wiki is thinner than the passage it replaces, request the
change; keep no local copy.

- `Denmark_Military_Records`: state on the main page that each boy is entered
  under his father's name (only the levying-roll subpage says so), and that this
  makes the roll parentage evidence for a son.
- `Sweden_Church_Records` / `Sweden_Death_and_Burial_Records`: state that death
  and burial entries frequently give the birthplace, as the 1745 Barsebäck entry
  for Elena Asmundsdotter does.
- `Spain_Naming_Customs`: note that priests and clerks within Spain sometimes
  reversed or merged the two surnames, not only emigrant families.

## 7. Verification

- `test_wiki_prework_fetches_triggered_pages`: every `wiki-prework` test is
  served each page its subject triggers. A 404 slug, a sibling wiki tool or a
  skipped fetch fails it. Map: ut_015 (Denmark military and naming), r3d
  (Norway military and naming), `ut_research_plan_dth` (Sweden naming),
  `ut_research_plan_csn` (Spain naming).
- `test_pre_register_birth_plans_death_route`: on `pre-register-birth` tests, an
  item targets the subject's own death or burial entry, dated after the birth
  window, and the items span at least two `record_type`s.
- Both are proven to fail in `eval/harness/tests/unit/test_research_plan_validator.py`.
