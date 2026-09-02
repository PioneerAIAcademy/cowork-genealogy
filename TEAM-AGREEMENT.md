# Team Agreement: confidentiality, credentials, and personal data

**Version 1.0 — 2026-09-02**

This agreement is between you and **GeneFun, Inc.**, doing business as
**Pioneer AI Academy** ("GeneFun", "we", "us").

**Who signs this:** anyone with membership in the `PioneerAIAcademy`
GitHub organization, write access to a project repository, or access to
project credentials or alpha-tester data. Signing it is a condition of
holding that access.

**Who does not:** outside contributors who open pull requests without
those things. They sign the [CLA](./CLA.md) only.

If you contribute code, you sign **both** this and the
[CLA](./CLA.md). They cover different things: the CLA covers the rights
in what you write, this covers what you are trusted with.

To sign, see [TEAM-SIGNERS.md](./TEAM-SIGNERS.md).

---

## Plain-language summary

This summary is not part of the agreement and does not change it. If the
summary and the terms disagree, the terms win.

- **Keys are yours alone.** Do not share them, commit them, or use them
  for anything but project work. They are billed to GeneFun.
- **Alpha testers send us real family data about living people.** That is
  the most sensitive thing you will touch. Do not commit it, do not put
  it in an issue, delete it when you are done.
- **Do not paste credentials or tester data into AI tools other than the
  ones the project already uses.**
- **Researching your own family is expected.** Using the product on your
  own lines is the point of the alpha test, not a misuse of it.
- **Tell us fast if something leaks.** Reporting a mistake is not the
  problem. Hiding it is. Nobody gets in trouble for a fast report.
- **This lasts after you leave.**

---

## Terms

### 1. Credentials and secrets

You may be issued credentials for project services, including OpenRouter
API keys, FamilySearch OAuth credentials, and access to hosted
infrastructure. These are issued to you individually. You agree to:

**(a) Not share them.** Do not give a credential to anyone else,
including another team member. If someone needs access, ask a maintainer
to issue their own.

**(b) Not commit or publish them.** Never place a credential in a
repository, pull request, issue, comment, screenshot, screen recording,
chat message, or any public location. Project credentials belong only in
the locations the project documents for them — `~/.familysearch-mcp/`,
`eval/.env`, or the platform's own secret store — all of which are
excluded from version control.

**(c) Use them only for project work.** Testing the product on your own
family research counts as project work — that is what the alpha test is
for. What does not count is using a project credential for an unrelated
personal project, for other employment or client work, or for any
purpose GeneFun has not authorized. Usage is billed to GeneFun.

**(d) Report suspected exposure immediately.** If you believe a
credential has been exposed — committed by mistake, pasted into the wrong
window, used on a shared or compromised machine, or anything you are
unsure about — tell a maintainer as soon as you notice, before you try to
fix it yourself. The damage from a leaked key comes from the delay in
rotating it, not from the mistake. Reporting promptly is expected
behaviour and is not itself a violation of this agreement.

### 2. Personal information about living people

Alpha testers submit feedback containing their own genealogical research,
which concerns **living people** who have not agreed to anything and who
are not our users.

The feedback tooling removes living people from the tree files
automatically before a bundle is sent, and treats a person as living
unless the record says otherwise. Do not rely on it. It deliberately
passes a malformed tree through untouched rather than block a report, and
it does not reach the parts of a bundle where living people are most
often named: the session transcript, the free-text feedback fields, and
`research.json`. Assume any bundle you open may contain them.

This is the most sensitive information on the project. You agree to:

**(a) Keep it in the working location and nowhere else.** Feedback
material stays in the local case directory the tooling creates for it
(`~/feedback/<slug>/`). Do not copy it into the repository, into a cloud
drive, into a chat message, or onto a shared machine.

**(b) Never commit it.** Do not add tester data to a repository, an
issue, a pull request, a comment, a test fixture, a run log, or a
screenshot. When a test fixture is derived from real tester data, remove
information about living people first, as the feedback workflow already
requires.

**(c) Delete it when you are done.** Remove local copies when the work is
finished, following the cleanup step in the feedback workflow.

