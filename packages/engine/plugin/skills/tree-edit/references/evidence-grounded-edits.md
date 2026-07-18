# Evidence-Grounded Tree Edits

Tree edits must be grounded in evidence — a **sourced piece of
evidence** or a **proved/well-supported conclusion** — not speculative
connections. Every modification to the tree file represents a claim
about a real person's identity, life events, or family relationships.
Unsubstantiated edits degrade the tree's reliability and can mislead
future research.

The tree carries **two layers** (`research-schema-spec.md` §8).
**Sourced evidence facts materialize onto tree persons as research
proceeds**, at identity-link time (via person-evidence's
`materialize_facts`), each carrying a non-null source-ref — they do
**not** wait for a proof conclusion. **Which value is *concluded*** —
the `primary` fact / `preferred` name — is a separate, later act owned
by proof-conclusion, and **upload to FamilySearch stays
conclusion-gated** (only `primary`/proof-backed facts leave the working
tree). The old "nothing lands until proof ≥ probable" reading is relaxed
accordingly: proof ≥ probable gates the **conclusion** and the
**upload**, not the sourced evidence.

## When edits are justified

A tree edit is justified when it fits one of the two layers:

- **Sourced evidence** — the edit adds a fact, name, or relationship
  extracted from a source and carrying a non-null source-ref. Evidence
  facts materialize at identity-link time; a proof conclusion is **not**
  required to land sourced evidence. (This is normally person-evidence's
  `materialize_facts` path; ad-hoc, tree-edit may add such a fact when
  its source is already linked — e.g. an occupation found in a census
  record already cited.)
- **A concluded value** — a proof conclusion at "probable" tier or
  higher supports marking which value is `primary`/`preferred`, or
  concluding a relationship no single record states. Setting the
  concluded value is proof-gated; materializing the underlying evidence
  is not.
- **An objective-error correction** (typo, transcription mistake) that
  is verifiable against the cited source.

An edit is NOT justified when:

- The connection is speculative or based on name-matching alone
- No source supports the fact and no reasonably thorough research
  supports the claim
- A value is *concluded* prematurely — coexisting sourced facts are
  fine and expected, but marking one `primary` before the conflicting
  evidence is examined and resolved is not
- The edit assumes a relationship that documentation does not support

## Avoiding premature conclusions

Materializing sourced evidence is not the same as committing to a
conclusion. Sourced evidence facts accumulate on a person freely; what
must never be forced prematurely is the **concluded value**
(`primary`/`preferred`) or an unsupported relationship. A tree file is a
working tool, not a finished publication. When the evidence does not yet
settle a *conclusion*:

- Record the sourced evidence, and leave the concluded value
  (`primary`/`preferred`) unset until proof-conclusion weighs it
- Let conflicting sourced values coexist as separate facts rather than
  picking a side
- Leave relationship fields empty rather than guessing at a subtype
- Flag uncertain conclusions for further research rather than treating
  guesses as concluded facts

The tree should reflect the current state of **sourced evidence and
proved conclusions**. It is better to have un-concluded evidence — or
gaps — than wrong *conclusions* that become entrenched and difficult to
undo.

## Source support for every edit

Every fact, name, or relationship added to the tree should trace back
to at least one source reference. When adding data:

- Include a `sources` array pointing to the relevant source entry
- Record enough citation detail (page, entry number, dwelling) for
  someone else to locate the original
- Distinguish between data that comes from original records with
  firsthand information versus derivative or secondhand sources
- When two sources disagree, the proof conclusion — not the tree
  edit — is where the conflict resolution belongs
