# translation invocation audit

**Issue:** #2074. **Siblings:** #2106 (shared root cause — zero-invocation
skills), #2105 (`historical-context`, the model for this write-up), #2107
(`convert-dates`), #2259 (the word-list move that waits on this outcome).
**Date:** 2026-09-08. **Scope:** the `translation` skill and the committed e2e
run logs under `eval/runlogs/e2e/`.

This is the measurement the 2026-09-02 ruling ordered, not a plan. It answers
one question — **does inline handling of non-English records degrade, measured
from the committed logs, enough to justify wiring a translation step or
retiring the skill?** — and produces neither card. It edits no skill, no test,
no fixture, and proposes no prose change. The answer is: **too thin to tell,
and the binding reason is the log, not the corpus.** What run-produced
vernacular output *is* visible shows no degradation; the log does not preserve
enough to check the axis that would.

## Provenance

Every figure was computed from the **162 committed e2e run logs** under
`eval/runlogs/e2e/` and the **137 fixture directories** under
`eval/tests/e2e/` (the 138th entry is a `.gitkeep`, not a fixture), as they
stood on `main` at commit `f8daba32`. 94 of the 137 fixtures carry at least one
committed run. The scripts that produce every number
below are in **Reproduce**; the reviewer re-runs them (CI cannot check a
measurement).

