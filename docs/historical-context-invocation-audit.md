# historical-context invocation audit

**Issue:** #2105. **Siblings:** #2106 (shared root cause), #2074 (translation),
#2107 (convert-dates).
**Date:** 2026-09-01. **Scope:** the `historical-context` skill and the 159
committed e2e run logs.

This is a measurement write-up, not a plan. It answers one question — **is
`historical-context`'s zero invocation count a routing defect?** — and the
answer is: probably not, and neither proposed fix survives measurement. It
edits no skill and proposes none.

## Provenance

Every figure was computed from the **159 committed e2e run logs** under
`eval/runlogs/e2e/` and the 27 skill directories under
`packages/engine/plugin/skills/`, as they existed at commit **`3cccc28d`**.

All eight headline figures were re-derived on `main` after the branch was
recut, and were identical.

## The premise on #2105 is refuted

#2105 and #2106 proposed that the three dark skills are exactly the three
`research/SKILL.md` does not name. Established by @benter-070 and
@florencemashipei, and confirmed here:

- **12** skill directories are at zero invocations, not 3
- `hypothesis-tracking` is a literal routing-table row and has **0**
- `check-warnings` (**40**) and `search-full-text` (**11**) are named nowhere
  in `research/SKILL.md`

Naming predicts invocation in neither direction. No routing-table row was
added.

## What runs actually write about historical context

68 of the 159 runs invoked `locality-guide`; 91 did not. Scanning what runs
**wrote** — `research_append`, `research_log_append`, `extraction_append`:

| historical-context's remit | sentences | in LG runs (68) | in non-LG runs (91) |
|---|---|---|---|
| Record availability by era | 53 | 22 | 10 |
| Boundary / jurisdiction history | 29 | 22 | 3 |
| Naming conventions | 93 | 13 | 16 |
| Migration patterns | 12 matches, whole corpus | — | — |

### The seeding control

@florencemashipei's #2074 retraction established the failure mode: final trees
cannot distinguish seeded fixture data from run output, and 28 of 33 facts
measured that way turned out to be seeded.

This audit does not read final trees. Every candidate sentence was checked
against its own fixture's `starting-research.json`,
`starting-tree.gedcomx.json`, `README.md`, `fixture.json` and
`expected-findings.json` by 6-word shingle overlap. Nothing matched at the 50%
threshold.

**The detector was proven to fire in both directions** before the result was
believed: a sentence copied verbatim out of a fixture README scores **1.000**,
an invented sentence scores **0.000**.

### Two figures were wrong before they were right

Both are recorded because both were quoted before they were checked.

**The first boundary count was 212 matches across 54 runs.** It was inflated by
`created from` matching person provenance — "Stub I2 created from this record"
has nothing to do with jurisdictions. Requiring the change verb to sit near a
jurisdiction word is what the pattern in Reproduce does.

**The first corrected pass then under-counted every category** — 23 / 81 / 48
against the 29 / 93 / 53 above. It left the JSON `\n` escapes in the dumped
tool arguments unreplaced, so sentences ran together across what were really
line breaks and the splitter produced fewer, longer sentences. The script in
Reproduce replaces them, and reproduces the table twice over.

## Two hypotheses tested and discarded

**1. That the dark skills are the ones that cannot write.** It looks strong: 8
of the 12 dark skills declare no write tool, and 11 of the 15 invoked skills
do. It fails on its counterexamples — `research-exhaustiveness` (**116**) and
`proof-conclusion` (**97**) are read-only, while `citation`,
`hypothesis-tracking`, `timeline` and `tree-edit` can all write and are dark.

Two of that 8 are counted misleadingly, per @florencemashipei: `project-status`
and `translation` declare **no `allowed-tools` block at all**, so at runtime
they inherit every tool rather than holding none. "Declares no write tool" is
literally true of them and materially backwards. It does not rescue the
hypothesis — the counterexamples above kill it either way — but the 8 should be
read as 6 skills that genuinely declare read-only tools plus 2 that declare
nothing.

**This does not explain #2106 either.** That card's root cause remains
unidentified.

**2. That shallow boundary treatment costs conclusions.** 8 runs state a
jurisdiction formation year. The one promising case, `jimmie-jewel-neal`, notes
a county formed in 1891 while researching the 1870s, and fails.

It refutes itself. All six runs of that fixture fail for the same unrelated
reason: they miss the Arkansas marriage record establishing the mother's maiden
name as Sampson, and infer Wood parents from census co-residence instead. The
county note was incidental to a locality guide.

