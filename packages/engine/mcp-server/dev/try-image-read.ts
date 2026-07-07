/**
 * Smoke test for the image_read tool.
 *
 * Usage:
 *   npx tsx dev/try-image-read.ts "<imageId>"   # e.g. 004884748_02613
 *   npx tsx dev/try-image-read.ts "<ark>"       # e.g. ark:/61903/3:1:3Q9M-CSNL-S98H-M
 */

import { imageReadTool } from "../src/tools/image-read.js";

const value = process.argv[2];
if (!value) {
  console.error("Usage: npx tsx dev/try-image-read.ts <imageId | ark>");
  process.exit(1);
}

// Rough heuristic: an imageId is bare NUMBER_NUMBER; anything else (an ARK,
// a resolver URL, or a resolved distribution URL) goes through `ark`.
const result = /^\d+_\d+$/.test(value)
  ? await imageReadTool({ imageId: value })
  : await imageReadTool({ ark: value });

// Print metadata only — printing base64 would flood the terminal
console.log("Metadata:", JSON.stringify(result.metadata, null, 2));
console.log(
  `Image data: ${result.imageData.length} base64 chars (~${Math.round((result.imageData.length * 0.75) / 1024)} KB)`
);