**These figures drift from the 2026-09-07 review numbers on the same card, in
the expected two ways.** The corpus gained a run since (160 → 161) and one more
fixture gained its first run (93 → 94 with runs), and — as the card itself
warned — the non-English/English split moves with the **country set** chosen
(the card's body got 27, the review 31, the thread 58). The set used here is
stated in the next section. None of the drift changes the outcome.

Since the first measurement the corpus gained one further run (161 → 162): a
new **English-dominant** run of the already-counted `spriggs-parents-1898`
fixture (committed on `main` after this audit was drafted). It accounts for all
the movement below — the corpus total, the English-group runs/facts/assertions
and pass verdicts, and the `locality-guide`/`search-records` invocation tallies.
The non-English group, the machine axis, the log axis, the population split, and
the outcome are unchanged.

**That is the general shape, so the figures below are pinned rather than
chased.** A run committed after `f8daba32` moves a bounded set and nothing else:
the corpus total, its own language group's row, and the per-skill invocation
tallies — plus, when that fixture had no prior run, the fixtures-with-runs count
and that group's share of the population split. One such run landed between the
pin and this document's merge (`francis-fisher-spouse`, a first run of an
**English-dominant** fixture, #2295 via #2368), so a reviewer who runs the
scripts at the merge commit rather than at `f8daba32` should expect **163** runs
over **95** fixtures-with-runs, **58** English-dominant fixtures at 109 runs /
980 facts / 6,232 assertions / 67 pass, corpus-wide `image_transcribe` **456**
calls / 236 heads / 194 real / 42 error, and `record-extraction` **129** /
`search-records` **208** / `locality-guide` **77**. The **36** non-English
fixtures every finding here rests on, both axes, and the outcome are unchanged.

## The premise still holds: zero invocations, and the corpus needs it

`translation` has **0** `Skill` invocations across the 162 runs. So do
`convert-dates` (**0**) and `historical-context` (**0**). For scale in the same
corpus: `record-extraction` **127**, `search-records` **207**, `locality-guide`
**76**. This reproduces the card's headline and #2105's finding.

**"Add it to the `research/SKILL.md` routing table" is not pursued** — it is
refuted by #2106 and by the sibling audit: naming predicts invocation in
neither direction (`hypothesis-tracking` is a routing-table row at 0;
`check-warnings` is named nowhere and fires 40 times). The 0 count is the
premise, not the fix.

## Population, and the country set used

Classifying each of the 94 fixtures-with-runs by the **dominant country of its
seed-tree `standard_place` values** (the country is the last comma-segment;
dominant = most frequent across the starting tree's facts):

- **36 non-English-dominant**, **57 English-dominant**, **1 with no country in
  its seed tree** (`william-ferber-ancestry`).
- Non-English countries: Norway 4, Mexico 3, Slovakia 3, Bolivia 2, Brazil 2,
  Denmark 2, France 2, Netherlands 2, and one each of Austria, Chile, Colombia,
  Croatia, Czechia, Duchy of Nassau, Ecuador, El Salvador, Germany, Honduras,
  Italy, Philippines, Portugal, Romania, South Africa, Sweden.

**The English set is stated so the split is reproducible** (the card asks which
set was used): `United States`, `England`, `Wales`, `Scotland`, `Ireland`,
`Northern Ireland`, `United Kingdom`, `Canada`, `Australia`, `New Zealand`,
`Isle of Man` (plus the `USA` / `United States of America` spellings). Irish and
Manx records are treated as English-language; a reviewer who moves Ireland,
South Africa, or the Philippines across the line will get a count a few fixtures
different, which is why this classification is **a starting point, not a
finding**.

## What the committed logs preserve, and do not

Nothing below is attributed to the agent without diffing run output against the
fixture's seed state: run-produced tree facts are those whose `id` is absent
from `starting-tree.gedcomx.json`; run-produced assertions are those whose `id`
is absent from `starting-research.json`. That diff is the error that voided the
last attempt on this card.

| Available in the repo | Where |
|---|---|
| Every assertion a run wrote, with `record_id` | `run-*.final-research.json` (image-sourced carry a `3:1:` ARK, indexed `1:1:`) |
| Every run-produced tree fact | `run-*.final-tree.gedcomx.json` diffed against the seed tree |
| Judge verdict per run | `run-*.json` → `verdict` / `outcome` |
| The transcription the extractor read | **Only a decoded ≤500-char head**, in `tool_calls[].response_summary` of `image_transcribe` — present on 235 of 455 calls corpus-wide (193 real transcriptions; the other 42 are `{"error":…}` tool-failure payloads, not transcriptions), absent on older runs |
| The ARK a transcription was for | `image_transcribe`'s `args.ark` — **recorded as `None` on 207 of 221 non-English calls** |
| Full subagent transcripts / delegation messages | **Not committed** — `subagents[].transcript` is a filename, `*.session.jsonl` is gitignored |

## Run-produced output, by group

Over run-produced rows only (diffed against seed):

| group | runs | tree facts | assertions | image-ARK | indexed | other | pass / fail / partial |
|---|--:|--:|--:|--:|--:|--:|--|
| non-English-dominant | 53 | 150 | 2,024 | 111 | 1,580 | 333 | 24 / 22 / 7 |
| English-dominant | 108 | 974 | 6,208 | 359 | 5,536 | 313 | 66 / 19 / 23 |

The verdict split is **confounded** by FamilySearch coverage and fixture
difficulty and is a starting point, not a finding: the non-English group's
lower pass rate (45% vs 61%) says nothing about translation on its own.

## Axis 1 — vernacular dates (machine-checkable, and thin by construction)

The one axis a script can grade: run-produced facts whose free-text `date`
carries a vernacular month or the Iberian `de … de` frame, and whether the
`standard_date` beside it is correct. Across all 36 non-English-dominant
fixtures there are **6 such facts, all in one fixture** (`antonio-lucas-spouse`,
Portuguese), and **all 6 are rendered to a correct perfect day-month-year
`standard_date`**:

| vernacular `date` | `standard_date` |
|---|---|
| `20 de setembro de 1886` | `20 Sep 1886` |
| `trinta dias do mês de Maio do anno de mil oitocentos oitenta e nove` | `30 May 1889` |
| `11 de outubro de 1886` | `11 Oct 1886` |
| `13 de novembro de 1892` | `13 Nov 1892` |
| `26 de dezembro de 1892` | `26 Dec 1892` |
| `5 de setembro de 1894` | `5 Sep 1894` |

The card's second fixture on this axis, `mckee-birth-1904`, carries the English
range `January–March 1904`, not a vernacular date, so a precise detector
excludes it. Six correct renderings in one fixture is not a sample that can
distinguish "adequate" from "lucky."

**Two cautions for a reader reproducing this axis.** First, the detector is
**Romance-only**: `VERN` lists Portuguese, Spanish, Italian and French month
names plus the Iberian `de … de` frame, and nothing Nordic, Germanic,
West-Slavic, Romanian, Croatian or Latin. Extending it to those families adds
**no** genuine run-produced vernacular date, and it was checked in both
directions: the spellings that *differ* from English (`marts`, `mai`, `juni`,
`augusti`, `März`, `srpen`, `Septembris`, `siječanj` …) add **zero** matches,
while the five spellings *identical* to English (`april`, `august`, `september`,
`november`, `december`) add **six**, every one an English-form date and therefore
a false positive: `23 December 1883` and `31 December 1883`
(`birkeland-death-1883`), `5 August 1906` (`cruz-corona-ancestry`),
`28 September 1810` twice (`elisabetha-sugecz-parents`) and `27 April 1884`
(`susanna-szljacsan-spouse`). The table's **6** is the count, not an artefact of
a narrow regex. Second, those 6 are **seed-subtracted**. A reader who instead
counts every vernacular-`date` fact across all final trees, without subtracting
the seed tree, gets **54 facts across 11 fixtures — but 48 of them
are seeded** (already present in the starting tree, so not run-produced),
leaving the same **6** run-produced. The larger number measures the fixtures'
seed data, not what the runs wrote.

**A caveat on reading `standard_date` well-formedness as a quality signal:** a
month-dropped value like `27 1749` fails `isPerfectStandardDate`
(`packages/engine/mcp-server/src/utils/fact-helpers.ts`,
`/^\d{1,2}\s+(Jan…Dec)\s+\d+$/`) and is then *skipped* by every consumer that
filters on perfect dates, so it reads as a legitimately year-only date rather
than an error. Counting malformed `standard_date`s therefore under-reports, and
is not used here as a degradation metric.

## Axis 2 — names, occupations, relationship terms (the axis that would tell us)

This is the axis that would actually answer the question, and the method the
card prescribes is: for each preserved transcription head in a non-English
fixture, is the head vernacular, and are the assertions **citing the same
`record_id`** consistent with it — names kept in original form, occupation and
relationship terms not mistranslated?

**That record-linked read is not doable from the committed logs.** Of the 221
non-English `image_transcribe` calls, 177 returned a non-empty head — but **37
of those are `{"error":…}` tool-failure payloads, not transcriptions**, leaving
**140 real transcription heads**. Decoding those, **90 are genuinely vernacular**
(Czech `Měsyc a Den, Křtící kněz, Gměno
dítěte`; Danish `Døbt, Forældre, Kirkebog`; Swedish `Barsebäck KyrkioBook,
FÖDDE VIGDE DÖDE`) — of the 95 heads whose decoded text carries non-ASCII, 5
are error payloads whose message text happens to be accented, not vernacular
records. But only **14 of the 221 calls recorded a real `ark`** (the
rest are `None`), and only **1** head links to a persisted ARK-bearing
assertion — **0** of the vernacular heads do. The transcription cannot be tied
to the assertions it produced, so the consistency check the card specifies has
no population.

**Fixture-level fallback read (n = 3 fixtures), reported for what it is.** Where
the head and the run-produced name/relationship assertions are both visible in
the same fixture — even without record-level linkage — the vernacular text
itself survives into the assertions; whether the run then used it correctly is a
separate question, and on one of the three it did not:

- `chresten-nielsen-daughter` (Danish): names kept in original form —
  `Chresten Nielsen`, `Børte Kirstine`, patronymics `Sørensd` / `Christensd`
  preserved rather than anglicised; one assertion honestly flags OCR
  illegibility instead of guessing.
- `elena-asmundsdotter-origin` (Swedish): the vernacular indexed spelling
  `Assmen Nielsson` is preserved *with* an explicit normalisation note (`[?] …
  likely Asmund Nilsson`), not silently translated — but this fixture is
  **evidence of transcription fidelity only, not of adequate handling.** Its
  committed grades are `false` on every finding across all three runs; the
  2026-08-25 annotation records the faithfully-transcribed name attached to the
  wrong man: "Wrong father asserted and written to the tree: a ParentChild from
  'Assmen Nielsson' to Elena … The expected father is Asmund Torsson of
  Henckestorp." Keeping the spelling in original form did not prevent a wrong
  relationship, so this leg supports "the head was preserved," not "the run
  handled the record adequately."
- `anna-findejsova-daughter` (Czech/German): `Maxmilian Michal` / `Michl`,
  `Agnes`, `Anna` — original forms, no mistranslation.

This is three fixtures with a handful of name assertions each, read at the
fixture level because the record level is unavailable. On transcription fidelity
all three keep the head in original form; but as an *adequacy* signal only two
legs stand (`chresten-nielsen-daughter`, `anna-findejsova-daughter`), since
`elena-asmundsdotter-origin` graded `false` throughout. Even those two are thin
— `chresten`'s `f1` is `true` in run 1 and `false` in run 2 — so the read is at
most consistent with "inline handling is adequate," and it is nowhere near
enough to establish it.

## The outcome the data supports

**Too thin to tell — and it is chiefly the log that is thin, not only the
corpus.** Both sub-cases the card names are true, and the second is binding:

- *The corpus* is thin on the machine-checkable axis: 6 run-produced vernacular
  dates in one fixture.
- *The log* is thin on the axis that would actually decide it: the extractor's
  input is preserved only as a ≤500-char head, and the `ark` that would tie that
  head to the assertions it produced is `None` on 207 of 221 non-English calls,
  with full subagent transcripts uncommitted. 90 vernacular transcriptions are
  visible and essentially none is checkable against run output. (A further 37 of
  the 221 non-English calls returned an `{"error":…}` payload rather than a
  transcription; that transcribe-failure rate is itself a harness signal for the
  #2189 card — preserve the input and the link — not a translation-quality
  signal.)

Per the ruling, that second case is a **harness card** (developer, the shape of
#2189: preserve the extractor's input and the transcription→assertion link),
**not** a fixture card and **not** a `translation` skill edit. It is the more
likely one, and this measurement confirms it.

## Why neither action card is opened

- **Not "wire a pre-spawn translation step into `record-extraction`."** That
  costs the most-contended snapshot after `research` (~$9.52,
  `v1_2026-09-02_15-21-24`) on a hypothesis the data does not support: no
  run-produced vernacular output measured here is wrong. Also note `translation`
  writes nothing (`SKILL.md`, "Re-invocation behavior"), so in an autonomous run
  a narrate-only skill cannot move the e2e metric on its own — its only useful
  form would be exactly such a pre-spawn step whose output is carried into the
  delegation, and there is no evidence yet that the step is needed.
- **Not "narrow or retire `translation`."** That deletes a capability over a
  third of the corpus on the same absent evidence, and the fixture-level read,
  thin as it is, does not support retirement: on transcription fidelity it rests
  on two of its three legs (the third, `elena-asmundsdotter-origin`, graded
  `false` throughout), which is a reason not to act on absent evidence rather
  than proof the handling is adequate. #2259's word-list move stays blocked on
  this outcome.

## Limit of this measurement

The run logs capture `tool_calls` and a bounded response head, not narration or
subagent transcripts. This audit measures what runs **wrote** and the ≤500-char
transcription **heads** — it cannot see what the extractor reasoned about a
vernacular record without persisting it. **These numbers are a floor, not a
ceiling**, and the central finding is precisely that the ceiling is not
observable from the committed logs.

## Conclusion

Do not wire, do not retire, do not edit the `translation` skill, its tests, or
its description on this evidence. The zero-invocation count is not shown to be a
defect and is not shown to be correct behaviour either — the measurement that
would decide it cannot be run against the committed logs.

The actionable residue is a **harness card** (shape of #2189): preserve the
`image_transcribe` input the extractor reads — beyond the 500-char head — and
record the `ark` (or another stable key) on the call so a transcription can be
tied to the assertions derived from it. Until that lands, this question is not
answerable from run logs, and #2259 should treat the inline path as unmeasured
rather than adequate.

## Reproduce

Run both from the repo root. Stdlib only.

**Invocation counts per skill** (the #2161 script, confirming the 0):

```python
import json, glob, collections, os, pathlib
c = collections.Counter()
for f in glob.glob('eval/runlogs/e2e/*/run-*.json'):
    if f.endswith('.ann.json') or '.final-' in f:
        continue
    for t in json.loads(pathlib.Path(f).read_text(encoding='utf-8')).get('tool_calls', []):
        if t.get('tool') in ('Skill', 'SlashCommand'):
            a = t.get('args') or {}
            c[str(a.get('skill') or a.get('command') or '').lstrip('/')] += 1
for s in sorted(os.listdir('packages/engine/plugin/skills')):
    print(f'{s:26s}{c.get(s, 0):5d}')
```

**Everything else** — corpus size, the population split (with the stated country
set), the run-produced fact/assertion/verdict split per group, Axis 1 (vernacular
dates and their `standard_date`), the detector-coverage probe behind the Axis-1
caution, and Axis 2 (head coverage, how many decode to vernacular, how many
carry a real `ark`, how many link to a persisted assertion):

```python
import json, glob, re, pathlib, collections, sys
sys.stdout.reconfigure(encoding='utf-8')
RUN = pathlib.Path('eval/runlogs/e2e'); FIX = pathlib.Path('eval/tests/e2e')

# Records in these jurisdictions are English-language; everything else is
# treated as non-English-dominant. Stated so the split is reproducible.
ENGLISH = {'United States', 'United States of America', 'USA', 'England', 'Wales',
    'Scotland', 'Ireland', 'Northern Ireland', 'United Kingdom', 'Canada',
    'Australia', 'New Zealand', 'Isle of Man'}

def load(p): return json.loads(pathlib.Path(p).read_text(encoding='utf-8'))
def country(sp): return sp.split(',')[-1].strip() if sp else None
def tree_facts(t):
    for p in t.get('persons') or []:
        for f in p.get('facts') or []: yield f.get('id'), f
    for r in t.get('relationships') or []:
        for f in r.get('facts') or []: yield f.get('id'), f
def runs():
    for rj in sorted(glob.glob(str(RUN / '*/run-*.json'))):
        if rj.endswith('.ann.json') or '.final-' in rj: continue
        s = rj[:-5]
        yield pathlib.Path(rj).parent.name, rj, s + '.final-research.json', s + '.final-tree.gedcomx.json'
def ark_class(rid):
    rid = rid or ''
    return 'image' if '3:1:' in rid else 'indexed' if '1:1:' in rid else 'other'
def ark_id(s):
    m = re.search(r'(3:1:[0-9A-Za-z-]+|1:1:[0-9A-Za-z-]+)', s or ''); return m.group(1) if m else None
def decode_head(rs):
    # Returns (is_error, text). is_error is True when the head is an
    # {"error": ...} tool-failure payload rather than a transcription; those
    # are failed calls, not preserved vernacular, and must not be counted as
    # real transcription heads or as vernacular.
    if rs is None: return (False, '')
    txt = str(rs)
    for _ in range(3):
        try: v = json.loads(txt)
        except Exception: break
        if isinstance(v, list) and v and isinstance(v[0], dict): v = v[0]
        if isinstance(v, dict):
            if 'error' in v: return (True, json.dumps(v, ensure_ascii=False))
            if 'transcription' in v: return (False, str(v['transcription']))
            if 'text' in v: txt = str(v['text']); continue
            return (False, json.dumps(v, ensure_ascii=False))
        txt = str(v)
    return (False, txt)
PERFECT = re.compile(r'^\d{1,2}\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d+$')
VERN = re.compile(r'\b(setembro|outubro|dezembro|janeiro|fevereiro|mar[çc]o|maio|junho|julho|'
    r'agosto|novembro|abril|enero|febrero|marzo|mayo|junio|julio|septiembre|octubre|noviembre|'
    r'diciembre|gennaio|febbraio|maggio|giugno|luglio|settembre|ottobre|dicembre|janvier|f[ée]vrier|'
    r'avril|juillet|septembre|octobre|d[ée]cembre)\b', re.I)
IBER = re.compile(r'\bde\b.*\bde\b', re.I)
NONASCII = re.compile(r'[^\x00-\x7f]')

inv = collections.Counter(); run_files = []
for fx, rj, fr, ft in runs():
    run_files.append(rj)
    for t in load(rj).get('tool_calls') or []:
        if t.get('tool') in ('Skill', 'SlashCommand'):
            a = t.get('args') or {}; s = str(a.get('skill') or a.get('command') or '').lstrip('/')
            if s: inv[s] += 1
fixtures = sorted(set(f for f, _, _, _ in runs()))
print(f'corpus: runs={len(run_files)} fixtures-with-runs={len(fixtures)} '
      f'fixture-dirs={sum(1 for p in FIX.iterdir() if p.is_dir())}')
print(f'invocations: translation={inv["translation"]} record-extraction={inv["record-extraction"]} '
      f'convert-dates={inv["convert-dates"]} historical-context={inv["historical-context"]} '
      f'locality-guide={inv["locality-guide"]} search-records={inv["search-records"]}')

fc = {}
for fx in fixtures:
    st = FIX / fx / 'starting-tree.gedcomx.json'
    ctr = collections.Counter(c for _, f in tree_facts(load(st)) if (c := country(f.get('standard_place')))) if st.exists() else collections.Counter()
    fc[fx] = ctr.most_common(1)[0][0] if ctr else None
def grp(fx):
    c = fc.get(fx); return None if not c else ('Eng' if c in ENGLISH else 'nonEng')
noneng = [f for f in fixtures if grp(f) == 'nonEng']
print(f'population: non-English={len(noneng)} English={sum(grp(f) == "Eng" for f in fixtures)} '
      f'no-country={[f for f in fixtures if grp(f) is None]}')
print(f'non-English countries: {dict(collections.Counter(fc[f] for f in noneng))}')

agg = {g: {'runs': 0, 'facts': 0, 'assertions': 0, 'ark': collections.Counter(), 'v': collections.Counter()} for g in ('nonEng', 'Eng')}
vern = collections.Counter()
for fx, rj, fr, ft in runs():
    g = grp(fx)
    if g is None: continue
    agg[g]['runs'] += 1
    agg[g]['v'][str(load(rj).get('verdict') or load(rj).get('outcome') or 'none')] += 1
    seed_f = set(i for i, _ in tree_facts(load(FIX / fx / 'starting-tree.gedcomx.json'))) if (FIX / fx / 'starting-tree.gedcomx.json').exists() else set()
    if pathlib.Path(ft).exists():
        for i, f in tree_facts(load(ft)):
            if i in seed_f: continue
            agg[g]['facts'] += 1
            d = str(f.get('date') or '')
            if g == 'nonEng' and (VERN.search(d) or (IBER.search(d) and re.search(r'\d', d))):
                vern[fx] += 1
                print(f'  vern-date {fx} {f.get("type")} {d!r} -> {(f.get("standard_date") or "").strip()!r} '
                      f'perfect={bool(PERFECT.match((f.get("standard_date") or "").strip()))}')
    seed_a = set(a.get('id') for a in (load(FIX / fx / 'starting-research.json').get('assertions') or [])) if (FIX / fx / 'starting-research.json').exists() else set()
    if pathlib.Path(fr).exists():
        for a in load(fr).get('assertions') or []:
            if a.get('id') in seed_a: continue
            agg[g]['assertions'] += 1; agg[g]['ark'][ark_class(a.get('record_id'))] += 1
for g in ('nonEng', 'Eng'):
    a = agg[g]
    print(f'[{g}] runs={a["runs"]} facts={a["facts"]} assertions={a["assertions"]} '
          f'image={a["ark"]["image"]} indexed={a["ark"]["indexed"]} other={a["ark"]["other"]} verdicts={dict(a["v"])}')
print(f'machine-axis vernacular-date facts: {dict(vern)} total={sum(vern.values())}')

# Corpus-wide head coverage (the 235/455 line in the provenance table), split
# into real transcriptions vs {"error": ...} tool-failure payloads.
cw_calls = cw_heads = cw_real = cw_err = 0
for fx, rj, fr, ft in runs():
    for tc in load(rj).get('tool_calls') or []:
        if 'image_transcribe' not in (tc.get('tool') or ''): continue
        cw_calls += 1
        rs = tc.get('response_summary')
        if not (rs and str(rs).strip()): continue
        cw_heads += 1
        if decode_head(rs)[0]: cw_err += 1
        else: cw_real += 1
print(f'corpus-wide image_transcribe: calls={cw_calls} heads={cw_heads} '
      f'real-transcription={cw_real} error-payload={cw_err}')

calls = heads = heads_real = err_heads = vh = vh_real = real = linked = 0
for fx, rj, fr, ft in runs():
    if grp(fx) != 'nonEng': continue
    seed_a = set(a.get('id') for a in (load(FIX / fx / 'starting-research.json').get('assertions') or [])) if (FIX / fx / 'starting-research.json').exists() else set()
    by = collections.defaultdict(list)
    if pathlib.Path(fr).exists():
        for a in load(fr).get('assertions') or []:
            if a.get('id') in seed_a: continue
            k = ark_id(a.get('record_id'))
            if k: by[k].append(a)
    for tc in load(rj).get('tool_calls') or []:
        if 'image_transcribe' not in (tc.get('tool') or ''): continue
        calls += 1
        rs = tc.get('response_summary')
        if not (rs and str(rs).strip()): continue
        heads += 1
        is_err, txt = decode_head(rs)
        if is_err: err_heads += 1
        else: heads_real += 1
        if NONASCII.search(txt):
            vh += 1
            if not is_err: vh_real += 1
        ark = (tc.get('args') or {}).get('ark')
        k = ark_id(ark) if (ark and str(ark) != 'None') else None
        if k: real += 1
        if k and by.get(k): linked += 1
print(f'log-axis (non-English): transcribe calls={calls} heads={heads} '
      f'real-transcription-heads={heads_real} error-payload-heads={err_heads} '
      f'vernacular-heads={vh_real} (+{vh - vh_real} accented error payloads) '
      f'real-ark={real} head-linked-to-assertion={linked}')

# Detector coverage, both directions (the Axis-1 caution): extending the
# Romance-only VERN to the other families adds no genuine vernacular date.
# Spellings that DIFFER from English add nothing; the five identical to English
# add only English-form dates, which is what makes the 6 above robust.
DIFFERS = (r'januar|februar|marts|mars|maj|mai|juni|juin|juli|ao[uû]t|januari|februari|augusti|'
    r'oktober|J[aä]nner|M[aä]rz|Dezember|leden|ledna|[uú]nor|b[rř]ezen|duben|kv[eě]ten|[cč]erven|'
    r'[cč]ervenec|srpen|z[aá][rř][ií]|[rř][ií]jen|listopad|prosinec|ianuarie|martie|aprilie|iunie|'
    r'iulie|septembrie|octombrie|noiembrie|decembrie|si[jJ]e[cč]anj|velja[cč]a|o[zž]ujak|travanj|'
    r'svibanj|lipanj|srpanj|kolovoz|rujan|studeni|prosinac|Januarii|Februarii|Martii|Aprilis|Maii|'
    r'Junii|Julii|Augusti|Septembris|Octobris|Novembris|Decembris')
IDENTICAL = r'april|august|september|november|december'
def extra(ext):
    pat = re.compile(r'\b(?:' + ext + r')\b', re.I); out = []
    for fx, rj, fr, ft in runs():
        if grp(fx) != 'nonEng' or not pathlib.Path(ft).exists(): continue
        st = FIX / fx / 'starting-tree.gedcomx.json'
        seed = set(i for i, _ in tree_facts(load(st))) if st.exists() else set()
        for i, f in tree_facts(load(ft)):
            if i in seed: continue
            d = str(f.get('date') or '')
            if VERN.search(d) or (IBER.search(d) and re.search(r'\d', d)): continue
            if pat.search(d): out.append((fx, f.get('type'), d))
    return out
print(f'detector coverage: differs-from-English adds={len(extra(DIFFERS))} '
      f'identical-to-English adds={len(extra(IDENTICAL))}')
for e in extra(IDENTICAL): print(f'  false positive {e}')
```

The fixture-level Axis-2 read (`n = 3`) is a genealogist's read of the decoded
heads against each fixture's run-produced name/relationship assertions; the
material is dumped per fixture by filtering the loop above to one fixture and
printing `decode_head`'s decoded text (its second tuple element) alongside the
`name` / `relationship` assertions. It is
recorded as a read, not a script output, because judging "kept in original
form / not mistranslated" is the judgement the card reserves for a person.
