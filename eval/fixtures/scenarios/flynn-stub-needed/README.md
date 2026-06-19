# flynn-stub-needed

Delta off `flynn-record-matching` for the person-evidence #349 deep-dive (stub-person creation — the headline gap).

**The only change vs the base:** one added assertion, **a_005** — the will of Thomas Flynn (the same full-text probate record that names 'my son Patrick Flynn' in a_004) **also names 'my son James Flynn'** (role `heir_2`).

**Why it forces a stub:** there is **no James Flynn** in `tree.gedcomx.json` (only Patrick I1, Thomas I2, Mary I3). Linking a_005 therefore cannot reuse an existing person — person-evidence must create a new **stub person** (synthetic id, gender Male, name James Flynn) per SKILL.md Step 5 and research-schema-spec.md §8 (line 656), then link a_005 to it. a_005 is full-text-sourced (`record_persona_id: null`), so `same_person` cannot run and `match_score` stays null — the link rests on correlation (the will explicitly names the relationship).

`tree.gedcomx.json` is copied **unchanged** from the base — the absence of James is the point.