**No failure in the 159 runs traces to missing historical context.**

## Why the zero count may not be a defect

`historical-context` writes nothing. Its `allowed-tools` grants six read-only
tools (`wiki_search`, `wiki_read`, `wikipedia_search`, `place_search`,
`place_search_all`, `place_population`), and the body says so twice:

- `SKILL.md:169` — "It does not modify project files."
- `SKILL.md:224` — "Writes nothing; safe to call repeatedly."

**The general form of this argument is wrong, and the counterexamples are in
this document.** "Read-only, therefore it cannot affect a graded outcome" is
false: `research-exhaustiveness` declares only `project_context`, persists
nothing, and runs **116** times, because `SKILL.md:48` sends the orchestrator
onward — "declared exhaustive → proof-conclusion; not declared because a gap
remains → research-plan" — which changes what gets written downstream.
`proof-conclusion` declares only `project_context` and runs **97** times, moving
outcomes through a delegate that does persist (`SKILL.md:52`: "**Writes:**
nothing directly. Every write is made by the `proof-conclusion` agent this skill
delegates to"). Raised by @florencemashipei and @EdmondOware, and correct: the
limb reused a mechanism this write-up had just discarded two sections earlier.

**The narrower claim is what holds.** `historical-context` has neither of those
two routes. It declares no agent delegation, so nothing persists on its behalf;
and unlike `research-exhaustiveness:48` it ends with no next-step
recommendation, so it never advances the orchestrator's loop. Its one
control-flow action is a hand-off that terminates its own turn — routing-check
row 1 invokes `locality-guide` and stops. So in an autonomous run it produces
neither a durable artifact nor a change in what runs next, and zero invocations
may be correct for *this* skill rather than for read-only skills as a class.

This is a supporting observation, not the load-bearing one. The recommendation
rests on the premise refutation, on no failure in 159 runs tracing to missing
historical context, and on the two passing tests that already draw the
description boundary.

## Why the description was not narrowed either

Narrowing the description — dropping "record availability by era", on the
grounds that the skill's own routing check hands record-availability questions
to `locality-guide` — was drafted and then withdrawn. The suite refutes it.

| test | question | required behaviour | outcome |
|---|---|---|---|
| `ut_historical_context_007` | "born around 1820 in Dorset, I cannot find a birth certificate, why not?" | explain civil registration began 1 July 1837 | **pass**, straight 3s |
| `ut_historical_context_009` | "what records exist for Schuylkill County and where do I access them?" | redirect to `locality-guide` | **pass** |

The boundary is already drawn correctly, and it is finer than the routing check
alone suggests:

- "Why doesn't this record exist for this era?" → `historical-context`
- "What records exist here and where do I get them?" → `locality-guide`

Dropping the phrase would have put a passing test at risk for no measured gain.

## Why the locality-guide mentions were not converted to a delegation

`locality-guide` (73 invocations) names `historical-context` three times, and
all three are boundary markers rather than imperative delegations —
`SKILL.md:17` ("use historical-context"), `:65` ("belongs in"), `:182`
("Redirect to"). The contrasting shape that does produce invocations is
`person-evidence:643`, "invoke `check-warnings` on the affected persons",
behind 40 calls.

Converting them was not done, because the remit such a delegation would serve
is already served. Availability reasoning is produced competently without the
skill:

> "NY civil registration began 1880 (loc_001), so no death certificate exists
> for John Perry Witbeck." — `john-perry-witbeck-vitals`

> "Hesse-Nassau Prussian civil registration began 1874; 1870 birth predates
> it." — `friedrich-weber-daughter`

Boundary reasoning is present but brief, and sits almost entirely inside
`locality-guide`'s own guide document — 46 occurrences inside a
`guide_markdown` against 9 anywhere else. That count is looser than the 29 in
the table above (no seed filter, no length bound), so read it as a ratio. It is
the brief treatment `locality-guide/SKILL.md:65` mandates.

What is genuinely unserved is migration patterns and naming-**system**
explanation. The 93 naming hits are mostly evidence matching — "a standard
patronymic variant equated with Cruz", "a minor spelling variant of Reuben" —
which is `person-evidence` reasoning, not a naming-system explanation. Nothing
in the corpus shows either gap costing a conclusion.

## Judgement calls this audit could not settle by counting

Three questions the measurement cannot answer. What follows is **the author's
own genealogical reasoning**, not a review of it — @Ikennaya1 wrote this PR, so
this section is not independent sign-off, and the 2-of-2 boundary check below
was designed, run and scored by the same person at n=2. @florencemashipei
independently signed off on all three calls in the PR review as a member of
@PioneerAIAcademy/senior-genealogists; that review, not this section, is the
independent confirmation. Recorded here because the conclusion rests on these
calls, and because the first answer produced a further measurement.

**Boundary changes — conditional, and the condition is testable.** "Formed 1853
from Navarro County; stable during the target period" is usually *not* enough
**when the research period crosses the formation date**, because the
genealogical value is not the formation year but where the earlier records now
sit: a researcher needs to be told that pre-1853 records are likely in Navarro
County. Where the target period lies entirely after formation, the formation
note alone is sufficient.

That converts the judgement into a check. Of the **8** formation statements in
the corpus, only **2** have a research period that crosses the formation date —
and in both, the run already wrote the strong form:

> "Records before 1891 fall under Lincoln County." — `jimmie-jewel-neal`

> "born April 1792 in the area that became Garrard County (formed 1796 from
> Madison and Lincoln counties), so his marriage likely occurred 1789-1792 in
> Madison or Lincoln County" — `mccarley-spouse`

