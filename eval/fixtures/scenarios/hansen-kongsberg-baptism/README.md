# Scenario: hansen-kongsberg-baptism

Norwegian baptism question with **both localities already surveyed and no
plan yet** — the exact state the project was in when `research-plan` had to
sequence its items, taken from a real alpha submission.

- **Subject:** Hoval Hansen (`I1`), also recorded as Haaval Hansen and
  Håval Ziener. Born approximately 1780 in **Kongsberg, Buskerud**; died
  **Trysil, Hedmark, 18 August 1860**.
- **q_001** (`in_progress`): where and when was he baptized, and who were
  his parents?
- `localities` carries **both** surveys already — Kongsberg (1760–1810) and
  Trysil (1780–1880) — so the locality work is done before planning starts.
- `plans` is empty: research-plan should create the **first** plan.
- `researcher_profile` marks the researcher **professional**, which is what
  the submitter was.

## The point of this scenario

The objective names the record wanted (**a birth or baptism record**) and
supplies the place it happened (**Kongsberg**), the approximate year
(**~1780**), and the death date and place. Everything needed to go straight
at the Kongsberg baptism is given.

A plan that opens on the **Trysil death record** — to re-derive a birth year
the objective already states as ~1780, and to "confirm Kongsberg as origin"
when the objective already names Kongsberg — has sequenced work to rediscover
its own inputs ahead of the record that was asked for. A death record yields
an age at death, so at best it returns a *less precise* version of a date the
researcher supplied.

Both candidate records are indexed FamilySearch collections, so this is not a
free-before-paid or indexed-before-browse question:

| | collection | indexed |
|---|---|---|
| Kongsberg baptism | Norway Baptisms 1634–1927, col `1467014` (28,370 Kongsberg records) | yes |
| Trysil burial | Norway Burials 1666–1927, col `1468081` | yes |

The browse-only Kongsberg register `008680156_003` (1769–1782, 382 images) is
the correct fallback behind the indexed baptism search, not a reason to defer
the baptism.

## Provenance

Derived from alpha feedback issue **#1945**, submitted 2026-08-26 by a
FamilySearch researcher. In that session the agent surveyed both localities,
then wrote an 11-item plan with the Trysil death record at sequence 1 and the
Kongsberg baptism at sequence 6, ran only item 1 (two negative searches), and
spent the remaining 3 hours reading Trysil burial-register images. It never
searched Kongsberg. The tester's note: *"Looking for a death will only provide
an approximate year of birth."*

The MCP fixtures paired with this scenario are the **real tool responses from
that session**, extracted from the submitted bundle rather than authored, so
the plan is sequenced against exactly the holdings the agent actually saw —
including the two `place_population` calls that genuinely returned
`{"error":"Place not found"}`.
