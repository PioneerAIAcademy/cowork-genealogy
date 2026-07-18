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

## Couple-event facts belong on the relationship

Marriage, divorce, and other couple events are facts of the **`Couple`
relationship**, not of either spouse. Record them in the relationship's
`facts` array — supplied when you create the relationship — never as a
person-level fact. A marriage stored on a person record misplaces the
event; the couple relationship is its only correct home.

## When to create relationships

Relationships follow the same two layers as facts
(`research-schema-spec.md` §8): a **sourced evidence edge** materializes
at identity-link time, while a **concluded** relationship is proof-gated.

Create a relationship **edge** (carrying a non-null source-ref) when:

- Direct evidence from a reliable source states the relationship (e.g.,
  a birth certificate naming parents, or a census listing a household).
  This is sourced evidence and does **not** require a proof conclusion
  first; the edge carries the relationship assertion's source-ref.
- A proof conclusion confirms a parent-child or couple connection that
  no single record states (the concluded relationship).

A **pre-1880 census parent-child edge is *indirect*** evidence (a
headship/co-residence inference, not a stated relationship) — it still
materializes with a source-ref, at a **lower ref quality** reflecting
the weaker evidence class. Correlating several indirect pieces into a
*concluded* relationship remains proof-conclusion's act.

Do NOT create a relationship entry when:

- Two people share a surname and lived near each other (name +
  proximity is neither evidence nor proof)
- No source supports the connection at all
- You are asserting a *concluded* relationship whose hypothesis has not
  been tested against potentially conflicting evidence

## Merge implications for relationships

The merge tool (`merge_tree_persons`)
repoints every relationship referencing the collapsed person to the
survivor and drops the duplicate parent-child pairs that result — you do
not transfer or de-duplicate relationships by hand. What the tools
cannot judge is genealogical plausibility: a merge can still leave the
person as both parent and child of the same individual, give them two
sets of biological parents, or imply a child born before their parent.
This is why `check-warnings` must run after every merge.

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
