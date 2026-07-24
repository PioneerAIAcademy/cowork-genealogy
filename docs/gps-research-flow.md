# How the research works

This describes the research method the system follows — the order it works
in, the judgments it makes at each stage, and the standards it holds itself
to. It is written for two purposes: so genealogists can judge whether the
method is sound, and so anyone starting a project knows what to expect.

The method is the Genealogical Proof Standard. Nothing here is meant to be
novel; where the system takes an opinionated position, it says so.

---

## The research cycle

```
        Define the problem, survey what's known
                        │
                        ▼
             Choose the next question  ◀──────────────┐
                        │                             │
                        ▼                             │
                  Plan the search                     │
                        │                             │
                        ▼                             │
                     Search                           │
                        │                             │
                        ▼                             │
        Extract the evidence from each record         │
                        │                             │
                        ▼                             │
            Decide who the record is about            │
                        │                             │
              ┌─────────┴─────────┐                   │
              ▼                   ▼                   │
        Resolve conflicts    Track hypotheses         │
              └─────────┬─────────┘                   │
                        ▼                             │
          Is the research exhaustive? ── not yet ─────┘
                        │ yes
                        ▼
              Write the conclusion
                        │
                        ▼
            Critique the conclusion
```

The plan is not a checklist to be drained. As soon as the evidence in hand
*plausibly* answers the question, the system moves to the exhaustiveness
test. If that test finds a gap, it returns to planning.

You can work through this two ways: step by step, with the system pausing
for your judgment at each decision, or continuously, where it works the
cycle on its own and stops when the objective is answered, when you halt
it, or when it hits something it can't resolve.

---

## Stage by stage

### Defining the problem and surveying what's known

The session opens with a short interview: your experience level, which sets
how much the system explains as it goes, and which subscription sites you
hold, used later to break ties between equivalent sources — never as a gate
on what gets searched. It then records your objective and what you already
hold: family papers, prior research, certificates.

If the project starts from an existing online tree, every fact imported
from it is marked as *questionable* compiled data. Nothing arrives trusted
because someone else entered it.

### Choosing the next question

One question at a time, chosen against a stated priority order: an
unresolved conflict first, then an open hypothesis to test, then a
high-severity gap in the timeline, then decomposing the objective into its
parts, then a pedigree gap, then a FAN pivot, then following up new
evidence. The reason for the choice is recorded, so you can disagree with
it.

Two rules govern the loop:

- **Finish what's open.** If a planned search is already underway, the
  system recommends completing it rather than opening a new question —
  unless an unresolved conflict blocks that question.
- **Stop when the objective is answered, not when everything is proved.**
  Once each independent part of the objective carries a conclusion at
  *probable* or better, research stops. The system does not invent
  corroboration questions to push a *probable* up to *proved*.

A FAN pivot — moving to associates, neighbors, and witnesses — fires only
after the planned direct searches are done, never after a single negative
result.

### Planning the search

A question becomes a sequenced list of record sets, each with its
repository, the reason it's expected to help, and a fallback if it fails.
Plans run four to ten items. Fewer than three isn't an exhaustive plan; more
than twelve means the question should be split.

Before planning, the system surveys the locality: what records survive for
that place and period, who holds them, and what is digitized, indexed, or
neither.

The list is checked for breadth across record categories, plus two
requirements that are always enforced:

- A parentage question always gets a dedicated search for the **candidate
  parents' marriage to each other**.
- A male subject in a conscription country (Denmark and Norway from 1789)
  always gets the **military levy rolls** (*lægdsruller*) as a first-class
  parentage source, not a fallback.

If a plan already exists with unfinished items, the default is to recap the
next item rather than write a new plan. A plan is replaced only when its
assumptions have genuinely been invalidated.

### Searching

Four modes, chosen by what the records actually are.

**Indexed search** is the default. Queries go broad to narrow, with no
wildcards — explicit spelling variants instead — always anchored on surname
or country, and never narrowed by dropping the given name. Every search is
logged, including the ones that find nothing: a negative result is a
finding, and the query behind it is recorded so it isn't repeated blindly.

