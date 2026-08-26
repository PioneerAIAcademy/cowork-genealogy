# Feedback Endpoint (Google Apps Script)

Receives feedback POSTs from the Research Viewer Electron app, saves each
payload as a zip file in a shared Google Drive folder, and opens a GitHub issue
so the zip is findable.

**`Code.gs` here is a template, not the deployed script.** The deployed copy is
edited in the Apps Script console and already differs from this file — the
committed `FOLDER_ID` is still `YOUR_FOLDER_ID_HERE`. Nothing in CI checks the
two against each other. The smoke test below is the only check that the deployed
script works at all, so run it after every console edit.

## Setup

### 1. Create the Drive folder

- Create a folder in Google Drive (e.g. "Research Viewer Feedback")
- Share it **Viewer**-only, to a Google Group of the team's accounts — never
  "anyone with the link". Editor access lets any member delete a zip, and the
  zip is the immutable record the feedback workflow depends on.
- Copy the folder ID from the URL: `drive.google.com/drive/folders/<FOLDER_ID>`

### 2. Create the Apps Script project

- Go to [script.google.com](https://script.google.com) and create a new project
- Replace the contents of `Code.gs` with the file from this directory
- Set `FOLDER_ID` to your Drive folder ID
- **Bump `SCRIPT_VERSION`** to today's date, here and in the committed copy

Checking what is deployed is then one command — no submission needed:

```bash
curl -sL <exec-url>
# {"status":"Feedback endpoint is running","version":"2026-08-26","notifyCount":2}
```

A version older than the committed `Code.gs` means the console copy is stale or
the deployment was never published. `notifyCount` is how many addresses
`NOTIFICATION_EMAILS` currently parses to — `0` means nobody is being emailed.

### 3. Set the Script Properties

**Project Settings → Script Properties.** None of these are required to save a
zip. Without the GitHub pair the endpoint still returns success and silently
creates no issues; without `NOTIFICATION_EMAILS` it emails nobody, just as
silently. `curl -sL <exec-url>` is what catches the email half — `notifyCount`.

| Property | Value |
|---|---|
| `NOTIFICATION_EMAILS` | Comma-separated addresses to email on each new submission, e.g. `dallan@gmail.com,chesworthrm@familysearch.org`. Whitespace around each address is trimmed. Leave the property unset to disable notification entirely. Not a constant in `Code.gs` because this repo is public, and because adding a reviewer should not mean republishing the deployment. |
| `GITHUB_TOKEN` | A fine-grained PAT scoped to the one repo, `Issues: Read and write` and nothing else. Org-owned repos additionally need fine-grained PAT access enabled on the org and an owner to approve the token — an unapproved token creates nothing and reports no error. |
| `GITHUB_REPO` | `PioneerAIAcademy/cowork-genealogy` |

### 4. Deploy as a web app

**First install only.** Click **Deploy → New deployment**, Type **Web app**,
Execute as **Me**, Who has access **Anyone**, then **Deploy** and authorize when
prompted. Copy the web app URL
(`https://script.google.com/macros/s/.../exec`).

**To redeploy after an edit — do not use "New deployment".** It mints a new
`/exec` URL, and the current one is hardcoded in two shipped clients
(`apps/electron/src/main/index.ts`, `apps/server/app/config.py`), so a new URL
orphans every installed Electron build. Instead:

**Manage deployments → edit the existing deployment (pencil) → Version: New
version → Deploy.**

Editing the script alone changes nothing that is served — an unpublished edit
looks exactly like a working deployment from the client's side.

**Re-authorize when the scopes change.** The GitHub call adds
`script.external_request`. Until the owner grants it under "Execute as: Me",
every issue-creation call throws into its own `try/catch` and submissions keep
returning success with no issue created.

### 5. Configure the Electron app

Update the fetch URL in `src/main/index.ts` (in the `feedback:submit` IPC handler)
to point to your deployed Apps Script URL instead of `http://localhost:3000/feedback`.

## How it works

- Each feedback submission is saved as `feedback-<timestamp>.zip` in the Drive folder
- Each submission also opens a GitHub issue titled `[feedback] <timestamp>`,
  labelled `genealogist` + `feedback`, carrying the Drive link and the
  `make feedback-case` command. The `feedback` label routes the card straight to
  **Ready**; see `.github/workflows/add-to-project.yml`.
- **The issue body never contains user-typed text.** The repo is public. Only
  `submitted_at` and `platform` are read out of the bundle, and both are clamped.
- **A GitHub failure never fails the submission.** The zip is already saved by
  then, so the user gets success either way and the failure is logged. The cost
  is an orphaned zip with no issue — which is exactly what the smoke test checks.
- Every address in `NOTIFICATION_EMAILS` gets one email with the `FEEDBACK.md`
  summary and a link to the zip — a single send to all recipients, not one per
  person
- **A notification failure never fails the submission either.** A typo in
  `NOTIFICATION_EMAILS` throws for the whole send, and that is logged rather
  than returned, so one bad address costs the emails and not the zip
- Your team accesses feedback by opening the shared Drive folder — no special accounts needed

## Smoke test

Nothing in CI can reach this — the script runs in Google's runtime against a real
Drive folder and the real GitHub API. Run this at rollout **and after every
console edit**.

1. `curl -sL <exec-url>` and check `version` matches the committed `Code.gs`,
   and that `notifyCount` equals the number of addresses you configured. This
   rules out the stale-console, unpublished-deployment and unset-property cases
   before you spend a submission on them.
2. Submit a bundle with a throwaway email. Confirm an issue exists, labelled
   `genealogist` + `feedback`, titled `[feedback] …`, sitting in **Ready** on
   project 1.
   **If there is no issue and no error, and step 1 was clean, suspect an
   ungranted `script.external_request` scope before you suspect the PAT** — the
   `try/catch` makes both look identical from the client. Executions in the Apps
   Script console tell them apart.
3. Confirm every address in `NOTIFICATION_EMAILS` received the email.
4. Confirm the body contains no `@`, no `/Users/`, no `C:\`, and none of
   `email`, `project_folder_path`, `user_prompt`, `agent_did`,
   `agent_should_have`, `correct_answer`, `notes`.
5. **Delete the `GITHUB_TOKEN` Script Property** and submit again. The user must
   still get a success response, with no issue created. Restore the value
   afterwards. This is the step that proves the `try/catch`, and the one most
   likely to be skipped. Do not prove it by revoking the PAT instead — that is
   irreversible and re-minting drags the org-owner approval back through the loop.

## Limits

- Google Apps Script: 6 min execution timeout, 50 MB per execution
- Google Drive: 15 GB free storage
- MailApp: 100 emails/day on free account

All well above what a beta with a few users would hit.
