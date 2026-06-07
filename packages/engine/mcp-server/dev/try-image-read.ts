/**
 * Smoke test for the image_read tool.
 *
 * Usage:
 *   npx tsx dev/try-image-read.ts "<imageId>"   # e.g. 004884748_02613
 */

import { imageReadTool } from "../src/tools/image-read.js";

const imageId = process.argv[2];
if (!imageId) {
  console.error("Usage: npx tsx dev/try-image-read.ts <imageId>");
  process.exit(1);
}

const result = await imageReadTool({ imageId });

// Print metadata only — printing base64 would flood the terminal
console.log("Metadata:", JSON.stringify(result.metadata, null, 2));
console.log(
  `Image data: ${result.imageData.length} base64 chars (~${Math.round((result.imageData.length * 0.75) / 1024)} KB)`
);
