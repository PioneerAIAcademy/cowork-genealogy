/**
 * Smoke-test the image_search tool against the live FS RMS API.
 *
 * Usage:
 *   npx tsx dev/try-image-search.ts --placeId 6137147 --from 1730-01-01 --to 1810-12-31
 *   npx tsx dev/try-image-search.ts --imageGroupNumber "007621224"
 */
import { imageSearchTool } from "../src/tools/image-search.js";

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const placeId = flag("--placeId");
const fromDate = flag("--from");
const toDate = flag("--to");
const imageGroupNumber = flag("--imageGroupNumber");

if (!placeId && !imageGroupNumber) {
  console.error(
    "Usage: npx tsx dev/try-image-search.ts --placeId <id> [--from YYYY-MM-DD] [--to YYYY-MM-DD]"
  );
  console.error('   or: npx tsx dev/try-image-search.ts --imageGroupNumber "007621224"');
  process.exit(1);
}

const result = await imageSearchTool({
  ...(placeId ? { placeId } : {}),
  ...(fromDate ? { fromDate } : {}),
  ...(toDate ? { toDate } : {}),
  ...(imageGroupNumber ? { imageGroupNumber } : {}),
});
console.log(JSON.stringify(result, null, 2));
