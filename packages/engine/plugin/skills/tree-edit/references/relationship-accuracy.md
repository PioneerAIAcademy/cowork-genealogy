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
"biological." A census household listing is the usual occasion for
this, and what the schedule states splits at 1880:

- **Pre-1880 (1850/1860/1870)** — the schedule has **no relationship
  column**, so the record states no relationship at all, only that
  these people shared a dwelling. Any parent-child reading is an
  inference from headship and co-residence, not something the record
  says (see "When to create relationships" below for what that means
  for the edge).
- **1880 onward** — the schedule adds a relationship-to-head column,
  so a relationship **is** stated and must be read as stated ("son",
  "wife"). What it still does not state is the **type**: a stated
  "son" may be biological, step, or adopted.

The dividing line is whether the record states the relationship, not
how confident you are about it.

### Guardianship shortly after a remarriage

A man appointed guardian of children who bear a **different surname**,
shortly after marrying a woman connected to that surname, is most
likely their **stepfather** — the children are hers by a prior
marriage. The differing surname is the expected pattern here, not a
conflict, and it is not grounds to posit an extra generation to
explain the guardian's role.

**What to record.** The inference tells you *who* the parties are to
each other; it does not license a **type**. Write the parent-child
edge with **no subtype at all**. The bond plus the marriage is a
hypothesis about the type, not evidence of it, and a `Step` subtype
written on that pair alone fails the threshold above. Do not
compensate by asserting the **mother's** edge as Genetic either — her
maternity rests on the same surname correspondence and gets the same
treatment. State the stepfather hypothesis in your reply; leave the
subtype field empty until a source settles it.

**Research implication:** Treat the step-relationship as the leading
hypothesis, not as a settled type. Look for the mother's earlier
marriage and for the children's births under the earlier surname, and
check whether an estate or inheritance drove the appointment — a
guardianship was routinely granted over a minor's property, including
to the minor's own parent, so the appointment by itself establishes
neither orphanhood nor a step-relation.

## Couple-event facts belong on the relationship

Marriage, divorce, and other couple events are facts of the **`Couple`
relationship**, not of either spouse. Record them in the relationship's
`facts` array — supplied when you create the relationship — never as a
person-level fact. A marriage stored on a person record misplaces the
event; the couple relationship is its only correct home.

**The relationship edge needs its own source-ref, separate from the
fact's** — a `sources` array nested only inside `facts[]` fails
validation (the edge and each fact are checked independently). A
marriage record's assertion has `fact_type: "marriage"`, which
`sourceAssertionId` rejects — for a Couple edge, supply
`relationship.sources` *and* each fact's own `sources`: `relationship:
{ type: "Couple", person1, person2, sources: [{ ref: "S5", page }],
facts: [{ type: "Marriage", date, place, sources: [{ ref: "S5", page
}] }] }`. Use `sourceAssertionId` only when a `fact_type: "relationship"`
assertion establishes the edge.

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
