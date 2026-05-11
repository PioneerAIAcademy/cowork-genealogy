/**
 * Smoke test for the image_reader tool.
 *
 * Usage:
 *   npx tsx dev/try-image-reader.ts "<image-url>"
 */

import { imageReaderTool } from "../src/tools/image-reader.js";

const url = process.argv[2];
if (!url) {
  console.error("Usage: npx tsx dev/try-image-reader.ts <image-url>");
  process.exit(1);
}

const result = await imageReaderTool({ url });

// Print metadata only — printing base64 would flood the terminal
console.log("Metadata:", JSON.stringify(result.metadata, null, 2));
console.log(
  `Image data: ${result.imageData.length} base64 chars (~${Math.round((result.imageData.length * 0.75) / 1024)} KB)`
);
