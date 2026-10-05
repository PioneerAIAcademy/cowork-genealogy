/**
 * Smoke-test the image_search tool against the live FS API.
 *
 * Usage:
 *   cd mcp-server
 *   npx tsx dev/try-image-search.ts 007621224_005_M99P-2TQ   # split form
 *   npx tsx dev/try-image-search.ts 007621224                # bare form (apid path)
 *   npx tsx dev/try-image-search.ts 004528134 5 10           # item 5, image 10 → 004528134_00632
 */
import { LOCAL } from "../src/auth/principal.js";
import { imageSearchTool } from "../src/tools/image-search.js";

const [imageGroupNumber, item, itemImage] = process.argv.slice(2);
if (!imageGroupNumber) {
  console.error("Usage: npx tsx dev/try-image-search.ts <imageGroupNumber> [item] [itemImage]");
  console.error(
    "  Split form: npx tsx dev/try-image-search.ts 007621224_005_M99P-2TQ"
  );
  console.error(
    "  Bare form:  npx tsx dev/try-image-search.ts 007621224"
  );
  console.error(
    "  Item form:  npx tsx dev/try-image-search.ts 004528134 5 10"
  );
  process.exit(1);
}

const started = Date.now();
let result;
try {
  result = await imageSearchTool(
    {
      imageGroupNumber,
      ...(item !== undefined ? { item: Number(item) } : {}),
      ...(itemImage !== undefined ? { itemImage: Number(itemImage) } : {}),
    },
    LOCAL,
  );
} catch (error) {
  console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
  console.error(`${Date.now() - started} ms`);
  process.exit(1);
}
const { imageIds, ...rest } = result;
console.log(
  JSON.stringify(
    { ...rest, imageCount: imageIds.length, first: imageIds[0], last: imageIds.at(-1) },
    null,
    2,
  ),
);
console.log(`${Date.now() - started} ms`);
