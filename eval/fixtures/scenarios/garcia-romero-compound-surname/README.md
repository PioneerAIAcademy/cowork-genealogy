# Scenario: garcia-romero-compound-surname

Spanish parentage question with **no plan yet** for a subject carrying a
**compound (two-surname) name**.

- **Subject:** María Josefa García Romero (`I1`), female, born about 1843,
  Vélez-Málaga, Málaga, Spain. No parents, no sources.
- **q_001:** who were her parents?
- `loc_001` (Vélez-Málaga) is present: the orchestrator ran locality-guide.

The point: the subject's surname triggers research-plan's Step 3 pre-work
fetch of `Spain_Naming_Customs` (issue #2251, lead ruling 2026-09-27), and the
plan should take from that page which surname is the father's and which the
mother's when it plans the full-text co-occurrence item for search-full-text.
The subject is synthetic; she is female so the military-page trigger cannot
fire, and her birth falls inside the parish registers so the death-record route
does not either. Place, volume, collection and link fixtures were captured live
2026-10-02.
