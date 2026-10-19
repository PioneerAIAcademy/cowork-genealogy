# search-records-collection-link

Mary Ellen Hollis (b. 1834, Licking County, Ohio) — a marriage search whose hit the
user wants to browse by collection.

- **Objective:** identify Mary Ellen Hollis's husband.
- **Questions:** 1 — q_001 (`in_progress`).
- **Plans:** 1 — pl_001 (`active`), one `planned` item: pli_001, marriage, Licking
  County, Ohio, 1850-1860.
- **Log:** 0 entries.
- **GedcomX persons:** I1 (Mary Ellen Hollis, b. 1834 Licking County, Ohio).

## What the skill must do

The marriage search returns one record, in collection 1803785, "Ohio, County
Marriages, 1789-2013". The user asks which collection holds it so they can browse it.
The reply names the collection by its title and gives its link,
`https://www.familysearch.org/search/collection/1803785` — never the bare id.

Hand-authored; no real person. The collection id and title match the corpus's
`collections-search-ohio` fixture, which the test also stocks.
