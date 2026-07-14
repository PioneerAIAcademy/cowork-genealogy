# Scenario: flynn-couple-marriage

A variant of `flynn-record-matching` built specifically for the
**tree-edit couple-event placement** case. It is identical to that
scenario except that the tree holds **no `Couple` relationship** between
the parents — only the two `ParentChild` links.

## State

- **Subject:** Patrick Flynn (`I1`), b. ~1845 Ireland, Schuylkill County, PA.
- **Parents in the tree:** Thomas (`I2`) and Mary (`I3`) Flynn, each linked
  to Patrick by a `ParentChild` relationship (`RT1`, `RT2`).
- **No `Couple` relationship yet.** Thomas and Mary are not connected to
  each other. There is therefore nowhere to hang a couple-event fact until
  the relationship is created.

## What it exercises

- tree-edit recording a documented **marriage** for Thomas and Mary. Because
  there is no `update_relationship` operation, the only correct way to record
  the event is a single `add_relationship` call that creates the `Couple`
  relationship **with the `Marriage` fact in its `facts` array**.
- The failure this guards against: writing the marriage as a person-level
  `add_fact` on Thomas (`I2`) or Mary (`I3`). Couple events belong on the
  `Couple` relationship, never on a person — see
  `skills/tree-edit/references/relationship-accuracy.md`.

Copied verbatim from `flynn-record-matching`: `research.json` and the
`results/` sidecars (FK-consistent). Only `tree.gedcomx.json` differs —
the `Couple` relationship `RT3` is removed.
