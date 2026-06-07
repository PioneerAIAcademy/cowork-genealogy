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
 *   4. Deploy as web app (Execute as: me, Access: anyone)
 */

// ── Configuration ──────────────────────────────────────────────────
// Google Drive folder ID where feedback zip files will be saved.
// Find this in the folder's URL: drive.google.com/drive/folders/<THIS_ID>
var FOLDER_ID = 'YOUR_FOLDER_ID_HERE';

// Optional: email address to notify on new feedback. Leave empty to disable.
var NOTIFICATION_EMAIL = '';

// ── Endpoint ───────────────────────────────────────────────────────

function doPost(e) {
  try {
    var payload = JSON.parse(e.postData.contents);

    if (!payload.zipBase64 || !payload.filename) {
      throw new Error('Missing zipBase64 or filename');
    }

    var folder = DriveApp.getFolderById(FOLDER_ID);

    var bytes = Utilities.base64Decode(payload.zipBase64);
    var zipBlob = Utilities.newBlob(bytes, 'application/zip', payload.filename);
    var file = folder.createFile(zipBlob);

    var zipKB = Math.round(bytes.length / 1024);
    var email = payload.email || 'unknown';
    var feedbackMd = extractFeedbackMarkdown(zipBlob);

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

function doGet() {
  return ContentService
    .createTextOutput(JSON.stringify({ status: 'Feedback endpoint is running' }))
    .setMimeType(ContentService.MimeType.JSON);
}