Results are ranked and presented for review, never auto-accepted. The
**namesake trap** carries particular weight here: a record more precise than
your tree's estimate but contradicting it is *more* disqualifying, not less.
Same-name individuals in the same county are treated as different people
until shown otherwise.

After a negative result, the system tries at least three changes of strategy
— spelling, place, date range, record type — before turning to subscription
sites.

**Full-text search** covers documents transcribed by machine but never
name-indexed. This is the only way to find someone as a witness, executor,
appraiser, bondsman, heir, or neighbor rather than as the principal of a
record. It behaves nothing like an indexed search: no fuzzy matching, no
Soundex, no abbreviation expansion — *Wm* and *William* are separate
searches. Three rules come from repeated failures:

- Search by **name only**, then filter for place. Putting the place in the
  query matches the collection's description, not the document.
- **Don't scope to a single collection.** A Cantabrian baptism found by an
  unscoped name search returned nothing when scoped to its own collection.
- **Decompose compound surnames into co-occurrence, not an exact phrase.**
  In the parents' own records the father carries the paternal surname and
  the mother the maternal one, so the two never appear adjacent.

Full-text hits are derivative — an original, photographed, then read by
machine, with meaningful error — so a hit is always confirmed against the
image before it is used.

**Image browsing** handles volumes that are digitized but neither indexed
nor transcribed: register by register, page by page. Listing a volume's
pages counts as a completed browse and is recorded as such. "No volumes
available" is ordinary evidence about what survives, logged as a negative
result rather than treated as a malfunction.

**Subscription sites** (Ancestry, MyHeritage, FindMyPast, FindAGrave,
Newspapers.com) prohibit automated access, so the system never loads their
pages. It constructs the search — resolving the place, choosing the right
record set, getting the parameters right — and you run it in your own
browser and bring back what you find. The genealogical judgment is the
system's; the access is yours. Both the constructed search and its outcome
are logged, and the search is logged *before* the link is handed over, so an
abandoned search still leaves a trace.

### Extracting evidence from a record

Each record is worked once, thoroughly, and everything in it is captured —
not just the fact that prompted the search. Extraction is always a
deliberate pass over the record; the system will not extract in passing,
however small the record looks.

The three GPS layers are classified **independently and per claim, never per
record**:

- **Source** — original, derivative, or authored
- **Information** — primary, secondary, or undetermined
- **Evidence** — direct, indirect, or negative

A contemporaneous death certificate is an *original* source even when the
informant's knowledge of the deceased's birthplace is secondhand; that
secondhand-ness is captured at the information layer, on that claim, rather
than by downgrading the whole document. Different claims within one record
routinely carry different classifications.

These classifications are first and final. There is no later refinement
pass, and everything downstream — conflict analysis, the exhaustiveness
test, the conclusion — trusts what was recorded here. The weight of the
whole method rests on this stage, which is why it is deliberately slow.

A name doing identity work but looking suspect — an out-of-place patronymic,
an uncorroborated spelling — is taken back to the original register image
before being recorded as established, or else recorded as tentative. This is
the path by which a transcription slip becomes a wrong father in the tree.

Where language or script blocks reading, the record goes to translation and
paleography first. It is not guessed at.

### Deciding who the record is about

Extraction records what a document says about a person *in that document*.
Deciding that this person is the same individual as one in your tree is a
separate, later, revisable judgment. Keeping the two apart is deliberate:
the identity decision is what carries a record's facts onto a person in your
tree, so it is made once, explicitly, with its reasoning recorded — never
assumed in the first minute of reading the record. It stays revisable, and
when later evidence shows a record was attached to the wrong person the
correction is added rather than the original link quietly erased.

Correlation across name, dates, places, relationships, and associates sets
one of three confidence levels:

- **Weak** — name alone, or a core identifier conflicts → recorded as
  speculative, and you are asked to confirm before it proceeds
