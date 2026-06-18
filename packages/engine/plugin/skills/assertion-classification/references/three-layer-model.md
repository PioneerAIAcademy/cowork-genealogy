# The Three-Layer Classification Model

## Core Principle: Independence of Layers

The three layers -- source, information, and evidence -- are evaluated
independently. The classification at one layer does NOT determine the
classification at another. An original source can contain secondary
information. A derivative source can provide direct evidence. Each
layer operates on its own terms.

---

## Layer 1: Source Classification

Source classification addresses the FORM of the record -- how close is
this document to the first recording?

### Original

The first recording of information, or the earliest surviving version.

Includes:
- Handwritten documents created at or near the time of the event
- Faithful reproductions: facsimiles, photocopies, microfilm, digital
  images (if true, unaltered copies)
- Government "record copies" made by the recording office as part of
  its official function (e.g., deed recorded in county deed book)
- Certified transcripts issued by the custodial agency

### Derivative

Any record derived from another source through copying, transcribing,
abstracting, indexing, or translating. Always at least one step removed
from the original.

Types: indexes, abstracts, transcripts, translations, extracts,
database entries.

### Authored Narrative

A work that synthesizes findings from many sources, incorporating the
author's analysis, conclusions, and narrative structure. Examples:
compiled genealogies, biographies, proof summaries, county histories.

### Special Cases for Source Classification

- A derivative of a derivative does NOT make the first derivative an
  original. If A is original, B is a transcript of A, and C is a
  transcript of B, both B and C remain derivatives.
- A county register arranged in alphabetical order may be derivative --
  alphabetical arrangement suggests entries were recopied from loose
  original certificates.
- Census sheets found in alphabetical order may have been recopied from
  the enumerator's original returns.
- Court copies of wills: derivative if the original still exists; if
  the original was lost/destroyed, the court copy becomes the earliest
  existing version (treated as original).
- A digital image of an original is treated as original if it is a
  true, unaltered copy.

### Why Classify Sources?

The practical reason: ensure original records are used whenever
possible. Derivatives introduce opportunities for transcription errors,
omissions, and misinterpretation.

---

## Layer 2: Information Classification

Information classification is about the INFORMANT -- the person who
provided the information. This is completely independent of source
classification.

### The Informant-Centric Approach

The key question is always: who provided THIS specific piece of
information, and what was their relationship to the event?

Critical rules:
- Indexers and transcribers are NOT informants. When classifying
  information in a derivative, look back to who the informant was for
  the original record.
- A single source often has multiple informants, each contributing
  different facts with varying knowledge levels.
- Each fact must be classified separately based on the specific
  informant's knowledge of that specific event.

### The Two-Question Decision Tree

1. Do we know the informant?
   - NO --> Undetermined
   - YES --> proceed to question 2

2. Did the informant witness, participate in, or have first-hand
   knowledge of the event?
   - YES --> Primary
   - NO --> Secondary
   - CANNOT TELL --> Undetermined

### Primary Information

Provided by an eyewitness or participant -- someone with first-hand
knowledge. The test: "Was the informant there and aware?"

Critical nuance: Primary information CAN STILL BE WRONG. An eyewitness
can misremember, lie, or be mistaken. Being wrong does not change the
classification -- it remains primary because the informant had
first-hand knowledge. Classification describes the informant's
relationship to the event, not the accuracy of their report.

### Secondary Information

Provided by someone who did NOT have first-hand knowledge. They were
not an eyewitness or participant.

Critical nuance: The informant may be highly reliable, may have known
the fact their entire life, but if they did not personally witness the
event, their information is secondary. Example: you "know" your birth
date -- you have been told it your whole life. But you cannot provide
primary information about your own birth because you were not
cognitively aware during the event. Only a conscious adult present at
your birth (mother, physician, midwife) can provide primary information.

### Undetermined Information

Cannot determine whether the informant had first-hand knowledge. This
is the only classification that can change with discovery of new
evidence (e.g., identifying who the informant was).

### Multiple Informants Per Source

A death certificate typically has three distinct informants:

1. Personal information provider (usually a family member) -- provides
   decedent's name, birth date, birthplace, parents' names, occupation
2. Attending physician -- provides cause of death, date of death,
   duration of illness
3. Undertaker/funeral director -- provides burial date, burial
   location

Each informant's contribution must be classified separately.

### Pre-1940 US Census Special Case

Before 1940, the census enumerator did not record who in the household
answered questions. In most cases, information is therefore undetermined.

However, some facts can still be classified regardless of who answered:
- Parents' birthplaces reported by anyone in a household of father,
  mother, and small children = secondary information no matter who
  spoke. No one in that household could have had first-hand knowledge
  of where the grandparents were born.

The 1940 census introduced identification of the respondent, enabling
classification of each data point. Before 1940 the informant is never
identified: enumerators most often spoke with a household member, but
commonly obtained information from a neighbor when residents were
unavailable — treat census informant identity as unknown, not as an
established household member.

