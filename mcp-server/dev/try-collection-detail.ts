/**
 * Smoke test for collection-detail mode (collections({ id })).
 *
 * Invokes the tool directly against the live FamilySearch API. Useful for
 * eyeballing the real output and debugging issues that the MCP harness
 * would otherwise hide.
 *
 * Usage:
 *   npx tsx dev/try-collection-detail.ts 1743384       # Alabama County Marriages (known good)
 *   npx tsx dev/try-collection-detail.ts 9999999       # Unknown id (expect friendly 404)
 */
import { collectionsTool } from "../src/tools/collections.js";

const id = process.argv[2];
if (!id) {
  console.error("Usage: npx tsx dev/try-collection-detail.ts <collection-id>");
  console.error("Example: npx tsx dev/try-collection-detail.ts 1743384");
  process.exit(1);
}

try {
  const result = await collectionsTool({ id });
  console.log(JSON.stringify(result, null, 2));
} catch (err) {
  console.error("ERROR:", err instanceof Error ? err.message : err);
  process.exit(1);
}
