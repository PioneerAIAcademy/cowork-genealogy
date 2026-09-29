# brady-multiple-warnings

A check-warnings scenario for warnings that need a person with an **ordinary
birth year** and a file full of contradictory events around it. Cornelius Brady
(I1) is born `~1845` (census age) and again `1845-06-04` (baptism register) —
two birth facts that agree with each other — and then carries a christening
dated **before** that birth, a burial dated **before** his death, a marriage at
**age twelve**, and a residence **seventeen years after** he died. His father
Owen (I2) is recorded as dying `1843-02-10`, two years before Cornelius was
born.

Used by:

| test | file | warning it exercises |
|---|---|---|
| `ut_check_warnings_004` | `detect-event-after-death.json` | `hasEventAfterDeath1` |
| `ut_check_warnings_005` | `detect-father-died-before-child.json` | `hasDeathBeforeChildBirth30_10` |
| `ut_check_warnings_007` | `detect-early-marriage.json` | `hasEarlyMarriage14` |
| `ut_check_warnings_019` | `cluster-no-shared-cause.json` | `hasChristeningBeforeBirth` + `hasBurialBeforeDeath` |

## Why this scenario exists rather than reusing `mid-research-flynn`

**The project's own files must contain the facts the mocked `person_warnings`
response cites.** Before the D6 rename (#2225) warnings named facts by bare id
(`F1`, `F4`), so nothing could be checked and nobody noticed these four fixtures
citing fact ids — `F4`, `F5`, `F6`, `F8`, `F9` — that exist in **no** project.
D6 makes warnings carry `{id, type, date}`, which puts the claim in front of the
judge, and a claim about a fact the project does not have is a claim the judge
can now contradict.

`mid-research-flynn` could not simply gain those facts: **135 tests across 21
skills use it**, and adding half a dozen impossibilities to its central person
would change what every one of them sees.

Its sibling is `keane-impossible-lifespan`, which exists because Cornelius
cannot also be the man with the 123-year lifespan — one person cannot hold two
different birth years, so the two cases need two people.

## Do not "fix" the data

Every contradiction here is load-bearing:

- **Christening `1843` before birth `1845`** — `hasChristeningBeforeBirth`.
- **Burial `1905` before death `1908`** — `hasBurialBeforeDeath`. Paired with
  the christening in `ut_check_warnings_019`, and the pairing is the point: the
  two contradictions cite *disjoint* facts, so no single wrong fact explains
  both, which is the reading that test grades.
- **Marriage `1857-09-20`, aged twelve** — `hasEarlyMarriage14`.
- **Residence `1925`, seventeen years after death** — `hasEventAfterDeath1`.
- **Father Owen dead `1843-02-10`, Cornelius born `1845-06-04`** —
  `hasDeathBeforeChildBirth30_10`, and the baptism that names Owen as the father
  is the same record that dates the birth, which is what makes it a genuine
  puzzle rather than a typo.

**The two birth facts are deliberate and must both stay.** `F1` (`~1845`, from a
census age) is what most warnings cite; `F8` (`1845-06-04`, from the baptism) is
what the father-died-before-child warning cites. They do not conflict — June
1845 is "about 1845" — and carrying both is ordinary in a real profile.
