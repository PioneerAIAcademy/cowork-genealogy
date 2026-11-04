import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { frontmatterBlock, scalarValue } from "./frontmatter.js";

// An agent with no `model:` or `effort:` runs on the main thread's: the
// plugin's main-thread.json on the hosted planes and in both harnesses, and
// the user's own choice in Cowork. Each agent states both, so it runs the same
// everywhere and its level can be tuned on its own.

const here = dirname(fileURLToPath(import.meta.url));
const agentsDir = join(here, "..", "..", "..", "plugin", "agents");
const agentFiles = readdirSync(agentsDir).filter((f) => f.endsWith(".md"));

// The levels the agent SDK's `EffortLevel` accepts (`apps/server/app/config.py`).
const EFFORT_LEVELS = ["low", "medium", "high", "xhigh", "max"];

describe("every plugin agent states its own model and effort", () => {
  it("reads the agent files", () => {
    expect(agentFiles.length).toBeGreaterThan(20);
  });

  it.each(agentFiles)("%s", (file) => {
    const block = frontmatterBlock(readFileSync(join(agentsDir, file), "utf8"));
    expect(block, `${file}: no frontmatter`).not.toBeNull();
    const model = scalarValue(block!, "model")?.trim() ?? "";
    const effort = scalarValue(block!, "effort")?.trim() ?? "";
    expect(
      model !== "" && model !== "inherit",
      `${file}: name the model it runs on (\`model: claude-...\`), not omitted or \`inherit\``,
    ).toBe(true);
    expect(
      EFFORT_LEVELS,
      `${file}: \`effort:\` must be one of ${EFFORT_LEVELS.join(", ")}; got ${JSON.stringify(effort)}`,
    ).toContain(effort);
  });
});
