# Find William Henry Bottemiller's parents from the 1880 census and Oregon vital records

**Source PID:** `249W-9LP`
**William Henry Bottemiller is deceased.** (b. 29 Dec 1862, Franconia
Township, Chisago County, Minnesota; d. 13 May 1929, Oregon City,
Clackamas County, Oregon.) FamilySearch ToS requires all committed e2e
fixtures to be about deceased persons.

## Research question

> Who were the parents of William Henry Bottemiller, born 29 December
> 1862 in Franconia Township, Chisago County, Minnesota, and died
> 13 May 1929 in Oregon City, Clackamas County, Oregon?

## Expected answer

- **Father:** Kasper (Casper) Heinrich Bottemiller — b. 23 Oct 1826,
  Brockhagen, Westphalia, Prussia (Germany); d. 20 Apr 1899, Portland,
  Multnomah County, Oregon.
- **Mother:** Anne Marie Moehlmann — b. 7 Aug 1839, Minden, Westphalia
  (Germany); d. 31 Jan 1921, Clackamas County, Oregon.

## What was removed from the starting tree

- Removed both parent persons — Kasper Heinrich Bottemiller (MD6P-76W)
  and Anne Marie Moehlmann (LK6V-G8D) — and every relationship that
  referenced them (the two parent-child links to William, their couple
  bond, William's siblings, and the parents' own parents). The starting
  tree retains only William, his wife Lillie Jane Kleinsmith, and their
  six children.
- Removed three sources whose citations **named a parent**, which would
  otherwise leak the answer off the local tree:
  - the 1880 U.S. Census ("Entry for Henry Bottermiller and Mary
    Bottermiller") — the household showing William as a child;
  - the mother's 1921 GenealogyBank obituary ("Anna Marie Bottemiller");
  - the Oregon State Archives death record ("Casper H Battemilles").

The other 22 sources remain, including the Oregon Death Index and
Oregon Deaths and Burials entries — these show only William's own name,
so they are legitimate *leads* the agent must follow to the underlying
record rather than answer leaks.

## How the answer is recoverable (records only; tree-reads blocked)

- **1880 U.S. Census, Todd County, Minnesota** — William (age ~17, as
  "Willie") enumerated in the household of Henry (Kasper) and Mary
  (Anne Marie) Bottermiller. Establishes both parents directly.
- **William's 1929 Oregon death record** — names father "Casper H."
  Corroborates the father independently.

Both records live on FamilySearch and are findable by record search;
neither requires reading the (blocked) family tree.

## Expected difficulty

moderate — Two independent record paths exist, but the surname is
transcribed many different ways across records (Bottermiller,
Boettenellr, Buttimiller, Battemiller, Rottemiller), so the agent must
search tolerantly and correlate the 1880 Minnesota household with the
later Oregon records. German-immigrant parents add place-name and
given-name variation (Kasper/Casper/Henry; Anne Marie/Anna Marie/Mary).

## Notes for reviewers

The surname-token overlap the stripping linter will flag on
"Bottemiller" is expected and benign — the retained subject, spouse,
and children all share the surname. The distinctive parent tokens
(Kasper, Heinrich, Casper, Moehlmann, Anne/Anna Marie) are genuinely
absent from the starting tree after stripping.

### Expected run shape (first passing run, 2026-07-02)

- **`proof_quality` of 2/3 is expected, not a defect.** Both parent
  names are recoverable from a single derivative source — the Oregon
  death-certificate abstract (`src_001`). The original certificate image
  is not accessible via `record_read`, and full corroboration (1870/1880
  censuses, Minnesota birth/marriage records) is more than fits the
  default 60-minute cap. A sound run correctly tiers the parentage as
  *probable* for the record-content claim and *possible* for the
  identification — single-source, conservatively stated. A `score: 3`
  would require raising `wall_clock_seconds` so the agent can execute the
  corroborating searches it already plans.
- **`stop_reason: timeout` is expected.** The agent completes the first
  question (father/mother, with a proof summary) well inside the cap,
  then autonomously opens a second question to corroborate and runs out
  of wall-clock time mid-search. It stops because it did *extra* work,
  not because it looped.
- **The Henry-vs-Casper "conflict" is a name-form artifact, not a real
  discrepancy.** The father is *Kasper **Heinrich** Bottemiller*, and
  **Heinrich = Henry** — so the 1880 census head "Henry Bottermiller" is
  the same man under his middle name. An agent that flags this as a
  conflict (e.g. `c_001`) rather than silently equating the two is being
  appropriately cautious; don't read that conflict as a research error.
