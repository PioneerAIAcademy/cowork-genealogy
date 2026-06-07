# Feedback Endpoint (Google Apps Script)

Receives feedback POSTs from the Research Viewer Electron app and saves each
payload as a JSON file in a shared Google Drive folder.

## Setup

### 1. Create the Drive folder

- Create a folder in Google Drive (e.g. "Research Viewer Feedback")
- Share it with your interns/team (Editor or Viewer access)
- Copy the folder ID from the URL: `drive.google.com/drive/folders/<FOLDER_ID>`

### 2. Create the Apps Script project

- Go to [script.google.com](https://script.google.com) and create a new project
- Replace the contents of `Code.gs` with the file from this directory
- Set `FOLDER_ID` to your Drive folder ID
- Optionally set `NOTIFICATION_EMAIL` to your email address

### 3. Deploy as a web app

- Click **Deploy → New deployment**
- Type: **Web app**
- Execute as: **Me** (your account)
- Who has access: **Anyone**
- Click **Deploy** and authorize when prompted
- Copy the web app URL (looks like `https://script.google.com/macros/s/.../exec`)

### 4. Configure the Electron app

Update the fetch URL in `src/main/index.ts` (in the `feedback:submit` IPC handler)
to point to your deployed Apps Script URL instead of `http://localhost:3000/feedback`.

## How it works

- Each feedback submission is saved as `feedback-<timestamp>.json` in the Drive folder
- Files are pretty-printed JSON for easy reading
- If `NOTIFICATION_EMAIL` is set, you get an email with a summary and link to the file
- Your team accesses feedback by opening the shared Drive folder — no special accounts needed

## Limits

- Google Apps Script: 6 min execution timeout, 50 MB per execution
- Google Drive: 15 GB free storage
- MailApp: 100 emails/day on free account

All well above what a beta with a few users would hit.
