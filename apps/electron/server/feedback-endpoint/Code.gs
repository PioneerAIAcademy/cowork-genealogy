/**
 * Research Viewer — Feedback Endpoint
 *
 * A Google Apps Script web app that receives feedback POSTs from the
 * Electron Research Viewer and saves each payload as a zip file in
 * a Google Drive folder.
 *
 * Each report is a base64-encoded zip mirroring the user's project
 * folder; a reviewer can download it, unzip, and open it in the app
 * to reproduce the state exactly.
 *
 * Setup:
 *   1. Create a Google Drive folder for feedback storage
 *   2. Set FOLDER_ID below to that folder's ID
 *   3. Optionally set NOTIFICATION_EMAIL to receive alerts
 *   4. Set the GITHUB_TOKEN and GITHUB_REPO Script Properties (see README)
 *   5. Deploy as web app (Execute as: me, Access: anyone)
 */

// ── Configuration ──────────────────────────────────────────────────
// Google Drive folder ID where feedback zip files will be saved.
// Find this in the folder's URL: drive.google.com/drive/folders/<THIS_ID>
var FOLDER_ID = 'YOUR_FOLDER_ID_HERE';

// Optional: email address to notify on new feedback. Leave empty to disable.
var NOTIFICATION_EMAIL = '';

// Bump this when you paste a new Code.gs into the console. doGet() returns it,
// so `curl <exec-url>` says which version is actually deployed — otherwise an
// unpublished edit is indistinguishable from a working one.
var SCRIPT_VERSION = '2026-08-06';

// Labels applied to every feedback issue, in the same POST that creates it.
// `genealogist` puts it in that pool and counts it; `feedback` is what
// add-to-project.yml matches on to route the card to Ready instead of Backlog.
var ISSUE_LABELS = ['genealogist', 'feedback'];

// ── Endpoint ───────────────────────────────────────────────────────

