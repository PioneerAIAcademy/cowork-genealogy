/**
 * Smoke-test the image_search tool against the live FS API.
 *
 * Usage:
 *   cd mcp-server
 *   npx tsx dev/try-image-search.ts 007621224_005_M99P-2TQ   # split form
 *   npx tsx dev/try-image-search.ts 007621224                # bare form (apid path)
 */
import { imageSearchTool } from "../src/tools/image-search.js";

const imageGroupNumber = process.argv[2];
if (!imageGroupNumber) {
  console.error("Usage: npx tsx dev/try-image-search.ts <imageGroupNumber>");
  console.error(
    "  Split form: npx tsx dev/try-image-search.ts 007621224_005_M99P-2TQ"
  );
  console.error(
    "  Bare form:  npx tsx dev/try-image-search.ts 007621224"
  );
  process.exit(1);
}

const result = await imageSearchTool({ imageGroupNumber });
console.log(JSON.stringify(result, null, 2));
