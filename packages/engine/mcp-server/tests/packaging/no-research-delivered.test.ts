import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { allToolSchemas } from "../../src/tool-schemas.js";

// Step mode phase 2 deleted `research_delivered`: a one-off ask ends on the
// model's own end of turn, and on the prototype the step gate stops a second
// step (docs/plan/research-step-mode.md, Phase 2).

const mcpRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const manifest = JSON.parse(readFileSync(join(mcpRoot, "manifest.json"), "utf8")) as {
  tools: { name: string }[];
};

describe("research_delivered is deleted", () => {
  it("is not an advertised tool", () => {
    expect(allToolSchemas.map((t) => t.name)).not.toContain("research_delivered");
  });

  it("is not in the .mcpb manifest", () => {
    expect(manifest.tools.map((t) => t.name)).not.toContain("research_delivered");
  });
});
