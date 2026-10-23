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
 *   npx tsx dev/try-image-transcribe.ts --project <dir> "<imageId>" ["<lookingFor>"]
 *   npx tsx dev/try-image-transcribe.ts --project <dir> "<ark>"     ["<lookingFor>"]
 *   npx tsx dev/try-image-transcribe.ts --project <dir> --file uploads/<name> ["<lookingFor>"]
 *
 * --project is required: this runs the MCP entry point, which stages the page
 * and returns its ref, not the text (issue #2490). --file reads an uploaded
 * image or PDF already inside the project folder (issue #2048). The staged
 * handle and digest are printed, then the page is read back through
 * sidecar_read, which is the round-trip a caller makes.
 */

import { LOCAL } from "../src/auth/principal.js";
import { imageTranscribeMcpTool } from "../src/tools/image-transcribe.js";
import { sidecarRead } from "../src/tools/sidecar-read.js";
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

if ((!file && !value) || !projectPath) {
  console.error(
    "Usage: npx tsx dev/try-image-transcribe.ts --project <dir> <imageId | ark> [lookingFor]\n" +
      "       npx tsx dev/try-image-transcribe.ts --project <dir> --file uploads/<name> [lookingFor]"
  );
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

const result = await imageTranscribeMcpTool({
  ...(file
    ? { file }
    : isImageId
      ? { imageId: value }
      : isMemory
        ? { memoryArtifactUrl: value }
        : { ark: value }),
  ...(lookingFor ? { lookingFor } : {}),
  projectPath,
}, LOCAL);

if ("ok" in result) {
  console.log("No project here:", result.errors.join(" "));
  process.exit(0);
}
console.log("Metadata:", JSON.stringify(result.metadata, null, 2));
if (result.found) console.log("Found:", result.found);
console.log("Staged:", JSON.stringify(result.staged), result.stagingError ?? "");
if (result.digest) console.log("Digest:", JSON.stringify(result.digest, null, 2));
if (result.truncated) console.log("TRUNCATED:", result.truncationNotice);
if (result.transcription !== undefined) {
  console.log("\n--- Transcription (inline: staging failed) ---\n");
  console.log(result.transcription);
} else if (result.staged) {
  const page = await sidecarRead({ projectPath, ref: result.staged.resultsRef });
  console.log("\n--- Transcription (sidecar_read of staged.resultsRef) ---\n");
  console.log(page.ok ? page.content : JSON.stringify(page));
}
