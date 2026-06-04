/**
 * One-shot smoke test for the person_ancestors tool against the live FS API.
 * No MCP harness — calls the tool function directly.
 *
 * Requires a valid session (run `npx tsx dev/try-login.ts unused` first).
 *
 * Usage:
 *   cd mcp-server
 *   npx tsx dev/try-person-ancestors.ts                 # no id -> logged-in user + ancestors
 *   npx tsx dev/try-person-ancestors.ts LZJW-C31
 *   npx tsx dev/try-person-ancestors.ts LZJW-C31 --generations 4 --person-details
 *   npx tsx dev/try-person-ancestors.ts LZJW-C31 --generations 2 --marriage-details
 */
import { personAncestorsTool } from "../src/tools/person-ancestors.js";
import type { PersonAncestorsInput } from "../src/types/person-ancestors.js";

const args = process.argv.slice(2);
const VALUE_FLAGS = new Set(["--generations", "--spouse"]);

function flagValue(name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

// personId is the first positional arg — skip --flags AND the values that
// belong to value-taking flags (so `--generations 2` isn't read as the id).
// Optional: omit it to read the logged-in user's own ancestry.
let personId: string | undefined;
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a.startsWith("--")) {
    if (VALUE_FLAGS.has(a)) i++; // skip this flag's value
    continue;
  }
  personId = a;
  break;
}

const input: PersonAncestorsInput = {};
if (personId) input.personId = personId;
const gen = flagValue("--generations");
if (gen) input.generations = Number(gen);
const spouse = flagValue("--spouse");
if (spouse) input.spouse = spouse;
if (args.includes("--person-details")) input.personDetails = true;
if (args.includes("--marriage-details")) input.marriageDetails = true;
if (args.includes("--descendants")) input.descendants = true;

console.log("Input:", JSON.stringify(input));
console.log("---");

try {
  const result = await personAncestorsTool(input);
  console.log(`persons: ${result.persons.length}`);
  for (const p of result.persons) {
    // Persons can carry several name variants (BirthName/AlsoKnownAs/...);
    // show the preferred one for the summary, not whatever is first.
    const n = p.names?.find((nm) => nm.preferred) ?? p.names?.[0];
    const name = [n?.prefix, n?.given, n?.surname, n?.suffix].filter(Boolean).join(" ");
    console.log(`  ${String(p.ascendancyNumber).padStart(4)}  ${p.id}  ${name}`);
  }
  if (result.relationships) {
    console.log(`relationships: ${result.relationships.length}`);
    for (const r of result.relationships) {
      const m = r.facts?.find((f) => f.type === "Marriage");
      console.log(`  ${r.person1} × ${r.person2}${m ? `  m. ${m.date ?? ""} ${m.place ?? ""}` : ""}`);
    }
  }
  console.log("---");
  console.log("Full JSON:");
  console.log(JSON.stringify(result, null, 2));
} catch (e) {
  console.error("ERROR:", (e as Error).message);
  process.exit(1);
}
