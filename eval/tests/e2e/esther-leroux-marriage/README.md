# Esther Leroux

**Source PID:** `MD1C-48H`
**Esther Leroux is deceased.** (FamilySearch ToS requires all committed
e2e fixtures to be about deceased persons.)

## Research question

> What is the marriage date and place of Esther Leroux (MD1C-48H)?

## What was removed from the starting tree

- Removed fact 598ba6e1-a3d4-4c4e-aaf2-9afe52472b80 on R1: Marriage 5 November 1894 Lewiston, Androscoggin, Maine, United States

The Couple relationship between Esther Leroux and her husband, Jean Jacques
(G6GQ-P4F), is kept — only the Marriage fact's date and place were stripped.
The question asks specifically for the marriage's date/place, not for the
spouse's identity, so the spouse relationship is retained as the anchor.

## Expected difficulty

Easy — the date and place rest on a single, already-cited Maine marriage
record (`Maine, Marriages, 1771-1907`), a well-indexed FamilySearch
collection. The one wrinkle is that the record indexes the husband's name as
"Jean Laque" rather than "Jean Jacques" (the name kept in the tree) — a
name-spelling variant, not a different person, but worth noting if a run
fails to connect the two.

## Notes for reviewers

Single-source recovery: one Maine marriage-record entry directly cited in
the tree. The husband's name is indexed as "Jean Laque" in that record vs.
"Jean Jacques" in the tree — a name-spelling variant, not a different
person. During authoring, the raw FamilySearch snapshot needed two small
hand-fixes before it would validate: two duplicate fact ids shared across
different persons (a known snapshot artifact — `ddb21ddf-...` and
`ebe0d4fe-...`, both empty/no-date facts reused across two people), and one
custom fact type on Joseph Leroux (LT17-CGW) that started with a non-ASCII
accented letter ("Évènements...") and failed the schema's `^[A-Z]` check —
normalized to plain ASCII ("Evenements...") without changing its meaning.
