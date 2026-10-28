"""How often a lifetime stand-in for a question's date window would warn (#2424).

Re-derives the figure in guardrail-enforcement-spec.md, "A plan should reach its
question's date window": for every committed project with plans and a tree
(scenario fixtures, e2e final states), take each subject's adult life from the
tree (birth + ADULT to death; dated Birth/Christening/Baptism, Death/Burial) and
count the questions whose live plan items leave more than GAP years of it
uncovered at either end. A question warns only when every subject would.

    python -I eval/harness/scripts/measure_question_window_lifetime.py <repo-root> 15 15
"""
import json, re, sys, glob, os
ROOT = sys.argv[1]; ADULT = int(sys.argv[2]); GAP = int(sys.argv[3])
def yrs(s):
    s = s if isinstance(s, str) else json.dumps(s)
    return [int(y) for y in re.findall(r'(?<!\d)(\d{4})(?!\d)', s or '')]
def rng(s):
    m = re.fullmatch(r'\s*(\d{4})\s*(?:-\s*(\d{4}))?\s*', s or '')
    if not m: return None
    a = int(m[1]); b = int(m[2] or m[1]); return (a, b) if a <= b else None
def pairs():
    for r in glob.glob(f'{ROOT}/eval/fixtures/scenarios/*/research.json'):
        t = os.path.join(os.path.dirname(r), 'tree.gedcomx.json')
        if os.path.exists(t): yield r, t
    for r in glob.glob(f'{ROOT}/eval/runlogs/e2e/*/*.final-research.json'):
        t = r.replace('.final-research.json', '.final-tree.gedcomx.json')
        if os.path.exists(t): yield r, t
docs = fired = qs = 0; hits = []
for rp, tp in pairs():
    try:
        r = json.load(open(rp, encoding='utf-8')); t = json.load(open(tp, encoding='utf-8'))
    except Exception: continue
    plans = [p for p in r.get('plans') or [] if p.get('status') != 'superseded']
    if not plans: continue
    docs += 1
    persons = {p.get('id'): p for p in t.get('persons') or []}
    life = []
    for sid in (r.get('project') or {}).get('subject_person_ids') or []:
        p = persons.get(sid) or {}; b = d = None
        for f in p.get('facts') or []:
            k = str(f.get('type', '')).split('/')[-1]; ys = yrs(f.get('standard_date') or f.get('date'))
            if not ys: continue
            if k in ('Birth', 'Christening', 'Baptism'): b = max(ys) if b is None else min(b, max(ys))
            if k in ('Death', 'Burial'): d = max(ys) if d is None else min(d, max(ys))
        if b or d: life.append((sid, b, d))
    if not life: continue
    byq = {}
    for p in plans:
        for i in p.get('items') or []:
            if i.get('status') == 'skipped': continue
            x = rng(i.get('date_range'))
            if x: byq.setdefault(p.get('question_id'), []).append(x)
    for q, rs in byq.items():
        qs += 1; lo = min(a for a, _ in rs); hi = max(b for _, b in rs); msgs = []
        for sid, b, d in life:
            ws = b + ADULT if b else None; we = d
            if ws and we and ws >= we: msgs = None; break
            m = []
            if ws and lo - ws > GAP: m.append(f'head {ws}-{lo-1}')
            if we and we - hi > GAP: m.append(f'tail {hi+1}-{we}')
            if not m: msgs = None; break
            msgs.append(f'{sid} b{b} d{d}: ' + ', '.join(m))
        if msgs:
            fired += 1; hits.append(f'{os.path.relpath(rp, ROOT)} {q} plan {lo}-{hi} :: ' + '; '.join(msgs))
print(f'docs={docs} questions={qs} fired={fired}')
for h in hits: print(' ', h)
