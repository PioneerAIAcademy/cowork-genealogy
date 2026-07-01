# Pedigree Analysis for Gap Detection

Guidance for evaluating pedigree data to identify research gaps,
errors, and candidates for new research questions.

## Purpose

Pedigree analysis is the process of systematically reviewing the
individuals in a family tree to detect missing information, logical
errors, and inconsistencies. It is a critical first step before
selecting new research questions — it reveals where the gaps are
and which gaps are most significant.

## Minimum Data Requirements

Every individual in the pedigree should have at minimum:

- **A name** (full name including surname)
- **A specific date** (at least one of: birth, marriage, or death —
  not just "about 1800" but ideally a day-month-year)
- **A reasonably specific place** (at county, parish, or town level
  — not just a country or state)

Individuals missing any of these three data points are candidates
for new research questions.

## Completeness Assessment

Evaluate the pedigree for structural gaps:

- Which individuals lack parent links? (Missing generations)
- Which couples lack marriage information?
- Which families have incomplete child lists?
- Which individuals appear only once (no connecting records)?
- Are there entire branches with no dates or places?

## Logical Consistency Checks

Dates and relationships must be internally consistent. Flag any of
these impossibilities or implausibilities:

### Date logic
- Birth date after death date
- Marriage before age 12 (or before birth)
- Death after age 120
- Child born after mother's death
- Child born when mother was under 12 or over 50
- Child born after father's death by more than 9 months

### Parent-child relationships
- Parent-child age difference less than 15 years
- Parent-child age difference greater than 70 years
- Sibling born less than 9 months after previous sibling
  (if same mother)

### Geographic consistency
- Children born in places where parents were not residing
- Events in places that did not exist at the stated date
  (jurisdictions were created, split, and renamed over time)
- Migration timelines that are physically implausible for the
  period's transportation technology

## Historical Context Awareness

Dates and places carry historical significance beyond identification.
When analyzing a pedigree, consider:

- **Wars and military service**: Was the person of military age
  during a conflict? Military records may exist.
- **Migration patterns**: Were there major migration events affecting
  this area and time period? (Gold rushes, land openings, famine
  emigration, religious migrations.)
- **Jurisdictional existence**: Did the named county, parish, or
  town exist at the stated date? Many boundary changes occurred as
  populations grew.
- **Record availability**: What records would have been created for
  this person given their time, place, religion, and social status?
  Records start at different dates in different jurisdictions.

## Source Quality Assessment

For each fact in the pedigree, evaluate:

- Is the fact supported by a citation?
- Is the cited source an original record or a derivative?
- Do multiple sources agree, or is there conflicting information?
- Are any facts sourced only from unverified online family trees?

Facts backed only by compiled sources (online trees, undocumented
genealogies, derivative indexes) should be treated as unverified
leads, not established facts. They may be starting points for
research but cannot support a proved conclusion.

## Prioritizing Gaps for Research

Not all gaps are equally important. Prioritize based on:

1. **Proximity to the research objective**: Gaps directly blocking
   the project's central question take priority.
2. **Gatekeeper potential**: Filling this gap would unblock multiple
   downstream questions.
3. **Likelihood of success**: Records are known to exist for the
   jurisdiction and time period.
4. **Error risk**: An inconsistency suggests misidentification —
   resolving it prevents building on a false foundation.
5. **Generation depth**: Earlier generations (closer to the subject)
   generally take priority over more distant ancestors, since errors
   compound with each generation.

## Integration with Question Selection

After completing pedigree analysis, feed the findings into the
question selection priority system:

- Logical impossibilities map to `unresolved_conflict` (Priority 1)
  if they block other questions
- Missing key data for the research subject maps to `pedigree_gap`
  (Priority 5)
- Unverified claims from compiled sources may trigger new questions
  to verify them before building further

The pedigree analysis does not itself produce questions — it
identifies where questions are needed. The question formulation
criteria (see `question-formulation.md`) govern how those gaps get
turned into well-formed, testable research questions.
