# Feedback → issues: rollout worklist

**One-time. Delete this file once step 8 passes.** It is a checklist for a single
rollout, not a reference doc — leaving it here after the fact makes the next
reader think there is pending work.

Everything below is the lead's, and none of it is in the repo: Google console,
GitHub settings, Drive. The code half shipped in the PR that added this file.

**Do these in order.** Steps 1–2 must be on `main` before step 5, because
workflows for `issues:` events run from the default branch. Backwards, and every
submission in the window lands in Backlog — where nothing rescues it, since
`/fill-ready` never promotes a `feedback` item out of Backlog.

---

### 1. Merge the PR

Nothing else works until `add-to-project.yml` is on `main`.

### 2. Create the label

```sh
gh label create feedback --repo PioneerAIAcademy/cowork-genealogy \
  --description "User feedback submission — routes straight to Ready" \
  --color D4C5F9
```

It does not exist yet. The workflow matches on it by name; without it every
submission lands in Backlog.

### 3. Mint the PAT

Fine-grained, scoped to `PioneerAIAcademy/cowork-genealogy` only, **Issues: Read
and write** and nothing else.

The repo is org-owned, so this also needs fine-grained PAT access enabled on the
org **and** an owner to approve the token. Neither errors at the call site — an
unapproved token creates nothing, which looks exactly like the script not
running.

**Confirm before moving on:** create one issue by hand with the token.

```sh
curl -s -X POST https://api.github.com/repos/PioneerAIAcademy/cowork-genealogy/issues \
  -H "Authorization: Bearer $TOKEN" -H "Accept: application/vnd.github+json" \
  -d '{"title":"[feedback] token check","labels":["genealogist","feedback"]}'
```

Close it afterwards. If this fails, everything downstream fails silently.

### 4. Set the Script Properties

Apps Script console → **Project Settings → Script Properties**:

| Property | Value |
|---|---|
| `GITHUB_TOKEN` | the PAT from step 3 |
| `GITHUB_REPO` | `PioneerAIAcademy/cowork-genealogy` |

### 5. Deploy the script

Paste the new `Code.gs` from `apps/electron/server/feedback-endpoint/` into the
console.

**Re-authorize when prompted.** The GitHub call adds the
`script.external_request` scope. Until it is granted under "Execute as: Me",
every issue-creation call throws into its own `try/catch` and submissions keep
returning success with no issue created.

Then **Manage deployments → edit the existing deployment (pencil) → Version: New
version → Deploy.**

**Do not use "Deploy → New deployment".** It mints a new `/exec` URL, and the
current one is hardcoded in two shipped clients
(`apps/electron/src/main/index.ts`, `apps/server/app/config.py`) — a new URL
orphans every installed Electron build.

**Confirm:**

```sh
curl -sL <exec-url>
# {"status":"Feedback endpoint is running","version":"2026-08-04"}
```

An older `version` means the paste or the publish did not take.

### 6. Re-share the Drive folder

To a Google Group of the junior accounts, **Viewer** — never "anyone with the
link", and not Editor. Editor lets any of them delete a zip, and the zip is the
immutable record the whole workflow rests on.

### 7. Tell the team

The claim rule is new and nothing enforces it. Two people can both self-assign,
and the only thing preventing it is that everyone knows to check.

> Feedback now arrives as GitHub issues in Ready, titled `[feedback] <time>`.
> Assign one to yourself before you start — that's the claim. If it already has
> an assignee, take another. Everything else is the same guide:
> `docs/alpha-feedback-guide.md`.

Anyone on the roster may claim one, not just genealogists.

### 8. Smoke test

The full version, including the failure-path checks, is in
`apps/electron/server/feedback-endpoint/README.md` § Smoke test. Run it now and
after **every** future console edit — CI cannot reach any of this.

Four checks: version matches; a submission creates a labelled issue in Ready;
the body leaks no user text; and with `GITHUB_TOKEN` deleted, the user still
gets a success response.

---

## Then delete this file

Once step 8 passes, `git rm docs/feedback-rollout.md`. The durable record is the
endpoint README (setup + smoke test), `docs/alpha-feedback-guide.md` (the
workflow), and `docs/architecture.md` §9.4 (what still isn't checked).

## Known and accepted

Not steps — things to recognize rather than fix, so they don't get rediscovered
as bugs.

- **This widens issue #1121, and does not fix it.** The endpoint takes
  unauthenticated writes and its URL is in a public repo. After this, the same
  POST creates issues in a public repo, auto-routed to Ready. The clamping and
  script-clock title bound what an attacker can write, not whether they can. A
  flood is cleared by closing the issues.
- **Ready's genealogist half tracks the feedback rate.** Six feedback items in
  Ready leaves four slots, and the rest of the genealogist queue promotes as
  usual. Ten leaves none, and `/fill-ready` returns the non-feedback items to
  Backlog. The `test <slug>` queue moves on quiet weeks and stalls on busy ones.
- **Repeat submissions each open their own issue.** Adjacent timestamps are the
  signal; the guide says to check.
