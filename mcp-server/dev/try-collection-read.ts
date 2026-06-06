/**
 * Smoke test for the collection_read tool (collection_read({ id })).
 *
 * Invokes the tool directly against the live FamilySearch API. Useful for
 * eyeballing the real output and debugging issues that the MCP harness
 * would otherwise hide.
 *
 * Usage:
 *   npx tsx dev/try-collection-read.ts 1743384       # Alabama County Marriages (known good)
 *   npx tsx dev/try-collection-read.ts 9999999       # Unknown id (expect friendly 404)
 */
import { collectionReadTool } from "../src/tools/collection-read.js";

const id = process.argv[2];
if (!id) {
  console.error("Usage: npx tsx dev/try-collection-read.ts <collection-id>");
  console.error("Example: npx tsx dev/try-collection-read.ts 1743384");
  process.exit(1);
}

try {
  const result = await collectionReadTool({ id });
  console.log(JSON.stringify(result, null, 2));
} catch (err) {
  console.error("ERROR:", err instanceof Error ? err.message : err);
  process.exit(1);
}
