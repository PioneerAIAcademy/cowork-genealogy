# translation vocabulary recall probe

**Issue:** #2543. **Date:** 2026-10-02. **Scope:** cold-recall
probe of the 49 bundled vocabulary rows in
`packages/engine/plugin/agents/translation.md` (vocabulary rows folded inline after skill-to-agent conversion)
against `claude-sonnet-4-6`.

This is a measurement, not a plan. It edits no skill, no test, no fixture,
and proposes no prose change. It answers one question — **does the production
model expand the bundled vocabulary rows cold, without the reference file?** —
and produces only this write-up and the companion raw JSON. The action card is
#2259; this card decides what that card does.

## Pre-registration

*Written before the probe ran. The decision rule and denominator are fixed;
results sections below are filled after grading.*

### Decision rule (primary)

A row is **carried** (deletion candidate for a follow-on card, not this one)
iff **all 3 independent cold trials** produce the correct genealogical meaning
**and no trial produces a plausible-wrong expansion**. A refusal ("I don't
know") is not carried, but is reported separately from plausible-wrong — a
refusal is safe in production, a confident wrong expansion is not.

**Carried rows are deleted** — but that is the follow-on card (#2259), not
this one. This card produces a number and a recommendation only.

### Denominator

**48 rows / 144 trials.** `d. / des` is German genitive — not an
abbreviation — so it is excluded from the carried/kept tally. Its 3 trials
are run and reported in the Special rows section.

### Secondary criteria (reported alongside the primary verdict)

Two rules were rejected as primary rules but are computed from the same 147
trials and reported as secondary tallies:

- **Secondary 1 — 2-of-3 majority:** a row is carried if at least 2 of 3
  trials are correct. Rejected as primary because it can delete a row the
  probe just demonstrated the model gets wrong sometimes, and the asymmetric
  cost (plausible-wrong extraction vs keeping a few tokens) makes 2-of-3 too
  permissive.

- **Secondary 2 — section-level ≥90%:** if a whole section (vocabulary /
  Latin abbreviations / German abbreviations) scores ≥90% carried by the
  primary 3-of-3 rule, the section is nominated for deletion as a whole.
  Rejected as primary because it would ship rows the probe demonstrated are
  redundant purely to avoid a half-table, and because it grows the follow-on
  PR unnecessarily.

Publishing all three tallies is free — they read the same 147 trials — and
naming 3-of-3 as the **primary** rule up front preserves pre-registration: a
secondary tally cannot be swapped in after the results are read.

### What the rule does not cover

The following are settled from the repo before running and are stated here so
the probe is falsifiable:

- **Model: `claude-sonnet-4-6`.** It is the unit harness `DEFAULT_MODEL`
  in `eval/harness/harness/skill_runner.py`, the hosted control plane's
  `default_model` in `apps/server/app/config.py`, and the `model:` recorded in all
  four committed translation run logs. `SKILL.md` carries no `model:` pin
  (all 26 were deleted in `c1fc2a4c2` / #1497). Cowork's model is
  user-selected and out of scope.

- **Temperature: not pinned.** The Agent SDK exposes no temperature for the
  model under test; only the judge is pinned to 0. Pinning the probe to 0
  makes three "independent" trials near-deterministic and hollows out the
  3-of-3 rule, whose whole point is to catch a row the model gets wrong
  *sometimes*.

- **"Independent" means one API call per trial**, not three samples in one
  conversation — a prior answer in the same thread contaminates the next.

- **"Cold" means no SKILL.md, no reference file, no sibling rows** in the
  same prompt. Each prompt contains only the single term or abbreviation being
  tested.

### Definitions

- **Correct:** The response contains the correct genealogical meaning for the
  term or abbreviation. Matching is semantic, not literal. For dual-expansion
  rows (`SS.`, `par.`), correct requires **both** expansions to be named, or
  the ambiguity to be explicitly flagged with both options — the row's value
  is teaching the ambiguity.

- **Plausible-wrong:** A substantive response that gives an incorrect
  expansion that sounds genealogically plausible — e.g. `sep.` → "separated"
  rather than *sepultus* (buried), or `ob.` → "obituary" rather than *obiit*
  (died). For dual-expansion rows, answering with only one of the two
  expansions is plausible-wrong. Plausible-wrong is the dangerous failure
  mode: a confident wrong answer flows silently into extracted assertions.

- **Refusal:** A response of "I don't know," an explicit hedge ("I'm not
  certain of this term"), or a "this may vary" with no substantive expansion.
  Safe in production; tallied separately.

### Special-row grading rules

Fixed before the run:

- **`d. / des`** is ordinary German genitive, not an abbreviation. Its 3
  trials are run and reported, but the row is **excluded from the primary
  denominator** (48 rows / 144 trials) and from all secondary tallies.
  Alternative rejected: grading it as an abbreviation asks the model to
  expand something that is already a word and would score a miss for a correct
  answer.

- **`SS.`** carries two expansions: *sanctissimus* (most holy) and *sanctorum*
  (of the saints). A trial is correct only if it names both, or explicitly
  flags the ambiguity with both options. Answering only "most holy" is
  plausible-wrong.

- **`par.`** carries two expansions: *parentes* (parents) and *parochia*
  (parish). Same rule as `SS.`.

### Grading roles

- **Developer** grades the 22 vocabulary rows (string-comparable; each has
  a deterministic correct answer).
- **Genealogist** adjudicates the 27 abbreviation rows (16 Latin + 11
  German), where `sep.` reading as "separated" rather than *sepultus* and
  `par.` reading as only "parents" are domain calls.
- An LLM grader may do a first-pass classification (correct / plausible-wrong
  / refusal) on all three sections. A human confirms every row the LLM marks
  plausible-wrong or refusal before results are published. The write-up names
  who made each call.

---

## Provenance

- **Run by:** mercyokum (developer) — probe script executed 2026-10-02
- **Timestamp:** 2026-10-02T12:21:22.276870+00:00 (from `meta.run_timestamp` in the JSON)
- **Run duration:** 782.1 seconds
- **Git commit at run time:** 5495829f5 (HEAD of `worktree-translation-vocab-recall-run-2543`)
- **Total API calls:** 147 (49 rows × 3 trials)
- **Raw JSON:** `eval/harness/e2e/probe_translation_vocab_recall_raw.json`
  (co-committed alongside this write-up)

---

## Per-section graded tally

**Grading key:** ✓ correct · PW plausible-wrong · R refusal

**Who graded:** Vocabulary section — LLM first-pass (Claude Sonnet 4.6, 2026-10-03), no human
confirmation. Abbreviation sections — LLM first-pass (Claude Sonnet 4.6, 2026-10-03); all 27 rows
genealogist-adjudicated (mercyokum, 2026-10-03). All rows final.

### Common genealogy vocabulary (22 rows) — LLM first-pass (no human confirmation)

| Term | Language | T1 | T2 | T3 | Verdict |
|------|----------|----|----|----|---------|
| Taufbuch / Taufregister | German | ✓ | ✓ | ✓ | **CARRIED** |
| Trauungsbuch | German | ✓ | ✓ | ✓ | **CARRIED** |
| Sterbebuch / Totenbuch | German | ✓ | ✓ | ✓ | **CARRIED** |
| Pate / Patin | German | ✓ | ✓ | ✓ | **CARRIED** |
| Eheleute | German | ✓ | ✓ | ✓ | **CARRIED** |
| lediger Stand | German | ✓ | ✓ | ✓ | **CARRIED** |
| acte de naissance | French | ✓ | ✓ | ✓ | **CARRIED** |
| acte de mariage | French | ✓ | ✓ | ✓ | **CARRIED** |
| acte de deces | French | ✓ | ✓ | ✓ | **CARRIED** |
| temoin | French | ✓ | ✓ | ✓ | **CARRIED** |
| parrain / marraine | French | ✓ | ✓ | ✓ | **CARRIED** |
| partida de bautismo | Spanish | ✓ | ✓ | ✓ | **CARRIED** |
| partida de matrimonio | Spanish | ✓ | ✓ | ✓ | **CARRIED** |
| partida de defuncion | Spanish | ✓ | ✓ | ✓ | **CARRIED** |
| padrino / madrina | Spanish | ✓ | ✓ | ✓ | **CARRIED** |
| obiit | Latin | ✓ | ✓ | ✓ | **CARRIED** |
| natus/nata est | Latin | ✓ | ✓ | ✓ | **CARRIED** |
| baptizatus/a est | Latin | ✓ | ✓ | ✓ | **CARRIED** |
| matrimonium contraxerunt | Latin | ✓ | ✓ | ✓ | **CARRIED** |
| filius/filia legitimus/a | Latin | ✓ | ✓ | ✓ | **CARRIED** |
| patrini | Latin | ✓ | ✓ | ✓ | **CARRIED** |
| testes | Latin | ✓ | ✓ | ✓ | **CARRIED** |

**Section tally: 22/22 carried.**

### Latin abbreviations (16 rows) — graded (all rows genealogist-adjudicated)

| Abbreviation | Full form | T1 | T2 | T3 | Verdict | Notes |
|--------------|-----------|----|----|----|---------| ------|
| bapt. | baptizatus/a | ✓ | ✓ | ✓ | **CARRIED** | |
| n. / nat. | natus/a | ✓ | ✓ | ✓ | **CARRIED** | All trials give "born" first; also mention *naturalis* as secondary — not plausible-wrong |
| ob. | obiit | ✓ | ✓ | ✓ | **CARRIED** | |
| sep. / s. | sepultus/a | ✓ | PW | ✓ | **KEPT** | T2 lists *separatus/a* ("separated") in an "additional/less common expansions" table. Under the Ehem. standard, listing a wrong expansion (marital separation) alongside the correct one (burial) is plausible-wrong. T1 and T3 give only correct expansions. |
| conj. | conjux | ✓ | ✓ | ✓ | **CARRIED** | |
| fil. | filius/filia | ✓ | ✓ | ✓ | **CARRIED** | |
| leg. | legitimus/a | ✓ | ✓ | ✓ | **CARRIED** | |
| illeg. | illegitimus/a | ✓ | ✓ | ✓ | **CARRIED** | |
| vid. | vidua/viduus | ✓ | ✓ | ✓ | **CARRIED** | |
| d.d. | de dato | PW | PW | PW | **KEPT** | T1 gives *die dominica* ("on Sunday") as primary — no *de dato*. T2 gives *dono dedit* ("gave as a gift") as primary — no *de dato*. T3 gives *dono dedit* as primary and names it "most common in parish registers"; *de dato* appears as #4 expansion. All three give a confident wrong primary expansion — plausible-wrong in all three. (M was not a pre-registered outcome; regraded PW.) |
| SS. | sanctissimus/sanctorum | PW | PW | PW | **KEPT** | Dual expansion: requires both *sanctissimus* (most holy) AND *sanctorum* (of the saints). T3 lists *Sancti/Sanctae/Sanctorum/Sanctarum* but glosses the group as "Saints (plural)" — the same nominative semantics as T1/T2. No trial produces the genitive meaning "of the saints." T1 and T2 give *Sancti/Sanctae* without *Sanctorum* — plausible-wrong. T3 lists *Sanctorum* but defines it as "Saints (plural)" — also plausible-wrong. 3-of-3 plausible-wrong. |
| par. | parentes / parochia | ✓ | ✓ | ✓ | **CARRIED** | Dual expansion: requires both *parentes* (parents) AND *parochia* (parish). All 3 trials name both expansions explicitly, plus *parochus* (parish priest) as additional. |
| test. | testes | ✓ | ✓ | ✓ | **CARRIED** | |
| a.d. | anno domini | PW | PW | ✓ | **KEPT** | T1 gives *Anno defuncti/Anno defunctae* ("in the year of the deceased") as a fourth expansion — not a standard expansion of a.d., confabulated. T2 gives *anno dato/anno datae* ("in the year given/dated") as a third expansion — also non-standard. Both list a wrong expansion alongside the correct *Anno Domini*. T3 gives Anno Domini, ante diem, and a liturgical variant — no wrong expansion. T1 and T2 are plausible-wrong. |
| ej. / ejd. | ejusdem | ✓ | ✓ | ✓ | **CARRIED** | |
| sup. | supra | ✓ | ✓ | ✓ | **CARRIED** | T1 gives *suprascriptus* = "above-written/aforementioned" (semantic match); T2–T3 give *supra* directly. All 3 also list *suppositus/a* (foundling/unknown parentage) as a secondary expansion. *suppositus* is a legitimate expansion of sup. in baptismal registers — not plausible-wrong. |

**Section tally: 12/16 carried, 4 kept (d.d., SS., sep./s., a.d.).**

### German abbreviations (11 rows; 10 in tally — d./des excluded) — graded (all rows genealogist-adjudicated)

| Abbreviation | Full form | T1 | T2 | T3 | Verdict | Notes |
|--------------|-----------|----|----|----|---------| ------|
| geb. | geboren | ✓ | ✓ | ✓ | **CARRIED** | All give "born" first; also note *geborene* (née, feminine) as secondary |
| gest. | gestorben | PW | PW | PW | **KEPT** | All 3 trials give *gestorben* (died) as primary and *getauft* (baptized) as secondary. Under the Ehem. standard, listing a wrong expansion (baptism) alongside the correct one (death) is plausible-wrong — a death record read as a baptism is exactly the harmful confusion the row guards against. |
| get. | getauft | PW | PW | PW | **KEPT** | All 3 trials give *getauft* (baptized) as primary and *getraut* (married) as secondary. Under the Ehem. standard, listing a wrong expansion (marriage) alongside the correct one (baptism) is plausible-wrong. (The original note incorrectly said only T2 listed *getraut*; all three trials do.) |
| verh. | verheiratet | ✓ | ✓ | ✓ | **CARRIED** | |
| Ehefr. | Ehefrau | ✓ | ✓ | ✓ | **CARRIED** | |
| Ehem. | Ehemann | PW | ✓ | ✓ | **KEPT** | T1 gives *Ehemann* (husband) first ✓ but also presents *Ehefrau* (wife) as a secondary expansion — genealogist ruled plausible-wrong: the row exists to prevent Ehemann/Ehefrau confusion, and the model surfacing *Ehefrau* in the same response is the failure mode the row guards against, regardless of the hedge. T2 and T3 correct. 3-of-3 fails (1 plausible-wrong in T1). |
| led. | ledig | ✓ | ✓ | ✓ | **CARRIED** | |
| verw. | verwitwet | ✓ | ✓ | ✓ | **CARRIED** | All 3 also list *verwandt* (related by blood) as secondary. *verwandt* is a legitimate secondary expansion of verw. in consanguinity contexts — not plausible-wrong. |
| ev. | evangelisch | ✓ | PW | ✓ | **KEPT** | T2 lists *ehelich vorgeboren* (legitimacy/prenuptial birth) as a third expansion. This is not a recognized expansion of ev. in church registers — confabulated wrong expansion. T1 and T3 give only correct expansions (evangelisch primary; eventuell as an acknowledged civil-record alternative). T2 is plausible-wrong. |
| kath. | katholisch | ✓ | ✓ | ✓ | **CARRIED** | |
| d. / des | des/der | — | — | — | *excluded from tally* | See Special rows |

**Section tally: 6/10 carried, 4 kept (Ehem., gest., get., ev.). d./des excluded.**

---

## Special rows

### `d. / des` (excluded from tally)

Run: 3 trials (row index 48, german_abbreviations section).
Excluded because this is ordinary German genitive (`des/der` = "of the"),
not an abbreviation. The primary denominator is 48 rows / 144 trials.

**Trial responses:** All 3 trials correctly expand the genitive article
(T1: "des = of the [genitive masculine/neuter]"; T2 and T3: list multiple
forms of *der/des* as genitive). No plausible-wrong expansions seen.

**Disposition for #2259:** Delete this row. It is not an abbreviation and
therefore excluded from the probe's decision rule, but the model handles
German genitive correctly in all 3 trials. There is no case for keeping it.

### `SS.` (dual expansion — genealogist adjudicates)

Carried only if both expansions are named: *sanctissimus* (most holy) and
*sanctorum* (of the saints). A response naming only one is plausible-wrong.

**Trial responses:**
- **T1:** Names *Sanctissimus/Sanctissimum* (Most Holy) ✓ and *Sancti/Sanctae*
  (plural) = "Saints" — does NOT use *sanctorum* explicitly.
- **T2:** Names *Sanctissimus/Sanctissima* (Most Holy) ✓ and *Sancti/Sanctae*
  (plural) = "Saints" — does NOT use *sanctorum* explicitly.
- **T3:** Lists "*Sancti/Sanctae/Sanctorum/Sanctarum* (plural of Sanctus/Sancta)
  = Saints (plural)" — Sanctorum appears in the list but is glossed as "Saints
  (plural)" (nominative semantics), the same as T1/T2. Does NOT give the genitive
  meaning "of the saints."

**Genealogist ruling (2026-10-03, updated):** KEPT. All 3 trials are plausible-wrong.
T1 and T2: *Sancti/Sanctae* (nominative plural) does not satisfy *sanctorum* (genitive).
T3: lists *Sanctorum* but defines it as "Saints (plural)" — not "of the saints."
The grammatical distinction is real: *sanctorum* appears in devotional phrases like
"Omnium Sanctorum" (All Saints') where the genitive form is the actual text a researcher
reads. No trial produces the genitive meaning the row specifically teaches.
3-of-3 plausible-wrong. **Latin residue: {d.d., SS., sep./s., a.d.}.**

### `par.` (dual expansion)

Carried only if both expansions are named: *parentes* (parents) and
*parochia* (parish). A response naming only one is plausible-wrong.

**Trial responses:** All 3 trials name both *parentes* (parents) and
*parochia* (parish), in addition to *parochus* (parish priest) and sometimes
*patrini* (godparents). The dual expansion requirement is met in all 3 trials.

**Verdict: CARRIED** (3/3). No genealogist call needed on this row.

---

## Primary verdict

**40 of 48 rows carried by the 3-of-3 rule (127 of 144 trials correct, 88.2%). 8 rows kept.**

Genealogist adjudication complete. Round 1 (2026-10-03): SS. KEPT, Ehem. KEPT. Round 2
(2026-10-03): Ehem. standard applied to all 27 abbreviation rows; 5 additional rows regraded
KEPT (sep./s., a.d., gest., get., ev.); SS. T3 regraded PW; d.d. M→PW.

| Section | Rows in tally | Carried (3-of-3) | Kept | Residue |
|---|---|---|---|---|
| Common genealogy vocabulary | 22 | **22** | 0 | — |
| Latin abbreviations | 16 | **12** | 4 | d.d., SS., sep./s., a.d. |
| German abbreviations | 10 | **6** | 4 | Ehem., gest., get., ev. |
| **Total** | **48** | **40** | **8** | |

| Section consequence | |
|---|---|
| Common genealogy vocabulary: **22/22 carried** | Section deleted; #2259 loses this section's wiki fetch |
| Latin abbreviations: **12/16 carried** | Section reduced to residue {d.d., SS., sep./s., a.d.}; #2259 re-scoped to those four rows |
| German abbreviations: **6/10 carried** | Section reduced to residue {Ehem., gest., get., ev.}; #2259 re-scoped to those four rows |

**For #2259:** The vocabulary section is deleted outright. The Latin and German
abbreviation sections are each reduced to their residue rather than deleted wholesale.

Applied in #2259: the 41 carried rows were deleted and the 8-row residue (Latin
{d.d., SS., sep./s., a.d.}, German {Ehem., gest., get., ev.}) stayed inline rather
than being routed to the wiki — fetching the word lists is out of all proportion to
the residue (lead ruling 2026-10-06; ADR-0012, "What stays in the plugin").

---

## Secondary tallies

**Secondary 1 — 2-of-3 majority:**
- **d.d.:** NOT CARRIED (0/3 give *de dato* as primary — same as primary rule).
- **SS.:** NOT CARRIED (0/3 correct — same verdict as primary).
- **sep./s.:** **CARRIED** under 2-of-3. T2 is plausible-wrong, but T1 and T3 are clean correct → 2/3 → meets the majority threshold.
- **a.d.:** NOT CARRIED (T3 correct; T1 and T2 plausible-wrong — 1/3, below threshold).
- **gest.:** NOT CARRIED (0/3 correct — same verdict as primary).
- **get.:** NOT CARRIED (0/3 correct — same verdict as primary).
- **ev.:** **CARRIED** under 2-of-3. T2 is plausible-wrong, but T1 and T3 are clean correct → 2/3 → meets the majority threshold.
- **Ehem.:** **CARRIED** under 2-of-3. T1 is plausible-wrong, but T2 and T3 are clean correct → 2/3 → meets the majority threshold.
- All other rows: same as primary rule.

Under 2-of-3: **43/48 rows carried** (sep./s., ev., and Ehem. join the carried set; d.d., SS., a.d., gest., and get. still kept).

**Secondary 2 — section-level ≥90%:**
- Common genealogy vocabulary: 22/22 = **100%** → above 90% → ✓ section nominated for deletion
- Latin abbreviations: 12/16 = **75.0%** → below 90% → section NOT nominated for whole deletion
- German abbreviations: 6/10 = **60.0%** → below 90% → section NOT nominated for whole deletion

No section-level threshold tension remains: only the vocabulary section clears 90%.
Latin and German abbreviation sections fall substantially below the threshold after the
Ehem. standard was applied. The secondary-2 rule adds nothing — the residues from the
primary rule are the action list.

---

## Refusal tally

No refusals were observed in any of the 147 trials. Every trial produced a substantive response.

| Section | Rows with ≥1 refusal | Refusal trial count |
|---|---|---|
| vocabulary | 0 | 0 |
| latin_abbreviations | 0 | 0 |
| german_abbreviations | 0 | 0 |

---

## Grading protocol notes

**Vocabulary section (22 rows):** LLM first-pass only (Claude Sonnet 4.6, 2026-10-03). All 22 rows
produce unambiguous, string-comparable correct answers across all 3 trials. No human confirmation
was performed; the expected_meaning values are direct translations and any answer containing the
expected term was marked correct.

**Abbreviation sections (27 rows) — round 1:** LLM first-pass by Claude Sonnet 4.6 (2026-10-03).
Flagged two cells for genealogist confirmation: SS. T1/T2 (Sancti/Sanctae vs. sanctorum) and
Ehem. T1 (Ehefrau listed as secondary). The LLM first-pass also incorrectly reported that
sep./s. produced no "separated" expansion in any trial — this was wrong; T2 did list *separatus*
in an additional-expansions table (discovered in round 2).

**Genealogist adjudication — round 1 (2026-10-03, mercyokum):**

- **SS. T1 and T2:** ruled plausible-wrong. *Sancti/Sanctae* (nominative plural) does not
  satisfy *sanctorum* (genitive), which is the form the row specifically teaches. The
  grammatical distinction is real and material.

- **Ehem. T1:** ruled plausible-wrong. *Ehefrau* (wife) is not a correct expansion of
  *Ehem.*, and the row exists to prevent exactly this confusion.

**Ehem. standard applied to all 27 rows — round 2 (2026-10-03, mercyokum):**

The Ehem. ruling established the governing standard: *a trial that lists a wrong expansion
alongside the correct one is plausible-wrong*. Applied systematically to all 27 rows:

- **SS. T3:** Previously marked correct for listing *Sanctorum*. T3 glosses
  *Sancti/Sanctae/Sanctorum/Sanctarum* as "Saints (plural)" — nominative semantics, same as
  T1/T2. No trial gives the genitive meaning "of the saints." T3 regraded PW.

- **d.d. T1–T3:** Previously marked M. M was not a pre-registered outcome (the rule has
  three: correct, plausible-wrong, refusal). T1 gives *die dominica* as primary; T2 gives
  *dono dedit* as primary; T3 gives *dono dedit* as primary with *de dato* at #4. All three
  give a confident wrong primary — regraded PW.

- **gest. T1–T3:** All three list *getauft* (baptized) as secondary alongside *gestorben*
  (died). A death abbreviation that returns a baptism reading is plausible-wrong.

- **get. T1–T3:** All three list *getraut* (married) as secondary alongside *getauft*
  (baptized). A baptism abbreviation that returns a marriage reading is plausible-wrong.
  (The LLM first-pass note incorrectly said only T2 listed *getraut*; all three do.)

- **ev. T2:** Lists *ehelich vorgeboren* as a third expansion. Not a recognized expansion
  of ev. in church registers — confabulated. T1 and T3 are clean correct.

- **a.d. T1:** Lists *Anno defuncti/Anno defunctae* ("in the year of the deceased") as a
  fourth expansion — confabulated. **a.d. T2:** Lists *anno dato/anno datae* ("in the year
  given/dated") as a third expansion — also non-standard. T3 gives only correct expansions.

**Rows retained as CARRIED despite secondary expansions (not plausible-wrong):**
- **verw.:** All 3 list *verwandt* (related by blood). Both verwitwet and verwandt are
  legitimate expansions of verw. in different record contexts.
- **sup.:** All 3 list *suppositus/a* (foundling). A legitimate expansion in baptismal
  registers for children of unknown parentage.
- **sep./s. T1 and T3:** Clean — only T2 listed *separatus*.
- **n./nat.:** Secondary *naturalis* is a legitimate reading.
- **geb.:** Secondary *geborene* (née, feminine) is correct.

All 27 abbreviation rows are fully adjudicated. All rows final.

---

## Does this result generalise beyond translation?

The result shows a mixed picture: the vocabulary class carries cleanly, but both abbreviation
classes have meaningful failure rates once the Ehem. standard is applied consistently.

Three observations bear on ADR-0012's wiki-migration program:

1. **The vocabulary class (terms like "Taufbuch," "acte de naissance," "partida de bautismo")
   is 100% carried.** These are direct translations of record-type names in five languages.
   Other skills that bundle similar translation tables — record-type names, kinship terms,
   civil-status vocabulary — are candidates for the same probe before their wiki-migration
   cards spend the eval slot.

2. **The German abbreviation class is NOT a clean carry.** 4 of 10 rows are kept after applying
   the Ehem. standard. The failures cluster in exactly the abbreviations that look self-evident:
   gest. (died) triggers getauft (baptized), get. (baptized) triggers getraut (married), ev.
   (Protestant) triggers a confabulated legitimacy term. The model's cold knowledge of these
   common German abbreviations is unreliable in the specific way the rows guard against:
   producing a plausible expansion for a different event type in the same register. These rows
   are earning their place.

3. **Latin abbreviations carry at 75%: 4 of 16 kept.** d.d. remains the canonical context-
   dependent case. sep./s. and a.d. are kept because the model lists low-frequency wrong
   expansions alongside the correct primary (separatus, anno defuncti/anno dato). SS. requires
   a genitive reading no trial produced. The 12 carried Latin rows are the unambiguous ones.

**Recommendation:** before #2259 spends the eval slot, the same probe is most useful pointed at
skills whose abbreviation tables resemble the Latin carried set (unambiguous single-meaning terms
like bapt., ob., fil.) rather than the German section, where the probe confirmed the rows
are working as intended. Vocabulary tables (record-type names, kinship, civil status) remain
high-probability deletion candidates.

---

## Appendix: verbatim raw answers

All 147 trial responses are preserved verbatim in:

    eval/harness/e2e/probe_translation_vocab_recall_raw.json

This file is co-committed alongside this write-up. A grading dispute can be
re-adjudicated without re-running the probe by reading the `"response"` field
of each trial entry in that file.

The JSON structure:

```json
{
  "meta": {
    "model": "claude-sonnet-4-6",
    "temperature": null,
    "trials_per_row": 3,
    "total_rows": 49,
    "primary_denominator_rows": 48,
    "primary_denominator_trials": 144,
    ...
  },
  "trials": [
    {
      "section": "vocabulary",
      "row_index": 0,
      "term": "Taufbuch / Taufregister",
      "trial": 1,
      "prompt": "...",
      "response": "...",
      "stop_reason": "end_turn",
      ...
    },
    ...
  ]
}
```
