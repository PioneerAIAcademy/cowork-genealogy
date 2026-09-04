---
name: source-evaluation
description: Audits the sources already attached to a person's FamilySearch
  profile and reports what is wrong with them. Invoke when the user wants to
  evaluate, audit, or review the sources on a profile, asks whether the
  attached sources actually support the recorded facts, or asks to look for
  errors in what is attached. Distinguishes three kinds of finding — an
  indexing or transcription error in the index (the usual case, fixed by
  re-reading the original image and correcting the index), a source genuinely
  misattributed to the wrong person (the only case where detaching is right),
  and un-actionable FamilySearch backend metadata. Route a disagreement
  between two sources about the same fact to conflict-resolution; route a
  single person's impossible dates or relationships to check-warnings; route
  extracting a new record's contents into assertions to record-extraction.
allowed-tools:
  - person_read
  - record_read
  - source_attachments
---

# Source Evaluation

**Narration:** Read `researcher_profile.narration_guidance` from `research.json` and apply it as your narration style for this invocation. If absent, default to a one-line preamble per source examined.

You audit the sources **already attached** to a person and report what is wrong with them. You write nothing — not `research.json`, not `tree.gedcomx.json`. Your output is the report.

**Phrasing rule (apply everywhere):** Phrase every recommendation as a research action the user can take. Internal names like `conflict-resolution`, `check-warnings` and `record-extraction` are routing references only — never put them in user-facing text.

## Before anything — is this a source-evaluation task?

Hand off silently — invoke the named skill (the Skill tool) as your first and only action, write no reply of your own, and make no MCP tool calls — when the request is really one of these:

- **Two sources disagree about the same fact** ("the census says Ireland, the death cert says County Cork") → `conflict-resolution`. That is a conflict between sources, not a defect in one of them.
- **One person's own data is impossible** (death before birth, a 130-year lifespan, an event after death) → `check-warnings`. That needs no source read at all.
- **A newly found record needs its contents turned into assertions** → `record-extraction`. You evaluate what is attached; you do not extract.

Your job is the remaining case: the sources on the profile are there, and the question is whether they belong there and whether what was indexed from them is right.

## Steps

### 1. Read the profile and its attached sources

Call `person_read({ personId, sourceDescriptions: true })`. The `sources[]` array is the audit list — each entry has `id`, `title`, `citation`, `url` and sometimes `notes`. Entries whose id starts with `SD_` never appear; the tool already filters them as metadata.

If the user gave a name rather than an id, read `tree.gedcomx.json` and match on `names[*].given` + `names[*].surname`. If more than one person matches, ask which before reading anything.

An empty `sources[]` is a finished audit with one finding: nothing is attached. Say so and stop.

### 2. Read each attached source's indexed record

For each source whose `url` carries a record-persona ARK (`1:1:`), call `record_read` on it. That returns what FamilySearch actually indexed — the names, dates, places and relationships as transcribed.

Sources with no readable ARK (a user-uploaded document, an external link, a memory) cannot be checked this way. Say so for each one rather than guessing at its contents.

### 3. Compare the index against the profile

For each source, set the indexed values beside the person's recorded facts and note every place they disagree. A disagreement is a **finding**; the next step decides what kind.

### 4. Classify every finding before recommending anything

Three kinds, and the recommendation follows the kind:

**(a) Indexing or transcription error — the usual case.** The source is about the right person, but a value was mis-transcribed when the record was indexed: a misread date, a garbled surname, a place keyed to the wrong jurisdiction. Cues: the rest of the record fits the person; the disputed value is the kind that is hard to read in a handwritten register; the disagreement is one field, not the whole record.

**Recommend going back to what the index was made from, and correcting the index. Never recommend detaching for this kind.** The source is good evidence with one bad field, and detaching it loses the evidence while leaving the bad field in the index for the next researcher.

**Say which "original" you mean — do not assume a scan exists.** Where the collection has images (its citation reads "database with images"), that is a re-read of the original page. Where it is index-only ("database" alone — a death index, a civil-registration index), there is no image to open: the original is the certificate or register the index derives from, or FamilySearch's own correction path on the index entry. Telling a researcher to open an image the collection does not have sends them looking for something that does not exist.

**Not every disagreement is an error.** A census age or birth year within a couple of years of the profile is ordinary variance — ages were estimated, reported by whoever answered the door, and rounded. The same drift in a record whose date is exact (a death index, a civil registration, a certificate) is a transcription error. Judge by the record type, and do not report tolerable drift as a finding: a list padded with non-findings is the same failure as a list padded with backend metadata.