function doPost(e) {
  try {
    var payload = JSON.parse(e.postData.contents);

    if (!payload.zipBase64 || !payload.filename) {
      throw new Error('Missing zipBase64 or filename');
    }

    // ~20 MB decoded — base64 is 4/3 of raw. Well above any real bundle.
    if (payload.zipBase64.length > 27 * 1024 * 1024) {
      return ContentService
        .createTextOutput(JSON.stringify({ ok: false, error: 'payload too large' }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    var folder = DriveApp.getFolderById(FOLDER_ID);

    var bytes = Utilities.base64Decode(payload.zipBase64);
    var zipBlob = Utilities.newBlob(bytes, 'application/zip', payload.filename);
    var file = folder.createFile(zipBlob);

    var zipKB = Math.round(bytes.length / 1024);
    var email = payload.email || 'unknown';
    var feedbackMd = extractFeedbackMarkdown(zipBlob);

    createFeedbackIssue(payload.filename, file.getUrl(), zipBlob);

    if (NOTIFICATION_EMAIL) {
      MailApp.sendEmail({
        to: NOTIFICATION_EMAIL,
        subject: 'Research Viewer feedback from ' + email + ' (' + zipKB + ' KB)',
        body: feedbackMd
            + '\n\n---\n'
            + 'Zip: ' + file.getUrl() + '\n'
            + 'Size: ' + zipKB + ' KB\n'
      });
    }

    Logger.log('Saved feedback: ' + payload.filename + ' (' + zipKB + ' KB) from ' + email);

    return ContentService
      .createTextOutput(JSON.stringify({ ok: true, filename: payload.filename }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    Logger.log('Error processing feedback: ' + err.message);
    return ContentService
      .createTextOutput(JSON.stringify({ ok: false, error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function extractFeedbackMarkdown(zipBlob) {
  try {
    var parts = Utilities.unzip(zipBlob);
    for (var i = 0; i < parts.length; i++) {
      if (parts[i].getName() === 'FEEDBACK.md') {
        return parts[i].getDataAsString();
      }
    }
    return '(FEEDBACK.md not found in zip)';
  } catch (err) {
    return '(failed to read FEEDBACK.md: ' + err.message + ')';
  }
}

/**
 * Create the GitHub issue that makes this zip findable.
 *
 * Never throws. A GitHub failure must not tell the user their submission
 * failed — the zip is already saved by the time this runs, and a false
 * failure makes them resubmit. Logs and returns instead.
 *
 * Never reads user-typed text. The repo is public, so email, project paths,
 * the prompt, and the four prose answers are not touched here. Only
 * submitted_at and platform are permitted, and both are clamped.
 */
function createFeedbackIssue(filename, driveUrl, zipBlob) {
  try {
    var props = PropertiesService.getScriptProperties();
    var token = props.getProperty('GITHUB_TOKEN');
    var repo = props.getProperty('GITHUB_REPO');

    if (!token || !repo) {
      Logger.log('No GITHUB_TOKEN/GITHUB_REPO Script Property — skipping issue creation.');
      return;
    }

    // Script clock, never the bundle's: the timestamp is the burst signal that
    // tells a reviewer these three submissions are one tester resubmitting.
    var stamp = Utilities.formatDate(new Date(), 'UTC', "yyyy-MM-dd'T'HH:mm'Z'");

    var body = [
      '**Zip:** ' + driveUrl,
      '',
      '```',
      'make feedback-case ZIP=~/Downloads/' + clampFilename(filename),
      '```',
      '',
      'Workflow: `docs/alpha-feedback-guide.md`'
    ];

    // Optional, and the issue never depends on them. A missing entry, a renamed
    // entry, or a parse error costs these two lines — not the issue, which is
    // the only thing standing between this zip and nobody ever finding it.
    var meta = readFeedbackJson(zipBlob);
    if (meta) {
      if (meta.submitted_at) body.push('', '- Submitted: ' + clampField(meta.submitted_at));
      if (meta.platform) body.push('- Platform: ' + clampField(meta.platform));
    }

    var response = UrlFetchApp.fetch('https://api.github.com/repos/' + repo + '/issues', {
      method: 'post',
      contentType: 'application/json',
      headers: {
        Authorization: 'Bearer ' + token,
        Accept: 'application/vnd.github+json'
      },
      // One POST. Labels added in a follow-up call are invisible to
      // add-to-project.yml, which reads them off the `opened` payload and has
      // no `labeled` trigger — the card would land in Backlog and stay there.
      payload: JSON.stringify({
        title: '[feedback] ' + stamp,
        body: body.join('\n'),
        labels: ISSUE_LABELS
      }),
      muteHttpExceptions: true
    });

    var code = response.getResponseCode();
    if (code >= 200 && code < 300) {
      Logger.log('Created feedback issue for ' + filename);
    } else {
      Logger.log('GitHub returned ' + code + ' creating issue for ' + filename
               + ': ' + response.getContentText());
    }
  } catch (err) {
    Logger.log('Failed to create feedback issue for ' + filename + ': ' + err.message);
  }
}

/**
 * Read _feedback/feedback.json out of the bundle. Returns null on any failure.
 *
 * extractFeedbackMarkdown matches a root-level name; this entry is nested, and
 * whether Utilities.unzip reports it with its directory prefix is not something
 * we can assume — so match on the suffix.
 */
function readFeedbackJson(zipBlob) {
  try {
    var parts = Utilities.unzip(zipBlob);
    for (var i = 0; i < parts.length; i++) {
      if (/feedback\.json$/.test(parts[i].getName())) {
        return JSON.parse(parts[i].getDataAsString());
      }
    }
    return null;
  } catch (err) {
    Logger.log('Could not read feedback.json: ' + err.message);
    return null;
  }
}

/**
 * Both permitted fields are untrusted strings — doPost validates presence and
 * nothing else, so neither the 10,000-char cap nor the platform vocabulary the
 * legitimate clients honor is enforced by the time a value reaches here.
 * `@` goes with the newlines and pipes: 120 characters of @-mentions would
 * notify real people from an issue body.
 */
function clampField(value) {
  return String(value).slice(0, 120).replace(/[\r\n|@]/g, ' ');
}

/**
 * The filename is untrusted too — doPost checks that it is present, nothing
 * more — and it lands inside a fenced code block. A backtick run would close
 * the fence and render everything after it as markdown, @-mentions included.
 * The legitimate clients send `feedback-<timestamp>.zip`, so reduce to that
 * alphabet rather than blacklisting the characters we happened to think of.
 */
function clampFilename(value) {
  var safe = String(value).slice(0, 120).replace(/[^A-Za-z0-9._-]/g, '_');
  return safe || 'feedback.zip';
}

function doGet() {
  return ContentService
    .createTextOutput(JSON.stringify({
      status: 'Feedback endpoint is running',
      version: SCRIPT_VERSION
    }))
    .setMimeType(ContentService.MimeType.JSON);
}
