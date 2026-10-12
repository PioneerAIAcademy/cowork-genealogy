# Umbelina Maria Azevedo — death in November 1910, Rio de Janeiro, Brazil

**Source PID:** `GXSQ-V3L`
**Umbelina Maria Azevedo is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) The tree gives her no dates; it carries an undated Death fact. Wife of Francisco Antônio Pariz; mother of Alice Umbelina (born about 1902), Antônio Francisco (1909, Espírito Santo), Maria Glória (1912, Espírito Santo), Florita Umbelina (1915, Espírito Santo) and Maura Umbelina (1918), who died in Rio de Janeiro state between 1971 and 1990.

## Research question

> When and where did Umbelina Maria Azevedo die? She was the wife of Francisco Antônio Pariz and the mother of Alice Umbelina, Antônio Francisco, Maria Glória, Florita Umbelina and Maura Umbelina, born between about 1902 and 1918, several of them in Espírito Santo.

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-10-12, PID `GXSQ-V3L` with relatives). Nothing was
stripped (`"genre": "record-hint"` in `fixture.json`):
`starting-tree.gedcomx.json` is the snapshot as-is (written by
`strip --none`), and `unstripped-tree.gedcomx.json` is committed
identical to it so `snapshot --check` can audit upstream drift.
`validate` enforces the equality and skips the presence mirror
(the record-hint genre in `docs/specs/e2e-test-spec.md`).

## Expected difficulty

medium — see "Notes for reviewers" below for the reviewer's read on
match strength.

## Notes for reviewers

**Resolved: false match, no substitute found.** The hint — "Brasil, Rio de Janeiro, Registro Civil, 1804-2013", death entry for Umbelina Azevedo Da Silva, 14 November 1910, city of Rio de Janeiro (`ark:/61903/1:1:7975-85ZM`) — is a different woman. `expected-findings.json` is now a `"polarity": "avoid"` guard against that death (f1) plus a required finding that the report documents the rejection and the unanswered question (f2).

The indexes alone decide it. The hint's index gives only the name, a birth year of 1879 computed from an age, and the date; it names no spouse or parents. Against it, the indexed death entries of three of Umbelina Maria Azevedo's children each name her as their mother and give birth years after November 1910:

- Maria Glória Ferreira, d. 17 May 1982, Rio de Janeiro, born 1912; parents Francisco Antonio Paris and Umbelina Maria de Azevedo (`ark:/61903/1:1:794X-QD3Z`).
- Florita Umbelina dos Santos, d. 2 July 1980, Rio de Janeiro, born 1915; parents Antonio Francisco Pariz and Umbelina Maria Pariz de Azevedo (`ark:/61903/1:1:79FM-TFZM`).
- Maura Umbelina Ferreira, death registered 19 December 1978, Duque de Caxias, born 1918; parents Francisco Antonio Parez and Umbelina Maria de Azevedo (`ark:/61903/1:1:77F3-D8T2`).

Those birth years come from ages at death and can be off by a year or two, but three independent entries off by two to eight years each, all in the same direction, is not credible. None of the children's entries names her "da Silva". The hint is attached to no tree person (`source_attachments` returns it unattached), and its `1:1:` id is not among the tree's cited sources, so it is not a re-index of anything the person already has.

**The register image did not decide it, and nothing from it is relied on.** An AI transcription (`dev/try-image-transcribe.ts`) of the page (`ark:/61903/3:1:S3HY-67B9-75X`) was attempted. The calibration check could not be run: record searches of collection 1582573 found no index entry for either of the page's two other acts (a Paulina Souza and an infant Vito, both 1910), so the page has fewer than two other indexed entries we could find and the reading is **unlicensed**. `image_basis` is off.

**Searched and empty for a real substitute:** "Brasil, Rio de Janeiro, Registro Civil, 1804-2013" (collection 1582573) for Umbelina Azevedo / Pariz / Pariz de Azevedo, 1911-1990, and by spouse Francisco Pariz — only the children's entries came back; "Brazil, Espirito Santo, Registro Civil, 1850-2020" (collection 4473668) for Umbelina Azevedo, Umbelina Pariz and every Pariz entry — nothing for her. When and where she died remains unanswered.

Retrieval was tool-assisted (`packages/engine/mcp-server/dev/try-record-read.ts`, `try-record-search.ts`, `try-source-attachments.ts`, `try-image-transcribe.ts` against live FamilySearch); the identity judgement was the genealogist's.
