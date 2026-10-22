# CLA signers

Everyone who contributes to this project signs the
[Contributor License Agreement](./CLA.md) — outside contributors and
team members alike. Team members sign the
[Team Agreement](./TEAM-AGREEMENT.md) at the same time; their
instructions are in [TEAM-SIGNERS.md](./TEAM-SIGNERS.md).

## How to sign

Each signer has one file, `signatures/<your-github-login>.md`. You create
it in a pull request **from your own GitHub account**. Nobody can sign
for you.

**Put the file in the same pull request as your contribution.** There is
no separate signing step to wait on. If you would rather sign before you
start work, a standalone pull request is fine too — on GitHub, open
[Add file](https://github.com/PioneerAIAcademy/cowork-genealogy/new/main?filename=signatures/YOUR-GITHUB-LOGIN.md),
replace `YOUR-GITHUB-LOGIN` with your login, paste the template below,
and choose **Propose new file**. No git needed.

In the pull request description, include this line:

> I have read and agree to the Contributor License Agreement at the
> version recorded in my signature file.

Read [CLA.md](./CLA.md) first, in full. Use your full legal name, not a
nickname or handle. You do this once — later pull requests need nothing.

Record the **Version** from the header of `CLA.md` as it stands the day
you sign. That column is what makes this record hold up: it says which
text you agreed to, so a later revision cannot change what you signed.

Email addresses are deliberately not collected. This is a public
repository, and a plaintext list of contributors' email addresses is a
scrape target. The identity binding comes from your signing commit —
its author email, timestamp, and GitHub account are permanent in this
repository's history.

**Template** — `signatures/adalovelace.md`:

```markdown
Full legal name: Ada Lovelace

| Agreement | Version | Date signed |
|---|---|---|
| CLA | 1.0 | 2026-10-22 |
```

The example is illustrative. Use your own name, login, and today's date.

---

## For maintainers

**Do not merge a contribution until its author has a file in
`signatures/` with a CLA row** — added in that pull request or an earlier
one. Check that the file name matches the pull request author's login.
This is the only gate on outside contributions; nothing else will catch a
missing signature.

**When the CLA changes.** Publish the new version with a new version
number in `CLA.md`'s header, then ask current signers to add a row to
their own file. Never edit or remove an existing row — it is the record of
what that person agreed to and when. A person's most recent CLA row is
what binds them.

**When someone leaves.** Their file stays. It records a grant of rights in
work that is still in the project.