**2 of 2**, so the corpus passes the reviewer's own test. The sample is two
cases and should not be read as more than it is, but it points the same way as
everything else here.

**Record availability — genuine genealogical value.** "Hesse-Nassau civil
registration began 1874; an 1870 birth predates it" is correct and useful: it
explains why the expected record does not exist and redirects the researcher to
church records or other contemporary sources. That is exactly the kind of
context that changes a research decision.

**Migration patterns — situational, not a missing requirement.** Migration
reasoning earns its place when it explains why a person appears in a new
jurisdiction, where to search next, or how a family moved. It is not required
by most research objectives. Runs reaching correct conclusions without it means
migration should be treated as situational evidence; its absence matters only
when movement between places is central to the problem.

**Verdict:** the card does not demonstrate that `historical-context` is missing
from the workflow. The runs are already performing at least some of its work
inline, and the strongest form of boundary reasoning appears in the cases that
need it.

## Limit of this measurement

The e2e run logs capture `tool_calls` only — there is no narration field. This
audit measures what runs **wrote**. If the main thread explains context
conversationally without persisting it, the probe cannot see it. **These
numbers are a floor, not a ceiling.**

## Conclusion

Close #2105 without a skill edit. Do not add a routing-table row, do not narrow
the description, do not convert the `locality-guide` mentions to a delegation.

The part worth keeping belongs to #2106: nothing in either eval tier fails when
a skill's invocation count is zero. That remains true and remains unowned.

## Reproduce

Invocation counts per skill:

```python
import json, glob, collections, os, pathlib
skills = collections.Counter()
for f in glob.glob('eval/runlogs/e2e/*/run-*.json'):
    if f.endswith('.ann.json') or '.final-' in f: continue
    for t in json.loads(pathlib.Path(f).read_text(encoding='utf-8')).get('tool_calls', []):
        if t.get('tool') in ('Skill', 'SlashCommand'):
            a = t.get('args') or {}
            s = a.get('skill') or a.get('command') or a.get('name') or ''
            if s: skills[str(s).lstrip('/')] += 1
for s in sorted(os.listdir('packages/engine/plugin/skills')):
    print('%-26s %4d' % (s, skills.get(s, 0)))
```

The remit table, and the locality-guide split. Three steps make these
sentence counts rather than raw regex matches: the seed filter, the length
bound, and first-category-wins.

