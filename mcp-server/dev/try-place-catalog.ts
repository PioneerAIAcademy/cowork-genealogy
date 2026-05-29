import { placeCatalog } from "../src/tools/place-catalog.js";

// Usage:
//   npx tsx dev/try-place-catalog.ts --place 33            # placeId (Alabama, United States)
//   npx tsx dev/try-place-catalog.ts --keywords "civil war"
//   npx tsx dev/try-place-catalog.ts --surname Butler
//   npx tsx dev/try-place-catalog.ts --dgs 7937005
//   npx tsx dev/try-place-catalog.ts --place 33 --surname Griffin

const args = process.argv.slice(2);

function flag(name: string): string | undefined {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 ? args[idx + 1] : undefined;
}

const placeId = flag("place");
const keywords = flag("keywords");
const surname = flag("surname");
const imageGroupNumber = flag("dgs");
const countRaw = flag("count");

if (!placeId && !keywords && !surname && !imageGroupNumber) {
  console.error("Provide at least one of: --place <id>, --keywords <text>, --surname <name>, --dgs <number>");
  process.exit(1);
}

const result = await placeCatalog({
  ...(placeId ? { placeId } : {}),
  ...(keywords ? { keywords } : {}),
  ...(surname ? { surname } : {}),
  ...(imageGroupNumber ? { imageGroupNumber } : {}),
  ...(countRaw ? { count: parseInt(countRaw, 10) } : {}),
});

console.log(JSON.stringify(result, null, 2));
console.error(`\ntotalHits: ${result.totalHits}  returned: ${result.returnedCount}`);
