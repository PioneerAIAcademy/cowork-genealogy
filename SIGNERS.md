# Signers

This file records who has signed the project's contributor agreements.

- **[CLA.md](./CLA.md)** — the Individual Contributor License Agreement.
  Everyone who contributes signs this, including outside contributors and
  maintainers.
- **[TEAM-AGREEMENT.md](./TEAM-AGREEMENT.md)** — confidentiality,
  credentials, and personal data. Signed by anyone with organization
  membership, repository write access, or access to project credentials
  or alpha-tester data.

If you are on the team, you sign both. If you are an outside contributor
opening a pull request, you sign the CLA only.

---

## How to sign

1. Read the agreement you are signing, in full.
2. Open a pull request **from your own GitHub account** that adds one row
   to the appropriate table below. Do not add a row for anyone else, and
   do not ask anyone to add one for you — the pull request is the record
   of your agreement, so it has to come from you.
3. Title the pull request `Sign CLA: <your name>`, or
   `Sign CLA and Team Agreement: <your name>`.
4. In the pull request description, write:

   > I have read and agree to the Individual Contributor License
   > Agreement at the version recorded in my row.

   Name both agreements if you are signing both.

Your row goes at the bottom of the table. Use your full legal name, not a
nickname or handle.

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

**Before granting access.** A person should appear in the Team Agreement
table before they receive organization membership, repository write
access, or any project credential. When that ordering slips, get the
signature and rotate anything already issued.

**When an agreement changes.** Publish the new version with a new version
number in its header, then ask current signers to add a fresh row.
Existing rows are never edited or removed — they are the record of what
each person agreed to and when. A person's most recent row is the version
that binds them.

**When someone leaves.** Their rows stay. The Team Agreement's
confidentiality obligations survive their departure, and the record has
to survive with them. Revoke access and rotate credentials instead.
