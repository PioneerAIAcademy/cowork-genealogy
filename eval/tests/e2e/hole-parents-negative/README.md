# Christian Peter Hole — Norwegian parents, with a same-name lookalike to avoid

**Source PID:** `KD96-TV2`
**Christian Peter Hole is deceased.** (Born 2 Oct 1876, Ringebu, Norway; died
21 May 1955, Erskine, Polk County, Minnesota. FamilySearch ToS requires all
committed e2e fixtures to be about deceased persons.)

## Research question

> Who were the parents of Christian Peter Hole?

## Why this fixture exists — the suite's first *active* restraint test

A companion death fixture (`hole-death-negative`) showed that a **death** question
on an emigrant routes the agent US-first, so the Norway namesake was never on its
path — the restraint half never fired. This **parents** question fixes that: to find
his parents you *must* search Norwegian records, which is exactly where the same-name
confusion lives. The trap is on the agent's path *and* resistible — a real
careful-vs-careless discriminator.

**The trap — Americanized surname vs. Norwegian patronymic.** Christian emigrated and
used the surname **"Hole"** in Minnesota, but his 1876 Ringebu christening records his
parents under **patronymics**: father **Benjamin Christophersen** (b. ~1853), mother
**Matea Pedersdatter** (b. ~1857). Searching **"Kristian Hole"** in Norway does **not**
find his christening — it surfaces **different-family** "Hole" namesakes (Kristian
Kristiansson Hole, Kristian Klausen Hole, the Ringebu Kristian Hole b. 1877, …) with
*different* parents. A careless agent clings to "Hole" and attaches a wrong family; a
careful agent drops the American surname and matches the **exact birth (2 Oct 1876)
and baptism (5 Nov 1876) at Ringebu** to the true christening (`ark:/61903/1:1:683F-NTZ9`).

## What was removed from the starting tree

- Removed both **parents** — Benjamin Khristen Hole and Mattia Pedersdatter
  Spangrudlien — as persons, and the parent→child relationships to Christian (the
  `recover` targets, f1/f2).
- Removed **all sources** (the tree starts source-free) so the agent must **re-find**
  Christian's christening record itself, confronting the "Hole" namesakes in the
  process rather than reading his parents straight off a retained source.
- **Kept:** Christian's exact **Birth (2 Oct 1876, Ringebu)** and **Christening
  (5 Nov 1876, Ringebu)** — the disambiguators that identify the correct christening
  record — plus **Immigration** and the American **Hole** family (wife Edna Marie
  Wadekamper + children Owen Kenneth, Guy Everette, Curtis Paul), which realistically
  *bait* the "Hole" surname search.

## Expected findings

- **f1 (recover, required):** father Benjamin Christophersen (~1853), a.k.a. Benjamin
  Khristen Hole.
- **f2 (recover, required):** mother Matea Pedersdatter (~1857), a.k.a. Mattia
  Pedersdatter.
- **f3 (avoid, required):** must NOT attach a same-name "Hole" namesake's parents; a
  father surnamed "Hole" is the tell that the wrong family was assigned. Pass = the
  correct patronymic parents are recovered and no wrong-family parentage is asserted.

## Expected difficulty

hard — the agent must recognize that the Americanized surname "Hole" won't find the
Norwegian origin record, drop it, and disambiguate on the exact birth/baptism date to
avoid the same-name namesakes.

## Notes for reviewers

- **Expect a WARN from the stripping linter on f3.** Its `subject_person` is Christian,
  who legitimately stays in the tree; only the wrong parentage must be absent (and the
  true parents are absent too, so f1/f2 are genuinely stripped). The linter can't tell
  an `avoid` finding from a `recover` one.
- Recover is solvable: Christian's christening (`ark:/61903/1:1:683F-NTZ9`, Norway
  Church Books, 5★ match to `KD96-TV2`) names both parents — confirmed before authoring.
- Wall-clock cap raised to 90 min (cross-naming disambiguation is search-heavy).
