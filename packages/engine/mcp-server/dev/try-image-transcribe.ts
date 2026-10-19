/**
 * Smoke test for the image_transcribe tool (live FamilySearch + live OpenRouter).
 *
 * Prereqs:
 *   - An OpenRouter key in ~/.familysearch-mcp/config.json under
 *     "openRouterApiKey".
 *   - For imageId / ark: logged in to FamilySearch (tokens.json in
 *     ~/.familysearch-mcp). The --file form needs no FamilySearch login.
 *
 * Usage:
 *   npx tsx dev/try-image-transcribe.ts "<imageId>" ["<lookingFor>"] [--project <dir>]
 *   npx tsx dev/try-image-transcribe.ts "<ark>"     ["<lookingFor>"] [--project <dir>]
 *   npx tsx dev/try-image-transcribe.ts --project <dir> --file uploads/<name> ["<lookingFor>"]
 *
 * --file reads an uploaded image or PDF already inside the project folder
 * (issue #2048) — the path is project-relative, exactly what the tool takes.
 * With --project the tool also stages the transcription; the staged handle and
 * digest are printed so the round-trip to research_log_append can be checked.
 */

import { LOCAL } from "../src/auth/principal.js";
import { imageTranscribeTool } from "../src/tools/image-transcribe.js";
import { isMemoryArtifactUrl } from "../src/utils/fs-image-fetch.js";
import { memoryPageId } from "../src/utils/memories.js";

const argv = process.argv.slice(2);
function takeFlag(name: string): string | undefined {
  const i = argv.indexOf(name);
  if (i === -1) return undefined;
  const [, value] = argv.splice(i, 2);
  return value;
}
const projectPath = takeFlag("--project");
const file = takeFlag("--file");
const [value, lookingFor] = argv;

if (!file && !value) {
  console.error(
    "Usage: npx tsx dev/try-image-transcribe.ts <imageId | ark> [lookingFor] [--project <dir>]\n" +
      "       npx tsx dev/try-image-transcribe.ts --project <dir> --file uploads/<name> [lookingFor]"
  );
  process.exit(1);
}
if (file && !projectPath) {
  console.error("--file needs --project <dir>: the path is relative to the project folder.");
  process.exit(1);
}

// Rough heuristic. An imageId is bare NUMBER_NUMBER. A memory goes as
// memoryArtifactUrl in EITHER of its two shapes — the direct sg30p0 bytes url,
// or a familysearch.org page url (photos/artifacts/<id> or memories/<id>) —
// because routing those to `ark` sends the wrong input and the failure looks
// like the tool rejecting a url it now accepts. Anything else goes as ark.
const isImageId = value !== undefined && /^\d+_\d+$/.test(value);
// Imported, not re-implemented: a local copy of either pattern drifts, and a
// drifted copy routes a value the tool then rejects — which is the misrouting
// this branch exists to prevent. The first copy already had, dropping
// MEMORY_PAGE_PATTERN's terminator so `/artifacts/123abc` routed as a memory.
const isMemory =
  value !== undefined && (isMemoryArtifactUrl(value) || memoryPageId(value) !== null);

const result = await imageTranscribeTool({
  ...(file
    ? { file }
    : isImageId
      ? { imageId: value }
      : isMemory
        ? { memoryArtifactUrl: value }
        : { ark: value }),
  ...(lookingFor ? { lookingFor } : {}),
  ...(projectPath ? { projectPath } : {}),
}, LOCAL);

if ("ok" in result) {
  console.log("No project here:", result.errors.join(" "));
  process.exit(0);
}
console.log("Metadata:", JSON.stringify(result.metadata, null, 2));
if (result.found) console.log("Found:", result.found);
if (result.staged !== undefined) console.log("Staged:", JSON.stringify(result.staged), result.stagingError ?? "");
if (result.digest) console.log("Digest:", JSON.stringify(result.digest, null, 2));
if (result.truncated) console.log("TRUNCATED:", result.truncationNotice);
console.log("\n--- Transcription ---\n");
console.log(result.transcription);