### Informant Lookup by Record Type

| Record type | Fact | Likely informant | Proximity |
|------------|------|-----------------|-----------|
| Census (any year) | Name | Unknown — most likely a household member, possibly a neighbor | `unknown` |
| Census (any year) | Age/birthplace | Most likely a household member (head or spouse), possibly a neighbor | `unknown` |
| Census (any year) | Residence | Census enumerator | `witness` |
| Census (1790–1870) | Relationship | No informant -- inferred from position | `unknown` |
| Census (1880+) | Relationship | Household respondent | `household_member` |
| Death certificate | Death date/cause | Attending physician | `witness` |
| Death certificate | Birth date/place, parents | Named family informant | `family_not_present` |
| Vital record (birth) | Birth facts | Physician or midwife | `witness` |
| Vital record (birth) | Parent names | Parent (usually mother) | `self` |
| Probate/will | Bequests, heirs named | Testator | `self` |
| Land deed | Property facts | Parties to the deed | `self` |
| Church register | Baptism/marriage | Clergyman | `witness` |
| Obituary | Death/biographical facts | Reporter (from family/funeral home) | `family_not_present` or `unknown` |
| Military pension | Service facts | Veteran | `self` |
| Military pension | Family details | Veteran or widow | `self` or `family_not_present` |

---

## Layer 3: Evidence Classification

Evidence classification addresses HOW information answers a specific
research question. Evidence is conceptual -- it is the relationship
between information and the question being asked.

This layer is independent of source and information classification.

### Direct Evidence

Explicitly answers the research question. The information states the
answer outright; no inference is needed.

Critical: direct evidence CAN STILL BE WRONG. A birth certificate
might state the wrong father. "Direct" means only that the information
explicitly addresses the question -- it says nothing about accuracy.

### Indirect Evidence

Does NOT explicitly answer the question but allows a reasonable
inference. The researcher must combine the information with other
knowledge to derive an answer.

Example: A burial record states "buried 3 March 1890" -- direct
evidence of burial date, but indirect evidence of death date (we infer
death occurred one to three days before burial).

### Negative Evidence

Arises when EXPECTED information is meaningfully absent.

Requirements for negative evidence:
- The record must be one where the information SHOULD appear if the
  fact were true
- The absence must be meaningful given the context

Context matters: The absence of a christening record in 1800s England
(where parish christening was nearly universal) is significant. The
same absence in the US (where christening was not universal) is far
less meaningful.

### No Evidence

Sometimes information simply does not answer the research question at
all. It is irrelevant to the question being asked.

Critical distinction -- nil search vs. negative evidence:
- A failure to find a record is NOT negative evidence unless you have
  searched ALL pertinent collections and can demonstrate the record
  should exist if the event occurred.
- Only after reasonably exhaustive searching does absence become
  meaningful negative evidence.
- The absence of information that would not normally be present in a
  record type is simply "no evidence," not negative evidence. Example:
  a marriage record without parents' names is not negative evidence
  about parentage -- parents' names are not expected on most marriage
  records.

### Evidence Exists Only in Relation to Questions

The same piece of information can be:
- Direct evidence for one research question
- Indirect evidence for a different question
- No evidence for a third question

If there is no research question, there is no evidence.

---

## BCG Standards 35-46: Key Principles

### Source Analysis (Standard 35)

When examining sources, appraise each source's likely accuracy,
integrity, and completeness. Consider: physical condition, legibility,
whether original or derivative, internal consistency, external
consistency, provenance, purpose, and time lapse between events and
recording.

### Information Analysis (Standard 36)

For each information item, appraise accuracy, integrity, completeness.
Consider: legibility, who provided the information, that person's
reliability and consistency, whether primary or secondary, internal
consistency, and external consistency with other information in the
same source.

### Evidence Mining (Standard 40)

Seek evidence that answers questions directly, indirectly, or
negatively. Ignore no potentially useful evidence -- including indirect
and negative evidence or evidence conflicting with a working
hypothesis. Give equal attention to all evidence types.

### Evidence Integrity (Standard 43)

Never trim, tailor, slight, or ignore potentially relevant evidence to
fit a bias, to harmonize with other evidence, or for any other reason.

### Evidence Reliability (Standard 44)

Any evidence item may be proved reliable or not. Unreliable evidence
may still be useful: to follow as a clue, explain an error, or resolve
conflicting evidence.

### Evidence Independence (Standard 46)

Weigh evidence from independent information items. When items are
related (e.g., birthdate from obituary and death certificate sharing
the same informant), group them into a unit and assign that unit no
more credibility than the strongest item in the group.

### Evidence Correlation (Standard 47)

Test evidence by comparing and contrasting items. Use correlation to
discover parallels, patterns, and inconsistencies.
