# Team roster

The people expected to post a daily standup update, with the name variants they
actually post under and their GitHub handle.

**Maintain this by hand.** When someone joins or leaves, edit this file — the
roll call is only as good as this list. A stale roster silently reports the wrong
people as missing, which is worse than not checking at all.

## Roster

**Role is load-bearing, not decoration.** `fill-ready` routes work by it — a
`developer`-labeled issue must not be assigned to a genealogist, and vice versa.

**Senior is a separate axis from role, and from standup attendance.** The
`Senior` column marks GitHub team membership. `.github/CODEOWNERS` names both
teams on every rule, so either can approve any senior-owned path; the team it
names first is who the review is queued to — `senior-genealogists` for skills,
agents and eval fixtures/tests/runlogs, `senior-developers` for the code and
infrastructure paths.

**The `Senior` column is review authority.** A senior developer still takes work
from the junior pool and works with Claude Code, so being on the list is not a
promotion out of that pool.

**It is also who a `senior`-labeled issue goes to.** The lead takes no issues at
all, so senior-required work goes to a senior in its own lane — a
`developer`+`senior` issue to a `senior-developers` member, a
`genealogist`+`senior` issue to a `senior-genealogists` member. `fill-ready`
labels those and promotes the reviewed ones into its lane's Ready pool alongside
the junior work. It sets no assignee on anything: seniors self-serve the way
everyone else does, and the lead can still hand one out at standup.

Everyone in this table is expected to post a standup update, seniors included —
the two who are not are listed under "Does not post standup" below.

| Key | Posts as | GitHub | Role | Senior |
|---|---|---|---|---|
| christopher | Christopher Edeson | `chrisedeson` | developer | |
| mercy | Mercy Okum | `mercyokum` | genealogist | **senior** |
| israel | Israel, Israel Ayomikun Asimi | `Asimi1234` | developer | |
| florence | Florence Taburu | `florencemashipei` | genealogist | **senior** |
| tife | Tife | `T-FEH` | developer | **senior** |
| isaac | Isaac Boateng | `Paaboat` | genealogist | |
| jude | Ebigide Jude | `jud-sdev` | developer | **senior** |
| collins | Cia, Collins | `Cia-3` | genealogist | |
| ernest | Ernest Jacob, Ernest | `aghadiayeamayanvboernest` | developer | |
| solomon | Solomon Baidoo | `kofiatinka12` | genealogist | |
| francis | Francis Happy | `francis-2008-happy` | developer | |
| benter | Benter, Benter Oyiembo | `benter-070` | genealogist | |
| adeyinka | Adeyinka | `yinkid28` | developer | |
| ruth | Ruth Williams | `Emruthwill` | genealogist | |
| adedotun | Adedotun Taiwo | `taiwo-stack` | developer | |
| john | John Mark Peter-Brown | `johnmarkpeterbrown` | genealogist | **senior** |
| promise | Promise_emmanuel, Promise Nwabueze Igbojionu | `promise-emmanuel` | developer | **senior** |
| ikennaya | Ikennaya Mbadiwe | `Ikennaya1` | genealogist | |
| precious | Precious Onotu | `clack391` | developer | **senior** |
| edmund | Edmund Asante Oware | `EdmondOware` | genealogist | **senior** |
| pascal | Pascal Okezie | `Gennecis` | developer | **senior** |
| marc | Marc Mangum | `MMagnum` | developer | |
| richard | Richard | `chesworthrm` | developer | **senior** |

Two handles are not guessable from the name: **Pascal Okezie is `Gennecis`**,
and **Precious Onotu is `clack391`**. Attributing their PRs by guessing at the
handle will get the wrong person.

## Does not post standup

**Shaunese (`Leduthet`)** and **Clorinda (`ClorindaM`)** do **not** attend
standup or submit updates. That is the *only*
way they differ from the senior genealogists in the table above — same team,
same review authority, same weight on an approval.

Never report them as missing, and never treat them as unmapped contributors when
their name appears on a review or a merge. `Leduthet` reviews and merges often
enough that a run which does not know this will keep re-discovering her as a
roster gap.

## What a senior genealogist's approval means

**It is a genealogical-quality signal, not just a process step.** When a fixture
or adjudication PR carries an approval from any of the six — Clorinda,
Shaunese, Florence, John, Edmund, or Mercy — that is a stronger claim than an
ordinary teammate's. It cuts both ways: when one of them approves something
that turns out wrong, that is a finding about the doctrine, not just about the
author.

## Known identity quirks

- **Ernest** commits as `ernestjacob789@gmail.com` while his GitHub account is
  `aghadiayeamayanvboernest`. Any roll call derived from git activity rather than
  from this roster will count him twice, as two different people.
- **Promise has two GitHub accounts.** `promise-emmanuel` — the one in the table
  above — is on `senior-developers` and is what opens the PRs. The commits inside
  them are authored by **`promise-emmanuel-20`**, which is on no team, under two
  emails (`Promiseemmanuel2019@gmail.com`, `promiseemmanuel@byui.edu`). 177
  commits on `main` carry the second account. Attribution by commit author will
  therefore split one person in two, and miss that they are senior.
  **A senior approval submitted from `promise-emmanuel-20` would not satisfy
  CODEOWNERS, and nothing would say why** — GitHub would simply keep asking for a
  senior review that has already been given. They have never reviewed from that
  account, so this has not bitten yet; check the account on the review, not the
  name, if a senior-looking approval fails to clear a PR.
- **Richard** (`chesworthrm`) works 1–2 hours a day and covers for the lead when
  he is away. He attends standup and usually posts, so report him missing on days
  he does not — but read a short update as expected, not as a red flag.
- **Christopher** (`chrisedeson`) is not an org member and contributes by fork.
  That is deliberate, not lapsed access — do not report it as an anomaly.
- **Assigning below `triage` fails silently.** A collaborator at `read` is under
  GitHub's assignability bar, and `gh issue create --assignee`, `gh issue edit
  --add-assignee` and the raw `addAssigneesToAssignable` mutation all return
  **success while assigning nobody** — the mutation echoes an empty
  `assignees.nodes` in the same response. Nothing errors, so re-read the issue
  after assigning. To check a handle, use
  `GET /repos/:owner/:repo/assignees/:login` (204 assignable, 404 not). Do
  **not** use `collaborators/:login/permission` — its `permission` field has no
  value for triage and reports `read` even afterwards, so it reads as still
  broken; its `role_name` is the accurate one. A `triage` bump fixes it, and
  grants issue management without push.

## Daily summary

Written to `~/pioneeracademy/cowork-status-updates/YYYY-MM-DD.md`
every run — format and field rules in `daily-summary-format.md`. Include the
`missing:` field; the roll call is the one output unique to this team.
