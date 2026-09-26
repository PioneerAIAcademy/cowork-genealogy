# keane-impossible-lifespan

A check-warnings scenario for warnings that need a person whose **recorded**
lifespan is genuinely impossible. Ambrose Keane (I1) carries a birth of
`~1785`, a death of `1908-03-12`, a **second** death of `1909-11-02`, and a
Residence dated `1925`. His father Michael (I2) is born `~1818` — younger than
his own son, which is part of the same mess.

Used by:

| test | file | warning it exercises |
|---|---|---|
| `ut_check_warnings_006` | `detect-impossible-lifespan.json` | `hasAgeRangeGreaterThan120` |
| `ut_check_warnings_009` | `detect-cluster.json` | `hasEventAfterDeath1`, `hasAgeRangeGreaterThan120`, `tooManyDeathDates2`, `relativesHasAgeRangeGreaterThan120` |

## Why this scenario exists rather than reusing `mid-research-flynn`

**The project's own files must agree with what the mocked `person_warnings`
response says.** Before the D6 rename (#2225), warnings cited facts by bare id
(`F1`), so nothing in the response could contradict the project and nobody
noticed that these two tests ran against a Patrick Flynn the project records as
born `~1845`. D6 makes warnings carry `{id, type, date}`, the judge can now read
`~1785` straight out of the response, and it correctly marked the skill down for
reporting a date that every source in the project contradicts — a false negative
turning into a false positive purely because the fixture and the project
disagreed.

`mid-research-flynn` could not simply be corrected: **135 tests across 21 skills
use it**, and no person in it has a span anywhere near 120 years. Hence a
separate, minimal project whose files state the impossibility outright.

The alternative considered and rejected was a `judge_context` line telling the
judge this response is mocked and not to cross-check it. That trains the judge
out of noticing a tool contradicting the project — a real defect class, and one
that cannot occur in production, where `person_warnings` reads the very file it
reports on.

## Do not "fix" the data

Every oddity here is load-bearing:

- **Birth `~1785` with death `1908`** — the >120 span under test.
- **Two deaths (`1908-03-12`, `1909-11-02`)** — `tooManyDeathDates2`.
- **Residence `1925`, after both deaths** — `hasEventAfterDeath1`.
- **Father born `~1818`, after his son** — carries
  `relativesHasAgeRangeGreaterThan120` onto I2.

Sources are deliberately weak (a census age, a Findagrave memorial) so the
cluster reads as a plausible two-people-merged profile rather than a typo.