- **Moderate** → probable
- **Strong** → confident

A computed match score is an input to that judgment, never a substitute for
it: a qualitative conflict caps confidence however well the numbers agree.
In particular, **a patronymic mismatch or an unexplained name element is a
conflict in a core identifier, not a spelling variant** — a different
patronymic names a different father.

When a record establishes a household, the whole household is linked, not
just the person you were looking for. A parent-child link inferred from
co-residence in a pre-1880 census is recorded as the weaker inference it is.

### Resolving conflicts

A conflict is narrower than it first appears: the same person, the same kind
of fact, and the same attribute — three different birthplaces, or three
different birth dates, but not a birthplace against a birth date. Facts that
legitimately take multiple values over a lifetime, such as occupation and
residence, are not conflicts and are not manufactured into them.

Resolution requires real analysis of source independence: information items
tracing back to a common origin get no more credibility than their strongest
single member, however many of them there are. The written resolution names
the two or three factors that actually decided it rather than scoring all
seven mechanically, and its final part explains **why the less reliable
evidence exists** — naming the historical pattern and the informant's
position that produced the error. A resolution missing that reasoning is not
recorded as resolved.

A conflict that can't be resolved yet is written down as a finding, with
what would resolve it — not left as a remark in conversation.

### Tracking hypotheses

Competing candidates are tracked explicitly through *active*, *supported*,
and *ruled out*. A new hypothesis starts active even when the evidence
already leans toward it; promotion is a separate judgment against stated
criteria — a supporting direct-evidence claim, no unresolved contradictions,
no chronological impossibility.

There is an explicit rule against demoting a supported hypothesis over
ordinary noise: census age rounding and a few years' drift in a reported
birth year are not grounds for reopening it. Ruling a hypothesis out
requires a stated reason.

### Testing whether the research is exhaustive

Two things are checked before anything else: every claim bearing on the
question carries real, reasoned classifications, and every person the
judgment depends on has had their identity resolved. Then the GPS threshold
questions, then seven stop criteria, each answered in a sentence or two and
recorded.

The default when in doubt is to go back and search more, on the principle
that a gap is usually unsearched rather than unobtainable. The exception is
a source actually pursued and verifiably unavailable — destroyed, sealed by
privacy law, or negative across every path tried. That is not an unsearched
gap.

Question type matters here. A simple recall question can stop early. A
completeness question — "did they have *any other* children?" — cannot
conclude without enumerating the sources that would show them.

Stopping early is allowed, but it is recorded as a non-exhaustive stop.
Research that stopped short is never labeled exhaustive.

### Writing the conclusion

The conclusion states a tier — proved, probable, possible, not proved, or
disproved — and takes the form the evidence warrants: a proof statement for
a directly-evidenced fact, a proof summary for accumulated direct evidence,
a proof argument where the case rests on indirect or negative evidence.

The written narrative *is* the conclusion, and it stands on its own: the
question, the evidence, the reasoning connecting them, the treatment of
contrary evidence, and the resulting claim — readable without the underlying
data.

Two hard limits:

- An unresolved conflict blocks a *proved* conclusion outright.
- A conflict disputing the concluded fact itself **caps the conclusion at
  *possible***, which sits below the threshold for concluding it in the tree.

The tree already holds the evidence by this point: each record's facts were
written onto the people it names when that record was linked to them,
carrying their source citations, with no value yet marked as the right one.
Writing the conclusion is what settles that. At *probable* or better, the
concluded relationship is added and the concluded value is marked preferred
over the competing ones — not piled on as another alternative. Below that
threshold the evidence stays in the tree unranked, and nothing is uploaded
to FamilySearch: only concluded facts leave the working tree. A conclusion
that never reaches the tree is a result found and then lost, so the system
verifies the write happened.

### Critique of the conclusion

Finished conclusions go to a reviewer that reads the written narrative as a
standalone document. It is the one check that asks whether the prose holds
together: whether the summary sentence contradicts the evidence listed under
it, whether the cited evidence supports the tier claimed, whether hedging
language sits uneasily against a confident claim.

