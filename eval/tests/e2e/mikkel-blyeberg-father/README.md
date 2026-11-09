# Mikkel Nielsen Blyeberg — father (Denmark, born 1779)

**Source PID:** `PID-TODO`

Mikkel Nielsen Blyeberg is deceased (born 20 August 1779).

> Who was the father of Mikkel Nielsen Blyeberg, born 20 August 1779 in Stagstrup
> Sogn, Thisted (Vestervig) Amt, Denmark?

## What was removed from the starting tree

- Mikkel's father: Niels Madsen Blyeberg (recorded in the rolls as "Niels Bliberg")
- The father's death/burial: 20 December 1802, Stagstrup parish
- Mikkel's status change to gaardmand / fæsteholder at Sundby, 3 January 1805 (a bonus finding)

## What the starting tree contains

- Mikkel Nielsen Blyeberg himself (subject), with only his known birth: 20 August
  1779, Stagstrup Sogn — no parents

## Reframing note

The source ("Danish Military Levying Rolls: Case Study 1") is a **records
walkthrough**, not a parents question — it follows Mikkel through the levying
system from age 11 (1792) to 34 (1814). It was reframed into a standard
identity/relationship question ("who was the father, and when did he die?") because
that is the piece of the walkthrough with a real, checkable documented conclusion.
The mother is never named in the source (she appears only as "the widow" running
the farm after 1802), so she is deliberately **not** a finding.

## Expected difficulty

Hard. The father is identified from the levying rolls' naming convention (the
father's name written directly above the son's) and his death is bracketed by the
1801 "old man's son" and 1803 "widow's son" notations, then pinned by the Stagstrup
parish burial (20 December 1802).

## Notes for reviewers

**2026-11-04 — re-scoped for step mode (issue #4144).** The old question asked
two independent facts (the father, and the father's death): "Who was the
father of Mikkel Nielsen Blyeberg, born 20 August 1779 in Stagstrup Sogn,
Thisted (Vestervig) Amt, Denmark, and when did his father die?" Reworded
`researcher_question` to the father only; demoted `f2` (the father's burial)
to `required: false`, so a run that recovers it anyway still gets credit. `f3`
was already non-required. No finding wording changed. This fixture's one
annotation carries no `findings_hash`, so it is grandfathered and needs no
re-grading.

Documented conclusion from the FamilySearch Wiki case study:

- Mikkel Nielsen Blyeberg born 20 August 1779, Stagstrup Sogn; on the rolls 1792–1814.
- Father Niels Madsen Blyeberg ("Niels Bliberg" in the rolls), buried 20 December
  1802, died between the 1801 and 1803 sessions.
- Mikkel became fæsteholder / gaardmand at Sundby, Stagstrup, on 3 January 1805.

**Recoverability caveat (read before grading a failed run):** the Danish Military
Levying Rolls (Lægdsruller) are browse-only image rolls organized by levying
district, not name-indexed on FamilySearch, so an agent restricted to record/
full-text search will struggle to reach f1 and the roll half of f2/f3. The Stagstrup
parish burial register (Danish church books, many browse-only, some indexed) is the
most likely reachable source for the father's death. A low score may reflect tool
reach rather than agent skill.

**Authoring note (PID-less / Path 3):** Built from the wiki case study as ground
truth, with no FamilySearch access — the starting tree was *constructed* from the
document. `source_pid` is an unused placeholder (`PID-TODO`); §6.1 blocks every
person-keyed tool, so neither the run nor the judge reads it. The §14
fixture-validity run is still owed; it is not CI-gated, so this PID-less draft
may land with the validity run outstanding.

**`wiki_search` is disabled for this fixture** (`blocked_tools` in
`fixture.json`, maintainer call 2026-07-09). The ground-truth source — the
FamilySearch Wiki's "Danish Military Levying Rolls: Case Study 1" — is a
*public wiki page* that `wiki_search` surfaces during ordinary locality
planning, and it names the father directly. Two independent interactive runs
confirmed the answer is recoverable from records alone (1778 marriage, 1803
probate index, 1802 burial), so blocking the wiki keeps the benchmark
measuring record research rather than article retrieval. The same treatment
applies to any future fixture derived from a wiki case study.