```python
"""Remit counts for the historical-context audit (#2105). Run from the repo root."""
import json
import glob
import pathlib
import re

TEXT_TOOLS = (
    'mcp__genealogy__research_append',
    'mcp__genealogy__research_log_append',
    'mcp__genealogy__extraction_append',
)
PLACE = (r'(?:count(?:y|ies)|parish|province|district|township|jurisdiction'
         r'|kingdom|duchy|state|borough|municipalit|deanery|diocese|amt|fylke|shire)')
CATS = {
    'boundary': re.compile(
        r'(?:boundary chang\w*|jurisdiction chang\w*'
        rf'|(?:formed|created|split|carved|separated)\s+(?:out\s+)?from\s+(?:\w+\s+){{0,4}}{PLACE}'
        rf'|{PLACE}\w*\s+(?:was|were)\s+(?:then\s+)?(?:part of|renamed|annexed)'
        rf'|(?:part of|renamed|annexed)\s+(?:\w+\s+){{0,3}}{PLACE}'
        rf'|prior to \d{{4}}[^.]{{0,60}}{PLACE}'
        rf'|{PLACE}[^.]{{0,60}}(?:established|erected|organized) in \d{{4}})', re.I),
    'naming': re.compile(
        r'\b(?:patronymic naming|naming convention|anglici[sz]ed|farm name'
        r'|patronymic (?:system|surname|variant))\b', re.I),
    'availability': re.compile(
        r'\b(?:records begin|civil registration (?:began|start)|began keeping'
        r'|no records survive|records were destroyed|record loss|not kept until'
        r'|predates it|predates civil)\b', re.I),
}
SEED_FILES = ('starting-research.json', 'starting-tree.gedcomx.json', 'README.md',
              'fixture.json', 'expected-findings.json')


def words(text):
    return re.findall(r"[a-z0-9']+", text.lower())


def shingles(ws, n=6):
    return {' '.join(ws[i:i + n]) for i in range(max(0, len(ws) - n + 1))}


def run_logs():
    for path in sorted(glob.glob('eval/runlogs/e2e/*/run-*.json')):
        if path.endswith('.ann.json') or '.final-' in path:
            continue
        yield path


counts = dict.fromkeys(CATS, 0)
lg_runs = {c: set() for c in CATS}
no_runs = {c: set() for c in CATS}
n_lg = n_no = 0
files = 0
for path in run_logs():
    files += 1
    log = json.loads(pathlib.Path(path).read_text(encoding='utf-8'))

    invoked = [str((c.get('args') or {}).get('skill') or (c.get('args') or {}).get('command') or '').lstrip('/')
               for c in log.get('tool_calls') or [] if c.get('tool') in ('Skill', 'SlashCommand')]
    is_lg = 'locality-guide' in invoked
    if is_lg:
        n_lg += 1
    else:
        n_no += 1

    fixture_dir = pathlib.Path('eval/tests/e2e') / pathlib.Path(path).parent.name
    seed_text = ''
    for name in SEED_FILES:
        seed_path = fixture_dir / name
        if seed_path.exists():
            seed_text += ' ' + seed_path.read_text(encoding='utf-8')
    seed_shingles = shingles(words(seed_text))

    written = '\n'.join(
        json.dumps(call.get('args') or {}, ensure_ascii=False)
        for call in log.get('tool_calls') or []
        if call.get('tool') in TEXT_TOOLS
    )
    written = written.replace('\\n', ' ').replace('\\"', '"')

    for sentence in re.split(r'(?<=[.!?])\s+', written):
        ws = words(sentence)
        if not 10 <= len(ws) <= 70:
            continue
        sent_shingles = shingles(ws)
        if sent_shingles and len(sent_shingles & seed_shingles) / len(sent_shingles) >= 0.5:
            continue  # seeded in the fixture, not written by the run
        for category, pattern in CATS.items():
            if pattern.search(sentence):
                counts[category] += 1
                (lg_runs if is_lg else no_runs)[category].add(path)
                break  # first category wins

print(f'run logs scanned: {files}')
print(f'locality-guide runs: {n_lg}   other runs: {n_no}')
for category, n in counts.items():
    print(f'  {category:14} sentences={n:>4}  LG runs={len(lg_runs[category]):>3}  non-LG runs={len(no_runs[category]):>3}')
```

The remaining figures — migration matches, the `guide_markdown` ratio, the
formation statements and which of them cross the formation date, and the
write-tool split including the two skills that declare no `allowed-tools` at
all. Added at @florencemashipei's request: these were load-bearing and shipped
without a reproduce path in a document that asks for one everywhere else.

