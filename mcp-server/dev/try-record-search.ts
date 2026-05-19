import { recordSearchTool } from "../src/tools/record-search.js";
import type { RecordSearchInput } from "../src/types/record-search.js";

function usage(): never {
  console.error("Usage:");
  console.error("  npx tsx dev/try-record-search.ts <surname> [givenName] [options]");
  console.error("");
  console.error("Options:");
  console.error("  --given <name>            Given name (alt to positional)");
  console.error("  --country <name>          recordCountry anchor (use this when surname is omitted)");
  console.error("  --subdivision <name>      recordSubdivision (requires --country)");
  console.error("  --collection <id>         collectionId");
  console.error("  --birth-year <yyyy>       birth year (single year => from=to)");
  console.error("  --birth-place <name>");
  console.error("  --death-year <yyyy>");
  console.error("  --death-place <name>");
  console.error("  --marriage-year <fromY> <toY>");
  console.error("  --residence-year <fromY> <toY>");
  console.error("  --any-year <fromY> <toY>");
  console.error("  --alt <surnameAlt>        Alternate surname (auto-pairs givenNameAlt)");
  console.error("  --sex <Male|Female|Unknown>");
  console.error("  --principal               isPrincipal=true");
  console.error("  --not-principal           isPrincipal=false");
  console.error("  --type <birth|marriage|death|...>");
  console.error("  --count <n>               Default 20");
  console.error("  --offset <n>              Default 0");
  console.error("");
  console.error("Examples:");
  console.error("  npx tsx dev/try-record-search.ts Lincoln Abraham");
  console.error("  npx tsx dev/try-record-search.ts Lincoln Abraham --birth-year 1809");
  console.error("  npx tsx dev/try-record-search.ts Smith --collection 1743384 --marriage-year 1830 1850");
  console.error("  npx tsx dev/try-record-search.ts --given Mary --country \"United States\"");
  console.error("  npx tsx dev/try-record-search.ts Lincoln --alt Todd --given Mary");
  process.exit(1);
}

function parseArgs(argv: string[]): RecordSearchInput {
  const input: RecordSearchInput = {};
  const positional: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case "--given":
        input.givenName = argv[++i];
        break;
      case "--country":
        input.recordCountry = argv[++i];
        break;
      case "--subdivision":
        input.recordSubdivision = argv[++i];
        break;
      case "--collection":
        input.collectionId = parseInt(argv[++i], 10);
        break;
      case "--birth-year": {
        const y = parseInt(argv[++i], 10);
        input.birthYearFrom = y;
        input.birthYearTo = y;
        break;
      }
      case "--birth-place":
        input.birthPlace = argv[++i];
        break;
      case "--death-year": {
        const y = parseInt(argv[++i], 10);
        input.deathYearFrom = y;
        input.deathYearTo = y;
        break;
      }
      case "--death-place":
        input.deathPlace = argv[++i];
        break;
      case "--marriage-year":
        input.marriageYearFrom = parseInt(argv[++i], 10);
        input.marriageYearTo = parseInt(argv[++i], 10);
        break;
      case "--residence-year":
        input.residenceYearFrom = parseInt(argv[++i], 10);
        input.residenceYearTo = parseInt(argv[++i], 10);
        break;
      case "--any-year":
        input.anyYearFrom = parseInt(argv[++i], 10);
        input.anyYearTo = parseInt(argv[++i], 10);
        break;
      case "--alt":
        input.surnameAlt = argv[++i];
        break;
      case "--sex":
        input.sex = argv[++i];
        break;
      case "--principal":
        input.isPrincipal = true;
        break;
      case "--not-principal":
        input.isPrincipal = false;
        break;
      case "--type":
        input.recordType = argv[++i];
        break;
      case "--count":
        input.count = parseInt(argv[++i], 10);
        break;
      case "--offset":
        input.offset = parseInt(argv[++i], 10);
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
  if (positional[1] && !input.givenName) input.givenName = positional[1];

  return input;
}

const argv = process.argv.slice(2);
if (argv.length === 0) usage();

const input = parseArgs(argv);
const result = await recordSearchTool(input);
console.log(JSON.stringify(result, null, 2));
