// Manual smoke test for sidecar_read — also the dispatch check the drift test
// cannot make (a missing index.ts if-block is a runtime "Unknown tool").
//   npx tsx dev/try-sidecar-read.ts <projectPath> <ref> [offset] [maxChars]
// e.g. npx tsx dev/try-sidecar-read.ts /path/to/project evaluations/proof-critique-ps_001-2026-09-14.json
//      npx tsx dev/try-sidecar-read.ts /path/to/project "uploads/Grandma's notes.txt" 40000
import { sidecarRead, type SidecarReadInput } from "../src/tools/sidecar-read.js";

const [projectPath, ref, offsetArg, maxCharsArg] = process.argv.slice(2);
if (!projectPath || !ref) {
  console.error("usage: try-sidecar-read.ts <projectPath> <ref> [offset] [maxChars]");
  process.exit(1);
}

const input: SidecarReadInput = { projectPath, ref };
// Both numeric params are rejected (not coerced) when they arrive as strings,
// so coerce here — the shell only hands us strings.
if (offsetArg !== undefined) input.offset = Number(offsetArg);
if (maxCharsArg !== undefined) input.maxChars = Number(maxCharsArg);

const result = await sidecarRead(input);
if (result.ok) {
  const { content, ...rest } = result;
  console.log(JSON.stringify({ ...rest, contentChars: content.length, serializedChars: JSON.stringify(result).length }, null, 2));
  console.log("--- content ---");
  console.log(content);
} else {
  console.log(JSON.stringify(result, null, 2));
}
