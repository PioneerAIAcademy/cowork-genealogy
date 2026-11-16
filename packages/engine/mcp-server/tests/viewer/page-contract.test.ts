import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { PROJECT_META_KEY, READ_PROJECT_VIEW, SHOW_PROJECT } from "../../src/tools/project-view.js";
import { toolSchemas } from "../../viewer/tools.js";
import { ENGINE_ROOT } from "./harness.js";

// The page may not depend on the engine, so its contract.ts repeats these names.
// The engine suite runs on every PR, so the check lives on this side.
const CONTRACT = resolve(ENGINE_ROOT, "../../../apps/mcp-viewer/src/contract.ts");

/** A string constant's value as contract.ts writes it, or null. */
function contractString(source: string, name: string): string | null {
  return new RegExp(`export const ${name} = '([^']*)'`).exec(source)?.[1] ?? null;
}

/** The strings in a contract.ts array constant, or null. */
function contractList(source: string, name: string): string[] | null {
  const body = new RegExp(`export const ${name} = \\[([^\\]]*)\\]`).exec(source)?.[1];
  return body === undefined ? null : [...body.matchAll(/'([^']*)'/g)].map((match) => match[1]);
}

describe("the page's contract.ts matches the server", () => {
  const source = readFileSync(CONTRACT, "utf8");

  it("names the same tools and meta key", () => {
    expect(contractString(source, "SHOW_PROJECT")).toBe(SHOW_PROJECT);
    expect(contractString(source, "READ_PROJECT_VIEW")).toBe(READ_PROJECT_VIEW);
    expect(contractString(source, "PROJECT_META_KEY")).toBe(PROJECT_META_KEY);
  });

  it("offers the same show values", () => {
    const show = toolSchemas.find((tool) => tool.name === SHOW_PROJECT)?.inputSchema.properties.show;
    expect(contractList(source, "SHOW_VALUES")).toEqual(show?.enum);
  });

  it("reads null rather than a false match when a constant is missing or reshaped", () => {
    expect(contractString("export const SHOW_PROJECT = `show_project`", "SHOW_PROJECT")).toBeNull();
    expect(contractList("export const OTHER = ['a']", "SHOW_VALUES")).toBeNull();
  });
});
