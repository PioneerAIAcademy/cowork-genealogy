/**
 * Smoke-test the record_attachments tool against the live FS API.
 *
 * Usage:
 *   npx tsx dev/try-record-attachments.ts <ark1> [ark2] [ark3] ...
 *
 * Example:
 *   npx tsx dev/try-record-attachments.ts \
 *     "https://www.familysearch.org/ark:/61903/1:1:QK2S-4W7G" \
 *     "https://www.familysearch.org/ark:/61903/1:1:QKRB-19LK"
 */
import { recordAttachmentsTool } from "../src/tools/record-attachments.js";

const uris = process.argv.slice(2);
if (uris.length === 0) {
  console.error("Usage: npx tsx dev/try-record-attachments.ts <ark1> [ark2] ...");
  console.error("");
  console.error("Example:");
  console.error('  npx tsx dev/try-record-attachments.ts "https://www.familysearch.org/ark:/61903/1:1:QK2S-4W7G"');
  process.exit(1);
}

const result = await recordAttachmentsTool({ uris });
console.log(JSON.stringify(result, null, 2));
