/**
 * Smoke-test for the `person_search` MCP tool against the live FamilySearch
 * tree-search endpoint. Requires a logged-in session (see the `login` tool).
 *
 * Usage:
 *   npx tsx dev/try-person-search.ts Lincoln Abraham
 *   npx tsx dev/try-person-search.ts Lincoln Abraham --birth-year 1809 --birth-place Kentucky
 *   npx tsx dev/try-person-search.ts Lincoln --given Mary --spouse-surname Lincoln
 *
 * Positional args: <surname> [givenName]. Flags override / add fields.
 * Remember the surname-plus-one rule: a surname alone is rejected.
 */
import { personSearchTool } from "../src/tools/person-search.js";
import type { PersonSearchInput } from "../src/types/person-search.js";

const argv = process.argv.slice(2);
const input: PersonSearchInput = {};
const positionals: string[] = [];

for (let i = 0; i < argv.length; i++) {
  const arg = argv[i];
  if (arg.startsWith("--")) {
    const value = argv[++i];
    switch (arg) {
      case "--given": input.givenName = value; break;
      case "--surname": input.surname = value; break;
      case "--birth-place": input.birthPlace = value; break;
      case "--death-place": input.deathPlace = value; break;
      case "--birth-year": input.birthYearFrom = input.birthYearTo = Number(value); break;
      case "--death-year": input.deathYearFrom = input.deathYearTo = Number(value); break;
      case "--father-surname": input.fatherSurname = value; break;
      case "--mother-surname": input.motherSurname = value; break;
      case "--spouse-surname": input.spouseSurname = value; break;
      case "--count": input.count = Number(value); break;
      default:
        console.error(`Unknown flag: ${arg}`);
        process.exit(1);
    }
  } else {
    positionals.push(arg);
  }
}
if (positionals[0] && !input.surname) input.surname = positionals[0];
if (positionals[1] && !input.givenName) input.givenName = positionals[1];

if (!input.surname) {
  console.error(
    "Usage: npx tsx dev/try-person-search.ts <surname> [givenName] [--birth-year YYYY] [--birth-place X] [--father-surname X] [--spouse-surname X] [--count N]"
  );
  process.exit(1);
}

const result = await personSearchTool(input);
console.log(JSON.stringify(result, null, 2));
