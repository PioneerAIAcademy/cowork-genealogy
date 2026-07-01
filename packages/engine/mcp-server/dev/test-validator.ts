/**
 * Manual test for the TypeScript validator.
 * Run with: npm run build && node build/dev/test-validator.js
 */

import { validateProject } from "../src/validation/validator.js";
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

async function main() {
  const testDir = join(tmpdir(), "validator-test-" + Date.now());
  await mkdir(testDir, { recursive: true });

  console.log("Test directory:", testDir);

  // Test 1: Valid minimal project
  console.log("\n=== Test 1: Valid minimal project ===");
  const minimalResearch = {
    project: {
      id: "rp_001",
      objective: "Test project",
      status: "active",
      created: "2026-01-01",
      updated: "2026-01-01",
    },
    questions: [],
    plans: [],
    log: [],
    sources: [],
    assertions: [],
    person_evidence: [],
    conflicts: [],
    hypotheses: [],
    timelines: [],
    proof_summaries: [],
  };

  const minimalTree = {
    persons: [],
    relationships: [],
    sources: [],
  };

  await writeFile(
    join(testDir, "research.json"),
    JSON.stringify(minimalResearch, null, 2)
  );
  await writeFile(
    join(testDir, "tree.gedcomx.json"),
    JSON.stringify(minimalTree, null, 2)
  );

  let result = await validateProject(testDir);
  console.log("Valid:", result.valid);
  console.log("Errors:", result.errors.length);
  console.log("Warnings:", result.warnings.length);

  if (!result.valid) {
    console.log("ERROR: Should be valid!");
    console.log(result.errors);
    process.exit(1);
  }

  // Test 2: Missing required field
  console.log("\n=== Test 2: Missing required field ===");
  const badResearch = {
    ...minimalResearch,
    project: {
      ...minimalResearch.project,
      id: undefined, // missing required field
    },
  };

  await writeFile(
    join(testDir, "research.json"),
    JSON.stringify(badResearch, null, 2)
  );

  result = await validateProject(testDir);
  console.log("Valid:", result.valid);
  console.log("Errors:", result.errors.length);
  console.log("Errors:", result.errors);

  if (result.valid) {
    console.log("ERROR: Should be invalid!");
    process.exit(1);
  }

  if (!result.errors.some((e) => e.message?.includes("missing required field 'id'") || (typeof e === 'string' && e.includes("missing required field 'id'")))) {
    console.log("ERROR: Should report missing id!");
    process.exit(1);
  }

  // Test 3: Invalid enum value
  console.log("\n=== Test 3: Invalid enum value ===");
  const badEnum = {
    ...minimalResearch,
    project: {
      ...minimalResearch.project,
      status: "invalid_status",
    },
  };

  await writeFile(
    join(testDir, "research.json"),
    JSON.stringify(badEnum, null, 2)
  );

  result = await validateProject(testDir);
  console.log("Valid:", result.valid);
  console.log("Errors:", result.errors.length);
  console.log("Errors:", result.errors);

  if (result.valid) {
    console.log("ERROR: Should be invalid!");
    process.exit(1);
  }

  if (!result.errors.some((e) => e.message?.includes("not a valid project_status") || (typeof e === 'string' && e.includes("not a valid project_status")))) {
    console.log("ERROR: Should report invalid enum!");
    process.exit(1);
  }

  // Test 4: New timeline fields
  console.log("\n=== Test 4: Timeline with new optional fields ===");
  const timelineResearch = {
    ...minimalResearch,
    timelines: [
      {
        id: "t_001",
        label: "Test Timeline",
        person_ids: [],
        generated: "2026-01-01T00:00:00Z",
        events: [
          {
            date: "1850",
            date_certainty: "exact",
            event_type: "census",
            description: "Test event",
            assertion_ids: [],
            conflict_ids: ["c_001"],
            conflict_note: "Related to conflict",
          },
        ],
        gaps: [
          {
            start: "1860-01-01",
            end: "1870-01-01",
            expected_events: ["census"],
            severity: "high",
            notes: "Missing decade of records",
          },
        ],
        impossibilities: [],
      },
    ],
  };

  await writeFile(
    join(testDir, "research.json"),
    JSON.stringify(timelineResearch, null, 2)
  );
  await writeFile(
    join(testDir, "tree.gedcomx.json"),
    JSON.stringify(minimalTree, null, 2)
  );

  result = await validateProject(testDir);
  console.log("Valid:", result.valid);
  console.log("Errors:", result.errors.length);

  if (!result.valid) {
    console.log("ERROR: Should be valid with new fields!");
    console.log(result.errors);
    process.exit(1);
  }

  console.log("\n✅ All tests passed!");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
