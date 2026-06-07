# Information Classification at Extraction Time

Layer 2 of the three-layer model evaluates WHO provided each piece of
information and whether that person had firsthand knowledge. This
classification is entirely independent of source classification.

## The Two-Question Decision Tree

1. **Do we know the informant?**
   - No -> Undetermined
   - Yes -> proceed to question 2

2. **Did the informant witness, participate in, or have firsthand
   knowledge of the event?**
   - Yes -> Primary
   - No -> Secondary
   - Cannot tell -> Undetermined

## Definitions

### Primary

The informant was an eyewitness or direct participant. They had
firsthand knowledge of the event.

Important: primary information can still be wrong. An eyewitness can
misremember or lie. Being wrong does not change the classification --
it is still primary because the informant had direct knowledge.

### Secondary

The informant did NOT have firsthand knowledge. They are reporting
what they were told, what they believe, or what they inferred.

Classic example: you know your own birth date -- you have been told it
your whole life and celebrate it yearly. But you cannot provide primary
information about your own birth because you were not cognitively aware
during it. Your mother or the attending physician could provide primary
information. You can only provide secondary.

### Undetermined

The informant's identity is unknown, OR it is unclear whether the
known informant witnessed the event. This is the only classification
that can change if new evidence reveals the informant's identity.

## Multiple Informants per Source

Many records contain information from several different people, each
with different knowledge levels. You must classify EACH fact
separately based on who provided THAT specific piece of information.

### Death Certificate Example (Three Informants)

A death certificate typically has three distinct informants:

1. **Family member or personal information provider** -- supplies the
   decedent's name, birth date, birthplace, parents' names, occupation,
   marital status. This person is usually secondary for birth facts
   (they were not present at the decedent's birth) and may be secondary
   or undetermined for parents' names.

2. **Attending physician** -- supplies cause of death, date of death,
   duration of illness. This person is primary for death facts because
   they witnessed or attended the death.

3. **Funeral director** -- supplies burial date, burial location,
   funeral arrangements. Primary for burial details.

Each informant's contribution must be classified separately.

### Pre-1940 U.S. Census

Before 1940, census records do not identify which household member
answered the enumerator's questions. Most information is therefore
undetermined.

However, some facts can still be classified regardless of who the
informant was. For example, in a household with a father, mother, and
small children, the birthplaces of the grandparents would be secondary
no matter who answered -- no one in that household was present at the
grandparents' births.

### Per-Fact Census Breakdown (Pre-1940)

When extracting from a pre-1940 census, use these defaults:
- **Name facts:** `unknown` proximity — the enumerator may not have
  gotten the name directly from a household member
- **Age/birthplace facts:** `household_member` — someone actively
  reported these (but identity of that person is unknown)
- **Residence facts:** `witness` — the enumerator visited the dwelling
  and confirmed it. Information quality is `primary`.
- **Relationship facts (1880+):** `household_member` — someone reported
  the relationship. Before 1880, relationships are inferred from
  position (use `child_inferred`, `wife_inferred`, etc.).

### 1940 and Later Census

The 1940 census introduced a field identifying the informant, which
enables per-fact classification:
- The informant's own name, sex, marital status -> primary
- The informant's own birthplace -> secondary (not cognitively
  aware at birth)
- Parents' birthplaces -> secondary

### Marriage Records

Marriage records often involve multiple informants:
- Each party is primary for their own name and consent (they were
  present and participating).
- Each party is secondary for the other party's birth details
  (they were not present at the other's birth).
- Parents' consent (when recorded): primary from the parent who
  signed; secondary if reported by the couple.
- The officiant is primary for the ceremony date and location.
- Witnesses are primary for the fact that the ceremony occurred.

## Informant vs. Recorder

The recorder (e.g., census enumerator, clerk, minister) is NOT the
informant. They are the person who wrote down the information. The
informant is whoever told the recorder the facts.

When classifying information in a derivative source (such as an
index), look through the derivative to who the original informant
would have been. An Ancestry indexer who typed a name incorrectly is
not the informant -- the original household respondent is.

## Informant Bias

Even after classifying information quality, consider potential bias:
- Did the informant have a motive to falsify? (e.g., lying about
  age for military enlistment, misrepresenting parentage)
- Had significant time elapsed between the event and reporting?
- Was the informant under stress or duress?
- Was the informant mentally capable and of legal age?
- Is the information contested by other sources?

Record bias concerns in the assertion's `informant_bias_notes` field.
