# Relationship Accuracy

Placing individuals accurately in families is a core genealogical
competency. Tree edits that create or modify relationships carry
special responsibility because they assert how real people were
connected to each other.

## Distinguishing relationship types

Not all parent-child or couple relationships are the same. When
evidence supports it, the tree should distinguish among:

- **Genetic (biological)** relationships — the parent is the
  biological parent of the child
- **Adoptive** relationships — the child was legally adopted
- **Step** relationships — the parent is married to a biological
  parent but is not the child's biological parent
- **Foster** relationships — the child was placed in the household
  but not legally adopted
- **Other guardianship** — the child was raised by grandparents,
  relatives, or other caretakers

When the specific relationship type is unknown, record the
relationship without asserting a type rather than defaulting to
"biological." A household listing in a census may show a child
living with adults without clarifying whether the connection is
genetic, adoptive, or something else.

## When to create relationships

Create a relationship entry when:

- A proof conclusion confirms the parent-child or couple connection
- Direct evidence from a reliable source explicitly states the
  relationship (e.g., a birth certificate naming parents)
- Multiple pieces of indirect evidence, when correlated, support
  the connection and no conflicting evidence remains unresolved

Do NOT create a relationship entry when:

- Two people share a surname and lived near each other (name +
  proximity is not proof)
- A single secondary source asserts the connection without
  corroboration
- The hypothesis has not been tested against potentially
  conflicting evidence

## Merge implications for relationships

When merging two persons, all relationships referencing the
deprecated person must transfer to the surviving person. After
transfer, check for:

- **Duplicate relationships** — the same parent-child pair now
  appearing twice (remove the duplicate)
- **Contradictory relationships** — the merged person now appears
  as both parent and child of the same individual, or has two
  sets of biological parents (flag for review)
- **Impossible configurations** — a child born before their
  parent, or other logical impossibilities introduced by the
  merge

These checks are why `check-warnings` must run after every merge.

## Biographical context beyond vital statistics

Persons in the tree benefit from facts beyond birth, marriage, and
death. Occupation, residence, military service, religious
affiliation, and other biographical details help distinguish
individuals who share names and approximate dates. They also
provide the historical context that makes each person's record
meaningful rather than a bare skeleton of dates and places.

When sources provide biographical details, add them as facts on
the person rather than discarding them as "non-essential." These
details often become critical indirect evidence for resolving
identity questions later.
