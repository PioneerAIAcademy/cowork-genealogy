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
 *   3. Set the NOTIFICATION_EMAILS, GITHUB_TOKEN and GITHUB_REPO Script
 *      Properties (see README)
 *   4. Deploy as web app (Execute as: me, Access: anyone)
 */

// ── Configuration ──────────────────────────────────────────────────
// Google Drive folder ID where feedback zip files will be saved.
// Find this in the folder's URL: drive.google.com/drive/folders/<THIS_ID>
var FOLDER_ID = 'YOUR_FOLDER_ID_HERE';

// Bump this when you paste a new Code.gs into the console. doGet() returns it,
// so `curl <exec-url>` says which version is actually deployed — otherwise an
// unpublished edit is indistinguishable from a working one.
var SCRIPT_VERSION = '2026-08-30';

// Labels applied to every feedback issue, in the same POST that creates it.
// `genealogist` says who claims it; `feedback` is what add-to-project.yml
// matches on to route the card to the Feedback column instead of Backlog.
var ISSUE_LABELS = ['genealogist', 'feedback'];

// The prose the tester types, in the order the form asks for it. Copied into
// the issue body so the report is readable without downloading the bundle.
// `email` and `project_folder_path` are deliberately absent — see
// createFeedbackIssue.
var PROSE_FIELDS = [
  ['user_prompt',       'What I asked'],
  ['agent_did',         'What the agent did'],
  ['agent_should_have', 'What it should have done'],
  ['correct_answer',    'The correct answer'],
  ['notes',             'Notes']
];

// Per-field ceiling on prose copied into the body. The clients cap a field at
// 10,000 characters, but doPost validates presence and nothing else, so nothing
// enforces that by the time a value reaches here.
var MAX_PROSE_CHARS = 6000;

// GitHub rejects an issue body over 65,536 characters. Staying under a lower
// ceiling leaves room for the escaping below, which can only grow the text.
var MAX_BODY_CHARS = 60000;

// ── Endpoint ───────────────────────────────────────────────────────

function doPost(e) {
  try {
    var payload = JSON.parse(e.postData.contents);

    if (!payload.zipBase64 || !payload.filename) {
      throw new Error('Missing zipBase64 or filename');
    }

    // 47 MB base64 ≈ 35 MB decoded (the client-side bundle cap). Under Apps
    // Script's 50 MB per-execution ceiling but not by much.
    if (payload.zipBase64.length > 47 * 1024 * 1024) {
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

    // Same rule as the GitHub call above: the zip is already saved, so a
    // notification failure must not tell the user their submission failed.
    // One malformed address in NOTIFICATION_EMAILS throws for the whole send,
    // which would otherwise fail every submission until someone noticed.
    try {
      var recipients = notificationRecipients();
      if (recipients) {
        MailApp.sendEmail({
          to: recipients,
          subject: 'Research Viewer feedback from ' + email + ' (' + zipKB + ' KB)',
          body: feedbackMd
              + '\n\n---\n'
              + 'Zip: ' + file.getUrl() + '\n'
              + 'Size: ' + zipKB + ' KB\n'
        });
      }
    } catch (mailErr) {
      Logger.log('Failed to send notification for ' + payload.filename + ': ' + mailErr.message);
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

/**
 * The addresses to notify, as the comma-separated string MailApp.sendEmail
 * wants in `to`. Returns '' when nothing is configured, which disables the
 * notification without touching the submission.
 *
 * Lives in a Script Property rather than a constant here because this file is
 * committed to a public repo, and because adding a reviewer should not require
 * republishing a deployment.
 *
 * One send, not one per address: MailApp's daily quota counts recipients, and
 * a partial failure part-way through a loop would leave some reviewers
 * notified and no way to tell which.
 */
function notificationRecipients() {
  var raw = PropertiesService.getScriptProperties().getProperty('NOTIFICATION_EMAILS');
  if (!raw) {
    Logger.log('No NOTIFICATION_EMAILS Script Property — skipping notification email.');
    return '';
  }

  var cleaned = [];
  var parts = raw.split(',');
  for (var i = 0; i < parts.length; i++) {
    var address = parts[i].trim();
    if (address) cleaned.push(address);
  }

  return cleaned.join(',');
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
 * Copies the tester's own prose into the body (2026-08-30) so a reviewer can
 * read the report on the board. This reverses the earlier rule that no
 * user-typed text was published; testers are now told their feedback is public
 * and asked to keep PII out of it.
 *
 * Two fields stay excluded, and the repo being public is why: `email` is the
 * submitter's own contact address, and `project_folder_path` is a path on their
 * machine that leaks a username. Neither says anything about the run. Every
 * value that is copied goes through clampProse first — untrusted text in a
 * public body can @-mention real people.
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

      // Drop the prose rather than the issue if it would blow the body limit:
      // a rejected POST loses the Drive link too, and the link is the only
      // thing standing between this zip and nobody ever finding it.
      var beforeProse = body.length;
      appendFeedbackText(body, meta);
      if (body.join('\n').length > MAX_BODY_CHARS) {
        body.length = beforeProse;
        body.push('', '---', '', '## Feedback text', '',
                  '_Too long for an issue body — read it in the bundle._');
      }
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
 * Append the tester's own words to the issue body.
 *
 * A field the tester left blank is omitted rather than rendered as an empty
 * heading, which is why the section is assembled before any of it is pushed:
 * a bundle carrying no prose at all must add no section.
 */
function appendFeedbackText(body, meta) {
  var fields = [];
  for (var i = 0; i < PROSE_FIELDS.length; i++) {
    var value = clampProse(meta[PROSE_FIELDS[i][0]]);
    if (value) fields.push([PROSE_FIELDS[i][1], value]);
  }

  var hasVerdict = typeof meta.worked_as_expected === 'boolean';
  if (!fields.length && !hasVerdict) return;

  body.push('', '---', '', '## Feedback text', '',
            'Submitted by the tester through the Cowork viewer, reproduced verbatim.', '');
  if (hasVerdict) {
    body.push('**Worked as expected:** ' + (meta.worked_as_expected ? 'yes' : 'no'), '');
  }
  for (var j = 0; j < fields.length; j++) {
    body.push('### ' + fields[j][0], '', blockquote(fields[j][1]), '');
  }
}

/**
 * Prose is untrusted and lands in a public issue body.
 *
 * `@` is escaped for the same reason clampField strips it from the two metadata
 * fields: a body full of @-mentions notifies real people. `&#64;` renders as an
 * @ and forms no mention, so the tester's words still read exactly as typed —
 * which a plain strip would not preserve.
 *
 * The cap applies to the raw value, before escaping. Escaping can only grow the
 * string, so MAX_BODY_CHARS is what actually bounds the body; this bounds how
 * much of any one field is reproduced.
 */
function clampProse(value) {
  if (typeof value !== 'string') return '';
  return value
    .slice(0, MAX_PROSE_CHARS)
    .replace(/\r\n?/g, '\n')
    .replace(/@/g, '&#64;')
    .trim();
}

/**
 * Quote every line, blank ones included. A blockquote ends at the first line
 * that is not prefixed, so prefixing unconditionally is what stops the tester's
 * text from closing the quote and rendering as body markdown of its own.
 */
function blockquote(text) {
  var lines = text.split('\n');
  for (var i = 0; i < lines.length; i++) {
    lines[i] = lines[i].trim() ? '> ' + lines[i] : '>';
  }
  return lines.join('\n');
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
      version: SCRIPT_VERSION,
      notifyCount: notificationRecipients().split(',').filter(String).length
    }))
    .setMimeType(ContentService.MimeType.JSON);
}
