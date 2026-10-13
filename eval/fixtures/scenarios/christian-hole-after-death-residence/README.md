# christian-hole-after-death-residence

A copy of `christian-hole-quality` for the `source-evaluation` warnings branch
(issue #2942): the project tree holds the audited person, and that tree carries
an impossibility, so `person_warnings` has something to report.

**Synthetic test data**, like its parent. All tool responses are mocked from
`eval/fixtures/mcp/`; `person_warnings` runs live over this tree in the unit
harness (places resolver off).

- **Objective:** review data quality for Christian P. Hole and family.
- **GedcomX persons:**
  - `I1` — **Christian P. Hole** (subject), with
    `ark: "ark:/61903/4:1:KD96-TV2"`. The **local id differs from the
    FamilySearch id**, as in every tree init-project builds;
    `person_warnings` resolves `KD96-TV2` to `I1` through that ark (issue
    #2942), and either id reaches him. Facts as in the parent, plus a
    **Residence dated 1950 (F17) after his 10 June 1945 death**.
    `person_warnings({ personId: "I1" | "KD96-TV2" })` returns exactly one warning:
    `hasEventAfterDeath1`, severity `contradiction`, message "An event is
    dated more than 1 year after this person's latest death-like fact."
    (measured 2026-10-09).
  - `KD96-TV3` — **Inger Hole** (wife). 0 warnings.
  - `KD96-TV4` — **Ole C. Hole** (son). Carries his own Residence 1975 after
    his 1960 death; not the subject of any test here.
  - `KD96-TV5` — a stale duplicate stub of the son.
- **GedcomX relationships:** R1 (Couple I1×KD96-TV3), R2/R3 (ParentChild → KD96-TV4).
- **research.json:** minimal active project, `subject_person_ids: ["I1"]`; no
  questions, plans or assertions.

**The `person_read` fixture deliberately lacks the 1950 residence.**
`person-read-hole-attached-sources` is FamilySearch's profile; the project tree
is what the project holds, and the warnings check reads the tree. A source audit
of the attached sources is graded against the fixture's four-fact profile and
`person-quality-hole-detail`'s 2-issue checklist, exactly as in the parent; the
1950 residence appears only in the warnings block.

## Used by

- `source-evaluation`: `project-warnings-reported`.