```python
"""The remaining figures: migration matches, formation statements and the
crossing cases, the guide_markdown ratio, and the write-tool split.
Run from the repo root."""
import json
import glob
import os
import pathlib
import re

TEXT_TOOLS = ('mcp__genealogy__research_append', 'mcp__genealogy__research_log_append',
              'mcp__genealogy__extraction_append')
PLACE = (r'(?:count(?:y|ies)|parish|province|district|township|jurisdiction'
         r'|kingdom|duchy|state|borough|municipalit|deanery|diocese|amt|fylke|shire)')
BOUNDARY = re.compile(
    r'(?:boundary chang\w*|jurisdiction chang\w*'
    rf'|(?:formed|created|split|carved|separated)\s+(?:out\s+)?from\s+(?:\w+\s+){{0,4}}{PLACE}'
    rf'|{PLACE}\w*\s+(?:was|were)\s+(?:then\s+)?(?:part of|renamed|annexed)'
    rf'|(?:part of|renamed|annexed)\s+(?:\w+\s+){{0,3}}{PLACE}'
    rf'|prior to \d{{4}}[^.]{{0,60}}{PLACE}'
    rf'|{PLACE}[^.]{{0,60}}(?:established|erected|organized) in \d{{4}})', re.I)
MIGRATION = re.compile(r'\b(?:migration (?:pattern|route|chain)|chain migration'
                       r'|settlement pattern|onward migration)\b', re.I)
FORMATION = re.compile(r'(?:formed|organized|established|erected|created)[:\s]+(?:in\s+)?'
                       r'(1[6-9]\d\d)\s+from\s+([A-Z][A-Za-z\' ]{2,30}?)\s*(?:Count|,|\.|\n|\\n)', re.I)
WRITE_TOOLS = re.compile(r'\b(research_append|research_log_append|tree_edit|tree_correct'
                         r'|extraction_append|person_evidence|merge_|project_memory_write'
                         r'|Write|Edit)\b')


def run_logs():
    for path in sorted(glob.glob('eval/runlogs/e2e/*/run-*.json')):
        if path.endswith('.ann.json') or '.final-' in path:
            continue
        yield path


migration = 0
in_guide = out_guide = 0
formations = set()
crossing = []

for path in run_logs():
    log = json.loads(pathlib.Path(path).read_text(encoding='utf-8'))
    era = str((log.get('tags') or {}).get('era') or '')
    decade = re.match(r'(\d{4})s', era)
    start = int(decade.group(1)) if decade else None
    fixture = pathlib.Path(path).parent.name

    for call in log.get('tool_calls') or []:
        if call.get('tool') not in TEXT_TOOLS:
            continue
        text = json.dumps(call.get('args') or {}, ensure_ascii=False).replace('\\n', ' ')
        migration += len(MIGRATION.findall(text))
        guide = 'guide_markdown' in text
        for sentence in re.split(r'(?<=[.!?])\s+', text):
            if BOUNDARY.search(sentence):
                if guide:
                    in_guide += 1
                else:
                    out_guide += 1
        for m in FORMATION.finditer(text):
            year, parent = int(m.group(1)), m.group(2).strip()
            key = (fixture, year, parent)
            if key in formations:
                continue
            formations.add(key)
            if start is not None and year > start:
                crossing.append((fixture, era, year, parent))

print(f'migration-pattern matches, whole corpus: {migration}')
print(f'boundary sentences inside a guide_markdown call: {in_guide}')
print(f'boundary sentences in other writes            : {out_guide}')
print(f'distinct formation statements: {len(formations)}')
print(f'  of which the research period crosses the formation date: {len(crossing)}')
for fixture, era, year, parent in crossing:
    print(f'    {fixture} (era {era}) formed {year} from {parent}')

# The write-tool split, and the two skills that declare no allowed-tools at all.
skills = collections_counter = {}
counts = {}
for path in run_logs():
    log = json.loads(pathlib.Path(path).read_text(encoding='utf-8'))
    for call in log.get('tool_calls') or []:
        if call.get('tool') in ('Skill', 'SlashCommand'):
            args = call.get('args') or {}
            name = args.get('skill') or args.get('command') or args.get('name') or ''
            if name:
                counts[str(name).lstrip('/')] = counts.get(str(name).lstrip('/'), 0) + 1

declares_none, read_only, can_write = [], [], []
root = pathlib.Path('packages/engine/plugin/skills')
for skill_dir in sorted(root.iterdir()):
    body = skill_dir / 'SKILL.md'
    if not body.exists():
        continue
    text = body.read_text(encoding='utf-8')
    front = text.split('---')[1] if text.startswith('---') else ''
    block = re.search(r'allowed-tools:(.*?)(?=\n[a-z-]+:|\Z)', front, re.S)
    dark = counts.get(skill_dir.name, 0) == 0
    if block is None:
        declares_none.append((skill_dir.name, dark))
    elif WRITE_TOOLS.search(block.group(1)):
        can_write.append((skill_dir.name, dark))
    else:
        read_only.append((skill_dir.name, dark))

print(f'\ndark skills that declare read-only tools : {sum(1 for _, d in read_only if d)}')
print(f'dark skills that declare no allowed-tools: {sum(1 for _, d in declares_none if d)}'
      f'  {[n for n, d in declares_none if d]}')
print(f'invoked skills that can write            : {sum(1 for _, d in can_write if not d)}')
print(f'invoked skills that are read-only        : {sum(1 for _, d in read_only if not d)}'
      f'  {[n for n, d in read_only if not d]}')
```
