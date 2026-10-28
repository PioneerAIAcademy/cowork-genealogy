# luxembourg-birth-given-name-only

Theresia Reding, born 17 June 1846 in Arsdorf, Redange, Luxembourg. Father: Jakob Reding. Mother: Maria Schroeder.

The research question is to find Theresia's civil birth record and confirm her parents.

**Indexing quirk.** Luxembourg civil birth acts index the newborn by given name only — no surname. A `surname: Reding` query returns records where a Reding is named as a parent, not as the child. The agent must recognize this pattern and drop `surname`, searching instead with `givenName: Theresia` + `fatherSurname: Reding` (or the mother's equivalents) anchored on `recordCountry: Luxembourg`.

**Expected outcome.** The agent finds ark:/61903/1:1:6LYM-X1PN (Theresia, born 17 June 1846, Arsdorf, father Jakob Reding) and logs the record in research.json.
