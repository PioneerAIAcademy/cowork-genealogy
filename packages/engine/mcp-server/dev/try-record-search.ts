import { recordSearchTool } from "../src/tools/record-search.js";
import type { RecordSearchInput } from "../src/types/record-search.js";

function usage(): never {
  console.error("Usage:");
  console.error("  npx tsx dev/try-search.ts <surname> [givenName] [options]");
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
  console.error("Relative anchors (see `relativeTerms` in the response):");
  console.error("  --father <given> [surname]");
  console.error("  --mother <given> [surname]");
  console.error("  --parent <given> [surname]   Use when the parent's sex is unknown");
  console.error("  --spouse <given> [surname]");
  console.error("  --terms                      Print only a relativeTerms tally, not the full JSON");
  console.error("");
  console.error("Examples:");
  console.error("  npx tsx dev/try-search.ts Lincoln Abraham");
  console.error("  npx tsx dev/try-search.ts Lincoln Abraham --birth-year 1809");
  console.error("  npx tsx dev/try-search.ts Smith --collection 1743384 --marriage-year 1830 1850");
  console.error("  npx tsx dev/try-search.ts --given Mary --country \"United States\"");
  console.error("  npx tsx dev/try-search.ts Lincoln --alt Todd --given Mary");
  console.error("  npx tsx dev/try-search.ts Neal --father William --count 50 --terms");
  process.exit(1);
}

/** Consume `<given> [surname]` — the surname is optional, so only take the next
 *  token as one when it is not another flag. */
function takeKinNames(argv: string[], i: number): [string, string | undefined, number] {
  const given = argv[++i];
  const next = argv[i + 1];
  if (next !== undefined && !next.startsWith("--")) return [given, next, i + 1];
  return [given, undefined, i];
}

function parseArgs(argv: string[]): { input: RecordSearchInput; termsOnly: boolean } {
  const input: RecordSearchInput = {};
  const positional: string[] = [];
  let termsOnly = false;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case "--father":
      case "--mother":
      case "--parent":
      case "--spouse": {
        const prefix = a.slice(2) as "father" | "mother" | "parent" | "spouse";
        const [given, surname, next] = takeKinNames(argv, i);
        i = next;
        (input as unknown as Record<string, string>)[`${prefix}GivenName`] = given;
        if (surname !== undefined) {
          (input as unknown as Record<string, string>)[`${prefix}Surname`] = surname;
        }
        break;
      }
      case "--terms":
        termsOnly = true;
        break;
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
        // Collection ids are strings ("2469233"), not numbers — parseInt here
        // silently produced a number the tool would reject.
        input.collectionId = argv[++i];
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

  return { input, termsOnly };
}

const argv = process.argv.slice(2);
if (argv.length === 0) usage();

const { input, termsOnly } = parseArgs(argv);
const result = await recordSearchTool(input);

if (termsOnly) {
  // The distribution `record-search-tool-spec-v2.md` § relativeTerms cannot get
  // from the offline corpora: how often each status actually fires on a live
  // relative-anchored search, and in particular how often the persona anchor
  // falls back to `principal` (which forces `unknown` on every prefix and is
  // not derivable from a staged sidecar, since `entry.id` is never persisted).
  const tally: Record<string, Record<string, number>> = {};
  for (const r of result.results) {
    for (const [prefix, finding] of Object.entries(r.relativeTerms ?? {})) {
      tally[prefix] ??= { present: 0, absent: 0, unknown: 0 };
      tally[prefix][finding.status] += 1;
    }
  }
  const withTerms = result.results.filter((r) => r.relativeTerms).length;
  console.log(`results: ${result.results.length}  (with relativeTerms: ${withTerms})`);
  for (const [prefix, counts] of Object.entries(tally)) {
    const parts = Object.entries(counts).map(([k, v]) => `${k} ${v}`);
    console.log(`  ${prefix.padEnd(7)} ${parts.join("  ")}`);
  }
  if (Object.keys(tally).length === 0) {
    console.log("  (no relative anchor supplied — pass --father/--mother/--parent/--spouse)");
  }
} else {
  console.log(JSON.stringify(result, null, 2));
}
