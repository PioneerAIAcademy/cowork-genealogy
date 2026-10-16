# Team Agreement signers

Anyone with organization membership, repository write access, or access
to project credentials or alpha-tester data signs the
[Team Agreement](./TEAM-AGREEMENT.md).

Outside contributors do not sign it. They sign the CLA only —
[CLA-SIGNERS.md](./CLA-SIGNERS.md).

## How to sign

**You sign two agreements.** Add a row here, and a row in
[CLA-SIGNERS.md](./CLA-SIGNERS.md). One pull request, **from your own
GitHub account**, covers both. Nobody can sign for you.

**Sign during onboarding, before your access is granted** — not before
your first commit. This agreement gates the keys, so it comes earlier
than the CLA does for an outside contributor.

Title the pull request `Sign CLA and Team Agreement: <your name>`, and in
the description include:

> I have read and agree to the Contributor License Agreement and to the
> Team Agreement, at the versions recorded in my rows.

Read both agreements first, in full. Use your full legal name, not a
nickname or handle, and put your row at the bottom.

Record the **Version** from the header of `TEAM-AGREEMENT.md` as it
stands the day you sign, so a later revision cannot change what you
signed. Email addresses are deliberately not collected — see
[CLA-SIGNERS.md](./CLA-SIGNERS.md) for why.

**Row format:**

| Full legal name | GitHub | Date signed | Version |
|---|---|---|---|
| Ada Lovelace | `@adalovelace` | 2026-09-02 | 1.0 |

The example is illustrative. Do not copy it into the table.

---

## Signers

Everyone listed here must also appear in
[CLA-SIGNERS.md](./CLA-SIGNERS.md).

| Full legal name | GitHub | Date signed | Version |
|---|---|---|---|

---

## For maintainers

**Do not grant access until the person has a row here.** Organization
membership, repository write access, and project credentials all wait on
it. When that ordering slips, get the signature and rotate anything
already issued.

**Check both files.** A team member with no CLA row is a gap: this
agreement covers what someone is trusted with, not the rights in what
they write.

**When the Team Agreement changes.** Publish the new version with a new
version number in `TEAM-AGREEMENT.md`'s header, then ask current signers
to add a fresh row. Never edit or remove an existing row.

**When someone leaves.** Their row stays. The confidentiality obligations
survive their departure and the record has to survive with them. Revoke
access and rotate credentials instead.
