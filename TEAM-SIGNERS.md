# Team Agreement signers

Anyone with organization membership, repository write access, or access
to project credentials or alpha-tester data signs the
[Team Agreement](./TEAM-AGREEMENT.md).

Outside contributors do not sign it. They sign the CLA only —
[CLA-SIGNERS.md](./CLA-SIGNERS.md).

## How to sign

**You sign two agreements, in one file.** Create
`signatures/<your-github-login>.md` in a pull request **from your own
GitHub account**. Nobody can sign for you.

**Sign during onboarding, before your access is granted** — not before
your first commit. This agreement gates the keys, so it comes earlier
than the CLA does for an outside contributor.

On GitHub, open
[Add file](https://github.com/PioneerAIAcademy/cowork-genealogy/new/main?filename=signatures/YOUR-GITHUB-LOGIN.md),
replace `YOUR-GITHUB-LOGIN` with your login, paste the template below,
and choose **Propose new file**. No git needed. Title the pull request
`Sign CLA and Team Agreement: <your name>`, and in the description
include:

> I have read and agree to the Contributor License Agreement and to the
> Team Agreement, at the versions recorded in my signature file.

Read both agreements first, in full. Use your full legal name, not a
nickname or handle.

Record each **Version** from the header of `CLA.md` and
`TEAM-AGREEMENT.md` as it stands the day you sign, so a later revision
cannot change what you signed. Email addresses are deliberately not
collected — see [CLA-SIGNERS.md](./CLA-SIGNERS.md) for why.

**Template** — `signatures/adalovelace.md`:

```markdown
Full legal name: Ada Lovelace

| Agreement | Version | Date signed |
|---|---|---|
| CLA | 1.0 | 2026-10-19 |
| Team Agreement | 1.0 | 2026-10-19 |
```

The example is illustrative. Use your own name, login, and today's date.

---

## For maintainers

**Do not grant access until the person's file has a Team Agreement row.**
Organization membership, repository write access, and project credentials
all wait on it. Check that the file name matches the pull request
author's login. When that ordering slips, get the signature and rotate
anything already issued.

**Check for both rows.** A team member with no CLA row is a gap: this
agreement covers what someone is trusted with, not the rights in what
they write.

**When the Team Agreement changes.** Publish the new version with a new
version number in `TEAM-AGREEMENT.md`'s header, then ask current signers
to add a row to their own file. Never edit or remove an existing row.

**When someone leaves.** Their file stays. The confidentiality obligations
survive their departure and the record has to survive with them. Revoke
access and rotate credentials instead.
