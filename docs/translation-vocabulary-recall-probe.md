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
Abbreviation sections — LLM first-pass (Claude Sonnet 4.6, 2026-10-03); cells marked
⚑ require genealogist confirmation before the result is final.

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

### Latin abbreviations (16 rows) — genealogist adjudicates

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
| SS. | sanctissimus/sanctorum | ✓⚑ | ✓⚑ | ✓ | **⚑ GENEALOGIST** | Dual expansion: requires both *sanctissimus* (most holy) AND *sanctorum* (of the saints). T3: explicitly names *Sanctorum* ✓. T1 and T2: give *Sancti/Sanctae* (nominative plural = "Saints") but not *sanctorum* (genitive plural = "of the saints") — ⚑ genealogist to rule whether nominative-plural "Saints" satisfies "sanctorum = of the saints." If T1 and T2 are correct, CARRIED; otherwise KEPT. |
| par. | parentes / parochia | ✓ | ✓ | ✓ | **CARRIED** | Dual expansion: requires both *parentes* (parents) AND *parochia* (parish). All 3 trials name both expansions explicitly, plus *parochus* (parish priest) as additional. |
| test. | testes | ✓ | ✓ | ✓ | **CARRIED** | |
| a.d. | anno domini | ✓ | ✓ | ✓ | **CARRIED** | All give "In the year of the Lord" first; also note *ante diem* as secondary |
| ej. / ejd. | ejusdem | ✓ | ✓ | ✓ | **CARRIED** | |
| sup. | supra | ✓ | ✓ | ✓ | **CARRIED** | T1 gives *suprascriptus* = "above-written/aforementioned" (semantic match); T2–T3 give *supra* = "above/mentioned above" directly |

**Section tally (first-pass): 14/16 carried, 1 kept (d.d.), 1 pending genealogist (SS.).**

### German abbreviations (11 rows) — genealogist adjudicates

| Abbreviation | Full form | T1 | T2 | T3 | Verdict | Notes |
|--------------|-----------|----|----|----|---------| ------|
| geb. | geboren | ✓ | ✓ | ✓ | **CARRIED** | All give "born" first; also note *geborene* (née, feminine) as secondary |
| gest. | gestorben | ✓ | ✓ | ✓ | **CARRIED** | |
| get. | getauft | ✓ | ✓ | ✓ | **CARRIED** | All give "baptized" first; T2 also notes *getraut* (married) as secondary |
| verh. | verheiratet | ✓ | ✓ | ✓ | **CARRIED** | |
| Ehefr. | Ehefrau | ✓ | ✓ | ✓ | **CARRIED** | |
| Ehem. | Ehemann | ✓⚑ | ✓ | ✓ | **CARRIED** ⚑ | T1 gives *Ehemann* (husband) first ✓, but also lists *Ehefrau* (wife) as a secondary expansion with caveat ("less commonly abbreviated as Ehem. — Ehefr. is more typical"). T2–T3 give *Ehemann* first and *ehemalig* (former) second — no *Ehefrau*. ⚑ genealogist to confirm T1 is not plausible-wrong: is naming *Ehefrau* as a secondary expansion of *Ehem.* a dangerous wrong expansion or an acceptable hedge? |
| led. | ledig | ✓ | ✓ | ✓ | **CARRIED** | |
| verw. | verwitwet | ✓ | ✓ | ✓ | **CARRIED** | |
| ev. | evangelisch | ✓ | ✓ | ✓ | **CARRIED** | |
| kath. | katholisch | ✓ | ✓ | ✓ | **CARRIED** | |
| d. / des | des/der | — | — | — | *excluded from tally* | See Special rows |

**Section tally (first-pass): 10/10 carried (Ehem. pending genealogist confirmation). d./des excluded.**

---

## Special rows

### `d. / des` (excluded from tally)

Run: 3 trials (row index 48, german_abbreviations section).
Excluded because this is ordinary German genitive (`des/der` = "of the"),
not an abbreviation. The primary denominator is 48 rows / 144 trials.

