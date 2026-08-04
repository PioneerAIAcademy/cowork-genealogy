# Team roster

The people expected to post a daily standup update, with the name variants they
actually post under and their GitHub handle.

**Maintain this by hand.** When someone joins or leaves, edit this file — the
roll call is only as good as this list. A stale roster silently reports the wrong
people as missing, which is worse than not checking at all.

## Roster

**Role is load-bearing, not decoration.** `fill-ready` routes work by it — a
`developer`-labeled issue must not be assigned to a genealogist, and vice versa.
Roles below were given by the lead on 2026-07-31 (11 developers, 10
genealogists); before that this table had no role column, and an eval-harness
Python issue was assigned to a genealogist because nothing here said otherwise.
All developers are **junior**, working with Claude Code; the lead is the only
senior developer.

| Key | Posts as | GitHub | Role | Confidence |
|---|---|---|---|---|
| christopher | Christopher Edeson | `chrisedeson` | developer | confirmed |
| mercy | Mercy Okum | `mercyokum` | genealogist | confirmed |
| israel | Israel, Israel Ayomikun Asimi | `Asimi1234` | developer | confirmed |
| florence | Florence Taburu | `florencemashipei` | genealogist | confirmed — authored PR #928 |
| tife | Tife | `T-FEH` | developer | confirmed |
| isaac | Isaac Boateng | `Paaboat` | genealogist | confirmed |
| jude | Ebigide Jude | `jud-sdev` | developer | confirmed |
| collins | Cia, Collins | `Cia-3` | genealogist | confirmed |
| ernest | Ernest Jacob, Ernest | `aghadiayeamayanvboernest` | developer | confirmed |
| solomon | Solomon Baidoo | `kofiatinka12` | genealogist | confirmed |
| francis | Francis Happy | `francis-2008-happy` | developer | confirmed |
| benter | Benter, Benter Oyiembo | `benter-070` | genealogist | confirmed |
| adeyinka | Adeyinka | `yinkid28` | developer | confirmed |
| ruth | Ruth Williams | `Emruthwill` | genealogist | confirmed |
| adedotun | Adedotun Taiwo | `taiwo-stack` | developer | confirmed |
| john | John Mark Peter-Brown | `johnmarkpeterbrown` | genealogist | confirmed |
| promise | Promise_emmanuel, Promise Nwabueze Igbojionu | `promise-emmanuel` | developer | confirmed |
| ikennaya | Ikennaya Mbadiwe | `Ikennaya1` | genealogist | confirmed |
| precious | Precious Onotu | `clack391` | developer | confirmed |
| edmund | Edmund Asante Oware | `EdmondOware` | genealogist | confirmed |
| pascal | Pascal Okezie | `Gennecis` | developer | confirmed |

## How the mappings were derived

Most were confirmed by matching a person's standup narrative to a PR or issue
only they could have written — e.g. Adedotun's account of the record-extractor
work matched the branch authored by `taiwo-stack`; Precious's account of
compressing the `#822` descriptions matched the PR authored by `clack391`.

Every mapping above was confirmed by the lead on 2026-07-30. Two are worth
remembering because they are not guessable from the name: **Pascal Okezie is
`Gennecis`**, and **Precious Onotu is `clack391`**. Attributing their PRs by
guessing at the handle will get the wrong person.

## Not standup participants — senior genealogists

**Shaunese (`Leduthet`)** and **Clorinda (`ClorindaM`)** are senior genealogists.
They review PRs; they do **not** attend standup or submit updates. Confirmed by
the lead 2026-07-30.

Never report them as missing, and never treat them as unmapped contributors when
their name appears on a review or a merge. `Leduthet` in particular is very
visible — 11 reviews across the last 40 PRs and the merger on most of them — so a
run that does not know this will keep re-discovering her as a roster gap.

The useful consequence: **their approval is a genealogical-quality signal, not
just a process step.** When a fixture or adjudication PR carries a senior
genealogist's approval, that is a stronger claim than an ordinary teammate's. It
also cuts the other way, and today produced the sharper version of a finding:
`isabel-carvajal-daughter` (PR #964) merged a TRUE-MATCH adjudication citing
**zero** arks, approved and merged by `Leduthet`. "Three approvals missed it" is
worth noting; "it passed senior-genealogist review" is the fact that should shape
what issue #970 becomes.

## Known identity quirks

- **Ernest** commits as `ernestjacob789@gmail.com` while his GitHub account is
  `aghadiayeamayanvboernest`. Any roll call derived from git activity rather than
  from this roster will count him twice, as two different people.

## Daily summary

Written to `/Users/dallan/pioneeradademy/cowork-status-updates/YYYY-MM-DD.md`
every run — format and field rules in `daily-summary-format.md`. Include the
`missing:` field; the roll call is the one output unique to this team.
