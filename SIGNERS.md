# Signers

This file records who has signed the project's contributor agreements.

- **[CLA.md](./CLA.md)** — the Individual Contributor License Agreement.
  Everyone who contributes signs this, including outside contributors and
  maintainers.
- **[TEAM-AGREEMENT.md](./TEAM-AGREEMENT.md)** — confidentiality,
  credentials, and personal data. Signed by anyone with organization
  membership, repository write access, or access to project credentials
  or alpha-tester data.

There are two paths. Find yours below.

One rule covers both: the pull request adding your row must come **from
your own GitHub account**. Do not add a row for anyone else, and do not
ask anyone to add one for you. The pull request is the record of your
agreement, so it has to be your own act.

---

## How to sign

### Path 1 — outside contributors

You are contributing without organization membership, write access, or
project credentials. **You sign the CLA only.** One row, in the
"CLA signers" table.

**Add the row in the same pull request as your contribution.** You do not
need a separate signing pull request and you do not need to wait for
anything to be merged first — put your code and your row in one branch.
If you would rather sign before you start work, a standalone pull request
is fine too.

In the pull request description, include this line:

> I have read and agree to the Individual Contributor License Agreement
> at the version recorded in my row.

A maintainer will not merge a contribution until your row is present.

### Path 2 — team members

You have, or are about to receive, organization membership, repository
write access, or project credentials. **You sign both agreements** — two
rows, one in each table, in a single pull request.

**Sign before your access is granted, not before your first commit.**
This is the difference between the two paths: for an outside contributor
the CLA gates a merge, and for you the Team Agreement gates the keys. So
this is a standalone pull request, opened during onboarding, whether or
not you are contributing code that week.

Title it `Sign CLA and Team Agreement: <your name>`, and in the
description include:

> I have read and agree to the Individual Contributor License Agreement
> and to the Team Agreement, at the versions recorded in my rows.

### Both paths

Read what you are signing, in full, first. Your row goes at the bottom of
the table. Use your full legal name, not a nickname or handle.

**Row format:**

| Full legal name | GitHub | Date signed | Version |
|---|---|---|---|
| Ada Lovelace | `@adalovelace` | 2026-09-02 | 1.0 |

The example above is illustrative. Do not copy it into the tables.

### Why it is recorded this way

The **Version** column is what makes this record hold up. It says which
text you agreed to, so a later revision of an agreement does not change
what you signed. Always record the version in the agreement's header at
the time you sign.

Email addresses are deliberately **not** listed here. This is a public
repository, and a plaintext list of team members' email addresses is a
scrape target. The identity binding comes from the signing commit itself:
its author email, timestamp, and GitHub account are part of the permanent
record in this repository's history.

---

## CLA signers

Signed [CLA.md](./CLA.md).

| Full legal name | GitHub | Date signed | Version |
|---|---|---|---|

---

## Team Agreement signers

Signed [TEAM-AGREEMENT.md](./TEAM-AGREEMENT.md). Everyone listed here
must also appear in the CLA table above.

| Full legal name | GitHub | Date signed | Version |
|---|---|---|---|

---

## For maintainers

**Two enforcement points, one per path.**

*Before merging an outside contribution*, check that the author has a row
in the CLA signers table — in this pull request or an earlier one. This
is the only gate on that path, so nothing else will catch a missing
signature.

*Before granting access*, check that the person has a row in the Team
Agreement table. Organization membership, repository write access, and
project credentials all wait on it. When that ordering slips, get the
signature and rotate anything already issued.

A team member who somehow has no CLA row is a gap on both paths — the
Team Agreement covers what they are trusted with, not the rights in what
they write. Everyone in the second table belongs in the first.

**When an agreement changes.** Publish the new version with a new version
number in its header, then ask current signers to add a fresh row.
Existing rows are never edited or removed — they are the record of what
each person agreed to and when. A person's most recent row is the version
that binds them.

**When someone leaves.** Their rows stay. The Team Agreement's
confidentiality obligations survive their departure, and the record has
to survive with them. Revoke access and rotate credentials instead.