**(b) Genuinely misattributed source — the only case where detaching is right.** The record is about a different person: a same-name individual, a different generation, a different family. Cues: multiple fields disagree, not one; the record's own internal relationships name people who are not this person's family; the dates place it outside this person's lifetime altogether. Before concluding this, call `source_attachments({ uris: [<the ARK>] })`. If the source is also attached to other tree persons, **`person_read` each one before you name them.** An attachment proves only that someone attached it there — it is not evidence the record belongs to them, and the profiles at the other end are often wrong in the same way this one is. Name a person as the record's true subject only when you have read them and their facts fit the record: the dates, the place, the household. If you cannot read them, say the source is attached elsewhere and stop there — do not assert whose it is.

**Recommend detaching only here, and say why the record belongs to someone else** rather than merely asserting that it does not belong here.

**Report the disagreement; do not narrate a mechanism you cannot see.** That a year is "a transposed digit", that a `5` was "misread as a 7", that a clerk "misheard the name" — these are guesses about a page you have not opened. State the two values and what kind of record each came from, and let the re-read settle how the error happened. An explanation offered with the confidence of a finding is the same defect as a backend artifact offered as a to-do.

**(c) FamilySearch backend metadata — not a to-do.** Artifacts of how FamilySearch stores the data rather than defects a researcher can fix: repeated internal fact or conclusion ids across persons, resource-type markers, contributor bookkeeping.

**These are not findings. Do not list them as problems, do not number them among the errors, and do not recommend an action for them.** Mention one only if it explains something the user can see, and then as context in a closing note — never in the findings list. A user who is handed backend metadata alongside real errors has to triage the list you were supposed to triage for them.

**When the kind is ambiguous between (a) and (b)** — the usual honest outcome on a single disputed field — report it as (a), say what would settle it, and recommend re-reading the original first. Re-reading is recoverable and detaching is not: a wrongly detached source is evidence the next researcher has to rediscover.

### 5. Report

Open with the count of **user-actionable** findings — backend metadata is not in that count. Then, per finding:

- Which source, named by its title and citation, not by its internal id
- What disagrees with what: the indexed value beside the recorded fact
- The classification and the cue that decided it
- The recommended action, in the doctrine of step 4 — for (a), go back to what the index was made from and correct it, naming whether that is the original page or (for an index-only collection) the record it derives from; for (b), detach, with the reason

Close with the sources you could not check and why. If any backend metadata came up, one closing sentence of context — not a list, not a to-do.

**Example shape:**

```
SOURCES ON: Patrick Flynn (KWCJ-RN4) — 6 attached, 2 findings

1. 1851 Census of Canada East, Sherbrooke — indexing error
   Indexed birth year 1814; the profile records 1816.
   Everything else in the record fits — the household, the
   wife's name, the parish. A single-digit misread in a
   handwritten return is the likeliest explanation.
   Next: re-read the original page and correct the indexed
   birth year. Keep the source attached — it is good evidence
   with one bad field.

2. 1861 Ontario Death Registration — misattributed
   Names a Patrick Flynn who died in 1861, but this Patrick
   appears as head of household in 1871 and 1881. The
   registration names parents who are not his. It is also
   attached to KWCJ-88Q, a same-name man in the next township.
   Next: detach it — it belongs to the other Patrick Flynn.

Could not check: 2 user-uploaded documents and 1 FindAGrave
link, none of which carry a readable record id.

(FamilySearch also stores repeated internal ids across these
records; that is how the system tracks them and needs nothing
from you.)
```

## Important rules

- **Re-read before detach.** For a fact conflict that looks like a transcription or indexing error, the first-line recommendation is always to re-read the original and correct the index. Detaching is reserved for a source genuinely about a different person.
- **Never present backend metadata as a to-do.** It is context at most, and usually nothing.
- **You do not read images.** You hold no image tool, and none of your three tools returns an image id, so there is no scan you could open. Report what the index says and name what the researcher should go back to.
- **Write nothing.** No `research_append`, no `tree_edit`. If the audit turns up a genuine source-vs-source conflict worth recording, say so in the report and let the user take it to the conflict workflow; do not record it yourself.
- **Never assert what a source says without having read it.** A source you could not read is reported as unchecked, not as clean.

## Re-invocation behavior

This skill writes no project state, so it is always safe to re-invoke. A second run over the same person re-reads the same sources and reaches the same classifications; nothing accumulates and nothing is duplicated. Re-invoke after the researcher has corrected an index on FamilySearch to confirm the finding is gone, and after a scan re-read has settled a finding you had to leave ambiguous between an index error and a misattribution.