**(d) Not use it for anything else.** Do not use tester data for your own
genealogical research, to look up people, to demonstrate the product, or
for any purpose other than the specific task you were given.

The workflow that implements these rules is
[docs/alpha-feedback-guide.md](./docs/alpha-feedback-guide.md). Follow it.

### 3. FamilySearch data and terms of use

Records and images retrieved through the FamilySearch API are generally
also available to anyone through the FamilySearch website, so they are
not secret. They are still governed by FamilySearch's terms of use, and
our partnership depends on respecting them.

**Researching your own family is expected.** Using the product on your
own family lines is how the alpha test works, and nothing here restricts
it.

Beyond that, you agree to:

**(a) Not bulk-download, scrape, mirror, or redistribute** FamilySearch
records or images beyond what a specific task requires.

**(b) Not share retrieved material outside the project**, other than
your own research results about your own family.

### 4. Confidential business information

Some information you encounter is genuinely not public. You agree not to
disclose the following outside the project team, and to use it only for
project work:

- Unreleased details of GeneFun's relationships with FamilySearch,
  Anthropic, or any other partner or sponsor — including the terms,
  status, and existence of discussions not publicly announced.
- Product plans, launch timing, and roadmap that have not been announced.
- Material a partner has given us under their own confidentiality terms,
  including pre-release software and documentation.
- Financial and operational information: costs, pricing, budgets,
  infrastructure spend, and model usage figures.
- Anything a maintainer identifies as confidential when they share it.

### 5. AI tools

Working with an AI coding assistant is expected on this project. This
section does not restrict that. It restricts what you put into one.

**(a)** Do not paste credentials, secrets, or alpha-tester data into any
AI service other than the ones this project already uses for that
purpose.

**(b)** Do not use project data to train, fine-tune, or build an
evaluation set for anything outside this project.

**(c)** You are responsible for what you submit, however it was produced.

### 6. What this does not cover

Nothing in this agreement restricts:

**(a) Information that is or becomes public** through no fault of yours,
including everything in our public repositories and everything available
on the FamilySearch website.

**(b) Information you already knew** before receiving it here, or that
you receive from someone else who is free to share it.

**(c) Your own skills and knowledge.** What you learn here about
genealogy, software, and AI is yours. You may describe your work on this
project publicly and use it in a portfolio or on a résumé, so long as you
do not disclose anything covered by sections 1 through 4.

**(d) Disclosure required by law**, or reporting suspected illegal
conduct to an appropriate authority. You do not need our permission and
do not need to tell us first.

### 7. When your access ends

When you stop working on the project, or when a maintainer asks:

**(a)** Delete your local copies of alpha-tester data and any other
confidential material.

**(b)** Stop using project credentials. Assume they will be revoked and
rotated, and do not treat continued technical access as permission.

**(c)** Your confidentiality obligations in sections 1 through 4
continue. They do not end when your access does.

Work you contributed stays in the project under the [CLA](./CLA.md).

### 8. If this agreement is broken

The response to a violation is the removal of access: revoking
organization membership and repository permissions, and rotating any
credential involved. GeneFun may do this immediately and without notice.
Depending on what happened, GeneFun may also notify an affected partner
or an affected individual, which it may be legally required to do in the
case of personal data.

This section states the ordinary response. It does not limit any other
remedy available to GeneFun under law.

### 9. No employment relationship

This agreement does not create an employment, partnership, agency, or
joint venture relationship, and does not entitle you to compensation.
Where you do have a separate written agreement with GeneFun, that
agreement governs anything this one conflicts with.

### 10. Governing law

This agreement is governed by the laws of the State of Utah, without
regard to its conflict of law provisions.

### 11. Changes

GeneFun may publish a new version of this agreement and ask you to sign
it as a condition of continued access. The version recorded next to your
name in [TEAM-SIGNERS.md](./TEAM-SIGNERS.md) is the one that binds you until you
sign a newer one.

---

## How to sign

Add your row to [TEAM-SIGNERS.md](./TEAM-SIGNERS.md), and one to
[CLA-SIGNERS.md](./CLA-SIGNERS.md), in a single pull request opened from
your own GitHub account. Signing instructions are in those files.
