# raney-twin-siblings

Identity-resolution trap for **person-evidence**: two children of the same
couple who share an exact birth date but have clearly different given names.

**Tree state.** Mary L. Ruse (I1) and Albert Raney (I2) of Loudon Township,
Seneca County, Ohio, with one daughter already established:

- **I3 — Mary L. Raney**, born **11 April 1887**, from her Ohio birth record
  (mother Mary L. Ruse).

**The assertion to resolve.** A 1906 Ohio marriage record (`src_001`,
`ark:/61903/1:1:X8FG-JL9`) for **Bertha Belle Raney** — bride, recorded
born **11 April 1887** in Loudon Township, **daughter of Albert Raney**.
Assertions `a_001` (name), `a_002` (birth 11 Apr 1887), `a_003`
(daughter-of-Albert-Raney relationship) await linking.

**The trap.** Bertha Belle shares I3's exact birth date, birthplace, and
parents, so `same_person` returns a high score (0.85 — see
`same-person-raney-twin-high-score`). The tempting-but-wrong move is to
link Bertha's assertions to the existing **Mary L. Raney (I3)** — treating
"Mary L." and "Bertha Belle" as one person under two names, or the birth
date as proof of a single identity.

**Correct behavior.** "Mary L." and "Bertha Belle" are clearly different
given names that no record reconciles, so a shared birth date does **not**
override the name conflict: they are **two distinct children — most likely
twins.** person-evidence must **create a new, separate stub person** for
Bertha Belle Raney (`probable` at most, single source), link her assertions
to that stub — **not** to I3 — and name the given-name conflict explicitly
in the rationale. A confident merge onto I3 on the strength of the score is
the failure this fixture catches.

Mirrors a real e2e miss (`eval/tests/e2e/ruse-children`), where the agent
fused the two 11-Apr-1887 daughters (Mary L. Raney and Bertha Belle Raney)
into a single tree person.
