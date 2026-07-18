/**
 * Smoke test for the image_transcribe tool (live FamilySearch + live OpenRouter).
 *
 * Prereqs:
 *   - Logged in to FamilySearch (tokens.json in ~/.familysearch-mcp).
 *   - An OpenRouter key in ~/.familysearch-mcp/config.json under
 *     "openRouterApiKey" (or run the configure_openrouter tool once).
 *
 * Usage:
 *   npx tsx dev/try-image-transcribe.ts "<imageId>" ["<lookingFor>"]
 *   npx tsx dev/try-image-transcribe.ts "<ark>"     ["<lookingFor>"]
 */

import { imageTranscribeTool } from "../src/tools/image-transcribe.js";

const value = process.argv[2];
const lookingFor = process.argv[3];
if (!value) {
  console.error(
    "Usage: npx tsx dev/try-image-transcribe.ts <imageId | ark> [lookingFor]"
  );
  process.exit(1);
}

// Rough heuristic: an imageId is bare NUMBER_NUMBER; anything else goes as ark.
const isImageId = /^\d+_\d+$/.test(value);
const result = await imageTranscribeTool({
  ...(isImageId ? { imageId: value } : { ark: value }),
  ...(lookingFor ? { lookingFor } : {}),
});

console.log("Metadata:", JSON.stringify(result.metadata, null, 2));
if (result.found) console.log("Found:", result.found);
console.log("\n--- Transcription ---\n");
console.log(result.transcription);
