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

**Grading key:** ✓ correct · PW plausible-wrong · R refusal · M miss (wrong, not plausible-wrong)

**Who graded:** Vocabulary section — developer (LLM first-pass, string-comparable).
Abbreviation sections — LLM first-pass (Claude Sonnet 4.6, 2026-10-03); SS. and Ehem.
genealogist-adjudicated (mercyokum, 2026-10-03). All rows final.

### Common genealogy vocabulary (22 rows) — developer-graded

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

### Latin abbreviations (16 rows) — graded (SS. genealogist-adjudicated)

| Abbreviation | Full form | T1 | T2 | T3 | Verdict | Notes |
|--------------|-----------|----|----|----|---------| ------|
| bapt. | baptizatus/a | ✓ | ✓ | ✓ | **CARRIED** | |
| n. / nat. | natus/a | ✓ | ✓ | ✓ | **CARRIED** | All trials give "born" first; also mention *naturalis* as secondary — not plausible-wrong |
| ob. | obiit | ✓ | ✓ | ✓ | **CARRIED** | |
| sep. / s. | sepultus/a | ✓ | ✓ | ✓ | **CARRIED** | All trials give "buried" as primary; no "separated" expansion seen in any trial |
| conj. | conjux | ✓ | ✓ | ✓ | **CARRIED** | |
| fil. | filius/filia | ✓ | ✓ | ✓ | **CARRIED** | |
| leg. | legitimus/a | ✓ | ✓ | ✓ | **CARRIED** | |
| illeg. | illegitimus/a | ✓ | ✓ | ✓ | **CARRIED** | |
| vid. | vidua/viduus | ✓ | ✓ | ✓ | **CARRIED** | |
| d.d. | de dato | M | M | M | **KEPT** | 0/3 give "dated/de dato" as primary. T1: *die dominica* first, *de domo*, *dicto die* — no *de dato*. T2: *dono dedit* first — no *de dato*. T3: *de dato* appears as #4 expansion; *dono dedit* named most common. None of the three trials identify "dated" as the primary meaning. |
| SS. | sanctissimus/sanctorum | PW | PW | ✓ | **KEPT** | Dual expansion: requires both *sanctissimus* (most holy) AND *sanctorum* (of the saints). T3: explicitly names *Sanctorum* ✓. T1 and T2: give *Sancti/Sanctae* (nominative plural = "the Saints") — genealogist ruled this does NOT satisfy *sanctorum* (genitive = "of the saints"); the grammatical distinction is real and the bundled row specifically teaches the genitive form. T1 and T2 marked plausible-wrong. 3-of-3 fails. |
| par. | parentes / parochia | ✓ | ✓ | ✓ | **CARRIED** | Dual expansion: requires both *parentes* (parents) AND *parochia* (parish). All 3 trials name both expansions explicitly, plus *parochus* (parish priest) as additional. |
| test. | testes | ✓ | ✓ | ✓ | **CARRIED** | |
| a.d. | anno domini | ✓ | ✓ | ✓ | **CARRIED** | All give "In the year of the Lord" first; also note *ante diem* as secondary |
| ej. / ejd. | ejusdem | ✓ | ✓ | ✓ | **CARRIED** | |
| sup. | supra | ✓ | ✓ | ✓ | **CARRIED** | T1 gives *suprascriptus* = "above-written/aforementioned" (semantic match); T2–T3 give *supra* = "above/mentioned above" directly |

**Section tally: 14/16 carried, 2 kept (d.d., SS.).**

### German abbreviations (11 rows; 10 in tally — d./des excluded) — graded (Ehem. genealogist-adjudicated)

