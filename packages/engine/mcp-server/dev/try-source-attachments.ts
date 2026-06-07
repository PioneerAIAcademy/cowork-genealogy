/**
 * Smoke-test the source_attachments tool against the live FS API.
 *
 * Usage:
 *   npx tsx dev/try-source-attachments.ts <ark1> [ark2] [ark3] ...
 *
 * Accepts record persona ARKs (1:1:...) and/or document image ARKs (3:1:...).
 *
 * Example (mixing a record persona and a document image):
 *   npx tsx dev/try-source-attachments.ts \
 *     "ark:/61903/1:1:QK2S-4W7G" \
 *     "ark:/61903/3:1:3Q9M-CSNL-S98H-M"
 */
import { sourceAttachmentsTool } from "../src/tools/source-attachments.js";

const uris = process.argv.slice(2);
if (uris.length === 0) {
  console.error("Usage: npx tsx dev/try-source-attachments.ts <ark1> [ark2] ...");
  console.error("");
  console.error("Example:");
  console.error('  npx tsx dev/try-source-attachments.ts "ark:/61903/1:1:QK2S-4W7G"');
  process.exit(1);
}

const result = await sourceAttachmentsTool({ uris });
console.log(JSON.stringify(result, null, 2));
