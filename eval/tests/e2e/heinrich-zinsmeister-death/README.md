# Heinrich Zinsmeister — birth, death and burial (Bavaria, 1854)

**Source PID:** `KD72-C6D`
**Heinrich Zinsmeister is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) Born
not recorded in the tree; died not recorded in the tree (undated Death fact only).

## Research question

> When and where was Heinrich Zinsmeister of Steinwenden, Pfalz, Bavaria born, and when and where did he die?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-07-24, PID `KD72-C6D` with relatives). Nothing was
stripped (`"genre": "record-hint"` in `fixture.json`):
`starting-tree.gedcomx.json` is the snapshot as-is (written by
`strip --none`), and `unstripped-tree.gedcomx.json` is committed
identical to it so `snapshot --check` can audit upstream drift.
`validate` enforces the equality and skips the presence mirror
(spec §3.6).

## Expected difficulty

hard — see "Notes for reviewers" below for the reviewer's read on
match strength.

## Notes for reviewers

**Resolved 2026-07-30 (supersedes an earlier, incorrect 2026-07-29 resolution below): false match, no findable substitute.** This fixture came from a hint batch (`filtered-list-samples.csv` row 5, flags `adds_birth`/`adds_death`/`adds_burial`, confidence 3) in which roughly half the hint records are false matches. This one is false: **the record at `ark:/61903/1:1:JWBL-QXJ` was directly examined on FamilySearch and is for Elisabetha Meininger** (female), died 15 Jan 1857, buried 17 Jan 1857, event place Bayern, Deutschland, parents Philipp Meininger and Katharina Heinz — an unrelated individual, sharing no name, sex, date, or family connection with Heinrich Zinsmeister or his wife Elisabetha Engelskircher.

`expected-findings.json` now carries a `polarity: "avoid"` guard (f1, required) naming the 15 December 1854 death/burial claim and the `JWBL-QXJ` citation the agent must not assert, paired with a required finding (f2) that the agent documents the negative conclusion.

**How the earlier resolution went wrong — a cautionary note for future record-hint fixtures.** Two independent AI-generated research narratives (both from live Cowork `/research` runs, not this harness) produced detailed, confident, footnoted "proof arguments" identifying `JWBL-QXJ` as Heinrich's own death record — citing a specific age (86), spouse name ("Elisabetha Engel"), source classification, and even a plausible-sounding GPS analysis weighing a competing candidate. The first was used to adjudicate this fixture as a **true match at Probable tier** (see the superseded text below) and committed to git. Only a direct, personal check of the cited URL — not a second AI narrative, and not a third — revealed the citation was fabricated: the actual page has nothing to do with Heinrich Zinsmeister. **Lesson: an AI-authored "proof argument" is a claim to independently verify by opening the cited primary source, never itself the verification**, no matter how much correct-sounding supporting detail surrounds it — both narratives here mixed a fabricated central claim with genuinely real corroborating facts (see below), which is what made them convincing enough to nearly close this fixture on false grounds.

**What is genuinely established** (independently verified through real FamilySearch tool calls in a committed harness run, `run-2026-07-30_06-33-16.json`, and consistent across multiple research attempts): Heinrich Zinsmeister (KD72-C6D) and Elisabetha Engelskircher are the parents of Maria Catharina (chr. 1819), Juliane (chr. 1824), and Elisabetha (chr. 1828) at Steinwenden. Elisabetha Engelskircher herself died 15 April 1843 (FamilySearch `ark:/61903/1:1:JWBL-9ZZ`), naming Heinrich as her surviving husband — establishing only that he was alive at least that long. No genuine birth or death record for Heinrich himself has been found by any research attempt to date, including three live harness runs that exhausted FamilySearch's indexed collections for this parish. The un-indexed Steinwenden church-register images for births (image group `008239801`) and deaths (`008239802`) remain unread by any verified attempt — every harness run was blocked from reading them by a missing OpenRouter key (since fixed) and/or by image file sizes exceeding the read-tool transport cap; whether a genuine record for Heinrich exists there is still an open question.

---

**Superseded 2026-07-29 resolution (incorrect — retained for the record, do not rely on this):** ~~true match, Probable tier~~. A genealogist reviewed the tree person's existing sources and the hint record independently and concluded the identification holds at GPS Probable tier, based on a Cowork research narrative describing the hint record as Heinrich Zinssmeister, age 86, died 15 December 1854, spouse "Elisabetha Engel." That description does not match the actual record at the cited ARK (see above) and the conclusion is retracted.