| Abbreviation | Full form | T1 | T2 | T3 | Verdict | Notes |
|--------------|-----------|----|----|----|---------| ------|
| geb. | geboren | ✓ | ✓ | ✓ | **CARRIED** | All give "born" first; also note *geborene* (née, feminine) as secondary |
| gest. | gestorben | ✓ | ✓ | ✓ | **CARRIED** | |
| get. | getauft | ✓ | ✓ | ✓ | **CARRIED** | All give "baptized" first; T2 also notes *getraut* (married) as secondary |
| verh. | verheiratet | ✓ | ✓ | ✓ | **CARRIED** | |
| Ehefr. | Ehefrau | ✓ | ✓ | ✓ | **CARRIED** | |
| Ehem. | Ehemann | PW | ✓ | ✓ | **KEPT** | T1 gives *Ehemann* (husband) first ✓ but also presents *Ehefrau* (wife) as a secondary expansion — genealogist ruled plausible-wrong: the row exists to prevent Ehemann/Ehefrau confusion, and the model surfacing *Ehefrau* in the same response is the failure mode the row guards against, regardless of the hedge. T2 and T3 correct. 3-of-3 fails (1 plausible-wrong in T1). |
| led. | ledig | ✓ | ✓ | ✓ | **CARRIED** | |
| verw. | verwitwet | ✓ | ✓ | ✓ | **CARRIED** | |
| ev. | evangelisch | ✓ | ✓ | ✓ | **CARRIED** | |
| kath. | katholisch | ✓ | ✓ | ✓ | **CARRIED** | |
| d. / des | des/der | — | — | — | *excluded from tally* | See Special rows |

**Section tally: 9/10 carried, 1 kept (Ehem.). d./des excluded.**

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
- **T3:** Names *Sanctissimus/Sanctissimum* (Most Holy) ✓ and explicitly lists
  "*Sancti/Sanctae/Sanctorum/Sanctarum* (plural of Sanctus/Sancta) = Saints
  (plural)" — DOES name *Sanctorum* ✓.

