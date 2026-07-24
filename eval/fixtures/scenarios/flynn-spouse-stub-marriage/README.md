# Scenario: flynn-spouse-stub-marriage

A variant of `flynn-couple-marriage` built specifically for the
**person-evidence lane-boundary** case. It is identical to that scenario
except that the spouse (**Mary**) is **not in the tree** — so a marriage
relationship assertion names a bride who needs a new stub. This is the
situation the wilkins-marriage e2e run mishandled: person-evidence
overstepped its lane by creating the subject's `Couple` relationship and
writing the marriage as a person-level `add_fact`, leaving the
relationship factless.

## State

- **Subject:** Patrick Flynn (`I1`), b. ~1845 Ireland, Schuylkill County, PA.
- **Father in the tree:** Thomas (`I2`) Flynn, linked to Patrick by a
  `ParentChild` relationship (`RT1`).
- **Mother/spouse NOT in the tree.** There is no Mary. The marriage
  assertion `a_005` (source `S5` / `src_005`) names the bride as **Mary
  Doyle**, who matches no existing person — so a stub must be created.
- **No `Couple` relationship yet.**

## What it exercises

- person-evidence linking the marriage assertion `a_005` (Thomas Flynn
  married Mary Doyle, 12 May 1843, St. Patrick's Church, Schuylkill County,
  Pennsylvania). The correct behavior is: create Mary as a new **stub**
  person (person-evidence owns the `persons` section) and create a `pe_`
  link for **both** parties — then **stop**.
- The failure this guards against: person-evidence creating the `Couple`
  relationship or writing a `Marriage` fact. Per the harness
  `TREE_OWNERSHIP_TABLE`, person-evidence does **not** own the
  `relationships` section — the Couple relationship and its marriage fact
  are written later by proof-conclusion → tree-edit. See
  `skills/person-evidence/SKILL.md` §5/§7 and
  `skills/tree-edit/references/relationship-accuracy.md`.

Copied from `flynn-couple-marriage`: `research.json` and the `results/`
sidecars are unchanged (person_evidence is empty and no entry references
Mary, so removing her from the tree is FK-safe). Only `tree.gedcomx.json`
differs — person `I3` (Mary) and her `ParentChild` link `RT2` are removed.
