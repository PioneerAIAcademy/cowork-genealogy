import { recordSearchTool } from "../src/tools/record-search.js";
import type { RecordSearchInput } from "../src/types/record-search.js";

function usage(): never {
  console.error("Usage:");
  console.error("  npx tsx dev/try-record-search-film.ts <surname> --film <imageGroupNumber> [options]");
  console.error("");
  console.error("Options:");
  console.error("  --film <number>           Image group number (required)");
  console.error("  --given <name>            Given name");
  console.error("  --country <name>          recordCountry anchor");
  console.error("  --birth-year <yyyy>       Birth year (single year => from=to)");
  console.error("  --count <n>               Default 20");
  console.error("");
  console.error("Examples:");
  console.error("  npx tsx dev/try-record-search-film.ts Smith --film 004010852");
  console.error("  npx tsx dev/try-record-search-film.ts Smith --film 004010852 --given John --birth-year 1850");
  console.error("  npx tsx dev/try-record-search-film.ts --country \"United States\" --film 004010852");
  process.exit(1);
}

const argv = process.argv.slice(2);
if (argv.length === 0) usage();

const input: RecordSearchInput = {};
const positional: string[] = [];

for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  switch (a) {
    case "--film":
      input.imageGroupNumber = argv[++i];
      break;
    case "--given":
      input.givenName = argv[++i];
      break;
    case "--country":
      input.recordCountry = argv[++i];
      break;
    case "--birth-year": {
      const y = parseInt(argv[++i], 10);
      input.birthYearFrom = y;
      input.birthYearTo = y;
      break;
    }
    case "--count":
      input.count = parseInt(argv[++i], 10);
      break;
    case "--help":
    case "-h":
      usage();
    default:
      if (a.startsWith("--")) {
        console.error(`Unknown flag: ${a}`);
        usage();
      }
      positional.push(a);
  }
}

if (positional[0]) input.surname = positional[0];

if (!input.imageGroupNumber) {
  console.error("Error: --film is required for this smoke test.");
  usage();
}

const result = await recordSearchTool(input);
console.log(JSON.stringify(result, null, 2));