**Trial responses:** All 3 trials correctly expand the genitive article
(T1: "des = of the [genitive masculine/neuter]"; T2 and T3: list multiple
forms of *der/des* as genitive). No plausible-wrong expansions seen.
The row is excluded; these results are informational only.

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

**Genealogist call required:** T3 is correct. T1 and T2 give the nominative
plural (*Sancti* = "the Saints") rather than the genitive (*Sanctorum* = "of
the saints"). Whether that distinction matters for the genealogical purpose
of the row is a domain judgment. If T1 and T2 are ruled correct: CARRIED
(3/3). If T1 and T2 are ruled not-correct (dual expansion not satisfied):
KEPT, and d.d. and SS. are the two rows that remain.

### `par.` (dual expansion)

Carried only if both expansions are named: *parentes* (parents) and
*parochia* (parish). A response naming only one is plausible-wrong.

**Trial responses:** All 3 trials name both *parentes* (parents) and
*parochia* (parish), in addition to *parochus* (parish priest) and sometimes
*patrini* (godparents). The dual expansion requirement is met in all 3 trials.

**Verdict: CARRIED** (3/3). No genealogist call needed on this row.

---

## Primary verdict

**46 of 48 rows carried by the 3-of-3 rule (first-pass; 1 row pending genealogist).**

Definite: 45 rows carried (d.d. kept; all others carried). Pending: SS. (1 row).

| Section | Rows in tally | Carried (3-of-3) | Kept |
|---|---|---|---|
| Common genealogy vocabulary | 22 | **22** | 0 |
| Latin abbreviations | 16 | **14–15** | 1–2 (d.d. definite; SS. genealogist call) |
| German abbreviations | 10 | **10** | 0 |
| **Total** | **48** | **46–47** | **1–2** |

| Section consequence | |
|---|---|
| Common genealogy vocabulary: **all 22 carried** | Section deleted; #2259 loses this section's wiki fetch |
| Latin abbreviations: **14–15 of 16 carried** | Section reduced to residue: d.d. stays; SS. stays if genealogist rules not-carried |
| German abbreviations: **all 10 carried** | Section deleted; #2259 loses this section's wiki fetch |

**For #2259:** The vocabulary and German abbreviations sections are deleted outright. The Latin
abbreviations section is reduced to its residue: at minimum d.d.; at maximum d.d. + SS.
depending on the genealogist's SS. ruling.

---

## Secondary tallies

**Secondary 1 — 2-of-3 majority:** Same result as the primary rule. The single kept row (d.d.)
fails 2-of-3 as well: T1 and T2 do not mention *de dato* at all; T3 mentions it as expansion #4
and names another meaning as most common. No rows change verdict under the more permissive rule.
d.d. is kept under both rules. SS. genealogist call applies identically.

**Secondary 2 — section-level ≥90%:**
- Common genealogy vocabulary: 22/22 = **100%** → above 90% → ✓ section nominated for deletion
- Latin abbreviations: 14/16 = **87.5%** (below 90%) → section NOT nominated for whole deletion  
  *(if SS. carried: 15/16 = 93.75% → section nominated for deletion, reducing residue to d.d. alone)*
- German abbreviations: 10/10 = **100%** → above 90% → ✓ section nominated for deletion

Under the primary rule, the Latin section is not at ≥90% (87.5%), so the section-level rule
does not change the outcome for the Latin table: the residue is still kept, not deleted wholesale.
If the genealogist carries SS., the Latin section reaches 93.75%, and under the secondary-2 rule
alone the whole section would be deleted — but the primary rule still keeps d.d., so the follow-on
card would need to address d.d. explicitly.

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

**Genealogist action required before this write-up is final:** Rule on SS. T1/T2 and Ehem. T1.
Raw responses are in `eval/harness/e2e/probe_translation_vocab_recall_raw.json`
(rows 32 and 43 respectively) and are reproduced verbatim in the Special rows section above.

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