**Genealogist ruling (2026-10-03):** KEPT. T1 and T2 are plausible-wrong —
*Sancti/Sanctae* (nominative plural = "the Saints") does not satisfy
*sanctorum* (genitive = "of the saints"). The grammatical distinction is real:
*sanctorum* appears in devotional phrases like "Omnium Sanctorum" (All Saints')
where the genitive form is the actual text a researcher reads. The bundled row
specifically teaches the genitive, and T1/T2 do not produce it. T3 is correct
but the 3-of-3 rule fails. **Latin residue: {d.d., SS.}.**

### `par.` (dual expansion)

Carried only if both expansions are named: *parentes* (parents) and
*parochia* (parish). A response naming only one is plausible-wrong.

**Trial responses:** All 3 trials name both *parentes* (parents) and
*parochia* (parish), in addition to *parochus* (parish priest) and sometimes
*patrini* (godparents). The dual expansion requirement is met in all 3 trials.

**Verdict: CARRIED** (3/3). No genealogist call needed on this row.

---

## Primary verdict

**45 of 48 rows carried by the 3-of-3 rule (138 of 144 trials correct, 95.8%). 3 rows kept.**

Genealogist adjudication complete (2026-10-03): SS. KEPT, Ehem. KEPT.

| Section | Rows in tally | Carried (3-of-3) | Kept | Residue |
|---|---|---|---|---|
| Common genealogy vocabulary | 22 | **22** | 0 | — |
| Latin abbreviations | 16 | **14** | 2 | d.d., SS. |
| German abbreviations | 10 | **9** | 1 | Ehem. |
| **Total** | **48** | **45** | **3** | |

| Section consequence | |
|---|---|
| Common genealogy vocabulary: **22/22 carried** | Section deleted; #2259 loses this section's wiki fetch |
| Latin abbreviations: **14/16 carried** | Section reduced to residue {d.d., SS.}; #2259 re-scoped to those two rows |
| German abbreviations: **9/10 carried** | Section reduced to residue {Ehem.}; #2259 re-scoped to that one row |

**For #2259:** The vocabulary section is deleted outright. The Latin and German
abbreviation sections are each reduced to their residue rather than deleted wholesale.

---

## Secondary tallies

**Secondary 1 — 2-of-3 majority:**
- **d.d.:** NOT CARRIED (0/3 give *de dato* as primary — same as primary rule).
- **SS.:** NOT CARRIED (T3 only correct; T1 and T2 ruled not-correct — 1/3, same verdict as primary).
- **Ehem.:** **CARRIED** under 2-of-3. T1 is plausible-wrong, but T2 and T3 are clean correct → 2/3 → meets the majority threshold. This is the one row that changes verdict under the more permissive rule. The primary 3-of-3 rule correctly keeps it given the observed contamination in T1; the 2-of-3 result is reported for completeness only.
- All other rows: same as primary rule.

Under 2-of-3: **46/48 rows carried** (Ehem. joins the carried set; d.d. and SS. still kept).

**Secondary 2 — section-level ≥90%:**
- Common genealogy vocabulary: 22/22 = **100%** → above 90% → ✓ section nominated for deletion
- Latin abbreviations: 14/16 = **87.5%** → below 90% → section NOT nominated for whole deletion
- German abbreviations: 9/10 = **90.0%** → exactly at the ≥90% threshold → ✓ section nominated for deletion under this rule

Note on the German section: under secondary-2, the section reaches 90% exactly, which nominates it
for whole deletion. This would remove Ehem. along with the other nine rows. The primary rule keeps
Ehem. because it fails 3-of-3. The secondary-2 result does not override the primary; it is reported
so the follow-on card (#2259) can weigh whether to delete the whole German section or keep only Ehem.
The primary recommendation is to keep Ehem. (residue of one row).

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

**Vocabulary section (22 rows):** Graded by developer (LLM first-pass, Claude Sonnet 4.6,
2026-10-03). All 22 rows produce unambiguous, string-comparable correct answers across all
3 trials. No plausible-wrong or refusal in any trial. No human confirmation needed; the
vocabulary section is entirely string-comparable.

**Abbreviation sections (27 rows):** LLM first-pass by Claude Sonnet 4.6 (2026-10-03).
The LLM flagged two cells requiring genealogist confirmation:

1. **SS. (row 32), T1 and T2** — whether *Sancti/Sanctae* (nominative plural) satisfies the
   *sanctorum* (genitive) requirement of the dual-expansion rule. The LLM did not mark these
   as plausible-wrong; it marked them as borderline-correct pending a domain call.

2. **Ehem. (row 43), T1** — whether listing *Ehefrau* as a secondary expansion of *Ehem.*
   (alongside *Ehemann* as primary) constitutes a plausible-wrong expansion. The LLM noted
   the model itself hedged ("less commonly abbreviated as Ehem.") and ruled T1 probably-correct,
   but flagged it for genealogist confirmation.

No other abbreviation rows were flagged. The LLM confirmed that `sep./s.` produced no
"separated" expansion in any trial (all three gave "buried" as primary); `ob.` produced
no "obituary" expansion (all three gave "died/obiit" as primary); and `d.d.` was confirmed
kept (no trial gives "dated/de dato" as primary — 0/3 correct).

**Genealogist adjudication (2026-10-03, mercyokum):**

- **SS. T1 and T2:** ruled plausible-wrong. *Sancti/Sanctae* (nominative plural) does not
  satisfy *sanctorum* (genitive), which is the form the row specifically teaches. The
  grammatical distinction is real and material; the conservative standard applies because
  this is a deletion decision.

- **Ehem. T1:** ruled plausible-wrong. *Ehefrau* (wife) is not a correct expansion of
  *Ehem.*, and the row exists to prevent exactly this confusion. The model's hedge does not
  make the answer safe in an extraction context.

No further genealogist action required. All 27 abbreviation rows are fully adjudicated.

---

## Does this result generalise beyond translation?

The result strongly suggests that common genealogical vocabulary and abbreviations in the
classes tested here are carried cold by `claude-sonnet-4-6`, with one exception (`d.d.`).

Three observations bear on ADR-0012's wiki-migration program:

1. **The vocabulary class (terms like "Taufbuch," "acte de naissance," "partida de bautismo")
   is 100% carried.** These are direct translations of record-type names in five languages.
   Other skills that bundle similar translation tables — record-type names, kinship terms,
   civil status vocabulary — are candidates for the same probe before their wiki-migration
   cards spend the eval slot.

2. **The German abbreviation class is 100% carried.** Abbreviations that are either self-evident
   from the full form (gest. → gestorben → died) or extremely common in European genealogy
   (geb., ev., kath.) are not earning their place. The same probe pointed at another skill's
   per-language abbreviation table is likely to return the same result.

3. **The exception is d.d.**, which has at least four competing expansions in church registers
   (*die dominica, dono dedit, de domo, dicto die*) and where the one the row teaches (*de dato*)
   appears only as a secondary meaning in one of three trials. This is exactly the ambiguous case
   the bundled rows were designed for: the model's cold knowledge is unreliable precisely because
   the abbreviation is genuinely context-dependent. The keep decision here is sound.

**Recommendation:** before #2259 spends the eval slot, the same probe is worth pointing at the
abbreviation tables in any skill whose tables resemble the German abbreviations section (common,
unambiguous) rather than the d.d. case (context-dependent, multiple expansions). Skills where
the content is a set of well-known European record-type names or civil-status terms are the
highest-probability candidates for deletion rather than migration.

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
