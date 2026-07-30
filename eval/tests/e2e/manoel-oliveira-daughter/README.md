# Manoel Melquiades de Oliveira — additional daughter Josefa (m. 1926)

**Source PID:** `GHJ6-2WV`
**Manoel Melquiades de Oliveira is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) Born
not recorded in the tree; died not recorded in the tree.

## Research question

> Did Manoel Melquiades de Oliveira and his wife Cândida Damasceno de Oliveira of Rio Grande do Norte, Brazil have a daughter named Josefa, married 1926, in addition to their known children Abel and Maria Lila (b. 1901)?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-07-24, PID `GHJ6-2WV` with relatives). Nothing was
stripped (`"genre": "record-hint"` in `fixture.json`):
`starting-tree.gedcomx.json` is the snapshot as-is (written by
`strip --none`), and `unstripped-tree.gedcomx.json` is committed
identical to it so `snapshot --check` can audit upstream drift.
`validate` enforces the equality and skips the presence mirror
(spec §3.6).

## Expected difficulty

hard — see "Notes for reviewers" below for the reviewer's read on
match strength.

## Notes for reviewers

**Resolved: true match.** All five sources already attached to Manoel Melquiades de Oliveira on the tree are exclusively about his known daughter Maria Lila's line (her 1926 marriage, her descendants' baptisms, her 1995 death registration) — none touch Josefa Dias Da Conceição or Elfridio Justino Da Silva, so the hint is not a re-indexing of an existing source; it is genuinely new information.

The parents' given names on the hint record (Manuel Melchiades / Candida de Oliveira) match the tree person and his wife (Manoel Melquiades / Cândida Damasceno de Oliveira) closely, and the marriage is in the same state and era (Rio Grande do Norte, 1926) as the tree's known daughter Maria Lila (b. 1901, d. 1995, Natal). On its own this parent-name match would be suggestive but not conclusive.

What tips this to a confident true match is independent corroboration found during resolution: a **separate** marriage record (Brasil, Rio Grande do Norte, Registros da Igreja Católica, 1755-2019, ark:/61903/1:1:6XWC-DT58, 22 Feb 1925, Natal) names the same parent pair — Manuel Melchiades de Oliveira and Candida de Oliveira — as parents of the **groom**, a previously undocumented son, Manuel Domingos de Oliveira, married to Josefa Leopoldina Cavalcanti (an unrelated woman of that same first name — not to be confused with this fixture's Josefa Dias Da Conceição). That is a second, independent document naming this exact parent pair as parents of a child marrying in the same city about a year earlier — consistent with a family whose children were marrying in Natal, RGN across 1925–1926, not a coincidental unrelated namesake couple.

The one point that still weighs **against** a "proved" tier: the proposed daughter's surname, "Dias Da Conceição," bears no resemblance to the father's surname "de Oliveira," unlike her siblings (Abel de Oliveira, Manuel Domingos de Oliveira). A broader search for an independent baptism record for Josefa under a "de Oliveira" surname in Rio Grande do Norte turned up nothing — only unrelated families in other Brazilian states. The surname mismatch is a known, unremarkable pattern in Brazilian Catholic record-keeping (a child born outside formal marriage, or raised under a different household surname, was still routinely named accurately as the father's child in her own marriage record decades later) and does not override the marriage record's direct naming of her parents. Verdict: **true match, probable tier** — one direct record, corroborated by independent sibling-identity evidence, short of a second record on Josefa herself.