The reviewer has no search tools. It evaluates what was gathered; it cannot
gather more.

The critique is **mandatory to run and advisory to act on**. It happens
after the conclusion is recorded, so a finding never silently rewrites the
answer or reopens a settled question. When it raises something substantive
in an interactive session, the system puts the question to you and waits
rather than quietly applying its own fix.

---

## What you can ask for along the way

These sit outside the loop. Ask for them in plain language at any point; the
system also reaches for them on its own when the research needs them.

**A locality guide.** What records exist for a place and period, who holds
them, and what is digitized, indexed, or only browsable. It reports what the
catalogs actually show — including the gaps — and does not fill silence with
plausible-sounding holdings.

**A timeline.** Every known event for a person in order, with gaps and
chronological impossibilities marked: events before birth or after death, a
person in two places too far apart for the era's travel, one person
enumerated twice in a census year. Gap boundaries are the dates of the
bounding events, never rounded out to January 1st. A timeline can span two
tree entries that may be the same person — which is often how you find out
whether they are.

**A citation.** Existing sources refined to *Evidence Explained* standards.
The test is replication: could another researcher find this exact record
from this citation alone? A missing locator is written into the citation as
an explicit unknown and flagged for you to check against the image, rather
than quietly omitted. A URL is never a citation.

**Translation and paleography.** German, French, Spanish, Italian, Dutch,
Latin, and Portuguese, including Kurrentschrift, Sütterlin, and Latin
parish-register abbreviations. The original is always preserved and always
governs: extraction cites the record, not the translation. Formulaic record
structure is used to constrain what an illegible word can be.

**Historical context.** Boundary changes, naming conventions, migration
patterns, period vocabulary. It presents possibilities rather than
conclusions, and keeps what the sources say distinct from what it merely
believes — if a lookup returns nothing, it says so instead of smoothing over
the gap.

**Calendar conversion.** Julian and Gregorian, Old Style and New Style year
starts, Quaker numbered months, double dating. One heuristic travels well: a
discrepancy of exactly 10–13 days, or exactly one year on a January–March
date, is almost certainly a calendar difference rather than a genuine
conflict.

**A data-quality check.** Impossible lifespans, events after death, a child
born after a parent's death. Several serious warnings on one person is
reported as a single finding — a strong signal that two individuals have
been merged into one profile — rather than as a list of unrelated problems.
A disagreement *between two sources* is not a warning; it is a conflict, and
goes to conflict resolution.

**A correction to the tree.** For genuine corrections and confirmed merges
outside the normal research flow. Merges happen only after a conclusion has
established identity at *probable* or better.

**Where am I?** A resume-a-project summary: what's been done, what's open,
what to do next — in plain language first, then in GPS terms. It assumes you
don't remember where you left off.

**A research-wiki lookup.** Any "how do I find [record type]" question is
answered from the FamilySearch Research Wiki rather than from memory, even
when the answer seems obvious.

**Practice mode.** Strips known information out of your tree so it has to be
re-derived from records. Both halves are required: the answer is removed
locally, *and* the system is barred from looking it back up in the online
tree for the rest of the project. Reading records *about* those people is the
whole point; reading someone else's compiled conclusions about them is the
one forbidden move.

---

## What the system will not do

- **Assert anything a source didn't say.** Collections, record counts,
  repositories, and page contents come from what was actually retrieved. An
  empty result is reported as an empty result.
- **Skip stops because you named a destination.** Asking for the conclusion
  is not permission to skip the exhaustiveness test.
- **Treat a match score as an identity decision.** Scores inform judgment;
  they don't replace it, and they never override a qualitative conflict.
- **Claim work it didn't do.** It doesn't report a record as saved unless the
  evidence was actually extracted and recorded.
- **Reclassify evidence to fit a conclusion.** Classification happens once,
  when the record is read, before anyone knows which way the answer runs.
